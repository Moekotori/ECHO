import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';

const mp4ContainerExtensions = new Set(['.m4a', '.m4b', '.m4p', '.mp4', '.mov']);
const maxBoxDepth = 8;
const maxBoxesScanned = 4096;
const maxSampleEntries = 32;
const boxHeaderBytes = 8;
const largeBoxHeaderBytes = 16;
const stsdFullBoxHeaderBytes = 8;
const metaFullBoxHeaderBytes = 4;

const containerBoxes = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'meta']);

const cleanText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const codecCompareKey = (value: string): string => {
  const compact = value.toLowerCase().replace(/[^a-z0-9]/gu, '');
  if (compact === 'eac3' || compact === 'ec3') return 'eac3';
  if (compact === 'ac3') return 'ac3';
  if (compact === 'ac4') return 'ac4';
  if (compact === 'applelossless') return 'alac';
  if (compact === 'mpeg4audio') return 'aac';
  return compact;
};

const genericMp4CodecPattern = /^(?:m4a|mp4|mpeg-?4|quicktime|iso base media)$/iu;
const alacCodecPattern = /\b(?:alac|apple\s+lossless)\b/iu;
const dolbyCodecPattern = /\b(?:e-?ac-?3|ec-?3|ac-?3|ac-?4|truehd|mlp|dolby)\b/iu;

export const isMp4ContainerPath = (filePath: string): boolean =>
  mp4ContainerExtensions.has(extname(filePath).toLowerCase());

export const isAlacCodec = (value: unknown): boolean =>
  typeof value === 'string' && alacCodecPattern.test(value);

const isDolbyCodec = (value: unknown): boolean =>
  typeof value === 'string' && dolbyCodecPattern.test(value);

const isGenericMp4Codec = (value: unknown): boolean =>
  typeof value === 'string' && genericMp4CodecPattern.test(value.trim());

export const normalizeMp4AudioSampleEntryCodec = (value: unknown): string | null => {
  const tag = cleanText(value);
  if (!tag) {
    return null;
  }

  switch (tag.toLowerCase()) {
    case 'alac':
      return 'ALAC';
    case 'ac-3':
      return 'AC-3';
    case 'ec-3':
      return 'E-AC-3';
    case 'ac-4':
      return 'AC-4';
    case 'mlpa':
      return 'Dolby TrueHD';
    case 'mp4a':
      return 'AAC';
    case 'flac':
      return 'FLAC';
    case 'opus':
      return 'OPUS';
    case 'samr':
      return 'AMR';
    case 'sawb':
      return 'AMR-WB';
    case 'dtsc':
    case 'dtsh':
    case 'dtsl':
    case 'dtsx':
      return 'DTS';
    case 'lpcm':
    case 'sowt':
    case 'twos':
    case 'in24':
    case 'in32':
    case 'fl32':
    case 'fl64':
      return 'PCM';
    default:
      return null;
  }
};

export const shouldUseMp4AudioSampleEntryCodec = (
  currentCodec: unknown,
  sampleEntryCodec: unknown,
): boolean => {
  const resolved = cleanText(sampleEntryCodec);
  if (!resolved) {
    return false;
  }

  const current = cleanText(currentCodec);
  if (!current) {
    return true;
  }

  if (codecCompareKey(current) === codecCompareKey(resolved)) {
    return false;
  }

  return isGenericMp4Codec(current) || isAlacCodec(current) || isAlacCodec(resolved) || isDolbyCodec(resolved);
};

const readBytes = async (
  file: FileHandle,
  position: number,
  length: number,
): Promise<Buffer | null> => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  return bytesRead === length ? buffer : null;
};

const uint64ToSafeNumber = (value: bigint): number | null =>
  value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;

const parseStsdBox = async (
  file: FileHandle,
  start: number,
  end: number,
): Promise<string | null> => {
  if (start + stsdFullBoxHeaderBytes > end) {
    return null;
  }

  const header = await readBytes(file, start, stsdFullBoxHeaderBytes);
  if (!header) {
    return null;
  }

  const entryCount = Math.min(header.readUInt32BE(4), maxSampleEntries);
  let offset = start + stsdFullBoxHeaderBytes;

  for (let index = 0; index < entryCount && offset + boxHeaderBytes <= end; index += 1) {
    const entryHeader = await readBytes(file, offset, boxHeaderBytes);
    if (!entryHeader) {
      return null;
    }

    const entrySize = entryHeader.readUInt32BE(0);
    const sampleEntryTag = entryHeader.toString('ascii', 4, 8);
    const codec = normalizeMp4AudioSampleEntryCodec(sampleEntryTag);
    if (codec) {
      return codec;
    }

    if (entrySize < boxHeaderBytes) {
      return null;
    }

    offset = Math.min(offset + entrySize, end);
  }

  return null;
};

const scanBoxes = async (
  file: FileHandle,
  start: number,
  end: number,
  depth = 0,
  scanned = { count: 0 },
): Promise<string | null> => {
  if (depth > maxBoxDepth) {
    return null;
  }

  let offset = start;
  while (offset + boxHeaderBytes <= end && scanned.count < maxBoxesScanned) {
    scanned.count += 1;
    const baseHeader = await readBytes(file, offset, boxHeaderBytes);
    if (!baseHeader) {
      return null;
    }

    let header = baseHeader;
    const size32 = header.readUInt32BE(0);
    if (size32 === 1) {
      const largeHeader = await readBytes(file, offset, largeBoxHeaderBytes);
      if (!largeHeader) {
        return null;
      }
      header = largeHeader;
    }

    const type = header.toString('ascii', 4, 8);
    let headerSize = boxHeaderBytes;
    let boxSize: number | null = size32;

    if (size32 === 1) {
      headerSize = largeBoxHeaderBytes;
      boxSize = uint64ToSafeNumber(header.readBigUInt64BE(8));
    } else if (size32 === 0) {
      boxSize = end - offset;
    }

    if (!boxSize || boxSize < headerSize) {
      return null;
    }

    const boxEnd = Math.min(offset + boxSize, end);
    if (type === 'stsd') {
      const codec = await parseStsdBox(file, offset + headerSize, boxEnd);
      if (codec) {
        return codec;
      }
    } else if (containerBoxes.has(type)) {
      const contentStart = offset + headerSize + (type === 'meta' ? metaFullBoxHeaderBytes : 0);
      if (contentStart < boxEnd) {
        const codec = await scanBoxes(file, contentStart, boxEnd, depth + 1, scanned);
        if (codec) {
          return codec;
        }
      }
    }

    offset = boxEnd;
  }

  return null;
};

export const readMp4AudioSampleEntryCodec = async (filePath: string): Promise<string | null> => {
  if (!isMp4ContainerPath(filePath)) {
    return null;
  }

  let file: FileHandle | null = null;
  try {
    file = await open(filePath, 'r');
    const stats = await file.stat();
    return stats.isFile() ? await scanBoxes(file, 0, stats.size) : null;
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => undefined);
  }
};

export const resolveMp4ContainerAudioCodec = async (
  filePath: string,
  currentCodec: string | null,
): Promise<string | null> => {
  const sampleEntryCodec = await readMp4AudioSampleEntryCodec(filePath);
  return shouldUseMp4AudioSampleEntryCodec(currentCodec, sampleEntryCodec)
    ? sampleEntryCodec
    : currentCodec;
};
