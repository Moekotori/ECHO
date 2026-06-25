import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IpcChannels } from '../shared/constants/ipcChannels';
import type { EchoApi } from './apiTypes';
import type { AudioStatus, AudioDiagnostics, AudioDeviceInfo, AudioSessionResetEvent, AudioOutputSettings, AudioExportRequest, AudioExportResult, ChannelBalanceState } from '../shared/types/audio';
import type { AppSettings, NetworkProxyTestResult } from '../shared/types/appSettings';
import type { GlobalShortcutAction } from '../shared/types/globalShortcuts';
import type {
  PlaybackMediaStartRequest,
  PlaybackStartRequest,
  PlaybackStatus,
  LocalFileResolveResult,
  PersistedPlaybackSessionV1,
  PlaybackQueueSessionSaveOptions,
  PlaybackPrepareLocalFileRequest,
} from '../shared/types/playback';
import type { SmtcCommand, SmtcLyricsProgress, SmtcDiagnostics } from '../shared/types/smtc';
import type { UpdateStatus } from '../shared/types/updates';
import type { DiagnosticConsoleEntry, DiagnosticMemoryPressureEvent } from '../shared/types/diagnostics';
import type { DataBackupProgress } from '../shared/types/settingsBackup';
import type { SleepTimerStatus, SleepTimerStartRequest } from '../shared/types/sleepTimer';
import type { RoomCorrectionState } from '../shared/types/eq';

const sanitizePathList = (paths: unknown): string[] =>
  Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : [];

const localAudioFileOpenHandlers = new Set<(paths: string[]) => void>();
const pendingLocalAudioFileOpenEvents: string[][] = [];
type AutomixAdvancePayload = {
  fromTrackId: string | null;
  toTrackId: string;
  transitionSeconds: number;
  mode?: 'smartCrossfade' | 'beatAligned' | 'energyFade' | 'gaplessFallback';
  fallbackReason?: string | null;
  beatAligned?: boolean;
  skipIntroSilence?: boolean;
  nextStartSeconds?: number;
};
const automixAdvanceHandlers = new Set<(event: AutomixAdvancePayload) => void>();

const rendererSearchParams = new URLSearchParams(typeof window.location?.search === 'string' ? window.location.search : '');
const isMainPlaybackRenderer =
  rendererSearchParams.get('miniPlayer') !== '1' && rendererSearchParams.get('desktopLyrics') !== '1';
const playbackProxyCommands = new Set(['playLocalFile', 'playMediaItem', 'play', 'pause', 'stop', 'seek']);
type MainPlaybackCommand = 'playLocalFile' | 'playMediaItem' | 'play' | 'pause' | 'stop' | 'seek';

ipcRenderer.on(IpcChannels.PlaybackLocalAudioFilesOpened, (_event: Electron.IpcRendererEvent, paths: unknown): void => {
  const safePaths = sanitizePathList(paths);
  if (safePaths.length === 0) {
    return;
  }

  if (localAudioFileOpenHandlers.size === 0) {
    pendingLocalAudioFileOpenEvents.push(safePaths);
    return;
  }

  for (const handler of localAudioFileOpenHandlers) {
    handler(safePaths);
  }
});

ipcRenderer.on(IpcChannels.PlaybackAutomixAdvance, (_event: Electron.IpcRendererEvent, payload: unknown): void => {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const event = payload as {
    fromTrackId?: unknown;
    toTrackId?: unknown;
    transitionSeconds?: unknown;
    mode?: unknown;
    fallbackReason?: unknown;
    beatAligned?: unknown;
    skipIntroSilence?: unknown;
    nextStartSeconds?: unknown;
  };
  if (typeof event.toTrackId !== 'string') {
    return;
  }

  for (const handler of automixAdvanceHandlers) {
    handler({
      fromTrackId: typeof event.fromTrackId === 'string' ? event.fromTrackId : null,
      toTrackId: event.toTrackId,
      transitionSeconds: typeof event.transitionSeconds === 'number' && Number.isFinite(event.transitionSeconds)
        ? event.transitionSeconds
        : 0,
      mode: event.mode === 'smartCrossfade' || event.mode === 'beatAligned' || event.mode === 'energyFade' || event.mode === 'gaplessFallback'
        ? event.mode
        : undefined,
      fallbackReason: typeof event.fallbackReason === 'string' ? event.fallbackReason : null,
      beatAligned: event.beatAligned === true,
      skipIntroSilence: event.skipIntroSilence === true,
      nextStartSeconds: typeof event.nextStartSeconds === 'number' && Number.isFinite(event.nextStartSeconds)
        ? event.nextStartSeconds
        : undefined,
    });
  }
});

const echoApi: EchoApi & {
  playback: EchoApi['playback'] & {
    setVolume: (vol: number) => Promise<unknown>;
    next: () => Promise<unknown>;
    previous: () => Promise<unknown>;
  };
  audio: EchoApi['audio'] & {
    command: (method: string, params?: unknown) => Promise<unknown>;
    on: (event: string, cb: (data: unknown) => void) => () => void;
  };
} = {
  app: {
    getVersion: () => ipcRenderer.invoke(IpcChannels.AppGetVersion),
    minimize: () => ipcRenderer.invoke(IpcChannels.AppWindowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IpcChannels.AppWindowToggleMaximize),
    isMaximized: () => ipcRenderer.invoke(IpcChannels.AppWindowIsMaximized),
    onMaximizedChange: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: unknown): void => {
        handler(isMaximized === true);
      };
      ipcRenderer.on(IpcChannels.AppWindowMaximizedChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AppWindowMaximizedChanged, listener);
    },
    toggleFullscreen: () => ipcRenderer.invoke(IpcChannels.AppWindowToggleFullscreen),
    triggerFullscreenShortcut: () => ipcRenderer.invoke(IpcChannels.AppWindowTriggerFullscreenShortcut),
    isFullscreen: () => ipcRenderer.invoke(IpcChannels.AppWindowIsFullscreen),
    onFullscreenChange: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, isFullscreen: unknown): void => {
        handler(isFullscreen === true);
      };
      ipcRenderer.on(IpcChannels.AppWindowFullscreenChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AppWindowFullscreenChanged, listener);
    },
    close: () => ipcRenderer.invoke(IpcChannels.AppWindowClose),
    quit: () => ipcRenderer.invoke(IpcChannels.AppQuit),
    getSystemUserName: () => ipcRenderer.invoke(IpcChannels.AppGetSystemUserName),
    getSettings: () => ipcRenderer.invoke(IpcChannels.AppGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.AppSetSettings, patch),
    getTaskbarPlaybackStatus: () => ipcRenderer.invoke(IpcChannels.AppGetTaskbarPlaybackStatus),
    resetSettings: () => ipcRenderer.invoke(IpcChannels.AppResetSettings),
    exportSettings: () => ipcRenderer.invoke(IpcChannels.AppExportSettings),
    importSettings: () => ipcRenderer.invoke(IpcChannels.AppImportSettings),
    exportDataPackage: () => ipcRenderer.invoke(IpcChannels.AppExportDataPackage),
    chooseDataBackupDirectory: () => ipcRenderer.invoke(IpcChannels.AppChooseDataBackupDirectory),
    getDataBackupStatus: () => ipcRenderer.invoke(IpcChannels.AppGetDataBackupStatus),
    onDataBackupProgress: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown): void => {
        if (progress) {
          handler(progress as DataBackupProgress);
        }
      };
      ipcRenderer.on(IpcChannels.AppDataBackupProgress, listener);
      return () => ipcRenderer.off(IpcChannels.AppDataBackupProgress, listener);
    },
    runDataBackupNow: () => ipcRenderer.invoke(IpcChannels.AppRunDataBackupNow),
    importDataBackup: () => ipcRenderer.invoke(IpcChannels.AppImportDataBackup),
    openDataBackupDirectory: () => ipcRenderer.invoke(IpcChannels.AppOpenDataBackupDirectory),
    chooseFontFile: () => ipcRenderer.invoke(IpcChannels.AppChooseFontFile),
    chooseLyricsWallpaper: () => ipcRenderer.invoke(IpcChannels.AppChooseLyricsWallpaper),
    chooseAppWallpaper: () => ipcRenderer.invoke(IpcChannels.AppChooseAppWallpaper),
    loadFontFile: (path) => ipcRenderer.invoke(IpcChannels.AppLoadFontFile, path),
    chooseCacheDirectory: () => ipcRenderer.invoke(IpcChannels.AppChooseCacheDirectory),
    getDefaultCacheDirectory: () => ipcRenderer.invoke(IpcChannels.AppGetDefaultCacheDirectory),
    getCacheInventory: () => ipcRenderer.invoke(IpcChannels.AppGetCacheInventory),
    setCoverCacheDirectory: (request) => ipcRenderer.invoke(IpcChannels.AppSetCoverCacheDirectory, request),
    getUpdateStatus: () => ipcRenderer.invoke(IpcChannels.AppGetUpdateStatus),
    checkForUpdates: () => ipcRenderer.invoke(IpcChannels.AppCheckForUpdates),
    onUpdateStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as UpdateStatus);
      };
      ipcRenderer.on(IpcChannels.AppUpdateStatusChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AppUpdateStatusChanged, listener);
    },
    openRepository: () => ipcRenderer.invoke(IpcChannels.AppOpenRepository),
    openExternalUrl: (url) => ipcRenderer.invoke(IpcChannels.AppOpenExternalUrl, url),
    showTouchKeyboard: () => ipcRenderer.invoke(IpcChannels.AppShowTouchKeyboard),
    testNetworkProxy: (patch) =>
      patch === undefined ? ipcRenderer.invoke(IpcChannels.AppTestNetworkProxy) : ipcRenderer.invoke(IpcChannels.AppTestNetworkProxy, patch),
    getEchoProAccountStatus: (options) =>
      options === undefined
        ? ipcRenderer.invoke(IpcChannels.AppEchoProAccountGetStatus)
        : ipcRenderer.invoke(IpcChannels.AppEchoProAccountGetStatus, options),
    loginEchoProAccount: (credentials) => ipcRenderer.invoke(IpcChannels.AppEchoProAccountLogin, credentials),
    registerEchoProAccount: (credentials) => ipcRenderer.invoke(IpcChannels.AppEchoProAccountRegister, credentials),
    logoutEchoProAccount: () => ipcRenderer.invoke(IpcChannels.AppEchoProAccountLogout),
    redeemEchoProKey: (key) => ipcRenderer.invoke(IpcChannels.AppEchoProAccountRedeemKey, key),
    releaseEchoProDevices: (password) => ipcRenderer.invoke(IpcChannels.AppEchoProAccountReleaseDevices, password),
    getEchoProMachineCode: () => ipcRenderer.invoke(IpcChannels.AppEchoProMachineCodeGet),
    getEchoProSettingsCloudStatus: () => ipcRenderer.invoke(IpcChannels.AppEchoProSettingsCloudGetStatus),
    saveEchoProSettingsCloud: () => ipcRenderer.invoke(IpcChannels.AppEchoProSettingsCloudSave),
    pullEchoProSettingsCloud: () => ipcRenderer.invoke(IpcChannels.AppEchoProSettingsCloudPull),
    applyEchoProSettingsCloud: () => ipcRenderer.invoke(IpcChannels.AppEchoProSettingsCloudApply),
    validateGlobalShortcut: (accelerator) => ipcRenderer.invoke(IpcChannels.AppValidateGlobalShortcut, accelerator),
    onGlobalShortcutCommand: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, action: unknown): void => {
        handler(action as GlobalShortcutAction);
      };
      ipcRenderer.on(IpcChannels.AppGlobalShortcutCommand, listener);
      return () => ipcRenderer.off(IpcChannels.AppGlobalShortcutCommand, listener);
    },
  },
  desktopLyrics: {
    show: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsShow),
    hide: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsHide),
    getState: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsGetState),
    setLocked: (locked) => ipcRenderer.invoke(IpcChannels.DesktopLyricsSetLocked, locked),
    setStyle: (patch) => ipcRenderer.invoke(IpcChannels.DesktopLyricsSetStyle, patch),
    resetBounds: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsResetBounds),
    revealMenu: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsRevealMenu),
    setMousePassthrough: (passthrough) => {
      ipcRenderer.send(IpcChannels.DesktopLyricsSetMousePassthrough, passthrough);
    },
    publishAudioStatus: (status) => {
      ipcRenderer.send(IpcChannels.DesktopLyricsRendererAudioStatus, status);
    },
    publishPlaybackStatus: (status) => {
      ipcRenderer.send(IpcChannels.DesktopLyricsRendererPlaybackStatus, status);
    },
    getLastAudioStatus: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsGetLastAudioStatus),
    getLastPlaybackStatus: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsGetLastPlaybackStatus),
    onStateChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown): void => {
        handler(state as Awaited<ReturnType<EchoApi['desktopLyrics']['getState']>>);
      };
      ipcRenderer.on(IpcChannels.DesktopLyricsStateChanged, listener);
      return () => ipcRenderer.off(IpcChannels.DesktopLyricsStateChanged, listener);
    },
    onRevealMenu: (handler) => {
      const listener = (): void => {
        handler();
      };
      ipcRenderer.on(IpcChannels.DesktopLyricsRevealMenu, listener);
      return () => ipcRenderer.off(IpcChannels.DesktopLyricsRevealMenu, listener);
    },
    onAudioStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as AudioStatus);
      };
      ipcRenderer.on(IpcChannels.DesktopLyricsAudioStatus, listener);
      return () => ipcRenderer.off(IpcChannels.DesktopLyricsAudioStatus, listener);
    },
    onPlaybackStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as NonNullable<Awaited<ReturnType<EchoApi['desktopLyrics']['getLastPlaybackStatus']>>>);
      };
      ipcRenderer.on(IpcChannels.DesktopLyricsPlaybackStatus, listener);
      return () => ipcRenderer.off(IpcChannels.DesktopLyricsPlaybackStatus, listener);
    },
  },
  miniPlayer: {
    show: () => ipcRenderer.invoke(IpcChannels.MiniPlayerShow),
    hide: (options) =>
      options === undefined
        ? ipcRenderer.invoke(IpcChannels.MiniPlayerHide)
        : ipcRenderer.invoke(IpcChannels.MiniPlayerHide, options),
    getState: () => ipcRenderer.invoke(IpcChannels.MiniPlayerGetState),
    setLocked: (locked) => ipcRenderer.invoke(IpcChannels.MiniPlayerSetLocked, locked),
    setQueueOpen: (open) => ipcRenderer.invoke(IpcChannels.MiniPlayerSetQueueOpen, open),
    resetBounds: () => ipcRenderer.invoke(IpcChannels.MiniPlayerResetBounds),
    onStateChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown): void => {
        handler(state as Awaited<ReturnType<EchoApi['miniPlayer']['getState']>>);
      };
      ipcRenderer.on(IpcChannels.MiniPlayerStateChanged, listener);
      return () => ipcRenderer.off(IpcChannels.MiniPlayerStateChanged, listener);
    },
  },
  library: {
    chooseFolder: () => ipcRenderer.invoke(IpcChannels.LibraryChooseFolder),
    chooseImportFiles: () => ipcRenderer.invoke(IpcChannels.LibraryChooseImportFiles),
    addFolder: (path) => ipcRenderer.invoke(IpcChannels.LibraryAddFolder, path),
    classifyImportPaths: (paths) => ipcRenderer.invoke(IpcChannels.LibraryClassifyImportPaths, paths),
    importDroppedFiles: async (files) => {
      const payload = await Promise.all(
        Array.from(files ?? []).map(async (file) => {
          const path = webUtils?.getPathForFile(file) || null;
          return {
            name: file.name,
            type: file.type,
            path,
            bytes: path ? null : new Uint8Array(await file.arrayBuffer()),
          };
        }),
      );
      return ipcRenderer.invoke(IpcChannels.LibraryImportDroppedFiles, payload);
    },
    importAudioFiles: (paths) => ipcRenderer.invoke(IpcChannels.LibraryImportAudioFiles, paths),
    getFolders: () => ipcRenderer.invoke(IpcChannels.LibraryGetFolders),
    getFolderOverviews: () => ipcRenderer.invoke(IpcChannels.LibraryGetFolderOverviews),
    getFolderChildren: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetFolderChildren, query),
    getFolderTracks: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetFolderTracks, query),
    openLibraryFolderPath: (request) => ipcRenderer.invoke(IpcChannels.LibraryOpenLibraryFolderPath, request),
    removeFolder: (folderId) => ipcRenderer.invoke(IpcChannels.LibraryRemoveFolder, folderId),
    scanFolder: (folderId, options) => ipcRenderer.invoke(IpcChannels.LibraryScanFolder, folderId, options),
    scanFolderChanges: (folderId) => ipcRenderer.invoke(IpcChannels.LibraryScanFolderChanges, folderId),
    rescanEmbeddedTags: (mode, options) => ipcRenderer.invoke(IpcChannels.LibraryRescanEmbeddedTags, mode, options),
    getScanStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryGetScanStatus, jobId),
    cancelScan: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryCancelScan, jobId),
    getTrack: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryGetTrack, trackId),
    getTracks: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetTracks, query),
    getLibraryQualityOverview: () => ipcRenderer.invoke(IpcChannels.LibraryGetQualityOverview),
    getLibraryQualityIssues: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetQualityIssues, query),
    getLibraryInboxBatches: () => ipcRenderer.invoke(IpcChannels.LibraryGetInboxBatches),
    getLibraryInboxTracks: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetInboxTracks, query),
    createPlaylistFromLibraryInbox: (request) => ipcRenderer.invoke(IpcChannels.LibraryCreateInboxPlaylist, request),
    addLibraryInboxToQueue: (query) => ipcRenderer.invoke(IpcChannels.LibraryAddInboxToQueue, query),
    updateLibraryInboxItemState: (request) => ipcRenderer.invoke(IpcChannels.LibraryUpdateInboxItemState, request),
    getHealthReport: () => ipcRenderer.invoke(IpcChannels.LibraryGetHealthReport),
    exportHealthReport: () => ipcRenderer.invoke(IpcChannels.LibraryExportHealthReport),
    refreshDuplicateTracks: (mode) => ipcRenderer.invoke(IpcChannels.LibraryRefreshDuplicateTracks, mode),
    getDuplicateTrackVersions: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryGetDuplicateTrackVersions, trackId),
    getDuplicateHiddenCounts: (trackIds, mode) => ipcRenderer.invoke(IpcChannels.LibraryGetDuplicateHiddenCounts, trackIds, mode),
    getDuplicateIndexSummary: (mode) => ipcRenderer.invoke(IpcChannels.LibraryGetDuplicateIndexSummary, mode),
    previewDuplicateTrackCleanup: (mode) => ipcRenderer.invoke(IpcChannels.LibraryPreviewDuplicateTrackCleanup, mode),
    applyDuplicateTrackCleanup: (request) => ipcRenderer.invoke(IpcChannels.LibraryApplyDuplicateTrackCleanup, request),
    getPlaylists: () => ipcRenderer.invoke(IpcChannels.LibraryGetPlaylists),
    createPlaylist: (request) => ipcRenderer.invoke(IpcChannels.LibraryCreatePlaylist, request),
    createSmartPlaylist: (request) => ipcRenderer.invoke(IpcChannels.LibraryCreateSmartPlaylist, request),
    updatePlaylist: (request) => ipcRenderer.invoke(IpcChannels.LibraryUpdatePlaylist, request),
    deletePlaylist: (playlistId) => ipcRenderer.invoke(IpcChannels.LibraryDeletePlaylist, playlistId),
    getPlaylist: (playlistId) => ipcRenderer.invoke(IpcChannels.LibraryGetPlaylist, playlistId),
    getPlaylistItems: (playlistId, query) => ipcRenderer.invoke(IpcChannels.LibraryGetPlaylistItems, playlistId, query),
    importPlaylistFile: () => ipcRenderer.invoke(IpcChannels.LibraryImportPlaylistFile),
    exportPlaylist: (request) => ipcRenderer.invoke(IpcChannels.LibraryExportPlaylist, request),
    addTrackToPlaylist: (playlistId, trackId) => ipcRenderer.invoke(IpcChannels.LibraryAddTrackToPlaylist, playlistId, trackId),
    addStreamingTrackToPlaylist: (playlistId, track) => ipcRenderer.invoke(IpcChannels.LibraryAddStreamingTrackToPlaylist, playlistId, track),
    addTracksToPlaylist: (playlistId, trackIds) => ipcRenderer.invoke(IpcChannels.LibraryAddTracksToPlaylist, playlistId, trackIds),
    addLocalAudioFilesToPlaylist: (playlistId, paths) => ipcRenderer.invoke(IpcChannels.LibraryAddLocalAudioFilesToPlaylist, playlistId, paths),
    removePlaylistItem: (itemId) => ipcRenderer.invoke(IpcChannels.LibraryRemovePlaylistItem, itemId),
    movePlaylistItem: (playlistId, itemId, targetPosition) =>
      ipcRenderer.invoke(IpcChannels.LibraryMovePlaylistItem, playlistId, itemId, targetPosition),
    clearPlaylist: (playlistId) => ipcRenderer.invoke(IpcChannels.LibraryClearPlaylist, playlistId),
    getLikedSongsPlaylist: () => ipcRenderer.invoke(IpcChannels.LibraryGetLikedSongsPlaylist),
    getLikedAlbumsPlaylist: () => ipcRenderer.invoke(IpcChannels.LibraryGetLikedAlbumsPlaylist),
    getLikedTracks: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetLikedTracks, query),
    getLikedAlbums: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetLikedAlbums, query),
    isTrackLiked: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryIsTrackLiked, trackId),
    isAlbumLiked: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryIsAlbumLiked, albumId),
    getLikedTrackIds: (trackIds) => ipcRenderer.invoke(IpcChannels.LibraryGetLikedTrackIds, trackIds),
    getLikedAlbumIds: (albumIds) => ipcRenderer.invoke(IpcChannels.LibraryGetLikedAlbumIds, albumIds),
    likeTrack: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryLikeTrack, trackId),
    unlikeTrack: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryUnlikeTrack, trackId),
    toggleTrackLiked: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryToggleTrackLiked, trackId),
    likeAlbum: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryLikeAlbum, albumId),
    unlikeAlbum: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryUnlikeAlbum, albumId),
    toggleAlbumLiked: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryToggleAlbumLiked, albumId),
    clearLikedTracks: (query) => ipcRenderer.invoke(IpcChannels.LibraryClearLikedTracks, query),
    clearLikedAlbums: (query) => ipcRenderer.invoke(IpcChannels.LibraryClearLikedAlbums, query),
    getAlbums: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetAlbums, query),
    getAlbum: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryGetAlbum, albumId),
    getAlbumOnlineInfo: (albumId, options) => ipcRenderer.invoke(IpcChannels.LibraryGetAlbumOnlineInfo, albumId, options),
    getAlbumForTrack: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryGetAlbumForTrack, trackId),
    getArtists: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetArtists, query),
    getArtist: (artistId) => ipcRenderer.invoke(IpcChannels.LibraryGetArtist, artistId),
    getArtistInsights: (artistId, options) => ipcRenderer.invoke(IpcChannels.LibraryGetArtistInsights, artistId, options),
    getArtistTracks: (artistId, query) => ipcRenderer.invoke(IpcChannels.LibraryGetArtistTracks, artistId, query),
    getArtistAlbums: (artistId, query) => ipcRenderer.invoke(IpcChannels.LibraryGetArtistAlbums, artistId, query),
    clearArtistOnlineInfoCache: () => ipcRenderer.invoke(IpcChannels.LibraryArtistOnlineInfoClearCache),
    enqueueMissingArtistImages: (request) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesEnqueueMissing, request),
    refreshArtistImage: (artistId, force) =>
      ipcRenderer.invoke(IpcChannels.LibraryArtistImagesRefreshOne, { artistId, force }),
    refreshVisibleArtistImages: (artists) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesRefreshVisible, artists),
    getArtistImageStatus: (artistId) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesGetStatus, artistId),
    getArtistImageCacheSummary: () => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesGetSummary),
    getArtistImageJobStatus: () => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesGetJobStatus),
    setArtistImageJobsPaused: (paused) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesSetPaused, paused),
    kickoffArtistImageBackfill: (options) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesKickoff, options),
    clearArtistImageCache: () => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesClearCache),
    chooseArtistAvatar: (artistId) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesChooseCustom, artistId),
    setArtistAvatarFromUrl: (artistId, url) =>
      ipcRenderer.invoke(IpcChannels.LibraryArtistImagesSetCustomUrl, { artistId, url }),
    clearCustomArtistAvatar: (artistId) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesClearCustom, artistId),
    onArtistImagesUpdated: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        handler(payload as { artistId: string | null; artistKey: string; status: string });
      };
      ipcRenderer.on(IpcChannels.LibraryArtistImagesUpdated, listener);
      return () => ipcRenderer.off(IpcChannels.LibraryArtistImagesUpdated, listener);
    },
    onLibraryChanged: (handler) => {
      const listener = (): void => {
        handler();
      };
      ipcRenderer.on(IpcChannels.LibraryChanged, listener);
      return () => ipcRenderer.off(IpcChannels.LibraryChanged, listener);
    },
    onLikedTracksChanged: (handler) => {
      const listener = (): void => {
        handler();
      };
      ipcRenderer.on(IpcChannels.LibraryLikedTracksChanged, listener);
      return () => ipcRenderer.off(IpcChannels.LibraryLikedTracksChanged, listener);
    },
    getAlbumTracks: (albumId, query) => ipcRenderer.invoke(IpcChannels.LibraryGetAlbumTracks, albumId, query),
    getSummary: () => ipcRenderer.invoke(IpcChannels.LibraryGetSummary),
    refreshAlbumGrouping: () => ipcRenderer.invoke(IpcChannels.LibraryRefreshAlbumGrouping),
    getDiagnostics: () => ipcRenderer.invoke(IpcChannels.LibraryGetDiagnostics),
    getMoveCandidates: (options) => ipcRenderer.invoke(IpcChannels.LibraryGetMoveCandidates, options),
    chooseTrackCover: () => ipcRenderer.invoke(IpcChannels.LibraryChooseTrackCover),
    loadEmbeddedTrackTags: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryLoadEmbeddedTrackTags, trackId),
    updateTrackTags: (request) => ipcRenderer.invoke(IpcChannels.LibraryUpdateTrackTags, request),
    updateAlbumTags: (request) => ipcRenderer.invoke(IpcChannels.LibraryUpdateAlbumTags, request),
    recordTrackPlayback: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryRecordTrackPlayback, trackId),
    getPlaybackHistory: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetPlaybackHistory, query),
    getPlaybackHistorySummary: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetPlaybackHistorySummary, query),
    getPlaybackStatsDashboard: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetPlaybackStatsDashboard, query),
    getPlaybackMemoryGraph: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetPlaybackMemoryGraph, query),
    refreshInvalidPlaybackHistory: () => ipcRenderer.invoke(IpcChannels.LibraryRefreshInvalidPlaybackHistory),
    deletePlaybackHistoryEntry: (id) => ipcRenderer.invoke(IpcChannels.LibraryDeletePlaybackHistoryEntry, id),
    clearPlaybackHistory: () => ipcRenderer.invoke(IpcChannels.LibraryClearPlaybackHistory),
    startPlaybackHistory: (request) => ipcRenderer.invoke(IpcChannels.LibraryStartPlaybackHistory, request),
    finishPlaybackHistory: (request) => ipcRenderer.invoke(IpcChannels.LibraryFinishPlaybackHistory, request),
    openTrackInFolder: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryOpenTrackInFolder, trackId),
    openPathInFolder: (path) => ipcRenderer.invoke(IpcChannels.LibraryOpenPathInFolder, path),
    openTrackWithSystem: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryOpenTrackWithSystem, trackId),
    copyTrackPath: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryCopyTrackPath, trackId),
    copyTrackNameArtist: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryCopyTrackNameArtist, trackId),
    copyTrackCover: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryCopyTrackCover, trackId),
    copyTrackOriginalCover: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryCopyTrackOriginalCover, trackId),
    saveTrackCover: (trackId) => ipcRenderer.invoke(IpcChannels.LibrarySaveTrackCover, trackId),
    deleteTrackFile: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryDeleteTrackFile, trackId),
    copyAlbumInfo: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryCopyAlbumInfo, albumId),
    copyAlbumCover: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryCopyAlbumCover, albumId),
    saveAlbumCover: (albumId) => ipcRenderer.invoke(IpcChannels.LibrarySaveAlbumCover, albumId),
    deleteAlbumFiles: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryDeleteAlbumFiles, albumId),
    pruneMissingTracks: () => ipcRenderer.invoke(IpcChannels.LibraryPruneMissingTracks),
    pruneInvalidTracks: () => ipcRenderer.invoke(IpcChannels.LibraryPruneInvalidTracks),
    clearTracks: () => ipcRenderer.invoke(IpcChannels.LibraryClearTracks),
    clearCache: () => ipcRenderer.invoke(IpcChannels.LibraryClearCache),
    repairDatabase: () => ipcRenderer.invoke(IpcChannels.LibraryRepairDatabase),
    deleteDatabase: () => ipcRenderer.invoke(IpcChannels.LibraryDeleteDatabase),
    deleteAllUserData: () => ipcRenderer.invoke(IpcChannels.LibraryDeleteAllUserData),
    getDatabaseProtectionStatus: (options) => ipcRenderer.invoke(IpcChannels.LibraryGetDatabaseProtectionStatus, options),
    createDatabaseSnapshot: () => ipcRenderer.invoke(IpcChannels.LibraryCreateDatabaseSnapshot),
    restoreDatabaseSnapshot: (snapshotId) => ipcRenderer.invoke(IpcChannels.LibraryRestoreDatabaseSnapshot, snapshotId),
    scrubQuarantinedDatabase: () => ipcRenderer.invoke(IpcChannels.LibraryScrubQuarantinedDatabase),
    discardQuarantinedProblemTracks: () => ipcRenderer.invoke(IpcChannels.LibraryDiscardQuarantinedProblemTracks),
    relaunchRecoveryMode: () => ipcRenderer.invoke(IpcChannels.LibraryRelaunchRecoveryMode),
    openDataProtectionFolder: () => ipcRenderer.invoke(IpcChannels.LibraryOpenDataProtectionFolder),
    repairMissingMetadata: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryNetworkRepairMissingMetadata, trackId),
    scanMissingMetadata: (options) => ipcRenderer.invoke(IpcChannels.LibraryNetworkScanMissingMetadata, options),
    startMissingMetadataScan: (options) => ipcRenderer.invoke(IpcChannels.LibraryNetworkStartMissingMetadataScan, options),
    getMissingMetadataScanStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryNetworkGetMissingMetadataScanStatus, jobId),
    startMissingCoverBackfill: (options) => ipcRenderer.invoke(IpcChannels.LibraryNetworkStartMissingCoverBackfill, options),
    getMissingCoverBackfillStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryNetworkGetMissingCoverBackfillStatus, jobId),
    getActiveMissingCoverBackfillStatus: () => ipcRenderer.invoke(IpcChannels.LibraryNetworkGetActiveMissingCoverBackfillStatus),
    showNetworkCandidates: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryNetworkShowCandidates, trackId),
    searchNetworkTagCandidates: (trackId, options) =>
      ipcRenderer.invoke(IpcChannels.LibrarySearchNetworkTagCandidates, { trackId, ...options }),
    resolveLyricsBackgroundCover: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryResolveLyricsBackgroundCover, trackId),
    applyNetworkMissingOnly: (candidateId, options) =>
      ipcRenderer.invoke(IpcChannels.LibraryNetworkApplyMissingOnly, { candidateId, ...options }),
    applyNetworkSelected: (candidateId, options) =>
      ipcRenderer.invoke(IpcChannels.LibraryNetworkApplySelected, { candidateId, ...options }),
    rejectNetworkCandidate: (candidateId) => ipcRenderer.invoke(IpcChannels.LibraryNetworkRejectCandidate, candidateId),
    startBpmAnalysis: (options) => ipcRenderer.invoke(IpcChannels.LibraryStartBpmAnalysis, options),
    getBpmAnalysisStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryGetBpmAnalysisStatus, jobId),
    startReplayGainAnalysis: (options) => ipcRenderer.invoke(IpcChannels.LibraryStartReplayGainAnalysis, options),
    getReplayGainAnalysisStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryGetReplayGainAnalysisStatus, jobId),
    startLyricsBackfill: (options) => ipcRenderer.invoke(IpcChannels.LibraryStartLyricsBackfill, options),
    getLyricsBackfillStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryGetLyricsBackfillStatus, jobId),
    getCurrentLyricsBackfillStatus: () => ipcRenderer.invoke(IpcChannels.LibraryGetCurrentLyricsBackfillStatus),
    cancelLyricsBackfill: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryCancelLyricsBackfill, jobId),
  },
  libraryLab: {
    setWatcherEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetWatcherEnabled, enabled),
    setAutoRescanEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetAutoRescanEnabled, enabled),
    setMoveCandidateEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetMoveCandidateEnabled, enabled),
    setMoveRepairLabEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetMoveRepairLabEnabled, enabled),
    getState: () => ipcRenderer.invoke(IpcChannels.LibraryLabGetState),
    startWatcher: () => ipcRenderer.invoke(IpcChannels.LibraryLabStartWatcher),
    stopWatcher: () => ipcRenderer.invoke(IpcChannels.LibraryLabStopWatcher),
    refreshDiagnostics: () => ipcRenderer.invoke(IpcChannels.LibraryLabRefreshDiagnostics),
    backfillPlaceholderMetadata: () => ipcRenderer.invoke(IpcChannels.LibraryLabBackfillPlaceholderMetadata),
    getMoveCandidates: (options) => ipcRenderer.invoke(IpcChannels.LibraryLabGetMoveCandidates, options),
    dryRunMoveRepair: (candidateId) => ipcRenderer.invoke(IpcChannels.LibraryLabDryRunMoveRepair, candidateId),
    applyMoveRepair: (candidateId) => ipcRenderer.invoke(IpcChannels.LibraryLabApplyMoveRepair, candidateId),
  },
  playback: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.DaemonCommand, { method: 'getStatus' }),
    playLocalFile: (request) =>
      ipcRenderer.invoke(IpcChannels.DaemonCommand, {
        method: 'play',
        params: { path: request.filePath, startSeconds: request.startSeconds },
      }),
    prepareLocalFile: (request) => ipcRenderer.invoke(IpcChannels.PlaybackPrepareLocalFile, request),
    playMediaItem: (request) => ipcRenderer.invoke(IpcChannels.PlaybackPlayMediaItem, request),
    prepareMediaItem: (request) => ipcRenderer.invoke(IpcChannels.PlaybackPrepareMediaItem, request),
    play: () => ipcRenderer.invoke(IpcChannels.DaemonCommand, { method: 'resume' }),
    pause: () => ipcRenderer.invoke(IpcChannels.DaemonCommand, { method: 'pause' }),
    stop: () => ipcRenderer.invoke(IpcChannels.DaemonCommand, { method: 'stop' }),
    seek: (positionSeconds) =>
      ipcRenderer.invoke(IpcChannels.DaemonCommand, { method: 'seek', params: { seconds: positionSeconds } }),
    openLocalAudioFile: () => ipcRenderer.invoke(IpcChannels.PlaybackOpenLocalAudioFile),
    openLocalAudioFiles: () => ipcRenderer.invoke(IpcChannels.PlaybackOpenLocalAudioFiles),
    resolveLocalAudioFiles: (paths) => ipcRenderer.invoke(IpcChannels.PlaybackResolveLocalAudioFiles, paths),
    getQueueSession: () => ipcRenderer.invoke(IpcChannels.PlaybackGetQueueSession),
    saveQueueSession: (snapshot, options) => ipcRenderer.invoke(IpcChannels.PlaybackSaveQueueSession, snapshot, options),
    clearQueueSession: () => ipcRenderer.invoke(IpcChannels.PlaybackClearQueueSession),
    onQueueSessionChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: unknown): void => {
        handler(snapshot as Awaited<ReturnType<EchoApi['playback']['getQueueSession']>>);
      };
      ipcRenderer.on(IpcChannels.PlaybackQueueSessionChanged, listener);
      return () => ipcRenderer.off(IpcChannels.PlaybackQueueSessionChanged, listener);
    },
    onLocalAudioFilesOpened: (handler) => {
      localAudioFileOpenHandlers.add(handler);
      for (const paths of pendingLocalAudioFileOpenEvents.splice(0)) {
        handler(paths);
      }
      return () => {
        localAudioFileOpenHandlers.delete(handler);
      };
    },
    onAutomixAdvance: (handler) => {
      automixAdvanceHandlers.add(handler);
      return () => {
        automixAdvanceHandlers.delete(handler);
      };
    },
    setVolume: (vol) => ipcRenderer.invoke(IpcChannels.DaemonCommand, { method: 'setVolume', params: { volume: vol } }),
    next: () => ipcRenderer.invoke(IpcChannels.DaemonCommand, { method: 'next' }),
    previous: () => ipcRenderer.invoke(IpcChannels.DaemonCommand, { method: 'previous' }),
  },
  remoteSources: {
    list: () => ipcRenderer.invoke(IpcChannels.RemoteSourcesList),
    getOverview: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetOverview, sourceId),
    previewAlbumGrouping: (strategy, sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesPreviewAlbumGrouping, strategy, sourceId),
    listIssues: (sourceId, kind, limit) => ipcRenderer.invoke(IpcChannels.RemoteSourcesListIssues, sourceId, kind, limit),
    create: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCreate, input),
    update: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesUpdate, input),
    disconnect: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesDisconnect, sourceId),
    delete: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesDelete, sourceId),
    test: (sourceIdOrInput) => ipcRenderer.invoke(IpcChannels.RemoteSourcesTest, sourceIdOrInput),
    browse: (sourceId, path) => ipcRenderer.invoke(IpcChannels.RemoteSourcesBrowse, sourceId, path),
    sync: (sourceId, options) => ipcRenderer.invoke(IpcChannels.RemoteSourcesSync, sourceId, options),
    cancelSync: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCancelSync, sourceId),
    getSyncStatus: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetSyncStatus, sourceId),
    createStreamUrl: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCreateStreamUrl, input),
    hydrateVisibleTracks: (trackIds, options) => ipcRenderer.invoke(IpcChannels.RemoteSourcesHydrateVisibleTracks, trackIds, options),
    lookupTracks: (sourceId, remotePaths) => ipcRenderer.invoke(IpcChannels.RemoteSourcesLookupTracks, sourceId, remotePaths),
    listIndexedTracks: (sourceId, rootPath) => ipcRenderer.invoke(IpcChannels.RemoteSourcesListIndexedTracks, sourceId, rootPath),
    listIndexedTracksPage: (sourceId, query) => ipcRenderer.invoke(IpcChannels.RemoteSourcesListIndexedTracksPage, sourceId, query),
    getIndexedFolderStats: (sourceId, rootPath) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetIndexedFolderStats, sourceId, rootPath),
    previewDirectoryItems: (sourceId, items, options) => ipcRenderer.invoke(IpcChannels.RemoteSourcesPreviewDirectoryItems, sourceId, items, options),
    startBackgroundJobs: (sourceId, kinds) => ipcRenderer.invoke(IpcChannels.RemoteSourcesStartBackgroundJobs, sourceId, kinds),
    pauseBackgroundJobs: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesPauseBackgroundJobs, sourceId),
    resumeBackgroundJobs: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesResumeBackgroundJobs, sourceId),
    getJobStatus: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetJobStatus, sourceId),
    retryFailedJobs: (sourceId, kinds) => ipcRenderer.invoke(IpcChannels.RemoteSourcesRetryFailedJobs, sourceId, kinds),
    setBackgroundPaused: (paused) => ipcRenderer.invoke(IpcChannels.RemoteSourcesSetBackgroundPaused, paused),
    getBackgroundGlobalStatus: () => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetBackgroundGlobalStatus),
    updateRuntimeLimits: (sourceId, limits) => ipcRenderer.invoke(IpcChannels.RemoteSourcesUpdateRuntimeLimits, sourceId, limits),
    createBaiduAuthUrl: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCreateBaiduAuthUrl, input),
    exchangeBaiduAuthCode: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesExchangeBaiduAuthCode, input),
    startBaiduOAuthLogin: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesStartBaiduOAuthLogin, input),
  },
  connect: {
    getDonatorUnlockStatus: () => ipcRenderer.invoke(IpcChannels.ConnectGetDonatorUnlockStatus),
    listDevices: () => ipcRenderer.invoke(IpcChannels.ConnectListDevices),
    refresh: () => ipcRenderer.invoke(IpcChannels.ConnectRefresh),
    getStatus: () => ipcRenderer.invoke(IpcChannels.ConnectGetStatus),
    connect: (request) => ipcRenderer.invoke(IpcChannels.ConnectConnect, request),
    disconnect: () => ipcRenderer.invoke(IpcChannels.ConnectDisconnect),
    play: () => ipcRenderer.invoke(IpcChannels.ConnectPlay),
    pause: () => ipcRenderer.invoke(IpcChannels.ConnectPause),
    stop: () => ipcRenderer.invoke(IpcChannels.ConnectStop),
    seek: (positionSeconds) => ipcRenderer.invoke(IpcChannels.ConnectSeek, positionSeconds),
    setVolume: (volumePercent) => ipcRenderer.invoke(IpcChannels.ConnectSetVolume, volumePercent),
    getEchoLinkStatus: () => ipcRenderer.invoke(IpcChannels.EchoLinkGetStatus),
    setEchoLinkEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.EchoLinkSetEnabled, enabled),
    rotateEchoLinkToken: () => ipcRenderer.invoke(IpcChannels.EchoLinkRotateToken),
    setEchoLinkWebBackground: (background) => ipcRenderer.invoke(IpcChannels.EchoLinkSetWebBackground, background),
    chooseEchoLinkWebBackgroundImage: () => ipcRenderer.invoke(IpcChannels.EchoLinkChooseWebBackgroundImage),
    onStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as Awaited<ReturnType<EchoApi['connect']['getStatus']>>);
      };
      ipcRenderer.on(IpcChannels.ConnectStatus, listener);
      return () => ipcRenderer.off(IpcChannels.ConnectStatus, listener);
    },
    getReceiverStatus: () => ipcRenderer.invoke(IpcChannels.ConnectReceiverGetStatus),
    setReceiverEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.ConnectReceiverSetEnabled, enabled),
    stopReceiverPlayback: () => ipcRenderer.invoke(IpcChannels.ConnectReceiverStopPlayback),
    onReceiverStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as Awaited<ReturnType<EchoApi['connect']['getReceiverStatus']>>);
      };
      ipcRenderer.on(IpcChannels.ConnectReceiverStatus, listener);
      return () => ipcRenderer.off(IpcChannels.ConnectReceiverStatus, listener);
    },
    getAirPlayReceiverStatus: () => ipcRenderer.invoke(IpcChannels.ConnectAirPlayReceiverGetStatus),
    setAirPlayReceiverEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.ConnectAirPlayReceiverSetEnabled, enabled),
    stopAirPlayReceiverPlayback: () => ipcRenderer.invoke(IpcChannels.ConnectAirPlayReceiverStopPlayback),
    onAirPlayReceiverStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as Awaited<ReturnType<EchoApi['connect']['getAirPlayReceiverStatus']>>);
      };
      ipcRenderer.on(IpcChannels.ConnectAirPlayReceiverStatus, listener);
      return () => ipcRenderer.off(IpcChannels.ConnectAirPlayReceiverStatus, listener);
    },
    getWallpaperEngineBridgeStatus: () => ipcRenderer.invoke(IpcChannels.ConnectWallpaperEngineBridgeGetStatus),
  },
  streaming: {
    search: (request) => ipcRenderer.invoke(IpcChannels.StreamingSearch, request),
    getTrack: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetTrack, request),
    getTrackSourceInfo: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetTrackSourceInfo, request),
    getAlbum: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetAlbum, request),
    getArtist: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetArtist, request),
    resolvePlayback: (request) => ipcRenderer.invoke(IpcChannels.StreamingResolvePlayback, request),
    analyzeBpm: (request) => ipcRenderer.invoke(IpcChannels.StreamingAnalyzeBpm, request),
    getLyrics: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetLyrics, request),
    getMv: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetMv, request),
    getProviders: () => ipcRenderer.invoke(IpcChannels.StreamingGetProviders),
    importPlaylistFromUrl: (url) => ipcRenderer.invoke(IpcChannels.StreamingImportPlaylistFromUrl, url),
    importFavoritesFromUrl: (url) => ipcRenderer.invoke(IpcChannels.StreamingImportFavoritesFromUrl, url),
    exportFavorites: () => ipcRenderer.invoke(IpcChannels.StreamingExportFavorites),
    syncLikedSongs: (provider) => ipcRenderer.invoke(IpcChannels.StreamingSyncLikedSongs, provider),
    setTrackLiked: (request) => ipcRenderer.invoke(IpcChannels.StreamingSetTrackLiked, request),
    getFavorites: () => ipcRenderer.invoke(IpcChannels.StreamingGetFavorites),
    setFavorite: (request) => ipcRenderer.invoke(IpcChannels.StreamingSetFavorite, request),
    renameFavoriteCollection: (request) => ipcRenderer.invoke(IpcChannels.StreamingRenameFavoriteCollection, request),
    syncFavoriteCollection: (request) => ipcRenderer.invoke(IpcChannels.StreamingSyncFavoriteCollection, request),
    deleteFavoriteCollection: (request) => ipcRenderer.invoke(IpcChannels.StreamingDeleteFavoriteCollection, request),
    refreshNeteaseDailyRecommend: () => ipcRenderer.invoke(IpcChannels.StreamingRefreshNeteaseDailyRecommend),
  },
  lyrics: {
    getForTrack: (trackId) => ipcRenderer.invoke(IpcChannels.LyricsGetForTrack, trackId),
    getForSnapshot: (request) => ipcRenderer.invoke(IpcChannels.LyricsGetForSnapshot, request),
    searchCandidates: (trackId, searchText, providerId) => ipcRenderer.invoke(IpcChannels.LyricsSearchCandidates, trackId, searchText, providerId),
    searchCandidatesForSnapshot: (request, searchText, providerId) =>
      ipcRenderer.invoke(IpcChannels.LyricsSearchCandidatesForSnapshot, request, searchText, providerId),
    previewCandidate: (trackId, candidateId) => ipcRenderer.invoke(IpcChannels.LyricsPreviewCandidate, trackId, candidateId),
    applyCandidate: (trackId, candidateId) => ipcRenderer.invoke(IpcChannels.LyricsApplyCandidate, trackId, candidateId),
    applyCandidateForSnapshot: (request, candidateId) => ipcRenderer.invoke(IpcChannels.LyricsApplyCandidateForSnapshot, request, candidateId),
    embedToTrack: (trackId, request) => ipcRenderer.invoke(IpcChannels.LyricsEmbedToTrack, trackId, request),
    applyCustomLrc: (trackId, lrcText, fileName) => ipcRenderer.invoke(IpcChannels.LyricsApplyCustomLrc, trackId, lrcText, fileName),
    markInstrumental: (trackId) => ipcRenderer.invoke(IpcChannels.LyricsMarkInstrumental, trackId),
    rejectCandidate: (candidateId) => ipcRenderer.invoke(IpcChannels.LyricsRejectCandidate, candidateId),
    setOffset: (trackId, offsetMs) => ipcRenderer.invoke(IpcChannels.LyricsSetOffset, trackId, offsetMs),
    clearCache: (trackId) => ipcRenderer.invoke(IpcChannels.LyricsClearCache, trackId),
    onChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        if (payload && typeof payload === 'object' && typeof (payload as { trackId?: unknown }).trackId === 'string') {
          handler((payload as { trackId: string }).trackId);
        }
      };
      ipcRenderer.on(IpcChannels.LyricsChanged, listener);
      return () => ipcRenderer.off(IpcChannels.LyricsChanged, listener);
    },
  },
  mv: {
    getSelected: (trackId) => ipcRenderer.invoke(IpcChannels.MvGetSelected, trackId),
    getSettings: () => ipcRenderer.invoke(IpcChannels.MvGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.MvSetSettings, patch),
    findLocalCandidates: (trackId) => ipcRenderer.invoke(IpcChannels.MvFindLocalCandidates, trackId),
    searchNetworkCandidates: (trackId, query) => ipcRenderer.invoke(IpcChannels.MvSearchNetworkCandidates, trackId, query),
    searchNetworkCandidatesForSnapshot: (request) => ipcRenderer.invoke(IpcChannels.MvSearchNetworkCandidatesForSnapshot, request),
    getTemporaryPlayableForSnapshot: (request) => ipcRenderer.invoke(IpcChannels.MvGetTemporaryPlayableForSnapshot, request),
    getCandidates: (trackId) => ipcRenderer.invoke(IpcChannels.MvGetCandidates, trackId),
    resolveStreams: (videoId) => ipcRenderer.invoke(IpcChannels.MvResolveStreams, videoId),
    setQuality: (videoId, qualityId) => ipcRenderer.invoke(IpcChannels.MvSetQuality, videoId, qualityId),
    setOffset: (trackId, offsetMs) => ipcRenderer.invoke(IpcChannels.MvSetOffset, trackId, offsetMs),
    chooseLocalVideo: (trackId) => ipcRenderer.invoke(IpcChannels.MvChooseLocalVideo, trackId),
    bindLocalVideo: (trackId, filePath) => ipcRenderer.invoke(IpcChannels.MvBindLocalVideo, trackId, filePath),
    bindUrl: (trackId, url) => ipcRenderer.invoke(IpcChannels.MvBindUrl, trackId, url),
    selectVideo: (trackId, videoId) => ipcRenderer.invoke(IpcChannels.MvSelectVideo, trackId, videoId),
    clearSelected: (trackId) => ipcRenderer.invoke(IpcChannels.MvClearSelected, trackId),
    openExternal: (videoId) => ipcRenderer.invoke(IpcChannels.MvOpenExternal, videoId),
  },
  smtc: {
    getDiagnostics: () => ipcRenderer.invoke(IpcChannels.SmtcGetDiagnostics),
    restart: () => ipcRenderer.invoke(IpcChannels.SmtcRestart),
    setLyricsProgress: (progress: SmtcLyricsProgress | null) => ipcRenderer.invoke(IpcChannels.SmtcSetLyricsProgress, progress),
    onCommand: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, command: SmtcCommand): void => {
        handler(command);
      };
      ipcRenderer.on(IpcChannels.SmtcCommand, listener);
      return () => ipcRenderer.off(IpcChannels.SmtcCommand, listener);
    },
  },
  discordPresence: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.DiscordPresenceGetStatus),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.DiscordPresenceSetEnabled, enabled),
  },
  lastfm: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.LastFmGetStatus),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LastFmSetEnabled, enabled),
    setNowPlayingEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LastFmSetNowPlayingEnabled, enabled),
    setScrobbleEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LastFmSetScrobbleEnabled, enabled),
    createAuthToken: () => ipcRenderer.invoke(IpcChannels.LastFmCreateAuthToken),
    openAuthUrl: (token) => ipcRenderer.invoke(IpcChannels.LastFmOpenAuthUrl, token),
    completeAuth: (token) => ipcRenderer.invoke(IpcChannels.LastFmCompleteAuth, token),
    authenticatePassword: (username, password) => ipcRenderer.invoke(IpcChannels.LastFmAuthenticatePassword, username, password),
    disconnect: () => ipcRenderer.invoke(IpcChannels.LastFmDisconnect),
  },
  hqPlayer: {
    getSettings: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.HqPlayerSetSettings, patch),
    getStatus: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetStatus),
    testConnection: (patch) => ipcRenderer.invoke(IpcChannels.HqPlayerTestConnection, patch),
    createPlaybackHandoff: (request) => ipcRenderer.invoke(IpcChannels.HqPlayerCreatePlaybackHandoff, request),
    sendLastPlaybackControl: () => ipcRenderer.invoke(IpcChannels.HqPlayerSendLastPlaybackControl),
    getLastPlaybackHandoff: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetLastPlaybackHandoff),
    getLastPlaybackControl: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetLastPlaybackControl),
  },
  audio: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.AudioGetStatus) as Promise<AudioStatus>,
    getDiagnostics: () => ipcRenderer.invoke(IpcChannels.AudioGetDiagnostics) as Promise<AudioDiagnostics>,
    onStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as AudioStatus);
      };
      ipcRenderer.on(IpcChannels.AudioStatus, listener);
      // Immediately fetch current status (prevents null status crash on first render)
      ipcRenderer.invoke(IpcChannels.AudioGetStatus).then(s => {
        if (s) handler(s as AudioStatus);
      }).catch(() => {});
      return () => ipcRenderer.off(IpcChannels.AudioStatus, listener);
    },
    onSessionReset: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, event: unknown): void => {
        handler(event as AudioSessionResetEvent);
      };
      ipcRenderer.on(IpcChannels.AudioSessionReset, listener);
      return () => ipcRenderer.off(IpcChannels.AudioSessionReset, listener);
    },
    listDevices: () => ipcRenderer.invoke(IpcChannels.AudioListDevices) as Promise<AudioDeviceInfo[]>,
    setOutput: (settings) => ipcRenderer.invoke(IpcChannels.AudioSetOutput, settings) as Promise<AudioStatus>,
    exportFile: (request) => ipcRenderer.invoke(IpcChannels.AudioExportFile, request) as Promise<AudioExportResult | null>,
    openAsioControlPanel: (settings) => ipcRenderer.invoke(IpcChannels.AudioOpenAsioControlPanel, settings),
    resetEngine: () => ipcRenderer.invoke(IpcChannels.AudioResetEngine) as Promise<AudioStatus>,
    forceRestart: (reason) => ipcRenderer.invoke(IpcChannels.AudioForceRestart, reason) as Promise<AudioStatus>,
    restartWindowsAudioService: () => ipcRenderer.invoke(IpcChannels.AudioRestartWindowsAudioService) as Promise<AudioStatus>,
    command: (method, params) => ipcRenderer.invoke(IpcChannels.DaemonCommand, { method, params }),
    on: (event, cb) => {
      const channel = `${IpcChannels.DaemonEvent}:${event}`;
      const handler = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  },
  diagnostics: {
    getLastCrashSummary: () => ipcRenderer.invoke(IpcChannels.DiagnosticsGetLastCrashSummary),
    clearLastCrashSummary: () => ipcRenderer.invoke(IpcChannels.DiagnosticsClearLastCrashSummary),
    exportDiagnostics: () => ipcRenderer.invoke(IpcChannels.DiagnosticsExport),
    exportDiagnosticsZip: () => ipcRenderer.invoke(IpcChannels.DiagnosticsExportZip),
    openDiagnosticsFolder: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenFolder),
    openCrashReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenCrashReport),
    openCrashTextReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenCrashTextReport),
    openAudioCrashReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenAudioCrashReport),
    openAudioCrashTextReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenAudioCrashTextReport),
    openMemoryPressureReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenMemoryPressureReport),
    relaunchApp: () => ipcRenderer.invoke(IpcChannels.DiagnosticsRelaunchApp),
    openDevConsole: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenDevConsole),
    getDevConsoleSnapshot: () => ipcRenderer.invoke(IpcChannels.DiagnosticsDevConsoleSnapshot),
    onDevConsoleEntry: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, entry: unknown): void => {
        handler(entry as DiagnosticConsoleEntry);
      };
      ipcRenderer.on(IpcChannels.DiagnosticsDevConsoleEntry, listener);
      return () => ipcRenderer.off(IpcChannels.DiagnosticsDevConsoleEntry, listener);
    },
    onMemoryPressure: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, event: unknown): void => {
        handler(event as DiagnosticMemoryPressureEvent);
      };
      ipcRenderer.on(IpcChannels.DiagnosticsMemoryPressure, listener);
      return () => ipcRenderer.off(IpcChannels.DiagnosticsMemoryPressure, listener);
    },
    reportRendererError: (payload) => ipcRenderer.invoke(IpcChannels.DiagnosticsReportRendererError, payload),
    reportPerformanceStall: (payload) => ipcRenderer.invoke(IpcChannels.DiagnosticsReportPerformanceStall, payload),
  },
  downloads: {
    getJobs: () => ipcRenderer.invoke(IpcChannels.DownloadsGetJobs),
    createUrlJob: (url, options) => ipcRenderer.invoke(IpcChannels.DownloadsCreateUrlJob, url, options),
    cancelJob: (jobId) => ipcRenderer.invoke(IpcChannels.DownloadsCancelJob, jobId),
    clearCompleted: () => ipcRenderer.invoke(IpcChannels.DownloadsClearCompleted),
    getSettings: () => ipcRenderer.invoke(IpcChannels.DownloadsGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.DownloadsSetSettings, patch),
    chooseOutputDirectory: (target) => ipcRenderer.invoke(IpcChannels.DownloadsChooseOutputDirectory, target),
    search: (request) => ipcRenderer.invoke(IpcChannels.DownloadsSearch, request),
    checkTools: () => ipcRenderer.invoke(IpcChannels.DownloadsCheckTools),
    onJobsUpdated: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, jobs: unknown): void => {
        handler(jobs as Awaited<ReturnType<EchoApi['downloads']['getJobs']>>);
      };
      ipcRenderer.on(IpcChannels.DownloadsJobsUpdated, listener);
      return () => ipcRenderer.off(IpcChannels.DownloadsJobsUpdated, listener);
    },
  },
  plugins: {
    list: () => ipcRenderer.invoke(IpcChannels.PluginsList),
    createExample: (kind) => ipcRenderer.invoke(IpcChannels.PluginsCreateExample, kind),
    enable: (request) => ipcRenderer.invoke(IpcChannels.PluginsEnable, request),
    disable: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsDisable, pluginId),
    delete: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsDelete, pluginId),
    reload: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsReload, pluginId),
    openDirectory: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsOpenDirectory, pluginId),
    exportPackage: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsExportPackage, pluginId),
    importPackage: (source) => {
      if (source === undefined) {
        return ipcRenderer.invoke(IpcChannels.PluginsImportPackage);
      }
      if (typeof source === 'string') {
        return ipcRenderer.invoke(IpcChannels.PluginsImportPackage, source);
      }

      const sourcePath = webUtils?.getPathForFile(source) || '';
      if (!sourcePath) {
        throw new Error('plugin_package_path_unavailable');
      }
      return ipcRenderer.invoke(IpcChannels.PluginsImportPackage, sourcePath);
    },
    runCommand: (request) => ipcRenderer.invoke(IpcChannels.PluginsRunCommand, request),
    queryMetadata: (request) => ipcRenderer.invoke(IpcChannels.PluginsQueryMetadata, request),
    querySources: (request) => ipcRenderer.invoke(IpcChannels.PluginsQuerySources, request),
    resolveSourcePlayback: (request) => ipcRenderer.invoke(IpcChannels.PluginsResolveSourcePlayback, request),
    queryLyrics: (request) => ipcRenderer.invoke(IpcChannels.PluginsQueryLyrics, request),
    queryCovers: (request) => ipcRenderer.invoke(IpcChannels.PluginsQueryCovers, request),
    getSettings: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsGetSettings, pluginId),
    setSettings: (pluginId, patch) => ipcRenderer.invoke(IpcChannels.PluginsSetSettings, pluginId, patch),
    getLogs: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsGetLogs, pluginId),
  },
  accounts: {
    getStatuses: () => ipcRenderer.invoke(IpcChannels.AccountGetStatuses),
    getStatus: (provider) => ipcRenderer.invoke(IpcChannels.AccountGetStatus, provider),
    saveCookie: (provider, cookie) => ipcRenderer.invoke(IpcChannels.AccountSaveCookie, provider, cookie),
    startLogin: (provider) => ipcRenderer.invoke(IpcChannels.AccountStartLogin, provider),
    clear: (provider) => ipcRenderer.invoke(IpcChannels.AccountClear, provider),
    check: (provider) => ipcRenderer.invoke(IpcChannels.AccountCheck, provider),
    checkAll: () => ipcRenderer.invoke(IpcChannels.AccountCheckAll),
    setBrowser: (provider, browser) => ipcRenderer.invoke(IpcChannels.AccountSetBrowser, provider, browser),
    setYouTubeBrowser: (browser) => ipcRenderer.invoke(IpcChannels.AccountSetYouTubeBrowser, browser),
    onStatusesChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, statuses: unknown): void => {
        handler(Array.isArray(statuses) ? (statuses as Awaited<ReturnType<EchoApi['accounts']['getStatuses']>>) : []);
      };
      ipcRenderer.on(IpcChannels.AccountStatusesChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AccountStatusesChanged, listener);
    },
  },
  spotify: {
    getAccessToken: () => ipcRenderer.invoke(IpcChannels.SpotifyGetAccessToken),
    getDevices: () => ipcRenderer.invoke(IpcChannels.SpotifyGetDevices),
    getPlaybackState: () => ipcRenderer.invoke(IpcChannels.SpotifyGetPlaybackState),
    ensureConnectDevice: (request) => ipcRenderer.invoke(IpcChannels.SpotifyEnsureConnectDevice, request),
    startPlayback: (request) => ipcRenderer.invoke(IpcChannels.SpotifyStartPlayback, request),
    transferPlayback: (request) => ipcRenderer.invoke(IpcChannels.SpotifyTransferPlayback, request),
    pause: (deviceId) => ipcRenderer.invoke(IpcChannels.SpotifyPause, deviceId),
    resume: (deviceId) => ipcRenderer.invoke(IpcChannels.SpotifyResume, deviceId),
    seek: (positionMs, deviceId) => ipcRenderer.invoke(IpcChannels.SpotifySeek, positionMs, deviceId),
    setVolume: (volume, deviceId) => ipcRenderer.invoke(IpcChannels.SpotifySetVolume, volume, deviceId),
  },
  eq: {
    getState: () => ipcRenderer.invoke(IpcChannels.EqGetState) as Promise<Awaited<ReturnType<EchoApi['eq']['getState']>>>,
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.EqSetEnabled, enabled) as Promise<Awaited<ReturnType<EchoApi['eq']['setEnabled']>>>,
    setBandGain: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandGain, request) as Promise<Awaited<ReturnType<EchoApi['eq']['setBandGain']>>>,
    setBandFrequency: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandFrequency, request) as Promise<Awaited<ReturnType<EchoApi['eq']['setBandFrequency']>>>,
    setBandQ: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandQ, request) as Promise<Awaited<ReturnType<EchoApi['eq']['setBandQ']>>>,
    setBandFilterType: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandFilterType, request) as Promise<Awaited<ReturnType<EchoApi['eq']['setBandFilterType']>>>,
    setBandEnabled: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandEnabled, request) as Promise<Awaited<ReturnType<EchoApi['eq']['setBandEnabled']>>>,
    setPreamp: (preampDb) => ipcRenderer.invoke(IpcChannels.EqSetPreamp, preampDb) as Promise<Awaited<ReturnType<EchoApi['eq']['setPreamp']>>>,
    setDspHeadroom: (headroomDb) => ipcRenderer.invoke(IpcChannels.EqSetDspHeadroom, headroomDb) as Promise<Awaited<ReturnType<EchoApi['eq']['setDspHeadroom']>>>,
    setDspSafetyLimiterEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.EqSetDspSafetyLimiterEnabled, enabled) as Promise<Awaited<ReturnType<EchoApi['eq']['setDspSafetyLimiterEnabled']>>>,
    setPreset: (presetId) => ipcRenderer.invoke(IpcChannels.EqSetPreset, presetId) as Promise<Awaited<ReturnType<EchoApi['eq']['setPreset']>>>,
    reset: () => ipcRenderer.invoke(IpcChannels.EqReset) as Promise<Awaited<ReturnType<EchoApi['eq']['reset']>>>,
    listPresets: () => ipcRenderer.invoke(IpcChannels.EqListPresets) as Promise<Awaited<ReturnType<EchoApi['eq']['listPresets']>>>,
    savePreset: (request) => ipcRenderer.invoke(IpcChannels.EqSavePreset, request) as Promise<Awaited<ReturnType<EchoApi['eq']['savePreset']>>>,
    exportPreset: (request) => ipcRenderer.invoke(IpcChannels.EqExportPreset, request) as Promise<Awaited<ReturnType<EchoApi['eq']['exportPreset']>>>,
    exportApoPreset: (request) => ipcRenderer.invoke(IpcChannels.EqExportApoPreset, request) as Promise<Awaited<ReturnType<EchoApi['eq']['exportApoPreset']>>>,
    exportApoGraphicEqPreset: (request) => ipcRenderer.invoke(IpcChannels.EqExportApoGraphicEqPreset, request) as Promise<Awaited<ReturnType<EchoApi['eq']['exportApoGraphicEqPreset']>>>,
    previewImportPreset: () => ipcRenderer.invoke(IpcChannels.EqPreviewImportPreset) as Promise<Awaited<ReturnType<EchoApi['eq']['previewImportPreset']>>>,
    importPreset: () => ipcRenderer.invoke(IpcChannels.EqImportPreset) as Promise<Awaited<ReturnType<EchoApi['eq']['importPreset']>>>,
    deletePreset: (presetId) => ipcRenderer.invoke(IpcChannels.EqDeletePreset, presetId) as Promise<Awaited<ReturnType<EchoApi['eq']['deletePreset']>>>,
    browseHeadphoneCorrections: (request) => ipcRenderer.invoke(IpcChannels.EqBrowseHeadphoneCorrections, request) as Promise<Awaited<ReturnType<EchoApi['eq']['browseHeadphoneCorrections']>>>,
    searchHeadphoneCorrections: (request) => ipcRenderer.invoke(IpcChannels.EqSearchHeadphoneCorrections, request) as Promise<Awaited<ReturnType<EchoApi['eq']['searchHeadphoneCorrections']>>>,
    applyHeadphoneCorrection: (request) => ipcRenderer.invoke(IpcChannels.EqApplyHeadphoneCorrection, request) as Promise<Awaited<ReturnType<EchoApi['eq']['applyHeadphoneCorrection']>>>,
    listProfiles: () => ipcRenderer.invoke(IpcChannels.EqListProfiles) as Promise<Awaited<ReturnType<EchoApi['eq']['listProfiles']>>>,
    saveProfile: (request) => ipcRenderer.invoke(IpcChannels.EqSaveProfile, request) as Promise<Awaited<ReturnType<EchoApi['eq']['saveProfile']>>>,
    applyProfile: (profileId) => ipcRenderer.invoke(IpcChannels.EqApplyProfile, profileId) as Promise<Awaited<ReturnType<EchoApi['eq']['applyProfile']>>>,
    deleteProfile: (profileId) => ipcRenderer.invoke(IpcChannels.EqDeleteProfile, profileId) as Promise<Awaited<ReturnType<EchoApi['eq']['deleteProfile']>>>,
    bindProfileToOutput: (request) => ipcRenderer.invoke(IpcChannels.EqBindProfileToOutput, request) as Promise<Awaited<ReturnType<EchoApi['eq']['bindProfileToOutput']>>>,
    getProfileBinding: (target) => ipcRenderer.invoke(IpcChannels.EqGetProfileBinding, target) as Promise<Awaited<ReturnType<EchoApi['eq']['getProfileBinding']>>>,
    getChannelBalanceState: () => ipcRenderer.invoke(IpcChannels.ChannelBalanceGetState) as Promise<ChannelBalanceState>,
    setChannelBalanceState: (patch) => ipcRenderer.invoke(IpcChannels.ChannelBalanceSetState, patch) as Promise<ChannelBalanceState>,
    resetChannelBalance: () => ipcRenderer.invoke(IpcChannels.ChannelBalanceReset) as Promise<ChannelBalanceState>,
    getRoomCorrectionState: () => ipcRenderer.invoke(IpcChannels.RoomCorrectionGetState) as Promise<RoomCorrectionState>,
    importRoomCorrectionIr: () => ipcRenderer.invoke(IpcChannels.RoomCorrectionImportIr) as Promise<RoomCorrectionState | null>,
    setRoomCorrectionEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.RoomCorrectionSetEnabled, enabled) as Promise<RoomCorrectionState>,
    setRoomCorrectionTrim: (trimDb) => ipcRenderer.invoke(IpcChannels.RoomCorrectionSetTrim, trimDb) as Promise<RoomCorrectionState>,
    clearRoomCorrection: () => ipcRenderer.invoke(IpcChannels.RoomCorrectionClear) as Promise<RoomCorrectionState>,
  },
  sleepTimer: {
    start: (request) => ipcRenderer.invoke(IpcChannels.SleepTimerStart, request) as Promise<SleepTimerStatus>,
    cancel: () => ipcRenderer.invoke(IpcChannels.SleepTimerCancel) as Promise<SleepTimerStatus>,
    getStatus: () => ipcRenderer.invoke(IpcChannels.SleepTimerGetStatus) as Promise<SleepTimerStatus>,
    onTick: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, remainingMs: unknown): void => {
        handler(typeof remainingMs === 'number' ? remainingMs : 0);
      };
      ipcRenderer.on(IpcChannels.SleepTimerOnTick, listener);
      return () => ipcRenderer.off(IpcChannels.SleepTimerOnTick, listener);
    },
  },
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const handleMainWindowPlaybackCommand = async (_event: Electron.IpcRendererEvent, rawRequest: unknown): Promise<void> => {
  if (!isMainPlaybackRenderer || !isPlainRecord(rawRequest) || typeof rawRequest.id !== 'string') {
    return;
  }

  const command = typeof rawRequest.command === 'string' ? rawRequest.command : '';
  const args = Array.isArray(rawRequest.args) ? rawRequest.args : [];
  if (!playbackProxyCommands.has(command)) {
    ipcRenderer.send(IpcChannels.PlaybackMainWindowCommandResult, {
      id: rawRequest.id,
      ok: false,
      error: 'unsupported_main_window_playback_command',
    });
    return;
  }

  try {
    let value: unknown = null;
    switch (command as MainPlaybackCommand) {
      case 'playLocalFile':
        value = await echoApi.playback.playLocalFile(args[0] as PlaybackStartRequest);
        break;
      case 'playMediaItem':
        value = await echoApi.playback.playMediaItem(args[0] as PlaybackMediaStartRequest);
        break;
      case 'play':
        value = await echoApi.playback.play();
        break;
      case 'pause':
        value = await echoApi.playback.pause();
        break;
      case 'stop':
        value = await echoApi.playback.stop();
        break;
      case 'seek':
        value = await echoApi.playback.seek(Number(args[0]));
        break;
    }

    ipcRenderer.send(IpcChannels.PlaybackMainWindowCommandResult, {
      id: rawRequest.id,
      ok: true,
      value,
    });
  } catch (error) {
    ipcRenderer.send(IpcChannels.PlaybackMainWindowCommandResult, {
      id: rawRequest.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

if (isMainPlaybackRenderer) {
  ipcRenderer.on(IpcChannels.PlaybackMainWindowCommandRequest, handleMainWindowPlaybackCommand);
}

contextBridge.exposeInMainWorld('echo', echoApi);
