import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { TrackLyrics } from '../../shared/types/lyrics';
import { registerLyricsIpc } from './lyricsIpc';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getLyricsForTrackMock: vi.fn(),
  audioStatus: {
    state: 'idle',
    outputMode: 'shared',
    nativeUnderrunCallbacks: 0,
    nativeBufferedMs: null as number | null,
    warnings: [] as string[],
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));

vi.mock('../lyrics/LyricsService', () => ({
  getLyricsService: () => ({
    getLyricsForTrack: mocks.getLyricsForTrackMock,
  }),
}));

vi.mock('../audio/AudioSession', () => ({
  getAudioSession: () => ({
    getStatus: () => mocks.audioStatus,
  }),
}));

const trackLyrics = (trackId: string): TrackLyrics => ({
  id: `lyrics-${trackId}`,
  trackId,
  provider: 'cached',
  kind: 'synced',
  title: 'Song',
  artist: 'Artist',
  album: null,
  durationSeconds: 180,
  lines: [{ timeMs: 0, text: 'Line' }],
  offsetMs: 0,
  cachedAt: '2026-06-24T00:00:00.000Z',
  updatedAt: '2026-06-24T00:00:00.000Z',
});

describe('lyrics IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.getLyricsForTrackMock.mockReset();
    mocks.audioStatus = {
      state: 'idle',
      outputMode: 'shared',
      nativeUnderrunCallbacks: 0,
      nativeBufferedMs: null,
      warnings: [],
    };
  });

  it('coalesces concurrent get-for-track requests for the same track', async () => {
    let resolveFirst!: (value: TrackLyrics | null) => void;
    mocks.getLyricsForTrackMock.mockImplementationOnce(
      () => new Promise<TrackLyrics | null>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    registerLyricsIpc();
    const handler = mocks.handlers.get(IpcChannels.LyricsGetForTrack);
    expect(handler).toBeTruthy();

    const first = handler?.(null, 'track-1') as Promise<TrackLyrics | null>;
    const second = handler?.(null, 'track-1') as Promise<TrackLyrics | null>;
    expect(mocks.getLyricsForTrackMock).toHaveBeenCalledTimes(1);

    const result = trackLyrics('track-1');
    resolveFirst(result);
    await expect(first).resolves.toBe(result);
    await expect(second).resolves.toBe(result);

    mocks.getLyricsForTrackMock.mockResolvedValueOnce(null);
    await expect(handler?.(null, 'track-1')).resolves.toBeNull();
    expect(mocks.getLyricsForTrackMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the full lyrics lookup while exclusive playback is stable', async () => {
    mocks.audioStatus = {
      state: 'playing',
      outputMode: 'exclusive',
      nativeUnderrunCallbacks: 0,
      nativeBufferedMs: 80,
      warnings: [],
    };
    mocks.getLyricsForTrackMock.mockResolvedValue(trackLyrics('track-1'));

    registerLyricsIpc();
    const handler = mocks.handlers.get(IpcChannels.LyricsGetForTrack);

    await expect(handler?.(null, 'track-1')).resolves.toMatchObject({ trackId: 'track-1' });
    expect(mocks.getLyricsForTrackMock).toHaveBeenCalledWith('track-1', undefined);
  });

  it('uses a low-load lyrics lookup while exclusive playback has underruns', async () => {
    mocks.audioStatus = {
      state: 'playing',
      outputMode: 'exclusive',
      nativeUnderrunCallbacks: 3,
      nativeBufferedMs: 0,
      warnings: [],
    };
    mocks.getLyricsForTrackMock.mockResolvedValue(trackLyrics('track-1'));

    registerLyricsIpc();
    const handler = mocks.handlers.get(IpcChannels.LyricsGetForTrack);

    await expect(handler?.(null, 'track-1')).resolves.toMatchObject({ trackId: 'track-1' });
    expect(mocks.getLyricsForTrackMock).toHaveBeenCalledWith('track-1', expect.objectContaining({
      autoSearch: false,
      deepSearchEnabled: false,
      enabledProviders: ['local'],
      networkEnabled: false,
    }));
  });
});
