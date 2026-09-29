import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../../shared/types/audio';
import type { LibraryTrack } from '../../../shared/types/library';
import {
  createDiscordActivity,
  createDiscordPresenceTrackFromStatus,
  DISCORD_APP_LOGO_IMAGE_KEY,
  loadDiscordRpcModule,
  RpcDiscordPresenceService,
} from './RpcDiscordPresenceService';

vi.mock('../../diagnostics/CrashReportService', () => ({
  getCrashReportService: () => ({
    getLogger: () => null,
  }),
}));

vi.mock('../../library/LibraryService', () => ({
  getLibraryService: () => ({
    getTrack: () => null,
    getBestNetworkCoverUrlForTrack: () => null,
  }),
}));

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
  currentFilePath: 'D:\\Music\\fallback.flac',
  currentTrackId: 'track-1',
  durationSeconds: 180,
  positionSeconds: 30,
  channels: 2,
  codec: 'flac',
  bitDepth: 24,
  bitrate: 920000,
  fileSampleRate: 96000,
  decoderOutputSampleRate: 96000,
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
  activeDecodeBackendImpl: patch.activeDecodeBackendImpl ?? null,
});

const track: LibraryTrack = {
  id: 'track-1',
  path: 'D:\\Music\\real.flac',
  title: 'Moonlit Signal',
  artist: 'Echo Artist',
  album: 'Night Album',
  albumArtist: 'Echo Ensemble',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 96000,
  bitDepth: 24,
  bitrate: 920000,
  coverId: 'cover-1',
  coverThumb: null,
  fieldSources: {},
};

class FakeRpcClient extends EventEmitter {
  transport = {
    socket: {
      destroyed: false,
      writable: true,
    },
  };
  login = vi.fn(async () => undefined);
  setActivity = vi.fn(async (_activity: unknown): Promise<void> => undefined);
  clearActivity = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
}

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const createService = (options: {
  now?: () => number;
  loadFails?: boolean;
  loginFails?: Error;
  getTrack?: (trackId: string) => LibraryTrack | null;
  getNetworkCoverUrl?: (trackId: string) => string | null;
  setActivity?: (activity: unknown) => Promise<void>;
} = {}) => {
  const clients: FakeRpcClient[] = [];
  const logger = { info: vi.fn(), warn: vi.fn() };
  const loadRpcModule = vi.fn(async () => {
    if (options.loadFails) {
      throw new Error('module unavailable');
    }

    return {
      Client: class extends FakeRpcClient {
        constructor() {
          super();
          if (options.loginFails) {
            this.login = vi.fn(async () => {
              throw options.loginFails;
            });
          }
          if (options.setActivity) {
            this.setActivity = vi.fn(options.setActivity);
          }
          clients.push(this);
        }
      },
      register: vi.fn(),
    };
  });
  const service = new RpcDiscordPresenceService({
    clientId: '1234567890',
    logger,
    loadRpcModule,
    now: options.now,
    getTrack: options.getTrack ?? (() => track),
    getNetworkCoverUrl: options.getNetworkCoverUrl,
  });

  return { service, get client() {
    return clients.at(-1) ?? null;
  }, loadRpcModule, logger };
};

describe('RpcDiscordPresenceService', () => {
  it('loads the real discord-rpc module without changing its public exports', async () => {
    const rpcModule = await loadDiscordRpcModule();
    const resolvedModule = rpcModule.default ?? rpcModule;

    expect(resolvedModule.Client).toEqual(expect.any(Function));
    expect(resolvedModule.register).toEqual(expect.any(Function));
  });

  it('builds a playing activity with track metadata and timestamps', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const presenceTrack = createDiscordPresenceTrackFromStatus(makeStatus(), () => track);
    const activity = createDiscordActivity(makeStatus(), presenceTrack, now);

    expect(activity).toMatchObject({
      details: 'Moonlit Signal',
      state: 'Echo Artist',
      largeImageKey: DISCORD_APP_LOGO_IMAGE_KEY,
      largeImageText: 'Night Album',
      smallImageKey: 'playing',
      instance: false,
    });
    expect(activity?.smallImageText).toContain('FLAC');
    expect(activity?.startTimestamp?.getTime()).toBe(now - 30_000);
    expect(activity?.endTimestamp?.getTime()).toBe(now + 150_000);
  });

  it('does not set dynamic timestamps for paused playback', () => {
    const status = makeStatus({ state: 'paused' });
    const presenceTrack = createDiscordPresenceTrackFromStatus(status, () => track);
    const activity = createDiscordActivity(status, presenceTrack, Date.now());

    expect(activity).toMatchObject({
      details: 'Moonlit Signal',
      state: 'Paused \u00b7 Echo Artist',
      largeImageKey: DISCORD_APP_LOGO_IMAGE_KEY,
      smallImageKey: 'paused',
    });
    expect(activity?.startTimestamp).toBeUndefined();
    expect(activity?.endTimestamp).toBeUndefined();
  });

  it('clears activity for terminal states', async () => {
    const harness = createService();
    const { service } = harness;

    await service.updateFromAudioStatus(makeStatus());
    await service.updateFromAudioStatus(makeStatus({ state: 'stopped' }));

    expect(harness.client?.setActivity).toHaveBeenCalledTimes(1);
    expect(harness.client?.clearActivity).toHaveBeenCalledTimes(1);
  });

  it('skips duplicate activity updates and throttles position-only updates', async () => {
    let now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const harness = createService({ now: () => now });
    const { service } = harness;

    await service.updateFromAudioStatus(makeStatus({ positionSeconds: 30 }));
    now += 1_000;
    await service.updateFromAudioStatus(makeStatus({ positionSeconds: 31 }));
    now += 15_000;
    await service.updateFromAudioStatus(makeStatus({ positionSeconds: 60 }));

    expect(harness.client?.setActivity).toHaveBeenCalledTimes(2);
  });

  it('serializes overlapping updates so track switches land on the latest status', async () => {
    const firstSetActivity = createDeferred<void>();
    let setActivityCalls = 0;
    const harness = createService({
      getTrack: () => null,
      setActivity: async () => {
        setActivityCalls += 1;
        if (setActivityCalls === 1) {
          await firstSetActivity.promise;
        }
      },
    });
    const { service } = harness;

    const firstUpdate = service.updateFromAudioStatus(makeStatus({
      state: 'loading',
      currentTrackId: 'streaming:qqmusic:first',
      currentTrackTitle: 'First Song',
      currentTrackArtist: 'First Artist',
    }));

    await expect.poll(() => harness.client?.setActivity).toHaveBeenCalledTimes(1);

    void service.updateFromAudioStatus(makeStatus({
      state: 'playing',
      currentTrackId: 'streaming:qqmusic:second',
      currentTrackTitle: 'Second Song',
      currentTrackArtist: 'Second Artist',
      currentTrackCoverUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000second.jpg',
    }));
    firstSetActivity.resolve();
    await firstUpdate;

    expect(harness.client?.setActivity).toHaveBeenCalledTimes(2);
    expect(harness.client?.setActivity.mock.calls.at(-1)?.[0]).toMatchObject({
      details: 'Second Song',
      state: 'Second Artist',
      largeImageKey: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000second.jpg',
    });
  });

  it('falls back to file basename when track metadata is missing', () => {
    const presenceTrack = createDiscordPresenceTrackFromStatus(
      makeStatus({ currentTrackId: 'missing', currentFilePath: 'D:\\Music\\Loose File.wav' }),
      () => null,
    );

    expect(presenceTrack.title).toBe('Loose File.wav');
    expect(presenceTrack.artist).toBe('Local file');
  });

  it('uses audio status metadata for streaming tracks missing from the library', () => {
    const coverUrl = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000album-mid.jpg';
    const presenceTrack = createDiscordPresenceTrackFromStatus(
      makeStatus({
        currentFilePath: 'streaming:qqmusic:XOcGObhe56J+NHOS6vsC5aHIK...',
        currentTrackId: 'streaming:qqmusic:0039MnYb0qxYhV',
        currentTrackTitle: 'Streaming Song',
        currentTrackArtist: 'Streaming Artist',
        currentTrackAlbum: 'Streaming Album',
        currentTrackAlbumArtist: 'Streaming Album Artist',
        currentTrackCoverUrl: `echo-image://remote/${encodeURIComponent(coverUrl)}?referer=${encodeURIComponent('https://y.qq.com/')}`,
      }),
      () => null,
    );
    const activity = createDiscordActivity(makeStatus(), presenceTrack, Date.now());

    expect(presenceTrack).toMatchObject({
      title: 'Streaming Song',
      artist: 'Streaming Artist',
      album: 'Streaming Album',
      albumArtist: 'Streaming Album Artist',
      coverImageKey: coverUrl,
    });
    expect(activity?.largeImageKey).toBe(coverUrl);
  });

  it('falls back to the app logo for non-public cover protocols', () => {
    const presenceTrack = createDiscordPresenceTrackFromStatus(
      makeStatus({
        currentTrackCoverUrl: 'echo-cover://thumb/local-cover',
      }),
      () => null,
    );
    const activity = createDiscordActivity(makeStatus(), presenceTrack, Date.now());

    expect(presenceTrack.coverImageKey).toBeNull();
    expect(activity?.largeImageKey).toBe(DISCORD_APP_LOGO_IMAGE_KEY);
  });

  it('uses a stored public network cover for local tracks with echo-cover artwork', () => {
    const networkCoverUrl = 'https://covers.example.test/local-thumb.webp';
    const presenceTrack = createDiscordPresenceTrackFromStatus(
      makeStatus({
        currentTrackCoverUrl: 'echo-cover://thumb/local-cover',
      }),
      () => ({ ...track, coverThumb: 'echo-cover://thumb/local-cover' }),
      (trackId) => (trackId === 'track-1' ? networkCoverUrl : null),
    );
    const activity = createDiscordActivity(makeStatus(), presenceTrack, Date.now());

    expect(presenceTrack.coverImageKey).toBe(networkCoverUrl);
    expect(activity?.largeImageKey).toBe(networkCoverUrl);
  });

  it('disabling clears activity', async () => {
    const harness = createService();
    const { service } = harness;

    await service.updateFromAudioStatus(makeStatus());
    service.setEnabled(false);
    await Promise.resolve();

    expect(harness.client?.clearActivity).toHaveBeenCalledTimes(1);
    expect(service.getStatus().enabled).toBe(false);
  });

  it('marks status disconnected when the RPC socket is gone', async () => {
    const harness = createService();
    const { service } = harness;

    await service.updateFromAudioStatus(makeStatus());
    expect(service.getStatus().connected).toBe(true);
    if (harness.client?.transport.socket) {
      harness.client.transport.socket.destroyed = true;
    }

    expect(service.getStatus().connected).toBe(false);
  });

  it('does not throw when discord-rpc cannot be imported', async () => {
    const { service } = createService({ loadFails: true });

    await expect(service.initialize()).resolves.toBeUndefined();
    await expect(service.updateFromAudioStatus(makeStatus())).resolves.toBeUndefined();
    expect(service.getStatus()).toMatchObject({
      available: false,
      connected: false,
      lastError: 'module unavailable',
    });
  });

  it('logs missing Discord IPC as informational instead of warning noise', async () => {
    const { service, logger } = createService({ loginFails: new Error('Could not connect') });

    await expect(service.initialize()).resolves.toBeUndefined();

    expect(service.getStatus()).toMatchObject({
      available: false,
      connected: false,
      lastError: 'Could not connect',
    });
    expect(logger.info).toHaveBeenCalledWith('[DiscordPresence] RPC initialization failed', { error: 'Could not connect' });
    expect(logger.warn).not.toHaveBeenCalledWith('[DiscordPresence] RPC initialization failed', expect.anything());
  });
});
