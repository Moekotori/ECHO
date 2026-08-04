import { basename, extname } from 'node:path';
import { parseBuffer } from 'music-metadata';
import type { StreamingPlaybackSource } from '../../shared/types/streaming';
import { fetchWithNetworkProxy } from '../network/networkFetch';

const metadataReadBytes = 256 * 1024;
const mp3MetadataReadBytes = 256 * 1024;
const probeTimeoutMs = 650;
const probeableCodecs = new Set(['flac', 'mp3', 'mpeg', 'm4a', 'aac', 'alac', 'ogg', 'opus']);
const mimeExtensionHints: Record<string, string> = {
  'audio/flac': '.flac',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
};

type AudioProbeResult = Pick<StreamingPlaybackSource, 'codec' | 'sampleRate' | 'bitDepth' | 'bitrate'>;

const cleanText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const cleanNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const codecExtension = (codec: string | null): string | null => {
  if (!codec) {
    return null;
  }

  const normalized = codec.trim().toLocaleLowerCase();
  if (!normalized || /spotify|tidal|airplay|dlna/u.test(normalized)) {
    return null;
  }
  if (normalized.includes('flac')) {
    return '.flac';
  }
  if (normalized.includes('mpeg') || normalized === 'mp3') {
    return '.mp3';
  }
  if (normalized.includes('alac')) {
    return '.m4a';
  }
  if (normalized.includes('aac') || normalized.includes('mp4a')) {
    return '.m4a';
  }
  if (normalized.includes('opus')) {
    return '.opus';
  }
  if (normalized.includes('vorbis') || normalized.includes('ogg')) {
    return '.ogg';
  }

  return probeableCodecs.has(normalized) ? `.${normalized}` : null;
};

const sourceExtension = (source: StreamingPlaybackSource): string => {
  const codecExt = codecExtension(source.codec);
  if (codecExt) {
    return codecExt;
  }

  const mime = source.mimeType?.split(';', 1)[0]?.trim().toLocaleLowerCase();
  if (mime && mimeExtensionHints[mime]) {
    return mimeExtensionHints[mime];
  }

  try {
    const ext = extname(new URL(source.url).pathname).toLocaleLowerCase();
    return ext || '.audio';
  } catch {
    return '.audio';
  }
};

const shouldProbe = (source: StreamingPlaybackSource): boolean => {
  if (source.sampleRate || !source.url || source.requiresProxy || source.supportsRange === false) {
    return false;
  }
  if (!/^https?:\/\//iu.test(source.url)) {
    return false;
  }

  const ext = sourceExtension(source).slice(1);
  return probeableCodecs.has(ext) || Boolean(source.mimeType?.toLocaleLowerCase().startsWith('audio/'));
};

const fetchMetadataHead = async (source: StreamingPlaybackSource, readBytes: number): Promise<Buffer | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
  timer.unref?.();

  try {
    const response = await fetchWithNetworkProxy(source.url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        ...source.headers,
        Accept: source.mimeType ?? 'audio/*,*/*',
        Range: `bytes=0-${readBytes - 1}`,
      },
    });

    if (!response.ok && response.status !== 206) {
      return null;
    }
    if (response.status !== 206) {
      const length = Number(response.headers.get('content-length') ?? 0);
      if (Number.isFinite(length) && length > readBytes * 2) {
        return null;
      }
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > 0 && buffer.length <= readBytes * 2 ? buffer : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export const readStreamingAudioMetadataFromBuffer = async (
  buffer: Buffer,
  source: Pick<StreamingPlaybackSource, 'codec' | 'mimeType' | 'url'>,
): Promise<AudioProbeResult> => {
  const ext = sourceExtension({
    ...source,
    provider: 'mock',
    providerTrackId: 'probe',
    expiresAt: null,
    bitrate: null,
    sampleRate: null,
    bitDepth: null,
    headers: {},
    requiresProxy: false,
    supportsRange: true,
  });
  const metadata = await parseBuffer(
    buffer,
    {
      mimeType: source.mimeType ?? undefined,
      path: `${basename(new URL(source.url, 'https://streaming.local/').pathname, ext) || 'stream'}${ext}`,
      size: buffer.length,
    },
    { duration: false, skipCovers: true },
  );
  const format = metadata.format;

  return {
    codec: cleanText(format.codec),
    sampleRate: cleanNumber(format.sampleRate),
    bitDepth: cleanNumber(format.bitsPerSample),
    bitrate: cleanNumber(format.bitrate),
  };
};

export const probeStreamingAudioMetadata = async (source: StreamingPlaybackSource): Promise<AudioProbeResult | null> => {
  if (!shouldProbe(source)) {
    return null;
  }

  const ext = sourceExtension(source);
  const readBytes = ext === '.mp3' ? mp3MetadataReadBytes : metadataReadBytes;
  const buffer = await fetchMetadataHead(source, readBytes);
  if (!buffer) {
    return null;
  }

  try {
    return await readStreamingAudioMetadataFromBuffer(buffer, source);
  } catch {
    return null;
  }
};

export const enrichStreamingPlaybackSourceMetadata = async (
  source: StreamingPlaybackSource,
): Promise<StreamingPlaybackSource> => {
  if (process.env.VITEST === 'true') {
    return source;
  }

  const metadata = await probeStreamingAudioMetadata(source);
  if (!metadata) {
    return source;
  }

  return {
    ...source,
    codec: source.codec ?? metadata.codec,
    sampleRate: source.sampleRate ?? metadata.sampleRate,
    bitDepth: source.bitDepth ?? metadata.bitDepth,
    bitrate: source.bitrate ?? metadata.bitrate,
  };
};
