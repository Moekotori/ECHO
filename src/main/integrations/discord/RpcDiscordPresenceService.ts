import { createRequire } from 'node:module';
import { basename } from 'node:path';
import type { AudioStatus } from '../../../shared/types/audio';
import type { LibraryTrack } from '../../../shared/types/library';
import { getCrashReportService } from '../../diagnostics/CrashReportService';
import { getLibraryService } from '../../library/LibraryService';
import type { DiscordPresenceService, DiscordPresenceStatus, DiscordPresenceTrack } from './DiscordPresenceService';

export const DISCORD_CLIENT_ID = process.env.ECHO_DISCORD_CLIENT_ID || '1487118099298779206';
export const DISCORD_APP_LOGO_IMAGE_KEY =
  process.env.ECHO_DISCORD_APP_LOGO_IMAGE_KEY || 'https://raw.githubusercontent.com/moekotori/echo/main/software.png';

type DiscordActivity = {
  details?: string;
  state?: string;
  startTimestamp?: Date;
  endTimestamp?: Date;
  largeImageKey?: string;
  largeImageText?: string;
  smallImageKey?: string;
  smallImageText?: string;
  instance?: boolean;
};

type DiscordRpcClient = {
  login(options: { clientId: string }): Promise<unknown>;
  setActivity(activity: DiscordActivity): Promise<unknown>;
  clearActivity(): Promise<unknown>;
  destroy?: () => Promise<void> | void;
  on?: (event: string, handler: () => void) => void;
  removeAllListeners?: () => void;
  transport?: {
    socket?: {
      destroyed?: boolean;
      writable?: boolean;
    } | null;
  };
};

type DiscordRpcModule = {
  Client?: new (options: { transport: 'ipc' }) => DiscordRpcClient;
  default?: {
    Client?: new (options: { transport: 'ipc' }) => DiscordRpcClient;
    register?: (clientId: string) => void;
  };
  register?: (clientId: string) => void;
};

type NodeModuleLoader = {
  _load?: (request: string, parent?: unknown, isMain?: boolean) => unknown;
};

type PresenceLogger = {
  info: (message: string, payload?: unknown) => void;
  warn: (message: string, payload?: unknown) => void;
};

type RpcDiscordPresenceServiceOptions = {
  clientId?: string;
  enabled?: boolean;
  logger?: PresenceLogger;
  loadRpcModule?: () => Promise<DiscordRpcModule>;
  now?: () => number;
  getTrack?: (trackId: string) => LibraryTrack | null;
  getNetworkCoverUrl?: (trackId: string) => string | null;
};

const reconnectBackoffMs = 30_000;
const positionUpdateThrottleMs = 15_000;
const terminalStates = new Set<AudioStatus['state']>(['idle', 'stopped', 'ended', 'error']);
const requireFromHere = createRequire(import.meta.url);

const defaultLogger = (): PresenceLogger => ({
  info: (message: string, payload?: unknown): void => {
    getCrashReportService().getLogger()?.info('main', message, payload);
  },
  warn: (message: string, payload?: unknown): void => {
    getCrashReportService().getLogger()?.warn('main', message, payload);
    console.warn(message, payload ?? '');
  },
});

const sanitizeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300);
const isDiscordIpcUnavailableError = (error: string): boolean => {
  const normalized = error.trim().toLowerCase();
  return (
    normalized === 'could not connect' ||
    normalized.includes('could not connect to discord') ||
    normalized.includes('rpc connection timed out') ||
    normalized.includes('ipc connection')
  );
};

export const loadDiscordRpcModule = async (): Promise<DiscordRpcModule> => {
  const moduleLoader = requireFromHere('node:module') as NodeModuleLoader;
  const originalLoad = moduleLoader._load;
  if (typeof originalLoad !== 'function') {
    return import('discord-rpc') as Promise<DiscordRpcModule>;
  }

  moduleLoader._load = function loadWithUserlandPunycode(request: string, parent?: unknown, isMain?: boolean): unknown {
    if (request === 'punycode') {
      return requireFromHere('punycode/');
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return await import('discord-rpc') as DiscordRpcModule;
  } finally {
    moduleLoader._load = originalLoad;
  }
};

const safeText = (value: string | null | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 128) : fallback;
};

const safeNumber = (value: number | null | undefined): number => (Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0);

const publicDiscordCoverImageKey = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === 'https:') {
      return url.toString();
    }

    if (url.protocol === 'echo-image:' && url.hostname === 'remote') {
      const remoteUrl = new URL(decodeURIComponent(url.pathname.replace(/^\/+/u, '')));
      return remoteUrl.protocol === 'https:' ? remoteUrl.toString() : null;
    }
  } catch {
    return null;
  }

  return null;
};

export const createDiscordPresenceTrackFromStatus = (
  status: AudioStatus,
  getTrack: (trackId: string) => LibraryTrack | null = (trackId) => getLibraryService().getTrack(trackId),
  getNetworkCoverUrl: (trackId: string) => string | null = (trackId) => getLibraryService().getBestNetworkCoverUrlForTrack(trackId),
): DiscordPresenceTrack => {
  const track = status.currentTrackId
    ? (() => {
        try {
          return getTrack(status.currentTrackId ?? '');
        } catch {
          return null;
        }
      })()
    : null;

  const fileTitle = status.currentFilePath ? basename(status.currentFilePath) : 'ECHO Next';
  const title = safeText(status.currentTrackTitle || track?.title, fileTitle);
  const artist = safeText(
    status.currentTrackArtist || track?.artist || status.currentTrackAlbumArtist || track?.albumArtist,
    status.currentFilePath ? 'Local file' : 'ECHO Next',
  );
  const durationSeconds = safeNumber(status.durationSeconds || track?.duration);

  const networkCoverImageKey = status.currentTrackId
    ? (() => {
        try {
          return publicDiscordCoverImageKey(getNetworkCoverUrl(status.currentTrackId ?? ''));
        } catch {
          return null;
        }
      })()
    : null;

  return {
    trackId: status.currentTrackId,
    title,
    artist,
    album: status.currentTrackAlbum?.trim() || track?.album?.trim() || null,
    albumArtist: status.currentTrackAlbumArtist?.trim() || track?.albumArtist?.trim() || null,
    coverImageKey: publicDiscordCoverImageKey(status.currentTrackCoverUrl) || publicDiscordCoverImageKey(track?.coverThumb) || networkCoverImageKey,
    durationSeconds,
    positionSeconds: Math.min(safeNumber(status.positionSeconds), durationSeconds || Number.POSITIVE_INFINITY),
    codec: status.codec || track?.codec || null,
    sampleRate: status.fileSampleRate || track?.sampleRate || status.decoderOutputSampleRate || null,
    bitDepth: status.bitDepth || track?.bitDepth || null,
    bitrate: status.bitrate || track?.bitrate || null,
    outputMode: status.outputMode || null,
  };
};

const formatSampleRate = (sampleRate: number | null): string | null => {
  if (!sampleRate) {
    return null;
  }

  return sampleRate >= 1000 ? `${Math.round(sampleRate / 100) / 10} kHz` : `${sampleRate} Hz`;
};

export const formatDiscordSmallImageText = (track: DiscordPresenceTrack): string | undefined => {
  const parts = [
    track.codec?.toUpperCase() ?? null,
    track.bitDepth ? `${track.bitDepth}-bit` : null,
    formatSampleRate(track.sampleRate),
    track.outputMode,
  ].filter(Boolean);

  return parts.length ? parts.join(' / ').slice(0, 128) : undefined;
};

export const createDiscordActivity = (status: AudioStatus, track: DiscordPresenceTrack, now: number): DiscordActivity | null => {
  if (terminalStates.has(status.state)) {
    return null;
  }

  if (status.state === 'loading') {
    return {
      details: 'Loading...',
      state: 'Preparing playback',
      largeImageKey: DISCORD_APP_LOGO_IMAGE_KEY,
      largeImageText: 'ECHO Next',
      instance: false,
    };
  }

  if (status.state === 'paused') {
    return {
      details: track.title,
      state: `Paused \u00b7 ${track.artist}`.slice(0, 128),
      largeImageKey: track.coverImageKey ?? DISCORD_APP_LOGO_IMAGE_KEY,
      largeImageText: track.album || 'ECHO Next',
      smallImageKey: 'paused',
      smallImageText: formatDiscordSmallImageText(track),
      instance: false,
    };
  }

  const activity: DiscordActivity = {
    details: track.title,
    state: track.artist,
    largeImageKey: track.coverImageKey ?? DISCORD_APP_LOGO_IMAGE_KEY,
    largeImageText: track.album || 'ECHO Next',
    smallImageKey: 'playing',
    smallImageText: formatDiscordSmallImageText(track),
    instance: false,
  };

  if (status.state === 'playing' && track.durationSeconds > 0) {
    const positionMs = Math.max(0, Math.min(track.positionSeconds, track.durationSeconds)) * 1000;
    activity.startTimestamp = new Date(now - positionMs);
    activity.endTimestamp = new Date(now + Math.max(0, track.durationSeconds - track.positionSeconds) * 1000);
  }

  return activity;
};

const activityIdentityKey = (status: AudioStatus, track: DiscordPresenceTrack): string =>
  JSON.stringify({
    state: status.state,
    trackId: track.trackId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    coverImageKey: track.coverImageKey,
    durationSeconds: Math.round(track.durationSeconds),
    codec: track.codec,
    sampleRate: track.sampleRate,
    bitDepth: track.bitDepth,
    bitrate: track.bitrate,
    outputMode: track.outputMode,
  });

const activityFullKey = (activity: DiscordActivity): string =>
  JSON.stringify({
    ...activity,
    startTimestamp: activity.startTimestamp?.getTime() ?? null,
    endTimestamp: activity.endTimestamp?.getTime() ?? null,
  });

const isClientIdConfigured = (clientId: string): boolean => clientId.trim().length > 0 && clientId !== 'YOUR_DISCORD_CLIENT_ID';

export class RpcDiscordPresenceService implements DiscordPresenceService {
  private client: DiscordRpcClient | null = null;
  private enabled: boolean;
  private available = true;
  private connected = false;
  private initializing: Promise<void> | null = null;
  private lastError: string | null = null;
  private lastUpdatedAt: string | null = null;
  private lastConnectAttemptAt = 0;
  private lastIdentityKey: string | null = null;
  private lastFullActivityKey: string | null = null;
  private lastPositionUpdateAt = 0;
  private pendingStatus: AudioStatus | null = null;
  private updateInFlight = false;
  private readonly clientId: string;
  private readonly logger: PresenceLogger;
  private readonly loadRpcModule: () => Promise<DiscordRpcModule>;
  private readonly now: () => number;
  private readonly getTrack: (trackId: string) => LibraryTrack | null;
  private readonly getNetworkCoverUrl: (trackId: string) => string | null;

  constructor(options: RpcDiscordPresenceServiceOptions = {}) {
    this.clientId = options.clientId ?? DISCORD_CLIENT_ID;
    this.enabled = options.enabled ?? true;
    this.logger = options.logger ?? defaultLogger();
    this.loadRpcModule = options.loadRpcModule ?? loadDiscordRpcModule;
    this.now = options.now ?? Date.now;
    this.getTrack = options.getTrack ?? ((trackId) => getLibraryService().getTrack(trackId));
    this.getNetworkCoverUrl = options.getNetworkCoverUrl ?? ((trackId) => getLibraryService().getBestNetworkCoverUrlForTrack(trackId));
  }

  async initialize(): Promise<void> {
    if (!this.enabled || this.connected || this.initializing) {
      await this.initializing;
      return;
    }

    const now = this.now();
    if (this.lastConnectAttemptAt && now - this.lastConnectAttemptAt < reconnectBackoffMs) {
      return;
    }

    if (!isClientIdConfigured(this.clientId)) {
      this.available = false;
      this.lastError = 'Discord Client ID is not configured';
      this.lastConnectAttemptAt = now;
      this.logger.warn('[DiscordPresence] Client ID is not configured; Rich Presence is unavailable');
      return;
    }

    this.lastConnectAttemptAt = now;
    this.initializing = this.connect();

    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  async dispose(): Promise<void> {
    this.connected = false;
    this.lastIdentityKey = null;
    this.lastFullActivityKey = null;
    this.lastPositionUpdateAt = 0;
    this.client?.removeAllListeners?.();

    try {
      await this.client?.destroy?.();
    } catch (error) {
      this.lastError = sanitizeError(error);
      this.logger.warn('[DiscordPresence] Failed to dispose RPC client', { error: this.lastError });
    } finally {
      this.client = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      void this.clearActivity();
    } else {
      void this.initialize();
    }
  }

  async updateFromAudioStatus(status: AudioStatus): Promise<void> {
    this.pendingStatus = status;
    if (this.updateInFlight) {
      return;
    }

    this.updateInFlight = true;
    try {
      while (this.pendingStatus) {
        const nextStatus = this.pendingStatus;
        this.pendingStatus = null;
        await this.applyAudioStatusUpdate(nextStatus);
      }
    } finally {
      this.updateInFlight = false;
    }
  }

  private async applyAudioStatusUpdate(status: AudioStatus): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (terminalStates.has(status.state)) {
      await this.clearActivity();
      return;
    }

    await this.initialize();

    if (!this.connected || !this.client) {
      return;
    }

    const track = createDiscordPresenceTrackFromStatus(status, this.getTrack, this.getNetworkCoverUrl);
    const identityKey = activityIdentityKey(status, track);
    const isIdentityChanged = identityKey !== this.lastIdentityKey;
    const shouldRefreshPosition =
      status.state === 'playing' && this.now() - this.lastPositionUpdateAt >= positionUpdateThrottleMs;

    if (!isIdentityChanged && !shouldRefreshPosition) {
      return;
    }

    const activity = createDiscordActivity(status, track, this.now());

    if (!activity) {
      await this.clearActivity();
      return;
    }

    const fullKey = activityFullKey(activity);
    if (fullKey === this.lastFullActivityKey) {
      return;
    }

    try {
      await this.client.setActivity(activity);
      this.lastIdentityKey = identityKey;
      this.lastFullActivityKey = fullKey;
      this.lastUpdatedAt = new Date(this.now()).toISOString();
      if (status.state === 'playing') {
        this.lastPositionUpdateAt = this.now();
      }
    } catch (error) {
      this.lastError = sanitizeError(error);
      this.connected = false;
      this.logger.warn('[DiscordPresence] Failed to set activity', { error: this.lastError });
    }
  }

  async clearActivity(): Promise<void> {
    this.lastIdentityKey = null;
    this.lastFullActivityKey = null;
    this.lastPositionUpdateAt = 0;

    if (!this.client || !this.connected) {
      return;
    }

    try {
      await this.client.clearActivity();
      this.lastUpdatedAt = new Date(this.now()).toISOString();
    } catch (error) {
      this.lastError = sanitizeError(error);
      this.logger.warn('[DiscordPresence] Failed to clear activity', { error: this.lastError });
    }
  }

  getStatus(): DiscordPresenceStatus {
    this.refreshConnectionState();

    return {
      enabled: this.enabled,
      available: this.available,
      connected: this.connected,
      lastError: this.lastError,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }

  private refreshConnectionState(): void {
    if (!this.client || !this.connected) {
      return;
    }

    const socket = this.client.transport?.socket;
    if (socket && (socket.destroyed || socket.writable === false)) {
      this.connected = false;
      this.lastConnectAttemptAt = this.now();
      this.logger.warn('[DiscordPresence] RPC socket is no longer connected');
    }
  }

  private async connect(): Promise<void> {
    try {
      const rpcModule = await this.loadRpcModule();
      const Client = rpcModule.Client ?? rpcModule.default?.Client;
      const register = rpcModule.register ?? rpcModule.default?.register;

      if (!Client) {
        throw new Error('discord-rpc Client export is unavailable');
      }

      register?.(this.clientId);
      const client = new Client({ transport: 'ipc' });
      client.on?.('connected', () => {
        this.connected = true;
        this.lastError = null;
        this.logger.info('[DiscordPresence] RPC connected');
      });
      client.on?.('disconnected', () => {
        this.connected = false;
        this.lastConnectAttemptAt = this.now();
        this.logger.warn('[DiscordPresence] RPC disconnected');
      });

      await client.login({ clientId: this.clientId });
      this.client = client;
      this.connected = true;
      this.available = true;
      this.lastError = null;
      this.logger.info('[DiscordPresence] RPC initialized');
    } catch (error) {
      this.client = null;
      this.connected = false;
      this.available = false;
      this.lastError = sanitizeError(error);
      const log = isDiscordIpcUnavailableError(this.lastError) ? this.logger.info : this.logger.warn;
      log('[DiscordPresence] RPC initialization failed', { error: this.lastError });
    }
  }
}
