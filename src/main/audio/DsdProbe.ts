import { open } from 'node:fs/promises';
import { extname } from 'node:path';

type DsdProbeLike = {
  filePath?: string | null;
  codec?: string | null;
  bitDepth?: number | null;
  fileSampleRate?: number | null;
};

const dsdHeaderReadBytes = 1024 * 1024;
const maxReasonableDsdSampleRate = 100_000_000;
const dsfMagic = Buffer.from('DSD ', 'ascii');
const dsfFormatChunk = Buffer.from('fmt ', 'ascii');
const dffRootMagic = Buffer.from('FRM8', 'ascii');
const dffSampleRateChunk = Buffer.from('FS  ', 'ascii');

export const dsdSampleRateFloor = 1_000_000;
export const defaultDsdNativeSampleRate = 2_822_400;
export const dsdPcmDecimationFactor = 16;
export const maxDsdPcmOutputSampleRate = 352_800;
export const dsdPcmOutputSampleRates = [44_100, 88_200, 176_400, 352_800] as const;
export const dsdDopDecimationFactor = 16;
export const dsdDopTransportSampleRates = [176_400, 352_800, 705_600] as const;

const normalizePositiveInteger = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.round(numberValue) : null;
};

const bufferStartsWith = (buffer: Buffer, magic: Buffer, offset = 0): boolean =>
  buffer.length >= offset + magic.length && buffer.subarray(offset, offset + magic.length).equals(magic);

const readUInt64LeAsNumber = (buffer: Buffer, offset: number): number | null => {
  if (offset < 0 || offset + 8 > buffer.length) {
    return null;
  }

  const value = buffer.readBigUInt64LE(offset);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
};

const isLikelyDsdNativeSampleRate = (sampleRate: number): boolean =>
  Number.isInteger(sampleRate) &&
  sampleRate >= dsdSampleRateFloor &&
  sampleRate <= maxReasonableDsdSampleRate;

export const isDsdFilePath = (filePath: string | null | undefined): boolean => {
  const extension = extname(filePath ?? '').toLowerCase();
  return extension === '.dsf' || extension === '.dff';
};

export const isDsfFilePath = (filePath: string | null | undefined): boolean =>
  extname(filePath ?? '').toLowerCase() === '.dsf';

export const isDsdCodec = (codec: string | null | undefined): boolean => {
  const normalized = typeof codec === 'string' ? codec.toLowerCase() : '';
  return normalized.includes('dsd') || normalized.includes('dsf') || normalized.includes('dff');
};

export const isDsdProbe = (probe: DsdProbeLike): boolean => {
  const fileSampleRate = normalizePositiveInteger(probe.fileSampleRate);

  return (
    isDsdFilePath(probe.filePath) ||
    isDsdCodec(probe.codec) ||
    (probe.bitDepth === 1 && fileSampleRate !== null && fileSampleRate >= dsdSampleRateFloor)
  );
};

export const shouldProbeDsdNativeSampleRate = (probe: DsdProbeLike): boolean => {
  if (!isDsdProbe(probe)) {
    return false;
  }

  const fileSampleRate = normalizePositiveInteger(probe.fileSampleRate);
  return fileSampleRate === null || fileSampleRate < dsdSampleRateFloor;
};

export const resolveDsdPcmOutputSampleRate = (probe: DsdProbeLike): number | null => {
  if (!isDsdProbe(probe)) {
    return null;
  }

  const fileSampleRate = normalizePositiveInteger(probe.fileSampleRate);
  const nativeSampleRate =
    fileSampleRate !== null && fileSampleRate >= dsdSampleRateFloor
      ? fileSampleRate
      : defaultDsdNativeSampleRate;
  const targetRate = Math.min(nativeSampleRate / dsdPcmDecimationFactor, maxDsdPcmOutputSampleRate);
  let selectedRate: number = dsdPcmOutputSampleRates[0];

  for (const candidate of dsdPcmOutputSampleRates) {
    if (candidate <= targetRate + 0.5) {
      selectedRate = candidate;
    }
  }

  return selectedRate;
};

export const resolveDsdDopTransportSampleRate = (probe: DsdProbeLike): number | null => {
  if (!isDsfFilePath(probe.filePath) && !isDsdCodec(probe.codec)) {
    return null;
  }

  const fileSampleRate = normalizePositiveInteger(probe.fileSampleRate);
  const nativeSampleRate =
    fileSampleRate !== null && fileSampleRate >= dsdSampleRateFloor
      ? fileSampleRate
      : defaultDsdNativeSampleRate;
  const transportRate = nativeSampleRate / dsdDopDecimationFactor;

  return dsdDopTransportSampleRates.some((rate) => Math.abs(rate - transportRate) < 1)
    ? Math.round(transportRate)
    : null;
};

const parseDsfSampleRate = (buffer: Buffer): number | null => {
  if (!bufferStartsWith(buffer, dsfMagic)) {
    return null;
  }

  let offset = 0;
  while (offset + 12 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4);
    const chunkSize = readUInt64LeAsNumber(buffer, offset + 4);

    if (chunkId.equals(dsfFormatChunk) && offset + 32 <= buffer.length) {
      const sampleRate = buffer.readUInt32LE(offset + 28);
      return isLikelyDsdNativeSampleRate(sampleRate) ? sampleRate : null;
    }

    if (!chunkSize || chunkSize < 12) {
      break;
    }

    offset += chunkSize;
  }

  const fmtOffset = buffer.indexOf(dsfFormatChunk);
  if (fmtOffset >= 0 && fmtOffset + 32 <= buffer.length) {
    const sampleRate = buffer.readUInt32LE(fmtOffset + 28);
    return isLikelyDsdNativeSampleRate(sampleRate) ? sampleRate : null;
  }

  return null;
};

const parseDffSampleRate = (buffer: Buffer): number | null => {
  if (!bufferStartsWith(buffer, dffRootMagic) || !bufferStartsWith(buffer, dsfMagic, 12)) {
    return null;
  }

  let offset = 16;
  while (offset + 16 <= buffer.length) {
    if (buffer.subarray(offset, offset + 4).equals(dffSampleRateChunk)) {
      const sampleRate = buffer.readUInt32BE(offset + 12);
      return isLikelyDsdNativeSampleRate(sampleRate) ? sampleRate : null;
    }

    const chunkSize =
      offset + 12 <= buffer.length && buffer.readBigUInt64BE(offset + 4) <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(buffer.readBigUInt64BE(offset + 4))
        : null;
    if (chunkSize === null) {
      break;
    }

    const nextOffset = offset + 12 + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset) {
      break;
    }
    offset = nextOffset;
  }

  const fsOffset = buffer.indexOf(dffSampleRateChunk);
  if (fsOffset >= 0 && fsOffset + 16 <= buffer.length) {
    const sampleRate = buffer.readUInt32BE(fsOffset + 12);
    return isLikelyDsdNativeSampleRate(sampleRate) ? sampleRate : null;
  }

  return null;
};

export const parseDsdNativeSampleRateFromBuffer = (buffer: Buffer): number | null =>
  parseDsfSampleRate(buffer) ?? parseDffSampleRate(buffer);

export const readDsdNativeSampleRate = async (filePath: string): Promise<number | null> => {
  let handle: Awaited<ReturnType<typeof open>> | null = null;

  try {
    handle = await open(filePath, 'r');
    const stats = await handle.stat();
    const bytesToRead = Math.min(Math.max(0, stats.size), dsdHeaderReadBytes);

    if (bytesToRead <= 0) {
      return null;
    }

    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    return parseDsdNativeSampleRateFromBuffer(buffer.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
};
