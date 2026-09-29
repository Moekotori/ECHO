import { describe, expect, it } from 'vitest';
import { resolveEffectivePerformancePolicy } from './performancePolicy';

describe('resolveEffectivePerformancePolicy', () => {
  it('preserves individual preferences when low spec mode is disabled', () => {
    const policy = resolveEffectivePerformancePolicy({
      lowSpecModeEnabled: false,
      appWindowAcrylicEnabled: true,
      appWallpaperBlurPx: 18,
      albumWallVirtualizationEnabled: false,
      homeWaveformVisualizerEnabled: true,
      audioVisualSpectrumEnabled: true,
      playerWaveformProgressEnabled: true,
      lyricsMvGraphicsPressureGuardEnabled: false,
      lyricsHighResolutionNetworkCoverEnabled: true,
      lyricsMusicReactiveVisualsEnabled: true,
      autoFetchArtistImages: true,
      artistImageFetchPaused: false,
      liveLibraryUpdatesEnabled: true,
      scanPerformanceMode: 'performance',
      remoteCoverLoadPerformanceMode: 'aggressive',
      remoteBackgroundConcurrency: { metadata: 5, cover: 12, lyrics: 3, mv: 2, durationBackfill: 4 },
    });

    expect(policy).toMatchObject({
      lowSpecModeEnabled: false,
      reduceMotion: false,
      allowVideoWallpaper: true,
      appWindowAcrylicEnabled: true,
      appWallpaperBlurPx: 18,
      albumWallVirtualizationEnabled: false,
      homeWaveformVisualizerEnabled: true,
      audioVisualSpectrumEnabled: true,
      playerWaveformProgressEnabled: true,
      lyricsMvGraphicsPressureGuardEnabled: false,
      lyricsHighResolutionNetworkCoverEnabled: true,
      lyricsMusicReactiveVisualsEnabled: true,
      artistImageBackgroundFetchEnabled: true,
      liveLibraryUpdatesEnabled: true,
      scanPerformanceMode: 'performance',
      remoteCoverLoadPerformanceMode: 'aggressive',
    });
    expect(policy.remoteBackgroundConcurrency).toEqual({ metadata: 5, cover: 12, lyrics: 3, mv: 2, durationBackfill: 4 });
  });

  it('applies conservative runtime overrides without changing audio or hardware settings', () => {
    const source = {
      lowSpecModeEnabled: true,
      appWindowAcrylicEnabled: true,
      appWallpaperBlurPx: 24,
      albumWallVirtualizationEnabled: false,
      homeWaveformVisualizerEnabled: true,
      audioVisualSpectrumEnabled: true,
      playerWaveformProgressEnabled: true,
      lyricsMvGraphicsPressureGuardEnabled: false,
      lyricsHighResolutionNetworkCoverEnabled: true,
      lyricsMusicReactiveVisualsEnabled: true,
      autoFetchArtistImages: true,
      artistImageFetchPaused: false,
      liveLibraryUpdatesEnabled: true,
      scanPerformanceMode: 'performance' as const,
      remoteCoverLoadPerformanceMode: 'lan' as const,
      remoteBackgroundConcurrency: { metadata: 5, cover: 12, lyrics: 3, mv: 2, durationBackfill: 4 },
      hardwareAccelerationDisabled: false,
      lowLoadPlaybackModeEnabled: false,
    };

    expect(resolveEffectivePerformancePolicy(source)).toEqual({
      lowSpecModeEnabled: true,
      reduceMotion: true,
      allowVideoWallpaper: false,
      appWindowAcrylicEnabled: false,
      appWallpaperBlurPx: 0,
      albumWallVirtualizationEnabled: true,
      homeWaveformVisualizerEnabled: false,
      audioVisualSpectrumEnabled: false,
      playerWaveformProgressEnabled: false,
      lyricsMvGraphicsPressureGuardEnabled: true,
      lyricsHighResolutionNetworkCoverEnabled: false,
      lyricsMusicReactiveVisualsEnabled: false,
      artistImageBackgroundFetchEnabled: false,
      liveLibraryUpdatesEnabled: false,
      scanPerformanceMode: 'low',
      remoteCoverLoadPerformanceMode: 'low',
      remoteBackgroundConcurrency: { metadata: 1, cover: 1, lyrics: 1, mv: 1, durationBackfill: 1 },
    });
    expect(source.hardwareAccelerationDisabled).toBe(false);
    expect(source.lowLoadPlaybackModeEnabled).toBe(false);
  });
});
