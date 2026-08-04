import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  Cable,
  Cast,
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  Image,
  Loader2,
  LockKeyhole,
  Pause,
  Play,
  Power,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Server,
  SlidersHorizontal,
  Smartphone,
  Square,
  Trash2,
  Video,
  Unplug,
  Volume2,
} from 'lucide-react';
import QRCode from 'qrcode';
import type { AirPlayReceiverProtocol, AppSettings } from '../../shared/types/appSettings';
import {
  connectDonatorUnlockPluginId,
  connectDonatorUnlockVersion,
  type ConnectDonatorUnlockReason,
  type ConnectDonatorUnlockStatus,
} from '../../shared/constants/featureUnlocks';
import { hqPlayerConnectDeviceId } from '../../shared/types/connect';
import type { AirPlayReceiverStatus, ConnectDevice, ConnectReceiverStatus, ConnectSessionStatus } from '../../shared/types/connect';
import type { EchoLinkServerStatus, EchoLinkWebBackground } from '../../shared/types/echoLink';
import type {
  HqPlayerConnectionMode,
  HqPlayerConnectionTestResult,
  HqPlayerDefaultPlaybackBackend,
  HqPlayerPlaybackControlPlan,
  HqPlayerPlaybackControlSendReason,
  HqPlayerPlaybackHandoffPlan,
  HqPlayerPlaybackHandoffReason,
  HqPlayerRemotePlaybackStatus,
  HqPlayerSettings,
  HqPlayerStatus,
} from '../../shared/types/hqplayer';
import type { LibraryTrack } from '../../shared/types/library';
import type { PlayableTrack } from '../../shared/types/remoteSources';
import { streamingProviderNames, streamingStableKey, type StreamingLiveResolveResult, type StreamingProviderName } from '../../shared/types/streaming';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { useSharedPlaybackStatus } from '../stores/playbackStatusStore';
import { hideSidebarRouteEntry } from '../utils/sidebarRouteVisibility';

type Translate = ReturnType<typeof useI18n>['t'];

const defaultStatus: ConnectSessionStatus = {
  deviceId: null,
  protocol: null,
  state: 'idle',
  currentTrackId: null,
  metadata: null,
  positionSeconds: 0,
  durationSeconds: 0,
  latencyMs: null,
  error: null,
  updatedAt: new Date(0).toISOString(),
};

const defaultReceiverStatus: ConnectReceiverStatus = {
  enabled: false,
  state: 'disabled',
  advertisedName: 'ECHO Next',
  addresses: [],
  currentClient: null,
  currentUri: null,
  metadata: null,
  positionSeconds: 0,
  durationSeconds: 0,
  volume: 100,
  error: null,
  debugEvents: [],
  updatedAt: new Date(0).toISOString(),
};

const defaultAirPlayReceiverStatus: AirPlayReceiverStatus = {
  enabled: false,
  state: 'disabled',
  protocol: 'airplay1',
  advertisedName: 'ECHO Next (AirPlay)',
  nativeAvailable: false,
  currentSourceId: null,
  currentClient: null,
  metadata: null,
  currentLyricLine: null,
  artworkUrl: null,
  positionSeconds: 0,
  durationSeconds: 0,
  volume: 100,
  error: null,
  debugEvents: [],
  updatedAt: new Date(0).toISOString(),
};

const defaultEchoLinkWebBackground: EchoLinkWebBackground = { type: 'none', url: '' };

const defaultEchoLinkStatus: EchoLinkServerStatus = {
  enabled: false,
  running: false,
  port: 26789,
  host: '127.0.0.1',
  addresses: [],
  pairingUri: null,
  webControlUrl: null,
  token: '',
  deviceName: 'PC ECHO',
  deviceId: '',
  webBackground: defaultEchoLinkWebBackground,
  activeMediaTokens: 0,
  activeArtworkTokens: 0,
  mdns: {
    state: 'disabled',
    serviceName: '_echo-link._tcp.local',
    error: null,
    advertisedAddresses: [],
  },
  diagnostics: {
    selectedLanAddress: '127.0.0.1',
    lastPhoneConnectionAt: null,
    lastAuthFailureAt: null,
    authFailureCount: 0,
    lastMediaTokenServed: null,
    recentHttpErrors: [],
  },
  error: null,
  updatedAt: new Date(0).toISOString(),
};

type WallpaperEngineBridgeStatus = {
  running: boolean;
  host: string;
  port: number | null;
  url: string | null;
  eventClients: number;
};

type ListeningRoomNodeState = 'active' | 'online' | 'warning' | 'idle';

type ListeningRoomNode = {
  id: string;
  state: ListeningRoomNodeState;
  eyebrow: string;
  title: string;
  detail: string;
  metric: string;
  icon: JSX.Element;
};

const defaultWallpaperEngineBridgeStatus: WallpaperEngineBridgeStatus = {
  running: false,
  host: '127.0.0.1',
  port: null,
  url: null,
  eventClients: 0,
};

const defaultDonatorUnlockStatus: ConnectDonatorUnlockStatus = {
  featureId: 'connect',
  pluginId: connectDonatorUnlockPluginId,
  requiredVersion: connectDonatorUnlockVersion,
  unlocked: false,
  pluginInstalled: false,
  pluginEnabled: false,
  hwidHash: '',
  reason: 'license-invalid',
  checkedAt: new Date(0).toISOString(),
};

const stateLabel: Record<ConnectSessionStatus['state'], TranslationKey> = {
  idle: 'connectPage.state.idle',
  discovering: 'connectPage.state.discovering',
  connecting: 'connectPage.state.connecting',
  ready: 'common.ready',
  playing: 'connectPage.state.playing',
  paused: 'connectPage.state.paused',
  stopped: 'connectPage.state.stopped',
  error: 'connectPage.state.error',
  unsupported: 'common.unavailable',
};

const deviceStateLabel: Record<ConnectDevice['state'], TranslationKey> = {
  available: 'connectPage.deviceState.available',
  connecting: 'connectPage.state.connecting',
  connected: 'connectPage.deviceState.connected',
  unavailable: 'connectPage.deviceState.unavailable',
  unsupported: 'connectPage.deviceState.unsupported',
};

const receiverStateLabel: Record<ConnectReceiverStatus['state'], TranslationKey> = {
  disabled: 'connectPage.receiver.state.disabled',
  idle: 'connectPage.receiver.state.idle',
  ready: 'connectPage.receiver.state.ready',
  loading: 'connectPage.receiver.state.loading',
  playing: 'connectPage.receiver.state.playing',
  paused: 'connectPage.state.paused',
  stopped: 'connectPage.state.stopped',
  error: 'connectPage.state.error',
};

const airPlayStateLabel: Record<AirPlayReceiverStatus['state'], TranslationKey> = {
  disabled: 'connectPage.receiver.state.disabled',
  unavailable: 'connectPage.airplay.state.unavailable',
  idle: 'connectPage.airplay.state.idle',
  starting: 'connectPage.airplay.state.starting',
  ready: 'connectPage.deviceState.connected',
  playing: 'connectPage.airplay.state.playing',
  paused: 'connectPage.state.paused',
  stopped: 'connectPage.state.stopped',
  error: 'connectPage.state.error',
};

const defaultHqPlayerSettings: HqPlayerSettings = {
  enabled: false,
  connectionMode: 'localDesktop',
  host: '127.0.0.1',
  port: 4321,
  executablePath: null,
  allowLaunch: false,
  mediaServerEnabled: false,
  mediaServerPort: null,
  defaultPlaybackBackend: 'ask',
  profileName: null,
};

const hqPlayerLocalHost = '127.0.0.1';
const hqPlayerDefaultPort = 4321;
const hiddenConnectDevicesStorageKey = 'echo.connect.hiddenDevices.v1';
const connectCommandCenterCollapsedStorageKey = 'echo.connect.commandCenterCollapsed.v1';
const connectEchoLinkPanelCollapsedStorageKey = 'echo.connect.echoLinkPanelCollapsed.v1';
const connectDeviceSectionCollapsedStorageKey = 'echo.connect.deviceSectionCollapsed.v1';
const connectRadioPanelCollapsedStorageKey = 'echo.connect.radioPanelCollapsed.v1';
const connectLivePanelCollapsedStorageKey = 'echo.connect.livePanelCollapsed.v1';
const connectHqPlayerPanelCollapsedStorageKey = 'echo.connect.hqPlayerPanelCollapsed.v1';
const connectListeningRoomCollapsedStorageKey = 'echo.connect.listeningRoomCollapsed.v1';
const legacyRadioStationsStorageKey = 'echo.connect.radioStations.v1';
const radioStationsStorageKey = 'echo.connect.radioStations.v2';
const maxStoredRadioStations = 40;
const airPlayReceiverProtocols: AirPlayReceiverProtocol[] = ['airplay1', 'airplay2'];

const hqPlayerConnectionModes: HqPlayerConnectionMode[] = ['localDesktop', 'remote'];
const hqPlayerDefaultBackends: HqPlayerDefaultPlaybackBackend[] = ['echoNative', 'ask', 'hqplayer'];

type ConnectBridge = NonNullable<NonNullable<Window['echo']>['connect']>;

const isRendererTestEnvironment = (): boolean =>
  typeof navigator !== 'undefined' && /jsdom/iu.test(navigator.userAgent);

const connectRefreshCacheTtlMs = isRendererTestEnvironment() ? 0 : 4_000;
let connectRefreshCache: { bridge: ConnectBridge; devices: ConnectDevice[]; loadedAtMs: number } | null = null;
let connectRefreshRequest: { bridge: ConnectBridge; promise: Promise<ConnectDevice[]> } | null = null;
let connectDonatorUnlockStatusCache: { bridge: ConnectBridge; status: ConnectDonatorUnlockStatus } | null = null;
let connectDonatorUnlockStatusRequest: { bridge: ConnectBridge; promise: Promise<ConnectDonatorUnlockStatus> } | null = null;

const invalidateConnectRefreshCache = (): void => {
  connectRefreshCache = null;
};

export const resetConnectDonatorUnlockStatusCacheForTests = (): void => {
  invalidateConnectRefreshCache();
  connectRefreshRequest = null;
  connectDonatorUnlockStatusCache = null;
  connectDonatorUnlockStatusRequest = null;
};

const invalidateConnectDonatorUnlockStatusCache = (): void => {
  connectDonatorUnlockStatusCache = null;
};

const loadConnectDonatorUnlockStatus = (
  connect: ConnectBridge,
  force = false,
): Promise<ConnectDonatorUnlockStatus> => {
  if (force) {
    invalidateConnectDonatorUnlockStatusCache();
  } else if (connectDonatorUnlockStatusCache?.bridge === connect) {
    return Promise.resolve(connectDonatorUnlockStatusCache.status);
  } else if (connectDonatorUnlockStatusRequest?.bridge === connect) {
    return connectDonatorUnlockStatusRequest.promise;
  }

  const promise = (connect.getDonatorUnlockStatus?.() ?? Promise.resolve(defaultDonatorUnlockStatus)).then((status) => {
    const nextStatus = status ?? defaultDonatorUnlockStatus;
    connectDonatorUnlockStatusCache = {
      bridge: connect,
      status: nextStatus,
    };
    return nextStatus;
  });

  connectDonatorUnlockStatusRequest = { bridge: connect, promise };
  void promise.then(() => {
    if (connectDonatorUnlockStatusRequest?.promise === promise) {
      connectDonatorUnlockStatusRequest = null;
    }
  }, () => {
    if (connectDonatorUnlockStatusRequest?.promise === promise) {
      connectDonatorUnlockStatusRequest = null;
    }
  });
  return promise;
};

const loadConnectDevices = (connect: ConnectBridge, force = false): Promise<ConnectDevice[]> => {
  if (force) {
    invalidateConnectRefreshCache();
  } else if (connectRefreshCache?.bridge === connect && Date.now() - connectRefreshCache.loadedAtMs <= connectRefreshCacheTtlMs) {
    return Promise.resolve(connectRefreshCache.devices);
  } else if (connectRefreshRequest?.bridge === connect) {
    return connectRefreshRequest.promise;
  }

  const promise = connect.refresh().then((devices) => {
    connectRefreshCache = {
      bridge: connect,
      devices,
      loadedAtMs: Date.now(),
    };
    return devices;
  });

  connectRefreshRequest = { bridge: connect, promise };
  void promise.then(() => {
    if (connectRefreshRequest?.promise === promise) {
      connectRefreshRequest = null;
    }
  }, () => {
    if (connectRefreshRequest?.promise === promise) {
      connectRefreshRequest = null;
    }
  });
  return promise;
};

const createEchoLinkPairingUri = (status: EchoLinkServerStatus, host: string): string | null => {
  if (!status.enabled || !status.running || !status.token) {
    return null;
  }
  const entries: Array<[string, string]> = [
    ['host', host],
    ['port', String(status.port)],
    ['token', status.token],
    ['name', status.deviceName],
    ['scheme', 'http'],
  ];
  return `echo://pair?${entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
};

const createEchoLinkWebControlUrl = (status: EchoLinkServerStatus, host: string): string | null => {
  if (!status.enabled || !status.running || !status.token) {
    return null;
  }
  const url = new URL(`http://${host}:${status.port}/echo-link/web`);
  url.searchParams.set('token', status.token);
  return url.toString();
};

const hqPlayerStateLabel: Record<HqPlayerStatus['state'], TranslationKey> = {
  disabled: 'connectPage.hqplayer.state.disabled',
  'not-configured': 'connectPage.hqplayer.state.notConfigured',
  checking: 'connectPage.hqplayer.state.checking',
  available: 'connectPage.hqplayer.state.available',
  unavailable: 'connectPage.hqplayer.state.unavailable',
};

const hqPlayerModeLabel: Record<HqPlayerConnectionMode, TranslationKey> = {
  localDesktop: 'connectPage.hqplayer.mode.localDesktop',
  remote: 'connectPage.hqplayer.mode.remote',
};

const hqPlayerBackendLabel: Record<HqPlayerDefaultPlaybackBackend, TranslationKey> = {
  echoNative: 'connectPage.hqplayer.backend.echoNative',
  ask: 'connectPage.hqplayer.backend.ask',
  hqplayer: 'connectPage.hqplayer.backend.hqplayer',
};

const connectDonatorUnlockReasonLabel: Record<ConnectDonatorUnlockReason, TranslationKey> = {
  'hwid-not-allowed': 'connectPage.lock.reason.hwidNotAllowed',
  'license-invalid': 'connectPage.lock.reason.licenseInvalid',
  unlocked: 'connectPage.lock.reason.unlocked',
};

const hqPlayerHandoffReasonLabel: Record<HqPlayerPlaybackHandoffReason, TranslationKey> = {
  hqplayer_disabled: 'connectPage.hqplayer.handoffReason.disabled',
  hqplayer_control_port_not_configured: 'connectPage.hqplayer.handoffReason.portNotConfigured',
  hqplayer_confirmation_required: 'connectPage.hqplayer.handoffReason.confirmationRequired',
  echo_native_selected: 'connectPage.hqplayer.handoffReason.echoNativeSelected',
  remote_hqplayer_requires_media_server: 'connectPage.hqplayer.handoffReason.remoteRequiresMediaServer',
  media_server_not_ready: 'connectPage.hqplayer.handoffReason.mediaServerNotReady',
  spotify_sdk_required: 'connectPage.hqplayer.handoffReason.spotifySdkRequired',
  streaming_item_unplayable: 'connectPage.hqplayer.handoffReason.streamingItemUnplayable',
  streaming_proxy_required: 'connectPage.hqplayer.handoffReason.streamingProxyRequired',
  source_requires_headers: 'connectPage.hqplayer.handoffReason.sourceRequiresHeaders',
  source_resolution_failed: 'connectPage.hqplayer.handoffReason.sourceResolutionFailed',
  unsupported_media_type: 'connectPage.hqplayer.handoffReason.unsupportedMediaType',
};

const hqPlayerSendReasonLabel: Record<HqPlayerPlaybackControlSendReason, TranslationKey> = {
  control_plan_missing: 'connectPage.hqplayer.sendReason.controlPlanMissing',
  handoff_not_ready: 'connectPage.hqplayer.sendReason.handoffNotReady',
  source_missing: 'connectPage.hqplayer.sendReason.sourceMissing',
  source_requires_headers: 'connectPage.hqplayer.sendReason.sourceRequiresHeaders',
  hqplayer_control_port_not_configured: 'connectPage.hqplayer.sendReason.portNotConfigured',
  hqplayer_connection_timeout: 'connectPage.hqplayer.sendReason.timeout',
  hqplayer_connection_refused: 'connectPage.hqplayer.sendReason.refused',
  hqplayer_connection_failed: 'connectPage.hqplayer.sendReason.failed',
  hqplayer_protocol_error: 'connectPage.hqplayer.sendReason.protocolError',
  hqplayer_response_error: 'connectPage.hqplayer.sendReason.responseError',
};

const hqPlayerExposureLabel: Record<NonNullable<HqPlayerPlaybackControlPlan['source']>['exposure'], TranslationKey> = {
  'local-file': 'connectPage.hqplayer.exposure.localFile',
  'loopback-http': 'connectPage.hqplayer.exposure.loopbackHttp',
  'direct-http': 'connectPage.hqplayer.exposure.directHttp',
  'media-server': 'connectPage.hqplayer.exposure.mediaServer',
};

const hqPlayerRemoteStateLabel: Record<HqPlayerRemotePlaybackStatus['state'], TranslationKey> = {
  stopped: 'connectPage.state.stopped',
  paused: 'connectPage.state.paused',
  playing: 'connectPage.state.playing',
  'stop-requested': 'connectPage.hqplayer.remoteState.stopRequested',
  unknown: 'connectPage.common.unknown',
};

const formatTime = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = String(safe % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
};

const readStoredStringSet = (key: string): Set<string> => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === 'string')) : new Set();
  } catch {
    return new Set();
  }
};

const writeStoredStringSet = (key: string, values: Set<string>): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify([...values]));
  } catch {
    // Local UI preference only; ignore blocked storage.
  }
};

const readStoredBoolean = (key: string, fallback: boolean): boolean => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
};

const writeStoredBoolean = (key: string, value: boolean): void => {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Local UI preference only; ignore blocked storage.
  }
};

type RadioStation = {
  id: string;
  name: string;
  url: string;
  coverUrl?: string;
  videoUrl?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  lastPlayedAt: string | null;
};

type RadioMarqueeTextProps = {
  as?: 'small' | 'span';
  className: string;
  text: string;
  title?: string;
};

const RadioMarqueeText = ({ as = 'span', className, text, title }: RadioMarqueeTextProps): JSX.Element => {
  const outerRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [shift, setShift] = useState(0);
  const setOuterRef = useCallback((node: HTMLElement | null): void => {
    outerRef.current = node;
  }, []);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) {
      return undefined;
    }

    const updateShift = (): void => {
      setShift(Math.max(0, inner.scrollWidth - outer.clientWidth));
    };

    updateShift();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateShift);
    resizeObserver?.observe(outer);
    resizeObserver?.observe(inner);
    window.addEventListener('resize', updateShift);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateShift);
    };
  }, [text]);

  const style = shift > 0
    ? ({
        '--connect-radio-marquee-shift': `${shift}px`,
        '--connect-radio-marquee-duration': `${Math.min(14, Math.max(5, shift / 20)).toFixed(1)}s`,
      } as CSSProperties)
    : undefined;
  const content = <span className="connect-radio-marquee__inner" ref={innerRef}>{text}</span>;
  const props = {
    className: `connect-radio-marquee ${className}`,
    'data-marquee': shift > 0 ? 'true' : undefined,
    ref: setOuterRef,
    style,
    title: title ?? text,
  };

  return as === 'small' ? <small {...props}>{content}</small> : <span {...props}>{content}</span>;
};

const hashText = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const normalizeRadioUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

const normalizeOptionalRadioUrl = (value: string | null | undefined): string | undefined | null => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return undefined;
  }
  return normalizeRadioUrl(trimmed) ?? null;
};

const radioStationIdForUrl = (url: string): string => `radio:${hashText(url.toLowerCase())}`;

const radioTrackIdForUrl = (url: string): string => `radio-stream:${hashText(url.toLowerCase())}`;

const liveTrackIdForUrl = (url: string): string => `live-stream:${hashText(url.toLowerCase())}`;

const radioStationKeyForUrl = (url: string): string => (normalizeRadioUrl(url) ?? url).toLowerCase();

const encodeRadioProviderTrackId = (url: string): string => {
  const bytes = new TextEncoder().encode(url);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const encodeM3u8ProviderTrackPayload = (payload: {
  url: string;
  headers?: Record<string, string>;
  mimeType?: string | null;
  supportsRange?: boolean;
}): string => encodeRadioProviderTrackId(`echo-m3u8-target:${JSON.stringify({
  url: payload.url,
  headers: payload.headers ?? {},
  mimeType: payload.mimeType ?? null,
  supportsRange: payload.supportsRange ?? true,
})}`);

const stationNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./iu, '') || '网络电台';
  } catch {
    return '网络电台';
  }
};

const defaultRadioStationCreatedAt = '2026-05-31T00:00:00.000Z';

const createDefaultRadioStation = (name: string, url: string, description: string): RadioStation => {
  const normalizedUrl = normalizeRadioUrl(url) ?? url;
  return {
    id: radioStationIdForUrl(normalizedUrl),
    name,
    url: normalizedUrl,
    description,
    createdAt: defaultRadioStationCreatedAt,
    updatedAt: defaultRadioStationCreatedAt,
    lastPlayedAt: null,
  };
};

const createRadioStation = ({
  coverUrl,
  lastPlayedAt,
  name,
  url,
  videoUrl,
}: {
  coverUrl?: string;
  lastPlayedAt: string | null;
  name?: string;
  url: string;
  videoUrl?: string;
}): RadioStation => {
  const now = new Date().toISOString();
  return {
    id: radioStationIdForUrl(url),
    name: name?.trim() || stationNameFromUrl(url),
    url,
    ...(coverUrl ? { coverUrl } : {}),
    ...(videoUrl ? { videoUrl } : {}),
    createdAt: now,
    updatedAt: now,
    lastPlayedAt,
  };
};

const radioStationToTrack = (station: RadioStation): LibraryTrack => {
  const providerTrackId = encodeRadioProviderTrackId(station.url);
  const stableKey = streamingStableKey('m3u8', providerTrackId);
  const artist = 'Live Stream';
  return {
    id: radioTrackIdForUrl(station.url),
    mediaType: 'streaming',
    isTemporary: true,
    isLiveStream: true,
    liveVideoUrl: station.videoUrl ?? null,
    path: stableKey,
    provider: 'm3u8',
    providerTrackId,
    streamingQuality: 'standard',
    stableKey,
    title: station.name,
    artist,
    album: 'ECHO Live',
    albumArtist: artist,
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    duration: 0,
    codec: 'stream',
    sampleRate: null,
    bitDepth: null,
    bitrate: null,
    coverId: null,
    coverThumb: station.coverUrl ?? null,
    fieldSources: {
      title: 'connect-live',
      artist: 'connect-live',
      album: 'connect-live',
    },
    unavailable: false,
  };
};

const liveStreamToTrack = (stream: StreamingLiveResolveResult): LibraryTrack => {
  const providerTrackId = encodeM3u8ProviderTrackPayload({
    url: stream.playbackUrl,
    headers: stream.headers,
    mimeType: stream.mimeType,
    supportsRange: false,
  });
  const stableKey = streamingStableKey('m3u8', providerTrackId);
  const artist = stream.artist ?? (stream.provider === 'bilibili' ? 'Bilibili Live' : 'Live Stream');
  return {
    id: liveTrackIdForUrl(stream.pageUrl || stream.sourceUrl),
    mediaType: 'streaming',
    isTemporary: true,
    isLiveStream: true,
    liveVideoUrl: stream.videoUrl ?? stream.playbackUrl,
    path: stableKey,
    provider: 'm3u8',
    providerTrackId,
    streamingQuality: 'standard',
    stableKey,
    title: stream.title,
    artist,
    album: stream.provider === 'bilibili' ? 'Bilibili Live' : 'ECHO Live',
    albumArtist: artist,
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    duration: 0,
    codec: 'stream',
    sampleRate: null,
    bitDepth: null,
    bitrate: null,
    coverId: null,
    coverThumb: stream.coverUrl,
    fieldSources: {
      title: 'connect-live',
      artist: 'connect-live',
      album: 'connect-live',
    },
    unavailable: false,
  };
};

const defaultRadioStations: RadioStation[] = [
  createDefaultRadioStation('Zeno', 'https://stream.zeno.fm/qpn8mkt8c4duv', 'Zeno 托管的二次元直播流，轻量备用源。'),
  createDefaultRadioStation('Gensokyo Radio 东方', 'https://stream.gensokyoradio.net/1/', '东方 Project 同人音乐电台，适合长时间后台播放。'),
  createDefaultRadioStation('ANISONG', 'https://pool.anison.fm/AniSonFM%28320%29', '动画歌曲向电台，OP、ED、角色歌和 ACG 曲库为主。'),
  createDefaultRadioStation('Yumi Co. Radio', 'https://yumicoradio.net/stream', 'City Pop、Future Funk、Anime Groove 氛围台。'),
  createDefaultRadioStation('AnimeRadio.de', 'https://stream.animeradio.de/animeradio.mp3', 'J-Pop、J-Rock 和 Anime Musik 的老牌网络电台。'),
];

const isStoredRadioStation = (value: unknown): value is RadioStation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const station = value as Partial<RadioStation>;
  return (
    typeof station.id === 'string' &&
    typeof station.name === 'string' &&
    typeof station.url === 'string' &&
    normalizeRadioUrl(station.url) !== null &&
    (station.coverUrl === undefined || (typeof station.coverUrl === 'string' && normalizeRadioUrl(station.coverUrl) !== null)) &&
    (station.videoUrl === undefined || (typeof station.videoUrl === 'string' && normalizeRadioUrl(station.videoUrl) !== null)) &&
    (station.description === undefined || typeof station.description === 'string') &&
    typeof station.createdAt === 'string' &&
    typeof station.updatedAt === 'string' &&
    (station.lastPlayedAt === null || typeof station.lastPlayedAt === 'string')
  );
};

const sanitizeRadioStation = (station: RadioStation): RadioStation => {
  const url = normalizeRadioUrl(station.url) ?? station.url;
  const coverUrl = normalizeOptionalRadioUrl(station.coverUrl);
  const videoUrl = normalizeOptionalRadioUrl(station.videoUrl);
  const description = station.description?.trim();
  return {
    ...station,
    id: radioStationIdForUrl(url),
    name: station.name.trim() || stationNameFromUrl(url),
    url,
    ...(coverUrl ? { coverUrl } : { coverUrl: undefined }),
    ...(videoUrl ? { videoUrl } : { videoUrl: undefined }),
    description: description || undefined,
  };
};

const readRadioStationsFromStorage = (key: string): RadioStation[] | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter(isStoredRadioStation)
          .map(sanitizeRadioStation)
          .slice(0, maxStoredRadioStations)
      : [];
  } catch {
    return [];
  }
};

const mergeDefaultRadioStations = (storedStations: RadioStation[]): RadioStation[] => {
  const storedByUrl = new Map(storedStations.map((station) => [radioStationKeyForUrl(station.url), station]));
  const defaultKeys = new Set(defaultRadioStations.map((station) => radioStationKeyForUrl(station.url)));
  const seededStations = defaultRadioStations.map((station) => {
    const stored = storedByUrl.get(radioStationKeyForUrl(station.url));
    return stored
      ? {
          ...station,
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
          lastPlayedAt: stored.lastPlayedAt,
        }
      : station;
  });
  const customStations = storedStations.filter((station) => !defaultKeys.has(radioStationKeyForUrl(station.url)));
  return [...seededStations, ...customStations].slice(0, maxStoredRadioStations);
};

const readStoredRadioStations = (): RadioStation[] => {
  const current = readRadioStationsFromStorage(radioStationsStorageKey);
  if (current) {
    return current;
  }

  const migrated = mergeDefaultRadioStations(readRadioStationsFromStorage(legacyRadioStationsStorageKey) ?? []);
  writeStoredRadioStations(migrated);
  return migrated;
};

const writeStoredRadioStations = (stations: RadioStation[]): void => {
  try {
    window.localStorage.setItem(radioStationsStorageKey, JSON.stringify(stations.map(sanitizeRadioStation).slice(0, maxStoredRadioStations)));
  } catch {
    // Radio favorites are local convenience data; playback must not depend on storage.
  }
};

const formatProtocol = (device: Pick<ConnectDevice, 'protocol'>): string =>
  device.protocol === 'dlna' ? 'DLNA / UPnP' : device.protocol === 'hqplayer' ? 'HQPlayer' : 'AirPlay';

const uniqueText = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) {
      continue;
    }
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
  }
  return result;
};

const formatDeviceProduct = (device: ConnectDevice, t: Translate): string => {
  const parts = uniqueText([
    device.manufacturer,
    device.discovery?.modelName ?? device.model,
    device.discovery?.modelNumber,
  ]);
  return parts.length > 0 ? parts.join(' · ') : t('connectPage.device.modelUnknown');
};

const formatDeviceAddress = (device: ConnectDevice, t: Translate): string =>
  device.address ? t('connectPage.device.lanAddress', { address: device.address }) : t('connectPage.device.waitingAddress');

const formatMimeLabel = (mimeType: string): string => {
  switch (mimeType.toLowerCase()) {
    case 'audio/flac':
      return 'FLAC';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'WAV';
    case 'audio/mpeg':
      return 'MP3';
    case 'audio/mp4':
      return 'MP4 / ALAC';
    case 'audio/aac':
      return 'AAC';
    case 'audio/ogg':
      return 'OGG';
    case 'audio/aiff':
      return 'AIFF';
    default:
      return mimeType.replace(/^audio\//iu, '').toUpperCase();
  }
};

const formatDeviceFormatSupport = (device: ConnectDevice, t: Translate): string => {
  const supported = device.capabilities.supportedMimeTypes;
  if (supported.some((item) => item === '*/*' || item.endsWith('/*'))) {
    return t('connectPage.device.format.all');
  }

  const formats = supported
    .filter((item) => item !== 'application/octet-stream')
    .map(formatMimeLabel)
    .slice(0, 3);

  if (formats.length === 0) {
    return t('connectPage.device.format.pending');
  }

  const extraCount = Math.max(0, supported.length - formats.length);
  return extraCount > 0 ? `${formats.join(' / ')} +${extraCount}` : formats.join(' / ');
};

const formatDeviceSupport = (device: ConnectDevice, t: Translate): string => {
  if (device.protocol === 'hqplayer') {
    return t('connectPage.device.support.hqplayer');
  }

  if (device.protocol === 'airplay') {
    return t('connectPage.device.support.airplay');
  }

  const controls = [
    device.capabilities.canSeek ? t('connectPage.device.support.seek') : null,
    device.capabilities.canSetVolume ? t('connectPage.device.support.volume') : null,
    device.capabilities.supportsMetadata ? t('connectPage.device.support.metadata') : null,
  ].filter(Boolean);
  const route = device.capabilities.requiresTranscode ? t('connectPage.device.support.transcode') : t('connectPage.device.support.direct');
  return [...controls, route, formatDeviceFormatSupport(device, t)].join(' · ') || t('connectPage.device.support.basicDlna');
};

const formatReceiverAddress = (value: string): string => {
  try {
    const url = new URL(value);
    return `${url.hostname}:${url.port}`;
  } catch {
    return value;
  }
};

const parsePort = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }

  return parsed;
};

const formatTimestamp = (value: string | null, t: Translate): string => {
  if (!value) {
    return t('connectPage.common.notChecked');
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

type ReceiverDebugEvent = ConnectReceiverStatus['debugEvents'][number];

const formatReceiverDebugEvent = (event: ReceiverDebugEvent): string => {
  const statusCode = event.statusCode === null ? '-' : String(event.statusCode);
  return [
    new Date(event.at).toLocaleTimeString(),
    event.remoteAddress ?? '-',
    event.method,
    event.path,
    event.action ? `#${event.action}` : '#-',
    statusCode,
    event.message ?? '',
  ].filter(Boolean).join(' ');
};

const writeTextToClipboard = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('clipboard unavailable');
  }
};

const formatHqEndpoint = (settings: Pick<HqPlayerSettings, 'host' | 'port'>, t: Translate): string =>
  settings.port ? `${settings.host}:${settings.port}` : `${settings.host}:${t('connectPage.common.notConfigured')}`;

const withHqPlayerFriendlyDefaults = (settings: HqPlayerSettings): HqPlayerSettings => {
  const isLocal = settings.connectionMode !== 'remote';
  return {
    ...settings,
    connectionMode: isLocal ? 'localDesktop' : 'remote',
    host: isLocal ? hqPlayerLocalHost : settings.host,
    port: settings.port ?? hqPlayerDefaultPort,
  };
};

const createHqPlayerConnectSettings = (settings: HqPlayerSettings): HqPlayerSettings => ({
  ...withHqPlayerFriendlyDefaults(settings),
  enabled: true,
});

const createHqPlayerStatusFromConnectionTest = (
  settings: HqPlayerSettings,
  result: HqPlayerConnectionTestResult,
): HqPlayerStatus => ({
  enabled: settings.enabled,
  state: result.state,
  endpoint: result.endpoint,
  mediaServerEnabled: settings.mediaServerEnabled,
  defaultPlaybackBackend: settings.defaultPlaybackBackend,
  profileName: settings.profileName,
  lastCheckedAt: result.checkedAt,
  lastError: result.error,
  controlInfo: result.controlInfo ?? null,
  playbackStatus: result.playbackStatus ?? null,
});

const formatHqPlayerSendMessage = (plan: HqPlayerPlaybackControlPlan | null, t: Translate): string => {
  const send = plan?.send ?? null;
  if (!send) {
    return t('connectPage.hqplayer.sendState.notSent');
  }

  if (send.state === 'sent') {
    return t('connectPage.hqplayer.sendState.sent', { ms: send.elapsedMs });
  }

  if (send.state === 'prepared') {
    return t('connectPage.hqplayer.sendState.prepared');
  }

  const reason = send.reason ? t(hqPlayerSendReasonLabel[send.reason]) : send.message;
  return `${send.state === 'failed' ? t('connectPage.hqplayer.sendState.failed') : t('connectPage.hqplayer.sendState.notSent')} · ${reason ?? t('connectPage.hqplayer.sendState.unknownReason')}`;
};

const formatHqPlayerProduct = (
  controlInfo: HqPlayerConnectionTestResult['controlInfo'] | HqPlayerStatus['controlInfo'] | null | undefined,
  t: Translate,
): string =>
  controlInfo?.product
    ? [controlInfo.product, controlInfo.version].filter(Boolean).join(' ')
    : t('connectPage.common.pendingCheck');

const formatHqPlayerEngine = (
  controlInfo: HqPlayerConnectionTestResult['controlInfo'] | HqPlayerStatus['controlInfo'] | null | undefined,
  t: Translate,
): string =>
  controlInfo?.engine ?? controlInfo?.platform ?? t('connectPage.common.pendingCheck');

const formatHqPlayerRemotePosition = (status: HqPlayerRemotePlaybackStatus | null, t: Translate): string => {
  if (!status) {
    return t('connectPage.common.pendingCheck');
  }

  const position = status.positionSeconds ?? 0;
  const duration = status.durationSeconds ?? 0;
  return `${t(hqPlayerRemoteStateLabel[status.state])} · ${formatTime(position)} / ${formatTime(duration)}`;
};

const formatHqPlayerSignal = (status: HqPlayerRemotePlaybackStatus | null, t: Translate): string => {
  if (!status) {
    return t('connectPage.common.pendingCheck');
  }

  const format = status.activeRate && status.activeBits && status.activeChannels
    ? `${status.activeRate}Hz / ${status.activeBits}bit / ${status.activeChannels}ch`
    : t('connectPage.hqplayer.signal.pendingFormat');
  const dsp = [status.activeMode, status.activeFilter, status.activeShaper].filter(Boolean).join(' · ');
  return dsp ? `${format} · ${dsp}` : format;
};

const isStreamingProviderName = (value: string | null | undefined): value is StreamingProviderName =>
  streamingProviderNames.includes(value as StreamingProviderName);

const StreamerGlyph = (): JSX.Element => (
  <svg className="connect-device-glyph" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <path d="M8.5 16.5 20 11l11.5 5.5v10.2L20 32 8.5 26.7z" />
    <path d="m8.5 16.5 11.5 5.3 11.5-5.3" />
    <path d="M20 21.8V32" />
    <path d="M13.5 25.1h6" />
    <circle cx="27.5" cy="24.7" r="1.4" />
  </svg>
);

const TvGlyph = (): JSX.Element => (
  <svg className="connect-device-glyph" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <rect x="7.5" y="10.5" width="25" height="17" rx="3" />
    <path d="M16 31h8" />
    <path d="M20 27.5V31" />
    <path d="M12 15.5h16" />
  </svg>
);

const AirPlayGlyph = (): JSX.Element => (
  <svg className="connect-device-glyph" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <rect x="8.5" y="10.5" width="23" height="15" rx="3" />
    <path d="m15 31 5-6 5 6z" />
  </svg>
);

const HqPlayerGlyph = (): JSX.Element => (
  <span className="connect-hqplayer-wordmark" aria-hidden="true">
    HQ
  </span>
);

const looksLikeTvDevice = (device: ConnectDevice): boolean => {
  const text = uniqueText([
    device.name,
    device.model,
    device.manufacturer,
    device.discovery?.modelName,
    device.discovery?.modelDescription,
  ]).join(' ').toLowerCase();
  return /\b(tv|bravia|webos|roku|chromecast|android tv|google tv|samsung|lg tv|tcl|hisense|xiaomi tv|mi tv)\b/iu.test(text);
};

const deviceVisual = (device: ConnectDevice): { icon: JSX.Element; label: string; labelKey?: TranslationKey; tone: string } => {
  if (device.protocol === 'hqplayer') {
    return { icon: <HqPlayerGlyph />, label: 'HQPlayer', tone: 'hqplayer' };
  }

  if (device.protocol === 'airplay') {
    return { icon: <AirPlayGlyph />, label: 'AirPlay', tone: 'airplay' };
  }

  if (looksLikeTvDevice(device)) {
    return { icon: <TvGlyph />, label: 'TV', tone: 'tv' };
  }

  return { icon: <StreamerGlyph />, label: 'Streamer', labelKey: 'connectPage.devices.streamerLabel', tone: 'streamer' };
};

const toHqPlayerPlayableTrack = (track: LibraryTrack | null, fallbackPath: string | null): PlayableTrack | null => {
  if (!track) {
    if (!fallbackPath) {
      return null;
    }

    const title = fallbackPath.split(/[\\/]/u).pop() || 'Local Track';
    return {
      mediaType: 'local',
      trackId: `file:${fallbackPath}`,
      path: fallbackPath,
      title,
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration: null,
    };
  }

  if (track.mediaType === 'remote') {
    return {
      mediaType: 'remote',
      trackId: track.id,
      sourceId: track.sourceId ?? null,
      stableKey: track.stableKey ?? null,
      remotePath: track.remotePath ?? null,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.albumArtist,
      duration: track.duration,
      coverThumb: track.coverThumb,
    };
  }

  if (track.mediaType === 'streaming') {
    const provider = isStreamingProviderName(track.provider) ? track.provider : 'mock';
    const providerTrackId = track.providerTrackId ?? track.id;
    return {
      mediaType: 'streaming',
      trackId: track.id,
      provider,
      providerTrackId,
      quality: track.streamingQuality,
      stableKey: track.stableKey ?? `${provider}:${providerTrackId}`,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.albumArtist,
      duration: track.duration,
      coverThumb: track.coverThumb,
      playable: track.unavailable !== true,
      unavailableReason: track.unavailable ? 'This streaming track is unavailable.' : null,
    };
  }

  return {
    mediaType: 'local',
    trackId: track.id,
    path: track.path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    duration: track.duration,
    coverThumb: track.coverThumb,
  };
};

export const ConnectPage = (): JSX.Element => {
  const { t } = useI18n();
  const queue = usePlaybackQueue();
  const playbackStatus = useSharedPlaybackStatus();
  const [devices, setDevices] = useState<ConnectDevice[]>([]);
  const [status, setStatus] = useState<ConnectSessionStatus>(defaultStatus);
  const [receiverStatus, setReceiverStatus] = useState<ConnectReceiverStatus>(defaultReceiverStatus);
  const [airPlayReceiverStatus, setAirPlayReceiverStatus] = useState<AirPlayReceiverStatus>(defaultAirPlayReceiverStatus);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReceiverBusy, setIsReceiverBusy] = useState(false);
  const [isAirPlayReceiverBusy, setIsAirPlayReceiverBusy] = useState(false);
  const [echoLinkStatus, setEchoLinkStatus] = useState<EchoLinkServerStatus>(defaultEchoLinkStatus);
  const [isEchoLinkBusy, setIsEchoLinkBusy] = useState(false);
  const [isEchoLinkBackgroundBusy, setIsEchoLinkBackgroundBusy] = useState(false);
  const [copiedEchoLinkPairing, setCopiedEchoLinkPairing] = useState(false);
  const [copiedEchoLinkWebControl, setCopiedEchoLinkWebControl] = useState(false);
  const [savedEchoLinkBackground, setSavedEchoLinkBackground] = useState(false);
  const [showEchoLinkToken, setShowEchoLinkToken] = useState(false);
  const [selectedEchoLinkHost, setSelectedEchoLinkHost] = useState<string | null>(null);
  const [echoLinkQrDataUrl, setEchoLinkQrDataUrl] = useState<string | null>(null);
  const [echoLinkWebBackgroundDraft, setEchoLinkWebBackgroundDraft] = useState<EchoLinkWebBackground>(defaultEchoLinkWebBackground);
  const [wallpaperEngineBridgeStatus, setWallpaperEngineBridgeStatus] = useState<WallpaperEngineBridgeStatus>(defaultWallpaperEngineBridgeStatus);
  const [copiedAirPlayDebug, setCopiedAirPlayDebug] = useState(false);
  const [isAutoStartBusy, setIsAutoStartBusy] = useState(false);
  const [autoStartReceiversEnabled, setAutoStartReceiversEnabled] = useState(false);
  const [airPlayReceiverProtocol, setAirPlayReceiverProtocol] = useState<AirPlayReceiverProtocol>('airplay1');
  const [donatorUnlockStatus, setDonatorUnlockStatus] = useState<ConnectDonatorUnlockStatus>(() =>
    connectDonatorUnlockStatusCache?.bridge === window.echo?.connect
      ? connectDonatorUnlockStatusCache.status
      : defaultDonatorUnlockStatus,
  );
  const [isDonatorUnlockLoading, setIsDonatorUnlockLoading] = useState(() =>
    connectDonatorUnlockStatusCache?.bridge !== window.echo?.connect,
  );
  const [isSidebarHideBusy, setIsSidebarHideBusy] = useState(false);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [isCommandBusy, setIsCommandBusy] = useState(false);
  const [volumePercent, setVolumePercent] = useState(80);
  const [radioStations, setRadioStations] = useState<RadioStation[]>(() => readStoredRadioStations());
  const [radioNameDraft, setRadioNameDraft] = useState('');
  const [radioUrlDraft, setRadioUrlDraft] = useState('');
  const [activeRadioId, setActiveRadioId] = useState<string | null>(null);
  const [isRadioBusy, setIsRadioBusy] = useState(false);
  const [liveUrlDraft, setLiveUrlDraft] = useState('');
  const [activeLiveUrl, setActiveLiveUrl] = useState<string | null>(null);
  const [lastResolvedLive, setLastResolvedLive] = useState<StreamingLiveResolveResult | null>(null);
  const [isLiveBusy, setIsLiveBusy] = useState(false);
  const [hqPlayerDraft, setHqPlayerDraft] = useState<HqPlayerSettings>(defaultHqPlayerSettings);
  const [hqPlayerStatus, setHqPlayerStatus] = useState<HqPlayerStatus | null>(null);
  const [hqPlayerTestResult, setHqPlayerTestResult] = useState<HqPlayerConnectionTestResult | null>(null);
  const [hqPlayerLastHandoff, setHqPlayerLastHandoff] = useState<HqPlayerPlaybackHandoffPlan | null>(null);
  const [hqPlayerLastControl, setHqPlayerLastControl] = useState<HqPlayerPlaybackControlPlan | null>(null);
  const [hqPlayerBusy, setHqPlayerBusy] = useState<'settings' | 'test' | null>(null);
  const [shouldRenderHqPlayerDetails, setShouldRenderHqPlayerDetails] = useState(defaultHqPlayerSettings.enabled);
  const [hiddenDeviceIds, setHiddenDeviceIds] = useState<Set<string>>(() => readStoredStringSet(hiddenConnectDevicesStorageKey));
  const [isCommandCenterCollapsed, setIsCommandCenterCollapsed] = useState(() =>
    readStoredBoolean(connectCommandCenterCollapsedStorageKey, false),
  );
  const [isEchoLinkPanelCollapsed, setIsEchoLinkPanelCollapsed] = useState(() =>
    readStoredBoolean(connectEchoLinkPanelCollapsedStorageKey, false),
  );
  const [isDeviceSectionCollapsed, setIsDeviceSectionCollapsed] = useState(() =>
    readStoredBoolean(connectDeviceSectionCollapsedStorageKey, false),
  );
  const [isRadioPanelCollapsed, setIsRadioPanelCollapsed] = useState(() =>
    readStoredBoolean(connectRadioPanelCollapsedStorageKey, false),
  );
  const [isLivePanelCollapsed, setIsLivePanelCollapsed] = useState(() =>
    readStoredBoolean(connectLivePanelCollapsedStorageKey, false),
  );
  const [isHqPlayerPanelCollapsed, setIsHqPlayerPanelCollapsed] = useState(() =>
    readStoredBoolean(connectHqPlayerPanelCollapsedStorageKey, false),
  );
  const [isListeningRoomCollapsed, setIsListeningRoomCollapsed] = useState(() =>
    readStoredBoolean(connectListeningRoomCollapsedStorageKey, true),
  );

  const activeDevice = useMemo(
    () => devices.find((device) => device.id === status.deviceId) ?? null,
    [devices, status.deviceId],
  );
  const visibleDevices = useMemo(
    () => devices.filter((device) => !hiddenDeviceIds.has(device.id)),
    [devices, hiddenDeviceIds],
  );
  const hiddenDeviceEntries = useMemo(
    () => [...hiddenDeviceIds].map((deviceId) => ({
      id: deviceId,
      name: devices.find((device) => device.id === deviceId)?.name ?? deviceId,
    })),
    [devices, hiddenDeviceIds],
  );
  const hiddenDeviceCount = hiddenDeviceIds.size;
  const airPlayDebugText = useMemo(
    () => airPlayReceiverStatus.debugEvents.map(formatReceiverDebugEvent).join('\n'),
    [airPlayReceiverStatus.debugEvents],
  );
  const currentTrack = queue.currentTrack ?? queue.lastPlayedTrack ?? null;
  const currentFilePath =
    currentTrack?.path ??
    playbackStatus.audioStatus?.currentFilePath ??
    playbackStatus.playbackStatus?.filePath ??
    null;
  const currentPositionSeconds =
    playbackStatus.audioStatus?.positionSeconds ??
    (playbackStatus.playbackStatus?.positionMs ?? 0) / 1000;
  const previewTitle = status.metadata?.title ?? currentTrack?.title ?? (currentFilePath ? currentFilePath.split(/[\\/]/u).pop() : t('connectPage.nowPlaying.emptyTitle'));
  const previewArtist = status.metadata?.artist ?? currentTrack?.artist ?? currentTrack?.albumArtist ?? t('miniPlayer.artist.unknown');
  const previewAlbum = status.metadata?.album ?? currentTrack?.album ?? null;
  const previewCover = status.metadata?.coverHttpUrl ?? currentTrack?.coverThumb ?? null;
  const progressPercent =
    status.durationSeconds > 0 ? Math.min(100, Math.max(0, (status.positionSeconds / status.durationSeconds) * 100)) : 0;
  const receiverTitle =
    receiverStatus.metadata?.title ??
    (receiverStatus.currentUri ? receiverStatus.currentUri.split(/[?#]/u)[0]?.split(/[\\/]/u).pop() : null) ??
    t('connectPage.receiver.waitingTitle');
  const receiverArtist = receiverStatus.metadata?.artist ?? t('miniPlayer.artist.unknown');
  const receiverAlbum = receiverStatus.metadata?.album ?? null;
  const receiverCover = receiverStatus.metadata?.coverHttpUrl || null;
  const receiverProgressPercent =
    receiverStatus.durationSeconds > 0
      ? Math.min(100, Math.max(0, (receiverStatus.positionSeconds / receiverStatus.durationSeconds) * 100))
      : 0;
  const airPlayTitle = airPlayReceiverStatus.metadata?.title ?? t('connectPage.airplay.waitingTitle');
  const airPlayArtist = airPlayReceiverStatus.metadata?.artist ?? t('miniPlayer.artist.unknown');
  const airPlayAlbum = airPlayReceiverStatus.metadata?.album ?? null;
  const airPlayCover = airPlayReceiverStatus.artworkUrl || airPlayReceiverStatus.metadata?.coverHttpUrl || null;
  const airPlayProgressPercent =
    airPlayReceiverStatus.durationSeconds > 0
      ? Math.min(100, Math.max(0, (airPlayReceiverStatus.positionSeconds / airPlayReceiverStatus.durationSeconds) * 100))
      : 0;
  const hqPlayerEffectiveDraft = useMemo(
    () => withHqPlayerFriendlyDefaults(hqPlayerDraft),
    [hqPlayerDraft],
  );
  const hqPlayerState: HqPlayerStatus['state'] =
    hqPlayerStatus?.state ?? (hqPlayerDraft.enabled ? (hqPlayerEffectiveDraft.port ? 'unavailable' : 'not-configured') : 'disabled');
  const isHqPlayerExpanded = hqPlayerDraft.enabled;
  const shouldShowHqPlayerDetails = isHqPlayerExpanded || shouldRenderHqPlayerDetails;
  const hqPlayerEndpointLabel = formatHqEndpoint({
    host: hqPlayerStatus?.endpoint.host ?? hqPlayerEffectiveDraft.host,
    port: hqPlayerStatus?.endpoint.port ?? hqPlayerEffectiveDraft.port,
  }, t);
  const hqPlayerControlPlan = hqPlayerLastControl ?? hqPlayerLastHandoff?.control ?? null;
  const hqPlayerLastReason = hqPlayerLastHandoff?.reason ? t(hqPlayerHandoffReasonLabel[hqPlayerLastHandoff.reason]) : null;
  const hqPlayerCurrentPlayable = useMemo(
    () => toHqPlayerPlayableTrack(currentTrack, currentFilePath),
    [currentFilePath, currentTrack],
  );
  const hqPlayerSendMessage = formatHqPlayerSendMessage(hqPlayerControlPlan, t);
  const hqPlayerControlInfo = hqPlayerTestResult?.controlInfo ?? hqPlayerStatus?.controlInfo ?? null;
  const hqPlayerPlaybackStatus = hqPlayerTestResult?.playbackStatus ?? hqPlayerStatus?.playbackStatus ?? null;
  const hqPlayerProductLabel = formatHqPlayerProduct(hqPlayerControlInfo, t);
  const hqPlayerEngineLabel = formatHqPlayerEngine(hqPlayerControlInfo, t);
  const hqPlayerRemotePositionLabel = formatHqPlayerRemotePosition(hqPlayerPlaybackStatus, t);
  const hqPlayerSignalLabel = formatHqPlayerSignal(hqPlayerPlaybackStatus, t);
  const hqPlayerMediaServerLabel = hqPlayerLastHandoff?.source?.mediaServer
    ? `${hqPlayerLastHandoff.source.mediaServer.publicHost ?? 'unknown'}:${hqPlayerLastHandoff.source.mediaServer.port ?? 'auto'}`
    : null;
  const activeDeviceCapabilities = activeDevice?.capabilities ?? null;
  const activeTargetLabel = activeDevice
    ? `${formatProtocol(activeDevice)} · ${activeDevice.name}`
    : status.deviceId
      ? status.deviceId
      : t('connectPage.nowPlaying.noOutput');
  const activeDeviceInfoLabel = activeDevice
    ? `${formatDeviceProduct(activeDevice, t)} · ${formatDeviceAddress(activeDevice, t)}`
    : t('connectPage.nowPlaying.chooseDevice');
  const activeMediaInfoLabel = [
    status.metadata?.coverHttpUrl ? t('connectPage.nowPlaying.coverReady') : t('connectPage.nowPlaying.coverWaiting'),
    status.latencyMs != null ? t('connectPage.nowPlaying.latency', { ms: status.latencyMs }) : null,
    activeDevice?.protocol === 'dlna' ? t('connectPage.nowPlaying.dlnaPolling') : null,
  ].filter(Boolean).join(' · ');
  const outgoingHttpEvents = status.httpEvents ?? [];
  const playbackTrackId = playbackStatus.playbackStatus?.currentTrackId ?? playbackStatus.audioStatus?.currentTrackId ?? null;
  const playbackFilePath = playbackStatus.playbackStatus?.filePath ?? playbackStatus.audioStatus?.currentFilePath ?? null;
  const playbackState = playbackStatus.playbackStatus?.state ?? playbackStatus.audioStatus?.state ?? 'idle';
  const activeRadioStation = radioStations.find((station) =>
    station.id === activeRadioId ||
    radioTrackIdForUrl(station.url) === playbackTrackId ||
    station.url === playbackFilePath,
  ) ?? null;
  const isRadioActive = Boolean(
    activeRadioStation &&
      (playbackState === 'loading' || playbackState === 'playing' || playbackState === 'paused'),
  );
  const radioStatusLabel = activeRadioStation
    ? `${playbackState === 'playing' ? t('connectPage.radio.state.playing') : playbackState === 'paused' ? t('connectPage.state.paused') : t('connectPage.radio.state.preparing')} · ${activeRadioStation.name}`
    : t('connectPage.radio.state.inactive');
  const liveTrackId = lastResolvedLive ? liveTrackIdForUrl(lastResolvedLive.pageUrl || lastResolvedLive.sourceUrl) : null;
  const isLiveActive = Boolean(
    (activeLiveUrl || liveTrackId) &&
      (playbackTrackId === liveTrackId || (activeLiveUrl && playbackFilePath === activeLiveUrl)) &&
      (playbackState === 'loading' || playbackState === 'playing' || playbackState === 'paused'),
  );
  const liveStatusLabel = lastResolvedLive
    ? isLiveActive
      ? `${playbackState === 'playing' ? t('connectPage.radio.state.playing') : playbackState === 'paused' ? t('connectPage.state.paused') : t('connectPage.radio.state.preparing')} 路 ${lastResolvedLive.title}`
      : `已解析 路 ${lastResolvedLive.title}`
    : '未连接直播';
  const echoLinkHosts = useMemo(() => {
    const candidates = echoLinkStatus.addresses.length > 0 ? echoLinkStatus.addresses : [echoLinkStatus.host];
    return [...new Set(candidates.filter((address) => address.trim().length > 0))];
  }, [echoLinkStatus.addresses, echoLinkStatus.host]);
  const echoLinkSelectedHost = selectedEchoLinkHost && echoLinkHosts.includes(selectedEchoLinkHost)
    ? selectedEchoLinkHost
    : echoLinkStatus.host;
  const echoLinkPairingUri = createEchoLinkPairingUri(echoLinkStatus, echoLinkSelectedHost) ?? echoLinkStatus.pairingUri;
  const echoLinkWebControlUrl = createEchoLinkWebControlUrl(echoLinkStatus, echoLinkSelectedHost) ?? echoLinkStatus.webControlUrl;
  const echoLinkAddressLabel = echoLinkHosts.length > 0
    ? echoLinkHosts.map((address) => `${address}:${echoLinkStatus.port}`).join(' / ')
    : `${echoLinkStatus.host}:${echoLinkStatus.port}`;
  const echoLinkTokenLabel = showEchoLinkToken
    ? echoLinkStatus.token
    : echoLinkStatus.token
      ? `${echoLinkStatus.token.slice(0, 6)}...${echoLinkStatus.token.slice(-6)}`
      : '-';
  const lanStreamerCount = visibleDevices.filter((device) => device.protocol === 'dlna').length;
  const airPlayOutputCount = visibleDevices.filter((device) => device.protocol === 'airplay').length;
  const hqPlayerOutputCount = visibleDevices.filter((device) => device.protocol === 'hqplayer').length;
  const echoLinkStatusLabel = echoLinkStatus.running ? t('connectPage.echoLink.state.running') : echoLinkStatus.error ? t('connectPage.echoLink.state.error') : echoLinkStatus.enabled ? t('connectPage.echoLink.state.starting') : t('connectPage.common.disabled');
  const echoLinkWebStatusLabel = echoLinkWebControlUrl ? t('connectPage.echoLink.webReady') : t('connectPage.echoLink.webWaiting');
  const echoLinkWebBackground = echoLinkStatus.webBackground ?? defaultEchoLinkWebBackground;
  const echoLinkWebBackgroundConfigured = echoLinkWebBackground.type !== 'none' && echoLinkWebBackground.url.trim().length > 0;
  const echoLinkWebBackgroundSaveDisabled = isEchoLinkBackgroundBusy || (echoLinkWebBackgroundDraft.type !== 'none' && echoLinkWebBackgroundDraft.url.trim().length === 0);
  const receiverCommandLabel = receiverStatus.enabled ? t(receiverStateLabel[receiverStatus.state]) : t('connectPage.common.disabled');
  const airPlayCommandLabel = airPlayReceiverStatus.enabled ? t(airPlayStateLabel[airPlayReceiverStatus.state]) : t('connectPage.common.disabled');
  const latestEchoLinkHttpError = echoLinkStatus.diagnostics.recentHttpErrors[0] ?? null;
  const commandCenterIssues = [
    error ? { source: 'Connect', detail: error } : null,
    status.error ? { source: 'Output', detail: status.error } : null,
    receiverStatus.error ? { source: 'DLNA Receiver', detail: receiverStatus.error } : null,
    airPlayReceiverStatus.error ? { source: 'AirPlay', detail: airPlayReceiverStatus.error } : null,
    echoLinkStatus.error ? { source: 'ECHO Link', detail: echoLinkStatus.error } : null,
    echoLinkStatus.mdns.error ? { source: 'mDNS', detail: echoLinkStatus.mdns.error } : null,
    latestEchoLinkHttpError ? { source: 'Web Remote', detail: latestEchoLinkHttpError.message } : null,
    hqPlayerStatus?.lastError ? { source: 'HQPlayer', detail: hqPlayerStatus.lastError } : null,
  ].filter((issue): issue is { source: string; detail: string } => Boolean(issue?.detail?.trim())).slice(0, 4);
  const commandCenterHealth =
    commandCenterIssues.length > 0
      ? 'warning'
      : status.state === 'playing' || receiverStatus.state === 'playing' || airPlayReceiverStatus.state === 'playing'
        ? 'active'
        : echoLinkStatus.running || visibleDevices.length > 0 || hqPlayerState === 'available'
          ? 'online'
          : 'idle';
  const commandCenterHealthLabel =
    commandCenterHealth === 'warning'
      ? t('connectPage.commandCenter.health.warning')
      : commandCenterHealth === 'active'
        ? t('connectPage.commandCenter.health.active')
        : commandCenterHealth === 'online'
          ? t('connectPage.commandCenter.health.online')
          : t('connectPage.state.idle');
  const commandCenterRouteLabel = status.deviceId
    ? t('connectPage.commandCenter.route.output', { target: activeTargetLabel })
    : receiverStatus.state === 'playing'
      ? `Phone / ${receiverStatus.advertisedName}`
      : airPlayReceiverStatus.state === 'playing'
        ? `AirPlay / ${airPlayReceiverStatus.advertisedName}`
        : t('connectPage.commandCenter.route.waiting');
  const commandCenterErrorLabel = commandCenterIssues[0]
    ? `${commandCenterIssues[0].source}: ${commandCenterIssues[0].detail}`
    : t('connectPage.commandCenter.noRecentFailures');

  const echoLinkRoomState: ListeningRoomNodeState = echoLinkStatus.error
    ? 'warning'
    : echoLinkStatus.activeMediaTokens > 0
      ? 'active'
      : echoLinkStatus.running
        ? 'online'
        : 'idle';
  const dlnaReceiverRoomState: ListeningRoomNodeState = receiverStatus.error
    ? 'warning'
    : receiverStatus.state === 'playing' || receiverStatus.state === 'loading'
      ? 'active'
      : receiverStatus.enabled
        ? 'online'
        : 'idle';
  const airPlayRoomState: ListeningRoomNodeState = airPlayReceiverStatus.error
    ? 'warning'
    : airPlayReceiverStatus.state === 'playing' || airPlayReceiverStatus.state === 'starting'
      ? 'active'
      : airPlayReceiverStatus.enabled
        ? 'online'
        : 'idle';
  const hqPlayerRoomState: ListeningRoomNodeState = hqPlayerStatus?.lastError
    ? 'warning'
    : hqPlayerPlaybackStatus?.state === 'playing'
      ? 'active'
      : hqPlayerState === 'available'
        ? 'online'
        : hqPlayerState === 'unavailable' || hqPlayerState === 'not-configured'
          ? 'warning'
          : 'idle';
  const outputRoomState: ListeningRoomNodeState = status.error
    ? 'warning'
    : status.deviceId
      ? 'active'
      : visibleDevices.length > 0
        ? 'online'
        : 'idle';
  const wallpaperRoomState: ListeningRoomNodeState = wallpaperEngineBridgeStatus.eventClients > 0
    ? 'active'
    : wallpaperEngineBridgeStatus.running
      ? 'online'
      : 'idle';
  const wallpaperEndpointLabel = wallpaperEngineBridgeStatus.url ??
    (wallpaperEngineBridgeStatus.port === null
      ? '127.0.0.1:47668'
      : `${wallpaperEngineBridgeStatus.host}:${wallpaperEngineBridgeStatus.port}`);
  const listeningRoomNodes: ListeningRoomNode[] = [
    {
      id: 'echo-link',
      state: echoLinkRoomState,
      eyebrow: 'Mobile',
      title: t('connectPage.room.phone.title'),
      detail: echoLinkStatus.running ? t('connectPage.room.phone.available') : t('connectPage.room.phone.offline'),
      metric: echoLinkStatus.diagnostics.lastPhoneConnectionAt
        ? t('connectPage.room.phone.last', { time: new Date(echoLinkStatus.diagnostics.lastPhoneConnectionAt).toLocaleTimeString() })
        : echoLinkAddressLabel,
      icon: <Smartphone size={19} />,
    },
    {
      id: 'outputs',
      state: outputRoomState,
      eyebrow: 'Outputs',
      title: status.deviceId ? t('connectPage.room.outputs.current') : t('connectPage.room.outputs.available'),
      detail: status.deviceId ? t(stateLabel[status.state]) : t('connectPage.room.outputs.discovered', { count: visibleDevices.length }),
      metric: status.deviceId
        ? t('connectPage.room.outputs.target', { target: activeTargetLabel })
        : t('connectPage.room.outputs.summary', { dlna: lanStreamerCount, airplay: airPlayOutputCount, hqplayer: hqPlayerOutputCount }),
      icon: <SlidersHorizontal size={19} />,
    },
    {
      id: 'dlna',
      state: dlnaReceiverRoomState,
      eyebrow: 'Inbound',
      title: t('connectPage.room.dlna.title'),
      detail: receiverCommandLabel,
      metric: receiverStatus.currentClient?.address ?? t('connectPage.room.dlna.addressCount', { count: receiverStatus.addresses.length }),
      icon: <Radio size={19} />,
    },
    {
      id: 'hqplayer',
      state: hqPlayerRoomState,
      eyebrow: 'External DSP',
      title: 'HQPlayer',
      detail: t(hqPlayerStateLabel[hqPlayerState]),
      metric: hqPlayerPlaybackStatus?.state ? t('connectPage.room.hqplayer.remote', { state: hqPlayerPlaybackStatus.state }) : hqPlayerEndpointLabel,
      icon: <Cable size={19} />,
    },
    {
      id: 'airplay',
      state: airPlayRoomState,
      eyebrow: 'Inbound',
      title: t('connectPage.room.airplay.title'),
      detail: airPlayCommandLabel,
      metric: airPlayReceiverStatus.currentClient?.address ?? (airPlayReceiverProtocol === 'airplay2' ? t('connectPage.airplay.protocol.airplay2') : t('connectPage.airplay.protocol.airplay1')),
      icon: <Cast size={19} />,
    },
    {
      id: 'wallpaper',
      state: wallpaperRoomState,
      eyebrow: 'Visual layer',
      title: 'Wallpaper Engine',
      detail: wallpaperEngineBridgeStatus.eventClients > 0
        ? t('connectPage.room.wallpaper.liveClients', { count: wallpaperEngineBridgeStatus.eventClients })
        : wallpaperEngineBridgeStatus.running
          ? t('connectPage.room.wallpaper.ready')
          : t('connectPage.room.wallpaper.offline'),
      metric: wallpaperEndpointLabel,
      icon: <Volume2 size={19} />,
    },
  ];

  const refreshDonatorUnlockStatus = useCallback(async (options: { force?: boolean } = {}): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect) {
      setDonatorUnlockStatus(defaultDonatorUnlockStatus);
      setIsDonatorUnlockLoading(false);
      return;
    }

    if (options.force === true || connectDonatorUnlockStatusCache?.bridge !== connect) {
      setIsDonatorUnlockLoading(true);
    }
    try {
      setDonatorUnlockStatus(await loadConnectDonatorUnlockStatus(connect, options.force === true));
    } catch {
      setDonatorUnlockStatus(defaultDonatorUnlockStatus);
    } finally {
      setIsDonatorUnlockLoading(false);
    }
  }, []);

  const refreshEchoLink = useCallback(async (): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect?.getEchoLinkStatus) {
      return;
    }

    try {
      setEchoLinkStatus(await connect.getEchoLinkStatus());
    } catch {
      // Keep the rest of Connect usable when running against an older bridge.
    }
  }, []);

  const refreshWallpaperEngineBridge = useCallback(async (): Promise<void> => {
    const getStatus = window.echo?.connect?.getWallpaperEngineBridgeStatus;
    if (!getStatus) {
      return;
    }

    try {
      setWallpaperEngineBridgeStatus(await getStatus());
    } catch {
      // Older preload bridges simply omit the Wallpaper Engine node status.
    }
  }, []);

  const refreshDevices = useCallback(async (options: { force?: boolean } = {}): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect) {
      setError(t('connectPage.error.desktopBridgeConnect'));
      return;
    }

    setIsRefreshing(true);
    setError(null);
    try {
      const [nextDevices, nextStatus] = await Promise.all([
        loadConnectDevices(connect, options.force === true),
        connect.getStatus(),
      ]);
      setDevices(nextDevices);
      setStatus(nextStatus);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setIsRefreshing(false);
    }
  }, [t]);

  const refreshHqPlayer = useCallback(async (): Promise<void> => {
    const hqPlayer = window.echo?.hqPlayer;
    if (!hqPlayer) {
      return;
    }

    try {
      const [settings, nextStatus, lastHandoff, lastControl] = await Promise.all([
        hqPlayer.getSettings(),
        hqPlayer.getStatus(),
        hqPlayer.getLastPlaybackHandoff(),
        hqPlayer.getLastPlaybackControl(),
      ]);
      const effectiveSettings = withHqPlayerFriendlyDefaults(settings);
      setHqPlayerDraft(effectiveSettings);
      setHqPlayerStatus(nextStatus);
      setHqPlayerLastHandoff(lastHandoff);
      setHqPlayerLastControl(lastControl);
    } catch {
      // Keep Connect usable when running against an older preload bridge.
    }
  }, []);

  const refreshCommandCenter = useCallback((): void => {
    void refreshDevices({ force: true });
    void refreshEchoLink();
    void refreshWallpaperEngineBridge();
    void refreshHqPlayer();
  }, [refreshDevices, refreshEchoLink, refreshHqPlayer, refreshWallpaperEngineBridge]);

  const refreshCommandCenterSoft = useCallback((): void => {
    void refreshDevices();
    void refreshEchoLink();
    void refreshWallpaperEngineBridge();
    void refreshHqPlayer();
  }, [refreshDevices, refreshEchoLink, refreshHqPlayer, refreshWallpaperEngineBridge]);

  useEffect(() => {
    if (!selectedEchoLinkHost || echoLinkHosts.includes(selectedEchoLinkHost)) {
      return;
    }
    setSelectedEchoLinkHost(null);
  }, [echoLinkHosts, selectedEchoLinkHost]);

  useEffect(() => {
    setEchoLinkWebBackgroundDraft({
      type: echoLinkWebBackground.type,
      url: echoLinkWebBackground.url,
    });
  }, [echoLinkWebBackground.type, echoLinkWebBackground.url]);

  useEffect(() => {
    if (!echoLinkPairingUri) {
      setEchoLinkQrDataUrl(null);
      return;
    }

    let disposed = false;
    void QRCode.toDataURL(echoLinkPairingUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 180,
      color: {
        dark: '#111827ff',
        light: '#ffffffff',
      },
    }).then((dataUrl) => {
      if (!disposed) {
        setEchoLinkQrDataUrl(dataUrl);
      }
    }).catch(() => {
      if (!disposed) {
        setEchoLinkQrDataUrl(null);
      }
    });

    return () => {
      disposed = true;
    };
  }, [echoLinkPairingUri]);

  useEffect(() => {
    void refreshDonatorUnlockStatus();
    const handleUnlockChanged = (): void => {
      invalidateConnectDonatorUnlockStatusCache();
      void refreshDonatorUnlockStatus({ force: true });
    };
    window.addEventListener('plugins:changed', handleUnlockChanged);
    window.addEventListener('echo-pro:status-changed', handleUnlockChanged);
    return () => {
      window.removeEventListener('plugins:changed', handleUnlockChanged);
      window.removeEventListener('echo-pro:status-changed', handleUnlockChanged);
    };
  }, [refreshDonatorUnlockStatus]);

  useEffect(() => {
    const connect = window.echo?.connect;
    if (!connect || donatorUnlockStatus.unlocked !== true) {
      return;
    }

    let disposed = false;
    void connect
      .getStatus()
      .then((nextStatus) => {
        if (!disposed) {
          setStatus(nextStatus);
        }
      })
      .catch(() => undefined);
    if (connect.getReceiverStatus) {
      void connect.getReceiverStatus().then((nextStatus) => {
        if (!disposed) {
          setReceiverStatus(nextStatus);
        }
      }).catch(() => undefined);
    }
    if (connect.getAirPlayReceiverStatus) {
      void connect.getAirPlayReceiverStatus().then((nextStatus) => {
        if (!disposed) {
          setAirPlayReceiverStatus(nextStatus);
        }
      }).catch(() => undefined);
    }
    void window.echo?.app?.getSettings?.().then((settings: AppSettings) => {
      if (!disposed) {
        setAutoStartReceiversEnabled(settings.connectAutoStartReceiversEnabled === true);
        setAirPlayReceiverProtocol(settings.airPlayReceiverProtocol === 'airplay2' ? 'airplay2' : 'airplay1');
      }
    }).catch(() => undefined);
    refreshCommandCenterSoft();
    const unsubscribe = connect.onStatus((nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus.error) {
        setError(nextStatus.error);
      }
    });
    const unsubscribeReceiver = connect.onReceiverStatus?.((nextStatus) => {
      setReceiverStatus(nextStatus);
      if (nextStatus.error) {
        setError(nextStatus.error);
      }
    }) ?? (() => undefined);
    const unsubscribeAirPlayReceiver = connect.onAirPlayReceiverStatus?.((nextStatus) => {
      setAirPlayReceiverStatus(nextStatus);
      if (nextStatus.protocol) {
        setAirPlayReceiverProtocol(nextStatus.protocol);
      }
      if (nextStatus.error) {
        setError(nextStatus.error);
      }
    }) ?? (() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeReceiver();
      unsubscribeAirPlayReceiver();
    };
  }, [donatorUnlockStatus.unlocked, refreshCommandCenterSoft]);

  useEffect(() => {
    if (isHqPlayerExpanded) {
      setShouldRenderHqPlayerDetails(true);
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setShouldRenderHqPlayerDetails(false);
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [isHqPlayerExpanded]);

  const toggleAutoStartReceivers = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.setSettings) {
      setError(t('connectPage.error.desktopBridgeSettings'));
      return;
    }

    const connectAutoStartReceiversEnabled = !autoStartReceiversEnabled;
    setIsAutoStartBusy(true);
    setError(null);
    try {
      const settings = await app.setSettings({ connectAutoStartReceiversEnabled });
      setAutoStartReceiversEnabled(settings.connectAutoStartReceiversEnabled === true);
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: { connectAutoStartReceiversEnabled } }));
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
    } finally {
      setIsAutoStartBusy(false);
    }
  }, [autoStartReceiversEnabled, t]);

  const patchHqPlayerDraft = useCallback((patch: Partial<HqPlayerSettings>): void => {
    setHqPlayerDraft((current) => withHqPlayerFriendlyDefaults({ ...current, ...patch }));
    setHqPlayerTestResult(null);
  }, []);

  const saveHqPlayerSettings = useCallback(async (settings: HqPlayerSettings = hqPlayerEffectiveDraft): Promise<HqPlayerSettings | null> => {
    const hqPlayer = window.echo?.hqPlayer;
    if (!hqPlayer) {
      setError(t('connectPage.error.desktopBridgeHqPlayerConfig'));
      return null;
    }

    const saved = await hqPlayer.setSettings(withHqPlayerFriendlyDefaults(settings));
    setHqPlayerDraft(withHqPlayerFriendlyDefaults(saved));
    setHqPlayerStatus(await hqPlayer.getStatus());
    window.dispatchEvent(new CustomEvent('settings:changed', { detail: { hqPlayer: saved } }));
    return saved;
  }, [hqPlayerEffectiveDraft, t]);

  const handleHqPlayerTestConnection = useCallback(async (): Promise<void> => {
    const hqPlayer = window.echo?.hqPlayer;
    if (!hqPlayer) {
      setError(t('connectPage.error.desktopBridgeHqPlayerTest'));
      return;
    }

    setHqPlayerBusy('test');
    setError(null);
    try {
      const saved = await saveHqPlayerSettings(createHqPlayerConnectSettings(hqPlayerEffectiveDraft));
      if (!saved) {
        return;
      }
      const result = await hqPlayer.testConnection(saved);
      setHqPlayerTestResult(result);
      setHqPlayerStatus(await hqPlayer.getStatus());
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : String(testError));
    } finally {
      setHqPlayerBusy(null);
    }
  }, [hqPlayerEffectiveDraft, saveHqPlayerSettings]);

  const toggleHqPlayerEnabled = useCallback(async (): Promise<void> => {
    const nextSettings = hqPlayerDraft.enabled
      ? { ...hqPlayerEffectiveDraft, enabled: false }
      : createHqPlayerConnectSettings(hqPlayerEffectiveDraft);

    setHqPlayerBusy('settings');
    setError(null);
    try {
      if (hqPlayerDraft.enabled) {
        const connect = window.echo?.connect;
        const connectStatus = await connect?.getStatus?.().catch(() => null);
        if (connectStatus?.protocol === 'hqplayer' && connectStatus.deviceId === hqPlayerConnectDeviceId && connect?.disconnect) {
          setStatus(await connect.disconnect());
        }
      }

      await saveHqPlayerSettings(nextSettings);
      setDevices(await window.echo?.connect?.refresh?.() ?? devices);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    } finally {
      setHqPlayerBusy(null);
    }
  }, [devices, hqPlayerDraft.enabled, hqPlayerEffectiveDraft, saveHqPlayerSettings]);

  const toggleReceiver = useCallback(async (): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect?.setReceiverEnabled) {
      setError(t('connectPage.error.desktopBridgeConnect'));
      return;
    }

    setIsReceiverBusy(true);
    setError(null);
    try {
      setReceiverStatus(await connect.setReceiverEnabled(!receiverStatus.enabled));
    } catch (receiverError) {
      setError(receiverError instanceof Error ? receiverError.message : String(receiverError));
    } finally {
      setIsReceiverBusy(false);
    }
  }, [receiverStatus.enabled, t]);

  const toggleEchoLink = useCallback(async (): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect?.setEchoLinkEnabled) {
      setError(t('connectPage.error.desktopBridgeEchoLink'));
      return;
    }

    setIsEchoLinkBusy(true);
    setError(null);
    try {
      const nextStatus = await connect.setEchoLinkEnabled(!echoLinkStatus.enabled);
      setEchoLinkStatus(nextStatus);
      if (nextStatus.error) {
        setError(nextStatus.error);
      }
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : String(linkError));
    } finally {
      setIsEchoLinkBusy(false);
    }
  }, [echoLinkStatus.enabled, t]);

  const copyEchoLinkPairing = useCallback(async (): Promise<void> => {
    const value = echoLinkPairingUri ?? '';
    if (!value) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopiedEchoLinkPairing(true);
    window.setTimeout(() => setCopiedEchoLinkPairing(false), 1400);
  }, [echoLinkPairingUri]);

  const copyEchoLinkWebControl = useCallback(async (): Promise<void> => {
    const value = echoLinkWebControlUrl ?? '';
    if (!value || !navigator.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopiedEchoLinkWebControl(true);
    window.setTimeout(() => setCopiedEchoLinkWebControl(false), 1400);
  }, [echoLinkWebControlUrl]);

  const openEchoLinkWebControl = useCallback(async (): Promise<void> => {
    const value = echoLinkWebControlUrl ?? '';
    if (!value) {
      return;
    }
    await window.echo?.app?.openExternalUrl?.(value);
  }, [echoLinkWebControlUrl]);

  const applyEchoLinkWebBackground = useCallback(async (background: EchoLinkWebBackground): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect?.setEchoLinkWebBackground) {
      setError(t('connectPage.error.desktopBridgeEchoLink'));
      return;
    }

    setIsEchoLinkBackgroundBusy(true);
    setError(null);
    try {
      const nextStatus = await connect.setEchoLinkWebBackground(background);
      setEchoLinkStatus(nextStatus);
      setSavedEchoLinkBackground(true);
      window.setTimeout(() => setSavedEchoLinkBackground(false), 1400);
    } catch (backgroundError) {
      setError(backgroundError instanceof Error ? backgroundError.message : String(backgroundError));
    } finally {
      setIsEchoLinkBackgroundBusy(false);
    }
  }, [t]);

  const saveEchoLinkWebBackground = useCallback(async (): Promise<void> => {
    await applyEchoLinkWebBackground({
      type: echoLinkWebBackgroundDraft.type,
      url: echoLinkWebBackgroundDraft.url.trim(),
    });
  }, [applyEchoLinkWebBackground, echoLinkWebBackgroundDraft.type, echoLinkWebBackgroundDraft.url]);

  const clearEchoLinkWebBackground = useCallback(async (): Promise<void> => {
    await applyEchoLinkWebBackground(defaultEchoLinkWebBackground);
  }, [applyEchoLinkWebBackground]);

  const chooseEchoLinkWebBackgroundImage = useCallback(async (): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect?.chooseEchoLinkWebBackgroundImage) {
      setError(t('connectPage.error.desktopBridgeEchoLink'));
      return;
    }

    setIsEchoLinkBackgroundBusy(true);
    setError(null);
    try {
      const nextStatus = await connect.chooseEchoLinkWebBackgroundImage();
      if (nextStatus) {
        setEchoLinkStatus(nextStatus);
        setSavedEchoLinkBackground(true);
        window.setTimeout(() => setSavedEchoLinkBackground(false), 1400);
      }
    } catch (backgroundError) {
      setError(backgroundError instanceof Error ? backgroundError.message : String(backgroundError));
    } finally {
      setIsEchoLinkBackgroundBusy(false);
    }
  }, [t]);

  const rotateEchoLinkToken = useCallback(async (): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect?.rotateEchoLinkToken) {
      setError(t('connectPage.error.desktopBridgeEchoLinkToken'));
      return;
    }

    setIsEchoLinkBusy(true);
    setError(null);
    try {
      setEchoLinkStatus(await connect.rotateEchoLinkToken());
      setShowEchoLinkToken(true);
    } catch (tokenError) {
      setError(tokenError instanceof Error ? tokenError.message : String(tokenError));
    } finally {
      setIsEchoLinkBusy(false);
    }
  }, [t]);

  const stopReceiverPlayback = useCallback(async (): Promise<void> => {
    const connect = window.echo?.connect;
    setIsReceiverBusy(true);
    setError(null);
    try {
      if (connect?.stopReceiverPlayback) {
        setReceiverStatus(await connect.stopReceiverPlayback());
      } else {
        await window.echo?.playback.stop();
        if (connect?.getReceiverStatus) {
          setReceiverStatus(await connect.getReceiverStatus());
        }
      }
    } catch (receiverError) {
      setError(receiverError instanceof Error ? receiverError.message : String(receiverError));
    } finally {
      setIsReceiverBusy(false);
    }
  }, []);

  const toggleAirPlayReceiver = useCallback(async (): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect?.setAirPlayReceiverEnabled) {
      setError(t('connectPage.error.airplayBridge'));
      return;
    }

    setIsAirPlayReceiverBusy(true);
    setError(null);
    try {
      setAirPlayReceiverStatus(await connect.setAirPlayReceiverEnabled(!airPlayReceiverStatus.enabled));
    } catch (receiverError) {
      setError(receiverError instanceof Error ? receiverError.message : String(receiverError));
    } finally {
      setIsAirPlayReceiverBusy(false);
    }
  }, [airPlayReceiverStatus.enabled, t]);

  const setAirPlayProtocol = useCallback(async (protocol: AirPlayReceiverProtocol): Promise<void> => {
    if (protocol === airPlayReceiverProtocol && airPlayReceiverStatus.protocol === protocol) {
      return;
    }
    const app = window.echo?.app;
    const connect = window.echo?.connect;
    if (!app?.setSettings) {
      setError(t('connectPage.error.airplayProtocolBridge'));
      return;
    }

    setIsAirPlayReceiverBusy(true);
    setError(null);
    try {
      const settings = await app.setSettings({ airPlayReceiverProtocol: protocol });
      const savedProtocol = settings.airPlayReceiverProtocol === 'airplay2' ? 'airplay2' : 'airplay1';
      setAirPlayReceiverProtocol(savedProtocol);
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: { airPlayReceiverProtocol: savedProtocol } }));
      if (airPlayReceiverStatus.enabled && connect?.setAirPlayReceiverEnabled) {
        await connect.setAirPlayReceiverEnabled(false);
        setAirPlayReceiverStatus(await connect.setAirPlayReceiverEnabled(true));
      } else if (connect?.getAirPlayReceiverStatus) {
        setAirPlayReceiverStatus(await connect.getAirPlayReceiverStatus());
      }
    } catch (protocolError) {
      setError(protocolError instanceof Error ? protocolError.message : String(protocolError));
    } finally {
      setIsAirPlayReceiverBusy(false);
    }
  }, [airPlayReceiverProtocol, airPlayReceiverStatus.enabled, airPlayReceiverStatus.protocol, t]);

  const stopAirPlayReceiverPlayback = useCallback(async (): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect?.stopAirPlayReceiverPlayback) {
      setError(t('connectPage.error.airplayBridge'));
      return;
    }

    setIsAirPlayReceiverBusy(true);
    setError(null);
    try {
      setAirPlayReceiverStatus(await connect.stopAirPlayReceiverPlayback());
    } catch (receiverError) {
      setError(receiverError instanceof Error ? receiverError.message : String(receiverError));
    } finally {
      setIsAirPlayReceiverBusy(false);
    }
  }, [t]);

  const copyAirPlayDebug = useCallback(async (): Promise<void> => {
    if (!airPlayDebugText) {
      return;
    }

    try {
      await writeTextToClipboard(airPlayDebugText);
      setCopiedAirPlayDebug(true);
      window.setTimeout(() => setCopiedAirPlayDebug(false), 1600);
    } catch (copyError) {
      setError(copyError instanceof Error ? t('connectPage.error.copyAirPlayDebugWithMessage', { message: copyError.message }) : t('connectPage.error.copyAirPlayDebug'));
    }
  }, [airPlayDebugText, t]);

  const connectDevice = useCallback(
    async (device: ConnectDevice): Promise<void> => {
      const connect = window.echo?.connect;
      if (!connect) {
        setError(t('connectPage.error.desktopBridgeConnect'));
        return;
      }

      if (!currentTrack && !currentFilePath) {
        setError(t('connectPage.error.emptyMetadata'));
        return;
      }

      setBusyDeviceId(device.id);
      setError(null);
      try {
        const nextStatus = await connect.connect({
          deviceId: device.id,
          track: currentTrack,
          filePath: currentFilePath,
          positionSeconds: currentPositionSeconds,
        });
        setStatus(nextStatus);
      } catch (connectError) {
        setError(connectError instanceof Error ? connectError.message : String(connectError));
      } finally {
        setBusyDeviceId(null);
      }
    },
    [currentFilePath, currentPositionSeconds, currentTrack, t],
  );

  const runCommand = useCallback(async (command: 'play' | 'pause' | 'stop' | 'disconnect'): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect) {
      setError(t('connectPage.error.desktopBridgeConnect'));
      return;
    }

    setIsCommandBusy(true);
    setError(null);
    try {
      const nextStatus = await connect[command]();
      setStatus(nextStatus);
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : String(commandError));
    } finally {
      setIsCommandBusy(false);
    }
  }, [t]);

  const commitVolume = useCallback(async (nextVolume: number): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect) {
      return;
    }

    setVolumePercent(nextVolume);
    try {
      setStatus(await connect.setVolume(nextVolume));
    } catch (volumeError) {
      setError(volumeError instanceof Error ? volumeError.message : String(volumeError));
    }
  }, []);

  const persistRadioStations = useCallback((updater: (current: RadioStation[]) => RadioStation[]): void => {
    setRadioStations((current) => {
      const next = updater(current).slice(0, maxStoredRadioStations);
      writeStoredRadioStations(next);
      return next;
    });
  }, []);

  const upsertRadioStation = useCallback((station: RadioStation): void => {
    persistRadioStations((current) => {
      const existing = current.find((item) => item.id === station.id || item.url === station.url);
      const nextStation = {
        ...station,
        createdAt: existing?.createdAt ?? station.createdAt,
        description: station.description?.trim() || existing?.description,
      };
      return [nextStation, ...current.filter((item) => item.id !== station.id && item.url !== station.url)];
    });
  }, [persistRadioStations]);

  const createRadioStationFromDraft = useCallback((lastPlayedAt: string | null = null): RadioStation | null => {
    const url = normalizeRadioUrl(radioUrlDraft);
    if (!url) {
      setError(t('connectPage.error.radioUrlRequired'));
      return null;
    }

    return createRadioStation({
      url,
      name: radioNameDraft,
      lastPlayedAt,
    });
  }, [radioNameDraft, radioUrlDraft, t]);

  const saveRadioDraftStation = useCallback((): void => {
    const station = createRadioStationFromDraft(null);
    if (!station) {
      return;
    }

    setError(null);
    upsertRadioStation(station);
    setRadioNameDraft(station.name);
    setRadioUrlDraft(station.url);
  }, [createRadioStationFromDraft, upsertRadioStation]);

  const playRadioStation = useCallback(async (station: RadioStation): Promise<void> => {
    const url = normalizeRadioUrl(station.url);
    if (!url) {
      setError(t('connectPage.error.radioUrlInvalid'));
      return;
    }

    const videoUrl = normalizeOptionalRadioUrl(station.videoUrl);

    const now = new Date().toISOString();
    const playableStation: RadioStation = {
      ...station,
      id: radioStationIdForUrl(url),
      name: station.name.trim() || stationNameFromUrl(url),
      url,
      ...(videoUrl ? { videoUrl } : { videoUrl: undefined }),
      updatedAt: now,
      lastPlayedAt: now,
    };
    const liveTrack = radioStationToTrack(playableStation);

    setIsRadioBusy(true);
    setError(null);
    try {
      const disconnectedStatus = await window.echo?.connect?.disconnect?.().catch(() => null);
      if (disconnectedStatus) {
        setStatus(disconnectedStatus);
      }

      await queue.playTrack(liveTrack, {
        source: {
          type: 'streaming',
          label: 'Connect Live',
          provider: 'm3u8',
        },
        routeToConnectOutput: false,
        forceRefresh: true,
      });

      upsertRadioStation(playableStation);
      setActiveRadioId(playableStation.id);
      setRadioNameDraft(playableStation.name);
      setRadioUrlDraft(playableStation.url);
    } catch (radioError) {
      setError(radioError instanceof Error ? radioError.message : String(radioError));
    } finally {
      setIsRadioBusy(false);
    }
  }, [queue, t, upsertRadioStation]);

  const playRadioDraft = useCallback(async (event?: { preventDefault: () => void }): Promise<void> => {
    event?.preventDefault();
    const station = createRadioStationFromDraft(null);
    if (!station) {
      return;
    }

    await playRadioStation(station);
  }, [createRadioStationFromDraft, playRadioStation]);

  const playRadioClipboard = useCallback(async (): Promise<void> => {
    if (!navigator.clipboard?.readText) {
      setError('剪贴板不可用，请手动粘贴直播 URL');
      return;
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      const url = normalizeRadioUrl(clipboardText);
      if (!url) {
        setError(t('connectPage.error.radioUrlInvalid'));
        return;
      }

      const station = createRadioStation({
        url,
        name: radioNameDraft,
        lastPlayedAt: null,
      });
      setRadioNameDraft(station.name);
      setRadioUrlDraft(station.url);
      await playRadioStation(station);
    } catch (clipboardError) {
      setError(clipboardError instanceof Error ? clipboardError.message : String(clipboardError));
    }
  }, [playRadioStation, radioNameDraft, t]);

  const playResolvedLiveStream = useCallback(async (stream: StreamingLiveResolveResult): Promise<void> => {
    const liveTrack = liveStreamToTrack(stream);
    try {
      const disconnectedStatus = await window.echo?.connect?.disconnect?.().catch(() => null);
      if (disconnectedStatus) {
        setStatus(disconnectedStatus);
      }

      await queue.playTrack(liveTrack, {
        source: {
          type: 'streaming',
          label: 'Connect Live',
          provider: 'm3u8',
        },
        routeToConnectOutput: false,
        forceRefresh: true,
      });

      setLastResolvedLive(stream);
      setActiveLiveUrl(stream.playbackUrl);
      setLiveUrlDraft(stream.sourceUrl);
      setActiveRadioId(null);
    } catch (liveError) {
      setError(liveError instanceof Error ? liveError.message : String(liveError));
    }
  }, [queue]);

  const playLiveDraft = useCallback(async (event?: { preventDefault: () => void }): Promise<void> => {
    event?.preventDefault();
    const streaming = window.echo?.streaming;
    if (!streaming?.resolveLive) {
      setError('直播解析服务不可用');
      return;
    }

    const url = normalizeRadioUrl(liveUrlDraft);
    if (!url) {
      setError('请先粘贴直播链接');
      return;
    }

    setIsLiveBusy(true);
    setError(null);
    try {
      const stream = await streaming.resolveLive({ url });
      await playResolvedLiveStream(stream);
    } catch (liveError) {
      setError(liveError instanceof Error ? liveError.message : String(liveError));
    } finally {
      setIsLiveBusy(false);
    }
  }, [liveUrlDraft, playResolvedLiveStream]);

  const playLiveClipboard = useCallback(async (): Promise<void> => {
    if (!navigator.clipboard?.readText) {
      setError('剪贴板不可用，请手动粘贴直播链接');
      return;
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      setLiveUrlDraft(clipboardText.trim());
      const streaming = window.echo?.streaming;
      if (!streaming?.resolveLive) {
        setError('直播解析服务不可用');
        return;
      }

      const url = normalizeRadioUrl(clipboardText);
      if (!url) {
        setError('剪贴板里不是有效直播链接');
        return;
      }

      setIsLiveBusy(true);
      setError(null);
      const stream = await streaming.resolveLive({ url });
      await playResolvedLiveStream(stream);
    } catch (liveError) {
      setError(liveError instanceof Error ? liveError.message : String(liveError));
    } finally {
      setIsLiveBusy(false);
    }
  }, [playResolvedLiveStream]);

  const stopLivePlayback = useCallback(async (): Promise<void> => {
    const playback = window.echo?.playback;
    if (!playback?.stop) {
      setError(t('connectPage.error.desktopBridgeRadioStop'));
      return;
    }

    setIsLiveBusy(true);
    setError(null);
    try {
      await playback.stop();
      setActiveLiveUrl(null);
    } catch (liveError) {
      setError(liveError instanceof Error ? liveError.message : String(liveError));
    } finally {
      setIsLiveBusy(false);
    }
  }, [t]);

  const stopRadioPlayback = useCallback(async (): Promise<void> => {
    const playback = window.echo?.playback;
    if (!playback?.stop) {
      setError(t('connectPage.error.desktopBridgeRadioStop'));
      return;
    }

    setIsRadioBusy(true);
    setError(null);
    try {
      await playback.stop();
      setActiveRadioId(null);
    } catch (radioError) {
      setError(radioError instanceof Error ? radioError.message : String(radioError));
    } finally {
      setIsRadioBusy(false);
    }
  }, [t]);

  const removeRadioStation = useCallback((stationId: string): void => {
    persistRadioStations((current) => current.filter((station) => station.id !== stationId));
    if (activeRadioId === stationId) {
      setActiveRadioId(null);
    }
  }, [activeRadioId, persistRadioStations]);

  const hideDevice = useCallback((device: ConnectDevice): void => {
    setHiddenDeviceIds((current) => {
      const next = new Set(current);
      next.add(device.id);
      writeStoredStringSet(hiddenConnectDevicesStorageKey, next);
      return next;
    });
  }, []);

  const restoreDevice = useCallback((deviceId: string): void => {
    setHiddenDeviceIds((current) => {
      const next = new Set(current);
      next.delete(deviceId);
      writeStoredStringSet(hiddenConnectDevicesStorageKey, next);
      return next;
    });
  }, []);

  const restoreAllDevices = useCallback((): void => {
    const next = new Set<string>();
    writeStoredStringSet(hiddenConnectDevicesStorageKey, next);
    setHiddenDeviceIds(next);
  }, []);

  const toggleDeviceSectionCollapsed = useCallback((): void => {
    setIsDeviceSectionCollapsed((current) => {
      const next = !current;
      writeStoredBoolean(connectDeviceSectionCollapsedStorageKey, next);
      return next;
    });
  }, []);

  const toggleCommandCenterCollapsed = useCallback((): void => {
    setIsCommandCenterCollapsed((current) => {
      const next = !current;
      writeStoredBoolean(connectCommandCenterCollapsedStorageKey, next);
      return next;
    });
  }, []);

  const toggleEchoLinkPanelCollapsed = useCallback((): void => {
    setIsEchoLinkPanelCollapsed((current) => {
      const next = !current;
      writeStoredBoolean(connectEchoLinkPanelCollapsedStorageKey, next);
      return next;
    });
  }, []);

  const toggleRadioPanelCollapsed = useCallback((): void => {
    setIsRadioPanelCollapsed((current) => {
      const next = !current;
      writeStoredBoolean(connectRadioPanelCollapsedStorageKey, next);
      return next;
    });
  }, []);

  const toggleLivePanelCollapsed = useCallback((): void => {
    setIsLivePanelCollapsed((current) => {
      const next = !current;
      writeStoredBoolean(connectLivePanelCollapsedStorageKey, next);
      return next;
    });
  }, []);

  const toggleHqPlayerPanelCollapsed = useCallback((): void => {
    setIsHqPlayerPanelCollapsed((current) => {
      const next = !current;
      writeStoredBoolean(connectHqPlayerPanelCollapsedStorageKey, next);
      return next;
    });
  }, []);

  const toggleListeningRoomCollapsed = useCallback((): void => {
    setIsListeningRoomCollapsed((current) => {
      const next = !current;
      writeStoredBoolean(connectListeningRoomCollapsedStorageKey, next);
      return next;
    });
  }, []);

  const openEchoProAccountSettings = useCallback((): void => {
    window.dispatchEvent(new CustomEvent('app:navigate:settings-section', { detail: { section: 'general', targetId: 'settings-row-echo-pro-account' } }));
  }, []);

  const hideConnectFromSidebar = useCallback(async (): Promise<void> => {
    setIsSidebarHideBusy(true);
    setError(null);
    try {
      await hideSidebarRouteEntry('connect');
    } catch (hideError) {
      setError(hideError instanceof Error ? hideError.message : String(hideError));
    } finally {
      setIsSidebarHideBusy(false);
    }
  }, []);

  const copyDonatorHwid = useCallback(async (): Promise<void> => {
    if (!donatorUnlockStatus.hwidHash) {
      return;
    }
    try {
      await writeTextToClipboard(donatorUnlockStatus.hwidHash);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  }, [donatorUnlockStatus.hwidHash]);

  if (donatorUnlockStatus.unlocked !== true) {
    return (
      <div className="connect-page connect-page--locked">
        <section className="remote-sources-hero connect-pro-hero" aria-label={t('connectPage.lock.aria')}>
          <div>
            <h3>{t('route.connect.label')}</h3>
            <strong>{t('connectPage.lock.title')}</strong>
            <p>{t('connectPage.lock.description')}</p>
          </div>
          {isDonatorUnlockLoading ? <Loader2 className="spinning-icon" size={28} /> : <LockKeyhole size={28} />}
        </section>
        <section className="remote-source-guardrail connect-pro-guardrail" aria-label="ECHO Pro required">
          <strong>{isDonatorUnlockLoading ? '正在检查 ECHO Pro 状态' : '需要 ECHO Pro'}</strong>
          <span>{t(connectDonatorUnlockReasonLabel[donatorUnlockStatus.reason])}</span>
        </section>
        <div className="remote-source-actions connect-pro-actions">
          <button className="settings-action-button" type="button" onClick={openEchoProAccountSettings}>
            <LockKeyhole size={15} />
            打开 ECHO Pro 账号
          </button>
          <button className="settings-action-button" type="button" onClick={() => void refreshDonatorUnlockStatus({ force: true })} disabled={isDonatorUnlockLoading}>
            {isDonatorUnlockLoading ? <Loader2 className="spinning-icon" size={15} /> : <RefreshCw size={15} />}
            {t('connectPage.lock.recheck')}
          </button>
          <button className="settings-action-button" type="button" onClick={() => void copyDonatorHwid()} disabled={!donatorUnlockStatus.hwidHash}>
            <Copy size={15} />
            {t('connectPage.lock.copyHwid')}
          </button>
          <button className="settings-action-button" type="button" onClick={() => void hideConnectFromSidebar()} disabled={isSidebarHideBusy}>
            {isSidebarHideBusy ? <Loader2 className="spinning-icon" size={15} /> : <EyeOff size={15} />}
            从侧栏隐藏
          </button>
        </div>
        {error ? <p className="settings-inline-note" role="alert">{error}</p> : null}
        <p className="settings-inline-note">Connect 不再默认隐藏，但 DLNA、AirPlay、HQPlayer、ECHO Link、手机扫码和 Web 遥控仍需 ECHO Pro 才能启用。</p>
      </div>
    );
  }

  return (
    <div className="connect-page">
      <header className="connect-header">
        <div>
          <p className="section-kicker">{t('connectPage.header.kicker')}</p>
          <h1>{t('route.connect.label')}</h1>
          <p>{t('connectPage.header.description')}</p>
        </div>
        <div className="connect-header-actions">
          <div className="settings-inline-toggle connect-autostart-toggle">
            <span>{t('connectPage.header.autoStart')}</span>
            <button
              aria-label={t('connectPage.header.autoStart')}
              aria-pressed={autoStartReceiversEnabled}
              className={`toggle-btn ${autoStartReceiversEnabled ? 'active' : ''}`}
              disabled={isAutoStartBusy}
              type="button"
              onClick={() => void toggleAutoStartReceivers()}
            >
              <span />
            </button>
          </div>
          <button className="settings-action-button" type="button" onClick={refreshCommandCenter} disabled={isRefreshing}>
            {isRefreshing ? <Loader2 className="spinning-icon" size={16} /> : <RefreshCw size={16} />}
            {t('connectPage.header.refresh')}
          </button>
        </div>
      </header>

      {error ? (
        <div className="connect-alert" role="alert">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      ) : null}

      <section
        className="connect-command-center"
        data-state={commandCenterHealth}
        data-collapsed={isCommandCenterCollapsed ? 'true' : undefined}
        aria-label={t('connectPage.commandCenter.aria')}
      >
        <div className="connect-command-center__headline">
          <div className="connect-command-center__title">
            <span className="connect-command-center__badge" data-state={commandCenterHealth}>{commandCenterHealthLabel}</span>
            <p className="section-kicker">LAN AUDIO HUB</p>
            <h2>Connect Command Center</h2>
            <p>{commandCenterRouteLabel}</p>
          </div>
          <div className="connect-command-center__actions">
            <button className="settings-action-button" type="button" onClick={() => void openEchoLinkWebControl()} disabled={!echoLinkWebControlUrl}>
              <Smartphone size={15} />
              {t('connectPage.commandCenter.webRemote')}
            </button>
            <button className="settings-action-button" type="button" onClick={() => void copyEchoLinkPairing()} disabled={!echoLinkPairingUri}>
              {copiedEchoLinkPairing ? <Check size={15} /> : <Copy size={15} />}
              {t('connectPage.commandCenter.phonePairing')}
            </button>
            <button className="settings-action-button" type="button" onClick={refreshCommandCenter} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="spinning-icon" size={15} /> : <RefreshCw size={15} />}
              {t('connectPage.commandCenter.refreshAll')}
            </button>
            <button
              className="icon-button connect-collapse-button"
              type="button"
              aria-label={isCommandCenterCollapsed ? t('connectPage.commandCenter.expand') : t('connectPage.commandCenter.collapse')}
              title={isCommandCenterCollapsed ? t('connectPage.commandCenter.expand') : t('connectPage.commandCenter.collapse')}
              aria-expanded={!isCommandCenterCollapsed}
              onClick={toggleCommandCenterCollapsed}
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>

        <div className="connect-collapsible-content" data-expanded={!isCommandCenterCollapsed}>
          <div className="connect-collapsible-content__inner">
        <div className="connect-command-center__body">
          <div className="connect-command-center__qr-card">
            <div className="connect-command-center__qr" data-empty={echoLinkQrDataUrl ? 'false' : 'true'}>
              {echoLinkQrDataUrl ? <img src={echoLinkQrDataUrl} alt="" /> : <Smartphone size={34} />}
            </div>
            <div>
              <span>PHONE PAIRING</span>
              <strong>{echoLinkStatus.running ? t('connectPage.commandCenter.qrReady') : t('connectPage.commandCenter.qrWaiting')}</strong>
              <small>{echoLinkPairingUri ?? t('connectPage.echoLink.pairDisabled')}</small>
            </div>
          </div>

          <div className="connect-command-center__status-grid">
            <article data-state={echoLinkStatus.running ? 'online' : echoLinkStatus.error ? 'warning' : 'idle'}>
              <Server size={18} />
              <span>ECHO Link</span>
              <strong>{echoLinkStatusLabel}</strong>
              <small>{echoLinkAddressLabel}</small>
            </article>
            <article data-state={echoLinkWebControlUrl ? 'online' : 'idle'}>
              <Smartphone size={18} />
              <span>Web Remote</span>
              <strong>{echoLinkWebStatusLabel}</strong>
              <small>{echoLinkWebControlUrl ?? 'http://LAN-IP:26789/echo-link/web'}</small>
            </article>
            <article data-state={receiverStatus.enabled ? 'online' : 'idle'}>
              <Radio size={18} />
              <span>DLNA Receiver</span>
              <strong>{receiverCommandLabel}</strong>
              <small>{receiverStatus.currentClient?.address ?? t('connectPage.room.dlna.addressCount', { count: receiverStatus.addresses.length })}</small>
            </article>
            <article data-state={airPlayReceiverStatus.error ? 'warning' : airPlayReceiverStatus.enabled ? 'online' : 'idle'}>
              <Cast size={18} />
              <span>AirPlay</span>
              <strong>{airPlayCommandLabel}</strong>
              <small>{airPlayReceiverProtocol === 'airplay2' ? t('connectPage.airplay.protocol.airplay2') : t('connectPage.airplay.protocol.airplay1')}</small>
            </article>
            <article data-state={hqPlayerState === 'available' ? 'online' : hqPlayerState === 'unavailable' || hqPlayerState === 'not-configured' ? 'warning' : 'idle'}>
              <Cable size={18} />
              <span>HQPlayer</span>
              <strong>{t(hqPlayerStateLabel[hqPlayerState])}</strong>
              <small>{hqPlayerEndpointLabel}</small>
            </article>
            <article data-state={visibleDevices.length > 0 ? 'online' : 'idle'}>
              <SlidersHorizontal size={18} />
              <span>Outputs</span>
              <strong>{t('connectPage.commandCenter.entryCount', { count: visibleDevices.length })}</strong>
              <small>{lanStreamerCount} DLNA / {airPlayOutputCount} AirPlay / {hqPlayerOutputCount} HQPlayer</small>
            </article>
          </div>
        </div>

        <div className="connect-command-center__route" aria-label={t('connectPage.commandCenter.routeAria')}>
          <span>ECHO</span>
          <strong>{previewTitle}</strong>
          <span>{status.deviceId ? `Output / ${activeTargetLabel}` : t('connectPage.nowPlaying.noOutput')}</span>
          <strong>{status.state === 'idle' ? t('connectPage.state.idle') : t(stateLabel[status.state])}</strong>
        </div>

        <div
          className="connect-listening-room"
          role="region"
          aria-label={t('connectPage.room.aria')}
          data-collapsed={isListeningRoomCollapsed ? 'true' : undefined}
        >
          <div className="connect-listening-room__header">
            <div>
              <span>LISTENING ROOM</span>
              <strong>{t('connectPage.room.title')}</strong>
            </div>
            <div className="connect-listening-room__header-actions">
              <small>{commandCenterRouteLabel}</small>
              <button
                className="connect-listening-room__toggle"
                type="button"
                aria-expanded={!isListeningRoomCollapsed}
                aria-label={isListeningRoomCollapsed ? t('connectPage.room.expand') : t('connectPage.room.collapse')}
                title={isListeningRoomCollapsed ? t('connectPage.room.expand') : t('connectPage.room.collapse')}
                onClick={toggleListeningRoomCollapsed}
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </div>
          {!isListeningRoomCollapsed ? (
            <div className="connect-listening-room__canvas" data-state={commandCenterHealth}>
              <div className="connect-listening-room__mesh" aria-hidden="true" />
              <article className="connect-listening-room__hub" data-state={commandCenterHealth}>
                <span className="connect-listening-room__icon">
                  <Server size={24} />
                </span>
                <span>ECHO Hub</span>
                <strong>{previewTitle}</strong>
                <small>{commandCenterHealthLabel} / {commandCenterErrorLabel}</small>
              </article>
              {listeningRoomNodes.map((node) => (
                <article
                  className="connect-listening-room__node"
                  data-node={node.id}
                  data-state={node.state}
                  key={node.id}
                  aria-label={t('connectPage.room.nodeAria', { title: node.title })}
                >
                  <span className="connect-listening-room__icon">{node.icon}</span>
                  <span>{node.eyebrow}</span>
                  <strong>{node.title}</strong>
                  <small>{node.detail}</small>
                  <em>{node.metric}</em>
                </article>
              ))}
            </div>
          ) : null}
        </div>

        <div className="connect-command-center__issues" data-empty={commandCenterIssues.length === 0 ? 'true' : undefined}>
          <AlertTriangle size={16} />
          <strong>{commandCenterErrorLabel}</strong>
          {commandCenterIssues.length > 1 ? <small>{t('connectPage.commandCenter.moreIssues', { count: commandCenterIssues.length - 1 })}</small> : null}
        </div>
          </div>
        </div>
      </section>

      <section className="connect-stage" aria-label={t('connectPage.stage.aria')}>
        <section className="connect-now connect-now--stage" aria-label={t('connectPage.nowPlaying.aria')}>
          <div className="connect-artwork" data-empty={!previewCover}>
            {previewCover ? <img alt="" src={previewCover} /> : <Cast size={42} />}
          </div>
          <div className="connect-now-copy">
            <span>{t(stateLabel[status.state])}</span>
            <h2>{previewTitle}</h2>
            <p>{previewArtist}{previewAlbum ? ` · ${previewAlbum}` : ''}</p>
            <div className="connect-now-facts" aria-label={t('connectPage.nowPlaying.infoAria')}>
              <small>{activeTargetLabel}</small>
              <small>{activeDeviceInfoLabel}</small>
              <small>{activeMediaInfoLabel || t('connectPage.nowPlaying.infoWaiting')}</small>
            </div>
            <div className="connect-progress" aria-label={t('connectPage.nowPlaying.progressAria')}>
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <small>{formatTime(status.positionSeconds)} / {formatTime(status.durationSeconds || currentTrack?.duration || 0)}</small>
          </div>
          <div className="connect-controls" aria-label={t('connectPage.controls.aria')}>
            <button className="icon-button" type="button" aria-label={t('connectPage.controls.play')} title={t('connectPage.controls.play')} onClick={() => void runCommand('play')} disabled={isCommandBusy || !status.deviceId || activeDeviceCapabilities?.canPlay !== true}>
              <Play size={17} />
            </button>
            <button className="icon-button" type="button" aria-label={t('connectPage.controls.pause')} title={t('connectPage.controls.pause')} onClick={() => void runCommand('pause')} disabled={isCommandBusy || !status.deviceId || activeDeviceCapabilities?.canPause !== true}>
              <Pause size={17} />
            </button>
            <button className="icon-button" type="button" aria-label={t('connectPage.controls.stop')} title={t('connectPage.controls.stop')} onClick={() => void runCommand('stop')} disabled={isCommandBusy || !status.deviceId || activeDeviceCapabilities?.canStop !== true}>
              <Square size={16} />
            </button>
            <button className="icon-button" type="button" aria-label={t('connectPage.controls.disconnect')} title={t('connectPage.controls.disconnect')} onClick={() => void runCommand('disconnect')} disabled={isCommandBusy || !status.deviceId}>
              <Unplug size={17} />
            </button>
            <label className="connect-volume">
              <Volume2 size={16} />
              <input
                type="range"
                min={0}
                max={100}
                value={volumePercent}
                onChange={(event) => setVolumePercent(Number(event.currentTarget.value))}
                onMouseUp={() => void commitVolume(volumePercent)}
                onKeyUp={(event) => {
                  if (event.key === 'Enter') {
                    void commitVolume(volumePercent);
                  }
                }}
                disabled={activeDeviceCapabilities?.canSetVolume !== true}
                aria-label={t('connectPage.controls.volume')}
              />
            </label>
          </div>
        </section>

        <details className="connect-receiver-debug connect-outgoing-debug" aria-label={t('connectPage.outgoing.aria')}>
          <summary>
            <span>{t('connectPage.outgoing.title')}</span>
            <small>{outgoingHttpEvents.length > 0 ? t('connectPage.outgoing.recent', { count: outgoingHttpEvents.length }) : t('connectPage.outgoing.empty')}</small>
          </summary>
          <div className="connect-receiver-debug__items">
            {outgoingHttpEvents.length > 0 ? (
              outgoingHttpEvents.slice(0, 8).map((event) => (
                <code key={event.id}>
                  {new Date(event.at).toLocaleTimeString()} {event.remoteAddress ?? '-'} {event.method} {event.kind} {event.statusCode ?? '-'}
                  {event.bytes != null ? ` ${event.bytes}B` : ''}{event.range ? ` ${event.range}` : ''}
                  {event.message ? ` ${event.message}` : ''}
                </code>
              ))
            ) : (
              <small>{t('connectPage.outgoing.note')}</small>
            )}
          </div>
        </details>

        <section
          className="connect-echo-link-panel"
          aria-label={t('connectPage.echoLink.aria')}
          data-collapsed={isEchoLinkPanelCollapsed ? 'true' : undefined}
        >
          <div className="connect-section-title">
            <div>
              <span>ECHO Link</span>
              <h2>{t('connectPage.echoLink.title')}</h2>
            </div>
            <div className="connect-section-actions">
              <span className="connect-hqplayer-state" data-state={echoLinkStatus.running ? 'available' : echoLinkStatus.error ? 'unavailable' : 'disabled'}>
                {echoLinkStatus.running ? t('connectPage.echoLink.state.running') : echoLinkStatus.error ? t('connectPage.echoLink.state.error') : t('connectPage.common.disabled')}
              </span>
              <button className="settings-action-button" type="button" onClick={() => void refreshEchoLink()} disabled={isEchoLinkBusy}>
                <RefreshCw size={15} />
                {t('connectPage.common.refresh')}
              </button>
              <button className="settings-action-button" type="button" onClick={() => void toggleEchoLink()} disabled={isEchoLinkBusy}>
                {isEchoLinkBusy ? <Loader2 className="spinning-icon" size={15} /> : <Power size={15} />}
                {echoLinkStatus.enabled ? t('connectPage.common.disable') : t('connectPage.common.enable')}
              </button>
              <button className="settings-action-button" type="button" onClick={() => void rotateEchoLinkToken()} disabled={isEchoLinkBusy}>
                <RefreshCw size={15} />
                {t('connectPage.echoLink.rotateToken')}
              </button>
              <button
                className="icon-button connect-collapse-button"
                type="button"
                aria-label={isEchoLinkPanelCollapsed ? t('connectPage.echoLink.expand') : t('connectPage.echoLink.collapse')}
                title={isEchoLinkPanelCollapsed ? t('connectPage.echoLink.expand') : t('connectPage.echoLink.collapse')}
                aria-expanded={!isEchoLinkPanelCollapsed}
                onClick={toggleEchoLinkPanelCollapsed}
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </div>
          <div className="connect-collapsible-content" data-expanded={!isEchoLinkPanelCollapsed}>
            <div className="connect-collapsible-content__inner">
          <div className="connect-echo-link-grid">
            <span>
              <em>{t('connectPage.echoLink.address')}</em>
              <strong>{echoLinkSelectedHost}:{echoLinkStatus.port}</strong>
            </span>
            <span>
              <em>{t('connectPage.echoLink.device')}</em>
              <strong>{echoLinkStatus.deviceName}</strong>
            </span>
            <span>
              <em>Token</em>
              <strong>{echoLinkTokenLabel}</strong>
              <button className="icon-button" type="button" aria-label={showEchoLinkToken ? t('connectPage.echoLink.hideToken') : t('connectPage.echoLink.showToken')} title={showEchoLinkToken ? t('connectPage.echoLink.hideToken') : t('connectPage.echoLink.showToken')} onClick={() => setShowEchoLinkToken((current) => !current)}>
                {showEchoLinkToken ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
            <span>
              <em>{t('connectPage.echoLink.tempStreams')}</em>
              <strong>{echoLinkStatus.activeMediaTokens}</strong>
            </span>
            <span>
              <em>{t('connectPage.echoLink.discovery')}</em>
              <strong>{echoLinkStatus.mdns.state === 'advertising' ? t('connectPage.echoLink.mdnsAdvertising') : echoLinkStatus.mdns.state === 'error' ? t('connectPage.echoLink.mdnsError') : t('connectPage.echoLink.mdnsIdle')}</strong>
            </span>
            <span>
              <em>{t('connectPage.echoLink.phone')}</em>
              <strong>{echoLinkStatus.diagnostics.lastPhoneConnectionAt ? new Date(echoLinkStatus.diagnostics.lastPhoneConnectionAt).toLocaleTimeString() : t('connectPage.echoLink.phoneNeverConnected')}</strong>
            </span>
            <span>
              <em>{t('connectPage.echoLink.authFailures')}</em>
              <strong>{echoLinkStatus.diagnostics.authFailureCount}</strong>
            </span>
            <span>
              <em>{t('connectPage.echoLink.lastRange')}</em>
              <strong>{echoLinkStatus.diagnostics.lastMediaTokenServed?.range ?? t('connectPage.common.none')}</strong>
            </span>
          </div>
          {echoLinkHosts.length > 1 ? (
            <div className="connect-echo-link-hosts" aria-label="ECHO Link LAN address">
              <small>{t('connectPage.echoLink.lanAddress')}</small>
              <div>
                {echoLinkHosts.map((host) => (
                  <button
                    key={host}
                    type="button"
                    aria-pressed={host === echoLinkSelectedHost}
                    onClick={() => setSelectedEchoLinkHost(host)}
                  >
                    {host}:{echoLinkStatus.port}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <small className="connect-echo-link-address-note">{echoLinkAddressLabel}</small>
          )}
          <div className="connect-echo-link-pairing">
            <div className="connect-echo-link-qr" data-empty={echoLinkQrDataUrl ? 'false' : 'true'}>
              {echoLinkQrDataUrl ? <img src={echoLinkQrDataUrl} alt="" /> : <Smartphone size={30} />}
            </div>
            <code>{echoLinkPairingUri ?? t('connectPage.echoLink.pairDisabled')}</code>
            <button className="settings-action-button" type="button" onClick={() => void copyEchoLinkPairing()} disabled={!echoLinkPairingUri}>
              {copiedEchoLinkPairing ? <Check size={15} /> : <Copy size={15} />}
              {copiedEchoLinkPairing ? t('connectPage.common.copied') : t('connectPage.common.copy')}
            </button>
          </div>
          <div className="connect-echo-link-web">
            <div>
              <span>{t('connectPage.echoLink.webTitle')}</span>
              <strong>{echoLinkWebControlUrl ? t('connectPage.echoLink.webAlbumSeaReady') : t('connectPage.echoLink.webAvailableAfterEnable')}</strong>
              <small>{t('connectPage.echoLink.webHint')}</small>
            </div>
            <code>{echoLinkWebControlUrl ?? 'http://LAN-IP:26789/echo-link/web'}</code>
            <div className="connect-echo-link-web__actions">
              <button className="settings-action-button" type="button" onClick={() => void openEchoLinkWebControl()} disabled={!echoLinkWebControlUrl}>
                <Smartphone size={15} />
                {t('connectPage.common.open')}
              </button>
              <button className="settings-action-button" type="button" onClick={() => void copyEchoLinkWebControl()} disabled={!echoLinkWebControlUrl}>
                {copiedEchoLinkWebControl ? <Check size={15} /> : <Copy size={15} />}
                {copiedEchoLinkWebControl ? t('connectPage.common.copied') : t('connectPage.echoLink.copyWeb')}
              </button>
            </div>
          </div>
          <form className="connect-echo-link-background" onSubmit={(event) => {
            event.preventDefault();
            void saveEchoLinkWebBackground();
          }}>
            <div className="connect-echo-link-background__intro">
              <span>
                {echoLinkWebBackgroundDraft.type === 'video' ? <Video size={15} /> : <Image size={15} />}
                {t('connectPage.echoLink.backgroundTitle')}
              </span>
              <small>{t('connectPage.echoLink.backgroundHint')}</small>
            </div>
            <label className="connect-echo-link-background__mode">
              <small>{t('connectPage.echoLink.backgroundType')}</small>
              <select
                value={echoLinkWebBackgroundDraft.type}
                onChange={(event) => {
                  const type = event.currentTarget.value as EchoLinkWebBackground['type'];
                  setEchoLinkWebBackgroundDraft((current) => ({ ...current, type }));
                }}
              >
                <option value="none">{t('connectPage.echoLink.backgroundNone')}</option>
                <option value="image">{t('connectPage.echoLink.backgroundImage')}</option>
                <option value="video">{t('connectPage.echoLink.backgroundVideo')}</option>
              </select>
            </label>
            <label className="connect-echo-link-background__url">
              <small>{t('connectPage.echoLink.backgroundUrl')}</small>
              <input
                type="text"
                value={echoLinkWebBackgroundDraft.url}
                placeholder={t('connectPage.echoLink.backgroundUrlPlaceholder')}
                disabled={echoLinkWebBackgroundDraft.type === 'none'}
                onChange={(event) => {
                  const url = event.currentTarget.value;
                  setEchoLinkWebBackgroundDraft((current) => ({ ...current, url }));
                }}
              />
            </label>
            <div className="connect-echo-link-background__actions">
              <button className="settings-action-button" type="button" onClick={() => void chooseEchoLinkWebBackgroundImage()} disabled={isEchoLinkBackgroundBusy}>
                <FolderOpen size={15} />
                {t('connectPage.echoLink.backgroundChooseImage')}
              </button>
              <button className="settings-action-button" type="submit" disabled={echoLinkWebBackgroundSaveDisabled}>
                {isEchoLinkBackgroundBusy ? <Loader2 className="spinning-icon" size={15} /> : savedEchoLinkBackground ? <Check size={15} /> : <Save size={15} />}
                {savedEchoLinkBackground ? t('connectPage.echoLink.backgroundSaved') : t('connectPage.echoLink.backgroundSave')}
              </button>
              <button className="settings-action-button" type="button" onClick={() => void clearEchoLinkWebBackground()} disabled={isEchoLinkBackgroundBusy || (!echoLinkWebBackgroundConfigured && echoLinkWebBackgroundDraft.type === 'none')}>
                <Trash2 size={15} />
                {t('connectPage.echoLink.backgroundClear')}
              </button>
            </div>
          </form>
          {echoLinkStatus.error ? (
            <div className="connect-alert connect-alert--inline" role="alert">
              <AlertTriangle size={16} />
              <span>{echoLinkStatus.error}</span>
            </div>
          ) : null}
          {echoLinkStatus.mdns.error || echoLinkStatus.diagnostics.recentHttpErrors.length > 0 ? (
            <details className="connect-receiver-debug">
              <summary>
                <span>{t('connectPage.echoLink.diagnostics')}</span>
                <small>{echoLinkStatus.diagnostics.recentHttpErrors.length} errors</small>
              </summary>
              <div className="connect-receiver-debug__items">
                {echoLinkStatus.mdns.error ? <code>mDNS {echoLinkStatus.mdns.error}</code> : null}
                {echoLinkStatus.diagnostics.recentHttpErrors.slice(0, 6).map((event) => (
                  <code key={`${event.at}-${event.path}-${event.statusCode}`}>
                    {new Date(event.at).toLocaleTimeString()} {event.statusCode} {event.path} {event.message}
                  </code>
                ))}
              </div>
            </details>
          ) : null}
            </div>
          </div>
        </section>

        <section className="connect-device-section connect-device-section--stage" aria-label={t('connectPage.devices.aria')}>
          <div className="connect-section-title">
            <div>
              <span>{t('connectPage.devices.kicker')}</span>
              <h2>{t('connectPage.devices.title')}</h2>
            </div>
            <div className="connect-section-actions">
              <small>
                {t('connectPage.devices.summary', {
                  streamers: visibleDevices.filter((device) => device.protocol === 'dlna').length,
                  entries: visibleDevices.length,
                  hidden: hiddenDeviceCount,
                })}
              </small>
              <button
                className="icon-button connect-collapse-button"
                type="button"
                aria-label={isDeviceSectionCollapsed ? t('connectPage.devices.expand') : t('connectPage.devices.collapse')}
                title={isDeviceSectionCollapsed ? t('connectPage.devices.expand') : t('connectPage.devices.collapse')}
                aria-expanded={!isDeviceSectionCollapsed}
                onClick={toggleDeviceSectionCollapsed}
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </div>
          {!isDeviceSectionCollapsed ? (
            <>
              {hiddenDeviceCount > 0 ? (
                <div className="connect-hidden-devices" aria-label={t('connectPage.devices.hiddenAria')}>
                  <div>
                    <EyeOff size={15} />
                    <span>{t('connectPage.devices.hiddenTitle')}</span>
                  </div>
                  <div className="connect-hidden-device-actions">
                    {hiddenDeviceEntries.map((device) => (
                      <button key={device.id} className="settings-action-button" type="button" onClick={() => restoreDevice(device.id)}>
                        <Eye size={14} />
                        {device.name}
                      </button>
                    ))}
                    <button className="settings-action-button" type="button" onClick={restoreAllDevices}>
                      {t('connectPage.devices.restoreAll')}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="connect-device-list">
                {visibleDevices.length === 0 ? (
                  <div className="connect-device-empty">
                    <StreamerGlyph />
                    <strong>{devices.length > 0 ? t('connectPage.devices.allHidden') : t('connectPage.devices.empty')}</strong>
                    <span>{devices.length > 0 ? t('connectPage.devices.restoreHint') : t('connectPage.devices.emptyHint')}</span>
                  </div>
                ) : visibleDevices.map((device) => {
                  const isActive = device.id === status.deviceId;
                  const isBusy = busyDeviceId === device.id;
                  const disabled = device.state === 'unsupported' || device.state === 'unavailable' || isBusy || (!currentTrack && !currentFilePath);
                  const deviceProduct = formatDeviceProduct(device, t);
                  const deviceAddress = formatDeviceAddress(device, t);
                  const deviceSupport = formatDeviceSupport(device, t);
                  const visual = deviceVisual(device);
                  return (
                    <article
                      className="connect-device-row"
                      data-active={isActive ? 'true' : undefined}
                      key={device.id}
                      title={t('connectPage.devices.hideHint')}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        hideDevice(device);
                      }}
                    >
                      <div className="connect-device-icon" data-protocol={device.protocol} data-tone={visual.tone}>
                        {visual.icon}
                      </div>
                      <div className="connect-device-copy">
                        <strong>{device.name}</strong>
                        <span>{formatProtocol(device)} · {deviceProduct}</span>
                        <div className="connect-device-facts" aria-label={t('connectPage.devices.deviceInfoAria', { name: device.name })}>
                          <small>{deviceAddress}</small>
                          <small>{deviceSupport}</small>
                          <small>{device.lastSeenAt ? t('connectPage.devices.lastSeen', { time: formatTimestamp(device.lastSeenAt, t) }) : t('connectPage.devices.discoveryPending')}</small>
                        </div>
                        {device.unsupportedReason ? <small>{device.unsupportedReason}</small> : null}
                      </div>
                      <div className="connect-device-meta">
                        <span data-state={device.state}>{t(isActive ? stateLabel[status.state] : deviceStateLabel[device.state])}</span>
                        <small>{visual.labelKey ? t(visual.labelKey) : visual.label}</small>
                      </div>
                      <button
                        className="settings-action-button"
                        type="button"
                        disabled={disabled}
                        onClick={() => void connectDevice(device)}
                      >
                        {isBusy ? <Loader2 className="spinning-icon" size={15} /> : device.protocol === 'hqplayer' ? <Cable size={15} /> : <Cast size={15} />}
                        {isActive ? t('connectPage.devices.reconnect') : t('connectPage.devices.connect')}
                      </button>
                    </article>
                  );
                })}
              </div>
            </>
          ) : null}
        </section>
      </section>

      <section className="connect-live-panel" aria-label="直播" data-collapsed={isLivePanelCollapsed ? 'true' : undefined}>
        <div className="connect-section-title">
          <div>
            <span>Live</span>
            <h2>直播</h2>
          </div>
          <div className="connect-section-actions">
            <small>{liveStatusLabel}</small>
            <button
              className="icon-button connect-collapse-button"
              type="button"
              aria-label={isLivePanelCollapsed ? '展开直播' : '折叠直播'}
              title={isLivePanelCollapsed ? '展开直播' : '折叠直播'}
              aria-expanded={!isLivePanelCollapsed}
              onClick={toggleLivePanelCollapsed}
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>

        <div className="connect-collapsible-content" data-expanded={!isLivePanelCollapsed}>
          <div className="connect-collapsible-content__inner">
            <form className="connect-live-form" aria-label="直播表单" onSubmit={(event) => void playLiveDraft(event)}>
              <label className="connect-radio-field connect-radio-field--url">
                <span>直播链接</span>
                <input
                  type="url"
                  inputMode="url"
                  value={liveUrlDraft}
                  placeholder="https://live.bilibili.com/21465419"
                  onChange={(event) => setLiveUrlDraft(event.currentTarget.value)}
                />
              </label>
              <div className="connect-radio-form-actions">
                <button className="settings-action-button" type="button" onClick={() => void playLiveClipboard()} disabled={isLiveBusy}>
                  {isLiveBusy ? <Loader2 className="spinning-icon" size={15} /> : <ClipboardPaste size={15} />}
                  粘贴播放
                </button>
                <button className="settings-action-button" type="submit" disabled={isLiveBusy}>
                  {isLiveBusy ? <Loader2 className="spinning-icon" size={15} /> : <Video size={15} />}
                  {t('connectPage.controls.play')}
                </button>
                <button className="settings-action-button" type="button" onClick={() => void stopLivePlayback()} disabled={isLiveBusy || !isLiveActive}>
                  <Square size={15} />
                  {t('connectPage.controls.stop')}
                </button>
              </div>
            </form>
            {lastResolvedLive ? (
              <div className="connect-live-summary" data-active={isLiveActive ? 'true' : undefined}>
                <div className="connect-radio-icon">
                  {lastResolvedLive.coverUrl ? <img src={lastResolvedLive.coverUrl} alt="" /> : <Video size={22} />}
                </div>
                <div className="connect-radio-copy">
                  <strong>{lastResolvedLive.title}</strong>
                  <RadioMarqueeText as="small" className="connect-radio-description" text={lastResolvedLive.pageUrl} />
                  <RadioMarqueeText className="connect-radio-url" text={lastResolvedLive.playbackUrl} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="connect-radio-panel" aria-label={t('connectPage.radio.aria')} data-collapsed={isRadioPanelCollapsed ? 'true' : undefined}>
        <div className="connect-section-title">
          <div>
            <span>Radio</span>
            <h2>网络电台</h2>
          </div>
          <div className="connect-section-actions">
            <small>{radioStatusLabel}</small>
            <button
              className="icon-button connect-collapse-button"
              type="button"
              aria-label={isRadioPanelCollapsed ? t('connectPage.radio.expand') : t('connectPage.radio.collapse')}
              title={isRadioPanelCollapsed ? t('connectPage.radio.expand') : t('connectPage.radio.collapse')}
              aria-expanded={!isRadioPanelCollapsed}
              onClick={toggleRadioPanelCollapsed}
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>

        <div className="connect-collapsible-content" data-expanded={!isRadioPanelCollapsed}>
          <div className="connect-collapsible-content__inner">
        <form className="connect-radio-form" aria-label={t('connectPage.radio.formAria')} onSubmit={(event) => void playRadioDraft(event)}>
          <label className="connect-radio-field">
            <span>电台名称</span>
            <input
              type="text"
              value={radioNameDraft}
              placeholder="例如 ECHO FM"
              onChange={(event) => setRadioNameDraft(event.currentTarget.value)}
            />
          </label>
          <label className="connect-radio-field connect-radio-field--url">
            <span>电台流地址</span>
            <input
              type="url"
              inputMode="url"
              value={radioUrlDraft}
              placeholder="https://example.com/live.mp3"
              onChange={(event) => setRadioUrlDraft(event.currentTarget.value)}
            />
          </label>
          <div className="connect-radio-form-actions">
            <button className="settings-action-button" type="button" onClick={saveRadioDraftStation}>
              <Plus size={15} />
              {t('connectPage.radio.save')}
            </button>
            <button className="settings-action-button" type="button" onClick={() => void playRadioClipboard()} disabled={isRadioBusy}>
              {isRadioBusy ? <Loader2 className="spinning-icon" size={15} /> : <ClipboardPaste size={15} />}
              粘贴播放
            </button>
            <button className="settings-action-button" type="submit" disabled={isRadioBusy}>
              {isRadioBusy ? <Loader2 className="spinning-icon" size={15} /> : <Radio size={15} />}
              {t('connectPage.controls.play')}
            </button>
            <button className="settings-action-button" type="button" onClick={() => void stopRadioPlayback()} disabled={isRadioBusy || !isRadioActive}>
              <Square size={15} />
              {t('connectPage.controls.stop')}
            </button>
          </div>
        </form>

        <div className="connect-radio-list" aria-label={t('connectPage.radio.savedAria')}>
          {radioStations.length > 0 ? (
            radioStations.map((station) => {
              const isActive = activeRadioStation?.id === station.id && isRadioActive;
              return (
                <article className="connect-radio-row" data-active={isActive ? 'true' : undefined} key={station.id}>
                  <div className="connect-radio-icon">
                    <Radio size={22} />
                  </div>
                  <div className="connect-radio-copy">
                    <strong>{station.name}</strong>
                    {station.description ? <RadioMarqueeText as="small" className="connect-radio-description" text={station.description} /> : null}
                    <RadioMarqueeText className="connect-radio-url" text={station.url} />
                    {station.lastPlayedAt ? (
                      <small className="connect-radio-last-played">{t('connectPage.radio.lastPlayed', { time: formatTimestamp(station.lastPlayedAt, t) })}</small>
                    ) : (
                      <small className="connect-radio-last-played">{t('connectPage.radio.neverPlayed')}</small>
                    )}
                  </div>
                  <div className="connect-radio-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={t('connectPage.radio.playStation', { name: station.name })}
                      title={t('connectPage.radio.playStation', { name: station.name })}
                      disabled={isRadioBusy}
                      onClick={() => void playRadioStation(station)}
                    >
                      {isRadioBusy && isActive ? <Loader2 className="spinning-icon" size={16} /> : <Play size={16} />}
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={t('connectPage.radio.deleteStation', { name: station.name })}
                      title={t('connectPage.radio.deleteStation', { name: station.name })}
                      onClick={() => removeRadioStation(station.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="connect-radio-empty">
              <Radio size={26} />
              <strong>{t('connectPage.radio.emptyTitle')}</strong>
              <span>{t('connectPage.radio.emptyDescription')}</span>
            </div>
          )}
        </div>
          </div>
        </div>
      </section>

      <section
        className="connect-hqplayer-panel"
        aria-label="HQPlayer Connect"
        data-collapsed={isHqPlayerExpanded ? undefined : 'true'}
        data-section-collapsed={isHqPlayerPanelCollapsed ? 'true' : undefined}
      >
        <div className="connect-hqplayer-header">
          <div className="connect-hqplayer-title">
            <div className="connect-hqplayer-icon">
              <HqPlayerGlyph />
            </div>
            <div>
              <span>{t('connectPage.hqplayer.kicker')}</span>
              <h2>HQPlayer</h2>
            </div>
          </div>
          <div className="connect-hqplayer-actions">
            <span className="connect-hqplayer-state" data-state={hqPlayerState}>{t(hqPlayerStateLabel[hqPlayerState])}</span>
            <button
              className="settings-action-button"
              type="button"
              disabled={hqPlayerBusy === 'test'}
              onClick={() => void handleHqPlayerTestConnection()}
            >
              <RefreshCw className={hqPlayerBusy === 'test' ? 'spinning-icon' : undefined} size={15} />
              {t('connectPage.hqplayer.test')}
            </button>
            <button
              className="icon-button connect-collapse-button"
              type="button"
              aria-label={isHqPlayerPanelCollapsed ? t('connectPage.hqplayer.expand') : t('connectPage.hqplayer.collapse')}
              title={isHqPlayerPanelCollapsed ? t('connectPage.hqplayer.expand') : t('connectPage.hqplayer.collapse')}
              aria-expanded={!isHqPlayerPanelCollapsed}
              onClick={toggleHqPlayerPanelCollapsed}
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>

        <div className="connect-collapsible-content" data-expanded={!isHqPlayerPanelCollapsed}>
          <div className="connect-collapsible-content__inner">
        {shouldShowHqPlayerDetails ? (
          <div className="connect-hqplayer-layout" data-expanded={isHqPlayerExpanded ? 'true' : 'false'}>
          <div className="connect-hqplayer-config">
            <div className="connect-hqplayer-local-card">
              <strong>{t('connectPage.hqplayer.localDesktop')}</strong>
              <span>{formatHqEndpoint({ host: hqPlayerLocalHost, port: hqPlayerDefaultPort }, t)}</span>
            </div>
            <div className="connect-hqplayer-toggle-row">
              <div className="settings-inline-toggle">
                <span>{t('connectPage.hqplayer.enable')}</span>
                <button
                  aria-label={t('connectPage.hqplayer.enable')}
                  aria-pressed={hqPlayerDraft.enabled}
                  className={`toggle-btn ${hqPlayerDraft.enabled ? 'active' : ''}`}
                  disabled={hqPlayerBusy === 'settings'}
                  type="button"
                  onClick={() => void toggleHqPlayerEnabled()}
                >
                  <span />
                </button>
              </div>
              <div className="settings-inline-toggle">
                <span>{t('connectPage.hqplayer.mediaServer')}</span>
                <button
                  aria-label={t('connectPage.hqplayer.mediaServerAria')}
                  aria-pressed={hqPlayerDraft.mediaServerEnabled}
                  className={`toggle-btn ${hqPlayerDraft.mediaServerEnabled ? 'active' : ''}`}
                  type="button"
                  onClick={() => patchHqPlayerDraft({ mediaServerEnabled: !hqPlayerDraft.mediaServerEnabled })}
                >
                  <span />
                </button>
              </div>
            </div>

            <details className="connect-hqplayer-advanced">
              <summary>{t('connectPage.hqplayer.advanced')}</summary>
              <div className="connect-hqplayer-segments" aria-label={t('connectPage.hqplayer.modeAria')}>
                {hqPlayerConnectionModes.map((mode) => (
                  <button
                    className="connect-hqplayer-chip"
                    data-active={hqPlayerEffectiveDraft.connectionMode === mode ? 'true' : undefined}
                    key={mode}
                    type="button"
                    onClick={() => patchHqPlayerDraft({
                      connectionMode: mode,
                      host: mode === 'localDesktop' ? hqPlayerLocalHost : hqPlayerDraft.host,
                      port: hqPlayerEffectiveDraft.port,
                    })}
                  >
                    {t(hqPlayerModeLabel[mode])}
                  </button>
                ))}
              </div>

              <div className="connect-hqplayer-segments" aria-label={t('connectPage.hqplayer.backendAria')}>
                {hqPlayerDefaultBackends.map((backend) => (
                  <button
                    className="connect-hqplayer-chip"
                    data-active={hqPlayerEffectiveDraft.defaultPlaybackBackend === backend ? 'true' : undefined}
                    key={backend}
                    type="button"
                    onClick={() => patchHqPlayerDraft({ defaultPlaybackBackend: backend })}
                  >
                    {t(hqPlayerBackendLabel[backend])}
                  </button>
                ))}
              </div>

              <div className="connect-hqplayer-fields">
                <label className="connect-hqplayer-field">
                  <span>Host</span>
                  <input
                    type="text"
                    value={hqPlayerEffectiveDraft.host}
                    onChange={(event) => patchHqPlayerDraft({ host: event.currentTarget.value })}
                  />
                </label>
                <label className="connect-hqplayer-field">
                  <span>{t('connectPage.hqplayer.controlPort')}</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={hqPlayerEffectiveDraft.port ?? ''}
                    onChange={(event) => patchHqPlayerDraft({ port: parsePort(event.currentTarget.value) })}
                  />
                </label>
                <label className="connect-hqplayer-field">
                  <span>{t('connectPage.hqplayer.mediaPort')}</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={hqPlayerDraft.mediaServerPort ?? ''}
                    onChange={(event) => patchHqPlayerDraft({ mediaServerPort: parsePort(event.currentTarget.value) })}
                  />
                </label>
                <label className="connect-hqplayer-field connect-hqplayer-field--wide">
                  <span>Profile</span>
                  <input
                    type="text"
                    value={hqPlayerDraft.profileName ?? ''}
                    onChange={(event) => patchHqPlayerDraft({ profileName: event.currentTarget.value.trim() || null })}
                  />
                </label>
              </div>
            </details>
          </div>

          <div className="connect-hqplayer-status-grid">
            <span>
              <em>{t('connectPage.hqplayer.controlEndpoint')}</em>
              <strong>{hqPlayerEndpointLabel}</strong>
            </span>
            <span>
              <em>{t('connectPage.hqplayer.defaultBackend')}</em>
              <strong>{t(hqPlayerBackendLabel[hqPlayerEffectiveDraft.defaultPlaybackBackend])}</strong>
            </span>
            <span>
              <em>{t('connectPage.hqplayer.mediaServer')}</em>
              <strong>{hqPlayerDraft.mediaServerEnabled ? (hqPlayerDraft.mediaServerPort ? `ECHO:${hqPlayerDraft.mediaServerPort}` : t('connectPage.hqplayer.autoPort')) : t('connectPage.common.disabled')}</strong>
            </span>
            <span>
              <em>{t('connectPage.hqplayer.lastChecked')}</em>
              <strong>{formatTimestamp(hqPlayerStatus?.lastCheckedAt ?? null, t)}</strong>
            </span>
            {hqPlayerTestResult ? (
              <span className={hqPlayerTestResult.ok ? 'is-ok' : 'is-error'}>
                <em>{t('connectPage.hqplayer.testResult')}</em>
                <strong>{hqPlayerTestResult.ok ? t('connectPage.hqplayer.testAvailable', { ms: hqPlayerTestResult.elapsedMs }) : hqPlayerTestResult.error ?? t('common.unavailable')}</strong>
              </span>
            ) : null}
            <span>
              <em>HQPlayer</em>
              <strong>{hqPlayerProductLabel}</strong>
            </span>
            <span>
              <em>Engine</em>
              <strong>{hqPlayerEngineLabel}</strong>
            </span>
            <span>
              <em>{t('connectPage.hqplayer.remoteStatus')}</em>
              <strong>{hqPlayerRemotePositionLabel}</strong>
            </span>
            <span className="connect-hqplayer-status-grid__wide">
              <em>{t('connectPage.hqplayer.signalPath')}</em>
              <strong>{hqPlayerSignalLabel}</strong>
            </span>
          </div>

          <div className="connect-hqplayer-plan">
            <div className="connect-hqplayer-plan-header">
              <SlidersHorizontal size={16} />
              <span>{t('connectPage.hqplayer.recentPlan')}</span>
            </div>
            <div className="connect-hqplayer-plan-row">
              <em>Handoff</em>
              <strong>{hqPlayerLastHandoff ? (hqPlayerLastReason ?? hqPlayerLastHandoff.state) : t('connectPage.common.none')}</strong>
            </div>
            <div className="connect-hqplayer-plan-row">
              <em>Control</em>
              <strong>{hqPlayerControlPlan ? `${hqPlayerControlPlan.action} · ${hqPlayerControlPlan.transport}` : t('connectPage.common.none')}</strong>
            </div>
            <div className="connect-hqplayer-plan-row">
              <em>Send</em>
              <strong>{hqPlayerSendMessage}</strong>
            </div>
            <div className="connect-hqplayer-plan-row">
              <em>Source</em>
              <strong>
                {hqPlayerControlPlan?.source
                  ? `${t(hqPlayerExposureLabel[hqPlayerControlPlan.source.exposure])} · ${hqPlayerControlPlan.source.mimeType ?? 'audio'}`
                  : t('connectPage.common.none')}
              </strong>
            </div>
            {hqPlayerMediaServerLabel ? (
              <div className="connect-hqplayer-plan-row">
                <em>Media URL</em>
                <strong>{hqPlayerMediaServerLabel}</strong>
              </div>
            ) : null}
            <div className="connect-hqplayer-plan-row">
              <em>Track</em>
              <strong>{hqPlayerControlPlan?.metadata?.title ?? hqPlayerCurrentPlayable?.title ?? t('connectPage.hqplayer.noCurrentTrack')}</strong>
            </div>
            <div className="connect-hqplayer-plan-row">
              <em>Headers</em>
              <strong>{hqPlayerControlPlan?.source?.hasHeaders ? t('connectPage.hqplayer.headersRequireMediaServer') : t('connectPage.hqplayer.headersNotExposed')}</strong>
            </div>
            <div className="connect-hqplayer-plan-footer">
              <Server size={15} />
              <span>{hqPlayerEffectiveDraft.connectionMode === 'remote' ? t('connectPage.hqplayer.remoteModeHint') : t('connectPage.hqplayer.localModeHint')}</span>
            </div>
          </div>
          </div>
        ) : null}
        {!isHqPlayerExpanded ? (
          <div className="connect-hqplayer-collapsed">
            <div className="connect-hqplayer-local-card">
              <strong>{t('connectPage.hqplayer.localDesktop')}</strong>
              <span>{formatHqEndpoint({ host: hqPlayerLocalHost, port: hqPlayerDefaultPort }, t)}</span>
            </div>
            <div className="settings-inline-toggle">
              <span>{t('connectPage.hqplayer.enable')}</span>
              <button
                aria-label={t('connectPage.hqplayer.enable')}
                aria-pressed={hqPlayerDraft.enabled}
                className={`toggle-btn ${hqPlayerDraft.enabled ? 'active' : ''}`}
                disabled={hqPlayerBusy === 'settings'}
                type="button"
                onClick={() => void toggleHqPlayerEnabled()}
              >
                <span />
              </button>
            </div>
          </div>
        ) : null}
          </div>
        </div>
      </section>

      <section className="connect-receiver-panel" aria-label={t('connectPage.receiver.aria')}>
        <div className="connect-section-title">
          <div>
            <span>{t('connectPage.receiver.kicker')}</span>
            <h2>{t('connectPage.receiver.title')}</h2>
          </div>
          <button className="settings-action-button" type="button" onClick={() => void toggleReceiver()} disabled={isReceiverBusy}>
            {isReceiverBusy ? <Loader2 className="spinning-icon" size={16} /> : <Power size={16} />}
            {receiverStatus.enabled ? t('connectPage.receiver.disable') : t('connectPage.receiver.enable')}
          </button>
        </div>
        <div className="connect-receiver-body">
          <div className="connect-artwork" data-empty={!receiverCover}>
            {receiverCover ? <img alt="" src={receiverCover} /> : <Smartphone size={42} />}
          </div>
          <div className="connect-now-copy">
            <span>{t(receiverStateLabel[receiverStatus.state])}</span>
            <h2>{receiverTitle}</h2>
            <p>{receiverArtist}{receiverAlbum ? ` · ${receiverAlbum}` : ''}</p>
            <div className="connect-progress" aria-label={t('connectPage.receiver.progressAria')}>
              <span style={{ width: `${receiverProgressPercent}%` }} />
            </div>
            <small>
              {formatTime(receiverStatus.positionSeconds)} / {formatTime(receiverStatus.durationSeconds)}
            </small>
          </div>
          <div className="connect-receiver-meta">
            <span>{receiverStatus.advertisedName}</span>
            <small>{receiverStatus.currentClient ? t('connectPage.receiver.fromClient', { address: receiverStatus.currentClient.address }) : t('connectPage.receiver.noClient')}</small>
            <small>
              {receiverStatus.addresses.length > 0
                ? receiverStatus.addresses.map(formatReceiverAddress).join(' / ')
                : receiverStatus.enabled
                  ? t('connectPage.receiver.preparing')
                  : t('connectPage.receiver.discoveryHint')}
            </small>
          </div>
          <button
            className="settings-action-button"
            type="button"
            onClick={() => void stopReceiverPlayback()}
            disabled={isReceiverBusy || !receiverStatus.currentUri}
          >
            <Square size={15} />
            {t('connectPage.receiver.stop')}
          </button>
        </div>
        <details className="connect-receiver-debug" aria-label={t('connectPage.receiver.debugAria')}>
          <summary>
            <span>{t('connectPage.receiver.debugTitle')}</span>
            <small>{receiverStatus.debugEvents.length > 0 ? t('connectPage.outgoing.recent', { count: receiverStatus.debugEvents.length }) : t('connectPage.receiver.debugEmpty')}</small>
          </summary>
          <div className="connect-receiver-debug__items">
            {receiverStatus.debugEvents.length > 0 ? (
              receiverStatus.debugEvents.slice(0, 6).map((event) => (
                <code key={event.id}>
                  {new Date(event.at).toLocaleTimeString()} {event.remoteAddress ?? '-'} {event.method} {event.path}
                  {event.action ? ` #${event.action}` : ''} {event.statusCode ?? '-'}
                  {event.message ? ` ${event.message}` : ''}
                </code>
              ))
            ) : (
              <small>{t('connectPage.receiver.debugNoneYet')}</small>
            )}
          </div>
        </details>
      </section>

      <section className="connect-receiver-panel" aria-label={t('connectPage.airplay.aria')}>
        <div className="connect-section-title">
          <div>
            <span>AirPlay Spike</span>
            <h2>{t('connectPage.airplay.title')}</h2>
          </div>
          <button className="settings-action-button" type="button" onClick={() => void toggleAirPlayReceiver()} disabled={isAirPlayReceiverBusy}>
            {isAirPlayReceiverBusy ? <Loader2 className="spinning-icon" size={16} /> : <Power size={16} />}
            {airPlayReceiverStatus.enabled ? t('connectPage.airplay.disable') : t('connectPage.airplay.enable')}
          </button>
        </div>
        <div className="connect-airplay-protocols" aria-label={t('connectPage.airplay.protocolAria')}>
          {airPlayReceiverProtocols.map((protocol) => (
            <button
              key={protocol}
              type="button"
              aria-pressed={airPlayReceiverProtocol === protocol}
              disabled={isAirPlayReceiverBusy}
              onClick={() => void setAirPlayProtocol(protocol)}
            >
              {protocol === 'airplay1' ? t('connectPage.airplay.protocol.airplay1') : t('connectPage.airplay.protocol.airplay2')}
            </button>
          ))}
        </div>
        <div className="connect-receiver-body">
          <div className="connect-artwork" data-empty={!airPlayCover}>
            {airPlayCover ? <img alt="" src={airPlayCover} /> : <Cast size={42} />}
          </div>
          <div className="connect-now-copy">
            <span>{t(airPlayStateLabel[airPlayReceiverStatus.state])}</span>
            <h2>{airPlayTitle}</h2>
            <p>{airPlayArtist}{airPlayAlbum ? ` · ${airPlayAlbum}` : ''}</p>
            <div className="connect-progress" aria-label={t('connectPage.airplay.progressAria')}>
              <span style={{ width: `${airPlayProgressPercent}%` }} />
            </div>
            <small>
              {formatTime(airPlayReceiverStatus.positionSeconds)} / {formatTime(airPlayReceiverStatus.durationSeconds)}
            </small>
          </div>
          <div className="connect-receiver-meta">
            <span>{airPlayReceiverStatus.advertisedName}</span>
            <small>{airPlayReceiverStatus.currentClient ? t('connectPage.receiver.fromClient', { address: airPlayReceiverStatus.currentClient.address }) : t('connectPage.airplay.waitingDevice')}</small>
            <small>
              {airPlayReceiverStatus.error ?? (airPlayReceiverStatus.nativeAvailable ? t('connectPage.airplay.nativeLoaded') : t('connectPage.airplay.nativeRequired'))}
            </small>
            <small>
              {airPlayReceiverProtocol === 'airplay2' ? t('connectPage.airplay.currentAirplay2') : t('connectPage.airplay.currentAirplay1')}
            </small>
            <small>{t('connectPage.airplay.seekHint')}</small>
          </div>
          <button
            className="settings-action-button"
            type="button"
            onClick={() => void stopAirPlayReceiverPlayback()}
            disabled={isAirPlayReceiverBusy || !airPlayReceiverStatus.currentSourceId}
          >
            <Square size={15} />
            {t('connectPage.airplay.stop')}
          </button>
        </div>
        <details className="connect-receiver-debug" aria-label={t('connectPage.airplay.debugAria')}>
          <summary>
            <span>{t('connectPage.airplay.debugTitle')}</span>
            <div className="connect-receiver-debug__actions">
              <small>{airPlayReceiverStatus.debugEvents.length > 0 ? t('connectPage.outgoing.recent', { count: airPlayReceiverStatus.debugEvents.length }) : t('connectPage.receiver.debugEmpty')}</small>
              <button
                className="connect-debug-copy-button"
                type="button"
                aria-label={t('connectPage.airplay.copyDebug')}
                title={t('connectPage.airplay.copyDebug')}
                disabled={!airPlayDebugText}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void copyAirPlayDebug();
                }}
              >
                {copiedAirPlayDebug ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
          </summary>
          <div className="connect-receiver-debug__items">
            {airPlayReceiverStatus.debugEvents.length > 0 ? (
              airPlayReceiverStatus.debugEvents.slice(0, 6).map((event) => (
                <code key={event.id}>
                  {formatReceiverDebugEvent(event)}
                </code>
              ))
            ) : (
              <small>{t('connectPage.airplay.debugNoneYet')}</small>
            )}
          </div>
        </details>
      </section>

    </div>
  );
};
