import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const metadataResolvers: Array<() => void> = [];
  const setMetadataMock = vi.fn((_metadata: { artist: string }) => new Promise<void>((resolve) => {
    metadataResolvers.push(resolve);
  }));
  const setPlaybackStateMock = vi.fn();
  const setTimelineMock = vi.fn();

  return {
    metadataResolvers,
    setMetadataMock,
    setPlaybackStateMock,
    setTimelineMock,
    status: {
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
      currentFilePath: 'D:\\Music\\Track.flac',
      currentTrackId: 'track-1',
      durationSeconds: 180,
      positionSeconds: 12,
      channels: 2,
      codec: 'flac',
      bitDepth: 16,
      bitrate: 900000,
      fileSampleRate: 44100,
      decoderOutputSampleRate: 44100,
      requestedOutputSampleRate: 44100,
      actualDeviceSampleRate: 44100,
      sharedDeviceSampleRate: 44100,
      resampling: false,
      bitPerfectCandidate: false,
      sampleRateMismatch: false,
      eqEnabled: false,
      channelBalanceEnabled: false,
      dspActive: false,
      preampDb: 0,
      eqPresetName: 'Flat',
      clippingRisk: false,
      bitPerfectDisabledReason: null,
      warnings: [],
      error: null,
      activeOutputBackendImpl: null,
      activeDecodeBackendImpl: null,
    },
  };
});

vi.mock('electron', () => ({
  app: {
    getAppPath: () => 'D:\\Project\\ECHONext',
    getPath: () => 'D:\\Echo',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
}));

vi.mock('../../app/appSettings', () => ({
  getAppSettings: () => ({
    smtcEnabled: true,
    smtcLyricsEnabled: true,
  }),
}));

vi.mock('../../app/windowManager', () => ({
  getMainWindow: () => null,
}));

vi.mock('../../audio/AudioSession', () => ({
  getAudioSession: () => ({
    getStatus: () => mocks.status,
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock('../../diagnostics/CrashReportService', () => ({
  getCrashReportService: () => ({
    getLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
    }),
  }),
}));

vi.mock('../../library/LibraryService', () => ({
  getLibraryService: () => ({
    getTrack: () => ({
      id: 'track-1',
      path: 'D:\\Music\\Track.flac',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      albumArtist: 'Album Artist',
      duration: 180,
      coverId: null,
    }),
    getTrackByPath: () => null,
    resolveCoverAsset: () => null,
  }),
}));

vi.mock('./getSmtcService', () => ({
  disposeAndResetSmtcService: vi.fn(),
  getSmtcService: () => ({
    initialize: vi.fn(),
    dispose: vi.fn(),
    setMetadata: mocks.setMetadataMock,
    setPlaybackState: mocks.setPlaybackStateMock,
    setTimeline: mocks.setTimelineMock,
    setEnabledActions: vi.fn(),
    onCommand: vi.fn(() => () => undefined),
  }),
}));

beforeEach(() => {
  vi.resetModules();
  mocks.metadataResolvers.length = 0;
  mocks.setMetadataMock.mockClear();
  mocks.setPlaybackStateMock.mockClear();
  mocks.setTimelineMock.mockClear();
});

const lyricsProgress = (lineText: string, lineIndex: number) => ({
  trackId: 'track-1',
  lineText,
  lineIndex,
  lineCount: 3,
  lineStartMs: lineIndex * 1000,
  positionSeconds: lineIndex,
  durationSeconds: 180,
});

describe('queued SMTC lyrics progress', () => {
  it('settles bursts before syncing and coalesces updates while a sync is already in flight', async () => {
    vi.useFakeTimers();
    const { queueSmtcLyricsProgressSync } = await import('./SmtcStatusSync');

    queueSmtcLyricsProgressSync(lyricsProgress('First line', 0));
    expect(mocks.setMetadataMock).not.toHaveBeenCalled();

    queueSmtcLyricsProgressSync(lyricsProgress('Second line', 1));
    await vi.advanceTimersByTimeAsync(349);
    expect(mocks.setMetadataMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.setMetadataMock).toHaveBeenCalledTimes(1);
    expect(mocks.setMetadataMock.mock.calls[0][0].artist).toContain('Second line');
    expect(mocks.setMetadataMock.mock.calls[0][0].artist).not.toContain('First line');

    queueSmtcLyricsProgressSync(lyricsProgress('Third line', 2));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.setMetadataMock).toHaveBeenCalledTimes(1);

    mocks.metadataResolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(749);
    expect(mocks.setMetadataMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);

    expect(mocks.setMetadataMock).toHaveBeenCalledTimes(2);
    expect(mocks.setMetadataMock.mock.calls[1][0].artist).toContain('Third line');
    expect(mocks.setMetadataMock.mock.calls[1][0].artist).not.toContain('Second line');

    mocks.metadataResolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  });

  it('clears lyrics progress without waiting for the settle window', async () => {
    vi.useFakeTimers();
    const { queueSmtcLyricsProgressSync } = await import('./SmtcStatusSync');

    queueSmtcLyricsProgressSync(null);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.setMetadataMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
