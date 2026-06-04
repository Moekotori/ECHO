import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { isDsfFilePath } from './DsdProbe';

export type DsfDopInfo = {
  channels: number;
  nativeSampleRate: number;
  transportSampleRate: number;
  sampleCount: number;
  dataOffset: number;
  dataBytes: number;
  blockSizePerChannel: number;
};

const headerReadBytes = 1024 * 1024;
const dsdMagic = Buffer.from('DSD ', 'ascii');
const fmtMagic = Buffer.from('fmt ', 'ascii');
const dataMagic = Buffer.from('data', 'ascii');
const dopFrameSourceBytes = 2;
const dopBytesPerSample = 3;

const readUInt64LeAsNumber = (buffer: Buffer, offset: number): number | null => {
  if (offset < 0 || offset + 8 > buffer.length) {
    return null;
  }

  const value = buffer.readBigUInt64LE(offset);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
};

const bufferStartsWith = (buffer: Buffer, magic: Buffer, offset = 0): boolean =>
  buffer.length >= offset + magic.length && buffer.subarray(offset, offset + magic.length).equals(magic);

export const parseDsfDopInfoFromBuffer = (filePath: string, buffer: Buffer): DsfDopInfo => {
  if (!isDsfFilePath(filePath) || !bufferStartsWith(buffer, dsdMagic)) {
    throw new Error('dsd_dop_format_unsupported:not_dsf');
  }

  let offset = 0;
  let channels = 0;
  let nativeSampleRate = 0;
  let sampleCount = 0;
  let blockSizePerChannel = 0;
  let dataOffset = 0;
  let dataBytes = 0;

  while (offset + 12 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4);
    const chunkSize = readUInt64LeAsNumber(buffer, offset + 4);
    if (!chunkSize || chunkSize < 12) {
      break;
    }

    if (chunkId.equals(fmtMagic)) {
      if (offset + 52 > buffer.length) {
        throw new Error('dsd_dop_format_unsupported:truncated_fmt');
      }
      channels = buffer.readUInt32LE(offset + 24);
      nativeSampleRate = buffer.readUInt32LE(offset + 28);
      sampleCount = Number(buffer.readBigUInt64LE(offset + 36));
      blockSizePerChannel = buffer.readUInt32LE(offset + 44);
    } else if (chunkId.equals(dataMagic)) {
      dataOffset = offset + 12;
      dataBytes = Math.max(0, chunkSize - 12);
    }

    offset += chunkSize;
  }

  if (channels < 1 || channels > 2) {
    throw new Error(`dsd_dop_format_unsupported:channels_${channels || 'unknown'}`);
  }
  if (![2_822_400, 5_644_800, 11_289_600].includes(nativeSampleRate)) {
    throw new Error(`dsd_dop_format_unsupported:rate_${nativeSampleRate || 'unknown'}`);
  }
  if (sampleCount <= 0 || blockSizePerChannel <= 0 || dataOffset <= 0 || dataBytes <= 0) {
    throw new Error('dsd_dop_format_unsupported:missing_data');
  }

  return {
    channels,
    nativeSampleRate,
    transportSampleRate: Math.round(nativeSampleRate / 16),
    sampleCount,
    dataOffset,
    dataBytes,
    blockSizePerChannel,
  };
};

export const readDsfDopInfo = async (filePath: string): Promise<DsfDopInfo> => {
  const handle = await fs.open(filePath, 'r');
  try {
    const stats = await handle.stat();
    const bytesToRead = Math.min(Math.max(0, stats.size), headerReadBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    return parseDsfDopInfoFromBuffer(filePath, buffer.subarray(0, bytesRead));
  } finally {
    await handle.close().catch(() => undefined);
  }
};

export const packDop24Le = (
  channelBlocks: Buffer[],
  byteOffset: number,
  byteCount: number,
  startFrameIndex = 0,
): Buffer => {
  const channels = channelBlocks.length;
  const frames = Math.max(0, Math.floor(byteCount / dopFrameSourceBytes));
  const output = Buffer.allocUnsafe(frames * channels * dopBytesPerSample);
  let outputOffset = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    const marker = ((startFrameIndex + frame) & 1) === 0 ? 0x05 : 0xfa;
    const sourceOffset = byteOffset + frame * dopFrameSourceBytes;

    for (const block of channelBlocks) {
      output[outputOffset] = block[sourceOffset] ?? 0;
      output[outputOffset + 1] = block[sourceOffset + 1] ?? 0;
      output[outputOffset + 2] = marker;
      outputOffset += dopBytesPerSample;
    }
  }

  return output;
};

export const packNativeDsdBytes = (
  channelBlocks: Buffer[],
  byteOffset: number,
  byteCount: number,
): Buffer => {
  const channels = channelBlocks.length;
  const output = Buffer.allocUnsafe(byteCount * channels);
  let outputOffset = 0;

  for (let byteIndex = 0; byteIndex < byteCount; byteIndex += 1) {
    const sourceOffset = byteOffset + byteIndex;
    for (const block of channelBlocks) {
      output[outputOffset] = block[sourceOffset] ?? 0x69;
      outputOffset += 1;
    }
  }

  return output;
};

export const createDsfDopStream = (filePath: string, info: DsfDopInfo, startSeconds = 0): Readable => {
  const sourceBytesPerChannel = Math.ceil(info.sampleCount / 8);
  const requestedByteOffset = Math.max(0, Math.floor(startSeconds * info.nativeSampleRate / 8));
  const alignedByteOffset = requestedByteOffset - (requestedByteOffset % dopFrameSourceBytes);
  const firstBlock = Math.floor(alignedByteOffset / info.blockSizePerChannel);
  const firstBlockOffset = alignedByteOffset % info.blockSizePerChannel;

  async function* generate(): AsyncGenerator<Buffer> {
    let dopFrameIndex = Math.floor(alignedByteOffset / dopFrameSourceBytes);
    const blockStride = info.blockSizePerChannel * info.channels;
    const availableBlocks = Math.ceil(sourceBytesPerChannel / info.blockSizePerChannel);

    const handle = await fs.open(filePath, 'r');
    try {
      for (let blockIndex = firstBlock; blockIndex < availableBlocks; blockIndex += 1) {
        const groupOffset = info.dataOffset + blockIndex * blockStride;
        const groupSize = Math.min(blockStride, info.dataOffset + info.dataBytes - groupOffset);
        if (groupSize <= 0) {
          break;
        }

        const chunks: Buffer[] = [];
        for (let channel = 0; channel < info.channels; channel += 1) {
          const start = groupOffset + channel * info.blockSizePerChannel;
          const length = Math.min(info.blockSizePerChannel, Math.max(0, info.dataOffset + info.dataBytes - start));
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, start);
          chunks.push(bytesRead === length ? buffer : buffer.subarray(0, bytesRead));
        }

        const byteOffset = blockIndex === firstBlock ? firstBlockOffset : 0;
        const remainingSourceBytes = sourceBytesPerChannel - blockIndex * info.blockSizePerChannel - byteOffset;
        const byteCount = Math.min(info.blockSizePerChannel - byteOffset, remainingSourceBytes);
        const alignedByteCount = byteCount - (byteCount % dopFrameSourceBytes);
        if (alignedByteCount <= 0) {
          break;
        }

        const packed = packDop24Le(chunks, byteOffset, alignedByteCount, dopFrameIndex);
        dopFrameIndex += alignedByteCount / dopFrameSourceBytes;
        yield packed;
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  return Readable.from(generate());
};

export const createDsfNativeDsdStream = (filePath: string, info: DsfDopInfo, startSeconds = 0): Readable => {
  const sourceBytesPerChannel = Math.ceil(info.sampleCount / 8);
  const requestedByteOffset = Math.max(0, Math.floor(startSeconds * info.nativeSampleRate / 8));
  const firstBlock = Math.floor(requestedByteOffset / info.blockSizePerChannel);
  const firstBlockOffset = requestedByteOffset % info.blockSizePerChannel;

  async function* generate(): AsyncGenerator<Buffer> {
    const blockStride = info.blockSizePerChannel * info.channels;
    const availableBlocks = Math.ceil(sourceBytesPerChannel / info.blockSizePerChannel);

    const handle = await fs.open(filePath, 'r');
    try {
      for (let blockIndex = firstBlock; blockIndex < availableBlocks; blockIndex += 1) {
        const groupOffset = info.dataOffset + blockIndex * blockStride;
        const groupSize = Math.min(blockStride, info.dataOffset + info.dataBytes - groupOffset);
        if (groupSize <= 0) {
          break;
        }

        const chunks: Buffer[] = [];
        for (let channel = 0; channel < info.channels; channel += 1) {
          const start = groupOffset + channel * info.blockSizePerChannel;
          const length = Math.min(info.blockSizePerChannel, Math.max(0, info.dataOffset + info.dataBytes - start));
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, start);
          chunks.push(bytesRead === length ? buffer : buffer.subarray(0, bytesRead));
        }

        const byteOffset = blockIndex === firstBlock ? firstBlockOffset : 0;
        const remainingSourceBytes = sourceBytesPerChannel - blockIndex * info.blockSizePerChannel - byteOffset;
        const byteCount = Math.min(info.blockSizePerChannel - byteOffset, remainingSourceBytes);
        if (byteCount <= 0) {
          break;
        }

        yield packNativeDsdBytes(chunks, byteOffset, byteCount);
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  return Readable.from(generate());
};
