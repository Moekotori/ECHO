// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectSessionStatus } from '../../../shared/types/connect';
import type { LibraryTrack } from '../../../shared/types/library';
import type {
  MainWindowPlaybackControlRequest,
  PersistedPlaybackSessionV1,
} from '../../../shared/types/playback';
import { PlaybackQueueProvider, usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { setPlaybackStatusSnapshot } from '../../stores/playbackStatusStore';
import { PlaybackCommandController } from './PlaybackCommandController';

const makeTrack = (): LibraryTrack => ({
  id: 'integration-control-track',
  path: 'D:\\Music\\integration-control.flac',
  title: 'Integration Control',
  artist: 'ECHO',
  album: 'Link v2',
  albumArtist: 'ECHO',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
});

const makeConnectStatus = (track: LibraryTrack): ConnectSessionStatus => ({
  deviceId: 'dlna:integration-device',
  protocol: 'dlna',
  state: 'paused',
  currentTrackId: track.id,
  metadata: {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    durationSeconds: track.duration,
    coverHttpUrl: '',
  },
  positionSeconds: 12,
  durationSeconds: track.duration,
  latencyMs: 50,
  error: null,
  updatedAt: '2026-07-17T00:00:00.000Z',
});

const QueueSeed = ({ track }: { track: LibraryTrack }): null => {
  const { replaceQueue, setCurrentTrackId } = usePlaybackQueue();

  useEffect(() => {
    replaceQueue([track]);
    setCurrentTrackId(track.id);
  }, [replaceQueue, setCurrentTrackId, track]);

  return null;
};

const installBridge = (options: { includeConnectVolume?: boolean } = {}) => {
  const track = makeTrack();
  const connectStatus = makeConnectStatus(track);
  const connectPlay = vi.fn().mockResolvedValue({ ...connectStatus, state: 'playing' });
  const localPlay = vi.fn();
  const localSetOutput = vi.fn();
  const getQueueSession = vi.fn().mockResolvedValue(null);
  const saveQueueSession = vi.fn(async (
    session: PersistedPlaybackSessionV1,
  ): Promise<PersistedPlaybackSessionV1> => session);
  let controlHandler: ((request: MainWindowPlaybackControlRequest) => Promise<void>) | null = null;

  window.echo = {
    playback: {
      getStatus: vi.fn().mockResolvedValue({
        state: 'paused',
        currentTrackId: track.id,
        positionMs: 12_000,
        durationMs: track.duration * 1000,
        filePath: track.path,
      }),
      getQueueSession,
      saveQueueSession,
      playLocalFile: vi.fn(),
      play: localPlay,
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      openLocalAudioFile: vi.fn(),
      onMainWindowControl: vi.fn((handler) => {
        controlHandler = handler;
        return () => {
          if (controlHandler === handler) {
            controlHandler = null;
          }
        };
      }),
    },
    connect: {
      getStatus: vi.fn().mockResolvedValue(connectStatus),
      play: connectPlay,
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      setVolume: options.includeConnectVolume ? vi.fn() : undefined,
      onStatus: vi.fn(() => vi.fn()),
    },
    audio: {
      getStatus: vi.fn().mockResolvedValue({
        host: 'ready',
        state: 'paused',
        currentFilePath: track.path,
        currentTrackId: track.id,
        positionSeconds: 12,
        durationSeconds: track.duration,
        volume: 1,
        error: null,
      }),
      onStatus: vi.fn(() => vi.fn()),
      setOutput: localSetOutput,
    },
    app: {
      getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      setSettings: vi.fn().mockResolvedValue({}),
    },
  } as unknown as Window['echo'];

  setPlaybackStatusSnapshot({
    audioStatus: null,
    playbackStatus: {
      state: 'paused',
      currentTrackId: track.id,
      positionMs: 12_000,
      durationMs: track.duration * 1000,
      filePath: track.path,
    },
    playbackVisualIntent: null,
    error: null,
  });

  return {
    connectPlay,
    getControlHandler: () => controlHandler,
    getQueueSession,
    localPlay,
    localSetOutput,
    saveQueueSession,
    track,
  };
};

afterEach(() => {
  cleanup();
  setPlaybackStatusSnapshot({
    audioStatus: null,
    playbackStatus: null,
    playbackVisualIntent: null,
    error: null,
  });
  window.echo = undefined as unknown as Window['echo'];
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('PlaybackCommandController integration controls', () => {
  it('routes an explicit main-window play command through the active Connect provider', async () => {
    const bridge = installBridge();

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed track={bridge.track} />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(bridge.getControlHandler()).toBeTruthy());
    await act(async () => {
      await bridge.getControlHandler()?.({ type: 'play' });
    });

    expect(bridge.connectPlay).toHaveBeenCalledTimes(1);
    expect(bridge.localPlay).not.toHaveBeenCalled();
  });

  it('fails closed when an active Connect provider lacks the requested control', async () => {
    const bridge = installBridge();

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed track={bridge.track} />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(bridge.getControlHandler()).toBeTruthy());
    await expect(bridge.getControlHandler()?.({ type: 'setVolume', volume: 0.4 })).rejects.toThrow(
      'main_window_playback_controller_unavailable',
    );
    expect(bridge.localSetOutput).not.toHaveBeenCalled();
  });

  it('applies and persists remote playback-order changes before acknowledging them', async () => {
    const bridge = installBridge();

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed track={bridge.track} />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(bridge.getControlHandler()).toBeTruthy());
    await waitFor(() => expect(bridge.getQueueSession).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    bridge.saveQueueSession.mockClear();

    await act(async () => {
      await bridge.getControlHandler()?.({ type: 'setPlaybackOrder', mode: 'shuffle' });
    });
    expect(bridge.saveQueueSession.mock.calls.at(-1)?.[0].mode).toMatchObject({
      isShuffleEnabled: true,
      repeatMode: 'off',
    });

    await act(async () => {
      await bridge.getControlHandler()?.({ type: 'setPlaybackOrder', mode: 'repeat-one' });
    });
    expect(bridge.saveQueueSession.mock.calls.at(-1)?.[0].mode).toMatchObject({
      isShuffleEnabled: false,
      repeatMode: 'one',
    });

    await act(async () => {
      await bridge.getControlHandler()?.({ type: 'setPlaybackOrder', mode: 'sequential' });
    });
    expect(bridge.saveQueueSession.mock.calls.at(-1)?.[0].mode).toMatchObject({
      isShuffleEnabled: false,
      repeatMode: 'off',
    });
  });
});
