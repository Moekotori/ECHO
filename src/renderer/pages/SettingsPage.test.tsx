// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import type { AppSettings, AppThemeToneOverride } from '../../shared/types/appSettings';
import type { PluginSummary } from '../../shared/types/plugins';
import { defaultSidebarHiddenRouteIds, defaultSidebarRouteOrder } from '../../shared/types/sidebar';
import type { DownloadSettings } from '../../shared/types/downloads';
import {
  createDefaultGlobalShortcuts,
  createDefaultLocalShortcuts,
  createRecommendedGlobalShortcuts,
  createRecommendedLocalShortcuts,
} from '../../shared/types/globalShortcuts';
import type { HqPlayerConnectionTestResult, HqPlayerSettings, HqPlayerStatus } from '../../shared/types/hqplayer';
import type { LibraryDatabaseProtectionStatus, LibraryScanStatus } from '../../shared/types/library';
import type { MvSettings } from '../../shared/types/mv';
import { resetLibraryScanSessionForTests } from '../stores/libraryScanSession';

const settings: AppSettings = {
  appearanceTheme: 'light',
  albumMergeStrategy: 'standard',
  artistWallAlbumArtwork: false,
  artistWallAlbumFallbackForMissingAvatars: false,
  autoAccountCheckOnStartup: true,
  suppressAccountExpiryNotices: false,
  coverCacheDir: null,
  hideToTrayOnClose: false,
  touchOnScreenKeyboardEnabled: false,
  appWindowAcrylicEnabled: false,
  appWindowAcrylicKeepWhenUnfocusedEnabled: false,
  appWindowAcrylicTransparencyPercent: 70,
  appCustomWallpaperPath: null,
  appWallpaperScalePercent: 100,
  appWallpaperBlurPx: 0,
  appWallpaperBrightnessPercent: 100,
  appWallpaperUiOpacityPercent: 100,
  appWallpaperUnifiedOpacityEnabled: false,
  networkMetadataEnabled: true,
  networkMetadataProviders: ['netease-cloud-music', 'qq-music'],
  lyricsNetworkEnabled: true,
  lyricsPreferredProvider: 'lrclib',
  lyricsEnabledProviders: ['local', 'lrclib', 'netease', 'qqmusic'],
  lyricsProviderOrder: ['local', 'lrclib', 'netease', 'qqmusic'],
  lyricsDeepSearchEnabled: true,
  lyricsAutoSearch: true,
  lyricsAutoAcceptScore: 0.7,
  lyricsBackfillAutoAcceptScore: 0.45,
  lyricsDefaultOffsetMs: 0,
  lyricsGlobalSyncOffsetMs: 0,
  lyricsOffsetControlsEnabled: false,
  lyricsEnabled: true,
  lyricsHeaderHidden: false,
  lyricsEmptyStateHidden: true,
  lyricsPlayerBarDrawerEnabled: false,
  lyricsRomanizationEnabled: true,
  lyricsTranslationEnabled: true,
  lyricsFontSizePx: 40,
  lyricsSecondaryFontSizePx: 22,
  lyricsLineSpacingPercent: 110,
  lyricsContextOpacityPercent: 49,
  lyricsColor: '#314054',
  lyricsBackgroundMode: 'theme',
  lyricsCustomWallpaperPath: null,
  lyricsCoverOpacityPercent: 100,
  lyricsCoverBlurPx: 10,
  lyricsCoverBrightnessPercent: 100,
  lyricsBackgroundScalePercent: 100,
  mvEnabledProviders: ['bilibili', 'youtube'],
  mvProviderOrder: ['bilibili', 'youtube'],
  mvAutoSearch: true,
  mvMaxQuality: '1080p',
  mvAllow60fps: true,
  channelBalance: {
    enabled: false,
    balance: 0,
    leftGainDb: 0,
    rightGainDb: 0,
    swapLeftRight: false,
    monoMode: 'off',
    invertLeft: false,
    invertRight: false,
    constantPower: true,
  },
  playerVolume: 1,
  backgroundSpacePauseEnabled: false,
  localShortcuts: createDefaultLocalShortcuts(),
  globalShortcuts: createDefaultGlobalShortcuts(),
  playbackSpeed: 1,
  playbackSpeedMode: 'nightcore',
  scanPerformanceMode: 'balanced',
  duplicateTracksEnabled: false,
  duplicateTracksMode: 'strict',
  duplicateTracksAutoRebuildAfterScan: false,
  discordRichPresenceEnabled: false,
  lastFmEnabled: false,
  lastFmUsername: null,
  lastFmSessionKey: null,
  lastFmScrobbleEnabled: true,
  lastFmNowPlayingEnabled: true,
  lastFmMinScrobbleSeconds: 30,
  lastFmAuthToken: null,
  smtcEnabled: true,
  smtcLyricsEnabled: false,
  taskbarPlaybackControlsEnabled: false,
};

const hqPlayerSettings: HqPlayerSettings = {
  enabled: false,
  connectionMode: 'localDesktop',
  host: '127.0.0.1',
  port: null,
  executablePath: null,
  allowLaunch: false,
  mediaServerEnabled: false,
  mediaServerPort: null,
  defaultPlaybackBackend: 'echoNative',
  profileName: null,
};

const hqPlayerStatus: HqPlayerStatus = {
  enabled: false,
  state: 'disabled',
  endpoint: {
    connectionMode: 'localDesktop',
    host: '127.0.0.1',
    port: null,
  },
  mediaServerEnabled: false,
  defaultPlaybackBackend: 'echoNative',
  profileName: null,
  lastCheckedAt: null,
  lastError: null,
};

const getSettingsMock = vi.fn();
const setSettingsMock = vi.fn();
const resetSettingsMock = vi.fn();
const clearCacheMock = vi.fn();
const getDatabaseProtectionStatusMock = vi.fn();
const createDatabaseSnapshotMock = vi.fn();
const restoreDatabaseSnapshotMock = vi.fn();
const scrubQuarantinedDatabaseMock = vi.fn();
const openDataProtectionFolderMock = vi.fn();
const repairDatabaseMock = vi.fn();
const chooseLyricsWallpaperMock = vi.fn();
const chooseAppWallpaperMock = vi.fn();
const openExternalUrlMock = vi.fn();
const getDownloadSettingsMock = vi.fn();
const chooseDownloadOutputDirectoryMock = vi.fn();
const getCacheInventoryMock = vi.fn();
const getUpdateStatusMock = vi.fn();
const audioGetStatusMock = vi.fn();
const audioGetDiagnosticsMock = vi.fn();
const audioListDevicesMock = vi.fn();
const audioSetOutputMock = vi.fn();
const audioResetEngineMock = vi.fn();
const audioForceRestartMock = vi.fn();
const audioRestartWindowsAudioServiceMock = vi.fn();
const getChannelBalanceStateMock = vi.fn();
const setChannelBalanceStateMock = vi.fn();
const validateGlobalShortcutMock = vi.fn();
const kickoffArtistImageBackfillMock = vi.fn();
const getArtistImageJobStatusMock = vi.fn();
const clearArtistOnlineInfoCacheMock = vi.fn();
const previewDuplicateTrackCleanupMock = vi.fn();
const applyDuplicateTrackCleanupMock = vi.fn();
const getFoldersMock = vi.fn();
const scanFolderMock = vi.fn();
const getScanStatusMock = vi.fn();
const startReplayGainAnalysisMock = vi.fn();
const getReplayGainAnalysisStatusMock = vi.fn();
const openPluginDirectoryMock = vi.fn();
const createPluginExampleMock = vi.fn();
const listPluginsMock = vi.fn();
const hqPlayerGetSettingsMock = vi.fn();
const hqPlayerSetSettingsMock = vi.fn();
const hqPlayerGetStatusMock = vi.fn();
const hqPlayerTestConnectionMock = vi.fn();
const openDevConsoleMock = vi.fn();
const relaunchAppMock = vi.fn();

const downloadSettings: DownloadSettings = {
  audioStrategy: 'best_available',
  importToLibrary: true,
  bindMvAfterImport: true,
  outputDirectory: 'D:\\Downloads',
};

const healthyDatabaseProtectionStatus: LibraryDatabaseProtectionStatus = {
  status: 'ok',
  reason: 'none',
  dataProtectionPath: 'D:\\Echo\\data-protection',
  databasePath: 'D:\\Echo\\echo-library.sqlite',
  databaseSizeBytes: 4096,
  health: {
    status: 'ok',
    databasePath: 'D:\\Echo\\echo-library.sqlite',
    checkedAt: '2026-05-18T00:00:00.000Z',
  },
  snapshots: [
    {
      id: '2026-05-18T00-00-00-000Z-startup',
      path: 'D:\\Echo\\data-protection\\snapshots\\2026-05-18T00-00-00-000Z-startup',
      createdAt: '2026-05-18T00:00:00.000Z',
      reason: 'startup',
      copied: ['echo-library.sqlite'],
      skipped: ['echo-library.sqlite-wal', 'echo-library.sqlite-shm'],
      libraryHealth: {
        status: 'ok',
        databasePath: 'D:\\Echo\\data-protection\\snapshots\\2026-05-18T00-00-00-000Z-startup\\echo-library.sqlite',
        checkedAt: '2026-05-18T00:00:00.000Z',
      },
      libraryBackupMethod: 'sqlite-backup',
      databasePath: 'D:\\Echo\\data-protection\\snapshots\\2026-05-18T00-00-00-000Z-startup\\echo-library.sqlite',
      databaseSizeBytes: 4096,
    },
  ],
  latestHealthySnapshot: null,
  latestArchive: null,
  maintenanceEvents: [],
  canRestoreSnapshot: false,
  canScrubQuarantinedDatabase: false,
  hasRunningScan: false,
  recommendedAction: 'none',
};

healthyDatabaseProtectionStatus.latestHealthySnapshot = healthyDatabaseProtectionStatus.snapshots[0];
healthyDatabaseProtectionStatus.canRestoreSnapshot = true;

const playbackStatus = {
  host: 'ready',
  state: 'stopped',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: 'wasapi-shared',
  activeOutputBackendImpl: 'juce',
  outputMode: 'shared',
  sharedBackend: 'auto',
  useJuceOutputRequested: true,
  useJuceDecodeRequested: true,
  activeDecodeBackendImpl: null,
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: null,
  currentTrackId: null,
  durationSeconds: 0,
  positionSeconds: 0,
  channels: null,
  codec: null,
  bitDepth: null,
  bitrate: null,
  fileSampleRate: null,
  decoderOutputSampleRate: null,
  requestedOutputSampleRate: null,
  actualDeviceSampleRate: null,
  sharedDeviceSampleRate: null,
  resampling: false,
  bitPerfectCandidate: false,
  sampleRateMismatch: false,
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: null,
  clippingRisk: false,
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
};

vi.mock('../i18n/I18nProvider', () => ({
  useOptionalI18n: () => ({
    locale: 'zh-CN',
    t: (key: string) => key,
  }),
  useI18n: () => ({
    locale: 'zh-CN',
    localeOptions: [{ label: '简体中文', value: 'zh-CN' }],
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

vi.mock('../utils/echoBridge', () => ({
  getAppBridge: () => ({
    chooseCacheDirectory: vi.fn(),
    getDefaultCacheDirectory: vi.fn().mockResolvedValue('D:\\Cache'),
    getCacheInventory: getCacheInventoryMock,
    getSettings: getSettingsMock,
    getVersion: vi.fn().mockResolvedValue('1.0.1'),
    getUpdateStatus: getUpdateStatusMock,
    chooseAppWallpaper: chooseAppWallpaperMock,
    openExternalUrl: openExternalUrlMock,
    validateGlobalShortcut: validateGlobalShortcutMock,
    resetSettings: resetSettingsMock,
    setCoverCacheDirectory: vi.fn(),
    setSettings: setSettingsMock,
  }),
  getAudioBridge: () => ({
    getStatus: audioGetStatusMock,
    getDiagnostics: audioGetDiagnosticsMock,
    listDevices: audioListDevicesMock,
    setOutput: audioSetOutputMock,
    resetEngine: audioResetEngineMock,
    forceRestart: audioForceRestartMock,
    restartWindowsAudioService: audioRestartWindowsAudioServiceMock,
  }),
  getEqBridge: () => ({
    getChannelBalanceState: getChannelBalanceStateMock,
    setChannelBalanceState: setChannelBalanceStateMock,
  }),
  getAccountsBridge: () => ({
    getStatuses: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn((provider) => Promise.resolve({ provider, connected: false })),
    saveCookie: vi.fn(),
    startLogin: vi.fn(),
    clear: vi.fn(),
    check: vi.fn(),
    setBrowser: vi.fn((provider, browser) => Promise.resolve({ provider, connected: browser !== 'none' })),
    setYouTubeBrowser: vi.fn(),
  }),
  getDiagnosticsBridge: () => ({
    clearLastCrashSummary: vi.fn(),
    exportDiagnostics: vi.fn().mockResolvedValue('D:\\Echo\\diagnostics.md'),
    exportDiagnosticsZip: vi.fn().mockResolvedValue('D:\\Echo\\diagnostics.zip'),
    getLastCrashSummary: vi.fn().mockResolvedValue(null),
    openDiagnosticsFolder: vi.fn(),
    openCrashReport: vi.fn().mockResolvedValue('D:\\Echo\\crash-report.md'),
    openAudioCrashReport: vi.fn().mockResolvedValue('D:\\Echo\\audio-crash-report.md'),
    relaunchApp: relaunchAppMock,
    openDevConsole: openDevConsoleMock,
  }),
  getDownloadsBridge: () => ({
    getSettings: getDownloadSettingsMock,
    chooseOutputDirectory: chooseDownloadOutputDirectoryMock,
  }),
  getPluginsBridge: () => ({
    list: listPluginsMock,
    openDirectory: openPluginDirectoryMock,
    createExample: createPluginExampleMock,
  }),
  getDiscordPresenceBridge: () => ({
    getStatus: vi.fn().mockResolvedValue({ available: true, connected: false, enabled: false, lastError: null }),
    setEnabled: vi.fn().mockResolvedValue({ available: true, connected: false, enabled: true, lastError: null }),
  }),
  getLastFmBridge: () => ({
    getStatus: vi.fn().mockResolvedValue({ activeTrack: null, authPending: false, connected: false, enabled: false, lastError: null, username: null }),
    setEnabled: vi.fn().mockResolvedValue({ activeTrack: null, authPending: false, connected: false, enabled: true, lastError: null, username: null }),
    startAuth: vi.fn(),
    completeAuth: vi.fn(),
    disconnect: vi.fn(),
  }),
  getHqPlayerBridge: () => ({
    getSettings: hqPlayerGetSettingsMock,
    setSettings: hqPlayerSetSettingsMock,
    getStatus: hqPlayerGetStatusMock,
    testConnection: hqPlayerTestConnectionMock,
  }),
  getLibraryBridge: () => ({
    clearCache: clearCacheMock,
    getDatabaseProtectionStatus: getDatabaseProtectionStatusMock,
    createDatabaseSnapshot: createDatabaseSnapshotMock,
    restoreDatabaseSnapshot: restoreDatabaseSnapshotMock,
    scrubQuarantinedDatabase: scrubQuarantinedDatabaseMock,
    openDataProtectionFolder: openDataProtectionFolderMock,
    repairDatabase: repairDatabaseMock,
    getArtistImageJobStatus: getArtistImageJobStatusMock,
    kickoffArtistImageBackfill: kickoffArtistImageBackfillMock,
    clearArtistOnlineInfoCache: clearArtistOnlineInfoCacheMock,
    getDuplicateIndexSummary: vi.fn().mockResolvedValue({
      mode: 'strict',
      totalTracksScanned: 0,
      duplicateGroups: 0,
      duplicateMembers: 0,
      hiddenTracks: 0,
      updatedAt: '',
    }),
    getSummary: vi.fn().mockResolvedValue({ songCount: 0, albumCount: 0, artistCount: 0, folderCount: 0, totalDuration: 0, lastScanAt: null }),
    refreshDuplicateTracks: vi.fn().mockResolvedValue({
      mode: 'strict',
      totalTracksScanned: 0,
      duplicateGroups: 0,
      duplicateMembers: 0,
      hiddenTracks: 0,
      updatedAt: '',
    }),
    previewDuplicateTrackCleanup: previewDuplicateTrackCleanupMock,
    applyDuplicateTrackCleanup: applyDuplicateTrackCleanupMock,
    getFolders: getFoldersMock,
    scanFolder: scanFolderMock,
    getScanStatus: getScanStatusMock,
    refreshAlbumGrouping: vi.fn().mockResolvedValue({ songCount: 0, albumCount: 0, artistCount: 0, folderCount: 0, totalDuration: 0, lastScanAt: null }),
    startReplayGainAnalysis: startReplayGainAnalysisMock,
    getReplayGainAnalysisStatus: getReplayGainAnalysisStatusMock,
  }),
}));

vi.mock('../components/audio/EqPanel', () => ({
  EqPanel: () => <div />,
}));

vi.mock('../components/library/LibraryFoldersPanel', () => ({
  LibraryFoldersPanel: () => <div />,
}));

vi.mock('../components/library/LibraryDiagnosticsPanel', () => ({
  LibraryDiagnosticsPanel: () => <div />,
}));

vi.mock('../components/library/LibraryHealthReportPanel', () => ({
  LibraryHealthReportPanel: () => <div />,
}));

vi.mock('../components/library/LibraryQualityPanel', () => ({
  LibraryQualityPanel: () => <div />,
}));

vi.mock('../components/library/NetworkMetadataPanel', () => ({
  NetworkMetadataPanel: () => <div />,
}));

vi.mock('../components/settings/RemoteSourcesPanel', () => ({
  RemoteSourcesPanel: () => <div />,
}));

vi.mock('../stores/PlaybackQueueProvider', () => ({
  useOptionalPlaybackQueue: () => ({
    automixEnabled: false,
    setAutomixEnabled: vi.fn(),
  }),
  usePlaybackQueue: () => ({
    automixEnabled: false,
    setAutomixEnabled: vi.fn(),
  }),
}));

const setNavigatorPlatform = (platform: string, userAgent: string): void => {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  });
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  resetLibraryScanSessionForTests();
  setNavigatorPlatform('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  getDownloadSettingsMock.mockResolvedValue(downloadSettings);
  chooseDownloadOutputDirectoryMock.mockResolvedValue({ ...downloadSettings, outputDirectory: 'E:\\Music Downloads' });
  hqPlayerGetSettingsMock.mockResolvedValue(hqPlayerSettings);
  hqPlayerSetSettingsMock.mockImplementation(async (patch: Partial<HqPlayerSettings>) => ({ ...hqPlayerSettings, ...patch }));
  hqPlayerGetStatusMock.mockResolvedValue(hqPlayerStatus);
  hqPlayerTestConnectionMock.mockImplementation(async (patch?: Partial<HqPlayerSettings>): Promise<HqPlayerConnectionTestResult> => ({
    ok: true,
    state: 'available',
    endpoint: {
      connectionMode: patch?.connectionMode ?? hqPlayerSettings.connectionMode,
      host: patch?.host ?? hqPlayerSettings.host,
      port: patch?.port ?? hqPlayerSettings.port,
    },
    elapsedMs: 5,
    checkedAt: '2026-05-20T00:00:00.000Z',
    error: null,
  }));
  getCacheInventoryMock.mockResolvedValue({
    generatedAt: '2026-05-20T00:00:00.000Z',
    totalSizeBytes: 0,
    items: [],
  });
  listPluginsMock.mockResolvedValue({ directory: 'D:\\Echo\\plugins', plugins: [] });
  getUpdateStatusMock.mockResolvedValue(null);
  getDatabaseProtectionStatusMock.mockResolvedValue(healthyDatabaseProtectionStatus);
  createDatabaseSnapshotMock.mockResolvedValue(healthyDatabaseProtectionStatus);
  restoreDatabaseSnapshotMock.mockResolvedValue({
    databasePath: healthyDatabaseProtectionStatus.databasePath,
    archivePath: 'D:\\Echo\\data-protection\\corrupt-archives\\old',
    restoredSnapshot: healthyDatabaseProtectionStatus.snapshots[0],
    restoredDatabaseFiles: ['echo-library.sqlite'],
    health: healthyDatabaseProtectionStatus.health,
  });
  scrubQuarantinedDatabaseMock.mockResolvedValue({
    databasePath: healthyDatabaseProtectionStatus.databasePath,
    sourceArchivePath: 'D:\\Echo\\data-protection\\corrupt-archives\\poisoned',
    scrubbedDatabasePath: 'D:\\Echo\\data-protection\\scrubbed-libraries\\metadata-scrub\\echo-library.sqlite',
    archivePath: null,
    replacedDatabaseFiles: [],
    scrubbedRows: 1,
    health: healthyDatabaseProtectionStatus.health,
    poisonReportBefore: {
      status: 'poisoned',
      reason: 'poisoned_metadata',
      checkedAt: '2026-05-18T00:00:00.000Z',
      databasePath: 'D:\\Echo\\data-protection\\corrupt-archives\\poisoned\\echo-library.sqlite',
      suspectCounts: { 'tracks.title': 1 },
      maxFieldLengths: { 'tracks.title': 1000000 },
    },
    poisonReportAfter: {
      status: 'ok',
      reason: 'none',
      checkedAt: '2026-05-18T00:00:01.000Z',
      databasePath: 'D:\\Echo\\data-protection\\scrubbed-libraries\\metadata-scrub\\echo-library.sqlite',
      suspectCounts: {},
      maxFieldLengths: {},
    },
  });
  repairDatabaseMock.mockResolvedValue({
    databasePath: healthyDatabaseProtectionStatus.databasePath,
    archivePath: 'D:\\Echo\\data-protection\\corrupt-archives\\bad',
    removedDatabaseFiles: ['echo-library.sqlite'],
    readyForRescan: true,
  });
  openDataProtectionFolderMock.mockResolvedValue(undefined);
  audioGetStatusMock.mockResolvedValue(null);
  audioGetDiagnosticsMock.mockResolvedValue({
    ...playbackStatus,
    watchdogStatus: 'idle',
    recentWatchdogRecoveryCount: 0,
    lastWatchdogRecoveryTime: null,
  });
  audioListDevicesMock.mockResolvedValue([]);
  audioSetOutputMock.mockResolvedValue(null);
  audioResetEngineMock.mockResolvedValue({ state: 'stopped', warnings: [] });
  audioForceRestartMock.mockResolvedValue({ state: 'stopped', warnings: [] });
  audioRestartWindowsAudioServiceMock.mockResolvedValue({ state: 'stopped', warnings: [] });
  getChannelBalanceStateMock.mockResolvedValue(settings.channelBalance);
  setChannelBalanceStateMock.mockResolvedValue({ ...settings.channelBalance, enabled: true, monoMode: 'sum' });
  openExternalUrlMock.mockResolvedValue(undefined);
  openDevConsoleMock.mockResolvedValue(undefined);
  openPluginDirectoryMock.mockResolvedValue(undefined);
  createPluginExampleMock.mockResolvedValue({ pluginId: 'echo.playback-panel', directory: 'D:\\Echo\\plugins\\echo.playback-panel' });
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
  validateGlobalShortcutMock.mockResolvedValue({
    accelerator: 'Ctrl+Alt+Space',
    available: true,
    reason: 'available',
    valid: true,
  });
  kickoffArtistImageBackfillMock.mockResolvedValue({
    paused: false,
    running: true,
    queued: 4,
    active: 1,
    lastQueued: { queued: 5, skipped: 2 },
    summary: {
      total: 5,
      matched: 0,
      pending: 4,
      loading: 1,
      notFound: 0,
      error: 0,
      rateLimited: 0,
    },
  });
  getArtistImageJobStatusMock.mockResolvedValue({
    paused: true,
    running: false,
    queued: 0,
    active: 0,
    lastQueued: { queued: 0, skipped: 0 },
    summary: {
      total: 0,
      matched: 0,
      pending: 0,
      loading: 0,
      notFound: 0,
      error: 0,
      rateLimited: 0,
    },
  });
  clearArtistOnlineInfoCacheMock.mockResolvedValue({ removedRows: 0 });
  previewDuplicateTrackCleanupMock.mockResolvedValue({
    summary: {
      mode: 'strict',
      totalTracksScanned: 0,
      duplicateGroups: 0,
      duplicateMembers: 0,
      hiddenTracks: 0,
      updatedAt: '',
    },
    groups: [],
    removeTrackIds: [],
    totalTracksToRemove: 0,
    totalBytesToRemove: 0,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  applyDuplicateTrackCleanupMock.mockResolvedValue({
    requestedTrackIds: 0,
    trashedTracks: 0,
    missingFiles: 0,
    removedFromLibrary: 0,
    failedTracks: [],
    totalBytesRequested: 0,
    updatedSummary: {
      mode: 'strict',
      totalTracksScanned: 0,
      duplicateGroups: 0,
      duplicateMembers: 0,
      hiddenTracks: 0,
      updatedAt: '',
    },
  });
  getFoldersMock.mockResolvedValue([]);
  scanFolderMock.mockImplementation(async (folderId: string): Promise<LibraryScanStatus> => ({
    id: `scan-${folderId}`,
    folderId,
    status: 'queued',
    phase: 'queued',
    totalFiles: 0,
    processedFiles: 0,
    skippedFiles: 0,
    addedTracks: 0,
    updatedTracks: 0,
    removedTracks: 0,
    coverCount: 0,
    errorCount: 0,
    errors: [],
    startedAt: null,
    finishedAt: null,
  }));
  getScanStatusMock.mockImplementation(async (jobId: string): Promise<LibraryScanStatus> => ({
    id: jobId,
    folderId: jobId.replace(/^scan-/, ''),
    status: 'completed',
    phase: 'finished',
    totalFiles: 0,
    processedFiles: 0,
    skippedFiles: 0,
    addedTracks: 0,
    updatedTracks: 0,
    removedTracks: 0,
    coverCount: 0,
    errorCount: 0,
    errors: [],
    startedAt: '2026-05-29T00:00:00.000Z',
    finishedAt: '2026-05-29T00:00:01.000Z',
  }));
  startReplayGainAnalysisMock.mockResolvedValue({
    id: 'replay-gain-job',
    status: 'completed',
    totalTracks: 0,
    processedTracks: 0,
    updatedTracks: 0,
    errorCount: 0,
  });
  getReplayGainAnalysisStatusMock.mockResolvedValue({
    id: 'replay-gain-job',
    status: 'completed',
    totalTracks: 0,
    processedTracks: 0,
    updatedTracks: 0,
    errorCount: 0,
  });
  window.echo = {
    app: {
      getSettings: getSettingsMock,
      setSettings: setSettingsMock,
      chooseLyricsWallpaper: chooseLyricsWallpaperMock,
      chooseAppWallpaper: chooseAppWallpaperMock,
    },
    diagnostics: {
      relaunchApp: relaunchAppMock,
    },
  } as unknown as Window['echo'];
});

const clickSettingsNav = (labelPattern: string): void => {
  const nav = screen.getByRole('navigation', { name: 'route.settings.label' });
  fireEvent.click(within(nav).getByRole('button', { name: new RegExp(labelPattern) }));
};

const expandThemePresetGrid = (): void => {
  const summary = document.querySelector('.settings-theme-preset-summary') as HTMLButtonElement | null;
  if (summary && summary.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(summary);
  }
};

const getShortcutScope = (row: HTMLElement, scope: 'local' | 'global'): HTMLElement =>
  within(row).getByRole('group', { name: `settings.shortcuts.scope.${scope}` });

const createThemePluginSummary = (): PluginSummary => ({
  id: 'echo.aurora-theme-pack-with-very-long-plugin-id-for-custom-theme',
  name: 'Aurora Theme',
  version: '0.1.0',
  apiVersion: 2,
  compatibility: { isCompatible: true, reason: null, minEchoVersion: null },
  packageInfo: { origin: null, importedAt: null, packageVersion: null, checksum: null },
  health: { lastStartedAt: '2026-06-02T00:00:00.000Z', lastApiCallAt: null, lastErrorAt: null, errorCount: 0, disabledByHost: false },
  directory: 'D:\\Echo\\plugins\\echo.aurora-theme',
  entry: 'plugin.js',
  panel: null,
  permissions: [],
  trustedPermissions: [],
  enabled: true,
  status: 'running',
  error: null,
  disabledByHost: false,
  activity: {
    lastStartedAt: '2026-06-02T00:00:00.000Z',
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
  },
  security: {
    requestedPermissionCount: 0,
    trustedPermissionCount: 0,
    untrustedPermissions: [],
    highRiskPermissions: [],
    reservedPermissions: [],
    limitedPermissions: [],
    hasEntry: true,
    hasPanel: false,
    sandboxedPanel: true,
    commandCount: 0,
    metadataProviderCount: 0,
    sourceProviderCount: 0,
    lyricsProviderCount: 0,
    coverProviderCount: 0,
    themePresetCount: 1,
    settingCount: 0,
    networkEnabled: false,
  },
  contributes: {
    themePresets: [
      {
        id: 'aurora-glass',
        title: 'Aurora Glass',
        description: 'Plugin theme',
        basePreset: 'classic',
        preview: 'linear-gradient(135deg, #08111f 0%, #257f96 100%)',
        swatches: ['#08111f', '#257f96', '#f0b35b'],
        light: {
          appBg: '#eef8ff',
          panel: '#ffffff',
          accent: '#257f96',
          text: '#234150',
          glassPercent: 26,
          panelBlurPx: 18,
        },
        dark: {
          appBg: '#08111f',
          panel: '#142234',
          accent: '#5cc8dc',
          text: '#c8dce8',
          motionIntensityPercent: 90,
        },
      },
    ],
  },
  commands: [],
  metadataProviders: [],
  sourceProviders: [],
  lyricsProviders: [],
  coverProviders: [],
  settingsValues: {},
});

const hexToRgb = (value: string): { r: number; g: number; b: number } => ({
  r: Number.parseInt(value.slice(1, 3), 16),
  g: Number.parseInt(value.slice(3, 5), 16),
  b: Number.parseInt(value.slice(5, 7), 16),
});

const relativeLuminance = (value: string): number => {
  const channel = (component: number): number => {
    const normalized = component / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const rgb = hexToRgb(value);
  return channel(rgb.r) * 0.2126 + channel(rgb.g) * 0.7152 + channel(rgb.b) * 0.0722;
};

const contrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

const expectReadableThemeTone = (tone: AppThemeToneOverride): void => {
  expect(contrastRatio(tone.text ?? '', tone.appBg ?? '')).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(tone.heading ?? '', tone.appBg ?? '')).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(tone.buttonText ?? '', tone.panel ?? '')).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(tone.onAccent ?? '', tone.accent ?? '')).toBeGreaterThanOrEqual(3);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeMode;
  delete document.documentElement.dataset.themePreset;
  delete document.documentElement.dataset.themeCustom;
  delete document.documentElement.dataset.themeCustomId;
  delete (window as { echo?: Window['echo'] }).echo;
});

describe('SettingsPage', () => {
  it('jumps from global settings search to a matching section', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const searchInput = screen.getByPlaceholderText('settings.header.searchPlaceholder') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: '外观' } });
    fireEvent.click(screen.getByRole('option', { name: /settings\.nav\.appearance\.label/ }));

    expect(searchInput.value).toBe('');
    expect(screen.getByText('settings.appearance.theme.title')).toBeTruthy();
  });

  it('opens the first global settings search result with Enter', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const searchInput = screen.getByPlaceholderText('settings.header.searchPlaceholder') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: '壁纸' } });
    fireEvent.keyDown(searchInput, { key: 'Enter' });

    expect(searchInput.value).toBe('');
    expect(screen.getByText('settings.appearance.theme.title')).toBeTruthy();
  });

  it('dispatches home navigation when Escape is pressed in settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const settingsBack = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    window.addEventListener('app:navigate:settings-back', settingsBack, { once: true });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const nav = screen.getByRole('navigation', { name: 'route.settings.label' });
    const appearanceButton = within(nav).getByRole('button', { name: /settings\.nav\.appearance\.label/ });

    fireEvent.click(appearanceButton);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(settingsBack).toHaveBeenCalledTimes(1);
    expect(appearanceButton.getAttribute('aria-current')).toBe('page');
  });

  it('marks onboarding incomplete from the general settings guide toggle', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const nextSettings = { ...settings, onboardingCompleted: false };
    const settingsChanged = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockResolvedValue(nextSettings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    window.addEventListener('settings:changed', settingsChanged, { once: true });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const row = screen.getByText('settings.general.firstRunWizard.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ onboardingCompleted: false }));
    expect(settingsChanged).toHaveBeenCalledWith(expect.objectContaining({ detail: nextSettings }));
  });

  it('saves sidebar auto-hide from the general settings toggle', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const nextSettings = { ...settings, sidebarAutoHideEnabled: true };
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockResolvedValue(nextSettings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const row = screen.getByText('settings.general.sidebarAutoHide.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ sidebarAutoHideEnabled: true, sidebarIconOnlyEnabled: false }));
  });

  it('saves sidebar icon-only from the general settings toggle', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const nextSettings = { ...settings, sidebarIconOnlyEnabled: true };
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockResolvedValue(nextSettings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const row = screen.getByText('settings.general.sidebarIconOnly.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ sidebarIconOnlyEnabled: true, sidebarAutoHideEnabled: false }));
  });

  it('hides optional Plugins, Remote, and EQ settings nav items by default', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const nav = screen.getByRole('navigation', { name: 'route.settings.label' });

    expect(within(nav).queryByRole('button', { name: /settings\.nav\.plugins\.label/ })).toBeNull();
    expect(within(nav).queryByRole('button', { name: /settings\.nav\.remote\.label/ })).toBeNull();
    expect(within(nav).queryByRole('button', { name: /settings\.nav\.eq\.label/ })).toBeNull();
    expect(screen.getByText('settings.general.settingsOptionalSections.title')).toBeTruthy();
  });

  it('shows optional Plugins, Remote, and EQ settings nav items when enabled', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({
      ...settings,
      settingsOptionalSectionsVisible: true,
    });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const nav = screen.getByRole('navigation', { name: 'route.settings.label' });

    expect(within(nav).getByRole('button', { name: /settings\.nav\.plugins\.label/ })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: /settings\.nav\.remote\.label/ })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: /settings\.nav\.eq\.label/ })).toBeTruthy();
  });

  it('saves optional settings sections visibility from general settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(within(screen.getByText('settings.general.settingsOptionalSections.title').closest('.setting-row') as HTMLElement).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ settingsOptionalSectionsVisible: true }));
  });

  it('saves hidden feature comments from the general settings toggle', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const nextSettings = { ...settings, featureCommentsHidden: true };
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockResolvedValue(nextSettings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const row = screen.getByText('settings.general.featureCommentsHidden.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ featureCommentsHidden: true }));
  });

  it('saves track context menu extra actions from the general settings toggle', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const nextSettings = { ...settings, trackContextMenuExtraActionsEnabled: true };
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockResolvedValue(nextSettings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const row = screen.getByText('settings.general.trackContextMenuExtraActions.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ trackContextMenuExtraActionsEnabled: true }));
  });

  it('saves touch keyboard from the general settings toggle', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const nextSettings = { ...settings, touchOnScreenKeyboardEnabled: true };
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockResolvedValue(nextSettings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const row = screen.getByText('settings.general.touchKeyboard.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ touchOnScreenKeyboardEnabled: true }));
  });

  it('saves the bottom signal path control from general settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const currentSettings = { ...settings, signalPathControlEnabled: true };
    const nextSettings = { ...currentSettings, signalPathControlEnabled: false };
    getSettingsMock.mockResolvedValue(currentSettings);
    setSettingsMock.mockResolvedValue(nextSettings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const row = screen.getByText('底栏信号路径').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ signalPathControlEnabled: false }));
  });

  it('saves sidebar visibility and order from appearance controls', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    let currentSettings: AppSettings = {
      ...settings,
      downloadsFeatureUnlocked: true,
      sidebarRouteOrder: [...defaultSidebarRouteOrder],
      sidebarHiddenRouteIds: [...defaultSidebarHiddenRouteIds],
    };
    getSettingsMock.mockResolvedValue(currentSettings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => {
      currentSettings = { ...currentSettings, ...patch };
      return currentSettings;
    });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    const row = screen.getByText('settings.appearance.sidebar.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /settings\.appearance\.sidebar\.summary\.hidden/ }));
    await waitFor(() => expect(setSettingsMock).toHaveBeenLastCalledWith({ appearanceSidebarLayoutExpanded: true }));
    expect(within(row).getByText('route.dsp.label')).toBeTruthy();
    const streamingItem = within(row).getByText('route.streaming.label').closest('.settings-sidebar-route-item') as HTMLElement;
    fireEvent.click(streamingItem.querySelector('.settings-sidebar-visibility-button') as HTMLButtonElement);

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sidebarHiddenRouteIds: [...defaultSidebarHiddenRouteIds, 'streaming'],
        }),
      ),
    );

    const updatedRow = screen.getByText('settings.appearance.sidebar.title').closest('.setting-row') as HTMLElement;
    const dragData = new Map<string, string>();
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: (type: string) => dragData.get(type) ?? '',
      setData: (type: string, value: string) => dragData.set(type, value),
    };
    const homeItem = within(updatedRow).getByText('route.home.label').closest('.settings-sidebar-route-item') as HTMLElement;
    const songsItem = within(updatedRow).getByText('route.songs.label').closest('.settings-sidebar-route-item') as HTMLElement;
    songsItem.getBoundingClientRect = vi.fn(() => ({
      bottom: 10,
      height: 10,
      left: 0,
      right: 10,
      top: 0,
      width: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    fireEvent.dragStart(homeItem, { dataTransfer });
    dataTransfer.setData('text/plain', 'home');
    fireEvent.dragOver(songsItem, { dataTransfer });
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'clientY', { value: 9 });
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer });
    fireEvent(songsItem, dropEvent);

    await waitFor(() => {
      const lastPatch = setSettingsMock.mock.calls.at(-1)?.[0] as Partial<AppSettings>;
      expect(lastPatch.sidebarRouteOrder?.slice(0, 2)).toEqual(['songs', 'home']);
      expect(lastPatch.sidebarHiddenRouteIds).toEqual([...defaultSidebarHiddenRouteIds, 'streaming']);
    });
  });

  it('keeps sidebar layout controls collapsed by default and remembers expansion', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    let currentSettings: AppSettings = {
      ...settings,
      sidebarRouteOrder: [...defaultSidebarRouteOrder],
      sidebarHiddenRouteIds: [...defaultSidebarHiddenRouteIds],
      appearanceSidebarLayoutExpanded: false,
    };
    getSettingsMock.mockResolvedValue(currentSettings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => {
      currentSettings = { ...currentSettings, ...patch };
      return currentSettings;
    });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    const row = screen.getByText('settings.appearance.sidebar.title').closest('.setting-row') as HTMLElement;
    const toggle = within(row).getByRole('button', { name: /settings\.appearance\.sidebar\.summary\.hidden/ });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(row).queryByText('route.home.label')).toBeNull();

    fireEvent.click(toggle);

    await waitFor(() => expect(setSettingsMock).toHaveBeenLastCalledWith({ appearanceSidebarLayoutExpanded: true }));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(row.contains(within(row).getByText('route.home.label'))).toBe(true);
  });

  it('opens community links through the desktop external-url bridge', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.about\\.label');
    fireEvent.click(screen.getByRole('button', { name: /官方网站/ }));
    fireEvent.click(screen.getByRole('button', { name: /使用文档/ }));
    fireEvent.click(screen.getByRole('button', { name: /百度网盘/ }));
    fireEvent.click(screen.getByRole('button', { name: /哔哩哔哩/ }));
    fireEvent.click(screen.getByRole('button', { name: /settings\.about\.updates\.action\.afdian/ }));
    fireEvent.click(screen.getByRole('button', { name: /settings\.about\.updates\.action\.history/ }));
    fireEvent.click(screen.getByRole('button', { name: /settings\.about\.updates\.action\.qq/ }));
    fireEvent.click(screen.getByRole('button', { name: /settings\.about\.updates\.action\.discord/ }));

    expect(openExternalUrlMock).toHaveBeenCalledWith('https://echonext.moe');
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://echonext.moe/zh/docs/');
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://pan.baidu.com/s/1ta0McyhY9knaD6FT5xW3Og?pwd=echo');
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://space.bilibili.com/25265128');
    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalledWith('https://afdian.com/a/echonext'));
    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalledWith('https://github.com/moekotori/echo/releases'));
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://qm.qq.com/q/KrJE8PIqSQ');
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://discord.gg/g7v4WMRq3K');
  });

  it('renders GitHub HTML release notes without exposing raw tags', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    getUpdateStatusMock.mockResolvedValue({
      bytesPerSecond: null,
      checkedAt: '2026-05-25T00:00:00.000Z',
      currentVersion: '26.5.24',
      downloadPercent: null,
      error: null,
      latestVersion: '26.5.25',
      releaseName: '26.5.25',
      releaseNotes:
        '<h1>ECHO Next Update</h1><p>Fix <strong>release notes</strong><br><a href="https://example.com/release">Read more</a><a href="javascript:alert(1)">bad</a><img src="https://example.com/preview.png" alt="preview"></p>',
      state: 'available',
      totalBytes: null,
      transferredBytes: null,
    });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.about\\.label');

    expect(await screen.findByRole('heading', { name: 'ECHO Next Update' })).toBeTruthy();
    expect(screen.queryByText(/<h1>/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Read more' }).getAttribute('href')).toBe('https://example.com/release');
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    expect(screen.getByAltText('preview').getAttribute('src')).toBe('https://example.com/preview.png');
  });

  it('toggles Safe mode from the About diagnostics section', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({ ...settings, safeModeEnabled: false });
    setSettingsMock.mockResolvedValue({ ...settings, safeModeEnabled: true });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.about\\.label');
    fireEvent.click(screen.getByRole('button', { name: /合作伙伴/ }));
    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalledWith('https://www.doubao.com/chat/'));
    const row = screen
      .getByText('持续开启后，每次启动会先打开异常记录器；只显示异常、渲染器错误、音频错误和慢启动阶段，不混入普通播放日志。')
      .closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { pressed: false }));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ safeModeEnabled: true }));
  });

  it('finds status aliases and jumps to the exact Discord presence row', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const searchInput = screen.getByPlaceholderText('settings.header.searchPlaceholder') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: '状态' } });
    fireEvent.click(screen.getByRole('option', { name: /settings\.integrations\.discord\.title/ }));

    expect(searchInput.value).toBe('');
    const row = screen.getByText('settings.integrations.discord.title').closest('.setting-row') as HTMLElement;
    expect(row.id).toBe('settings-row-discord-presence');
    expect(row.getAttribute('data-search-highlight')).toBe('true');
  });

  it('finds the plugin settings entry and highlights the stable plugin row', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const searchInput = screen.getByPlaceholderText('settings.header.searchPlaceholder') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'manifest' } });
    fireEvent.click(screen.getByRole('option', { name: /本地插件/ }));

    expect(searchInput.value).toBe('');
    const row = screen.getByText('本地插件').closest('.setting-row') as HTMLElement;
    expect(row.id).toBe('settings-row-plugins');
    expect(row.getAttribute('data-search-highlight')).toBe('true');
  });

  it('saves artist online info source choices from general settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({ ...settings, onlineArtistInfoSources: ['wikipedia'] });
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    await screen.findByText('艺人信息源');
    fireEvent.click(screen.getByRole('button', { name: /百度百科/ }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        onlineArtistInfoSources: ['baidu-baike'],
      }),
    );
  });

  it('saves artist streaming album source choices from general settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({ ...settings, artistStreamingAlbumsProvider: 'netease' });
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const row = document.querySelector('#settings-row-artist-streaming-albums') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /QQ/ }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        artistStreamingAlbumsProvider: 'qqmusic',
      }),
    );
  });

  it('saves online artist info provider settings from integrations', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.integrations\\.label');
    fireEvent.click(screen.getByRole('button', { name: '展开 API 配置' }));
    await screen.findByText('在线歌手信息');
    fireEvent.change(screen.getByLabelText('Bandsintown app_id'), { target: { value: ' echo-next ' } });
    fireEvent.change(screen.getByLabelText('Ticketmaster apikey'), { target: { value: ' ticketmaster-key ' } });
    fireEvent.change(screen.getByLabelText('SeatGeek client_id'), { target: { value: ' seatgeek-id ' } });
    fireEvent.change(screen.getByLabelText('地区过滤'), { target: { value: ' HK ' } });
    fireEvent.click(screen.getByRole('button', { name: /保存配置/ }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        onlineArtistInfoBandsintownAppId: 'echo-next',
        onlineArtistInfoTicketmasterApiKey: 'ticketmaster-key',
        onlineArtistInfoSeatGeekClientId: 'seatgeek-id',
        onlineArtistInfoRegion: 'HK',
      }),
    );
    expect(screen.getByText('在线歌手信息配置已保存。艺人页会按需后台加载简介和演出。')).toBeTruthy();
  });

  it('saves Discogs album rating token from integrations', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({ ...settings, onlineAlbumInfoDiscogsUserToken: 'old-token' });
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.integrations\\.label');
    fireEvent.click(screen.getByRole('button', { name: '展开 API 配置' }));
    await screen.findByText('Discogs 专辑评分');
    fireEvent.change(screen.getByLabelText('Discogs personal access token'), { target: { value: ' discogs-token ' } });
    fireEvent.click(screen.getByRole('button', { name: /保存 Discogs Token/ }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        onlineAlbumInfoDiscogsUserToken: 'discogs-token',
      }),
    );
    expect(screen.getByText('Discogs token 已保存。回到专辑页点“刷新在线信息”即可重拉评分。')).toBeTruthy();
  });

  it('remembers the account login panel collapse state from integrations', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.integrations\\.label');

    expect(screen.queryByLabelText('Spotify')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '展开账号登录' }));

    expect(window.localStorage.getItem('echo:settings:integrations:account-panel-expanded')).toBe('true');
    expect(screen.getByLabelText('Spotify')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '收起账号登录' }));

    expect(window.localStorage.getItem('echo:settings:integrations:account-panel-expanded')).toBe('false');
    expect(screen.queryByLabelText('Spotify')).toBeNull();
  });

  it('keeps developer API settings collapsed by default and remembers expansion', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.integrations\\.label');

    expect(screen.queryByText('Discogs 专辑评分')).toBeNull();
    expect(screen.queryByText('Spotify OAuth 配置')).toBeNull();
    expect(screen.queryByText('Last.fm')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '展开 API 配置' }));

    expect(window.localStorage.getItem('echo:settings:integrations:credential-panel-expanded')).toBe('true');
    expect(screen.getByText('Discogs 专辑评分')).toBeTruthy();
    expect(screen.getByText('Spotify OAuth 配置')).toBeTruthy();
    expect(screen.getByText('Last.fm')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '收起 API 配置' }));

    expect(window.localStorage.getItem('echo:settings:integrations:credential-panel-expanded')).toBe('false');
    expect(screen.queryByText('Discogs 专辑评分')).toBeNull();
    expect(screen.queryByText('Spotify OAuth 配置')).toBeNull();
    expect(screen.queryByText('Last.fm')).toBeNull();
  });

  it('clears online artist info cache from integrations', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearArtistOnlineInfoCacheMock.mockResolvedValue({ removedRows: 3 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.integrations\\.label');
    fireEvent.click(screen.getByRole('button', { name: '展开 API 配置' }));
    await screen.findByText('在线歌手信息');
    fireEvent.click(screen.getByRole('button', { name: /清理艺人资料缓存/ }));

    await waitFor(() => expect(clearArtistOnlineInfoCacheMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText('已清理 3 条在线歌手信息和演出缓存。')).toBeTruthy();
  });

  it('offers plugin actions from settings without duplicating the full manager', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const navigatePlugins = vi.fn();
    window.addEventListener('app:navigate:plugins', navigatePlugins);
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.plugins\\.label');
    fireEvent.click(screen.getByRole('button', { name: /打开插件页/ }));
    fireEvent.click(screen.getByRole('button', { name: /打开插件目录/ }));
    fireEvent.click(screen.getByRole('button', { name: /新建示例插件/ }));
    fireEvent.click(screen.getByRole('button', { name: /查看插件文档/ }));

    expect(navigatePlugins).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(openPluginDirectoryMock).toHaveBeenCalledTimes(1));
    expect(createPluginExampleMock).toHaveBeenCalledWith('playback-panel');
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://github.com/moekotori/echo/blob/main/docs/ECHO_NEXT_PLUGINS.md');
    window.removeEventListener('app:navigate:plugins', navigatePlugins);
  });

  it('documents the v1 plugin manifest, permissions, API, examples, and security boundaries', () => {
    const documentText = readFileSync(join(process.cwd(), 'docs', 'ECHO_NEXT_PLUGINS.md'), 'utf8');

    expect(documentText).toContain('echo.plugin.json');
    expect(documentText).toContain('## 权限');
    expect(documentText).toContain('## 公开 API');
    expect(documentText).toContain('## 示例模板');
    expect(documentText).toContain('## 安全边界');
  });

  it('finds lyrics settings when searching for translation', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    const searchInput = screen.getByPlaceholderText('settings.header.searchPlaceholder') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: '翻译' } });
    fireEvent.click(screen.getByRole('option', { name: /route\.lyricsSettings\.label/ }));

    expect(searchInput.value).toBe('');
    expect(screen.getByText('显示中文翻译')).toBeTruthy();
  });

  it('shows database protection health in danger settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.danger\\.label');

    await waitFor(() => expect(getDatabaseProtectionStatusMock).toHaveBeenCalledWith({ deepCheck: false }));
    expect(screen.getByText('曲库数据库安全')).toBeTruthy();
    expect(screen.getAllByText('健康').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /恢复最近健康快照/ })).toBeTruthy();
  });

  it('scans duplicate cleanup candidates before applying the cleanup', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    previewDuplicateTrackCleanupMock.mockResolvedValue({
      summary: {
        mode: 'strict',
        totalTracksScanned: 2,
        duplicateGroups: 1,
        duplicateMembers: 2,
        hiddenTracks: 1,
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
      groups: [
        {
          id: 'group-1',
          duplicateKey: 'song\u0000artist',
          confidence: 1,
          trackCount: 2,
          keep: {
            track: {
              id: 'track-keep',
              path: 'D:\\Music\\Song.flac',
              title: 'Song',
              artist: 'Artist',
              album: 'Album',
              albumArtist: 'Artist',
              trackNo: null,
              discNo: null,
              year: null,
              genre: null,
              duration: 180,
              codec: 'FLAC',
              sampleRate: 96000,
              bitDepth: 24,
              bitrate: 1800000,
              coverId: null,
              coverThumb: null,
              metadataStatus: 'ok',
              embeddedMetadataStatus: 'present',
              embeddedCoverStatus: 'missing',
              networkMetadataStatus: 'none',
              fieldSources: {},
            },
            qualityScore: 13000,
            rank: 1,
            sizeBytes: 100,
            reasons: [],
          },
          remove: [
            {
              track: {
                id: 'track-low',
                path: 'D:\\Music\\Song.mp3',
                title: 'Song',
                artist: 'Artist',
                album: 'Album',
                albumArtist: 'Artist',
                trackNo: null,
                discNo: null,
                year: null,
                genre: null,
                duration: 180,
                codec: 'MP3',
                sampleRate: 44100,
                bitDepth: null,
                bitrate: 192000,
                coverId: null,
                coverThumb: null,
                metadataStatus: 'ok',
                embeddedMetadataStatus: 'present',
                embeddedCoverStatus: 'missing',
                networkMetadataStatus: 'none',
                fieldSources: {},
              },
              qualityScore: 2500,
              rank: 2,
              sizeBytes: 50,
              reasons: [],
            },
          ],
        },
      ],
      removeTrackIds: ['track-low'],
      totalTracksToRemove: 1,
      totalBytesToRemove: 50,
      generatedAt: '2026-05-20T00:00:00.000Z',
    });
    applyDuplicateTrackCleanupMock.mockResolvedValue({
      requestedTrackIds: 1,
      trashedTracks: 1,
      missingFiles: 0,
      removedFromLibrary: 1,
      failedTracks: [],
      totalBytesRequested: 50,
      updatedSummary: {
        mode: 'strict',
        totalTracksScanned: 1,
        duplicateGroups: 0,
        duplicateMembers: 0,
        hiddenTracks: 0,
        updatedAt: '2026-05-20T00:00:01.000Z',
      },
    });
    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.danger\\.label');
    expect(applyDuplicateTrackCleanupMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /扫描重复歌曲/ }));

    await screen.findByText(/发现 1 组重复歌曲/);
    expect(screen.queryByText(/保留：FLAC/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /扫描结果明细/ }));
    expect(screen.getByText(/保留：FLAC/)).toBeTruthy();
    expect(screen.getByText(/清理：Song - Artist/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /清理扫描结果/ }));
    expect(applyDuplicateTrackCleanupMock).not.toHaveBeenCalled();
    expect(screen.getByText(/需要先在上方确认词输入框输入“清理重复歌曲”/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('危险操作确认词'), { target: { value: '清理重复歌曲' } });
    fireEvent.click(screen.getByRole('button', { name: /清理扫描结果/ }));

    await waitFor(() => expect(applyDuplicateTrackCleanupMock).toHaveBeenCalledWith({ mode: 'strict', trackIds: ['track-low'] }));
    expect(screen.getByText(/已移入回收站 1 首/)).toBeTruthy();
  });

  it('shows recovery steps for corrupt status and ignores wrong restore confirmation word', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    getDatabaseProtectionStatusMock.mockResolvedValue({
      ...healthyDatabaseProtectionStatus,
      health: {
        ...healthyDatabaseProtectionStatus.health,
        status: 'corrupt',
        message: 'database disk image is malformed',
      },
      recommendedAction: 'restore-snapshot',
    });
    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.danger\\.label');
    await screen.findByText('疑似损坏');

    fireEvent.change(screen.getByLabelText('危险操作确认词'), { target: { value: '取消' } });
    fireEvent.click(screen.getByRole('button', { name: /恢复最近健康快照/ }));

    expect(restoreDatabaseSnapshotMock).not.toHaveBeenCalled();
    expect(screen.getByText(/需要先在确认词输入框输入“恢复曲库”/)).toBeTruthy();
  });

  it('shows disaster recovery when no healthy snapshot can be restored', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    getDatabaseProtectionStatusMock.mockResolvedValue({
      ...healthyDatabaseProtectionStatus,
      health: {
        ...healthyDatabaseProtectionStatus.health,
        status: 'corrupt',
        message: 'database disk image is malformed',
      },
      latestHealthySnapshot: null,
      canRestoreSnapshot: false,
      recommendedAction: 'rebuild-empty-database',
      unrecoverableReason: '当前数据库不可用，且没有可恢复的健康快照。',
    });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.danger\\.label');

    await screen.findByText('疑似损坏');
    expect(screen.getByText(/数据库无法从健康快照恢复/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /归档坏库并重建空库/ })).toBeTruthy();
  });

  it('repairs a quarantined poisoned library through the scrub action', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    getDatabaseProtectionStatusMock.mockResolvedValueOnce({
      ...healthyDatabaseProtectionStatus,
      status: 'quarantined',
      reason: 'poisoned_metadata',
      archivePath: 'D:\\Echo\\data-protection\\corrupt-archives\\poisoned',
      latestArchive: {
        id: 'poisoned',
        path: 'D:\\Echo\\data-protection\\corrupt-archives\\poisoned',
        createdAt: '2026-05-20T00:00:00.000Z',
        reason: 'startup-poisoned-library',
        copied: ['echo-library.sqlite'],
        databasePath: 'D:\\Echo\\data-protection\\corrupt-archives\\poisoned\\echo-library.sqlite',
        databaseSizeBytes: 4096,
      },
      poisonReport: {
        status: 'poisoned',
        reason: 'poisoned_metadata',
        checkedAt: '2026-05-20T00:00:00.000Z',
        databasePath: 'D:\\Echo\\data-protection\\corrupt-archives\\poisoned\\echo-library.sqlite',
        suspectCounts: { 'tracks.title': 1 },
        maxFieldLengths: { 'tracks.title': 1000000 },
      },
      canScrubQuarantinedDatabase: true,
      recommendedAction: 'scrub-quarantined-database',
    }).mockResolvedValueOnce(healthyDatabaseProtectionStatus);
    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.danger\\.label');
    fireEvent.change(await screen.findByLabelText('危险操作确认词'), { target: { value: '修复隔离曲库' } });
    fireEvent.click(await screen.findByRole('button', { name: /修复隔离库副本/ }));

    await waitFor(() => expect(scrubQuarantinedDatabaseMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/已修复隔离曲库副本并恢复/)).toBeTruthy();
  });

  it('does not rebuild an unrecoverable database when the confirmation word is wrong', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    getDatabaseProtectionStatusMock.mockResolvedValue({
      ...healthyDatabaseProtectionStatus,
      health: {
        ...healthyDatabaseProtectionStatus.health,
        status: 'corrupt',
      },
      latestHealthySnapshot: null,
      canRestoreSnapshot: false,
      recommendedAction: 'rebuild-empty-database',
      unrecoverableReason: '当前数据库不可用，且没有可恢复的健康快照。',
    });
    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.danger\\.label');
    fireEvent.change(await screen.findByLabelText('危险操作确认词'), { target: { value: '取消' } });
    fireEvent.click(await screen.findByRole('button', { name: /归档坏库并重建空库/ }));

    expect(repairDatabaseMock).not.toHaveBeenCalled();
    expect(screen.getByText(/需要先在确认词输入框输入“重建空库”/)).toBeTruthy();
  });

  it('rebuilds an unrecoverable database after the exact confirmation word', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    const unrecoverableStatus: LibraryDatabaseProtectionStatus = {
      ...healthyDatabaseProtectionStatus,
      health: {
        ...healthyDatabaseProtectionStatus.health,
        status: 'corrupt',
      },
      latestHealthySnapshot: null,
      canRestoreSnapshot: false,
      recommendedAction: 'rebuild-empty-database',
      unrecoverableReason: '当前数据库不可用，且没有可恢复的健康快照。',
    };
    getDatabaseProtectionStatusMock.mockResolvedValueOnce(unrecoverableStatus).mockResolvedValueOnce({
      ...healthyDatabaseProtectionStatus,
      latestHealthySnapshot: null,
      canRestoreSnapshot: false,
    });
    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.danger\\.label');
    fireEvent.change(await screen.findByLabelText('危险操作确认词'), { target: { value: '重建空库' } });
    fireEvent.click(await screen.findByRole('button', { name: /归档坏库并重建空库/ }));

    await waitFor(() => expect(repairDatabaseMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getDatabaseProtectionStatusMock).toHaveBeenCalledTimes(2));
    expect(getDatabaseProtectionStatusMock).toHaveBeenNthCalledWith(1, { deepCheck: false });
    expect(getDatabaseProtectionStatusMock).toHaveBeenNthCalledWith(2, { deepCheck: true });
    expect(screen.getByText(/已归档坏库并重建为空库/)).toBeTruthy();
  });

  it('saves the dark theme from Settings and marks the selected chip', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    const darkButton = screen.getAllByRole('button', { name: /settings\.appearance\.theme\.dark/ })[0];
    fireEvent.click(darkButton);

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ appearanceTheme: 'dark' }));
    expect(darkButton.className).toContain('active');
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('saves the system theme from Settings and marks the selected chip', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    const systemButton = screen.getByRole('button', { name: /settings\.appearance\.theme\.followSystem/ });
    fireEvent.click(systemButton);

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ appearanceTheme: 'system' }));
    expect(systemButton.className).toContain('active');
    expect(document.documentElement.dataset.themeMode).toBe('system');
  });

  it('saves the Now Playing cover color opt-in from appearance controls', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    const row = screen.getByText('settings.appearance.nowPlayingCoverColor.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ nowPlayingCoverColorEnabled: true }));
  });

  it('saves the window acrylic opt-in and offers to relaunch for the window material change', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    getSettingsMock.mockResolvedValue(settings);
    let currentSettings = settings;
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => {
      currentSettings = { ...currentSettings, ...patch };
      return currentSettings;
    });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    const row = screen.getByText('settings.appearance.windowAcrylic.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ appWindowAcrylicEnabled: true }));
    expect(confirmSpy).toHaveBeenCalledWith('settings.appearance.windowAcrylic.restartConfirm');
    expect(relaunchAppMock).toHaveBeenCalledTimes(1);

    const transparencySlider = within(row).getByRole('slider') as HTMLInputElement;
    fireEvent.change(transparencySlider, { target: { value: '100' } });
    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ appWindowAcrylicTransparencyPercent: 100 }));

    const keepWhenUnfocusedToggle = within(row)
      .getByText('settings.appearance.windowAcrylic.keepWhenUnfocused')
      .parentElement
      ?.querySelector('button') as HTMLButtonElement;
    fireEvent.click(keepWhenUnfocusedToggle);
    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ appWindowAcrylicKeepWhenUnfocusedEnabled: true }));
  });

  it('saves The Dark Side of the Moon theme preset from Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    expandThemePresetGrid();
    const presetButton = (await screen.findByText('settings.appearance.themePreset.darkSideMoon')).closest('button') as HTMLButtonElement;
    fireEvent.click(presetButton);

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ appearanceThemePreset: 'darkSideMoon' }));
    expect(presetButton.className).toContain('active');
    expect(document.documentElement.dataset.themePreset).toBe('darkSideMoon');
  });

  it('locks the FINAL theme preset until the exact new key is entered in settings search', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    expandThemePresetGrid();

    const lockedPresetButton = (await screen.findByText('settings.appearance.themePreset.FINAL')).closest('button') as HTMLButtonElement;
    expect(lockedPresetButton.disabled).toBe(true);
    expect(screen.getByText('需持有FINAL耳机解锁主题')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('settings.header.searchPlaceholder'), { target: { value: 'finalaudio' } });

    await waitFor(() => expect(lockedPresetButton.disabled).toBe(true));

    fireEvent.change(screen.getByPlaceholderText('settings.header.searchPlaceholder'), { target: { value: ' FINAL-8K-7Q4M-H2ND-2026 ' } });

    await waitFor(() => expect(lockedPresetButton.disabled).toBe(true));

    fireEvent.change(screen.getByPlaceholderText('settings.header.searchPlaceholder'), { target: { value: 'FINAL-8K-7Q4M-H2ND-2026' } });

    const presetButton = (await screen.findByText('settings.appearance.themePreset.FINAL')).closest('button') as HTMLButtonElement;
    await waitFor(() => expect(presetButton.disabled).toBe(false));
    expect(window.localStorage.getItem('echo-next:settings:final-theme-unlocked')).toBe('2026-06-final-key-v2');

    fireEvent.click(presetButton);

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ appearanceThemePreset: 'FINAL', finalThemeUnlockVersion: '2026-06-final-key-v2' }));
    expect(document.documentElement.dataset.themePreset).toBe('FINAL');
  });

  it('relocks an old FINAL theme unlock on the new key version', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const finalSettings: AppSettings = { ...settings, appearanceThemePreset: 'FINAL' };
    window.localStorage.setItem('echo-next:settings:final-theme-unlocked', 'true');
    getSettingsMock.mockResolvedValue(finalSettings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...finalSettings, ...patch }));
    resetSettingsMock.mockResolvedValue(finalSettings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ appearanceThemePreset: 'classic', appearanceThemeCustomId: null, finalThemeUnlockVersion: null }));
    expect(document.documentElement.dataset.themePreset).toBe('classic');
  });

  it('creates a custom theme, saves a color, and clears it when a built-in preset is selected', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    let currentSettings: AppSettings = { ...settings, appearanceThemePreset: 'classic', appearanceCustomThemes: [], appearanceThemeCustomId: null };
    getSettingsMock.mockResolvedValue(currentSettings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => {
      currentSettings = { ...currentSettings, ...patch };
      return currentSettings;
    });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.expand/ }));
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.action\.create/ }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          appearanceThemeCustomId: expect.any(String),
          appearanceThemePreset: 'classic',
          appearanceCustomThemes: expect.arrayContaining([
            expect.objectContaining({
              basePreset: 'classic',
              name: '我的主题 1',
            }),
          ]),
        }),
      ),
    );

    fireEvent.change(screen.getByLabelText('settings.appearance.themeCustom.field.accent'), { target: { value: '#123456' } });
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.action\.save/ }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          appearanceCustomThemes: expect.arrayContaining([
            expect.objectContaining({
              light: expect.objectContaining({ accent: '#123456' }),
            }),
          ]),
        }),
      ),
    );

    expandThemePresetGrid();
    const presetButton = (await screen.findByText('settings.appearance.themePreset.darkSideMoon')).closest('button') as HTMLButtonElement;
    fireEvent.click(presetButton);

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ appearanceThemePreset: 'darkSideMoon', appearanceThemeCustomId: null }));
  });

  it('generates a readable random theme draft and only saves it after confirmation', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
    let currentSettings: AppSettings = { ...settings, appearanceThemePreset: 'classic', appearanceCustomThemes: [], appearanceThemeCustomId: null };
    getSettingsMock.mockResolvedValue(currentSettings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => {
      currentSettings = { ...currentSettings, ...patch };
      return currentSettings;
    });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    expandThemePresetGrid();
    setSettingsMock.mockClear();
    const randomButton = (await screen.findByText('settings.appearance.themePreset.random')).closest('button') as HTMLButtonElement;
    fireEvent.click(randomButton);

    expect(setSettingsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.expand/ }));
    expect(await screen.findByText('settings.appearance.themeCustom.message.randomReady')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.action\.save/ }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          appearanceThemePreset: 'classic',
          appearanceThemeCustomId: expect.any(String),
          appearanceCustomThemes: expect.arrayContaining([
            expect.objectContaining({
              basePreset: 'classic',
              name: 'settings.appearance.themePreset.random',
            }),
          ]),
        }),
      ),
    );

    const randomPatch = setSettingsMock.mock.calls.find(([patch]) => {
      const nextPatch = patch as Partial<AppSettings>;
      return nextPatch.appearanceCustomThemes?.some((theme) => theme.name === 'settings.appearance.themePreset.random');
    })?.[0] as Partial<AppSettings>;
    const randomTheme = randomPatch.appearanceCustomThemes?.find((theme) => theme.name === 'settings.appearance.themePreset.random');
    expect(randomTheme?.light).toBeTruthy();
    expect(randomTheme?.dark).toBeTruthy();
    expectReadableThemeTone(randomTheme?.light ?? {});
    expectReadableThemeTone(randomTheme?.dark ?? {});
    expect(document.documentElement.dataset.themeCustomId).toBe(randomTheme?.id);
  });

  it('imports and applies an enabled plugin theme preset as a custom theme', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    let currentSettings: AppSettings = { ...settings, appearanceThemePreset: 'classic', appearanceCustomThemes: [], appearanceThemeCustomId: null };
    listPluginsMock.mockResolvedValue({ directory: 'D:\\Echo\\plugins', plugins: [createThemePluginSummary()] });
    getSettingsMock.mockResolvedValue(currentSettings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => {
      currentSettings = { ...currentSettings, ...patch };
      return currentSettings;
    });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.expand/ }));
    const pluginThemeButton = (await screen.findByText('Aurora Glass')).closest('button') as HTMLButtonElement;
    fireEvent.click(pluginThemeButton);

    let importedThemeId = '';
    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          appearanceThemePreset: 'classic',
          appearanceThemeCustomId: expect.stringMatching(/^plugin:[a-z0-9]{7,8}:aurora-glass$/),
          appearanceCustomThemes: expect.arrayContaining([
            expect.objectContaining({
              id: expect.stringMatching(/^plugin:[a-z0-9]{7,8}:aurora-glass$/),
              name: 'Aurora Glass · Aurora Theme',
              basePreset: 'classic',
              light: expect.objectContaining({ accent: '#257f96', glassPercent: 26 }),
              dark: expect.objectContaining({ accent: '#5cc8dc', motionIntensityPercent: 90 }),
            }),
          ]),
        }),
      ),
    );
    const importPatch = setSettingsMock.mock.calls.find(([patch]) => (patch as Partial<AppSettings>).appearanceThemeCustomId)?.[0] as Partial<AppSettings>;
    importedThemeId = importPatch.appearanceThemeCustomId ?? '';
    expect(importedThemeId.length).toBeLessThanOrEqual(80);
    expect(document.documentElement.dataset.themeCustomId).toBe(importedThemeId);
  });

  it('keeps advanced theme customization fields folded by default', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    expect(screen.getByLabelText('settings.appearance.themeCustom.field.accent').closest('[hidden]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.expand/ }));
    const titlebarInput = screen.getByLabelText('settings.appearance.themeCustom.field.titlebar') as HTMLInputElement;
    expect(titlebarInput.closest('[hidden]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.advanced\.show/ }));

    await waitFor(() => expect(titlebarInput.closest('[hidden]')).toBeNull());
  });

  it('switches, renames, duplicates, and deletes a custom theme', async () => {
    const customTheme = {
      id: 'theme-safe',
      name: 'Safe Theme',
      basePreset: 'nyanCat' as const,
      light: { accent: '#ff66aa' },
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    };
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue('Renamed Theme');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let currentSettings: AppSettings = {
      ...settings,
      appearanceThemePreset: 'classic',
      appearanceCustomThemes: [customTheme],
      appearanceThemeCustomId: null,
    };
    getSettingsMock.mockResolvedValue(currentSettings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => {
      currentSettings = { ...currentSettings, ...patch };
      return currentSettings;
    });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.expand/ }));
    fireEvent.click(screen.getByRole('button', { name: /Safe Theme/ }));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ appearanceThemePreset: 'nyanCat', appearanceThemeCustomId: 'theme-safe' }));

    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.action\.rename/ }));
    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        appearanceCustomThemes: expect.arrayContaining([expect.objectContaining({ id: 'theme-safe', name: 'Renamed Theme' })]),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.action\.duplicate/ }));
    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          appearanceThemePreset: 'nyanCat',
          appearanceThemeCustomId: expect.any(String),
          appearanceCustomThemes: expect.arrayContaining([expect.objectContaining({ name: expect.stringContaining('Copy') })]),
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.themeCustom\.action\.delete/ }));
    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          appearanceThemeCustomId: null,
          appearanceThemePreset: 'nyanCat',
        }),
      ),
    );
  });

  it('saves the artist wall album artwork setting and announces settings changes', async () => {
    const settingsChanged = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockResolvedValue({ ...settings, artistWallAlbumArtwork: true });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    getDownloadSettingsMock.mockResolvedValue(downloadSettings);
    chooseDownloadOutputDirectoryMock.mockResolvedValue({ ...downloadSettings, outputDirectory: 'E:\\Music Downloads' });
    window.addEventListener('settings:changed', settingsChanged);

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.library\\.label');
    const row = screen.getByRole('heading', { name: /艺术家墙封面/ }).closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ artistWallAlbumArtwork: true }));
    expect(settingsChanged).toHaveBeenCalledTimes(1);

    window.removeEventListener('settings:changed', settingsChanged);
  });

  it('saves the native file scanner experiment toggle from library settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({ ...settings, nativeFileScannerEnabled: false });
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    getDownloadSettingsMock.mockResolvedValue(downloadSettings);

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.library\\.label');
    const row = screen.getByRole('heading', { name: /Native File Scanner/ }).closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ nativeFileScannerEnabled: true }));
    expect(scanFolderMock).not.toHaveBeenCalled();
  });

  it('saves the native metadata reader experiment toggle from library settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({ ...settings, nativeMetadataReaderEnabled: false });
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    getDownloadSettingsMock.mockResolvedValue(downloadSettings);

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.library\\.label');
    const row = screen.getByRole('heading', { name: /Native Metadata Reader/ }).closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ nativeMetadataReaderEnabled: true }));
    expect(scanFolderMock).not.toHaveBeenCalled();
  });

  it('saves the missing artist avatar album fallback setting', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    getDownloadSettingsMock.mockResolvedValue(downloadSettings);

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.library\\.label');
    const row = screen.getByRole('heading', { name: 'settings.appearance.artistAvatars.title' }).closest('.setting-row') as HTMLElement;
    const fallbackToggle = within(
      within(row).getByText('settings.appearance.artistAvatars.fallback').closest('.settings-inline-toggle') as HTMLElement,
    ).getByRole('button');
    fireEvent.click(fallbackToggle);

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ artistWallAlbumFallbackForMissingAvatars: true }));
  });

  it('starts library scans as queued jobs and shows aggregate progress in Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    getFoldersMock.mockResolvedValue([
      { id: 'folder-a', path: 'D:\\Music\\A', name: 'A', status: 'active', createdAt: '2026-05-29T00:00:00.000Z', updatedAt: '2026-05-29T00:00:00.000Z' },
      { id: 'folder-b', path: 'D:\\Music\\B', name: 'B', status: 'active', createdAt: '2026-05-29T00:00:00.000Z', updatedAt: '2026-05-29T00:00:00.000Z' },
    ]);
    scanFolderMock.mockImplementation(async (folderId: string): Promise<LibraryScanStatus> => ({
      id: `scan-${folderId}`,
      folderId,
      status: folderId === 'folder-a' ? 'running' : 'queued',
      phase: folderId === 'folder-a' ? 'reading_metadata' : 'queued',
      totalFiles: 100,
      processedFiles: folderId === 'folder-a' ? 25 : 0,
      skippedFiles: 3,
      addedTracks: 0,
      updatedTracks: 0,
      removedTracks: 0,
      coverCount: 0,
      errorCount: 1,
      errors: [],
      startedAt: '2026-05-29T00:00:00.000Z',
      finishedAt: null,
    }));
    getScanStatusMock.mockImplementation(async (jobId: string): Promise<LibraryScanStatus> => {
      const folderId = jobId.replace(/^scan-/, '');
      return {
        id: jobId,
        folderId,
        status: folderId === 'folder-a' ? 'running' : 'queued',
        phase: folderId === 'folder-a' ? 'reading_metadata' : 'queued',
        totalFiles: 100,
        processedFiles: folderId === 'folder-a' ? 25 : 0,
        skippedFiles: 3,
        addedTracks: 0,
        updatedTracks: 0,
        removedTracks: 0,
        coverCount: 0,
        errorCount: 1,
        errors: [],
        startedAt: '2026-05-29T00:00:00.000Z',
        finishedAt: null,
      };
    });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.library\\.label');
    fireEvent.click(screen.getByRole('button', { name: '扫描曲库' }));

    await waitFor(() => expect(scanFolderMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('已加入 2 个曲库文件夹到扫描队列。')).toBeTruthy();
    expect(await screen.findByText('曲库扫描进度')).toBeTruthy();
    expect(screen.getByText(/扫描进度：25\/200，跳过 6，错误 2。当前 读取元数据/)).toBeTruthy();
  });

  it('starts missing artist avatar fetching immediately when automatic fetching is enabled', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({ ...settings, autoFetchArtistImages: false, artistImageFetchPaused: true });
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.library\\.label');
    const row = screen.getByRole('heading', { name: 'settings.appearance.artistAvatars.title' }).closest('.setting-row') as HTMLElement;
    const autoFetchToggle = within(
      within(row).getByText('settings.appearance.artistAvatars.toggle').closest('.settings-inline-toggle') as HTMLElement,
    ).getByRole('button');
    fireEvent.click(autoFetchToggle);

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        autoFetchArtistImages: true,
        artistImageFetchPaused: false,
      }),
    );
    expect(kickoffArtistImageBackfillMock).toHaveBeenCalledWith({ force: false, limit: 500 });
    expect(await screen.findByText('settings.appearance.artistAvatars.message.queued')).toBeTruthy();
  });

  it('chooses the download folder from Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({ ...settings, downloadsFeatureUnlocked: true });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    getDownloadSettingsMock.mockResolvedValue(downloadSettings);
    chooseDownloadOutputDirectoryMock.mockResolvedValue({ ...downloadSettings, outputDirectory: 'E:\\Music Downloads' });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.library\\.label');
    expect(await screen.findByText('D:\\Downloads')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '更换文件夹' }));

    await waitFor(() => expect(chooseDownloadOutputDirectoryMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('E:\\Music Downloads')).toBeTruthy();
    expect(screen.getByText('下载路径已更新。')).toBeTruthy();
  });

  it('hides streaming download actions in Settings until downloads are unlocked', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({ ...settings, downloadsFeatureUnlocked: false, streamingDownloadActionsEnabled: false });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.library\\.label');

    expect(screen.queryByRole('heading', { name: /流媒体下载按钮/ })).toBeNull();
  });

  it('toggles streaming download actions from Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({ ...settings, downloadsFeatureUnlocked: true, streamingDownloadActionsEnabled: false });
    setSettingsMock.mockResolvedValue({ ...settings, downloadsFeatureUnlocked: true, streamingDownloadActionsEnabled: true });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.library\\.label');
    const row = screen.getByRole('heading', { name: /流媒体下载按钮/ }).closest('.setting-row') as HTMLElement;
    expect(within(row).getByText('已隐藏')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { pressed: false }));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ streamingDownloadActionsEnabled: true }));
  });

  it('saves the lyrics player bar drawer setting from Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockResolvedValue({ ...settings, lyricsPlayerBarDrawerEnabled: true });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('route.lyricsSettings.label')[0]);
    expect(screen.queryByText('Lyrics Engine')).toBeNull();
    fireEvent.click(await screen.findByRole('checkbox', { name: /迷你底栏/ }));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ lyricsPlayerBarDrawerEnabled: true }));
  });

  it('saves synced MV settings from Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('route.mvSettings.label')[0]);

    const autoSearchToggle = screen.getByText('mvSettings.network.autoApply').closest('.settings-inline-toggle') as HTMLElement;
    fireEvent.click(within(autoSearchToggle).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ mvAutoSearch: false }));

    fireEvent.click(screen.getByRole('button', { name: '4K' }));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ mvMaxQuality: '2160p' }));
  });

  it('maps MV drawer settings events into the Settings page state', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('route.mvSettings.label')[0]);
    const autoSearchToggle = screen.getByText('mvSettings.network.autoApply').closest('.settings-inline-toggle') as HTMLElement;
    expect(within(autoSearchToggle).getByRole('button').getAttribute('aria-pressed')).toBe('true');

    window.dispatchEvent(
      new CustomEvent('settings:changed', {
        detail: { autoSearch: false, maxQuality: '2160p' } satisfies Partial<MvSettings>,
      }),
    );

    await waitFor(() => expect(within(autoSearchToggle).getByRole('button').getAttribute('aria-pressed')).toBe('false'));
    expect(screen.getByRole('button', { name: '4K' }).className).toContain('active');
  });

  it('shows volume balancing controls and starts missing loudness analysis', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({
      ...settings,
      gaplessPlaybackEnabled: false,
      replayGainEnabled: false,
      replayGainMode: 'track',
      replayGainTargetLufs: -14,
      replayGainPreampDb: 0,
      replayGainPreventClipping: true,
      replayGainAnalyzeOnPlay: true,
      replayGainAnalyzeMissingOnScan: false,
    });
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    startReplayGainAnalysisMock.mockResolvedValue({
      id: 'replay-gain-job',
      status: 'running',
      totalTracks: 2,
      processedTracks: 0,
      updatedTracks: 0,
      errorCount: 0,
    });
    getReplayGainAnalysisStatusMock.mockResolvedValue({
      id: 'replay-gain-job',
      status: 'completed',
      totalTracks: 2,
      processedTracks: 2,
      updatedTracks: 2,
      errorCount: 0,
    });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.playback.label')[0]);
    fireEvent.click(screen.getByRole('button', { name: /settings\.playback\.advancedPanel\.action\.expand/u }));

    const gaplessRow = document.querySelector('#settings-row-gapless-playback') as HTMLElement;
    fireEvent.click(within(gaplessRow).getByRole('button'));

    const row = document.querySelector('#settings-row-volume-balance') as HTMLElement;
    fireEvent.click(row.querySelector('.settings-replay-gain-toggle button') as HTMLButtonElement);
    fireEvent.click(row.querySelector('.settings-replay-gain-advanced-toggle') as HTMLButtonElement);
    fireEvent.click(row.querySelectorAll('.settings-replay-gain-toggles .settings-inline-toggle button')[1] as HTMLButtonElement);
    fireEvent.click(row.querySelectorAll('.settings-replay-gain-mode button')[1] as HTMLButtonElement);
    fireEvent.click(document.querySelector('#settings-row-mono-audio button') as HTMLButtonElement);

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ gaplessPlaybackEnabled: true }));
    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ replayGainEnabled: true, replayGainAnalyzeOnPlay: true }));
    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ replayGainAnalyzeOnPlay: false }));
    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ replayGainMode: 'album' }));
    await waitFor(() => expect(setChannelBalanceStateMock).toHaveBeenCalledWith({ enabled: true, monoMode: 'sum' }));
    await waitFor(() => expect(startReplayGainAnalysisMock).toHaveBeenCalledWith({ limit: 500 }));
    expect(await within(row).findByText('2/2')).toBeTruthy();
  });

  it('keeps HQPlayer controls out of Playback settings because Connect owns that surface', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue({ ...settings, hqPlayer: hqPlayerSettings });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.playback.label')[0]);

    expect(screen.queryByText('settings.playback.hqplayer.title')).toBeNull();
    expect(hqPlayerTestConnectionMock).not.toHaveBeenCalled();
    expect(hqPlayerSetSettingsMock).not.toHaveBeenCalled();
    expect(audioSetOutputMock).not.toHaveBeenCalled();
  });

  it('does not start audio device/status work when first entering Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    expect(audioGetStatusMock).not.toHaveBeenCalled();
    expect(audioListDevicesMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByText('settings.nav.playback.label')[0]);

    await waitFor(() => expect(audioGetStatusMock).toHaveBeenCalled());
    await waitFor(() => expect(audioListDevicesMock).toHaveBeenCalled());
  });

  it('records and enables a global playback shortcut from Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.shortcuts.label')[0]);
    const row = screen.getByText('settings.shortcuts.action.playPause.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(getShortcutScope(row, 'global')).getByRole('button', { name: 'settings.shortcuts.action.record' }));
    fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, altKey: true });

    const expectedShortcuts = {
      ...createDefaultGlobalShortcuts(),
      playPause: { enabled: false, accelerator: 'Ctrl+Alt+Space' },
    };
    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ globalShortcuts: expectedShortcuts }));

    setSettingsMock.mockClear();
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({
      ...settings,
      globalShortcuts: expectedShortcuts,
      ...patch,
    }));
    fireEvent.click(within(getShortcutScope(row, 'global')).getByRole('button', { pressed: false }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        globalShortcuts: {
          ...expectedShortcuts,
          playPause: { enabled: true, accelerator: 'Ctrl+Alt+Space' },
        },
      }),
    );
  });

  it('renders shortcut settings when saved settings are missing a newer shortcut action', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const legacyLocalShortcuts = { ...createDefaultLocalShortcuts() } as Partial<ReturnType<typeof createDefaultLocalShortcuts>>;
    const legacyGlobalShortcuts = { ...createDefaultGlobalShortcuts() } as Partial<ReturnType<typeof createDefaultGlobalShortcuts>>;
    delete legacyLocalShortcuts.toggleDesktopLyricsLock;
    delete legacyGlobalShortcuts.toggleDesktopLyricsLock;
    getSettingsMock.mockResolvedValue({
      ...settings,
      localShortcuts: legacyLocalShortcuts,
      globalShortcuts: legacyGlobalShortcuts,
    } as AppSettings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.shortcuts.label')[0]);

    expect(screen.getByText('settings.shortcuts.action.toggleDesktopLyricsLock.title')).toBeTruthy();
  });

  it('records a single-key global shortcut from Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.shortcuts.label')[0]);
    const row = screen.getByText('settings.shortcuts.action.previousTrack.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(getShortcutScope(row, 'global')).getByRole('button', { name: 'settings.shortcuts.action.record' }));
    fireEvent.keyDown(window, { code: 'F13', key: 'F13' });

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        globalShortcuts: {
          ...createDefaultGlobalShortcuts(),
          previousTrack: { enabled: false, accelerator: 'F13' },
        },
      }),
    );
  });

  it('records and enables a focused-window shortcut from Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.shortcuts.label')[0]);
    const row = screen.getByText('settings.shortcuts.action.nextTrack.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(getShortcutScope(row, 'local')).getByRole('button', { name: 'settings.shortcuts.action.record' }));
    fireEvent.keyDown(window, { code: 'KeyD', key: 'd' });

    const expectedShortcuts = {
      ...createDefaultLocalShortcuts(),
      nextTrack: { enabled: false, accelerator: 'D' },
    };
    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ localShortcuts: expectedShortcuts }));

    setSettingsMock.mockClear();
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({
      ...settings,
      localShortcuts: expectedShortcuts,
      ...patch,
    }));
    fireEvent.click(within(getShortcutScope(row, 'local')).getByRole('button', { pressed: false }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        localShortcuts: {
          ...expectedShortcuts,
          nextTrack: { enabled: true, accelerator: 'D' },
        },
      }),
    );
  });

  it('records a mouse side button global shortcut from Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.shortcuts.label')[0]);
    const row = screen.getByText('settings.shortcuts.action.nextTrack.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(getShortcutScope(row, 'global')).getByRole('button', { name: 'settings.shortcuts.action.record' }));
    fireEvent.mouseDown(window, { button: 3 });

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        globalShortcuts: {
          ...createDefaultGlobalShortcuts(),
          nextTrack: { enabled: false, accelerator: 'MouseButton4' },
        },
      }),
    );
  });

  it('records mouse side buttons from auxclick events and exposes playback speed shortcuts', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.shortcuts.label')[0]);
    expect(screen.getByText('settings.shortcuts.action.speedUp.title')).toBeTruthy();
    expect(screen.getByText('settings.shortcuts.action.speedDown.title')).toBeTruthy();

    const row = screen.getByText('settings.shortcuts.action.speedUp.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(getShortcutScope(row, 'global')).getByRole('button', { name: 'settings.shortcuts.action.record' }));
    fireEvent(window, new MouseEvent('auxclick', { button: 4, bubbles: true, cancelable: true }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        globalShortcuts: {
          ...createDefaultGlobalShortcuts(),
          speedUp: { enabled: false, accelerator: 'MouseButton5' },
        },
      }),
    );
  });

  it('records the plus key as a valid global shortcut token', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.shortcuts.label')[0]);
    const row = screen.getByText('settings.shortcuts.action.speedUp.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(getShortcutScope(row, 'global')).getByRole('button', { name: 'settings.shortcuts.action.record' }));
    fireEvent.keyDown(window, { code: 'Equal', key: '+', ctrlKey: true, altKey: true, shiftKey: true });

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        globalShortcuts: {
          ...createDefaultGlobalShortcuts(),
          speedUp: { enabled: false, accelerator: 'Ctrl+Alt+Shift+Plus' },
        },
      }),
    );
  });

  it('records numpad digits as distinct global shortcut tokens', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.shortcuts.label')[0]);
    const row = screen.getByText('settings.shortcuts.action.speedUp.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(getShortcutScope(row, 'global')).getByRole('button', { name: 'settings.shortcuts.action.record' }));
    fireEvent.keyDown(window, { code: 'Numpad1', key: '1', ctrlKey: true, altKey: true });

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        globalShortcuts: {
          ...createDefaultGlobalShortcuts(),
          speedUp: { enabled: false, accelerator: 'Ctrl+Alt+num1' },
        },
      }),
    );
  });

  it('records browser navigation keys without rewriting them to mouse buttons', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.shortcuts.label')[0]);
    const row = screen.getByText('settings.shortcuts.action.previousTrack.title').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(getShortcutScope(row, 'global')).getByRole('button', { name: 'settings.shortcuts.action.record' }));
    fireEvent.keyDown(window, { code: 'BrowserBack', key: 'BrowserBack' });

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        globalShortcuts: {
          ...createDefaultGlobalShortcuts(),
          previousTrack: { enabled: false, accelerator: 'BrowserBack' },
        },
      }),
    );
  });

  it('restores recommended local and global shortcuts', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.shortcuts.label')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'settings.shortcuts.action.restoreRecommended' }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        localShortcuts: createRecommendedLocalShortcuts(),
        globalShortcuts: createRecommendedGlobalShortcuts(),
      }),
    );
  });

  it('syncs the playback output select from the active device name when the host has no device id', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    audioGetStatusMock.mockResolvedValue({
      ...playbackStatus,
      outputDeviceName: 'USB DAC B',
    });
    audioListDevicesMock.mockResolvedValue([
      {
        id: 'shared-a',
        index: 0,
        name: 'USB DAC A',
        outputMode: 'shared',
        sampleRate: 48000,
        sharedDeviceSampleRate: 48000,
        isDefault: true,
      },
      {
        id: 'shared-b',
        index: 1,
        name: 'USB DAC B',
        outputMode: 'shared',
        sampleRate: 96000,
        sharedDeviceSampleRate: 96000,
        isDefault: false,
      },
    ]);

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.playback.label')[0]);

    expect(await screen.findByText('1 - USB DAC B')).toBeTruthy();
  });

  it('shows the professional playback status panel in playback settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });
    audioGetStatusMock.mockResolvedValue({
      ...playbackStatus,
      outputDeviceName: 'USB DAC B',
      fileSampleRate: 96000,
      actualDeviceSampleRate: 96000,
      bitPerfectCandidate: true,
      replayGainEnabled: true,
      replayGainMode: 'track',
      replayGainAppliedDb: -2.5,
    });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.playback.label')[0]);
    fireEvent.click(screen.getByRole('button', { name: /settings\.playback\.advancedPanel\.action\.expand/u }));

    fireEvent.click(screen.getByRole('button', { name: 'audioProfessional.action.showDetails' }));

    expect(await screen.findByText('audioProfessional.title')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'audioProfessional.action.showDetails' }));
    expect(screen.getByText('audioProfessional.group.playbackChain')).toBeTruthy();
    expect(screen.getByText('audioProfessional.group.sampleRate')).toBeTruthy();
    expect(screen.queryByText(/^fileSampleRate$/u)).toBeNull();
  });

  it('keeps advanced playback settings collapsed by default and remembers expansion', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.playback.label')[0]);

    expect(screen.queryByText('settings.playback.troubleshooting.title')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /settings\.playback\.advancedPanel\.action\.expand/u }));

    expect(window.localStorage.getItem('echo:settings:playback:advanced-panel-expanded')).toBe('true');
    expect(screen.getByText('settings.playback.troubleshooting.title')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /settings\.playback\.advancedPanel\.action\.collapse/u }));

    expect(window.localStorage.getItem('echo:settings:playback:advanced-panel-expanded')).toBe('false');
    expect(screen.queryByText('settings.playback.troubleshooting.title')).toBeNull();
  });

  it('copies audio diagnostics from playback settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.playback.label')[0]);
    fireEvent.click(screen.getByRole('button', { name: /settings\.playback\.advancedPanel\.action\.expand/u }));
    fireEvent.click(screen.getByRole('button', { name: 'audioProfessional.action.showDetails' }));
    fireEvent.click(await screen.findByRole('button', { name: /audioDrawer\.action\.copyDiagnostics/ }));

    await waitFor(() => expect(audioGetDiagnosticsMock).toHaveBeenCalledTimes(1));
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('ECHO Next Audio Diagnostics'));
  });

  it('resets the audio engine from playback settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.playback.label')[0]);
    fireEvent.click(screen.getByRole('button', { name: /settings\.playback\.advancedPanel\.action\.expand/u }));
    const resetButton = await screen.findByRole('button', { name: 'settings.playback.troubleshooting.softAction' });
    fireEvent.click(resetButton);

    await waitFor(() => expect(audioForceRestartMock).toHaveBeenCalledWith('settings-audio-force-restart'));
    expect(await screen.findByText('settings.playback.troubleshooting.softDone')).toBeTruthy();
  });

  it('confirms before restarting the Windows audio service from playback settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.playback.label')[0]);
    fireEvent.click(screen.getByRole('button', { name: /settings\.playback\.advancedPanel\.action\.expand/u }));
    const restartButton = await screen.findByRole('button', { name: 'settings.playback.troubleshooting.hardAction' });
    fireEvent.click(restartButton);

    expect(confirmSpy).toHaveBeenCalledWith('settings.playback.troubleshooting.hardConfirm');
    await waitFor(() => expect(audioRestartWindowsAudioServiceMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('settings.playback.troubleshooting.hardDone')).toBeTruthy();
  });

  it('hides Windows-only playback and integration controls on Linux', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    setNavigatorPlatform('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)');
    getSettingsMock.mockResolvedValue(settings);
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.playback.label')[0]);
    expect(screen.queryByText('settings.playback.outputMode.exclusive')).toBeNull();
    expect(screen.queryByText('settings.playback.outputMode.asio')).toBeNull();
    expect(screen.getByText('settings.playback.sharedBackend.title')).toBeTruthy();
    expect(screen.getByText('settings.playback.sharedBackend.alsa')).toBeTruthy();
    expect(screen.queryByText('settings.playback.sharedBackend.directSound')).toBeNull();
    expect(screen.queryByRole('button', { name: 'settings.playback.troubleshooting.hardAction' })).toBeNull();

    fireEvent.click(screen.getAllByText('settings.nav.integrations.label')[0]);
    expect(screen.queryByText('settings.integrations.smtc.title')).toBeNull();
    expect(screen.queryByText('settings.integrations.taskbarPlayback.title')).toBeNull();
  });

  it('saves the startup account check setting from Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockResolvedValue({ ...settings, autoAccountCheckOnStartup: false });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.integrations.label')[0]);
    const row = screen.getByText('启动时刷新账号登录状态').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ autoAccountCheckOnStartup: false }));
  });

  it('saves the account expiry notice suppression setting from Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    setSettingsMock.mockResolvedValue({ ...settings, suppressAccountExpiryNotices: true });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    fireEvent.click(screen.getAllByText('settings.nav.integrations.label')[0]);
    const row = screen.getByText('关闭账号失效通知').closest('.setting-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));

    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith({ suppressAccountExpiryNotices: true }));
  });

  it('shows app wallpaper controls only after choosing a custom background', async () => {
    const wallpaperPath = 'D:\\Echo\\app-wallpapers\\wallpaper.png';
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    chooseAppWallpaperMock.mockResolvedValue(wallpaperPath);
    setSettingsMock.mockResolvedValue({ ...settings, appCustomWallpaperPath: wallpaperPath });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    expect(screen.queryByText('settings.appearance.wallpaper.scale')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.wallpaper\.choose/ }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        appCustomWallpaperPath: wallpaperPath,
        appWallpaperMediaType: 'image',
      }),
    );
    expect(await screen.findByText('settings.appearance.wallpaper.scale')).toBeTruthy();
    expect(screen.getByText('settings.appearance.wallpaper.blur')).toBeTruthy();
    expect(screen.getByText('settings.appearance.wallpaper.brightness')).toBeTruthy();
    expect(screen.getByText('settings.appearance.wallpaper.uiOpacity')).toBeTruthy();
    expect(screen.getByText('settings.appearance.wallpaper.unifiedOpacity')).toBeTruthy();
  });

  it('saves a portrait app wallpaper separately from the landscape background', async () => {
    const wallpaperPath = 'D:\\Echo\\app-wallpapers\\portrait.webp';
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    chooseAppWallpaperMock.mockResolvedValue(wallpaperPath);
    setSettingsMock.mockResolvedValue({
      ...settings,
      appPortraitWallpaperPath: wallpaperPath,
      appPortraitWallpaperMediaType: 'image',
    });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.wallpaper\.portraitChoose/ }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        appPortraitWallpaperPath: wallpaperPath,
        appPortraitWallpaperMediaType: 'image',
      }),
    );
    expect(await screen.findByText('settings.appearance.wallpaper.portraitPath')).toBeTruthy();
    expect(screen.queryByText('settings.appearance.wallpaper.landscapePath')).toBeNull();
  });

  it('enables video wallpaper controls after choosing a portrait video background', async () => {
    const wallpaperPath = 'D:\\Echo\\app-wallpapers\\portrait-motion.webm';
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    chooseAppWallpaperMock.mockResolvedValue(wallpaperPath);
    setSettingsMock.mockResolvedValue({
      ...settings,
      appPortraitWallpaperPath: wallpaperPath,
      appPortraitWallpaperMediaType: 'video',
      appVideoWallpaperPauseMode: 'never',
    });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.wallpaper\.portraitChoose/ }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        appPortraitWallpaperPath: wallpaperPath,
        appPortraitWallpaperMediaType: 'video',
        appVideoWallpaperPauseMode: 'never',
      }),
    );
    expect(await screen.findByText('settings.appearance.wallpaper.videoStatus')).toBeTruthy();
    expect(screen.getByRole('button', { name: /settings\.appearance\.wallpaper\.videoPause\.never/ })).toBeTruthy();
  });

  it('shows video wallpaper performance mode after choosing a local video background', async () => {
    const wallpaperPath = 'D:\\Echo\\app-wallpapers\\motion.mp4';
    Element.prototype.scrollIntoView = vi.fn();
    getSettingsMock.mockResolvedValue(settings);
    chooseAppWallpaperMock.mockResolvedValue(wallpaperPath);
    setSettingsMock.mockResolvedValue({
      ...settings,
      appCustomWallpaperPath: wallpaperPath,
      appWallpaperMediaType: 'video',
      appVideoWallpaperPauseMode: 'never',
    });
    resetSettingsMock.mockResolvedValue(settings);
    clearCacheMock.mockResolvedValue({ scannedCount: 0, removedCount: 0, deletedCoverCacheFiles: 0, freedCoverCacheBytes: 0 });

    render(<SettingsPage />);

    await screen.findByText('route.settings.label');
    clickSettingsNav('settings\\.nav\\.appearance\\.label');
    fireEvent.click(screen.getByRole('button', { name: /settings\.appearance\.wallpaper\.choose/ }));

    await waitFor(() =>
      expect(setSettingsMock).toHaveBeenCalledWith({
        appCustomWallpaperPath: wallpaperPath,
        appWallpaperMediaType: 'video',
        appVideoWallpaperPauseMode: 'never',
      }),
    );
    expect(await screen.findByText('settings.appearance.wallpaper.videoStatus')).toBeTruthy();
    expect(screen.getByRole('button', { name: /settings\.appearance\.wallpaper\.videoPause\.smart/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /settings\.appearance\.wallpaper\.videoPause\.minimized/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /settings\.appearance\.wallpaper\.videoPause\.never/ })).toBeTruthy();
  });
});
