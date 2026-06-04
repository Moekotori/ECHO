import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  Cable,
  Cast,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Pause,
  Play,
  Power,
  Plus,
  Radio,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Smartphone,
  Square,
  Trash2,
  Unplug,
  Volume2,
} from 'lucide-react';
import type { AppSettings } from '../../shared/types/appSettings';
import { hqPlayerConnectDeviceId } from '../../shared/types/connect';
import type { AirPlayReceiverStatus, ConnectDevice, ConnectReceiverStatus, ConnectSessionStatus } from '../../shared/types/connect';
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
import { streamingProviderNames, type StreamingProviderName } from '../../shared/types/streaming';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { useSharedPlaybackStatus } from '../stores/playbackStatusStore';

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
const connectDeviceSectionCollapsedStorageKey = 'echo.connect.deviceSectionCollapsed.v1';
const legacyRadioStationsStorageKey = 'echo.connect.radioStations.v1';
const radioStationsStorageKey = 'echo.connect.radioStations.v2';
const maxStoredRadioStations = 40;

const hqPlayerConnectionModes: HqPlayerConnectionMode[] = ['localDesktop', 'remote'];
const hqPlayerDefaultBackends: HqPlayerDefaultPlaybackBackend[] = ['echoNative', 'ask', 'hqplayer'];

const hqPlayerStateLabel: Record<HqPlayerStatus['state'], TranslationKey> = {
  disabled: 'connectPage.hqplayer.state.disabled',
  'not-configured': 'connectPage.hqplayer.state.notConfigured',
  checking: 'connectPage.hqplayer.state.checking',
  available: 'connectPage.hqplayer.state.available',
  unavailable: 'connectPage.hqplayer.state.unavailable',
};

const hqPlayerModeLabel: Record<HqPlayerConnectionMode, string> = {
  localDesktop: '本机 Desktop',
  remote: '远程 HQPlayer',
};

const hqPlayerBackendLabel: Record<HqPlayerDefaultPlaybackBackend, string> = {
  echoNative: '继续用 ECHO',
  ask: '每次询问',
  hqplayer: '优先 HQPlayer',
};

const hqPlayerHandoffReasonLabel: Record<HqPlayerPlaybackHandoffReason, string> = {
  hqplayer_disabled: 'HQPlayer 未启用',
  hqplayer_control_port_not_configured: '控制端口未配置',
  hqplayer_confirmation_required: '需要确认',
  echo_native_selected: '当前选择 ECHO 输出',
  remote_hqplayer_requires_media_server: '远程模式需要媒体服务',
  media_server_not_ready: '媒体服务未就绪',
  spotify_sdk_required: 'Spotify 需要 SDK 播放',
  streaming_item_unplayable: '串流曲目不可播放',
  streaming_proxy_required: '需要代理播放',
  source_requires_headers: '音源需要请求头',
  source_resolution_failed: '音源解析失败',
  unsupported_media_type: '暂不支持的媒体类型',
};

const hqPlayerSendReasonLabel: Record<HqPlayerPlaybackControlSendReason, string> = {
  control_plan_missing: '还没有可发送的交接计划',
  handoff_not_ready: '交接未就绪',
  source_missing: '音源缺失',
  source_requires_headers: '音源需要私密请求头',
  hqplayer_control_port_not_configured: '控制端口未配置',
  hqplayer_connection_timeout: '连接超时',
  hqplayer_connection_refused: '连接被拒绝',
  hqplayer_connection_failed: '连接失败',
  hqplayer_protocol_error: '协议响应异常',
  hqplayer_response_error: 'HQPlayer 返回错误',
};

const hqPlayerExposureLabel: Record<NonNullable<HqPlayerPlaybackControlPlan['source']>['exposure'], string> = {
  'local-file': '本地文件',
  'loopback-http': '本机流地址',
  'direct-http': '直连 HTTP',
  'media-server': 'ECHO 媒体服务',
};

const hqPlayerRemoteStateLabel: Record<HqPlayerRemotePlaybackStatus['state'], string> = {
  stopped: '已停止',
  paused: '已暂停',
  playing: '播放中',
  'stop-requested': '正在停止',
  unknown: '未知',
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

const radioStationIdForUrl = (url: string): string => `radio:${hashText(url.toLowerCase())}`;

const radioTrackIdForUrl = (url: string): string => `radio-stream:${hashText(url.toLowerCase())}`;

const radioStationKeyForUrl = (url: string): string => (normalizeRadioUrl(url) ?? url).toLowerCase();

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
    (station.description === undefined || typeof station.description === 'string') &&
    typeof station.createdAt === 'string' &&
    typeof station.updatedAt === 'string' &&
    (station.lastPlayedAt === null || typeof station.lastPlayedAt === 'string')
  );
};

const sanitizeRadioStation = (station: RadioStation): RadioStation => {
  const url = normalizeRadioUrl(station.url) ?? station.url;
  const description = station.description?.trim();
  return {
    ...station,
    id: radioStationIdForUrl(url),
    name: station.name.trim() || stationNameFromUrl(url),
    url,
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

const formatDeviceProduct = (device: ConnectDevice): string => {
  const parts = uniqueText([
    device.manufacturer,
    device.discovery?.modelName ?? device.model,
    device.discovery?.modelNumber,
  ]);
  return parts.length > 0 ? parts.join(' · ') : '型号待识别';
};

const formatDeviceAddress = (device: ConnectDevice): string =>
  device.address ? `局域网 ${device.address}` : '等待网络地址';

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

const formatDeviceFormatSupport = (device: ConnectDevice): string => {
  const supported = device.capabilities.supportedMimeTypes;
  if (supported.some((item) => item === '*/*' || item.endsWith('/*'))) {
    return '全格式接收';
  }

  const formats = supported
    .filter((item) => item !== 'application/octet-stream')
    .map(formatMimeLabel)
    .slice(0, 3);

  if (formats.length === 0) {
    return '格式待探测';
  }

  const extraCount = Math.max(0, supported.length - formats.length);
  return extraCount > 0 ? `${formats.join(' / ')} +${extraCount}` : formats.join(' / ');
};

const formatDeviceSupport = (device: ConnectDevice): string => {
  if (device.protocol === 'hqplayer') {
    return '本机控制 · 高精度输出';
  }

  if (device.protocol === 'airplay') {
    return '实验通道 · 元数据门控';
  }

  const controls = [
    device.capabilities.canSeek ? '可定位' : null,
    device.capabilities.canSetVolume ? '可调音量' : null,
    device.capabilities.supportsMetadata ? '封面/元数据' : null,
  ].filter(Boolean);
  const route = device.capabilities.requiresTranscode ? '需要转码' : '可直连';
  return [...controls, route, formatDeviceFormatSupport(device)].join(' · ') || '基础 DLNA 投送';
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

const formatTimestamp = (value: string | null): string => {
  if (!value) {
    return '未检测';
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

const formatHqEndpoint = (settings: Pick<HqPlayerSettings, 'host' | 'port'>): string =>
  settings.port ? `${settings.host}:${settings.port}` : `${settings.host}:未配置`;

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

const formatHqPlayerSendMessage = (plan: HqPlayerPlaybackControlPlan | null): string => {
  const send = plan?.send ?? null;
  if (!send) {
    return '未发送';
  }

  if (send.state === 'sent') {
    return `已发送 · ${send.elapsedMs}ms`;
  }

  if (send.state === 'prepared') {
    return '已准备';
  }

  const reason = send.reason ? hqPlayerSendReasonLabel[send.reason] : send.message;
  return `${send.state === 'failed' ? '发送失败' : '未发送'} · ${reason ?? '未知原因'}`;
};

const formatHqPlayerProduct = (
  controlInfo: HqPlayerConnectionTestResult['controlInfo'] | HqPlayerStatus['controlInfo'] | null | undefined,
): string =>
  controlInfo?.product
    ? [controlInfo.product, controlInfo.version].filter(Boolean).join(' ')
    : '待检测';

const formatHqPlayerEngine = (
  controlInfo: HqPlayerConnectionTestResult['controlInfo'] | HqPlayerStatus['controlInfo'] | null | undefined,
): string =>
  controlInfo?.engine ?? controlInfo?.platform ?? '待检测';

const formatHqPlayerRemotePosition = (status: HqPlayerRemotePlaybackStatus | null): string => {
  if (!status) {
    return '待检测';
  }

  const position = status.positionSeconds ?? 0;
  const duration = status.durationSeconds ?? 0;
  return `${hqPlayerRemoteStateLabel[status.state]} · ${formatTime(position)} / ${formatTime(duration)}`;
};

const formatHqPlayerSignal = (status: HqPlayerRemotePlaybackStatus | null): string => {
  if (!status) {
    return '待检测';
  }

  const format = status.activeRate && status.activeBits && status.activeChannels
    ? `${status.activeRate}Hz / ${status.activeBits}bit / ${status.activeChannels}ch`
    : '格式待回读';
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

const deviceVisual = (device: ConnectDevice): { icon: JSX.Element; label: string; tone: string } => {
  if (device.protocol === 'hqplayer') {
    return { icon: <HqPlayerGlyph />, label: 'HQPlayer', tone: 'hqplayer' };
  }

  if (device.protocol === 'airplay') {
    return { icon: <AirPlayGlyph />, label: 'AirPlay', tone: 'airplay' };
  }

  if (looksLikeTvDevice(device)) {
    return { icon: <TvGlyph />, label: 'TV', tone: 'tv' };
  }

  return { icon: <StreamerGlyph />, label: '数播', tone: 'streamer' };
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
  const [copiedAirPlayDebug, setCopiedAirPlayDebug] = useState(false);
  const [isAutoStartBusy, setIsAutoStartBusy] = useState(false);
  const [autoStartReceiversEnabled, setAutoStartReceiversEnabled] = useState(false);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [isCommandBusy, setIsCommandBusy] = useState(false);
  const [volumePercent, setVolumePercent] = useState(80);
  const [radioStations, setRadioStations] = useState<RadioStation[]>(() => readStoredRadioStations());
  const [radioNameDraft, setRadioNameDraft] = useState('');
  const [radioUrlDraft, setRadioUrlDraft] = useState('');
  const [activeRadioId, setActiveRadioId] = useState<string | null>(null);
  const [isRadioBusy, setIsRadioBusy] = useState(false);
  const [hqPlayerDraft, setHqPlayerDraft] = useState<HqPlayerSettings>(defaultHqPlayerSettings);
  const [hqPlayerStatus, setHqPlayerStatus] = useState<HqPlayerStatus | null>(null);
  const [hqPlayerTestResult, setHqPlayerTestResult] = useState<HqPlayerConnectionTestResult | null>(null);
  const [hqPlayerLastHandoff, setHqPlayerLastHandoff] = useState<HqPlayerPlaybackHandoffPlan | null>(null);
  const [hqPlayerLastControl, setHqPlayerLastControl] = useState<HqPlayerPlaybackControlPlan | null>(null);
  const [hqPlayerBusy, setHqPlayerBusy] = useState<'settings' | 'test' | null>(null);
  const [shouldRenderHqPlayerDetails, setShouldRenderHqPlayerDetails] = useState(defaultHqPlayerSettings.enabled);
  const [hiddenDeviceIds, setHiddenDeviceIds] = useState<Set<string>>(() => readStoredStringSet(hiddenConnectDevicesStorageKey));
  const [isDeviceSectionCollapsed, setIsDeviceSectionCollapsed] = useState(() =>
    readStoredBoolean(connectDeviceSectionCollapsedStorageKey, false),
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
  });
  const hqPlayerControlPlan = hqPlayerLastControl ?? hqPlayerLastHandoff?.control ?? null;
  const hqPlayerLastReason = hqPlayerLastHandoff?.reason ? hqPlayerHandoffReasonLabel[hqPlayerLastHandoff.reason] : null;
  const hqPlayerCurrentPlayable = useMemo(
    () => toHqPlayerPlayableTrack(currentTrack, currentFilePath),
    [currentFilePath, currentTrack],
  );
  const hqPlayerSendMessage = formatHqPlayerSendMessage(hqPlayerControlPlan);
  const hqPlayerControlInfo = hqPlayerTestResult?.controlInfo ?? hqPlayerStatus?.controlInfo ?? null;
  const hqPlayerPlaybackStatus = hqPlayerTestResult?.playbackStatus ?? hqPlayerStatus?.playbackStatus ?? null;
  const hqPlayerProductLabel = formatHqPlayerProduct(hqPlayerControlInfo);
  const hqPlayerEngineLabel = formatHqPlayerEngine(hqPlayerControlInfo);
  const hqPlayerRemotePositionLabel = formatHqPlayerRemotePosition(hqPlayerPlaybackStatus);
  const hqPlayerSignalLabel = formatHqPlayerSignal(hqPlayerPlaybackStatus);
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
    ? `${formatDeviceProduct(activeDevice)} · ${formatDeviceAddress(activeDevice)}`
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
    ? `${playbackState === 'playing' ? '播放中' : playbackState === 'paused' ? '已暂停' : '准备中'} · ${activeRadioStation.name}`
    : '未播放电台';

  const refreshDevices = useCallback(async (): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect) {
      setError('Desktop bridge unavailable. 请在 Electron 桌面端使用 Connect。');
      return;
    }

    setIsRefreshing(true);
    setError(null);
    try {
      setDevices(await connect.refresh());
      setStatus(await connect.getStatus());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

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

  useEffect(() => {
    const connect = window.echo?.connect;
    if (!connect) {
      return;
    }

    let disposed = false;
    void connect
      .listDevices()
      .then((items) => {
        if (!disposed) {
          setDevices(items);
        }
      })
      .catch(() => undefined);
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
      }
    }).catch(() => undefined);
    void refreshDevices();
    void refreshHqPlayer();
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
  }, [refreshDevices, refreshHqPlayer]);

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
      setError('Desktop bridge unavailable. 请在 Electron 桌面端保存 Connect 设置。');
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
  }, [autoStartReceiversEnabled]);

  const patchHqPlayerDraft = useCallback((patch: Partial<HqPlayerSettings>): void => {
    setHqPlayerDraft((current) => withHqPlayerFriendlyDefaults({ ...current, ...patch }));
    setHqPlayerTestResult(null);
  }, []);

  const saveHqPlayerSettings = useCallback(async (settings: HqPlayerSettings = hqPlayerEffectiveDraft): Promise<HqPlayerSettings | null> => {
    const hqPlayer = window.echo?.hqPlayer;
    if (!hqPlayer) {
      setError('Desktop bridge unavailable. 请在 Electron 桌面端配置 HQPlayer。');
      return null;
    }

    const saved = await hqPlayer.setSettings(withHqPlayerFriendlyDefaults(settings));
    setHqPlayerDraft(withHqPlayerFriendlyDefaults(saved));
    setHqPlayerStatus(await hqPlayer.getStatus());
    window.dispatchEvent(new CustomEvent('settings:changed', { detail: { hqPlayer: saved } }));
    return saved;
  }, [hqPlayerEffectiveDraft]);

  const handleHqPlayerTestConnection = useCallback(async (): Promise<void> => {
    const hqPlayer = window.echo?.hqPlayer;
    if (!hqPlayer) {
      setError('Desktop bridge unavailable. 请在 Electron 桌面端测试 HQPlayer。');
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
      setError('Desktop bridge unavailable. 请在 Electron 桌面端使用 Connect。');
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
  }, [receiverStatus.enabled]);

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
      setError('AirPlay receiver bridge unavailable.');
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
  }, [airPlayReceiverStatus.enabled]);

  const stopAirPlayReceiverPlayback = useCallback(async (): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect?.stopAirPlayReceiverPlayback) {
      setError('AirPlay receiver bridge unavailable.');
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
  }, []);

  const copyAirPlayDebug = useCallback(async (): Promise<void> => {
    if (!airPlayDebugText) {
      return;
    }

    try {
      await writeTextToClipboard(airPlayDebugText);
      setCopiedAirPlayDebug(true);
      window.setTimeout(() => setCopiedAirPlayDebug(false), 1600);
    } catch (copyError) {
      setError(copyError instanceof Error ? `Failed to copy AirPlay Debug: ${copyError.message}` : 'Failed to copy AirPlay Debug.');
    }
  }, [airPlayDebugText]);

  const connectDevice = useCallback(
    async (device: ConnectDevice): Promise<void> => {
      const connect = window.echo?.connect;
      if (!connect) {
        setError('Desktop bridge unavailable. 请在 Electron 桌面端使用 Connect。');
        return;
      }

      if (!currentTrack && !currentFilePath) {
        setError('请先播放或选中一首歌，Connect 不允许空元数据投送。');
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
    [currentFilePath, currentPositionSeconds, currentTrack],
  );

  const runCommand = useCallback(async (command: 'play' | 'pause' | 'stop' | 'disconnect'): Promise<void> => {
    const connect = window.echo?.connect;
    if (!connect) {
      setError('Desktop bridge unavailable. 请在 Electron 桌面端使用 Connect。');
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
  }, []);

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
      setError('请输入 http/https 电台直播流 URL，且不要带账号密码。');
      return null;
    }

    const now = new Date().toISOString();
    const name = radioNameDraft.trim() || stationNameFromUrl(url);
    return {
      id: radioStationIdForUrl(url),
      name,
      url,
      createdAt: now,
      updatedAt: now,
      lastPlayedAt,
    };
  }, [radioNameDraft, radioUrlDraft]);

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
    const playback = window.echo?.playback;
    if (!playback?.playLocalFile) {
      setError('Desktop bridge unavailable. 请在 Electron 桌面端播放网络电台。');
      return;
    }

    const url = normalizeRadioUrl(station.url);
    if (!url) {
      setError('电台 URL 无效，只支持 http/https 直播流。');
      return;
    }

    const now = new Date().toISOString();
    const playableStation: RadioStation = {
      ...station,
      id: radioStationIdForUrl(url),
      name: station.name.trim() || stationNameFromUrl(url),
      url,
      updatedAt: now,
      lastPlayedAt: now,
    };

    setIsRadioBusy(true);
    setError(null);
    try {
      const disconnectedStatus = await window.echo?.connect?.disconnect?.().catch(() => null);
      if (disconnectedStatus) {
        setStatus(disconnectedStatus);
      }

      await playback.playLocalFile({
        filePath: playableStation.url,
        trackId: radioTrackIdForUrl(playableStation.url),
        metadata: {
          title: playableStation.name,
          artist: 'Internet Radio',
          album: 'ECHO Radio',
        },
        probe: {
          durationSeconds: 0,
          channels: 2,
          codec: 'stream',
        },
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
  }, [upsertRadioStation]);

  const playRadioDraft = useCallback(async (event?: { preventDefault: () => void }): Promise<void> => {
    event?.preventDefault();
    const station = createRadioStationFromDraft(null);
    if (!station) {
      return;
    }

    await playRadioStation(station);
  }, [createRadioStationFromDraft, playRadioStation]);

  const stopRadioPlayback = useCallback(async (): Promise<void> => {
    const playback = window.echo?.playback;
    if (!playback?.stop) {
      setError('Desktop bridge unavailable. 请在 Electron 桌面端停止网络电台。');
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
  }, []);

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
          <button className="settings-action-button" type="button" onClick={() => void refreshDevices()} disabled={isRefreshing}>
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
                  const deviceProduct = formatDeviceProduct(device);
                  const deviceAddress = formatDeviceAddress(device);
                  const deviceSupport = formatDeviceSupport(device);
                  const visual = deviceVisual(device);
                  return (
                    <article
                      className="connect-device-row"
                      data-active={isActive ? 'true' : undefined}
                      key={device.id}
                      title="右键隐藏此设备"
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
                        <div className="connect-device-facts" aria-label={`${device.name} 设备信息`}>
                          <small>{deviceAddress}</small>
                          <small>{deviceSupport}</small>
                          <small>{device.lastSeenAt ? `最后发现 ${formatTimestamp(device.lastSeenAt)}` : '尚未完成发现'}</small>
                        </div>
                        {device.unsupportedReason ? <small>{device.unsupportedReason}</small> : null}
                      </div>
                      <div className="connect-device-meta">
                        <span data-state={device.state}>{t(isActive ? stateLabel[status.state] : deviceStateLabel[device.state])}</span>
                        <small>{visual.label}</small>
                      </div>
                      <button
                        className="settings-action-button"
                        type="button"
                        disabled={disabled}
                        onClick={() => void connectDevice(device)}
                      >
                        {isBusy ? <Loader2 className="spinning-icon" size={15} /> : device.protocol === 'hqplayer' ? <Cable size={15} /> : <Cast size={15} />}
                        {isActive ? '重新投送' : '连接'}
                      </button>
                    </article>
                  );
                })}
              </div>
            </>
          ) : null}
        </section>
      </section>

      <section className="connect-radio-panel" aria-label="网络电台">
        <div className="connect-section-title">
          <div>
            <span>Radio</span>
            <h2>网络电台</h2>
          </div>
          <small>{radioStatusLabel}</small>
        </div>

        <form className="connect-radio-form" aria-label="网络电台表单" onSubmit={(event) => void playRadioDraft(event)}>
          <label className="connect-radio-field">
            <span>电台名</span>
            <input
              type="text"
              value={radioNameDraft}
              placeholder="例如 Groove Salad"
              onChange={(event) => setRadioNameDraft(event.currentTarget.value)}
            />
          </label>
          <label className="connect-radio-field connect-radio-field--url">
            <span>直播流 URL</span>
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
              收藏
            </button>
            <button className="settings-action-button" type="submit" disabled={isRadioBusy}>
              {isRadioBusy ? <Loader2 className="spinning-icon" size={15} /> : <Radio size={15} />}
              播放
            </button>
            <button className="settings-action-button" type="button" onClick={() => void stopRadioPlayback()} disabled={isRadioBusy || !isRadioActive}>
              <Square size={15} />
              停止
            </button>
          </div>
        </form>

        <div className="connect-radio-list" aria-label="已收藏电台">
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
                      <small className="connect-radio-last-played">上次播放 {formatTimestamp(station.lastPlayedAt)}</small>
                    ) : (
                      <small className="connect-radio-last-played">未播放</small>
                    )}
                  </div>
                  <div className="connect-radio-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`播放 ${station.name}`}
                      title={`播放 ${station.name}`}
                      disabled={isRadioBusy}
                      onClick={() => void playRadioStation(station)}
                    >
                      {isRadioBusy && isActive ? <Loader2 className="spinning-icon" size={16} /> : <Play size={16} />}
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`删除 ${station.name}`}
                      title={`删除 ${station.name}`}
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
              <strong>添加一个直播流 URL</strong>
              <span>先支持手动电台收藏，避免目录接口拖慢 Connect。</span>
            </div>
          )}
        </div>
      </section>

      <section className="connect-hqplayer-panel" aria-label="HQPlayer Connect" data-collapsed={isHqPlayerExpanded ? undefined : 'true'}>
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
          </div>
        </div>

        {shouldShowHqPlayerDetails ? (
          <div className="connect-hqplayer-layout" data-expanded={isHqPlayerExpanded ? 'true' : 'false'}>
          <div className="connect-hqplayer-config">
            <div className="connect-hqplayer-local-card">
              <strong>{t('connectPage.hqplayer.localDesktop')}</strong>
              <span>{formatHqEndpoint({ host: hqPlayerLocalHost, port: hqPlayerDefaultPort })}</span>
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
                <span>串流保护</span>
                <button
                  aria-label="HQPlayer 媒体服务"
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
              <summary>高级设置</summary>
              <div className="connect-hqplayer-segments" aria-label="HQPlayer 连接模式">
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
                    {hqPlayerModeLabel[mode]}
                  </button>
                ))}
              </div>

              <div className="connect-hqplayer-segments" aria-label="HQPlayer 默认交接">
                {hqPlayerDefaultBackends.map((backend) => (
                  <button
                    className="connect-hqplayer-chip"
                    data-active={hqPlayerEffectiveDraft.defaultPlaybackBackend === backend ? 'true' : undefined}
                    key={backend}
                    type="button"
                    onClick={() => patchHqPlayerDraft({ defaultPlaybackBackend: backend })}
                  >
                    {hqPlayerBackendLabel[backend]}
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
                  <span>控制端口</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={hqPlayerEffectiveDraft.port ?? ''}
                    onChange={(event) => patchHqPlayerDraft({ port: parsePort(event.currentTarget.value) })}
                  />
                </label>
                <label className="connect-hqplayer-field">
                  <span>媒体端口</span>
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
              <em>控制端点</em>
              <strong>{hqPlayerEndpointLabel}</strong>
            </span>
            <span>
              <em>默认交接</em>
              <strong>{hqPlayerBackendLabel[hqPlayerEffectiveDraft.defaultPlaybackBackend]}</strong>
            </span>
            <span>
              <em>串流保护</em>
              <strong>{hqPlayerDraft.mediaServerEnabled ? (hqPlayerDraft.mediaServerPort ? `ECHO:${hqPlayerDraft.mediaServerPort}` : '自动端口') : '关闭'}</strong>
            </span>
            <span>
              <em>上次检测</em>
              <strong>{formatTimestamp(hqPlayerStatus?.lastCheckedAt ?? null)}</strong>
            </span>
            {hqPlayerTestResult ? (
              <span className={hqPlayerTestResult.ok ? 'is-ok' : 'is-error'}>
                <em>检测结果</em>
                <strong>{hqPlayerTestResult.ok ? `可用 · ${hqPlayerTestResult.elapsedMs}ms` : hqPlayerTestResult.error ?? '不可用'}</strong>
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
              <em>远端状态</em>
              <strong>{hqPlayerRemotePositionLabel}</strong>
            </span>
            <span className="connect-hqplayer-status-grid__wide">
              <em>信号路径</em>
              <strong>{hqPlayerSignalLabel}</strong>
            </span>
          </div>

          <div className="connect-hqplayer-plan">
            <div className="connect-hqplayer-plan-header">
              <SlidersHorizontal size={16} />
              <span>最近交接计划</span>
            </div>
            <div className="connect-hqplayer-plan-row">
              <em>Handoff</em>
              <strong>{hqPlayerLastHandoff ? (hqPlayerLastReason ?? hqPlayerLastHandoff.state) : '暂无'}</strong>
            </div>
            <div className="connect-hqplayer-plan-row">
              <em>Control</em>
              <strong>{hqPlayerControlPlan ? `${hqPlayerControlPlan.action} · ${hqPlayerControlPlan.transport}` : '暂无'}</strong>
            </div>
            <div className="connect-hqplayer-plan-row">
              <em>Send</em>
              <strong>{hqPlayerSendMessage}</strong>
            </div>
            <div className="connect-hqplayer-plan-row">
              <em>Source</em>
              <strong>
                {hqPlayerControlPlan?.source
                  ? `${hqPlayerExposureLabel[hqPlayerControlPlan.source.exposure]} · ${hqPlayerControlPlan.source.mimeType ?? 'audio'}`
                  : '暂无'}
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
              <strong>{hqPlayerControlPlan?.metadata?.title ?? hqPlayerCurrentPlayable?.title ?? '暂无当前歌曲'}</strong>
            </div>
            <div className="connect-hqplayer-plan-row">
              <em>Headers</em>
              <strong>{hqPlayerControlPlan?.source?.hasHeaders ? '需要媒体服务隐藏' : '不暴露请求头'}</strong>
            </div>
            <div className="connect-hqplayer-plan-footer">
              <Server size={15} />
              <span>{hqPlayerEffectiveDraft.connectionMode === 'remote' ? '远程模式会优先使用 ECHO 媒体服务' : '本机模式可直接交接本地文件或本机流地址'}</span>
            </div>
          </div>
          </div>
        ) : null}
        {!isHqPlayerExpanded ? (
          <div className="connect-hqplayer-collapsed">
            <div className="connect-hqplayer-local-card">
              <strong>{t('connectPage.hqplayer.localDesktop')}</strong>
              <span>{formatHqEndpoint({ host: hqPlayerLocalHost, port: hqPlayerDefaultPort })}</span>
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
        <details className="connect-receiver-debug" aria-label="DLNA request log">
          <summary>
            <span>DLNA Debug</span>
            <small>{receiverStatus.debugEvents.length > 0 ? `${receiverStatus.debugEvents.length} recent` : 'No requests'}</small>
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
              <small>No DLNA requests yet</small>
            )}
          </div>
        </details>
      </section>

      <section className="connect-receiver-panel" aria-label="AirPlay 实验接收">
        <div className="connect-section-title">
          <div>
            <span>AirPlay Spike</span>
            <h2>接收来自 iPhone</h2>
          </div>
          <button className="settings-action-button" type="button" onClick={() => void toggleAirPlayReceiver()} disabled={isAirPlayReceiverBusy}>
            {isAirPlayReceiverBusy ? <Loader2 className="spinning-icon" size={16} /> : <Power size={16} />}
            {airPlayReceiverStatus.enabled ? '关闭 AirPlay' : '开启 AirPlay'}
          </button>
        </div>
        <div className="connect-receiver-body">
          <div className="connect-artwork" data-empty={!airPlayCover}>
            {airPlayCover ? <img alt="" src={airPlayCover} /> : <Cast size={42} />}
          </div>
          <div className="connect-now-copy">
            <span>{airPlayStateLabel[airPlayReceiverStatus.state]}</span>
            <h2>{airPlayTitle}</h2>
            <p>{airPlayArtist}{airPlayAlbum ? ` 路 ${airPlayAlbum}` : ''}</p>
            <div className="connect-progress" aria-label="AirPlay 播放进度">
              <span style={{ width: `${airPlayProgressPercent}%` }} />
            </div>
            <small>
              {formatTime(airPlayReceiverStatus.positionSeconds)} / {formatTime(airPlayReceiverStatus.durationSeconds)}
            </small>
          </div>
          <div className="connect-receiver-meta">
            <span>{airPlayReceiverStatus.advertisedName}</span>
            <small>{airPlayReceiverStatus.currentClient ? `来自 ${airPlayReceiverStatus.currentClient.address}` : '等待 iPhone / iPad'}</small>
            <small>
              {airPlayReceiverStatus.error ?? (airPlayReceiverStatus.nativeAvailable ? 'RAOP 后端已加载' : '需要可用的 AirPlay 原生后端')}
            </small>
            <small>使用 AirPlay 后进度条将被锁定</small>
          </div>
          <button
            className="settings-action-button"
            type="button"
            onClick={() => void stopAirPlayReceiverPlayback()}
            disabled={isAirPlayReceiverBusy || !airPlayReceiverStatus.currentSourceId}
          >
            <Square size={15} />
            停止 AirPlay
          </button>
        </div>
        <details className="connect-receiver-debug" aria-label="AirPlay receiver log">
          <summary>
            <span>AirPlay Debug</span>
            <div className="connect-receiver-debug__actions">
              <small>{airPlayReceiverStatus.debugEvents.length > 0 ? `${airPlayReceiverStatus.debugEvents.length} recent` : 'No requests'}</small>
              <button
                className="connect-debug-copy-button"
                type="button"
                aria-label="Copy AirPlay Debug"
                title="Copy AirPlay Debug"
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
              <small>No AirPlay events yet</small>
            )}
          </div>
        </details>
      </section>

    </div>
  );
};
