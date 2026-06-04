import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, extname, join, resolve } from 'node:path';
import vm from 'node:vm';
import { app, dialog, shell } from 'electron';
import type { AudioStatus } from '../../shared/types/audio';
import { pluginEventNames, pluginLibraryTrackFields, pluginPermissionDescriptors } from '../../shared/types/plugins';
import type {
  PluginActivitySummary,
  PluginCommand,
  PluginCompatibilitySummary,
  PluginCoverCandidate,
  PluginCoverLookupRequest,
  PluginCoverLookupResult,
  PluginCoverProvider,
  PluginCoverProviderResult,
  PluginCreateExampleKind,
  PluginCreateExampleResult,
  PluginEnableRequest,
  PluginHealthSummary,
  PluginEventName,
  PluginImportPackageResult,
  PluginLyricsCandidate,
  PluginLyricsLookupRequest,
  PluginLyricsLookupResult,
  PluginLyricsProvider,
  PluginLyricsProviderResult,
  PluginLibraryTrack,
  PluginLibraryTrackField,
  PluginLibraryTrackPage,
  PluginLibraryTracksQuery,
  PluginListResult,
  PluginLogEntry,
  PluginManifest,
  PluginManifestContributes,
  PluginMetadataCandidate,
  PluginMetadataLookupRequest,
  PluginMetadataLookupResult,
  PluginMetadataLookupTrack,
  PluginMetadataProvider,
  PluginMetadataProviderResult,
  PluginNetworkRequest,
  PluginPackageInfo,
  PluginPackage,
  PluginPackageFile,
  PluginPermission,
  PluginSettingsPatch,
  PluginSettingsResult,
  PluginRunCommandRequest,
  PluginSecuritySummary,
  PluginSourcePlaybackRequest,
  PluginSourcePlaybackResult,
  PluginSourceProvider,
  PluginSourceSearchProviderResult,
  PluginSourceSearchRequest,
  PluginSourceSearchResult,
  PluginSourceTrack,
  PluginSummary,
} from '../../shared/types/plugins';
import { getAppSettings, setAppSettings } from '../app/appSettings';
import { getAudioSession } from '../audio/AudioSession';
import { getLibraryService } from '../library/LibraryService';
import { fetchWithNetworkProxy } from '../network/networkFetch';
import { normalizePluginManifest } from './PluginManifest';

type PluginState = {
  enabled?: boolean;
  trustedPermissions?: PluginPermission[];
  disabledByHost?: boolean;
  crashTimestamps?: string[];
  lastError?: string;
  lastErrorAt?: string;
  packageInfo?: PluginPackageInfo;
};

type PluginStateFile = {
  plugins?: Record<string, PluginState>;
};

type RuntimeCommand = {
  id: string;
  title: string;
  description?: string;
  handler: (...args: unknown[]) => unknown;
};

type RuntimeMetadataProvider = {
  id: string;
  title: string;
  description?: string;
  handler: (request: PluginMetadataLookupRequest) => unknown;
};

type RuntimeSourceProvider = {
  id: string;
  title: string;
  description?: string;
  search: (request: PluginSourceSearchRequest) => unknown;
  resolvePlayback?: (request: PluginSourcePlaybackRequest) => unknown;
};

type RuntimeLyricsProvider = {
  id: string;
  title: string;
  description?: string;
  handler: (request: PluginLyricsLookupRequest) => unknown;
};

type RuntimeCoverProvider = {
  id: string;
  title: string;
  description?: string;
  handler: (request: PluginCoverLookupRequest) => unknown;
};

type RuntimeRecord = {
  manifest: PluginManifest;
  directory: string;
  commands: Map<string, RuntimeCommand>;
  metadataProviders: Map<string, RuntimeMetadataProvider>;
  sourceProviders: Map<string, RuntimeSourceProvider>;
  lyricsProviders: Map<string, RuntimeLyricsProvider>;
  coverProviders: Map<string, RuntimeCoverProvider>;
  eventHandlers: Map<string, Set<(payload: unknown) => unknown>>;
  statusTimer: ReturnType<typeof setTimeout> | null;
  pendingStatus: AudioStatus | null;
};

type PluginRecord = {
  manifest: PluginManifest | null;
  directory: string;
  enabled: boolean;
  trustedPermissions: PluginPermission[];
  status: PluginSummary['status'];
  error: string | null;
  disabledByHost: boolean;
};

const manifestFileName = 'echo.plugin.json';
const stateFileName = 'plugin-state.json';
const storageFileName = 'plugin-storage.json';
const commandTimeoutMs = 2_000;
const eventHandlerTimeoutMs = 2_000;
const metadataProviderTimeoutMs = 2_500;
const pluginNetworkTimeoutMs = 5_000;
const maxLogEntries = 160;
const maxLogMessageLength = 1_000;
const maxEventHandlersPerPlugin = 24;
const maxMetadataProvidersPerPlugin = 8;
const maxMetadataCandidatesPerProvider = 5;
const maxSourceProvidersPerPlugin = 4;
const maxLyricsProvidersPerPlugin = 4;
const maxCoverProvidersPerPlugin = 4;
const maxSourceTracksPerProvider = 25;
const maxLyricsCandidatesPerProvider = 5;
const maxCoverCandidatesPerProvider = 8;
const playbackStatusThrottleMs = 500;
const maxPluginLibraryPageSize = 100;
const defaultPluginLibraryPageSize = 50;
const maxPluginLibrarySearchLength = 120;
const maxPluginStorageKeyLength = 96;
const maxPluginStorageValueBytes = 64 * 1024;
const maxPluginStorageBytes = 256 * 1024;
const maxPluginSettingsPatchBytes = 32 * 1024;
const maxPluginCommandArgsBytes = 64 * 1024;
const maxPluginCommandResultBytes = 256 * 1024;
const maxPluginMetadataRequestBytes = 32 * 1024;
const maxPluginMetadataResultBytes = 64 * 1024;
const maxPluginSourceSearchRequestBytes = 32 * 1024;
const maxPluginSourceSearchResultBytes = 128 * 1024;
const maxPluginSourcePlaybackRequestBytes = 16 * 1024;
const maxPluginSourcePlaybackResultBytes = 32 * 1024;
const maxPluginLyricsRequestBytes = 32 * 1024;
const maxPluginLyricsResultBytes = 128 * 1024;
const maxPluginCoverRequestBytes = 32 * 1024;
const maxPluginCoverResultBytes = 128 * 1024;
const maxPluginNetworkRequestBytes = 64 * 1024;
const maxPluginNetworkResponseBytes = 512 * 1024;
const maxPluginSettingValueBytes = 32 * 1024;
const maxPluginSettingsBytes = 128 * 1024;
const pluginCrashLoopWindowMs = 10 * 60 * 1_000;
const pluginCrashLoopLimit = 3;
const pluginPackageType = 'echo-next-plugin-package';
const pluginPackageVersion = 1;
const maxPluginPackageBytes = 2 * 1024 * 1024;
const maxPluginPackageFiles = 32;
const maxPluginPackageFileBytes = 512 * 1024;
const exportablePluginFileExtensions = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.md', '.txt']);
const pluginPackageExcludedFiles = new Set([stateFileName, storageFileName]);
const pluginSettingsFileName = 'plugin-settings.json';
pluginPackageExcludedFiles.add(pluginSettingsFileName);
const allowedPluginNetworkMethods = new Set(['GET', 'POST']);
const allowedPluginRequestHeaders = new Set(['accept', 'accept-language', 'content-type', 'user-agent']);
const redactedHeaderNames = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token']);

const pluginEventSet = new Set<PluginEventName>(pluginEventNames);
const pluginEventPermissions: Record<PluginEventName, PluginPermission> = {
  'playback:status': 'playback:read',
  'library:changed': 'library:read',
};
const pluginLibraryTrackFieldSet = new Set<PluginLibraryTrackField>(pluginLibraryTrackFields);
const defaultPluginLibraryTrackFields: PluginLibraryTrackField[] = [
  'id',
  'mediaType',
  'path',
  'title',
  'artist',
  'album',
  'duration',
  'coverThumb',
  'unavailable',
];

const metadataTextFieldMaxLengths: Partial<Record<keyof PluginMetadataCandidate, number>> = {
  title: 180,
  artist: 180,
  album: 180,
  albumArtist: 180,
  genre: 80,
  source: 80,
  sourceUrl: 500,
};

const sourceTrackTextFieldMaxLengths: Partial<Record<keyof PluginSourceTrack, number>> = {
  providerTrackId: 180,
  title: 180,
  artist: 180,
  album: 180,
  albumArtist: 180,
  coverUrl: 1_000,
  webUrl: 1_000,
  unavailableReason: 240,
  source: 80,
};

const exampleTemplates: Record<PluginCreateExampleKind, { id: string; name: string; manifest: PluginManifest; script: string; panel?: string }> = {
  'playback-panel': {
    id: 'echo.playback-panel',
    name: '播放状态面板',
    manifest: {
      id: 'echo.playback-panel',
      name: '播放状态面板',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      panel: 'panel.html',
      permissions: ['playback:read'],
      contributes: {
        commands: [{ id: 'show-status', title: '显示当前播放状态' }],
        panels: [{ id: 'main', title: '播放状态', path: 'panel.html' }],
      },
    },
    script: [
      "echo.events.on('playback:status', async (status) => {",
      "  await echo.storage.set('lastStatus', {",
      "    state: status.state,",
      "    trackId: status.currentTrackId,",
      "    positionSeconds: Math.round(status.positionSeconds || 0)",
      "  });",
      '});',
      '',
      "echo.commands.register('show-status', { title: '显示当前播放状态' }, async () => {",
      '  const status = await echo.playback.getStatus();',
      "  await echo.ui.notify(`当前播放状态：${status.state}`);",
      '});',
    ].join('\n'),
    panel: [
      '<!doctype html>',
      '<meta charset="utf-8">',
      '<style>body{font:14px system-ui;margin:16px;color:#1f2937}button{margin:8px 0;padding:6px 10px}code{display:block;margin-top:8px;white-space:pre-wrap}</style>',
      '<h1>播放状态面板</h1>',
      '<p>这个面板运行在 sandbox iframe 中，通过 postMessage bridge 查询宿主。</p>',
      '<button id="refresh">刷新摘要</button>',
      '<button id="run">执行状态命令</button>',
      '<code id="output">等待宿主响应...</code>',
      '<script>',
      "const pluginId = 'echo.playback-panel';",
      "const channel = 'echo:plugin-panel';",
      'const pending = new Map();',
      "window.addEventListener('message', (event) => {",
      '  const message = event.data;',
      "  if (!message || message.channel !== channel || message.type !== 'response') return;",
      '  const resolve = pending.get(message.requestId);',
      '  if (!resolve) return;',
      '  pending.delete(message.requestId);',
      '  resolve(message);',
      '});',
      'const requestHost = (action, payload) => new Promise((resolve) => {',
      '  const requestId = `${Date.now()}-${Math.random()}`;',
      '  pending.set(requestId, resolve);',
      "  parent.postMessage({ channel, version: 1, type: 'request', requestId, pluginId, action, payload }, '*');",
      '});',
      'const output = document.getElementById("output");',
      'const show = (value) => { output.textContent = JSON.stringify(value, null, 2); };',
      'document.getElementById("refresh").addEventListener("click", async () => show(await requestHost("plugin:getSummary")));',
      'document.getElementById("run").addEventListener("click", async () => show(await requestHost("plugin:runCommand", { commandId: "show-status" })));',
      'requestHost("plugin:getSummary").then(show);',
      '</script>',
    ].join('\n'),
  },
  'command-tool': {
    id: 'echo.command-tool',
    name: '命令工具示例',
    manifest: {
      id: 'echo.command-tool',
      name: '命令工具示例',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['playback:read'],
      contributes: {
        commands: [{ id: 'copy-now-playing', title: '记录当前播放' }],
      },
    },
    script: [
      "echo.commands.register('copy-now-playing', { title: '记录当前播放' }, async () => {",
      '  const status = await echo.playback.getStatus();',
      "  await echo.storage.set('lastCommandResult', status.currentTrackId || status.state);",
      "  await echo.ui.notify('已记录当前播放状态到插件存储。');",
      '});',
    ].join('\n'),
  },
  'library-script': {
    id: 'echo.library-script',
    name: '曲库脚本示例',
    manifest: {
      id: 'echo.library-script',
      name: '曲库脚本示例',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['library:read'],
      contributes: {
        commands: [{ id: 'count-library', title: '统计曲库数量' }],
      },
    },
    script: [
      "echo.commands.register('count-library', { title: '统计曲库数量' }, async () => {",
      '  const summary = await echo.library.getSummary();',
      "  await echo.ui.notify(`当前曲库约 ${summary.trackCount || 0} 首。`);",
      '});',
    ].join('\n'),
  },
  'source-provider': {
    id: 'echo.source-provider',
    name: '自定义音源示例',
    manifest: {
      id: 'echo.source-provider',
      name: '自定义音源示例',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['sources:provide'],
      contributes: {
        sourceProviders: [{ id: 'direct-url', title: 'Direct URL Demo' }],
      },
    },
    script: [
      'const demoTracks = [',
      '  {',
      "    providerTrackId: 'demo-stream',",
      "    title: 'Demo stream',",
      "    artist: 'Local plugin',",
      "    album: 'Custom source',",
      '    duration: null,',
      '    playable: true,',
      "    source: 'Direct URL Demo',",
      "    url: 'https://example.com/audio/demo.mp3'",
      '  }',
      '];',
      '',
      "echo.sources.registerProvider('direct-url', { title: 'Direct URL Demo' }, {",
      '  search: async ({ query }) => ({',
      '    tracks: demoTracks',
      '      .filter((track) => !query || `${track.title} ${track.artist}`.toLowerCase().includes(query.toLowerCase()))',
      '      .map(({ url, ...track }) => track)',
      '  }),',
      '  resolvePlayback: async ({ providerTrackId }) => {',
      '    const track = demoTracks.find((item) => item.providerTrackId === providerTrackId);',
      "    if (!track) throw new Error('plugin_source_track_not_found');",
      '    return { url: track.url, mimeType: "audio/mpeg", supportsRange: true };',
      '  }',
      '});',
    ].join('\n'),
  },
  'theme-preset': {
    id: 'echo.theme-preset',
    name: '主题预设示例',
    manifest: {
      id: 'echo.theme-preset',
      name: '主题预设示例',
      version: '0.0.1',
      apiVersion: 2,
      entry: 'plugin.js',
      permissions: [],
      contributes: {
        themePresets: [
          {
            id: 'aurora-glass',
            title: 'Aurora Glass',
            description: '高透明玻璃、冷色背景和暖色强调的插件主题示例。',
            basePreset: 'classic',
            preview: 'linear-gradient(135deg, #08111f 0%, #183b56 48%, #f0b35b 100%)',
            swatches: ['#08111f', '#183b56', '#f0b35b', '#e8f8ff'],
            light: {
              appBg: '#eef8ff',
              appBg2: '#d7f1f4',
              appBg3: '#ffe3c0',
              panel: '#ffffff',
              panelSoft: '#e8f4f6',
              accent: '#257f96',
              accentStrong: '#114d64',
              secondary: '#d88a37',
              heading: '#102b39',
              text: '#234150',
              muted: '#5f7480',
              border: '#5c8795',
              onAccent: '#ffffff',
              panelOpacityPercent: 78,
              glassPercent: 26,
              cornerRadiusPx: 10,
              panelBlurPx: 18,
              saturationPercent: 108,
            },
            dark: {
              appBg: '#08111f',
              appBg2: '#10243a',
              appBg3: '#1b3142',
              panel: '#142234',
              panelSoft: '#0f1a2a',
              accent: '#5cc8dc',
              accentStrong: '#b7f2ff',
              secondary: '#f0b35b',
              heading: '#eefbff',
              text: '#c8dce8',
              muted: '#91a7b5',
              border: '#648999',
              onAccent: '#05111a',
              panelOpacityPercent: 72,
              glassPercent: 34,
              cornerRadiusPx: 10,
              panelBlurPx: 22,
              saturationPercent: 112,
              motionIntensityPercent: 90,
            },
          },
        ],
      },
    },
    script: [
      "console.log('theme preset plugin loaded');",
      "echo.commands.register('theme-info', { title: '主题说明' }, async () => {",
      "  await echo.ui.notify('这个插件通过 contributes.themePresets 提供主题参数，不注入任意 CSS。');",
      '});',
    ].join('\n'),
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const jsonClone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)) as T);

const jsonByteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');

const assertJsonByteLimit = (value: unknown, limit: number, errorCode: string): void => {
  if (jsonByteLength(value) > limit) {
    throw new Error(errorCode);
  }
};

const createEmptyPluginActivity = (): PluginActivitySummary => ({
  lastStartedAt: null,
  lastStoppedAt: null,
  lastCommandAt: null,
  lastEventAt: null,
  lastNetworkAt: null,
  lastProviderCallAt: null,
  lastStorageWriteAt: null,
  lastSettingsWriteAt: null,
  lastErrorAt: null,
  commandRunCount: 0,
  eventDispatchCount: 0,
  networkCallCount: 0,
  providerCallCount: 0,
  storageWriteCount: 0,
  settingsWriteCount: 0,
  errorCount: 0,
});

const normalizePluginPackageFilePath = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized || normalized.includes('/') || normalized.includes('\0') || normalized === '.' || normalized === '..' || normalized.includes(':')) {
    return '';
  }
  return normalized;
};

const isPluginPackageFile = (value: unknown): value is PluginPackageFile =>
  isRecord(value) && typeof value.path === 'string' && typeof value.content === 'string';

const checksumText = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const normalizePositiveInteger = (value: unknown, fallback: number, max: number): number => {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) ? Math.min(max, Math.max(1, normalized)) : fallback;
};

const normalizePluginLibraryTrackFields = (value: unknown): PluginLibraryTrackField[] => {
  if (!Array.isArray(value)) {
    return defaultPluginLibraryTrackFields;
  }

  const fields: PluginLibraryTrackField[] = [];
  for (const item of value) {
    if (typeof item === 'string' && pluginLibraryTrackFieldSet.has(item as PluginLibraryTrackField) && !fields.includes(item as PluginLibraryTrackField)) {
      fields.push(item as PluginLibraryTrackField);
    }
  }

  return fields.length > 0 ? fields : defaultPluginLibraryTrackFields;
};

const pluginLibrarySorts = new Set([
  'default',
  'titleAsc',
  'titleDesc',
  'artist',
  'artistAlbum',
  'album',
  'recent',
  'durationAsc',
  'durationDesc',
  'qualityAsc',
  'qualityDesc',
  'frequent',
]);
const pluginLibrarySourceProviders = new Set(['local', 'netease', 'qqmusic', 'spotify', 'remote']);

const normalizePluginLibraryTracksQuery = (query: unknown): { query: Omit<PluginLibraryTracksQuery, 'fields'>; fields: PluginLibraryTrackField[] } => {
  const input = isRecord(query) ? query : {};
  const page = normalizePositiveInteger(input.page, 1, 10_000);
  const pageSize = normalizePositiveInteger(input.pageSize, defaultPluginLibraryPageSize, maxPluginLibraryPageSize);
  const search = typeof input.search === 'string' ? input.search.trim().slice(0, maxPluginLibrarySearchLength) : undefined;
  const sort = typeof input.sort === 'string' && pluginLibrarySorts.has(input.sort) ? input.sort as PluginLibraryTracksQuery['sort'] : undefined;
  const sourceProvider =
    typeof input.sourceProvider === 'string' && pluginLibrarySourceProviders.has(input.sourceProvider)
      ? input.sourceProvider as PluginLibraryTracksQuery['sourceProvider']
      : undefined;

  return {
    query: {
      page,
      pageSize,
      ...(search ? { search } : {}),
      ...(sort ? { sort } : {}),
      ...(sourceProvider ? { sourceProvider } : {}),
    },
    fields: normalizePluginLibraryTrackFields(input.fields),
  };
};

const selectPluginLibraryTrackFields = (track: Record<string, unknown>, fields: PluginLibraryTrackField[]): PluginLibraryTrack => {
  const output: PluginLibraryTrack = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(track, field)) {
      output[field] = track[field] as never;
    }
  }
  return output;
};

const toPluginLibraryTrackPage = (page: unknown, fields: PluginLibraryTrackField[]): PluginLibraryTrackPage => {
  if (!isRecord(page) || !Array.isArray(page.items)) {
    return {
      items: [],
      page: 1,
      pageSize: defaultPluginLibraryPageSize,
      total: 0,
      hasMore: false,
    };
  }

  return {
    items: page.items.filter(isRecord).map((track) => selectPluginLibraryTrackFields(track, fields)),
    page: normalizePositiveInteger(page.page, 1, 10_000),
    pageSize: normalizePositiveInteger(page.pageSize, defaultPluginLibraryPageSize, maxPluginLibraryPageSize),
    total: Math.max(0, Math.floor(Number(page.total ?? 0))),
    hasMore: page.hasMore === true,
  };
};

const boundedText = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
};

const boundedPositiveNumber = (value: unknown, max: number): number | undefined => {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.min(max, normalized) : undefined;
};

const boundedInteger = (value: unknown, max: number): number | undefined => {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? Math.min(max, normalized) : undefined;
};

const normalizePluginMetadataLookupTrack = (value: unknown): PluginMetadataLookupTrack => {
  const input = isRecord(value) ? value : {};
  return {
    ...(boundedText(input.id, 120) ? { id: boundedText(input.id, 120) } : {}),
    ...(boundedText(input.title, 180) ? { title: boundedText(input.title, 180) } : {}),
    ...(boundedText(input.artist, 180) ? { artist: boundedText(input.artist, 180) } : {}),
    ...(boundedText(input.album, 180) ? { album: boundedText(input.album, 180) } : {}),
    ...(boundedText(input.albumArtist, 180) ? { albumArtist: boundedText(input.albumArtist, 180) } : {}),
    ...(boundedPositiveNumber(input.duration, 24 * 60 * 60) ? { duration: boundedPositiveNumber(input.duration, 24 * 60 * 60) } : {}),
  };
};

const normalizePluginMetadataLookupProvider = (value: unknown): PluginMetadataLookupRequest['provider'] => {
  const input = isRecord(value) ? value : {};
  const pluginId = boundedText(input.pluginId, 120);
  const providerId = boundedText(input.providerId, 120);
  return pluginId && providerId ? { pluginId, providerId } : undefined;
};

const normalizePluginMetadataCandidate = (value: unknown): PluginMetadataCandidate | null => {
  if (!isRecord(value)) {
    return null;
  }

  const candidate: PluginMetadataCandidate = {};
  for (const [field, maxLength] of Object.entries(metadataTextFieldMaxLengths) as Array<[keyof PluginMetadataCandidate, number]>) {
    const text = boundedText(value[field], maxLength);
    if (text) {
      candidate[field] = text as never;
    }
  }

  const year = boundedInteger(value.year, 9999);
  if (year) {
    candidate.year = year;
  }
  const trackNo = boundedInteger(value.trackNo, 999);
  if (trackNo) {
    candidate.trackNo = trackNo;
  }
  const discNo = boundedInteger(value.discNo, 99);
  if (discNo) {
    candidate.discNo = discNo;
  }
  const bpm = boundedPositiveNumber(value.bpm, 400);
  if (bpm) {
    candidate.bpm = bpm;
  }
  if (typeof value.confidence === 'number' && Number.isFinite(value.confidence)) {
    candidate.confidence = Math.max(0, Math.min(1, value.confidence));
  }

  return Object.keys(candidate).length > 0 ? candidate : null;
};

const normalizePluginMetadataProviderResult = (value: unknown): PluginMetadataProviderResult => {
  const input = isRecord(value) ? value : {};
  const candidates = Array.isArray(input.candidates)
    ? input.candidates
        .map(normalizePluginMetadataCandidate)
        .filter((item): item is PluginMetadataCandidate => Boolean(item))
        .slice(0, maxMetadataCandidatesPerProvider)
    : [];
  return { candidates };
};

const normalizePluginSourceSearchProvider = (value: unknown): PluginSourceSearchRequest['provider'] => {
  const input = isRecord(value) ? value : {};
  const pluginId = boundedText(input.pluginId, 120);
  const providerId = boundedText(input.providerId, 120);
  return pluginId && providerId ? { pluginId, providerId } : undefined;
};

const normalizePluginSourceSearchRequest = (value: unknown): PluginSourceSearchRequest => {
  const input = isRecord(value) ? value : {};
  const provider = normalizePluginSourceSearchProvider(input.provider);
  return {
    query: boundedText(input.query, 180) ?? '',
    page: normalizePositiveInteger(input.page, 1, 10_000),
    pageSize: normalizePositiveInteger(input.pageSize, 20, maxSourceTracksPerProvider),
    ...(provider ? { provider } : {}),
  };
};

const normalizePluginSourceTrack = (value: unknown): PluginSourceTrack | null => {
  if (!isRecord(value)) {
    return null;
  }

  const providerTrackId = boundedText(value.providerTrackId, sourceTrackTextFieldMaxLengths.providerTrackId ?? 180);
  const title = boundedText(value.title, sourceTrackTextFieldMaxLengths.title ?? 180);
  if (!providerTrackId || !title) {
    return null;
  }

  const track: PluginSourceTrack = { providerTrackId, title };
  for (const [field, maxLength] of Object.entries(sourceTrackTextFieldMaxLengths) as Array<[keyof PluginSourceTrack, number]>) {
    if (field === 'providerTrackId' || field === 'title') {
      continue;
    }
    const text = boundedText(value[field], maxLength);
    if (text) {
      track[field] = text as never;
    }
  }

  if (value.duration === null) {
    track.duration = null;
  } else {
    const duration = boundedPositiveNumber(value.duration, 24 * 60 * 60);
    if (duration) {
      track.duration = duration;
    }
  }
  if (typeof value.playable === 'boolean') {
    track.playable = value.playable;
  }

  return track;
};

const normalizePluginSourceSearchResult = (value: unknown): PluginSourceSearchProviderResult => {
  const input = isRecord(value) ? value : {};
  const tracks = Array.isArray(input.tracks)
    ? input.tracks
        .map(normalizePluginSourceTrack)
        .filter((item): item is PluginSourceTrack => Boolean(item))
        .slice(0, maxSourceTracksPerProvider)
    : [];
  const total = input.total === null ? null : boundedInteger(input.total, 1_000_000) ?? null;
  return {
    tracks,
    total,
    hasMore: typeof input.hasMore === 'boolean' ? input.hasMore : false,
  };
};

const normalizePluginHeaders = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 24)) {
    const key = boundedText(rawKey, 80);
    const headerValue = boundedText(rawValue, 500);
    if (key && headerValue && /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u.test(key)) {
      headers[key] = headerValue;
    }
  }
  return headers;
};

const normalizePluginPlaybackUrl = (value: unknown): string => {
  const url = boundedText(value, 2_000);
  if (!url) {
    throw new Error('plugin_source_playback_url_invalid');
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('plugin_source_playback_url_invalid');
    }
    return parsed.toString();
  } catch {
    throw new Error('plugin_source_playback_url_invalid');
  }
};

const isSafeHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

const normalizePluginSourcePlaybackRequest = (value: unknown): PluginSourcePlaybackRequest => {
  const input = isRecord(value) ? value : {};
  const pluginId = boundedText(input.pluginId, 120);
  const providerId = boundedText(input.providerId, 120);
  const providerTrackId = boundedText(input.providerTrackId, 180);
  if (!pluginId || !providerId || !providerTrackId) {
    throw new Error('plugin_source_playback_request_invalid');
  }
  return { pluginId, providerId, providerTrackId };
};

const normalizePluginSourcePlaybackResult = (
  value: unknown,
  request: PluginSourcePlaybackRequest,
): PluginSourcePlaybackResult => {
  const input = isRecord(value) ? value : {};
  const bitrate = boundedInteger(input.bitrate, 2_000_000) ?? null;
  const sampleRate = boundedInteger(input.sampleRate, 768_000) ?? null;
  const bitDepth = boundedInteger(input.bitDepth, 64) ?? null;
  return {
    pluginId: request.pluginId,
    providerId: request.providerId,
    providerTrackId: request.providerTrackId,
    url: normalizePluginPlaybackUrl(input.url),
    expiresAt: boundedText(input.expiresAt, 80) ?? null,
    mimeType: boundedText(input.mimeType, 120) ?? null,
    bitrate,
    sampleRate,
    bitDepth,
    codec: boundedText(input.codec, 80) ?? null,
    headers: normalizePluginHeaders(input.headers),
    requiresProxy: Boolean(input.requiresProxy),
    supportsRange: input.supportsRange !== false,
  };
};

const normalizePluginLyricsLookupRequest = (value: unknown): PluginLyricsLookupRequest => {
  const input = isRecord(value) ? value : {};
  const provider = normalizePluginMetadataLookupProvider(input.provider);
  return {
    track: normalizePluginMetadataLookupTrack(input.track),
    ...(provider ? { provider } : {}),
  };
};

const normalizePluginLyricsCandidate = (value: unknown): PluginLyricsCandidate | null => {
  if (!isRecord(value)) {
    return null;
  }
  const candidate: PluginLyricsCandidate = {};
  const title = boundedText(value.title, 180);
  const language = boundedText(value.language, 24);
  const lrc = boundedText(value.lrc, 80_000);
  const text = boundedText(value.text, 80_000);
  const source = boundedText(value.source, 80);
  const sourceUrl = boundedText(value.sourceUrl, 500);
  if (title) candidate.title = title;
  if (language) candidate.language = language;
  if (lrc) candidate.lrc = lrc;
  if (text) candidate.text = text;
  if (source) candidate.source = source;
  if (sourceUrl) candidate.sourceUrl = sourceUrl;
  if (typeof value.confidence === 'number' && Number.isFinite(value.confidence)) {
    candidate.confidence = Math.max(0, Math.min(1, value.confidence));
  }
  return candidate.lrc || candidate.text ? candidate : null;
};

const normalizePluginLyricsProviderResult = (value: unknown): PluginLyricsProviderResult => {
  const input = isRecord(value) ? value : {};
  const candidates = Array.isArray(input.candidates)
    ? input.candidates
        .map(normalizePluginLyricsCandidate)
        .filter((item): item is PluginLyricsCandidate => Boolean(item))
        .slice(0, maxLyricsCandidatesPerProvider)
    : [];
  return { candidates };
};

const normalizePluginCoverLookupRequest = (value: unknown): PluginCoverLookupRequest => {
  const input = isRecord(value) ? value : {};
  const provider = normalizePluginMetadataLookupProvider(input.provider);
  return {
    track: normalizePluginMetadataLookupTrack(input.track),
    ...(provider ? { provider } : {}),
  };
};

const normalizePluginCoverCandidate = (value: unknown): PluginCoverCandidate | null => {
  if (!isRecord(value)) {
    return null;
  }
  const imageUrl = boundedText(value.imageUrl, 1_000);
  if (!imageUrl || !isSafeHttpUrl(imageUrl)) {
    return null;
  }
  const candidate: PluginCoverCandidate = { imageUrl };
  const title = boundedText(value.title, 180);
  const source = boundedText(value.source, 80);
  const sourceUrl = boundedText(value.sourceUrl, 500);
  if (title) candidate.title = title;
  if (source) candidate.source = source;
  if (sourceUrl) candidate.sourceUrl = sourceUrl;
  const width = boundedInteger(value.width, 12_000);
  const height = boundedInteger(value.height, 12_000);
  if (width) candidate.width = width;
  if (height) candidate.height = height;
  if (typeof value.confidence === 'number' && Number.isFinite(value.confidence)) {
    candidate.confidence = Math.max(0, Math.min(1, value.confidence));
  }
  return candidate;
};

const normalizePluginCoverProviderResult = (value: unknown): PluginCoverProviderResult => {
  const input = isRecord(value) ? value : {};
  const candidates = Array.isArray(input.candidates)
    ? input.candidates
        .map(normalizePluginCoverCandidate)
        .filter((item): item is PluginCoverCandidate => Boolean(item))
        .slice(0, maxCoverCandidatesPerProvider)
    : [];
  return { candidates };
};

const normalizePluginSettingsPatch = (value: unknown, contributes: PluginManifestContributes | undefined): PluginSettingsPatch => {
  const input = isRecord(value) ? value : {};
  const settings = contributes?.settings ?? [];
  const output: PluginSettingsPatch = {};
  for (const setting of settings) {
    if (!Object.prototype.hasOwnProperty.call(input, setting.id)) {
      continue;
    }
    const rawValue = input[setting.id];
    if (rawValue === null) {
      output[setting.id] = null;
    } else if ((setting.type === 'string' || setting.type === 'secret') && typeof rawValue === 'string') {
      output[setting.id] = rawValue.slice(0, 2_000);
    } else if (setting.type === 'select' && typeof rawValue === 'string' && setting.options?.some((option) => option.value === rawValue)) {
      output[setting.id] = rawValue;
    } else if (setting.type === 'boolean' && typeof rawValue === 'boolean') {
      output[setting.id] = rawValue;
    } else if (setting.type === 'number' && typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      output[setting.id] = Math.min(setting.max ?? Number.MAX_SAFE_INTEGER, Math.max(setting.min ?? Number.MIN_SAFE_INTEGER, rawValue));
    }
  }
  return output;
};

const normalizePluginNetworkRequest = (value: unknown): PluginNetworkRequest => {
  const input = isRecord(value) ? value : { url: value };
  const url = boundedText(input.url, 2_000);
  if (!url || !isSafeHttpUrl(url)) {
    throw new Error('plugin_network_url_invalid');
  }
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET';
  if (!allowedPluginNetworkMethods.has(method)) {
    throw new Error('plugin_network_method_not_allowed');
  }
  const headers: Record<string, string> = {};
  if (isRecord(input.headers)) {
    for (const [header, headerValue] of Object.entries(input.headers)) {
      const normalizedHeader = header.toLowerCase();
      if (!allowedPluginRequestHeaders.has(normalizedHeader) || redactedHeaderNames.has(normalizedHeader)) {
        continue;
      }
      if (typeof headerValue === 'string') {
        headers[header] = headerValue.slice(0, 1_000);
      }
    }
  }
  return {
    url,
    method: method as PluginNetworkRequest['method'],
    headers,
    ...(typeof input.body === 'string' && method === 'POST' ? { body: input.body.slice(0, maxPluginNetworkRequestBytes) } : {}),
    timeoutMs: normalizePositiveInteger(input.timeoutMs, pluginNetworkTimeoutMs, pluginNetworkTimeoutMs),
  };
};

const timeout = <T>(promise: Promise<T>, timeoutMs: number, errorCode: string): Promise<T> =>
  new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export class PluginService {
  private records = new Map<string, PluginRecord>();
  private runtimes = new Map<string, RuntimeRecord>();
  private activity = new Map<string, PluginActivitySummary>();
  private logs: PluginLogEntry[] = [];
  private state: Required<PluginStateFile> = { plugins: {} };
  private autoStartScheduled = false;
  private audioStatusSubscribed = false;

  constructor(private readonly pluginDirectory = join(app.getPath('userData'), 'plugins')) {}

  list(): PluginListResult {
    this.scan();
    return {
      directory: this.pluginDirectory,
      plugins: [...this.records.values()].map((record) => this.toSummary(record)),
    };
  }

  scheduleAutoStart(): void {
    if (this.autoStartScheduled) {
      return;
    }

    this.autoStartScheduled = true;
    setTimeout(() => {
      try {
        this.scan();
        for (const record of this.records.values()) {
          if (record.enabled) {
            void this.startPlugin(record.manifest?.id ?? basename(record.directory)).catch((error) => {
              this.markError(record, error);
            });
          }
        }
      } catch (error) {
        this.log('host', 'error', `插件启动失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }, 1_200);
  }

  enable(request: PluginEnableRequest): PluginSummary {
    this.scan();
    const record = this.requireRecord(request.pluginId);
    if (!record.manifest) {
      throw new Error(record.error ?? 'plugin_manifest_invalid');
    }

    const requestedPermissions = record.manifest.permissions ?? [];
    const trustedPermissions = this.normalizeTrustedPermissions(request.trustedPermissions ?? [], requestedPermissions);
    if (requestedPermissions.some((permission) => !trustedPermissions.includes(permission))) {
      throw new Error('plugin_permission_confirmation_required');
    }

    this.state.plugins[record.manifest.id] = {
      enabled: true,
      trustedPermissions,
      disabledByHost: false,
      crashTimestamps: [],
      lastError: undefined,
      lastErrorAt: undefined,
    };
    this.writeState();
    record.enabled = true;
    record.trustedPermissions = trustedPermissions;
    record.disabledByHost = false;
    record.status = 'enabled';
    record.error = null;
    void this.startPlugin(record.manifest.id).catch((error) => this.markError(record, error));
    return this.toSummary(record);
  }

  disable(pluginId: string): PluginSummary {
    this.scan();
    const record = this.requireRecord(pluginId);
    const id = record.manifest?.id ?? pluginId;
    this.stopPlugin(id);
    this.state.plugins[id] = {
      ...this.state.plugins[id],
      enabled: false,
      disabledByHost: false,
    };
    this.writeState();
    record.enabled = false;
    record.disabledByHost = false;
    record.status = 'disabled';
    record.error = null;
    return this.toSummary(record);
  }

  async reload(pluginId: string): Promise<PluginSummary> {
    this.scan();
    const record = this.requireRecord(pluginId);
    const id = record.manifest?.id ?? pluginId;
    this.stopPlugin(id);
    this.records.delete(id);
    this.scan();
    const refreshed = this.requireRecord(id);
    if (refreshed.enabled && refreshed.manifest) {
      try {
        await this.startPlugin(refreshed.manifest.id);
      } catch (error) {
        this.markError(refreshed, error);
        throw error;
      }
    }
    return this.toSummary(refreshed);
  }

  async openDirectory(pluginId?: string): Promise<void> {
    this.scan();
    const target = pluginId ? this.requireRecord(pluginId).directory : this.pluginDirectory;
    mkdirSync(target, { recursive: true });
    await shell.openPath(target);
  }

  async exportPluginPackage(pluginId: string, destinationPath?: string): Promise<string | null> {
    this.scan();
    const record = this.requireRecord(pluginId);
    if (!record.manifest) {
      throw new Error(record.error ?? 'plugin_manifest_invalid');
    }

    const files = this.collectPluginPackageFiles(record);
    const payload: PluginPackage = {
      type: pluginPackageType,
      version: pluginPackageVersion,
      exportedAt: new Date().toISOString(),
      manifest: record.manifest,
      files,
    };
    assertJsonByteLimit(payload, maxPluginPackageBytes, 'plugin_package_too_large');

    const target = destinationPath ?? await this.chooseExportPath(record.manifest);
    if (!target) {
      return null;
    }

    writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    this.log(record.manifest.id, 'info', `plugin_package_exported:${target}`);
    return target;
  }

  async importPluginPackage(sourcePath?: string, options?: { allowOverwrite?: boolean }): Promise<PluginImportPackageResult | null> {
    const targetSource = sourcePath ?? await this.chooseImportPath();
    if (!targetSource) {
      return null;
    }

    const packageBytes = statSync(targetSource).size;
    if (packageBytes > maxPluginPackageBytes) {
      throw new Error('plugin_package_too_large');
    }

    const packageText = readFileSync(targetSource, 'utf8');
    const checksum = checksumText(packageText);
    const parsed = JSON.parse(packageText) as unknown;
    if (!isRecord(parsed) || parsed.type !== pluginPackageType || parsed.version !== pluginPackageVersion || !Array.isArray(parsed.files)) {
      throw new Error('plugin_package_invalid');
    }
    if (parsed.files.length > maxPluginPackageFiles) {
      throw new Error('plugin_package_file_limit_exceeded');
    }

    const manifest = normalizePluginManifest(parsed.manifest, isRecord(parsed.manifest) && typeof parsed.manifest.id === 'string' ? parsed.manifest.id : 'imported-plugin');
    const targetDirectory = join(this.pluginDirectory, manifest.id);
    let backedUpDirectory: string | null = null;
    if (existsSync(targetDirectory)) {
      if (options?.allowOverwrite !== true) {
        throw new Error('plugin_import_target_exists');
      }
      this.stopPlugin(manifest.id);
      backedUpDirectory = `${targetDirectory}.backup-${Date.now()}`;
      renameSync(targetDirectory, backedUpDirectory);
    }

    try {
      mkdirSync(targetDirectory, { recursive: true });
      writeFileSync(join(targetDirectory, manifestFileName), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

      let importedFileCount = 1;
      for (const file of parsed.files) {
        if (!isPluginPackageFile(file)) {
          continue;
        }
        const safePath = normalizePluginPackageFilePath(file.path);
        if (!safePath || safePath === manifestFileName || safePath.endsWith('.echo-plugin.json') || pluginPackageExcludedFiles.has(safePath)) {
          continue;
        }
        if (!exportablePluginFileExtensions.has(extname(safePath).toLowerCase())) {
          continue;
        }
        if (Buffer.byteLength(file.content, 'utf8') > maxPluginPackageFileBytes) {
          throw new Error('plugin_package_file_too_large');
        }
        writeFileSync(join(targetDirectory, safePath), file.content, 'utf8');
        importedFileCount += 1;
      }

      this.state.plugins[manifest.id] = {
        ...this.state.plugins[manifest.id],
        enabled: false,
        disabledByHost: false,
        packageInfo: {
          origin: targetSource,
          importedAt: new Date().toISOString(),
          packageVersion: pluginPackageVersion,
          checksum,
        },
      };
      this.writeState();
      this.scan();
      this.log(manifest.id, 'info', `plugin_package_imported:${checksum}`);
      return { pluginId: manifest.id, directory: targetDirectory, importedFileCount, checksum, backedUpDirectory };
    } catch (error) {
      rmSync(targetDirectory, { recursive: true, force: true });
      if (backedUpDirectory && existsSync(backedUpDirectory)) {
        renameSync(backedUpDirectory, targetDirectory);
      }
      throw error;
    }
  }

  createExample(kind: PluginCreateExampleKind): PluginCreateExampleResult {
    const template = exampleTemplates[kind];
    if (!template) {
      throw new Error('unknown_plugin_example_kind');
    }

    const directory = join(this.pluginDirectory, template.id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, manifestFileName), `${JSON.stringify(template.manifest, null, 2)}\n`, 'utf8');
    writeFileSync(join(directory, template.manifest.entry ?? 'plugin.js'), `${template.script}\n`, 'utf8');
    if (template.panel && template.manifest.panel) {
      writeFileSync(join(directory, template.manifest.panel), `${template.panel}\n`, 'utf8');
    }
    this.log(template.id, 'info', `已创建示例插件：${template.name}`);
    this.scan();
    return { pluginId: template.id, directory };
  }

  async runCommand(request: PluginRunCommandRequest): Promise<unknown> {
    this.scan();
    const record = this.requireRecord(request.pluginId);
    if (!record.enabled || !record.manifest) {
      throw new Error('plugin_not_enabled');
    }

    const runtime = await this.ensureRuntime(record.manifest.id);
    const command = runtime.commands.get(request.commandId);
    if (!command) {
      throw new Error('plugin_command_not_found');
    }

    this.bumpPluginActivity(record.manifest.id, (activity, now) => ({
      ...activity,
      lastCommandAt: now,
      commandRunCount: activity.commandRunCount + 1,
    }));
    this.log(record.manifest.id, 'info', `运行命令：${command.title}`);
    try {
      const args = Array.isArray(request.args) ? request.args : [];
      assertJsonByteLimit(args, maxPluginCommandArgsBytes, 'plugin_command_args_too_large');
      const result = await timeout(Promise.resolve(command.handler(...args)), commandTimeoutMs, 'plugin_command_timeout');
      assertJsonByteLimit(result, maxPluginCommandResultBytes, 'plugin_command_result_too_large');
      return jsonClone(result);
    } catch (error) {
      this.recordPluginErrorActivity(record.manifest.id);
      this.log(record.manifest.id, 'error', `命令失败：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async queryMetadata(request: PluginMetadataLookupRequest): Promise<PluginMetadataLookupResult> {
    this.scan();
    const providerFilter = normalizePluginMetadataLookupProvider(request?.provider);
    const safeRequest: PluginMetadataLookupRequest = {
      track: normalizePluginMetadataLookupTrack(request?.track),
      ...(providerFilter ? { provider: providerFilter } : {}),
    };
    assertJsonByteLimit(safeRequest, maxPluginMetadataRequestBytes, 'plugin_metadata_request_too_large');

    const providers: PluginMetadataProvider[] = [];
    const candidates: PluginMetadataLookupResult['candidates'] = [];

    for (const record of this.records.values()) {
      if (!record.enabled || !record.manifest) {
        continue;
      }
      if (safeRequest.provider && safeRequest.provider.pluginId !== record.manifest.id) {
        continue;
      }

      const runtime = await this.ensureRuntime(record.manifest.id);
      for (const provider of runtime.metadataProviders.values()) {
        if (safeRequest.provider && safeRequest.provider.providerId !== provider.id) {
          continue;
        }
        providers.push({
          id: provider.id,
          title: provider.title,
          description: provider.description,
          pluginId: record.manifest.id,
        });
        this.bumpProviderCall(record.manifest.id);
        try {
          const rawResult = await timeout(
            Promise.resolve(provider.handler(jsonClone(safeRequest))),
            metadataProviderTimeoutMs,
            'plugin_metadata_provider_timeout',
          );
          assertJsonByteLimit(rawResult, maxPluginMetadataResultBytes, 'plugin_metadata_result_too_large');
          const result = normalizePluginMetadataProviderResult(rawResult);
          for (const candidate of result.candidates ?? []) {
            candidates.push({
              ...candidate,
              pluginId: record.manifest.id,
              providerId: provider.id,
            });
          }
        } catch (error) {
          this.recordPluginErrorActivity(record.manifest.id);
          this.log(record.manifest.id, 'error', `元数据 provider 失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return { providers, candidates };
  }

  async querySources(request: PluginSourceSearchRequest): Promise<PluginSourceSearchResult> {
    this.scan();
    const safeRequest = normalizePluginSourceSearchRequest(request);
    assertJsonByteLimit(safeRequest, maxPluginSourceSearchRequestBytes, 'plugin_source_search_request_too_large');

    const providers: PluginSourceProvider[] = [];
    const tracks: PluginSourceSearchResult['tracks'] = [];

    for (const record of this.records.values()) {
      if (!record.enabled || !record.manifest) {
        continue;
      }
      if (safeRequest.provider && safeRequest.provider.pluginId !== record.manifest.id) {
        continue;
      }

      const runtime = await this.ensureRuntime(record.manifest.id);
      for (const provider of runtime.sourceProviders.values()) {
        if (safeRequest.provider && safeRequest.provider.providerId !== provider.id) {
          continue;
        }
        providers.push({
          id: provider.id,
          title: provider.title,
          description: provider.description,
          pluginId: record.manifest.id,
        });
        this.bumpProviderCall(record.manifest.id);
        try {
          const rawResult = await timeout(
            Promise.resolve(provider.search(jsonClone(safeRequest))),
            metadataProviderTimeoutMs,
            'plugin_source_provider_timeout',
          );
          assertJsonByteLimit(rawResult, maxPluginSourceSearchResultBytes, 'plugin_source_search_result_too_large');
          const result = normalizePluginSourceSearchResult(rawResult);
          for (const track of result.tracks ?? []) {
            tracks.push({
              ...track,
              pluginId: record.manifest.id,
              providerId: provider.id,
            });
          }
        } catch (error) {
          this.recordPluginErrorActivity(record.manifest.id);
          this.log(record.manifest.id, 'error', `音源 provider 失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return { providers, tracks };
  }

  async queryLyrics(request: PluginLyricsLookupRequest): Promise<PluginLyricsLookupResult> {
    this.scan();
    const safeRequest = normalizePluginLyricsLookupRequest(request);
    assertJsonByteLimit(safeRequest, maxPluginLyricsRequestBytes, 'plugin_lyrics_request_too_large');

    const providers: PluginLyricsProvider[] = [];
    const candidates: PluginLyricsLookupResult['candidates'] = [];

    for (const record of this.records.values()) {
      if (!record.enabled || !record.manifest) {
        continue;
      }
      if (safeRequest.provider && safeRequest.provider.pluginId !== record.manifest.id) {
        continue;
      }
      const runtime = await this.ensureRuntime(record.manifest.id);
      for (const provider of runtime.lyricsProviders.values()) {
        if (safeRequest.provider && safeRequest.provider.providerId !== provider.id) {
          continue;
        }
        providers.push({ id: provider.id, title: provider.title, description: provider.description, pluginId: record.manifest.id });
        this.bumpProviderCall(record.manifest.id);
        try {
          const rawResult = await timeout(Promise.resolve(provider.handler(jsonClone(safeRequest))), metadataProviderTimeoutMs, 'plugin_lyrics_provider_timeout');
          assertJsonByteLimit(rawResult, maxPluginLyricsResultBytes, 'plugin_lyrics_result_too_large');
          const result = normalizePluginLyricsProviderResult(rawResult);
          for (const candidate of result.candidates ?? []) {
            candidates.push({ ...candidate, pluginId: record.manifest.id, providerId: provider.id });
          }
        } catch (error) {
          this.recordPluginErrorActivity(record.manifest.id);
          this.log(record.manifest.id, 'error', `lyrics_provider_failed:${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return { providers, candidates };
  }

  async queryCovers(request: PluginCoverLookupRequest): Promise<PluginCoverLookupResult> {
    this.scan();
    const safeRequest = normalizePluginCoverLookupRequest(request);
    assertJsonByteLimit(safeRequest, maxPluginCoverRequestBytes, 'plugin_cover_request_too_large');

    const providers: PluginCoverProvider[] = [];
    const candidates: PluginCoverLookupResult['candidates'] = [];

    for (const record of this.records.values()) {
      if (!record.enabled || !record.manifest) {
        continue;
      }
      if (safeRequest.provider && safeRequest.provider.pluginId !== record.manifest.id) {
        continue;
      }
      const runtime = await this.ensureRuntime(record.manifest.id);
      for (const provider of runtime.coverProviders.values()) {
        if (safeRequest.provider && safeRequest.provider.providerId !== provider.id) {
          continue;
        }
        providers.push({ id: provider.id, title: provider.title, description: provider.description, pluginId: record.manifest.id });
        this.bumpProviderCall(record.manifest.id);
        try {
          const rawResult = await timeout(Promise.resolve(provider.handler(jsonClone(safeRequest))), metadataProviderTimeoutMs, 'plugin_cover_provider_timeout');
          assertJsonByteLimit(rawResult, maxPluginCoverResultBytes, 'plugin_cover_result_too_large');
          const result = normalizePluginCoverProviderResult(rawResult);
          for (const candidate of result.candidates ?? []) {
            candidates.push({ ...candidate, pluginId: record.manifest.id, providerId: provider.id });
          }
        } catch (error) {
          this.recordPluginErrorActivity(record.manifest.id);
          this.log(record.manifest.id, 'error', `cover_provider_failed:${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return { providers, candidates };
  }

  async resolveSourcePlayback(request: PluginSourcePlaybackRequest): Promise<PluginSourcePlaybackResult> {
    this.scan();
    const safeRequest = normalizePluginSourcePlaybackRequest(request);
    assertJsonByteLimit(safeRequest, maxPluginSourcePlaybackRequestBytes, 'plugin_source_playback_request_too_large');
    const record = this.requireRecord(safeRequest.pluginId);
    if (!record.enabled || !record.manifest) {
      throw new Error('plugin_not_enabled');
    }

    const runtime = await this.ensureRuntime(record.manifest.id);
    const provider = runtime.sourceProviders.get(safeRequest.providerId);
    if (!provider?.resolvePlayback) {
      throw new Error('plugin_source_provider_not_playable');
    }

    try {
      const rawResult = await timeout(
        Promise.resolve(provider.resolvePlayback(jsonClone(safeRequest))),
        metadataProviderTimeoutMs,
        'plugin_source_provider_timeout',
      );
      assertJsonByteLimit(rawResult, maxPluginSourcePlaybackResultBytes, 'plugin_source_playback_result_too_large');
      return normalizePluginSourcePlaybackResult(rawResult, safeRequest);
    } catch (error) {
      this.recordPluginErrorActivity(record.manifest.id);
      this.log(record.manifest.id, 'error', `音源解析失败：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  getPluginSettings(pluginId: string): PluginSettingsResult {
    this.scan();
    const record = this.requireRecord(pluginId);
    if (!record.manifest) {
      throw new Error(record.error ?? 'plugin_manifest_invalid');
    }
    return {
      pluginId: record.manifest.id,
      values: this.getPluginSettingsValues(record),
    };
  }

  updatePluginSettings(pluginId: string, patch: unknown): PluginSettingsResult {
    this.scan();
    const record = this.requireRecord(pluginId);
    if (!record.manifest) {
      throw new Error(record.error ?? 'plugin_manifest_invalid');
    }
    const safePatch = normalizePluginSettingsPatch(patch, record.manifest.contributes);
    assertJsonByteLimit(safePatch, maxPluginSettingValueBytes, 'plugin_setting_value_too_large');
    const next = {
      ...this.getPluginSettingsValues(record),
      ...safePatch,
    };
    assertJsonByteLimit(next, maxPluginSettingsBytes, 'plugin_settings_quota_exceeded');
    this.writePluginSettings(record, next);
    this.bumpPluginActivity(record.manifest.id, (activity, now) => ({
      ...activity,
      lastSettingsWriteAt: now,
      settingsWriteCount: activity.settingsWriteCount + 1,
    }));
    return { pluginId: record.manifest.id, values: next };
  }

  getLogs(pluginId?: string): PluginLogEntry[] {
    return this.logs.filter((entry) => !pluginId || entry.pluginId === pluginId);
  }

  emitLibraryChanged(payload: unknown): void {
    this.dispatchEvent('library:changed', payload);
  }

  private scan(): void {
    mkdirSync(this.pluginDirectory, { recursive: true });
    this.state = this.readState();
    const seen = new Set<string>();

    for (const item of readdirSync(this.pluginDirectory, { withFileTypes: true })) {
      if (!item.isDirectory()) {
        continue;
      }

      const directory = join(this.pluginDirectory, item.name);
      const manifestPath = join(directory, manifestFileName);
      let manifest: PluginManifest | null = null;
      let error: string | null = null;
      try {
        if (!existsSync(manifestPath)) {
          throw new Error(`missing ${manifestFileName}`);
        }
        manifest = normalizePluginManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), item.name);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }

      const id = manifest?.id ?? item.name;
      seen.add(id);
      const persisted = this.state.plugins[id] ?? {};
      const current = this.records.get(id);
      const disabledByHost = persisted.disabledByHost === true;
      const enabled = persisted.enabled === true && !disabledByHost;
      this.records.set(id, {
        manifest,
        directory,
        enabled,
        trustedPermissions: this.normalizeTrustedPermissions(persisted.trustedPermissions ?? [], manifest?.permissions ?? []),
        status: enabled ? current?.status ?? 'enabled' : 'disabled',
        error: error ?? (disabledByHost ? persisted.lastError ?? current?.error ?? null : current?.error ?? null),
        disabledByHost,
      });
    }

    for (const id of [...this.records.keys()]) {
      if (!seen.has(id)) {
        this.stopPlugin(id);
        this.records.delete(id);
      }
    }
  }

  private async ensureRuntime(pluginId: string): Promise<RuntimeRecord> {
    const existing = this.runtimes.get(pluginId);
    if (existing) {
      return existing;
    }
    const record = this.requireRecord(pluginId);
    await this.startPlugin(pluginId);
    return this.runtimes.get(pluginId) ?? this.createEmptyRuntime(record);
  }

  private async startPlugin(pluginId: string): Promise<void> {
    this.scan();
    const record = this.requireRecord(pluginId);
    if (!record.manifest) {
      throw new Error(record.error ?? 'plugin_manifest_invalid');
    }
    if (!record.enabled) {
      return;
    }

    this.stopPlugin(record.manifest.id);
    const runtime = this.createEmptyRuntime(record);
    this.runtimes.set(record.manifest.id, runtime);
    this.subscribeAudioStatus();

    const entry = record.manifest.entry ? join(record.directory, record.manifest.entry) : null;
    if (entry && existsSync(entry)) {
      const script = readFileSync(entry, 'utf8');
      const context = vm.createContext({
        console: {
          log: (...args: unknown[]) => this.log(record.manifest!.id, 'info', args.map(String).join(' ')),
          warn: (...args: unknown[]) => this.log(record.manifest!.id, 'warn', args.map(String).join(' ')),
          error: (...args: unknown[]) => this.log(record.manifest!.id, 'error', args.map(String).join(' ')),
        },
        echo: this.createSandboxApi(record, runtime),
        setTimeout,
        clearTimeout,
      });
      vm.runInContext(script, context, { timeout: 1_000, filename: entry });
    }

    record.status = 'running';
    record.error = null;
    this.bumpPluginActivity(record.manifest.id, (activity, now) => ({
      ...activity,
      lastStartedAt: now,
    }));
    this.log(record.manifest.id, 'info', '插件已启动。');
  }

  private stopPlugin(pluginId: string): void {
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) {
      return;
    }

    if (runtime.statusTimer) {
      clearTimeout(runtime.statusTimer);
    }
    this.runtimes.delete(pluginId);
    this.bumpPluginActivity(pluginId, (activity, now) => ({
      ...activity,
      lastStoppedAt: now,
    }));
  }

  private createEmptyRuntime(record: PluginRecord): RuntimeRecord {
    if (!record.manifest) {
      throw new Error('plugin_manifest_invalid');
    }
    return {
      manifest: record.manifest,
      directory: record.directory,
      commands: new Map(),
      metadataProviders: new Map(),
      sourceProviders: new Map(),
      lyricsProviders: new Map(),
      coverProviders: new Map(),
      eventHandlers: new Map(),
      statusTimer: null,
      pendingStatus: null,
    };
  }

  private createSandboxApi(record: PluginRecord, runtime: RuntimeRecord): unknown {
    const requirePermission = (permission: PluginPermission): void => {
      if (!record.trustedPermissions.includes(permission)) {
        throw new Error(`plugin_permission_denied:${permission}`);
      }
    };

    return Object.freeze({
      events: Object.freeze({
        on: (eventName: string, handler: unknown): (() => void) => {
          if (typeof eventName !== 'string' || typeof handler !== 'function') {
            throw new Error('plugin_event_handler_invalid');
          }
          if (!pluginEventSet.has(eventName as PluginEventName)) {
            throw new Error(`plugin_event_not_supported:${eventName}`);
          }
          requirePermission(pluginEventPermissions[eventName as PluginEventName]);
          const handlers = runtime.eventHandlers.get(eventName) ?? new Set<(payload: unknown) => unknown>();
          if (handlers.size >= maxEventHandlersPerPlugin) {
            throw new Error('plugin_event_handler_limit');
          }
          handlers.add(handler as (payload: unknown) => unknown);
          runtime.eventHandlers.set(eventName, handlers);
          return () => handlers.delete(handler as (payload: unknown) => unknown);
        },
      }),
      commands: Object.freeze({
        register: (commandId: string, options: { title?: unknown; description?: unknown } | ((...args: unknown[]) => unknown), handler?: (...args: unknown[]) => unknown): void => {
          const actualHandler = typeof options === 'function' ? options : handler;
          if (typeof commandId !== 'string' || !commandId.trim() || typeof actualHandler !== 'function') {
            throw new Error('plugin_command_invalid');
          }
          runtime.commands.set(commandId.trim(), {
            id: commandId.trim(),
            title: isRecord(options) && typeof options.title === 'string' && options.title.trim() ? options.title.trim() : commandId.trim(),
            description: isRecord(options) && typeof options.description === 'string' && options.description.trim() ? options.description.trim() : undefined,
            handler: actualHandler,
          });
        },
      }),
      metadata: Object.freeze({
        registerProvider: (providerId: string, options: { title?: unknown; description?: unknown } | ((request: PluginMetadataLookupRequest) => unknown), handler?: (request: PluginMetadataLookupRequest) => unknown): void => {
          requirePermission('library:read');
          const actualHandler = typeof options === 'function' ? options : handler;
          if (typeof providerId !== 'string' || !providerId.trim() || typeof actualHandler !== 'function') {
            throw new Error('plugin_metadata_provider_invalid');
          }
          if (runtime.metadataProviders.size >= maxMetadataProvidersPerPlugin) {
            throw new Error('plugin_metadata_provider_limit');
          }
          const id = providerId.trim();
          runtime.metadataProviders.set(id, {
            id,
            title: isRecord(options) && typeof options.title === 'string' && options.title.trim() ? options.title.trim() : id,
            description: isRecord(options) && typeof options.description === 'string' && options.description.trim() ? options.description.trim() : undefined,
            handler: actualHandler,
          });
        },
      }),
      lyrics: Object.freeze({
        registerProvider: (providerId: string, options: { title?: unknown; description?: unknown } | ((request: PluginLyricsLookupRequest) => unknown), handler?: (request: PluginLyricsLookupRequest) => unknown): void => {
          requirePermission('library:read');
          const actualHandler = typeof options === 'function' ? options : handler;
          if (typeof providerId !== 'string' || !providerId.trim() || typeof actualHandler !== 'function') {
            throw new Error('plugin_lyrics_provider_invalid');
          }
          if (runtime.lyricsProviders.size >= maxLyricsProvidersPerPlugin) {
            throw new Error('plugin_lyrics_provider_limit');
          }
          const id = providerId.trim();
          runtime.lyricsProviders.set(id, {
            id,
            title: isRecord(options) && typeof options.title === 'string' && options.title.trim() ? options.title.trim() : id,
            description: isRecord(options) && typeof options.description === 'string' && options.description.trim() ? options.description.trim() : undefined,
            handler: actualHandler,
          });
        },
      }),
      covers: Object.freeze({
        registerProvider: (providerId: string, options: { title?: unknown; description?: unknown } | ((request: PluginCoverLookupRequest) => unknown), handler?: (request: PluginCoverLookupRequest) => unknown): void => {
          requirePermission('library:read');
          const actualHandler = typeof options === 'function' ? options : handler;
          if (typeof providerId !== 'string' || !providerId.trim() || typeof actualHandler !== 'function') {
            throw new Error('plugin_cover_provider_invalid');
          }
          if (runtime.coverProviders.size >= maxCoverProvidersPerPlugin) {
            throw new Error('plugin_cover_provider_limit');
          }
          const id = providerId.trim();
          runtime.coverProviders.set(id, {
            id,
            title: isRecord(options) && typeof options.title === 'string' && options.title.trim() ? options.title.trim() : id,
            description: isRecord(options) && typeof options.description === 'string' && options.description.trim() ? options.description.trim() : undefined,
            handler: actualHandler,
          });
        },
      }),
      sources: Object.freeze({
        registerProvider: (
          providerId: string,
          options: { title?: unknown; description?: unknown } | {
            search?: unknown;
            resolvePlayback?: unknown;
          },
          handlers?: {
            search?: unknown;
            resolvePlayback?: unknown;
          },
        ): void => {
          requirePermission('sources:provide');
          const optionsRecord: Record<string, unknown> = isRecord(options) ? options : {};
          const actualHandlers = handlers ?? ('search' in optionsRecord || 'resolvePlayback' in optionsRecord ? optionsRecord : {});
          const search = isRecord(actualHandlers) ? actualHandlers.search : undefined;
          const resolvePlayback = isRecord(actualHandlers) ? actualHandlers.resolvePlayback : undefined;
          if (typeof providerId !== 'string' || !providerId.trim() || typeof search !== 'function') {
            throw new Error('plugin_source_provider_invalid');
          }
          if (runtime.sourceProviders.size >= maxSourceProvidersPerPlugin) {
            throw new Error('plugin_source_provider_limit');
          }
          const id = providerId.trim();
          runtime.sourceProviders.set(id, {
            id,
            title: typeof optionsRecord.title === 'string' && optionsRecord.title.trim() ? optionsRecord.title.trim() : id,
            description: typeof optionsRecord.description === 'string' && optionsRecord.description.trim() ? optionsRecord.description.trim() : undefined,
            search: search as (request: PluginSourceSearchRequest) => unknown,
            resolvePlayback: typeof resolvePlayback === 'function' ? resolvePlayback as (request: PluginSourcePlaybackRequest) => unknown : undefined,
          });
        },
      }),
      playback: Object.freeze({
        getStatus: async () => {
          requirePermission('playback:read');
          return jsonClone(getAudioSession().getStatus());
        },
        play: async () => {
          requirePermission('playback:control');
          return jsonClone(await getAudioSession().play());
        },
        pause: async () => {
          requirePermission('playback:control');
          return jsonClone(await getAudioSession().pause());
        },
        stop: async () => {
          requirePermission('playback:control');
          return jsonClone(getAudioSession().stop());
        },
        seek: async (positionSeconds: unknown) => {
          requirePermission('playback:control');
          const safePosition = typeof positionSeconds === 'number' && Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0;
          return jsonClone(await getAudioSession().seek(safePosition));
        },
      }),
      library: Object.freeze({
        getSummary: async () => {
          requirePermission('library:read');
          return jsonClone(getLibraryService().getSummary());
        },
        getTracks: async (query: unknown) => {
          requirePermission('library:read');
          const request = normalizePluginLibraryTracksQuery(query);
          return jsonClone(toPluginLibraryTrackPage(getLibraryService().getTracks(request.query), request.fields));
        },
      }),
      settings: Object.freeze({
        get: async (key?: unknown) => {
          if (record.manifest?.apiVersion === 1) {
            requirePermission('settings:read');
            return jsonClone(getAppSettings());
          }
          const values = this.getPluginSettingsValues(record);
          return typeof key === 'string' && key.trim() ? jsonClone(values[key.trim()]) : jsonClone(values);
        },
        getAll: async () => {
          if (record.manifest?.apiVersion === 1) {
            requirePermission('settings:read');
            return jsonClone(getAppSettings());
          }
          return jsonClone(this.getPluginSettingsValues(record));
        },
        set: async (keyOrPatch: unknown, value?: unknown) => {
          if (record.manifest?.apiVersion === 1) {
            requirePermission('settings:write');
            const safePatch = isRecord(keyOrPatch) ? jsonClone(keyOrPatch) : {};
            assertJsonByteLimit(safePatch, maxPluginSettingsPatchBytes, 'plugin_settings_patch_too_large');
            const result = setAppSettings(safePatch);
            if (record.manifest) {
              this.bumpPluginActivity(record.manifest.id, (activity, now) => ({
                ...activity,
                lastSettingsWriteAt: now,
                settingsWriteCount: activity.settingsWriteCount + 1,
              }));
            }
            return jsonClone(result);
          }
          const patch = typeof keyOrPatch === 'string' ? { [keyOrPatch]: value } : keyOrPatch;
          return jsonClone(this.updatePluginSettings(record.manifest?.id ?? '', patch).values);
        },
      }),
      net: Object.freeze({
        fetchJson: async (request: unknown) => this.fetchPluginNetwork(record, request, 'json'),
        fetchText: async (request: unknown) => this.fetchPluginNetwork(record, request, 'text'),
      }),
      storage: Object.freeze({
        get: async (key: unknown) => this.readPluginStorageValue(record, String(key ?? '')),
        set: async (key: unknown, value: unknown) => this.writePluginStorageValue(record, String(key ?? ''), value),
      }),
      ui: Object.freeze({
        notify: async (message: unknown) => {
          this.log(record.manifest?.id ?? 'unknown', 'info', String(message ?? ''));
        },
      }),
    });
  }

  private readPluginStorageValue(record: PluginRecord, key: string): unknown {
    const storage = this.readPluginStorage(record.directory);
    return jsonClone(storage[key]);
  }

  private writePluginStorageValue(record: PluginRecord, key: string, value: unknown): void {
    const safeKey = key.trim().slice(0, maxPluginStorageKeyLength);
    if (!safeKey) {
      throw new Error('plugin_storage_key_invalid');
    }
    const safeValue = jsonClone(value);
    assertJsonByteLimit(safeValue, maxPluginStorageValueBytes, 'plugin_storage_value_too_large');
    const storage = this.readPluginStorage(record.directory);
    storage[safeKey] = safeValue;
    assertJsonByteLimit(storage, maxPluginStorageBytes, 'plugin_storage_quota_exceeded');
    writeFileSync(join(record.directory, storageFileName), `${JSON.stringify(storage, null, 2)}\n`, 'utf8');
    if (record.manifest) {
      this.bumpPluginActivity(record.manifest.id, (activity, now) => ({
        ...activity,
        lastStorageWriteAt: now,
        storageWriteCount: activity.storageWriteCount + 1,
      }));
    }
  }

  private readPluginStorage(directory: string): Record<string, unknown> {
    const path = join(directory, storageFileName);
    if (!existsSync(path)) {
      return {};
    }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private getPluginSettingsValues(record: PluginRecord): PluginSettingsPatch {
    if (!record.manifest) {
      return {};
    }
    const settings = record.manifest.contributes?.settings ?? [];
    const stored = this.readPluginSettings(record.directory);
    const values: PluginSettingsPatch = {};
    for (const setting of settings) {
      const storedValue = stored[setting.id];
      if (storedValue !== undefined) {
        values[setting.id] = storedValue as PluginSettingsPatch[string];
      } else if (setting.defaultValue !== undefined) {
        values[setting.id] = setting.defaultValue;
      }
    }
    return values;
  }

  private readPluginSettings(directory: string): PluginSettingsPatch {
    const path = join(directory, pluginSettingsFileName);
    if (!existsSync(path)) {
      return {};
    }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      return isRecord(parsed) ? parsed as PluginSettingsPatch : {};
    } catch {
      return {};
    }
  }

  private writePluginSettings(record: PluginRecord, values: PluginSettingsPatch): void {
    writeFileSync(join(record.directory, pluginSettingsFileName), `${JSON.stringify(values, null, 2)}\n`, 'utf8');
  }

  private async fetchPluginNetwork(record: PluginRecord, request: unknown, responseType: 'json' | 'text'): Promise<unknown> {
    if (!record.manifest) {
      throw new Error('plugin_manifest_invalid');
    }
    if (record.manifest.apiVersion < 2) {
      throw new Error('plugin_network_requires_api_v2');
    }
    if (!record.trustedPermissions.includes('network')) {
      throw new Error('plugin_permission_denied:network');
    }
    const safeRequest = normalizePluginNetworkRequest(request);
    assertJsonByteLimit(safeRequest, maxPluginNetworkRequestBytes, 'plugin_network_request_too_large');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), safeRequest.timeoutMs ?? pluginNetworkTimeoutMs);
    try {
      const response = await fetchWithNetworkProxy(safeRequest.url, {
        method: safeRequest.method ?? 'GET',
        headers: safeRequest.headers,
        body: safeRequest.body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > maxPluginNetworkResponseBytes) {
        throw new Error('plugin_network_response_too_large');
      }
      this.bumpPluginActivity(record.manifest.id, (activity, now) => ({
        ...activity,
        lastNetworkAt: now,
        networkCallCount: activity.networkCallCount + 1,
      }));
      this.log(record.manifest.id, 'info', `plugin_network:${safeRequest.method ?? 'GET'}:${new URL(safeRequest.url).origin}:${response.status}`);
      if (!response.ok) {
        throw new Error(`plugin_network_http_${response.status}`);
      }
      return responseType === 'json' ? JSON.parse(text) : text;
    } catch (error) {
      this.recordPluginErrorActivity(record.manifest.id);
      this.log(record.manifest.id, 'error', `plugin_network_failed:${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private subscribeAudioStatus(): void {
    if (this.audioStatusSubscribed) {
      return;
    }
    this.audioStatusSubscribed = true;
    getAudioSession().on('status', (status: AudioStatus) => {
      for (const runtime of this.runtimes.values()) {
        if (!runtime.eventHandlers.has('playback:status')) {
          continue;
        }
        runtime.pendingStatus = status;
        if (runtime.statusTimer) {
          continue;
        }
        runtime.statusTimer = setTimeout(() => {
          runtime.statusTimer = null;
          const pending = runtime.pendingStatus;
          runtime.pendingStatus = null;
          if (pending) {
            this.dispatchEventToRuntime(runtime, 'playback:status', pending);
          }
        }, playbackStatusThrottleMs);
      }
    });
  }

  private dispatchEvent(eventName: string, payload: unknown): void {
    for (const runtime of this.runtimes.values()) {
      this.dispatchEventToRuntime(runtime, eventName, payload);
    }
  }

  private dispatchEventToRuntime(runtime: RuntimeRecord, eventName: string, payload: unknown): void {
    const handlers = runtime.eventHandlers.get(eventName);
    if (!handlers || handlers.size === 0) {
      return;
    }

    this.bumpPluginActivity(runtime.manifest.id, (activity, now) => ({
      ...activity,
      lastEventAt: now,
      eventDispatchCount: activity.eventDispatchCount + 1,
    }));
    for (const handler of handlers) {
      try {
        void timeout(Promise.resolve(handler(jsonClone(payload))), eventHandlerTimeoutMs, 'plugin_event_handler_timeout').catch((error) => {
          this.recordPluginErrorActivity(runtime.manifest.id);
          this.log(runtime.manifest.id, 'error', `事件处理失败：${error instanceof Error ? error.message : String(error)}`);
        });
      } catch (error) {
        this.recordPluginErrorActivity(runtime.manifest.id);
        this.log(runtime.manifest.id, 'error', `事件处理失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private toSummary(record: PluginRecord): PluginSummary {
    const manifest = record.manifest;
    const runtime = manifest ? this.runtimes.get(manifest.id) : null;
    const contributes: PluginManifestContributes = manifest?.contributes ?? {};
    const commands: PluginCommand[] = [
      ...(contributes.commands ?? []).map((command) => ({ ...command, pluginId: manifest?.id ?? basename(record.directory) })),
      ...(runtime ? [...runtime.commands.values()].map((command) => ({
        id: command.id,
        title: command.title,
        description: command.description,
        pluginId: manifest?.id ?? basename(record.directory),
      })) : []),
    ];
    const metadataProviders: PluginMetadataProvider[] = [
      ...(contributes.metadataProviders ?? []).map((provider) => ({ ...provider, pluginId: manifest?.id ?? basename(record.directory) })),
      ...(runtime ? [...runtime.metadataProviders.values()].map((provider) => ({
        id: provider.id,
        title: provider.title,
        description: provider.description,
        pluginId: manifest?.id ?? basename(record.directory),
      })) : []),
    ];
    const sourceProviders: PluginSourceProvider[] = [
      ...(contributes.sourceProviders ?? []).map((provider) => ({ ...provider, pluginId: manifest?.id ?? basename(record.directory) })),
      ...(runtime ? [...runtime.sourceProviders.values()].map((provider) => ({
        id: provider.id,
        title: provider.title,
        description: provider.description,
        pluginId: manifest?.id ?? basename(record.directory),
      })) : []),
    ];
    const lyricsProviders: PluginLyricsProvider[] = [
      ...(contributes.lyricsProviders ?? []).map((provider) => ({ ...provider, pluginId: manifest?.id ?? basename(record.directory) })),
      ...(runtime ? [...runtime.lyricsProviders.values()].map((provider) => ({
        id: provider.id,
        title: provider.title,
        description: provider.description,
        pluginId: manifest?.id ?? basename(record.directory),
      })) : []),
    ];
    const coverProviders: PluginCoverProvider[] = [
      ...(contributes.coverProviders ?? []).map((provider) => ({ ...provider, pluginId: manifest?.id ?? basename(record.directory) })),
      ...(runtime ? [...runtime.coverProviders.values()].map((provider) => ({
        id: provider.id,
        title: provider.title,
        description: provider.description,
        pluginId: manifest?.id ?? basename(record.directory),
      })) : []),
    ];
    const activity = this.getPluginActivity(manifest?.id ?? basename(record.directory));

    return {
      id: manifest?.id ?? basename(record.directory),
      name: manifest?.name ?? basename(record.directory),
      version: manifest?.version ?? '0.0.0',
      apiVersion: manifest?.apiVersion ?? 0,
      compatibility: this.createCompatibilitySummary(record),
      packageInfo: this.createPackageInfo(record),
      health: this.createHealthSummary(record, activity),
      directory: record.directory,
      entry: manifest?.entry ?? null,
      panel: manifest?.panel ? resolve(record.directory, manifest.panel) : null,
      permissions: manifest?.permissions ?? [],
      trustedPermissions: record.trustedPermissions,
      enabled: record.enabled,
      status: record.disabledByHost ? 'disabled' : record.error ? 'error' : record.enabled ? record.status : 'disabled',
      error: record.error,
      disabledByHost: record.disabledByHost,
      activity,
      security: this.createSecuritySummary(record, commands),
      contributes,
      commands: commands.filter((command, index, list) => list.findIndex((item) => item.id === command.id) === index),
      metadataProviders: metadataProviders.filter((provider, index, list) => list.findIndex((item) => item.id === provider.id && item.pluginId === provider.pluginId) === index),
      sourceProviders: sourceProviders.filter((provider, index, list) => list.findIndex((item) => item.id === provider.id && item.pluginId === provider.pluginId) === index),
      lyricsProviders: lyricsProviders.filter((provider, index, list) => list.findIndex((item) => item.id === provider.id && item.pluginId === provider.pluginId) === index),
      coverProviders: coverProviders.filter((provider, index, list) => list.findIndex((item) => item.id === provider.id && item.pluginId === provider.pluginId) === index),
      settingsValues: record.manifest ? this.getPluginSettingsValues(record) : {},
    };
  }

  private createSecuritySummary(record: PluginRecord, commands: PluginCommand[]): PluginSecuritySummary {
    const requestedPermissions = record.manifest?.permissions ?? [];
    const manifestProviderCount = record.manifest?.contributes?.metadataProviders?.length ?? 0;
    const runtimeProviderCount = record.manifest ? this.runtimes.get(record.manifest.id)?.metadataProviders.size ?? 0 : 0;
    const manifestSourceProviderCount = record.manifest?.contributes?.sourceProviders?.length ?? 0;
    const runtimeSourceProviderCount = record.manifest ? this.runtimes.get(record.manifest.id)?.sourceProviders.size ?? 0 : 0;
    const manifestLyricsProviderCount = record.manifest?.contributes?.lyricsProviders?.length ?? 0;
    const runtimeLyricsProviderCount = record.manifest ? this.runtimes.get(record.manifest.id)?.lyricsProviders.size ?? 0 : 0;
    const manifestCoverProviderCount = record.manifest?.contributes?.coverProviders?.length ?? 0;
    const runtimeCoverProviderCount = record.manifest ? this.runtimes.get(record.manifest.id)?.coverProviders.size ?? 0 : 0;
    return {
      requestedPermissionCount: requestedPermissions.length,
      trustedPermissionCount: record.trustedPermissions.length,
      untrustedPermissions: requestedPermissions.filter((permission) => !record.trustedPermissions.includes(permission)),
      highRiskPermissions: requestedPermissions.filter((permission) => pluginPermissionDescriptors[permission]?.risk === 'high'),
      reservedPermissions: requestedPermissions.filter((permission) => pluginPermissionDescriptors[permission]?.availability === 'reserved'),
      limitedPermissions: requestedPermissions.filter((permission) => pluginPermissionDescriptors[permission]?.availability === 'limited'),
      hasEntry: Boolean(record.manifest?.entry),
      hasPanel: Boolean(record.manifest?.panel),
      sandboxedPanel: Boolean(record.manifest?.panel),
      commandCount: commands.filter((command, index, list) => list.findIndex((item) => item.id === command.id) === index).length,
      metadataProviderCount: Math.max(manifestProviderCount, runtimeProviderCount),
      sourceProviderCount: Math.max(manifestSourceProviderCount, runtimeSourceProviderCount),
      lyricsProviderCount: Math.max(manifestLyricsProviderCount, runtimeLyricsProviderCount),
      coverProviderCount: Math.max(manifestCoverProviderCount, runtimeCoverProviderCount),
      themePresetCount: record.manifest?.contributes?.themePresets?.length ?? 0,
      settingCount: record.manifest?.contributes?.settings?.length ?? 0,
      networkEnabled: requestedPermissions.includes('network') && record.trustedPermissions.includes('network'),
    };
  }

  private getPluginActivity(pluginId: string): PluginActivitySummary {
    const activity = this.activity.get(pluginId) ?? createEmptyPluginActivity();
    this.activity.set(pluginId, activity);
    return { ...activity };
  }

  private bumpPluginActivity(pluginId: string, updater: (activity: PluginActivitySummary, now: string) => PluginActivitySummary): void {
    const current = this.activity.get(pluginId) ?? createEmptyPluginActivity();
    this.activity.set(pluginId, updater(current, new Date().toISOString()));
  }

  private createCompatibilitySummary(record: PluginRecord): PluginCompatibilitySummary {
    const manifest = record.manifest;
    if (!manifest) {
      return {
        isCompatible: false,
        reason: record.error ?? 'plugin_manifest_invalid',
        minEchoVersion: null,
      };
    }
    return {
      isCompatible: !record.error,
      reason: record.error,
      minEchoVersion: manifest.minEchoVersion ?? null,
    };
  }

  private createPackageInfo(record: PluginRecord): PluginPackageInfo {
    if (!record.manifest) {
      return { origin: null, importedAt: null, packageVersion: null, checksum: null };
    }
    return this.state.plugins[record.manifest.id]?.packageInfo ?? { origin: null, importedAt: null, packageVersion: null, checksum: null };
  }

  private createHealthSummary(record: PluginRecord, activity: PluginActivitySummary): PluginHealthSummary {
    return {
      lastStartedAt: activity.lastStartedAt,
      lastApiCallAt: activity.lastNetworkAt ?? activity.lastProviderCallAt ?? activity.lastCommandAt ?? activity.lastEventAt,
      lastErrorAt: activity.lastErrorAt,
      errorCount: activity.errorCount,
      disabledByHost: record.disabledByHost,
    };
  }

  private bumpProviderCall(pluginId: string): void {
    this.bumpPluginActivity(pluginId, (activity, now) => ({
      ...activity,
      lastProviderCallAt: now,
      providerCallCount: activity.providerCallCount + 1,
    }));
  }

  private recordPluginErrorActivity(pluginId: string): void {
    this.bumpPluginActivity(pluginId, (activity, now) => ({
      ...activity,
      lastErrorAt: now,
      errorCount: activity.errorCount + 1,
    }));
  }

  private collectPluginPackageFiles(record: PluginRecord): PluginPackageFile[] {
    const files: PluginPackageFile[] = [];
    for (const item of readdirSync(record.directory, { withFileTypes: true })) {
      if (!item.isFile() || files.length >= maxPluginPackageFiles) {
        continue;
      }
      const safePath = normalizePluginPackageFilePath(item.name);
      if (!safePath || safePath.endsWith('.echo-plugin.json') || pluginPackageExcludedFiles.has(safePath)) {
        continue;
      }
      if (!exportablePluginFileExtensions.has(extname(safePath).toLowerCase())) {
        continue;
      }
      const filePath = join(record.directory, safePath);
      if (statSync(filePath).size > maxPluginPackageFileBytes) {
        continue;
      }
      files.push({
        path: safePath,
        content: readFileSync(filePath, 'utf8'),
      });
    }
    return files;
  }

  private async chooseExportPath(manifest: PluginManifest): Promise<string | null> {
    const result = await dialog.showSaveDialog({
      title: 'Export ECHO plugin package',
      defaultPath: `${manifest.id}-${manifest.version}.echo-plugin.json`,
      filters: [{ name: 'ECHO plugin package', extensions: ['json'] }],
    });
    return result.canceled ? null : result.filePath ?? null;
  }

  private async chooseImportPath(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: 'Import ECHO plugin package',
      properties: ['openFile'],
      filters: [{ name: 'ECHO plugin package', extensions: ['json'] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  private requireRecord(pluginId: string): PluginRecord {
    const record = this.records.get(pluginId);
    if (!record) {
      throw new Error('plugin_not_found');
    }
    return record;
  }

  private normalizeTrustedPermissions(value: unknown, requested: PluginPermission[]): PluginPermission[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return requested.filter((permission) => value.includes(permission));
  }

  private readState(): Required<PluginStateFile> {
    const path = join(this.pluginDirectory, stateFileName);
    if (!existsSync(path)) {
      return { plugins: {} };
    }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as PluginStateFile;
      return { plugins: isRecord(parsed.plugins) ? parsed.plugins as Record<string, PluginState> : {} };
    } catch {
      return { plugins: {} };
    }
  }

  private writeState(): void {
    mkdirSync(this.pluginDirectory, { recursive: true });
    writeFileSync(join(this.pluginDirectory, stateFileName), `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
  }

  private markError(record: PluginRecord, error: unknown): void {
    const pluginId = record.manifest?.id ?? basename(record.directory);
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    const currentState = this.state.plugins[pluginId] ?? {};
    const recentCrashes = (currentState.crashTimestamps ?? [])
      .filter((timestamp) => Date.parse(timestamp) >= Date.now() - pluginCrashLoopWindowMs)
      .concat(now);

    record.status = 'error';
    record.error = message;
    currentState.crashTimestamps = recentCrashes;
    currentState.lastError = message;
    currentState.lastErrorAt = now;
    if (recentCrashes.length >= pluginCrashLoopLimit) {
      currentState.enabled = false;
      currentState.disabledByHost = true;
      record.enabled = false;
      record.disabledByHost = true;
      record.status = 'disabled';
      this.stopPlugin(pluginId);
      this.log(pluginId, 'error', `plugin_disabled_after_repeated_errors:${message}`);
    }
    this.state.plugins[pluginId] = currentState;
    this.writeState();
    this.recordPluginErrorActivity(pluginId);
    this.log(pluginId, 'error', record.error);
  }

  private log(pluginId: string, level: PluginLogEntry['level'], message: string): void {
    this.logs.push({
      id: randomUUID(),
      pluginId,
      level,
      message: message.slice(0, maxLogMessageLength),
      createdAt: new Date().toISOString(),
    });
    if (this.logs.length > maxLogEntries) {
      this.logs.splice(0, this.logs.length - maxLogEntries);
    }
  }
}

let pluginService: PluginService | null = null;

export const getPluginService = (): PluginService => {
  pluginService ??= new PluginService();
  return pluginService;
};
