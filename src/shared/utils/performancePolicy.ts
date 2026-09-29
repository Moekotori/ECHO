import type {
  AppSettings,
  RemoteBackgroundConcurrencySettings,
  RemoteCoverLoadPerformanceMode,
  ScanPerformanceMode,
} from '../types/appSettings';

export type EffectivePerformancePolicy = {
  lowSpecModeEnabled: boolean;
  reduceMotion: boolean;
  allowVideoWallpaper: boolean;
  appWindowAcrylicEnabled: boolean;
  appWallpaperBlurPx: number;
  albumWallVirtualizationEnabled: boolean;
  homeWaveformVisualizerEnabled: boolean;
  audioVisualSpectrumEnabled: boolean;
  playerWaveformProgressEnabled: boolean;
  lyricsMvGraphicsPressureGuardEnabled: boolean;
  lyricsHighResolutionNetworkCoverEnabled: boolean;
  lyricsMusicReactiveVisualsEnabled: boolean;
  artistImageBackgroundFetchEnabled: boolean;
  liveLibraryUpdatesEnabled: boolean;
  scanPerformanceMode: ScanPerformanceMode;
  remoteCoverLoadPerformanceMode: RemoteCoverLoadPerformanceMode;
  remoteBackgroundConcurrency: RemoteBackgroundConcurrencySettings;
};

const defaultRemoteBackgroundConcurrency: RemoteBackgroundConcurrencySettings = {
  metadata: 3,
  cover: 6,
  lyrics: 2,
  mv: 1,
  durationBackfill: 2,
};

const lowSpecRemoteBackgroundConcurrency: RemoteBackgroundConcurrencySettings = {
  metadata: 1,
  cover: 1,
  lyrics: 1,
  mv: 1,
  durationBackfill: 1,
};

const normalizeScanPerformanceMode = (value: AppSettings['scanPerformanceMode'] | undefined): ScanPerformanceMode =>
  value === 'low' || value === 'performance' || value === 'ultra' ? value : 'balanced';

const normalizeRemoteCoverLoadPerformanceMode = (
  value: AppSettings['remoteCoverLoadPerformanceMode'] | undefined,
): RemoteCoverLoadPerformanceMode =>
  value === 'low' || value === 'aggressive' || value === 'lan' ? value : 'balanced';

const normalizeBlurPx = (value: AppSettings['appWallpaperBlurPx'] | undefined): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(40, Math.round(Number(value)))) : 0;

export const isLowSpecModeEnabled = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.lowSpecModeEnabled === true;

/**
 * Resolves runtime-only performance overrides without mutating persisted user preferences.
 * Audio backend, output, DSP, and hardware-acceleration settings are intentionally out of scope.
 */
export const resolveEffectivePerformancePolicy = (
  settings: Partial<AppSettings> | null | undefined,
): EffectivePerformancePolicy => {
  const lowSpecModeEnabled = isLowSpecModeEnabled(settings);
  const remoteBackgroundConcurrency = settings?.remoteBackgroundConcurrency ?? defaultRemoteBackgroundConcurrency;

  return {
    lowSpecModeEnabled,
    reduceMotion: lowSpecModeEnabled,
    allowVideoWallpaper: !lowSpecModeEnabled,
    appWindowAcrylicEnabled: lowSpecModeEnabled ? false : settings?.appWindowAcrylicEnabled === true,
    appWallpaperBlurPx: lowSpecModeEnabled ? 0 : normalizeBlurPx(settings?.appWallpaperBlurPx),
    albumWallVirtualizationEnabled: lowSpecModeEnabled || settings?.albumWallVirtualizationEnabled === true,
    homeWaveformVisualizerEnabled: !lowSpecModeEnabled && settings?.homeWaveformVisualizerEnabled !== false,
    audioVisualSpectrumEnabled: !lowSpecModeEnabled && settings?.audioVisualSpectrumEnabled === true,
    playerWaveformProgressEnabled: !lowSpecModeEnabled && settings?.playerWaveformProgressEnabled === true,
    lyricsMvGraphicsPressureGuardEnabled: lowSpecModeEnabled || settings?.lyricsMvGraphicsPressureGuardEnabled === true,
    lyricsHighResolutionNetworkCoverEnabled: !lowSpecModeEnabled && settings?.lyricsHighResolutionNetworkCoverEnabled === true,
    lyricsMusicReactiveVisualsEnabled: !lowSpecModeEnabled && settings?.lyricsMusicReactiveVisualsEnabled === true,
    artistImageBackgroundFetchEnabled: !lowSpecModeEnabled && settings?.autoFetchArtistImages === true && settings?.artistImageFetchPaused !== true,
    liveLibraryUpdatesEnabled: !lowSpecModeEnabled && settings?.liveLibraryUpdatesEnabled === true,
    scanPerformanceMode: lowSpecModeEnabled ? 'low' : normalizeScanPerformanceMode(settings?.scanPerformanceMode),
    remoteCoverLoadPerformanceMode: lowSpecModeEnabled
      ? 'low'
      : normalizeRemoteCoverLoadPerformanceMode(settings?.remoteCoverLoadPerformanceMode),
    remoteBackgroundConcurrency: lowSpecModeEnabled
      ? { ...lowSpecRemoteBackgroundConcurrency }
      : { ...remoteBackgroundConcurrency },
  };
};
