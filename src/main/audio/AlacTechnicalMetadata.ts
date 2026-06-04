import { isAlacCodec, isMp4ContainerPath } from './Mp4AudioCodec';

export type TagLibAudioTechnicalMetadata = {
  codec: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  bitrate: number | null;
  channels: number | null;
  durationSeconds: number | null;
};

const normalizePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

const normalizePositiveFloat = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const cleanText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const shouldPreferTagLibForAlacTechnicalFields = (
  filePath: string,
  primaryCodec: unknown,
  tagLibCodec?: unknown,
): boolean =>
  isMp4ContainerPath(filePath) &&
  (isAlacCodec(primaryCodec) || isAlacCodec(tagLibCodec));

export const readTagLibAudioTechnicalMetadata = async (
  filePath: string,
): Promise<TagLibAudioTechnicalMetadata | null> => {
  const taglib = await import('taglib-wasm');
  const metadata = await taglib.readMetadata(filePath);
  const properties = (metadata.properties ?? {}) as Record<string, unknown>;

  return {
    codec: cleanText(properties.codec) ?? cleanText(properties.containerFormat),
    sampleRate: normalizePositiveInteger(properties.sampleRate),
    bitDepth: normalizePositiveInteger(properties.bitsPerSample),
    bitrate: (() => {
      const value = normalizePositiveInteger(properties.bitrate);
      return value ? value * 1000 : null;
    })(),
    channels: normalizePositiveInteger(properties.channels),
    durationSeconds: normalizePositiveFloat(properties.duration),
  };
};
