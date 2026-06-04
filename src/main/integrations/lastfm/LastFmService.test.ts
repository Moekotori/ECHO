import { describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../../shared/types/audio';
import type { AppSettings } from '../../../shared/types/appSettings';
import type { LastFmApiResult } from './LastFmClient';
import type { LibraryTrack } from '../../../shared/types/library';
import { LastFmService } from './LastFmService';

vi.mock('../../app/appSettings', () => ({
  getAppSettings: vi.fn(),
  setAppSettings: vi.fn(),
}));

vi.mock('../../audio/AudioSession', () => ({
  getAudioSession: () => ({
    getStatus: vi.fn(),
  }),
}));

vi.mock('../../diagnostics/CrashReportService', () => ({
  getCrashReportService: () => ({
    getLogger: () => null,
  }),
}));

vi.mock('../../library/LibraryService', () => ({
  getLibraryService: () => ({
    getTrack: () => null,
  }),
}));

const settingsBase: AppSettings = {
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
  lastFmEnabled: true,
  lastFmUsername: 'alice',
  lastFmSessionKey: 'session-key',
  lastFmScrobbleEnabled: true,
  lastFmNowPlayingEnabled: true,
  lastFmMinScrobbleSeconds: 30,
  lastFmAuthToken: null,
  smtcEnabled: true,
  smtcLyricsEnabled: false,
  taskbarPlaybackControlsEnabled: false,
};

const track: LibraryTrack = {
  id: 'track-1',
  path: 'D:\\Music\\Artist - Song.flac',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 60,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
};

const makeStatus = (patch: Partial<AudioStatus> = {}): AudioStatus => ({
  host: 'ready',
  state: 'playing',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: null,
  outputMode: 'shared',
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: track.path,
  currentTrackId: track.id,
  durationSeconds: 60,
  positionSeconds: 0,
  channels: 2,
  codec: 'flac',
  bitDepth: 16,
  bitrate: null,
  fileSampleRate: 44100,
  decoderOutputSampleRate: 44100,
  requestedOutputSampleRate: null,
  actualDeviceSampleRate: null,
  sharedDeviceSampleRate: null,
  resampling: false,
  bitPerfectCandidate: true,
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
  ...patch,
  activeOutputBackendImpl: patch.activeOutputBackendImpl ?? null,
  useJuceOutputRequested: patch.useJuceOutputRequested ?? false,
  activeDecodeBackendImpl: patch.activeDecodeBackendImpl ?? null,
  useJuceDecodeRequested: patch.useJuceDecodeRequested ?? false,
});

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createHarness = (settingsPatch: Partial<AppSettings> = {}) => {
  let now = 1_000_000;
  let settings = { ...settingsBase, ...settingsPatch };
  const client = {
    authenticateWithPassword: vi.fn(),
    clearSession: vi.fn(),
    completeWebAuth: vi.fn(),
    createWebAuthToken: vi.fn(),
    getAuthorizationUrl: vi.fn((token: string) => `https://www.last.fm/api/auth/?token=${token}`),
    scrobble: vi.fn(async (): Promise<LastFmApiResult> => ({ ok: true })),
    setSession: vi.fn(),
    updateNowPlaying: vi.fn(async (): Promise<LastFmApiResult> => ({ ok: true })),
  };
  const service = new LastFmService({
    client,
    logger: { info: vi.fn(), warn: vi.fn() },
    now: () => now,
    getSettings: () => settings,
    setSettings: (patch) => {
      settings = { ...settings, ...patch };
      return settings;
    },
    getTrack: () => track,
  });

  return {
    client,
    service,
    advance: (ms: number) => {
      now += ms;
    },
    get settings() {
      return settings;
    },
  };
};

describe('LastFmService', () => {
  it('creates a playback session and sends now playing for a new playing track', async () => {
    const { client, service } = createHarness();

    service.updateFromAudioStatus(makeStatus());
    await flushPromises();

    expect(service.getStatus().activeTrack).toMatchObject({ artist: 'Artist', title: 'Song', scrobbled: false });
    expect(client.updateNowPlaying).toHaveBeenCalledTimes(1);
  });

  it('scrobbles once after playedSeconds reaches the threshold', async () => {
    const { client, service, advance } = createHarness();

    service.updateFromAudioStatus(makeStatus());
    advance(30_000);
    service.updateFromAudioStatus(makeStatus({ positionSeconds: 30 }));
    await flushPromises();
    advance(30_000);
    service.updateFromAudioStatus(makeStatus({ positionSeconds: 60 }));
    await flushPromises();
    service.updateFromAudioStatus(makeStatus({ positionSeconds: 61 }));
    await flushPromises();

    expect(client.scrobble).toHaveBeenCalledTimes(1);
  });

  it('does not count paused wall time as played time', async () => {
    const { client, service, advance } = createHarness();

    service.updateFromAudioStatus(makeStatus());
    advance(10_000);
    service.updateFromAudioStatus(makeStatus({ state: 'paused', positionSeconds: 10 }));
    advance(90_000);
    service.updateFromAudioStatus(makeStatus({ state: 'paused', positionSeconds: 10 }));
    await flushPromises();

    expect(service.getStatus().activeTrack?.playedSeconds).toBe(10);
    expect(client.scrobble).not.toHaveBeenCalled();
  });

  it('does not treat seeked position as played seconds', async () => {
    const { service, advance } = createHarness();

    service.updateFromAudioStatus(makeStatus());
    advance(5_000);
    service.updateFromAudioStatus(makeStatus({ positionSeconds: 55 }));

    expect(service.getStatus().activeTrack?.playedSeconds).toBe(5);
  });

  it('flushes a ready scrobble on stop', async () => {
    const { client, service, advance } = createHarness();

    service.updateFromAudioStatus(makeStatus());
    advance(30_000);
    service.updateFromAudioStatus(makeStatus({ positionSeconds: 30 }));
    advance(30_000);
    service.updateFromAudioStatus(makeStatus({ state: 'stopped', positionSeconds: 60 }));
    await flushPromises();

    expect(client.scrobble).toHaveBeenCalledTimes(1);
    expect(service.getStatus().activeTrack).toBeNull();
  });

  it('skips network calls when disabled or disconnected', async () => {
    const disabled = createHarness({ lastFmEnabled: false });
    disabled.service.updateFromAudioStatus(makeStatus());
    await flushPromises();
    expect(disabled.client.updateNowPlaying).not.toHaveBeenCalled();

    const disconnected = createHarness({ lastFmSessionKey: null });
    disconnected.service.updateFromAudioStatus(makeStatus());
    await flushPromises();
    expect(disconnected.client.updateNowPlaying).not.toHaveBeenCalled();
  });

  it('skips Last.fm updates for streaming playback', async () => {
    const { client, service, advance } = createHarness();

    service.updateFromAudioStatus(
      makeStatus({
        currentFilePath: 'streaming:netease:3381920779',
        currentTrackId: 'streaming:netease:3381920779',
      }),
    );
    advance(60_000);
    service.updateFromAudioStatus(
      makeStatus({
        currentFilePath: 'https://example.test/audio.flac',
        currentTrackId: 'streaming:netease:3381920779',
        positionSeconds: 60,
      }),
    );
    await flushPromises();

    expect(service.getStatus().activeTrack).toBeNull();
    expect(client.updateNowPlaying).not.toHaveBeenCalled();
    expect(client.scrobble).not.toHaveBeenCalled();
  });

  it('marks invalid session as disconnected without throwing', async () => {
    const harness = createHarness();
    const { client, service, advance } = harness;
    client.scrobble.mockResolvedValueOnce({ ok: false, errorCode: 9, error: 'Invalid session key' });

    service.updateFromAudioStatus(makeStatus());
    advance(30_000);
    service.updateFromAudioStatus(makeStatus({ positionSeconds: 30 }));
    await flushPromises();

    expect(service.getStatus().connected).toBe(false);
    expect(harness.settings.lastFmSessionKey).toBeNull();
  });

  it('uses the stored auth token when completing authorization after a renderer refresh', async () => {
    const harness = createHarness({
      lastFmEnabled: true,
      lastFmSessionKey: null,
      lastFmUsername: null,
      lastFmAuthToken: 'stored-token',
    });
    harness.client.completeWebAuth.mockResolvedValueOnce({ ok: true, username: 'alice', sessionKey: 'new-session' });

    expect(harness.service.getStatus()).toMatchObject({ connected: false, authPending: true });
    const status = await harness.service.completeAuth('');

    expect(harness.client.completeWebAuth).toHaveBeenCalledWith('stored-token');
    expect(status).toMatchObject({ connected: true, authPending: false, username: 'alice' });
    expect(harness.settings.lastFmAuthToken).toBeNull();
  });

  it('clears stale auth tokens when Last.fm rejects authorization', async () => {
    const harness = createHarness({
      lastFmEnabled: true,
      lastFmSessionKey: null,
      lastFmUsername: null,
      lastFmAuthToken: 'stale-token',
    });
    harness.client.completeWebAuth.mockResolvedValueOnce({
      ok: false,
      errorCode: 14,
      error: 'Unauthorized Token - This token has not been authorized',
    });

    const status = await harness.service.completeAuth('');

    expect(status).toMatchObject({
      connected: false,
      authPending: false,
      lastError: 'Unauthorized Token - This token has not been authorized',
    });
    expect(harness.settings.lastFmAuthToken).toBeNull();
  });

  it('does not throw Last.fm API errors into playback status updates', async () => {
    const { client, service } = createHarness();
    client.updateNowPlaying.mockRejectedValueOnce(new Error('network down'));

    expect(() => service.updateFromAudioStatus(makeStatus())).not.toThrow();
    await flushPromises();
    expect(service.getStatus().lastError).toBe('network down');
  });
});
