import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type { AudioStatus } from './audioTypes';
import type { PlaybackProbeHint, PlaybackTrackMetadataHint } from '../../shared/types/playback';

export type PlaybackMemory = {
  filePath: string;
  trackId: string | null;
  positionSeconds: number;
  durationSeconds: number;
  probe?: PlaybackProbeHint;
  metadata?: PlaybackTrackMetadataHint;
  updatedAt: string;
};

const getMemoryPath = (): string => join(app.getPath('userData'), 'echo-playback-memory.json');

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const shouldSkipVolatileStreamMemory = (
  filePath: string,
  trackId: string | null,
  metadata?: PlaybackTrackMetadataHint,
): boolean =>
  isHttpUrl(filePath) && (!trackId || !metadata?.title?.trim());

const finiteNonNegative = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
};

const normalizeProbe = (value: unknown): PlaybackProbeHint | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const probe: PlaybackProbeHint = {};
  const durationSeconds = finiteNonNegative(input.durationSeconds);
  const fileSampleRate = input.fileSampleRate === null ? null : finiteNonNegative(input.fileSampleRate);
  const channels = finiteNonNegative(input.channels);
  const bitDepth = input.bitDepth === null ? null : finiteNonNegative(input.bitDepth);
  const bitrate = input.bitrate === null ? null : finiteNonNegative(input.bitrate);

  if (durationSeconds !== null) {
    probe.durationSeconds = durationSeconds;
  }
  if (fileSampleRate !== null) {
    probe.fileSampleRate = input.fileSampleRate === null ? null : Math.round(fileSampleRate);
  }
  if (channels !== null && channels > 0) {
    probe.channels = Math.max(1, Math.min(8, Math.round(channels)));
  }
  if (typeof input.codec === 'string') {
    probe.codec = input.codec;
  }
  if (bitDepth !== null) {
    probe.bitDepth = input.bitDepth === null ? null : Math.round(bitDepth);
  }
  if (bitrate !== null) {
    probe.bitrate = input.bitrate === null ? null : Math.round(bitrate);
  }

  return Object.keys(probe).length > 0 ? probe : undefined;
};

const optionalText = (value: unknown): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
};

const normalizeMetadata = (value: unknown): PlaybackTrackMetadataHint | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const metadata: PlaybackTrackMetadataHint = {};
  const title = optionalText(input.title);
  const artist = optionalText(input.artist);
  const album = optionalText(input.album);
  const albumArtist = optionalText(input.albumArtist);
  const coverUrl = optionalText(input.coverUrl);
  if (title) metadata.title = title;
  if (artist) metadata.artist = artist;
  if (album) metadata.album = album;
  if (albumArtist) metadata.albumArtist = albumArtist;
  if (coverUrl) metadata.coverUrl = coverUrl;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

const metadataFromStatus = (status: AudioStatus): PlaybackTrackMetadataHint | undefined => {
  const metadata: PlaybackTrackMetadataHint = {};
  if (status.currentTrackTitle?.trim()) metadata.title = status.currentTrackTitle.trim();
  if (status.currentTrackArtist?.trim()) metadata.artist = status.currentTrackArtist.trim();
  if (status.currentTrackAlbum?.trim()) metadata.album = status.currentTrackAlbum.trim();
  if (status.currentTrackAlbumArtist?.trim()) metadata.albumArtist = status.currentTrackAlbumArtist.trim();
  if (status.currentTrackCoverUrl?.trim()) metadata.coverUrl = status.currentTrackCoverUrl.trim();
  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

const normalizeMemory = (value: unknown): PlaybackMemory | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  const filePath = typeof input.filePath === 'string' && input.filePath.trim() ? input.filePath : null;
  const positionSeconds = finiteNonNegative(input.positionSeconds);
  const durationSeconds = finiteNonNegative(input.durationSeconds);

  if (!filePath || positionSeconds === null) {
    return null;
  }

  const trackId = typeof input.trackId === 'string' && input.trackId.trim() ? input.trackId : null;
  const metadata = normalizeMetadata(input.metadata);
  if (shouldSkipVolatileStreamMemory(filePath, trackId, metadata)) {
    return null;
  }

  return {
    filePath,
    trackId,
    positionSeconds,
    durationSeconds: durationSeconds ?? 0,
    probe: normalizeProbe(input.probe),
    metadata,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
  };
};

export class PlaybackMemoryStore {
  load(): PlaybackMemory | null {
    const memoryPath = getMemoryPath();

    if (!existsSync(memoryPath)) {
      return null;
    }

    try {
      return normalizeMemory(JSON.parse(readFileSync(memoryPath, 'utf8')));
    } catch {
      return null;
    }
  }

  save(status: AudioStatus): void {
    const metadata = metadataFromStatus(status);
    if (
      !status.currentFilePath ||
      status.state === 'stopped' ||
      status.state === 'idle' ||
      shouldSkipVolatileStreamMemory(status.currentFilePath, status.currentTrackId, metadata)
    ) {
      this.clear();
      return;
    }

    const memory: PlaybackMemory = {
      filePath: status.currentFilePath,
      trackId: status.currentTrackId,
      positionSeconds: Math.max(0, status.positionSeconds),
      durationSeconds: Math.max(0, status.durationSeconds),
      probe: {
        durationSeconds: Math.max(0, status.durationSeconds),
        fileSampleRate: status.fileSampleRate,
        channels: status.channels ?? undefined,
        codec: status.codec,
        bitDepth: status.bitDepth,
        bitrate: status.bitrate,
      },
      metadata,
      updatedAt: new Date().toISOString(),
    };
    const memoryPath = getMemoryPath();

    mkdirSync(dirname(memoryPath), { recursive: true });
    writeFileSync(memoryPath, `${JSON.stringify(memory, null, 2)}\n`, 'utf8');
  }

  clear(): void {
    const memoryPath = getMemoryPath();

    try {
      if (existsSync(memoryPath)) {
        rmSync(memoryPath);
      }
    } catch {
      // Playback memory is best-effort and should never break playback controls.
    }
  }
}

let defaultPlaybackMemoryStore: PlaybackMemoryStore | null = null;

export const getPlaybackMemoryStore = (): PlaybackMemoryStore => {
  defaultPlaybackMemoryStore ??= new PlaybackMemoryStore();
  return defaultPlaybackMemoryStore;
};
