import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import type {
  ConnectDevice,
  ConnectHttpDebugEvent,
  ConnectPlaybackTarget,
  ConnectSessionStatus,
  ConnectStartRequest,
} from '../../shared/types/connect';
import type { HqPlayerConnectionTestResult, HqPlayerRemotePlaybackStatus } from '../../shared/types/hqplayer';
import { hqPlayerConnectDeviceId } from '../../shared/types/connect';
import type { LibraryTrack } from '../../shared/types/library';
import type { PlayableTrack } from '../../shared/types/remoteSources';
import { streamingProviderNames, type StreamingProviderName } from '../../shared/types/streaming';
import { defaultHqPlayerSettings } from '../app/appSettings';
import { getAudioSession } from '../audio/AudioSession';
import { getHqPlayerService, type HqPlayerService } from '../integrations/hqplayer/HqPlayerService';
import { getLibraryService } from '../library/LibraryService';
import type { CoverVariant } from '../library/libraryTypes';
import { buildDlnaDidlLite, createConnectMetadata, protocolInfoForMime } from './ConnectMetadata';
import { chooseLocalAddressForRemote, ConnectHttpServer, mimeTypeForAudioPath } from './ConnectHttpServer';
import {
  discoverDlnaDevices,
  getDlnaPositionInfo,
  getDlnaTransportInfo,
  pauseDlna,
  playDlna,
  seekDlna,
  setDlnaTransportUri,
  setDlnaVolume,
  stopDlna,
  type DlnaDevice,
} from './DlnaClient';

type ConnectEvents = {
  status: [ConnectSessionStatus];
};

type HqPlayerConnectService = Pick<
  HqPlayerService,
  'getSettings' | 'setSettings' | 'getStatus' | 'testConnection' | 'createPlaybackHandoff' | 'sendLastPlaybackControl' | 'seekPlayback' | 'stopPlayback'
>;

type HqPlayerConnectSettings = ReturnType<HqPlayerConnectService['getSettings']>;

type PlaybackSource = {
  track: ConnectPlaybackTarget | LibraryTrack | null;
  trackId: string | null;
  filePath: string;
  streamUrl: string;
  mimeType: string;
  sizeBytes: number | null;
  metadata: ConnectSessionStatus['metadata'];
  metadataXml: string;
  durationSeconds: number;
};

type ConnectCoverAsset = {
  filePath: string;
  mimeType: string | null;
};

const idleStatus = (): ConnectSessionStatus => ({
  deviceId: null,
  protocol: null,
  state: 'idle',
  currentTrackId: null,
  metadata: null,
  positionSeconds: 0,
  durationSeconds: 0,
  latencyMs: null,
  error: null,
  updatedAt: new Date().toISOString(),
  httpEvents: [],
});

const airPlayPlaceholder: ConnectDevice = {
  id: 'airplay:experimental',
  name: 'AirPlay 实验通道',
  protocol: 'airplay',
  model: 'RAOP / AirPlay 2 metadata gate',
  manufacturer: 'Apple ecosystem',
  address: null,
  capabilities: {
    canPlay: false,
    canPause: false,
    canStop: false,
    canSeek: false,
    canSetVolume: false,
    supportsMetadata: false,
    supportsSetNext: false,
    supportedMimeTypes: [],
    requiresTranscode: false,
  },
  state: 'unsupported',
  lastSeenAt: null,
  unsupportedReason: 'AirPlay 需要先完成标题、艺术家、专辑、封面、时长的同步验收；当前不开放静默音频投送。',
};

const hqPlayerDeviceCapabilities: ConnectDevice['capabilities'] = {
  canPlay: false,
  canPause: false,
  canStop: false,
  canSeek: false,
  canSetVolume: false,
  supportsMetadata: true,
  supportsSetNext: false,
  supportedMimeTypes: [],
  requiresTranscode: false,
};

const hqPlayerReasonText = (reason: string | null | undefined): string =>
  reason ? `HQPlayer ${reason}` : 'HQPlayer 发送失败';

const hqPlayerPlaybackConfirmAttempts = 4;
const hqPlayerPlaybackConfirmDelayMs = 250;
const hqPlayerStatusSyncIntervalMs = 2500;
const hqPlayerEndedGraceSeconds = 5;
const dlnaStatusSyncIntervalMs = 3000;
const dlnaDeviceRetentionMs = 10 * 60 * 1000;
const dlnaDeviceMissedScanReason = '本次扫描未响应，可能已离线或被局域网暂时漏报。';

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const isHttpUrl = (value: string): boolean => /^https?:\/\//iu.test(value);

const positiveNumberOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const compatibleCoverMimeTypes = new Set(['image/jpeg', 'image/png']);
const mimeAliases: Record<string, string[]> = {
  'audio/flac': ['application/flac', 'audio/x-flac'],
  'application/flac': ['audio/flac', 'audio/x-flac'],
};

const formatSeekTarget = (positionSeconds: number): string => {
  const safe = Math.max(0, Math.floor(positionSeconds));
  const hours = Math.floor(safe / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((safe % 3600) / 60).toString().padStart(2, '0');
  const seconds = Math.floor(safe % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const toPlaybackTarget = (value: unknown): ConnectPlaybackTarget | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<ConnectPlaybackTarget>;
  if (typeof input.id !== 'string' || typeof input.path !== 'string') {
    return null;
  }

  return {
    id: input.id,
    path: input.path,
    mediaType: input.mediaType === 'remote' || input.mediaType === 'streaming' ? input.mediaType : 'local',
    title: typeof input.title === 'string' ? input.title : '',
    artist: typeof input.artist === 'string' ? input.artist : '',
    album: typeof input.album === 'string' ? input.album : '',
    albumArtist: typeof input.albumArtist === 'string' ? input.albumArtist : '',
    duration: typeof input.duration === 'number' && Number.isFinite(input.duration) ? input.duration : 0,
    codec: typeof input.codec === 'string' ? input.codec : null,
    coverId: typeof input.coverId === 'string' ? input.coverId : null,
    coverThumb: typeof input.coverThumb === 'string' ? input.coverThumb : null,
    sourceUrl: typeof input.sourceUrl === 'string' ? input.sourceUrl : null,
  };
};

export const normalizeConnectStartRequest = (value: unknown): ConnectStartRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('connect request must be an object');
  }

  const input = value as Record<string, unknown>;
  if (typeof input.deviceId !== 'string' || !input.deviceId.trim()) {
    throw new Error('deviceId must be a non-empty string');
  }

  const positionSeconds = Number(input.positionSeconds);
  return {
    deviceId: input.deviceId.trim(),
    track: toPlaybackTarget(input.track),
    filePath: typeof input.filePath === 'string' && input.filePath.trim() ? input.filePath.trim() : null,
    positionSeconds: Number.isFinite(positionSeconds) && positionSeconds > 0 ? positionSeconds : undefined,
  };
};

export class ConnectService extends EventEmitter<ConnectEvents> {
  private readonly httpServer = new ConnectHttpServer();
  private readonly devices = new Map<string, DlnaDevice>();
  private session: ConnectSessionStatus = idleStatus();
  private refreshInFlight: Promise<ConnectDevice[]> | null = null;
  private hqPlayerStatusTimer: ReturnType<typeof setInterval> | null = null;
  private hqPlayerStatusSyncInFlight = false;
  private dlnaStatusTimer: ReturnType<typeof setInterval> | null = null;
  private dlnaStatusSyncInFlight = false;
  private readonly unsubscribeHttpEvents: () => void;

  constructor(private readonly hqPlayerService: HqPlayerConnectService = getHqPlayerService()) {
    super();
    this.unsubscribeHttpEvents = this.httpServer.onRequestEvent((event) => this.handleHttpDebugEvent(event));
  }

  listDevices(): ConnectDevice[] {
    return [...Array.from(this.devices.values(), (device) => this.publicDevice(device)), this.hqPlayerDevice(), airPlayPlaceholder];
  }

  getStatus(): ConnectSessionStatus {
    return this.withInterpolatedPosition(this.session);
  }

  async refreshDevices(): Promise<ConnectDevice[]> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    const previous = this.session;
    if (previous.state === 'idle' || previous.state === 'error' || previous.state === 'unsupported') {
      this.setSession({ ...previous, state: 'discovering', error: null });
    }

    this.refreshInFlight = discoverDlnaDevices()
      .then((devices) => {
        this.mergeDiscoveredDlnaDevices(devices);
        if (this.session.state === 'discovering') {
          this.setSession(idleStatus());
        }
        return this.listDevices();
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.setSession({ ...idleStatus(), state: 'error', error: message });
        return this.listDevices();
      })
      .finally(() => {
        this.refreshInFlight = null;
      });

    return this.refreshInFlight;
  }

  async connect(request: ConnectStartRequest): Promise<ConnectSessionStatus> {
    if (request.deviceId === hqPlayerConnectDeviceId) {
      return this.connectHqPlayer(request);
    }

    this.stopHqPlayerStatusSync();
    this.stopDlnaStatusSync();
    if (request.deviceId === airPlayPlaceholder.id) {
      const status: ConnectSessionStatus = {
        ...idleStatus(),
        deviceId: request.deviceId,
        protocol: 'airplay',
        state: 'unsupported',
        error: airPlayPlaceholder.unsupportedReason,
      };
      this.setSession(status);
      return status;
    }

    const device = this.devices.get(request.deviceId) ?? (await this.refreshAndFindDevice(request.deviceId));
    if (!device) {
      throw new Error('找不到这个 Connect 设备，请刷新后重试。');
    }

    const startedAt = Date.now();
    this.setSession({
      ...this.session,
      deviceId: device.id,
      protocol: 'dlna',
      state: 'connecting',
      error: null,
      updatedAt: new Date().toISOString(),
      httpEvents: [],
    });

    try {
      const source = await this.createPlaybackSource(device, request);
      await setDlnaTransportUri(device, source.streamUrl, source.metadataXml);
      if (request.positionSeconds && request.positionSeconds > 0) {
        await seekDlna(device, formatSeekTarget(request.positionSeconds)).catch(() => undefined);
      }
      await playDlna(device);
      const status = getAudioSession().getStatus();
      if (status.state === 'playing' || status.state === 'loading') {
        await getAudioSession().pause().catch(() => undefined);
      }

      this.setSession({
        deviceId: device.id,
        protocol: 'dlna',
        state: 'playing',
        currentTrackId: source.trackId,
        metadata: source.metadata,
        positionSeconds: request.positionSeconds ?? 0,
        durationSeconds: source.durationSeconds,
        latencyMs: Date.now() - startedAt,
        error: null,
        updatedAt: new Date().toISOString(),
      });
      this.startDlnaStatusSync();
      return this.getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setSession({
        ...this.session,
        deviceId: device.id,
        protocol: 'dlna',
        state: 'error',
        error: message,
        latencyMs: Date.now() - startedAt,
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async disconnect(): Promise<ConnectSessionStatus> {
    this.stopHqPlayerStatusSync();
    this.stopDlnaStatusSync();
    if (this.session.protocol === 'hqplayer' && this.session.deviceId === hqPlayerConnectDeviceId) {
      await this.hqPlayerService.stopPlayback().catch(() => undefined);
    }

    const activeDevice = this.activeDlnaDevice();
    if (activeDevice) {
      await stopDlna(activeDevice).catch(() => undefined);
    }

    this.setSession(idleStatus());
    return this.session;
  }

  async play(): Promise<ConnectSessionStatus> {
    const device = this.requireActiveDlnaDevice();
    await playDlna(device);
    this.startDlnaStatusSync();
    this.setSession({ ...this.getStatus(), state: 'playing', error: null, updatedAt: new Date().toISOString() });
    return this.getStatus();
  }

  async pause(): Promise<ConnectSessionStatus> {
    const device = this.requireActiveDlnaDevice();
    await pauseDlna(device);
    this.setSession({ ...this.getStatus(), state: 'paused', error: null, updatedAt: new Date().toISOString() });
    return this.getStatus();
  }

  async stop(): Promise<ConnectSessionStatus> {
    if (this.session.protocol === 'hqplayer' && this.session.deviceId === hqPlayerConnectDeviceId) {
      const send = await this.hqPlayerService.stopPlayback();
      if (send.state !== 'sent') {
        throw new Error(send.message ?? hqPlayerReasonText(send.reason));
      }

      this.stopHqPlayerStatusSync();
      this.setSession({ ...this.getStatus(), state: 'stopped', positionSeconds: 0, error: null, updatedAt: new Date().toISOString() });
      return this.getStatus();
    }

    const device = this.requireActiveDlnaDevice();
    await stopDlna(device);
    this.stopDlnaStatusSync();
    this.setSession({ ...this.getStatus(), state: 'stopped', positionSeconds: 0, error: null, updatedAt: new Date().toISOString() });
    return this.getStatus();
  }

  async seek(positionSeconds: number): Promise<ConnectSessionStatus> {
    if (this.session.protocol === 'hqplayer' && this.session.deviceId === hqPlayerConnectDeviceId) {
      const safePosition = Math.max(0, positionSeconds);
      const send = await this.hqPlayerService.seekPlayback(safePosition);
      if (send.state !== 'sent') {
        throw new Error(send.message ?? hqPlayerReasonText(send.reason));
      }

      this.setSession({ ...this.session, positionSeconds: safePosition, error: null, updatedAt: new Date().toISOString() });
      void this.syncHqPlayerSessionStatus();
      return this.getStatus();
    }

    const device = this.requireActiveDlnaDevice();
    const safePosition = Math.max(0, positionSeconds);
    await seekDlna(device, formatSeekTarget(safePosition));
    this.setSession({ ...this.session, positionSeconds: safePosition, error: null, updatedAt: new Date().toISOString() });
    return this.getStatus();
  }

  async setVolume(volume: number): Promise<ConnectSessionStatus> {
    const device = this.requireActiveDlnaDevice();
    await setDlnaVolume(device, volume);
    this.setSession({ ...this.getStatus(), error: null, updatedAt: new Date().toISOString() });
    return this.getStatus();
  }

  async dispose(): Promise<void> {
    this.unsubscribeHttpEvents();
    this.stopHqPlayerStatusSync();
    this.stopDlnaStatusSync();
    await this.disconnect().catch(() => undefined);
    await this.httpServer.close();
    this.devices.clear();
  }

  private setSession(status: ConnectSessionStatus): void {
    const shouldKeepHttpEvents =
      status.httpEvents === undefined &&
      status.protocol === 'dlna' &&
      status.deviceId !== null &&
      status.deviceId === this.session.deviceId;
    this.session = {
      ...status,
      httpEvents: shouldKeepHttpEvents ? this.session.httpEvents ?? [] : status.httpEvents ?? [],
      updatedAt: status.updatedAt || new Date().toISOString(),
    };
    this.emit('status', this.getStatus());
  }

  private handleHttpDebugEvent(event: ConnectHttpDebugEvent): void {
    if (this.session.protocol !== 'dlna' || !this.session.deviceId) {
      return;
    }

    this.setSession({
      ...this.session,
      httpEvents: [event, ...(this.session.httpEvents ?? [])].slice(0, 24),
      updatedAt: new Date().toISOString(),
    });
  }

  private publicDevice(device: DlnaDevice): ConnectDevice {
    const { id, name, protocol, model, manufacturer, address, capabilities, state, lastSeenAt, unsupportedReason, discovery } = device;
    return { id, name, protocol, model, manufacturer, address, capabilities, state, lastSeenAt, unsupportedReason, discovery };
  }

  private mergeDiscoveredDlnaDevices(discoveredDevices: DlnaDevice[], now = Date.now()): void {
    const nextDevices = new Map<string, DlnaDevice>();
    for (const device of discoveredDevices) {
      nextDevices.set(device.id, {
        ...device,
        state: 'available',
        unsupportedReason: null,
        lastSeenAt: device.lastSeenAt ?? new Date(now).toISOString(),
      });
    }

    for (const previous of this.devices.values()) {
      if (nextDevices.has(previous.id)) {
        continue;
      }

      const lastSeenMs = Date.parse(previous.lastSeenAt ?? '');
      const recentlySeen = Number.isFinite(lastSeenMs) && now - lastSeenMs <= dlnaDeviceRetentionMs;
      const activeDevice = this.session.protocol === 'dlna' && this.session.deviceId === previous.id;
      if (!recentlySeen && !activeDevice) {
        continue;
      }

      nextDevices.set(previous.id, {
        ...previous,
        state: 'unavailable',
        unsupportedReason: dlnaDeviceMissedScanReason,
      });
    }

    this.devices.clear();
    for (const [id, device] of nextDevices) {
      this.devices.set(id, device);
    }
  }

  private hqPlayerDevice(): ConnectDevice {
    const status = this.hqPlayerService.getStatus();
    const controlInfo = status.controlInfo ?? null;
    const isActive = this.session.protocol === 'hqplayer' && this.session.deviceId === hqPlayerConnectDeviceId;
    const model = controlInfo?.product
      ? [controlInfo.product, controlInfo.version].filter(Boolean).join(' ')
      : 'Local Desktop Control';
    const state: ConnectDevice['state'] = isActive && this.session.state !== 'error'
      ? 'connected'
      : status.state === 'checking'
        ? 'connecting'
        : status.state === 'available'
          ? 'available'
          : 'unavailable';
    return {
      id: hqPlayerConnectDeviceId,
      name: 'HQPlayer Desktop',
      protocol: 'hqplayer',
      model,
      manufacturer: 'Signalyst',
      address: `${status.endpoint.host}:${status.endpoint.port ?? defaultHqPlayerSettings.port}`,
      capabilities: hqPlayerDeviceCapabilities,
      state,
      lastSeenAt: controlInfo?.receivedAt ?? status.playbackStatus?.receivedAt ?? status.lastCheckedAt,
      unsupportedReason: status.lastError,
    };
  }

  private async refreshAndFindDevice(deviceId: string): Promise<DlnaDevice | null> {
    await this.refreshDevices();
    return this.devices.get(deviceId) ?? null;
  }

  private activeDlnaDevice(): DlnaDevice | null {
    if (this.session.protocol !== 'dlna' || !this.session.deviceId) {
      return null;
    }

    return this.devices.get(this.session.deviceId) ?? null;
  }

  private requireActiveDlnaDevice(): DlnaDevice {
    const device = this.activeDlnaDevice();
    if (!device) {
      throw new Error('当前没有已连接的 DLNA 设备。');
    }
    return device;
  }

  private withInterpolatedPosition(status: ConnectSessionStatus): ConnectSessionStatus {
    if ((status.protocol !== 'dlna' && status.protocol !== 'hqplayer') || status.state !== 'playing' || status.durationSeconds <= 0) {
      return status;
    }

    const updatedAtMs = Date.parse(status.updatedAt);
    if (!Number.isFinite(updatedAtMs)) {
      return status;
    }

    const elapsedSeconds = Math.max(0, (Date.now() - updatedAtMs) / 1000);
    return {
      ...status,
      positionSeconds: Math.min(status.durationSeconds, status.positionSeconds + elapsedSeconds),
    };
  }

  private shouldPreserveHqPlayerNaturalEndPosition(
    playbackStatus: HqPlayerRemotePlaybackStatus,
    previous: ConnectSessionStatus,
    durationSeconds: number,
  ): boolean {
    if (playbackStatus.state !== 'stopped' && playbackStatus.state !== 'stop-requested') {
      return false;
    }

    if (
      previous.protocol !== 'hqplayer' ||
      previous.deviceId !== hqPlayerConnectDeviceId ||
      previous.state !== 'playing' ||
      durationSeconds <= 0
    ) {
      return false;
    }

    const previousAtTail = previous.positionSeconds >= Math.max(0, durationSeconds - hqPlayerEndedGraceSeconds);
    if (!previousAtTail) {
      return false;
    }

    const reportedPosition = playbackStatus.positionSeconds;
    return reportedPosition == null || reportedPosition <= 1 || reportedPosition < previous.positionSeconds - 1;
  }

  private shouldCompleteHqPlayerFromClock(previous: ConnectSessionStatus): boolean {
    return (
      previous.protocol === 'hqplayer' &&
      previous.deviceId === hqPlayerConnectDeviceId &&
      previous.state === 'playing' &&
      previous.durationSeconds > 0 &&
      previous.positionSeconds >= previous.durationSeconds
    );
  }

  private shouldKeepHqPlayerClockPosition(
    playbackStatus: HqPlayerRemotePlaybackStatus,
    previous: ConnectSessionStatus,
    durationSeconds: number,
  ): boolean {
    if (playbackStatus.state !== 'playing') {
      return false;
    }

    if (
      previous.protocol !== 'hqplayer' ||
      previous.deviceId !== hqPlayerConnectDeviceId ||
      previous.state !== 'playing' ||
      durationSeconds <= 0 ||
      previous.positionSeconds <= 3
    ) {
      return false;
    }

    const reportedPosition = playbackStatus.positionSeconds;
    return reportedPosition != null && reportedPosition <= 1;
  }

  private resolveHqPlayerPositionSeconds(
    playbackStatus: HqPlayerRemotePlaybackStatus,
    previous: ConnectSessionStatus,
    durationSeconds: number,
  ): number {
    if (this.shouldPreserveHqPlayerNaturalEndPosition(playbackStatus, previous, durationSeconds)) {
      return durationSeconds;
    }

    if (this.shouldKeepHqPlayerClockPosition(playbackStatus, previous, durationSeconds)) {
      return previous.positionSeconds;
    }

    return playbackStatus.positionSeconds ?? previous.positionSeconds;
  }

  private resolveCoverAsset(coverId: string | null | undefined): ConnectCoverAsset | null {
    if (!coverId) {
      return null;
    }

    const variants: CoverVariant[] = ['original', 'large', 'album', 'thumb'];
    const candidates: ConnectCoverAsset[] = [];
    for (const variant of variants) {
      const asset = getLibraryService().resolveCoverAsset(coverId, variant);
      if (asset?.filePath && existsSync(asset.filePath)) {
        candidates.push(asset);
      }
    }

    return candidates.find((asset) => compatibleCoverMimeTypes.has((asset.mimeType ?? '').toLowerCase())) ?? candidates[0] ?? null;
  }

  private async createCoverHttpUrl(track: ConnectPlaybackTarget | LibraryTrack | null, host: string): Promise<string> {
    const asset = this.resolveCoverAsset(track?.coverId ?? null);
    if (!asset && track?.coverThumb && isHttpUrl(track.coverThumb)) {
      return this.httpServer.createRemoteCoverUrl(track.coverThumb, { host });
    }

    return this.httpServer.createCoverUrl(asset?.filePath ?? null, {
      host,
      forceJpegCover: true,
      mimeType: asset?.mimeType ?? null,
    });
  }

  private getTrackFromStatus(request: ConnectStartRequest): ConnectPlaybackTarget | LibraryTrack | null {
    if (request.track) {
      return request.track;
    }

    const status = getAudioSession().getStatus();
    if (!status.currentTrackId) {
      return null;
    }

    try {
      return getLibraryService().getTrack(status.currentTrackId);
    } catch {
      return null;
    }
  }

  private getRichTrack(request: ConnectStartRequest): ConnectPlaybackTarget | LibraryTrack | null {
    const track = this.getTrackFromStatus(request);
    if (!track) {
      return null;
    }

    try {
      return getLibraryService().getTrack(track.id) ?? track;
    } catch {
      return track;
    }
  }

  private createHqPlayerPlayableTrack(request: ConnectStartRequest): PlayableTrack {
    const track = this.getRichTrack(request);
    const status = getAudioSession().getStatus();
    const filePath = request.filePath ?? track?.path ?? status.currentFilePath;
    if (!track || !filePath) {
      throw new Error('没有可交给 HQPlayer 的当前音频。请先播放或选中一首歌。');
    }

    const common = {
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.albumArtist,
      duration: track.duration,
      coverThumb: track.coverThumb,
    };
    const mediaType = track.mediaType ?? 'local';

    if (mediaType === 'remote') {
      const remoteTrack = track as Partial<LibraryTrack>;
      return {
        ...common,
        mediaType: 'remote',
        sourceId: remoteTrack.sourceId ?? null,
        stableKey: remoteTrack.stableKey ?? null,
        remotePath: remoteTrack.remotePath ?? filePath,
      };
    }

    if (mediaType === 'streaming') {
      const streamingTrack = track as Partial<LibraryTrack>;
      const provider = typeof streamingTrack.provider === 'string' && streamingProviderNames.includes(streamingTrack.provider as StreamingProviderName)
        ? streamingTrack.provider as StreamingProviderName
        : null;
      if (!provider || !streamingTrack.providerTrackId || !streamingTrack.stableKey) {
        throw new Error('当前串流曲目缺少 HQPlayer 交接信息。');
      }

      return {
        ...common,
        mediaType: 'streaming',
        provider,
        providerTrackId: streamingTrack.providerTrackId,
        quality: streamingTrack.streamingQuality,
        stableKey: streamingTrack.stableKey,
        playable: true,
        unavailableReason: null,
      };
    }

    return {
      ...common,
      mediaType: 'local',
      path: filePath,
    };
  }

  private mapHqPlayerPlaybackState(status: HqPlayerRemotePlaybackStatus | null | undefined): ConnectSessionStatus['state'] {
    switch (status?.state) {
      case 'playing':
        return 'playing';
      case 'paused':
        return 'paused';
      case 'stopped':
      case 'stop-requested':
        return 'stopped';
      case 'unknown':
      default:
        return this.session.state === 'playing' || this.session.state === 'paused' ? this.session.state : 'ready';
    }
  }

  private mapDlnaTransportState(state: string | null | undefined): ConnectSessionStatus['state'] | null {
    switch (state?.toUpperCase()) {
      case 'PLAYING':
      case 'TRANSITIONING':
        return 'playing';
      case 'PAUSED_PLAYBACK':
      case 'PAUSED_RECORDING':
        return 'paused';
      case 'STOPPED':
      case 'NO_MEDIA_PRESENT':
        return 'stopped';
      default:
        return null;
    }
  }

  private createHqPlayerMetadata(item: PlayableTrack): ConnectSessionStatus['metadata'] {
    return {
      title: item.title,
      artist: item.artist,
      album: item.album,
      albumArtist: item.albumArtist ?? null,
      durationSeconds: item.duration ?? 0,
      coverHttpUrl: item.coverThumb ?? '',
    };
  }

  private async waitForHqPlayerPlayback(
    settings: HqPlayerConnectSettings,
  ): Promise<HqPlayerConnectionTestResult> {
    let latest: HqPlayerConnectionTestResult | null = null;
    for (let attempt = 0; attempt < hqPlayerPlaybackConfirmAttempts; attempt += 1) {
      latest = await this.hqPlayerService.testConnection(settings);
      if (!latest.ok) {
        throw new Error(latest.error ?? 'HQPlayer 连接失败');
      }

      if (latest.playbackStatus?.state === 'playing') {
        return latest;
      }

      if (attempt < hqPlayerPlaybackConfirmAttempts - 1) {
        await delay(hqPlayerPlaybackConfirmDelayMs);
      }
    }

    const remoteState = latest?.playbackStatus?.state ?? 'no_status';
    throw new Error(`HQPlayer 未确认播放：${remoteState}`);
  }

  private async releaseEchoPlaybackBeforeHqPlayerControl(settings: HqPlayerConnectSettings): Promise<void> {
    const audioSession = getAudioSession();
    const audioStatus = audioSession.getStatus();
    if (audioStatus.state !== 'playing' && audioStatus.state !== 'loading') {
      return;
    }

    if (settings.connectionMode === 'localDesktop') {
      try {
        audioSession.stop();
      } catch {
        // Best-effort release before handing the local audio device to HQPlayer.
      }
      return;
    }

    await audioSession.pause().catch(() => undefined);
  }

  private startHqPlayerStatusSync(): void {
    if (this.hqPlayerStatusTimer) {
      return;
    }

    this.hqPlayerStatusTimer = setInterval(() => {
      void this.syncHqPlayerSessionStatus();
    }, hqPlayerStatusSyncIntervalMs);
    (this.hqPlayerStatusTimer as { unref?: () => void }).unref?.();
  }

  private stopHqPlayerStatusSync(): void {
    if (!this.hqPlayerStatusTimer) {
      return;
    }

    clearInterval(this.hqPlayerStatusTimer);
    this.hqPlayerStatusTimer = null;
    this.hqPlayerStatusSyncInFlight = false;
  }

  private startDlnaStatusSync(): void {
    if (this.dlnaStatusTimer) {
      return;
    }

    this.dlnaStatusTimer = setInterval(() => {
      void this.syncDlnaSessionStatus();
    }, dlnaStatusSyncIntervalMs);
    (this.dlnaStatusTimer as { unref?: () => void }).unref?.();
  }

  private stopDlnaStatusSync(): void {
    if (!this.dlnaStatusTimer) {
      return;
    }

    clearInterval(this.dlnaStatusTimer);
    this.dlnaStatusTimer = null;
    this.dlnaStatusSyncInFlight = false;
  }

  private async syncDlnaSessionStatus(): Promise<void> {
    if (this.dlnaStatusSyncInFlight || this.session.protocol !== 'dlna' || !this.session.deviceId) {
      return;
    }

    const device = this.activeDlnaDevice();
    if (!device) {
      return;
    }

    this.dlnaStatusSyncInFlight = true;
    try {
      const previous = this.withInterpolatedPosition(this.session);
      const [transportResult, positionResult] = await Promise.allSettled([
        getDlnaTransportInfo(device),
        getDlnaPositionInfo(device),
      ]);
      if (transportResult.status === 'rejected' && positionResult.status === 'rejected') {
        return;
      }

      if (this.session.protocol !== 'dlna' || this.session.deviceId !== device.id) {
        return;
      }

      const transportState = transportResult.status === 'fulfilled'
        ? this.mapDlnaTransportState(transportResult.value.state)
        : null;
      const position = positionResult.status === 'fulfilled' ? positionResult.value : null;
      const nextState = transportState ?? previous.state;
      this.setSession({
        ...previous,
        state: nextState,
        positionSeconds: position?.positionSeconds ?? previous.positionSeconds,
        durationSeconds: position?.durationSeconds ?? previous.durationSeconds,
        error: null,
        updatedAt: new Date().toISOString(),
      });
      if (nextState === 'stopped') {
        this.stopDlnaStatusSync();
      }
    } finally {
      this.dlnaStatusSyncInFlight = false;
    }
  }

  private async syncHqPlayerSessionStatus(): Promise<void> {
    if (
      this.hqPlayerStatusSyncInFlight ||
      this.session.protocol !== 'hqplayer' ||
      this.session.deviceId !== hqPlayerConnectDeviceId
    ) {
      return;
    }

    this.hqPlayerStatusSyncInFlight = true;
    try {
      const previous = this.withInterpolatedPosition(this.session);
      const result = await this.hqPlayerService.testConnection();
      if (this.session.protocol !== 'hqplayer' || this.session.deviceId !== hqPlayerConnectDeviceId) {
        return;
      }

      if (!result.ok) {
        this.setSession({
          ...this.session,
          state: 'error',
          error: result.error ?? 'HQPlayer 连接失败',
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      const playbackStatus = result.playbackStatus ?? null;
      if (!playbackStatus) {
        if (this.shouldCompleteHqPlayerFromClock(previous)) {
          this.setSession({
            ...previous,
            state: 'stopped',
            positionSeconds: previous.durationSeconds,
            error: null,
            updatedAt: new Date().toISOString(),
          });
        }
        return;
      }

      const durationSeconds = positiveNumberOrNull(playbackStatus.durationSeconds) ?? previous.durationSeconds;
      const positionSeconds = this.resolveHqPlayerPositionSeconds(playbackStatus, previous, durationSeconds);

      this.setSession({
        ...previous,
        state: this.mapHqPlayerPlaybackState(playbackStatus),
        positionSeconds,
        durationSeconds,
        error: null,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      this.hqPlayerStatusSyncInFlight = false;
    }
  }

  private async connectHqPlayer(request: ConnectStartRequest): Promise<ConnectSessionStatus> {
    const startedAt = Date.now();
    const item = this.createHqPlayerPlayableTrack(request);
    this.stopHqPlayerStatusSync();
    this.stopDlnaStatusSync();
    this.setSession({
      ...this.session,
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'connecting',
      error: null,
      updatedAt: new Date().toISOString(),
    });

    try {
      const currentSettings = this.hqPlayerService.getSettings();
      const settings = currentSettings.enabled
        ? currentSettings
        : this.hqPlayerService.setSettings({ ...currentSettings, enabled: true });
      const connection = await this.hqPlayerService.testConnection(settings);
      if (!connection.ok) {
        throw new Error(connection.error ?? 'HQPlayer 连接失败');
      }

      const handoff = await this.hqPlayerService.createPlaybackHandoff({
        item,
        startSeconds: request.positionSeconds ?? 0,
        confirmed: true,
      });
      if (handoff.state !== 'ready' || handoff.control.state !== 'prepared') {
        throw new Error(hqPlayerReasonText(handoff.reason));
      }

      await this.releaseEchoPlaybackBeforeHqPlayerControl(settings);
      const send = await this.hqPlayerService.sendLastPlaybackControl();
      if (send.state !== 'sent') {
        throw new Error(send.message ?? hqPlayerReasonText(send.reason));
      }

      const confirmed = await this.waitForHqPlayerPlayback(settings);
      const playbackStatus = confirmed.playbackStatus ?? null;

      this.setSession({
        deviceId: hqPlayerConnectDeviceId,
        protocol: 'hqplayer',
        state: 'playing',
        currentTrackId: item.trackId,
        metadata: this.createHqPlayerMetadata(item),
        positionSeconds: playbackStatus?.positionSeconds ?? request.positionSeconds ?? 0,
        durationSeconds: positiveNumberOrNull(playbackStatus?.durationSeconds) ?? item.duration ?? 0,
        latencyMs: Date.now() - startedAt,
        error: null,
        updatedAt: new Date().toISOString(),
      });
      this.startHqPlayerStatusSync();
      return this.getStatus();
    } catch (error) {
      this.stopHqPlayerStatusSync();
      const message = error instanceof Error ? error.message : String(error);
      this.setSession({
        ...this.session,
        deviceId: hqPlayerConnectDeviceId,
        protocol: 'hqplayer',
        state: 'error',
        error: message,
        latencyMs: Date.now() - startedAt,
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  private supportsMimeType(device: DlnaDevice, mimeType: string): boolean {
    return this.selectDeviceMimeType(device, mimeType) !== null;
  }

  private selectDeviceMimeType(device: DlnaDevice, mimeType: string): string | null {
    const supported = device.capabilities.supportedMimeTypes;
    if (supported.length === 0) {
      return mimeType;
    }

    const lower = mimeType.toLowerCase();
    const compatible = new Set([lower, ...(mimeAliases[lower] ?? [])]);
    for (const candidate of supported) {
      const normalized = candidate.toLowerCase();
      if (normalized === '*/*' || (normalized.endsWith('/*') && lower.startsWith(normalized.slice(0, -1)))) {
        return mimeType;
      }
      if (compatible.has(normalized)) {
        return normalized;
      }
    }

    return null;
  }

  private async createPlaybackSource(device: DlnaDevice, request: ConnectStartRequest): Promise<PlaybackSource> {
    const status = getAudioSession().getStatus();
    const track = this.getTrackFromStatus(request);
    const sourceUrl = track && 'sourceUrl' in track && typeof track.sourceUrl === 'string' ? track.sourceUrl : null;
    const remotePath = track && 'remotePath' in track && typeof track.remotePath === 'string' ? track.remotePath : null;
    const filePath = request.filePath ?? sourceUrl ?? remotePath ?? track?.path ?? status.currentFilePath;

    if (!filePath) {
      throw new Error('没有可投送的当前音频。请先播放或选中一首歌。');
    }

    const host = chooseLocalAddressForRemote(device.address);
    const coverHttpUrl = await this.createCoverHttpUrl(track, host);
    const metadata = createConnectMetadata({ track, status, coverHttpUrl });
    let streamUrl = filePath;
    let mimeType = mimeTypeForAudioPath(filePath);
    let sizeBytes: number | null = null;

    if (isHttpUrl(filePath)) {
      const deviceMimeType = this.selectDeviceMimeType(device, mimeType);
      if (deviceMimeType) {
        const direct = await this.httpServer.createRemoteAudioUrl(filePath, { host, audioMimeType: deviceMimeType });
        streamUrl = direct.url;
        mimeType = direct.mimeType;
        sizeBytes = direct.sizeBytes;
      } else {
        const transcoded = await this.httpServer.createTranscodeUrl(filePath, { host });
        streamUrl = transcoded.url;
        mimeType = transcoded.mimeType;
        sizeBytes = transcoded.sizeBytes;
      }
    } else {
      if (!existsSync(filePath)) {
        throw new Error(`投送文件不存在：${filePath}`);
      }

      const deviceMimeType = this.selectDeviceMimeType(device, mimeType);
      if (deviceMimeType) {
        const direct = await this.httpServer.createAudioUrl(filePath, { host, audioMimeType: deviceMimeType });
        streamUrl = direct.url;
        mimeType = direct.mimeType;
        sizeBytes = direct.sizeBytes;
      } else {
        const transcoded = await this.httpServer.createTranscodeUrl(filePath, { host });
        streamUrl = transcoded.url;
        mimeType = transcoded.mimeType;
        sizeBytes = transcoded.sizeBytes;
      }
    }

    const metadataXml = buildDlnaDidlLite({
      id: track?.id ?? status.currentTrackId ?? filePath,
      streamUrl,
      metadata,
      mimeType,
      sizeBytes,
    });

    if (!metadata.title || !metadata.artist || !metadata.coverHttpUrl || protocolInfoForMime(mimeType).length === 0) {
      throw new Error('Connect 元数据不完整，已阻止投送。');
    }

    this.setSession({
      ...this.session,
      currentTrackId: track?.id ?? status.currentTrackId ?? null,
      metadata,
      durationSeconds: metadata.durationSeconds,
      positionSeconds: request.positionSeconds ?? Math.max(0, status.positionSeconds || 0),
      error: null,
      updatedAt: new Date().toISOString(),
    });

    return {
      track,
      trackId: track?.id ?? status.currentTrackId ?? null,
      filePath,
      streamUrl,
      mimeType,
      sizeBytes,
      metadata,
      metadataXml,
      durationSeconds: metadata.durationSeconds,
    };
  }
}

let service: ConnectService | null = null;

export const getConnectService = (): ConnectService => {
  service ??= new ConnectService();
  return service;
};

export const disposeConnectService = async (): Promise<void> => {
  await service?.dispose();
  service = null;
};
