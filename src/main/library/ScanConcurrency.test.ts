import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSettings } from '../../shared/types/appSettings';
import { createLibraryService } from './LibraryService';
import { getRecommendedScanConcurrency } from './ScanConcurrency';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'echo-next-scan-concurrency-'));
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

const testSettings = (patch: Partial<AppSettings> = {}): AppSettings => ({
  appearanceTheme: 'light',
  albumMergeStrategy: 'standard',
  artistWallAlbumArtwork: false,
  coverCacheDir: null,
  hideToTrayOnClose: false,
  appCustomWallpaperPath: null,
  appWallpaperScalePercent: 100,
  appWallpaperBlurPx: 0,
  appWallpaperBrightnessPercent: 100,
  appWallpaperUiOpacityPercent: 100,
  appWallpaperUnifiedOpacityEnabled: false,
  networkMetadataEnabled: false,
  networkMetadataProviders: ['netease-cloud-music', 'qq-music'],
  lyricsNetworkEnabled: true,
  lyricsPreferredProvider: 'lrclib',
  lyricsEnabledProviders: ['local', 'lrclib', 'netease', 'qqmusic'],
  lyricsProviderOrder: ['local', 'lrclib', 'netease', 'qqmusic'],
  lyricsDeepSearchEnabled: true,
  lyricsAutoSearch: true,
  lyricsAutoAcceptScore: 0.7,
  lyricsDefaultOffsetMs: 0,
  lyricsGlobalSyncOffsetMs: 0,
  lyricsEnabled: true,
  lyricsHeaderHidden: false,
  lyricsEmptyStateHidden: true,
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
  ...patch,
  smtcLyricsEnabled: patch.smtcLyricsEnabled ?? false,
  taskbarPlaybackControlsEnabled: patch.taskbarPlaybackControlsEnabled ?? false,
});

describe('getRecommendedScanConcurrency', () => {
  it('returns balanced concurrency for 8 CPUs', () => {
    expect(getRecommendedScanConcurrency({ mode: 'balanced', cpuCount: 8 })).toMatchObject({
      metadataConcurrency: 4,
      coverConcurrency: 2,
      cpuCount: 8,
      mode: 'balanced',
    });
  });

  it('returns lower concurrency in low mode', () => {
    const low = getRecommendedScanConcurrency({ mode: 'low', cpuCount: 8 });
    const balanced = getRecommendedScanConcurrency({ mode: 'balanced', cpuCount: 8 });

    expect(low.metadataConcurrency).toBeLessThan(balanced.metadataConcurrency);
    expect(low.coverConcurrency).toBe(1);
  });

  it('returns higher performance concurrency without letting cover exceed 4', () => {
    const performance = getRecommendedScanConcurrency({ mode: 'performance', cpuCount: 32 });

    expect(performance.metadataConcurrency).toBe(6);
    expect(performance.coverConcurrency).toBe(4);
  });

  it('clamps custom concurrency to the safe range', () => {
    expect(
      getRecommendedScanConcurrency({
        mode: 'custom',
        cpuCount: 16,
        metadataConcurrency: 99,
        coverConcurrency: 99,
      }),
    ).toMatchObject({
      metadataConcurrency: 8,
      coverConcurrency: 4,
    });
  });
});

describe('LibraryService scan concurrency', () => {
  it('keeps explicit dependency concurrency ahead of recommended settings', () => {
    const root = makeTempRoot();
    const service = createLibraryService(join(root, 'library.sqlite'), {
      appSettings: () => testSettings({ scanPerformanceMode: 'low' }),
      metadataConcurrency: 7,
      coverConcurrency: 4,
    });

    try {
      const diagnostics = service.getDiagnostics();

      expect(diagnostics.scanPerformanceMode).toBe('low');
      expect(diagnostics.metadataConcurrency).toBe(7);
      expect(diagnostics.coverConcurrency).toBe(4);
    } finally {
      service.close();
    }
  });

  it('uses balanced mode when old app settings do not have scanPerformanceMode', () => {
    const root = makeTempRoot();
    const settingsWithoutMode = testSettings();
    delete (settingsWithoutMode as Partial<AppSettings>).scanPerformanceMode;
    const service = createLibraryService(join(root, 'library.sqlite'), {
      appSettings: () => settingsWithoutMode,
    });

    try {
      const diagnostics = service.getDiagnostics();

      expect(diagnostics.scanPerformanceMode).toBe('balanced');
      expect(diagnostics.metadataConcurrency).toBeGreaterThan(0);
      expect(diagnostics.coverConcurrency).toBeGreaterThan(0);
    } finally {
      service.close();
    }
  });
});
