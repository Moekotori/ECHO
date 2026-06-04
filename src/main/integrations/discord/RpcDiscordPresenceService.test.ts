import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../../shared/types/audio';
import type { LibraryTrack } from '../../../shared/types/library';
import { createDiscordActivity, createDiscordPresenceTrackFromStatus, RpcDiscordPresenceService } from './RpcDiscordPresenceService';

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
  useJuceOutputRequested: patch.useJuceOutputRequested ?? false,
  activeDecodeBackendImpl: patch.activeDecodeBackendImpl ?? null,
  useJuceDecodeRequested: patch.useJuceDecodeRequested ?? false,
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
  setActivity = vi.fn(async () => undefined);
  clearActivity = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
}

const createService = (options: { now?: () => number; loadFails?: boolean; getTrack?: (trackId: string) => LibraryTrack | null } = {}) => {
  const clients: FakeRpcClient[] = [];
  const loadRpcModule = vi.fn(async () => {
    if (options.loadFails) {
      throw new Error('module unavailable');
    }

    return {
      Client: class extends FakeRpcClient {
        constructor() {
          super();
          clients.push(this);
        }
      },
      register: vi.fn(),
    };
  });
  const service = new RpcDiscordPresenceService({
    clientId: '1234567890',
    logger: { info: vi.fn(), warn: vi.fn() },
    loadRpcModule,
    now: options.now,
    getTrack: options.getTrack ?? (() => track),
  });

  return { service, get client() {
    return clients.at(-1) ?? null;
  }, loadRpcModule };
};

describe('RpcDiscordPresenceService', () => {
  it('builds a playing activity with track metadata and timestamps', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const presenceTrack = createDiscordPresenceTrackFromStatus(makeStatus(), () => track);
    const activity = createDiscordActivity(makeStatus(), presenceTrack, now);

    expect(activity).toMatchObject({
      details: 'Moonlit Signal',
      state: 'Echo Artist',
      largeImageKey: 'echo_logo',
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
      largeImageKey: 'echo_logo',
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

  it('falls back to file basename when track metadata is missing', () => {
    const presenceTrack = createDiscordPresenceTrackFromStatus(
      makeStatus({ currentTrackId: 'missing', currentFilePath: 'D:\\Music\\Loose File.wav' }),
      () => null,
    );

    expect(presenceTrack.title).toBe('Loose File.wav');
    expect(presenceTrack.artist).toBe('Local file');
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
});
