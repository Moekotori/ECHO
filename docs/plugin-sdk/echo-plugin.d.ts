type EchoPluginPermission =
  /** Active: read the current playback state snapshot. */
  | 'playback:read'
  /** Active: play, pause, stop, or seek. */
  | 'playback:control'
  /** Active: read library summaries and paged public track fields. */
  | 'library:read'
  /** Reserved in v1: declared for forward compatibility, but no write API is exposed. */
  | 'library:write'
  /** Active: register custom source providers that return bounded track candidates and explicit audio URLs. */
  | 'sources:provide'
  /** Active: read an application settings snapshot. */
  | 'settings:read'
  /** Active high-risk permission: write a small settings patch, not a full settings object. */
  | 'settings:write'
  /** Active in apiVersion 2: host-mediated http/https fetch with timeout, size, method, and header guardrails. */
  | 'network'
  /** Limited in v1: use echo.storage only; no arbitrary file API is exposed. */
  | 'fs:plugin';

type EchoPluginEventName = 'playback:status' | 'library:changed';

type EchoPlaybackStatus = {
  host?: string;
  state: string;
  currentTrackId: string | null;
  currentFilePath?: string | null;
  durationSeconds?: number;
  positionSeconds?: number;
  volume?: number;
};

type EchoPluginTrackField =
  | 'id'
  | 'mediaType'
  | 'path'
  | 'sourceId'
  | 'provider'
  | 'remotePath'
  | 'stableKey'
  | 'title'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'trackNo'
  | 'discNo'
  | 'year'
  | 'genre'
  | 'duration'
  | 'codec'
  | 'sampleRate'
  | 'bitDepth'
  | 'bitrate'
  | 'bpm'
  | 'coverId'
  | 'coverThumb'
  | 'metadataStatus'
  | 'embeddedMetadataStatus'
  | 'embeddedCoverStatus'
  | 'networkMetadataStatus'
  | 'fieldSources'
  | 'unavailable';

type EchoPluginTrack = Partial<Record<EchoPluginTrackField, unknown>> & {
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverThumb?: string | null;
  unavailable?: boolean;
};

type EchoPluginMetadataLookupTrack = {
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  duration?: number;
};

type EchoPluginMetadataLookupRequest = {
  track: EchoPluginMetadataLookupTrack;
  provider?: {
    pluginId: string;
    providerId: string;
  };
};

type EchoPluginMetadataCandidate = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  bpm?: number;
  confidence?: number;
  source?: string;
  sourceUrl?: string;
};

type EchoPluginMetadataProviderResult = {
  candidates?: EchoPluginMetadataCandidate[];
};

type EchoPluginMetadataProviderOptions = {
  title?: string;
  description?: string;
};

type EchoPluginSourceSearchRequest = {
  query: string;
  page?: number;
  pageSize?: number;
  provider?: {
    pluginId: string;
    providerId: string;
  };
};

type EchoPluginSourceTrack = {
  providerTrackId: string;
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  duration?: number | null;
  coverUrl?: string | null;
  webUrl?: string | null;
  playable?: boolean;
  unavailableReason?: string | null;
  source?: string;
};

type EchoPluginSourceSearchResult = {
  tracks?: EchoPluginSourceTrack[];
  total?: number | null;
  hasMore?: boolean;
};

type EchoPluginSourcePlaybackRequest = {
  pluginId: string;
  providerId: string;
  providerTrackId: string;
};

type EchoPluginSourcePlaybackResult = {
  url: string;
  expiresAt?: string | null;
  mimeType?: string | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  bitDepth?: number | null;
  codec?: string | null;
  headers?: Record<string, string>;
  requiresProxy?: boolean;
  supportsRange?: boolean;
};

type EchoPluginSourceProviderOptions = {
  title?: string;
  description?: string;
};

type EchoPluginSourceProviderHandlers = {
  search(request: EchoPluginSourceSearchRequest): EchoPluginSourceSearchResult | Promise<EchoPluginSourceSearchResult>;
  resolvePlayback?(request: EchoPluginSourcePlaybackRequest): EchoPluginSourcePlaybackResult | Promise<EchoPluginSourcePlaybackResult>;
};

type EchoPluginLyricsCandidate = {
  title?: string;
  language?: string;
  lrc?: string;
  text?: string;
  source?: string;
  sourceUrl?: string;
  confidence?: number;
};

type EchoPluginLyricsProviderResult = {
  candidates?: EchoPluginLyricsCandidate[];
};

type EchoPluginCoverCandidate = {
  imageUrl: string;
  title?: string;
  source?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  confidence?: number;
};

type EchoPluginCoverProviderResult = {
  candidates?: EchoPluginCoverCandidate[];
};

type EchoPluginNetworkRequest = {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

type EchoPluginTrackQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: 'default' | 'titleAsc' | 'titleDesc' | 'artist' | 'album' | 'recent' | 'durationAsc' | 'durationDesc' | 'qualityAsc' | 'qualityDesc' | 'frequent';
  sourceProvider?: 'local' | 'netease' | 'qqmusic' | 'spotify' | 'remote';
  fields?: EchoPluginTrackField[];
};

type EchoPluginPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

type EchoPluginCommandOptions = {
  title?: string;
  description?: string;
};

type EchoPluginThemeBasePreset =
  | 'classic'
  | 'echoTwilight'
  | 'sakuraMilk'
  | 'peachSoda'
  | 'mintCandy'
  | 'berryDream'
  | 'matchaCream'
  | 'lemonMochi'
  | 'cottonCloud'
  | 'melonCream'
  | 'seaSaltJelly'
  | 'caramelPudding'
  | 'neonCandy'
  | 'nyanCat'
  | 'childrenDoodle'
  | 'wisteriaBubble'
  | 'strawberryCookie'
  | 'graphiteAurora'
  | 'amberNoir'
  | 'oceanStudio'
  | 'rosewoodVinyl'
  | 'darkSideMoon'
  | 'shibuyaNight'
  | 'kyotoKurenai'
  | 'ukiyoIndigo'
  | 'fujiSnow'
  | 'matsuriLantern'
  | 'ginzaNoir'
  | 'frostJazz'
  | 'FINAL';

type EchoPluginThemeToneOverride = {
  appBg?: string;
  appBg2?: string;
  appBg3?: string;
  panel?: string;
  panelSoft?: string;
  accent?: string;
  accentStrong?: string;
  secondary?: string;
  heading?: string;
  text?: string;
  muted?: string;
  border?: string;
  onAccent?: string;
  buttonText?: string;
  titlebar?: string;
  sidebar?: string;
  player?: string;
  field?: string;
  row?: string;
  rowHover?: string;
  rowActive?: string;
  chip?: string;
  focus?: string;
  danger?: string;
  success?: string;
  warning?: string;
  panelOpacityPercent?: number;
  glassPercent?: number;
  shadowPercent?: number;
  cornerRadiusPx?: number;
  panelBlurPx?: number;
  saturationPercent?: number;
  motionEnabled?: boolean;
  motionSpeedSeconds?: number;
  motionIntensityPercent?: number;
};

type EchoPluginThemePresetContribution = {
  id: string;
  title: string;
  description?: string;
  basePreset: EchoPluginThemeBasePreset;
  light?: EchoPluginThemeToneOverride;
  dark?: EchoPluginThemeToneOverride;
  preview?: string;
  swatches?: string[];
};

/**
 * ECHO Next plugin API v1/v2.
 *
 * Runtime guardrails:
 * - command args are limited to 64 KB serialized JSON
 * - command results are limited to 256 KB serialized JSON
 * - commands time out after 2 seconds
 * - async event handlers that exceed 2 seconds are logged as timeouts
 * - metadata providers return candidates only; the host decides whether and how to apply them
 * - source providers return bounded track candidates; playback must resolve to explicit http/https audio URLs
 * - theme presets are declared in echo.plugin.json contributes.themePresets; plugins do not inject arbitrary CSS
 * - apiVersion 2 network access must go through echo.net and requires the network permission
 * - apiVersion 2 settings are plugin-owned; apiVersion 1 settings keep the legacy app-settings bridge
 * - plugins do not get Node, Electron, SQLite, app DOM, decoder, DSP, or output access
 */
type EchoPluginApi = {
  events: {
    on(eventName: 'playback:status', handler: (status: EchoPlaybackStatus) => void | Promise<void>): () => void;
    on(eventName: 'library:changed', handler: (payload: unknown) => void | Promise<void>): () => void;
    on(eventName: EchoPluginEventName, handler: (payload: unknown) => void | Promise<void>): () => void;
  };
  commands: {
    register(commandId: string, handler: (...args: unknown[]) => unknown): void;
    register(commandId: string, options: EchoPluginCommandOptions, handler: (...args: unknown[]) => unknown): void;
  };
  metadata: {
    registerProvider(providerId: string, handler: (request: EchoPluginMetadataLookupRequest) => EchoPluginMetadataProviderResult | Promise<EchoPluginMetadataProviderResult>): void;
    registerProvider(providerId: string, options: EchoPluginMetadataProviderOptions, handler: (request: EchoPluginMetadataLookupRequest) => EchoPluginMetadataProviderResult | Promise<EchoPluginMetadataProviderResult>): void;
  };
  sources: {
    registerProvider(providerId: string, handlers: EchoPluginSourceProviderHandlers): void;
    registerProvider(providerId: string, options: EchoPluginSourceProviderOptions, handlers: EchoPluginSourceProviderHandlers): void;
  };
  lyrics: {
    registerProvider(providerId: string, handler: (request: EchoPluginMetadataLookupRequest) => EchoPluginLyricsProviderResult | Promise<EchoPluginLyricsProviderResult>): void;
    registerProvider(providerId: string, options: EchoPluginMetadataProviderOptions, handler: (request: EchoPluginMetadataLookupRequest) => EchoPluginLyricsProviderResult | Promise<EchoPluginLyricsProviderResult>): void;
  };
  covers: {
    registerProvider(providerId: string, handler: (request: EchoPluginMetadataLookupRequest) => EchoPluginCoverProviderResult | Promise<EchoPluginCoverProviderResult>): void;
    registerProvider(providerId: string, options: EchoPluginMetadataProviderOptions, handler: (request: EchoPluginMetadataLookupRequest) => EchoPluginCoverProviderResult | Promise<EchoPluginCoverProviderResult>): void;
  };
  playback: {
    getStatus(): Promise<EchoPlaybackStatus>;
    play(): Promise<unknown>;
    pause(): Promise<unknown>;
    stop(): Promise<unknown>;
    seek(positionSeconds: number): Promise<unknown>;
  };
  library: {
    getSummary(): Promise<Record<string, unknown>>;
    getTracks(query?: EchoPluginTrackQuery): Promise<EchoPluginPage<EchoPluginTrack>>;
  };
  settings: {
    get<T = unknown>(key?: string): Promise<T>;
    getAll(): Promise<Record<string, string | number | boolean | null>>;
    set(key: string, value: string | number | boolean | null): Promise<Record<string, string | number | boolean | null>>;
    set(patch: Record<string, string | number | boolean | null>): Promise<Record<string, string | number | boolean | null>>;
  };
  net: {
    fetchJson<T = unknown>(request: string | EchoPluginNetworkRequest): Promise<T>;
    fetchText(request: string | EchoPluginNetworkRequest): Promise<string>;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
  ui: {
    notify(message: string): Promise<void>;
  };
};

type EchoPluginPanelAction = 'plugin:getSummary' | 'plugin:getLogs' | 'plugin:runCommand';

type EchoPluginPanelRequest = {
  channel: 'echo:plugin-panel';
  version: 1;
  type: 'request';
  requestId: string;
  pluginId: string;
  action: EchoPluginPanelAction;
  payload?: unknown;
};

type EchoPluginPanelResponse =
  | {
      channel: 'echo:plugin-panel';
      version: 1;
      type: 'response';
      requestId: string;
      pluginId: string;
      ok: true;
      result: unknown;
    }
  | {
      channel: 'echo:plugin-panel';
      version: 1;
      type: 'response';
      requestId: string;
      pluginId: string;
      ok: false;
      error: string;
    };

declare const echo: EchoPluginApi;
