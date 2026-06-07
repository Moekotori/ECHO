// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../shared/types/audio';
import { hqPlayerConnectDeviceId, type ConnectSessionStatus } from '../../shared/types/connect';
import type { LibraryPlaylistItem, LibraryTrack } from '../../shared/types/library';
import type { PersistedPlaybackSessionV1 } from '../../shared/types/playback';
import { PlaybackQueueProvider, isPlaybackCancellationError, usePlaybackQueue } from './PlaybackQueueProvider';
import { useSharedPlaybackStatus } from './playbackStatusStore';

const makeTrack = (index: number): LibraryTrack => ({
  id: `track-${index}`,
  path: `D:\\Music\\track-${index}.flac`,
  title: `Track ${index}`,
  artist: `Artist ${index}`,
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: index,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 120,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

const makeLikedPlaylistItem = (track: LibraryTrack, sourceProvider: LibraryPlaylistItem['sourceProvider'] = 'local'): LibraryPlaylistItem => ({
  id: `liked-${track.id}`,
  playlistId: 'liked-tracks',
  mediaType: 'track',
  mediaId: track.id,
  sourceProvider,
  sourceItemId: track.id,
  titleSnapshot: track.title,
  artistSnapshot: track.artist,
  albumSnapshot: track.album,
  durationSnapshot: track.duration,
  coverId: track.coverId,
  coverThumb: track.coverThumb,
  position: 0,
  addedAt: '2026-05-21T00:00:00.000Z',
  addedFrom: null,
  unavailable: false,
  track,
});

const makePersistedQueueSession = (
  tracks: LibraryTrack[],
  options: Partial<PersistedPlaybackSessionV1> = {},
): PersistedPlaybackSessionV1 => {
  const items = tracks.map((track, index) => ({
    queueId: `queue-${index + 1}`,
    track,
    source: { type: 'manual' as const, label: 'Manual queue' },
    addedAt: `2026-05-21T00:00:0${index}.000Z`,
  }));
  const currentItem = items[0] ?? null;

  return {
    version: 1,
    items,
    currentQueueId: currentItem?.queueId ?? null,
    currentTrackId: currentItem?.track.id ?? null,
    lastPlayedTrack: currentItem?.track ?? null,
    history: [],
    mode: {
      isShuffleEnabled: false,
      repeatMode: 'off',
      automixEnabled: false,
    },
    resume: null,
    updatedAt: '2026-05-21T00:00:00.000Z',
    ...options,
  };
};

const deferredPlaybackTaskWaitMs = 2_500;

const waitForDeferredPlaybackTask = async (assertion: () => void): Promise<void> => {
  await waitFor(assertion, { timeout: deferredPlaybackTaskWaitMs });
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete (window as Partial<Window>).echo;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PlaybackQueueProvider playback history session', () => {
  it('identifies internal playback cancellation errors', () => {
    expect(isPlaybackCancellationError(new Error('audio_session_run_cancelled'))).toBe(true);
    expect(isPlaybackCancellationError(new Error('native device failed'))).toBe(false);
  });

  it('hydrates queue changes pushed from another playback window', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    let handleQueueSessionChanged: ((snapshot: PersistedPlaybackSessionV1 | null) => void) | null = null;
    const unsubscribe = vi.fn();

    window.echo = {
      playback: {
        onQueueSessionChanged: vi.fn((handler: (snapshot: PersistedPlaybackSessionV1 | null) => void) => {
          handleQueueSessionChanged = handler;
          return unsubscribe;
        }),
      },
    } as unknown as Window['echo'];

    const QueueProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="current-title">{queue.currentTrack?.title ?? ''}</output>
          <output aria-label="queue-size">{queue.items.length}</output>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <QueueProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(window.echo?.playback?.onQueueSessionChanged).toHaveBeenCalled());

    const snapshot = makePersistedQueueSession([first, second], {
      currentQueueId: 'queue-2',
      currentTrackId: second.id,
      lastPlayedTrack: second,
      history: [
        {
          queueId: 'queue-1',
          track: first,
          source: { type: 'manual', label: 'Manual queue' },
          addedAt: '2026-05-21T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-05-21T00:00:10.000Z',
    });

    act(() => {
      handleQueueSessionChanged?.(snapshot);
    });

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe(second.id));
    expect(screen.getByLabelText('current-title').textContent).toBe(second.title);
    expect(screen.getByLabelText('queue-size').textContent).toBe('2');

    cleanup();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('hydrates active playlist playback pushed from another playback window', async () => {
    const savedQueueTrack = makeTrack(1);
    const playlistTracks = [makeTrack(3), makeTrack(4)];
    let handleQueueSessionChanged: ((snapshot: PersistedPlaybackSessionV1 | null) => void) | null = null;

    window.echo = {
      playback: {
        onQueueSessionChanged: vi.fn((handler: (snapshot: PersistedPlaybackSessionV1 | null) => void) => {
          handleQueueSessionChanged = handler;
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];

    const QueueProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="queue-track-ids">{queue.items.map((item) => item.track.id).join(',')}</output>
          <output aria-label="playlist-active">{queue.playlistPlayback.active ? 'yes' : 'no'}</output>
          <output aria-label="playlist-label">{queue.playlistPlayback.label ?? ''}</output>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <QueueProbe />
      </PlaybackQueueProvider>,
    );

    const savedQueue = makePersistedQueueSession([savedQueueTrack]);
    const playlistSession = makePersistedQueueSession(playlistTracks, {
      currentQueueId: 'queue-1',
      currentTrackId: playlistTracks[0].id,
      lastPlayedTrack: playlistTracks[0],
      playlistPlayback: {
        active: true,
        label: 'Road Mix',
        playlistId: 'playlist-1',
        snapshot: {
          items: savedQueue.items,
          currentQueueId: savedQueue.currentQueueId,
          currentTrackId: savedQueue.currentTrackId,
          lastPlayedTrack: savedQueue.lastPlayedTrack,
          history: savedQueue.history,
          mode: savedQueue.mode,
          resume: savedQueue.resume,
        },
      },
    });

    act(() => {
      handleQueueSessionChanged?.(playlistSession);
    });

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-3'));
    expect(screen.getByLabelText('queue-track-ids').textContent).toBe('track-3,track-4');
    expect(screen.getByLabelText('playlist-active').textContent).toBe('yes');
    expect(screen.getByLabelText('playlist-label').textContent).toBe('Road Mix');
  });

  it('routes manual playback to the active HQPlayer Connect output instead of local playback', async () => {
    const track = makeTrack(1);
    const playLocalFile = vi.fn();
    const connectTrack = vi.fn().mockResolvedValue({
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'playing',
      currentTrackId: track.id,
      metadata: null,
      positionSeconds: 0,
      durationSeconds: track.duration,
      latencyMs: 9,
      error: null,
      updatedAt: '2026-05-21T01:00:00.000Z',
    });

    window.echo = {
      playback: {
        playLocalFile,
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue({
          deviceId: hqPlayerConnectDeviceId,
          protocol: 'hqplayer',
          state: 'playing',
          currentTrackId: 'previous-track',
          metadata: null,
          positionSeconds: 0,
          durationSeconds: 120,
          latencyMs: null,
          error: null,
          updatedAt: '2026-05-21T01:00:00.000Z',
        }),
        connect: connectTrack,
      },
    } as unknown as Window['echo'];

    const AutoPlay = (): JSX.Element => {
      const { playTrack } = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void playTrack(track);
      }, [playTrack]);

      return <span hidden />;
    };

    render(
      <PlaybackQueueProvider>
        <AutoPlay />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(connectTrack).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: hqPlayerConnectDeviceId,
      track,
      filePath: track.path,
      positionSeconds: 0,
    })));
    expect(playLocalFile).not.toHaveBeenCalled();
  });

  it('keeps queue navigation on HQPlayer after takeover even when Connect status is idle', async () => {
    const first = makeTrack(1);
    const second: LibraryTrack = { ...makeTrack(2), unavailable: true };
    const playLocalFile = vi.fn();
    const connectTrack = vi.fn().mockImplementation(async (request: { track: LibraryTrack }) => ({
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'playing',
      currentTrackId: request.track.id,
      metadata: null,
      positionSeconds: 0,
      durationSeconds: request.track.duration,
      latencyMs: 9,
      error: null,
      updatedAt: '2026-05-21T01:00:00.000Z',
    }));

    window.echo = {
      playback: {
        playLocalFile,
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue({
          deviceId: null,
          protocol: null,
          state: 'idle',
          currentTrackId: null,
          metadata: null,
          positionSeconds: 0,
          durationSeconds: 0,
          latencyMs: null,
          error: null,
          updatedAt: '2026-05-21T01:00:00.000Z',
        }),
        connect: connectTrack,
      },
    } as unknown as Window['echo'];

    const ActivateAndAdvance = (): JSX.Element => {
      const { activateHqPlayerTakeover, playNext, replaceQueue } = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        replaceQueue([first, second], { startTrackId: first.id });
        void (async () => {
          await activateHqPlayerTakeover();
          await playNext();
        })();
      }, [activateHqPlayerTakeover, playNext, replaceQueue]);

      return <span hidden />;
    };

    render(
      <PlaybackQueueProvider>
        <ActivateAndAdvance />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(connectTrack).toHaveBeenCalledTimes(2));
    expect(connectTrack.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      deviceId: hqPlayerConnectDeviceId,
      track: first,
      filePath: first.path,
    }));
    expect(connectTrack.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      deviceId: hqPlayerConnectDeviceId,
      track: second,
      filePath: second.path,
    }));
    expect(playLocalFile).not.toHaveBeenCalled();
  });

  it('syncs active DLNA status into the queue current item', async () => {
    const localTrack = makeTrack(1);
    const dlnaTrack = makeTrack(2);
    let emitConnectStatus: ((status: ConnectSessionStatus) => void) | null = null;

    window.echo = {
      connect: {
        onStatus: vi.fn((listener: (status: ConnectSessionStatus) => void) => {
          emitConnectStatus = listener;
          return () => undefined;
        }),
      },
    } as unknown as Window['echo'];

    const QueueProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const sharedStatus = useSharedPlaybackStatus();
      const didSeedRef = useRef(false);

      useEffect(() => {
        if (didSeedRef.current) {
          return;
        }
        didSeedRef.current = true;
        queue.replaceQueue([localTrack, dlnaTrack], { startTrackId: localTrack.id });
        queue.setCurrentTrackId(localTrack.id);
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="current-title">{queue.currentTrack?.title ?? ''}</output>
          <output aria-label="shared-file">{sharedStatus.playbackStatus?.filePath ?? ''}</output>
          <output aria-label="shared-position">{sharedStatus.playbackStatus?.positionMs ?? ''}</output>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <QueueProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(window.echo?.connect?.onStatus).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe(localTrack.id));

    act(() => {
      emitConnectStatus?.({
        deviceId: 'dlna:renderer-1',
        protocol: 'dlna',
        state: 'playing',
        currentTrackId: dlnaTrack.id,
        metadata: {
          title: dlnaTrack.title,
          artist: dlnaTrack.artist,
          album: dlnaTrack.album,
          albumArtist: dlnaTrack.albumArtist,
          durationSeconds: dlnaTrack.duration,
          coverHttpUrl: '',
        },
        positionSeconds: 18.25,
        durationSeconds: dlnaTrack.duration,
        latencyMs: 32,
        error: null,
        updatedAt: '2026-05-30T09:30:00.000Z',
      });
    });

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe(dlnaTrack.id));
    expect(screen.getByLabelText('current-title').textContent).toBe(dlnaTrack.title);
    expect(screen.getByLabelText('shared-file').textContent).toBe(dlnaTrack.path);
    expect(screen.getByLabelText('shared-position').textContent).toBe('18250');
  });

  it('does not wait for history writes before switching tracks', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    let resolveFinish: (() => void) | null = null;
    const startPlaybackHistory = vi
      .fn()
      .mockResolvedValueOnce({ historyId: 'history-1' })
      .mockResolvedValueOnce({ historyId: 'history-2' });
    const finishPlaybackHistory = vi.fn(() => new Promise<void>((resolve) => {
      resolveFinish = resolve;
    }));
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
      library: {
        startPlaybackHistory,
        finishPlaybackHistory,
      },
    } as unknown as Window['echo'];

    const AutoPlayFirst = (): JSX.Element => {
      const { playNext, playTrack, replaceQueue } = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        replaceQueue([first, second]);
        void playTrack(first);
      }, [playTrack, replaceQueue]);

      return <button type="button" onClick={() => void playNext()}>next</button>;
    };

    render(
      <PlaybackQueueProvider>
        <AutoPlayFirst />
      </PlaybackQueueProvider>,
    );

    await waitForDeferredPlaybackTask(() => expect(startPlaybackHistory).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: second.id })));
    await waitForDeferredPlaybackTask(() =>
      expect(finishPlaybackHistory).toHaveBeenCalledWith(expect.objectContaining({ historyId: 'history-1' })),
    );
    await waitForDeferredPlaybackTask(() => expect(startPlaybackHistory).toHaveBeenCalledTimes(2));
    const finish = resolveFinish ?? (() => undefined);
    finish();
  });

  it('keeps the current playback speed when advancing to the next local track', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const prepareLocalFile = vi.fn().mockResolvedValue(undefined);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          playbackRate: 1.5,
          playbackSpeedMode: 'nightcore',
        }),
      },
    } as unknown as Window['echo'];

    const AutoPlayFirst = (): JSX.Element => {
      const { playNext, playTrack, replaceQueue } = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        replaceQueue([first, second]);
        void playTrack(first);
      }, [playTrack, replaceQueue]);

      return <button type="button" onClick={() => void playNext()}>next</button>;
    };

    render(
      <PlaybackQueueProvider>
        <AutoPlayFirst />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() =>
      expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({
        trackId: second.id,
        output: {
          playbackRate: 1.5,
          playbackSpeedMode: 'nightcore',
        },
      })),
    );
  });

  it('opens temporary local files, queues them, and records history from snapshots', async () => {
    const first = { ...makeTrack(1), id: 'temporary-local:first', isTemporary: true, title: 'Loose File' };
    const second = { ...makeTrack(2), id: 'temporary-local:second', isTemporary: true };
    const startPlaybackHistory = vi.fn().mockResolvedValue({ historyId: 'history-temp' });
    const resolveLocalAudioFiles = vi.fn().mockResolvedValue({ tracks: [first, second], rejected: [] });
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        resolveLocalAudioFiles,
        playLocalFile,
      },
      library: {
        startPlaybackHistory,
      },
    } as unknown as Window['echo'];

    const OpenFilesProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();

      return (
        <div>
          <output aria-label="queue-size">{queue.items.length}</output>
          <output aria-label="current-title">{queue.currentTrack?.title ?? ''}</output>
          <button type="button" onClick={() => void queue.openTemporaryLocalFiles(['D:\\Loose\\one.flac', 'D:\\Loose\\two.flac'])}>
            open
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <OpenFilesProbe />
      </PlaybackQueueProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'open' }));

    await waitFor(() => expect(screen.getByLabelText('current-title').textContent).toBe('Loose File'));
    expect(screen.getByLabelText('queue-size').textContent).toBe('2');
    expect(resolveLocalAudioFiles).toHaveBeenCalledWith(['D:\\Loose\\one.flac', 'D:\\Loose\\two.flac']);
    expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: first.path, trackId: first.id }));
    await waitForDeferredPlaybackTask(() => expect(startPlaybackHistory).toHaveBeenCalledWith(expect.objectContaining({
      trackId: null,
      trackPath: first.path,
      title: first.title,
      sourceType: 'local-file',
    })));
  });

  it('prepares only the next local queue item after playback starts', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const third = makeTrack(3);
    const prepareLocalFile = vi.fn().mockResolvedValue(undefined);
    const prepareMediaItem = vi.fn().mockResolvedValue(undefined);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
        prepareLocalFile,
        prepareMediaItem,
      },
    } as unknown as Window['echo'];

    const AutoPlayFirst = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second, third]);
        void queue.playTrack(first);
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutoPlayFirst />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: first.id })));
    await waitForDeferredPlaybackTask(() => expect(prepareLocalFile).toHaveBeenCalledTimes(1));
    expect(prepareLocalFile).toHaveBeenCalledWith({
      filePath: second.path,
      trackId: second.id,
      probe: {
        durationSeconds: second.duration,
        fileSampleRate: second.sampleRate,
        channels: 2,
        codec: second.codec,
        bitDepth: second.bitDepth,
        bitrate: second.bitrate,
      },
      replayGain: null,
    });
    expect(prepareMediaItem).not.toHaveBeenCalled();
  });

  it('keeps long-track Automix deferred at playback start after opt-in', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const third = makeTrack(3);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const AutomixProbe = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second, third]);
        void queue.playTrack(first).then(() => {
          queue.setAutomixEnabled(true);
          return queue.playTrack(first);
        });
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));
    expect(playLocalFile.mock.calls[0]?.[0].automix).toBeUndefined();
    expect(playLocalFile.mock.calls[1]?.[0].automix).toBeUndefined();
  });

  it('keeps short-track Automix off the initial play request to avoid startup premix', async () => {
    const first = { ...makeTrack(1), duration: 48 };
    const second = { ...makeTrack(2), duration: 48 };
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const AutomixProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second]);
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return <output aria-label="current-duration">{queue.currentTrack?.duration ?? ''}</output>;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(playLocalFile.mock.calls[0]?.[0].automix).toBeUndefined();
  });

  it('keeps unknown-duration Automix off the initial play request', async () => {
    const first = { ...makeTrack(1), duration: 0 };
    const second = makeTrack(2);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 0,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const AutomixProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second]);
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return <output aria-label="current-duration">{queue.currentTrack?.duration ?? ''}</output>;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(playLocalFile.mock.calls[0]?.[0].automix).toBeUndefined();
  });

  it('uses audio status duration when arming Automix for an unknown-duration track', async () => {
    const first = { ...makeTrack(1), duration: 0 };
    const second = makeTrack(2);
    const audioStatusHandlers: Array<(status: AudioStatus) => void> = [];
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string; startSeconds?: number }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: Math.round((request.startSeconds ?? 0) * 1000),
        durationMs: Math.round((request.trackId === first.id ? 48 : second.duration) * 1000),
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
      audio: {
        onStatus: vi.fn((handler: (status: AudioStatus) => void) => {
          audioStatusHandlers.push(handler);
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];

    const AutomixProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second]);
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return <output aria-label="current-duration">{queue.currentTrack?.duration ?? ''}</output>;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    audioStatusHandlers.at(-1)?.({
      state: 'playing',
      currentTrackId: first.id,
      currentFilePath: first.path,
      positionSeconds: 17,
      durationSeconds: 48,
      automix: { enabled: false, active: false, mode: 'off', transitionSeconds: null, transitionStartedAtSeconds: null, nextTrackId: null },
    } as AudioStatus);

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText('current-duration').textContent).toBe('48'));
    expect(playLocalFile.mock.calls[1]?.[0]).toMatchObject({
      trackId: first.id,
      startSeconds: 17,
      probe: expect.objectContaining({
        durationSeconds: 48,
      }),
      automix: {
        enabled: true,
      },
    });
  });

  it('arms short-track Automix after playback has started instead of blocking startup', async () => {
    const first = { ...makeTrack(1), duration: 48 };
    const second = { ...makeTrack(2), duration: 48 };
    const audioStatusHandlers: Array<(status: AudioStatus) => void> = [];
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string; startSeconds?: number }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: Math.round((request.startSeconds ?? 0) * 1000),
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
      audio: {
        onStatus: vi.fn((handler: (status: AudioStatus) => void) => {
          audioStatusHandlers.push(handler);
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];

    const AutomixProbe = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second]);
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    audioStatusHandlers.at(-1)?.({
      state: 'playing',
      currentTrackId: first.id,
      currentFilePath: first.path,
      positionSeconds: 16,
      durationSeconds: first.duration,
      automix: { enabled: false, active: false, mode: 'off', transitionSeconds: null, transitionStartedAtSeconds: null, nextTrackId: null },
    } as AudioStatus);
    expect(playLocalFile).toHaveBeenCalledTimes(1);

    audioStatusHandlers.at(-1)?.({
      state: 'playing',
      currentTrackId: first.id,
      currentFilePath: first.path,
      positionSeconds: 17,
      durationSeconds: first.duration,
      automix: { enabled: false, active: false, mode: 'off', transitionSeconds: null, transitionStartedAtSeconds: null, nextTrackId: null },
    } as AudioStatus);

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));
    expect(playLocalFile.mock.calls[1]?.[0]).toMatchObject({
      trackId: first.id,
      startSeconds: 17,
      automix: {
        enabled: true,
        nextItem: {
          mediaType: 'local',
          trackId: second.id,
          path: second.path,
        },
      },
    });
  });

  it('prewarms Automix analysis for the next local track after opt-in', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const prepareLocalFile = vi.fn().mockResolvedValue(undefined);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
        prepareLocalFile,
      },
    } as unknown as Window['echo'];

    const AutomixPrepareProbe = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second]);
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixPrepareProbe />
      </PlaybackQueueProvider>,
    );

    await waitForDeferredPlaybackTask(() => expect(prepareLocalFile).toHaveBeenCalledTimes(1));
    expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({
      trackId: first.id,
      automixAnalyze: true,
    }));
    expect(prepareLocalFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: second.path,
      trackId: second.id,
      automixAnalyze: true,
    }));
  });

  it('prewarms BPM analysis for the next Automix candidate when audio analysis is enabled', async () => {
    const first = makeTrack(1);
    const second = { ...makeTrack(2), bpm: null, bpmConfidence: null, beatOffsetMs: null, analysisStatus: 'none' as const };
    const analyzedSecond = {
      ...second,
      bpm: 128,
      bpmConfidence: 0.92,
      beatOffsetMs: 16,
      analysisStatus: 'complete' as const,
      analysisUpdatedAt: '2026-05-25T01:00:00.000Z',
    };
    const startBpmAnalysis = vi.fn().mockResolvedValue({
      id: 'bpm-job-1',
      status: 'completed',
      totalTracks: 1,
      processedTracks: 1,
      updatedTracks: 1,
      errorCount: 0,
      currentTrackTitle: null,
      startedAt: '2026-05-25T00:59:00.000Z',
      finishedAt: '2026-05-25T01:00:00.000Z',
      errors: [],
    });
    const prepareLocalFile = vi.fn().mockResolvedValue(undefined);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ audioAnalysisEnabled: true }),
      },
      library: {
        startBpmAnalysis,
        getBpmAnalysisStatus: vi.fn(),
        getTrack: vi.fn().mockResolvedValue(analyzedSecond),
      },
      playback: {
        playLocalFile,
        prepareLocalFile,
      },
    } as unknown as Window['echo'];

    const AutomixBpmProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);
      const queuedSecond = queue.items.find((item) => item.track.id === second.id)?.track ?? null;

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second]);
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return <output aria-label="next-bpm">{queuedSecond?.bpm ?? 'missing'}</output>;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixBpmProbe />
      </PlaybackQueueProvider>,
    );

    await waitForDeferredPlaybackTask(() => expect(startBpmAnalysis).toHaveBeenCalledWith({ trackIds: [second.id] }));
    await waitFor(() => expect(screen.getByLabelText('next-bpm').textContent).toBe('128'));
    await waitForDeferredPlaybackTask(() => expect(prepareLocalFile).toHaveBeenCalledWith(expect.objectContaining({
      trackId: second.id,
      automixAnalyze: true,
    })));
  });

  it('does not prewarm BPM analysis for Automix when audio analysis is disabled', async () => {
    const first = makeTrack(1);
    const second = { ...makeTrack(2), bpm: null, bpmConfidence: null, beatOffsetMs: null, analysisStatus: 'none' as const };
    const getSettings = vi.fn().mockResolvedValue({ audioAnalysisEnabled: false });
    const startBpmAnalysis = vi.fn();
    const prepareLocalFile = vi.fn().mockResolvedValue(undefined);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      app: {
        getSettings,
      },
      library: {
        startBpmAnalysis,
        getBpmAnalysisStatus: vi.fn(),
        getTrack: vi.fn(),
      },
      playback: {
        playLocalFile,
        prepareLocalFile,
      },
    } as unknown as Window['echo'];

    const AutomixBpmProbe = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second]);
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixBpmProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    expect(startBpmAnalysis).not.toHaveBeenCalled();
    await waitForDeferredPlaybackTask(() => expect(prepareLocalFile).toHaveBeenCalledWith(expect.objectContaining({
      trackId: second.id,
      automixAnalyze: true,
    })));
  });

  it('arms Automix near the end of a long local track', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const third = makeTrack(3);
    const audioStatusHandlers: Array<(status: AudioStatus) => void> = [];
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string; startSeconds?: number }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: Math.round((request.startSeconds ?? 0) * 1000),
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
      audio: {
        onStatus: vi.fn((handler: (status: AudioStatus) => void) => {
          audioStatusHandlers.push(handler);
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];

    const AutomixProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const status = useSharedPlaybackStatus();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second, third]);
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return (
        <div>
          <output aria-label="visual-state">{status.playbackVisualIntent?.state ?? ''}</output>
          <output aria-label="visual-start">{status.playbackVisualIntent?.startedAtMs ?? ''}</output>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <AutomixProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(playLocalFile.mock.calls[0]?.[0].automix).toBeUndefined();
    await waitFor(() => expect(screen.getByLabelText('visual-start').textContent).not.toBe(''));
    const initialVisualStart = screen.getByLabelText('visual-start').textContent;

    expect(audioStatusHandlers.length).toBeGreaterThan(0);
    audioStatusHandlers.at(-1)?.({
      state: 'playing',
      currentTrackId: first.id,
      currentFilePath: first.path,
      positionSeconds: 80,
      durationSeconds: first.duration,
      automix: { enabled: false, active: false, mode: 'off', transitionSeconds: null, transitionStartedAtSeconds: null, nextTrackId: null },
    } as AudioStatus);

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('visual-state').textContent).toBe('playing');
    expect(screen.getByLabelText('visual-start').textContent).toBe(initialVisualStart);
    expect(playLocalFile.mock.calls[1]?.[0]).toMatchObject({
      trackId: first.id,
      startSeconds: 80,
      automix: {
        enabled: true,
        maxTransitionSeconds: 16,
        beatAlignEnabled: true,
        nextItem: {
          mediaType: 'local',
          trackId: second.id,
          path: second.path,
        },
      },
    });
    expect(playLocalFile.mock.calls[1]?.[0].automixAnalyze).toBeUndefined();
    expect(playLocalFile.mock.calls[1]?.[0].automix).not.toHaveProperty('upcomingItems');
  });

  it('arms long-track Automix with enough prebuffer window before the transition', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const audioStatusHandlers: Array<(status: AudioStatus) => void> = [];
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string; startSeconds?: number }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: Math.round((request.startSeconds ?? 0) * 1000),
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
      audio: {
        onStatus: vi.fn((handler: (status: AudioStatus) => void) => {
          audioStatusHandlers.push(handler);
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];

    const AutomixProbe = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second]);
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    audioStatusHandlers.at(-1)?.({
      state: 'playing',
      currentTrackId: first.id,
      currentFilePath: first.path,
      positionSeconds: 59,
      durationSeconds: first.duration,
      automix: { enabled: false, active: false, mode: 'off', transitionSeconds: null, transitionStartedAtSeconds: null, nextTrackId: null },
    } as AudioStatus);
    expect(playLocalFile).toHaveBeenCalledTimes(1);

    audioStatusHandlers.at(-1)?.({
      state: 'playing',
      currentTrackId: first.id,
      currentFilePath: first.path,
      positionSeconds: 60,
      durationSeconds: first.duration,
      automix: { enabled: false, active: false, mode: 'off', transitionSeconds: null, transitionStartedAtSeconds: null, nextTrackId: null },
    } as AudioStatus);

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));
    expect(playLocalFile.mock.calls[1]?.[0]).toMatchObject({
      trackId: first.id,
      startSeconds: 60,
      automix: {
        enabled: true,
        nextItem: {
          mediaType: 'local',
          trackId: second.id,
          path: second.path,
        },
      },
    });
  });

  it('arms Automix with a shuffled local next candidate instead of disabling it', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const third = makeTrack(3);
    const randomSpy = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99);
    const audioStatusHandlers: Array<(status: AudioStatus) => void> = [];
    const prepareLocalFile = vi.fn().mockResolvedValue(undefined);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string; startSeconds?: number }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: Math.round((request.startSeconds ?? 0) * 1000),
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
        prepareLocalFile,
      },
      audio: {
        onStatus: vi.fn((handler: (status: AudioStatus) => void) => {
          audioStatusHandlers.push(handler);
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];

    const AutomixShuffleProbe = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second, third]);
        queue.toggleShuffle();
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixShuffleProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    await waitForDeferredPlaybackTask(() => expect(prepareLocalFile).toHaveBeenCalledWith(expect.objectContaining({
      trackId: third.id,
      automixAnalyze: true,
    })));
    audioStatusHandlers.at(-1)?.({
      state: 'playing',
      currentTrackId: first.id,
      currentFilePath: first.path,
      positionSeconds: 80,
      durationSeconds: first.duration,
      automix: { enabled: false, active: false, mode: 'off', transitionSeconds: null, transitionStartedAtSeconds: null, nextTrackId: null },
    } as AudioStatus);

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));
    expect(playLocalFile.mock.calls[1]?.[0]).toMatchObject({
      trackId: first.id,
      startSeconds: 80,
      automix: {
        enabled: true,
        nextItem: {
          mediaType: 'local',
          trackId: third.id,
          path: third.path,
        },
      },
    });
    expect(randomSpy).toHaveBeenCalled();
    expect(randomSpy).toHaveBeenCalled();
  });

  it('arms shuffled Automix with a streaming next candidate', async () => {
    const first = makeTrack(1);
    const second: LibraryTrack = { ...makeTrack(2), unavailable: true };
    const third: LibraryTrack = {
      ...makeTrack(3),
      id: 'streaming:qqmusic:third',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:third',
      provider: 'qqmusic',
      providerTrackId: 'third',
      stableKey: 'streaming:qqmusic:third',
    };
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValueOnce(0.99);
    const audioStatusHandlers: Array<(status: AudioStatus) => void> = [];
    const prepareMediaItem = vi.fn().mockResolvedValue(undefined);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string; startSeconds?: number }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: Math.round((request.startSeconds ?? 0) * 1000),
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
        prepareMediaItem,
      },
      audio: {
        onStatus: vi.fn((handler: (status: AudioStatus) => void) => {
          audioStatusHandlers.push(handler);
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];

    const AutomixShuffleProbe = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second, third]);
        queue.toggleShuffle();
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixShuffleProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    await waitForDeferredPlaybackTask(() => expect(prepareMediaItem).toHaveBeenCalledWith(expect.objectContaining({
      automixAnalyze: true,
      item: expect.objectContaining({
        mediaType: 'streaming',
        trackId: third.id,
      }),
    })));

    audioStatusHandlers.at(-1)?.({
      state: 'playing',
      currentTrackId: first.id,
      currentFilePath: first.path,
      positionSeconds: 80,
      durationSeconds: first.duration,
      automix: { enabled: false, active: false, mode: 'off', transitionSeconds: null, transitionStartedAtSeconds: null, nextTrackId: null },
    } as AudioStatus);

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));
    expect(playLocalFile.mock.calls[1]?.[0]).toMatchObject({
      trackId: first.id,
      startSeconds: 80,
      automix: {
        nextItem: {
          mediaType: 'streaming',
          trackId: third.id,
        },
      },
    });
    expect(randomSpy).toHaveBeenCalled();
  });

  it('prewarms the first queue item for Automix repeat-all wraparound', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const third = makeTrack(3);
    const prepareLocalFile = vi.fn().mockResolvedValue(undefined);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: third.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
        prepareLocalFile,
      },
    } as unknown as Window['echo'];

    const AutomixRepeatProbe = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.setRepeatMode('all');
        queue.setAutomixEnabled(true);
        void queue.playTrack(third, { replaceQueueWith: [first, second, third] });
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixRepeatProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    await waitForDeferredPlaybackTask(() => expect(prepareLocalFile).toHaveBeenCalledWith(expect.objectContaining({
      trackId: first.id,
      automixAnalyze: true,
    })));
  });

  it('re-arms Automix after a native dual-deck transition has advanced', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const third = makeTrack(3);
    const audioStatusHandlers: Array<(status: AudioStatus) => void> = [];
    let automixAdvanceHandler: ((event: { toTrackId: string; nextStartSeconds?: number }) => void) | null = null;
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string; startSeconds?: number }) => {
      const track = [first, second, third].find((candidate) => candidate.id === request.trackId) ?? first;
      return Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: Math.round((request.startSeconds ?? 0) * 1000),
        durationMs: track.duration * 1000,
        filePath: request.filePath,
      });
    });

    window.echo = {
      playback: {
        playLocalFile,
        onAutomixAdvance: vi.fn((handler: (event: { toTrackId: string; nextStartSeconds?: number }) => void) => {
          automixAdvanceHandler = handler;
          return vi.fn();
        }),
      },
      audio: {
        onStatus: vi.fn((handler: (status: AudioStatus) => void) => {
          audioStatusHandlers.push(handler);
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];

    const AutomixProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const sharedPlaybackStatus = useSharedPlaybackStatus();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second, third]);
        queue.setAutomixEnabled(true);
        void queue.playTrack(first);
      }, [queue]);

      return (
        <>
          <output aria-label="queue-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="shared-track">{sharedPlaybackStatus.playbackStatus?.currentTrackId ?? ''}</output>
          <output aria-label="shared-position">{sharedPlaybackStatus.playbackStatus?.positionMs ?? 0}</output>
        </>
      );
    };

    render(
      <PlaybackQueueProvider>
        <AutomixProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    audioStatusHandlers.at(-1)?.({
      state: 'playing',
      currentTrackId: first.id,
      currentFilePath: first.path,
      positionSeconds: 80,
      durationSeconds: first.duration,
      automix: { enabled: false, active: false, mode: 'off', transitionSeconds: null, transitionStartedAtSeconds: null, nextTrackId: null },
    } as AudioStatus);
    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));

    act(() => {
      automixAdvanceHandler?.({ toTrackId: second.id, nextStartSeconds: 4.25 });
    });
    await waitFor(() => expect(screen.getByLabelText('queue-track').textContent).toBe(second.id));
    expect(screen.getByLabelText('shared-track').textContent).toBe(second.id);
    expect(screen.getByLabelText('shared-position').textContent).toBe('4250');

    audioStatusHandlers.at(-1)?.({
      state: 'playing',
      currentTrackId: second.id,
      currentFilePath: second.path,
      positionSeconds: 82,
      durationSeconds: second.duration,
      automix: {
        enabled: true,
        active: true,
        mode: 'transitioning',
        transitionSeconds: 16,
        transitionStartedAtSeconds: 75,
        nextTrackId: second.id,
        plannedTrackCount: 2,
        nextTransitionIndex: 1,
      },
    } as AudioStatus);

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(3));
    expect(playLocalFile.mock.calls[2]?.[0]).toMatchObject({
      trackId: second.id,
      startSeconds: 82,
      automix: {
        enabled: true,
        nextItem: {
          mediaType: 'local',
          trackId: third.id,
          path: third.path,
        },
      },
    });
  });

  it('advances Automix to the next queue position when the same track appears twice', async () => {
    const first = makeTrack(1);
    const third = makeTrack(3);
    let automixAdvanceHandler: ((event: { toTrackId: string }) => void) | null = null;
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
        onAutomixAdvance: vi.fn((handler: (event: { toTrackId: string }) => void) => {
          automixAdvanceHandler = handler;
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];

    const DuplicateAdvanceProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);
      const currentIndex = queue.items.findIndex((item) => item.queueId === queue.currentQueueId);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(first, { replaceQueueWith: [first, first, third] });
      }, [queue]);

      return <output aria-label="queue-index">{currentIndex}</output>;
    };

    render(
      <PlaybackQueueProvider>
        <DuplicateAdvanceProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('queue-index').textContent).toBe('0'));
    act(() => {
      automixAdvanceHandler?.({ toTrackId: first.id });
    });

    await waitFor(() => expect(screen.getByLabelText('queue-index').textContent).toBe('1'));
  });

  it('passes ReplayGain and only a gapless next-track plan after opt-in', async () => {
    const first = {
      ...makeTrack(1),
      replayGainTrackGainDb: -5,
      replayGainTrackPeak: 0.9,
    };
    const second = makeTrack(2);
    const third = makeTrack(3);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ gaplessPlaybackEnabled: true }),
      },
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const GaplessProbe = (): null => {
      const queue = usePlaybackQueue();
      const didSeedRef = useRef(false);
      const didStartRef = useRef(false);

      useEffect(() => {
        if (!didSeedRef.current) {
          didSeedRef.current = true;
          queue.replaceQueue([first, second, third]);
        }

        if (queue.gaplessPlaybackEnabled && !didStartRef.current) {
          didStartRef.current = true;
          void queue.playTrack(first);
        }
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <GaplessProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(playLocalFile.mock.calls[0]?.[0]).toMatchObject({
      trackId: first.id,
      replayGain: {
        trackGainDb: -5,
        trackPeak: 0.9,
      },
      gapless: {
        enabled: true,
        nextItem: {
          mediaType: 'local',
          trackId: second.id,
          path: second.path,
        },
      },
    });
    expect(playLocalFile.mock.calls[0]?.[0].gapless).not.toHaveProperty('upcomingItems');
    expect(playLocalFile.mock.calls[0]?.[0].gapless).not.toHaveProperty('upcomingProbes');
    expect(playLocalFile.mock.calls[0]?.[0].automix).toBeUndefined();
  });

  it.each([
    ['different album', { album: 'Other Album' }],
    ['missing track number', { trackNo: null }],
    ['DSD source', { codec: 'dsf', path: 'D:\\Music\\track-2.dsf' }],
    ['remote source', { mediaType: 'remote' as const, sourceId: 'nas', remotePath: '/track-2.flac' }],
  ])('does not create a gapless plan for %s', async (_label, nextPatch) => {
    const first = makeTrack(1);
    const second = { ...makeTrack(2), ...nextPatch };
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ gaplessPlaybackEnabled: true }),
      },
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const GaplessProbe = (): null => {
      const queue = usePlaybackQueue();
      const didSeedRef = useRef(false);
      const didStartRef = useRef(false);

      useEffect(() => {
        if (!didSeedRef.current) {
          didSeedRef.current = true;
          queue.replaceQueue([first, second]);
        }

        if (queue.gaplessPlaybackEnabled && !didStartRef.current) {
          didStartRef.current = true;
          void queue.playTrack(first);
        }
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <GaplessProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(playLocalFile.mock.calls[0]?.[0].gapless).toBeUndefined();
  });

  it('does not create a gapless plan while playback speed is not 1x', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          gaplessPlaybackEnabled: true,
          playbackSpeed: 1.25,
          playbackSpeedMode: 'speed',
        }),
      },
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const GaplessProbe = (): null => {
      const queue = usePlaybackQueue();
      const didSeedRef = useRef(false);
      const didStartRef = useRef(false);

      useEffect(() => {
        if (!didSeedRef.current) {
          didSeedRef.current = true;
          queue.replaceQueue([first, second]);
        }

        if (queue.gaplessPlaybackEnabled && !didStartRef.current) {
          didStartRef.current = true;
          void queue.playTrack(first);
        }
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <GaplessProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(playLocalFile.mock.calls[0]?.[0]).toMatchObject({
      output: {
        playbackRate: 1.25,
        playbackSpeedMode: 'speed',
      },
    });
    expect(playLocalFile.mock.calls[0]?.[0].gapless).toBeUndefined();
  });

  it('does not restart current playback when automix is enabled mid-song', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const prepareLocalFile = vi.fn().mockResolvedValue(undefined);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
        prepareLocalFile,
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: first.id,
          positionMs: 42000,
          durationMs: first.duration * 1000,
          filePath: first.path,
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: first.id,
          currentFilePath: first.path,
          positionSeconds: 42,
          durationSeconds: first.duration,
          error: null,
        }),
      },
    } as unknown as Window['echo'];

    const AutomixToggleProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.setAutomixEnabled(true);
        queue.replaceQueue([first, second]);
        void queue.playTrack(first);
      }, [queue]);

      return <button type="button" aria-pressed={queue.automixEnabled} onClick={() => queue.setAutomixEnabled(true)}>enable</button>;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixToggleProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'enable' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'enable' }).getAttribute('aria-pressed')).toBe('true'));
    expect(playLocalFile).toHaveBeenCalledTimes(1);
    await waitForDeferredPlaybackTask(() => expect(prepareLocalFile).toHaveBeenCalledWith(expect.objectContaining({
      trackId: second.id,
      automixAnalyze: true,
    })));
  });

  it('keeps remote prewarm on prepareMediaItem and skips local prepare for remote next items', async () => {
    const first = makeTrack(1);
    const second: LibraryTrack = {
      ...makeTrack(2),
      id: 'remote:source-1:stable-key',
      mediaType: 'remote',
      sourceId: 'source-1',
      remotePath: '/music/remote.flac',
      stableKey: 'stable-key',
    };
    const prepareLocalFile = vi.fn().mockResolvedValue(undefined);
    const prepareMediaItem = vi.fn().mockResolvedValue(undefined);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
        prepareLocalFile,
        prepareMediaItem,
      },
    } as unknown as Window['echo'];

    const AutoPlayFirst = (): null => {
      const queue = usePlaybackQueue();
      const didEnableRef = useRef(false);
      const didStartRef = useRef(false);

      useEffect(() => {
        if (!didEnableRef.current) {
          didEnableRef.current = true;
          queue.setAutomixEnabled(true);
          return;
        }

        if (!queue.automixEnabled) {
          return;
        }

        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second]);
        void queue.playTrack(first);
      }, [queue, queue.automixEnabled]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutoPlayFirst />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: first.id })));
    await waitForDeferredPlaybackTask(() => expect(prepareMediaItem).toHaveBeenCalledTimes(1));
    expect(prepareMediaItem).toHaveBeenCalledWith(expect.objectContaining({
      automixAnalyze: true,
      item: expect.objectContaining({
        mediaType: 'remote',
        trackId: second.id,
      }),
    }));
    expect(prepareLocalFile).not.toHaveBeenCalled();
  });

  it('skips remote prewarm while enhanced low-load protection is active', async () => {
    vi.useFakeTimers();
    const first = makeTrack(1);
    const second: LibraryTrack = {
      ...makeTrack(2),
      id: 'remote:source-1:stable-key',
      mediaType: 'remote',
      sourceId: 'source-1',
      remotePath: '/music/remote.flac',
      stableKey: 'stable-key',
    };
    const getSettings = vi.fn().mockResolvedValue({
      lowLoadPlaybackModeEnabled: true,
      lowLoadPlaybackEnhancementsEnabled: true,
    });
    const prepareMediaItem = vi.fn().mockResolvedValue(undefined);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      app: {
        getSettings,
      },
      playback: {
        playLocalFile,
        prepareMediaItem,
      },
    } as unknown as Window['echo'];

    const PlayButton = (): JSX.Element => {
      const queue = usePlaybackQueue();
      return (
        <button
          type="button"
          onClick={() => {
            queue.replaceQueue([first, second]);
            void queue.playTrack(first);
          }}
        >
          play
        </button>
      );
    };

    render(
      <PlaybackQueueProvider>
        <PlayButton />
      </PlaybackQueueProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(getSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'play' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: first.id }));

    act(() => {
      vi.advanceTimersByTime(deferredPlaybackTaskWaitMs);
    });

    expect(prepareMediaItem).not.toHaveBeenCalled();
  });

  it('defers automatic network MV search when playback starts', async () => {
    const track = makeTrack(1);
    const getSettings = vi.fn().mockResolvedValue({ autoSearch: true });
    const searchNetworkCandidates = vi.fn().mockResolvedValue([]);
    const getSelected = vi.fn().mockResolvedValue(null);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const playLocalFile = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: track.id,
      positionMs: 0,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });

    window.echo = {
      playback: {
        playLocalFile,
      },
      mv: {
        getSettings,
        searchNetworkCandidates,
        getSelected,
      },
    } as unknown as Window['echo'];

    const AutoPlay = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(track);
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutoPlay />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: track.id })));
    expect(searchNetworkCandidates).not.toHaveBeenCalled();
    await waitForDeferredPlaybackTask(() => expect(searchNetworkCandidates).toHaveBeenCalledWith(track.id));
    await waitFor(() => expect(getSelected).toHaveBeenCalledWith(track.id));
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'mv:candidatesChanged' })),
    );
  });

  it('delays MV refresh and skips network candidate search under enhanced low-load protection', async () => {
    vi.useFakeTimers();
    const track = makeTrack(1);
    const appGetSettings = vi.fn().mockResolvedValue({
      lowLoadPlaybackModeEnabled: true,
      lowLoadPlaybackEnhancementsEnabled: true,
    });
    const getMvSettings = vi.fn().mockResolvedValue({ autoSearch: true });
    const searchNetworkCandidates = vi.fn().mockResolvedValue([]);
    const getSelected = vi.fn().mockResolvedValue(null);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const playLocalFile = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: track.id,
      positionMs: 0,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });

    window.echo = {
      app: {
        getSettings: appGetSettings,
      },
      playback: {
        playLocalFile,
      },
      mv: {
        getSettings: getMvSettings,
        searchNetworkCandidates,
        getSelected,
      },
    } as unknown as Window['echo'];

    const PlayButton = (): JSX.Element => {
      const queue = usePlaybackQueue();
      return <button type="button" onClick={() => void queue.playTrack(track)}>play</button>;
    };

    render(
      <PlaybackQueueProvider>
        <PlayButton />
      </PlaybackQueueProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(appGetSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'play' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: track.id }));

    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(getSelected).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(8_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSelected).toHaveBeenCalledWith(track.id);
    expect(searchNetworkCandidates).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'mv:candidatesChanged' }));
  });

  it('plays remote tracks through media-item IPC and records only stable identity', async () => {
    const remoteTrack: LibraryTrack = {
      ...makeTrack(1),
      id: 'remote:source-1:stable-hash',
      mediaType: 'remote',
      path: 'remote://source-1/music/Echo Song.flac',
      sourceId: 'source-1',
      provider: 'webdav',
      remotePath: '/music/Echo Song.flac',
      stableKey: 'stable-key-1',
    };
    const playMediaItem = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: remoteTrack.id,
      positionMs: 0,
      durationMs: remoteTrack.duration * 1000,
      filePath: 'http://127.0.0.1:49152/remote-stream/token',
    });
    const startPlaybackHistory = vi.fn().mockResolvedValue({ historyId: 'history-remote' });

    window.echo = {
      playback: {
        playMediaItem,
      },
      library: {
        startPlaybackHistory,
      },
    } as unknown as Window['echo'];

    const AutoPlayRemote = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(remoteTrack);
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutoPlayRemote />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playMediaItem).toHaveBeenCalledTimes(1));
    await waitForDeferredPlaybackTask(() => expect(startPlaybackHistory).toHaveBeenCalledTimes(1));

    expect(playMediaItem).toHaveBeenCalledWith(expect.objectContaining({
      item: expect.objectContaining({
        mediaType: 'remote',
        trackId: remoteTrack.id,
        sourceId: remoteTrack.sourceId,
        stableKey: remoteTrack.stableKey,
        remotePath: remoteTrack.remotePath,
      }),
    }));
    expect(playMediaItem.mock.calls[0]?.[0].item.streamUrl).toBeUndefined();
    expect(startPlaybackHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: remoteTrack.id,
        mediaType: 'remote',
        sourceId: remoteTrack.sourceId,
        stableKey: remoteTrack.stableKey,
        remotePath: remoteTrack.remotePath,
      }),
    );
    expect(startPlaybackHistory.mock.calls[0]?.[0].trackPath).toBeUndefined();
  });

  it('keeps the requested streaming track current when media IPC returns a stale previous id', async () => {
    const first: LibraryTrack = {
      ...makeTrack(1),
      id: 'streaming:qqmusic:first',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:first',
      provider: 'qqmusic',
      providerTrackId: 'first',
      stableKey: 'streaming:qqmusic:first',
    };
    const second: LibraryTrack = {
      ...makeTrack(2),
      id: 'streaming:qqmusic:second',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:second',
      provider: 'qqmusic',
      providerTrackId: 'second',
      stableKey: 'streaming:qqmusic:second',
    };
    const playMediaItem = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: first.id,
      positionMs: 0,
      durationMs: first.duration * 1000,
      filePath: 'http://127.0.0.1:49152/streaming/stale',
    });

    window.echo = {
      playback: {
        playMediaItem,
      },
    } as unknown as Window['echo'];

    const StreamingProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(first, { replaceQueueWith: [first, second] });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <button type="button" onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <StreamingProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe(first.id));
    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(playMediaItem).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe(second.id));
  });

  it('requests background Automix analysis when starting a streaming queue with Automix enabled', async () => {
    const first: LibraryTrack = {
      ...makeTrack(1),
      id: 'streaming:qqmusic:first',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:first',
      provider: 'qqmusic',
      providerTrackId: 'first',
      stableKey: 'streaming:qqmusic:first',
    };
    const second: LibraryTrack = {
      ...makeTrack(2),
      id: 'streaming:qqmusic:second',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:second',
      provider: 'qqmusic',
      providerTrackId: 'second',
      stableKey: 'streaming:qqmusic:second',
    };
    const playMediaItem = vi.fn().mockImplementation((request: { item: { trackId: string } }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.item.trackId,
        positionMs: 0,
        durationMs: first.duration * 1000,
        filePath: 'https://stream.example.test/song.flac',
      }),
    );

    window.echo = {
      playback: {
        playMediaItem,
      },
    } as unknown as Window['echo'];

    const StreamingAutomixProbe = (): null => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.setAutomixEnabled(true);
        void queue.playTrack(first, { replaceQueueWith: [first, second] });
      }, [queue]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <StreamingAutomixProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playMediaItem).toHaveBeenCalledTimes(1));
    expect(playMediaItem.mock.calls[0]?.[0]).toMatchObject({
      item: {
        mediaType: 'streaming',
        trackId: first.id,
      },
      automixAnalyze: true,
    });
  });

  it('includes streaming upcoming tracks in Automix following plans', async () => {
    const first = makeTrack(1);
    const second: LibraryTrack = {
      ...makeTrack(2),
      id: 'streaming:qqmusic:second',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:second',
      provider: 'qqmusic',
      providerTrackId: 'second',
      stableKey: 'streaming:qqmusic:second',
    };
    const third: LibraryTrack = {
      ...makeTrack(3),
      id: 'streaming:qqmusic:third',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:third',
      provider: 'qqmusic',
      providerTrackId: 'third',
      stableKey: 'streaming:qqmusic:third',
    };
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string; startSeconds?: number }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: Math.round((request.startSeconds ?? 0) * 1000),
        durationMs: first.duration * 1000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const AutomixUpcomingProbe = (): null => {
      const queue = usePlaybackQueue();
      const didSetupRef = useRef(false);
      const didStartRef = useRef(false);

      useEffect(() => {
        if (!didSetupRef.current) {
          didSetupRef.current = true;
          queue.setAutomixEnabled(true);
          queue.replaceQueue([first, second, third]);
          return;
        }

        if (!queue.automixEnabled || queue.items.length < 3) {
          return;
        }

        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(first, { startSeconds: 80 });
      }, [queue, queue.automixEnabled, queue.items.length]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixUpcomingProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(playLocalFile.mock.calls[0]?.[0]).toMatchObject({
      automix: {
        nextItem: {
          mediaType: 'streaming',
          trackId: second.id,
        },
        upcomingItems: [
          {
            mediaType: 'streaming',
            trackId: third.id,
          },
        ],
      },
    });
  });

  it('skips unavailable tracks when choosing the next Automix item', async () => {
    const first = makeTrack(1);
    const unavailableNext: LibraryTrack = { ...makeTrack(2), unavailable: true };
    const playableThird = makeTrack(3);
    const playLocalFile = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: first.id,
      positionMs: 80000,
      durationMs: first.duration * 1000,
      filePath: first.path,
    });

    window.echo = {
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const AutomixUnavailableProbe = (): null => {
      const queue = usePlaybackQueue();
      const didSetupRef = useRef(false);
      const didStartRef = useRef(false);

      useEffect(() => {
        if (!didSetupRef.current) {
          didSetupRef.current = true;
          queue.setAutomixEnabled(true);
          queue.replaceQueue([first, unavailableNext, playableThird]);
          return;
        }

        if (!queue.automixEnabled || queue.items.length < 3) {
          return;
        }

        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(first, { startSeconds: 80 });
      }, [queue, queue.automixEnabled, queue.items.length]);

      return null;
    };

    render(
      <PlaybackQueueProvider>
        <AutomixUnavailableProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(playLocalFile.mock.calls[0]?.[0].automix).toMatchObject({
      nextItem: {
        trackId: playableThird.id,
      },
    });
  });

  it('refreshes an existing streaming queue item when replaying it at a different quality', async () => {
    const highQualityTrack: LibraryTrack = {
      ...makeTrack(1),
      id: 'streaming:qqmusic:song',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:song',
      provider: 'qqmusic',
      providerTrackId: 'song',
      stableKey: 'streaming:qqmusic:song',
      streamingQuality: 'high',
    };
    const losslessTrack: LibraryTrack = {
      ...highQualityTrack,
      streamingQuality: 'lossless',
    };
    const playMediaItem = vi.fn().mockImplementation((request: { item: { trackId: string }; startSeconds?: number }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.item.trackId,
        positionMs: Math.round(Math.max(0, request.startSeconds ?? 0) * 1000),
        durationMs: highQualityTrack.duration * 1000,
        filePath: 'https://stream.example.test/song.flac',
      }),
    );

    window.echo = {
      playback: {
        playMediaItem,
      },
    } as unknown as Window['echo'];

    const StreamingQualityProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(highQualityTrack);
      }, [queue]);

      return (
        <div>
          <output aria-label="current-quality">{queue.currentTrack?.streamingQuality ?? ''}</output>
          <button type="button" onClick={() => void queue.playTrack(losslessTrack, { startSeconds: 37, forceRefresh: true })}>
            switch quality
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <StreamingQualityProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playMediaItem).toHaveBeenCalledTimes(1));
    expect(playMediaItem.mock.calls[0]?.[0]).toMatchObject({
      item: expect.objectContaining({ quality: 'high' }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'switch quality' }));

    await waitFor(() => expect(playMediaItem).toHaveBeenCalledTimes(2));
    expect(playMediaItem.mock.calls[1]?.[0]).toMatchObject({
      item: expect.objectContaining({ quality: 'lossless' }),
      startSeconds: 37,
      forceRefresh: true,
    });
    await waitFor(() => expect(screen.getByLabelText('current-quality').textContent).toBe('lossless'));
  });

  it('publishes the requested track before slow playback IPC resolves', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const audioStatusListeners: Array<(status: AudioStatus) => void> = [];
    const emitAudioStatus = (status: AudioStatus): void => {
      for (const listener of audioStatusListeners) {
        listener(status);
      }
    };
    let resolveSecondPlay: (() => void) | null = null;
    const playLocalFile = vi
      .fn()
      .mockImplementationOnce((request: { trackId: string; filePath: string }) =>
        Promise.resolve({
          state: 'playing',
          currentTrackId: request.trackId,
          positionMs: 0,
          durationMs: first.duration * 1000,
          filePath: request.filePath,
        }),
      )
      .mockImplementationOnce((request: { trackId: string; filePath: string }) =>
        new Promise((resolve) => {
          resolveSecondPlay = () =>
            resolve({
              state: 'playing',
              currentTrackId: request.trackId,
              positionMs: 23000,
              durationMs: second.duration * 1000,
              filePath: request.filePath,
            });
        }),
      );

    window.echo = {
      playback: {
        playLocalFile,
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: first.id,
          positionMs: 5000,
          durationMs: first.duration * 1000,
          filePath: first.path,
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: first.id,
          currentFilePath: first.path,
          positionSeconds: 5,
          durationSeconds: first.duration,
          fileSampleRate: first.sampleRate,
          outputSampleRate: first.sampleRate,
          channels: 2,
          bitDepth: first.bitDepth,
          bitrate: first.bitrate,
          codec: first.codec,
          outputMode: 'shared',
          requestedSampleRate: first.sampleRate,
          actualDeviceSampleRate: first.sampleRate,
          sampleRateMismatch: false,
          playbackRate: 1,
          playbackSpeedMode: 'nightcore',
          volume: 1,
          error: null,
        }),
        onStatus: vi.fn((listener: (status: AudioStatus) => void) => {
          audioStatusListeners.push(listener);
          return () => {
            const index = audioStatusListeners.indexOf(listener);
            if (index >= 0) {
              audioStatusListeners.splice(index, 1);
            }
          };
        }),
      },
    } as unknown as Window['echo'];

    const PendingPlaybackProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const status = useSharedPlaybackStatus();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(first, { replaceQueueWith: [first, second] });
      }, [queue]);

      return (
        <div>
          <output aria-label="queue-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="shared-track">{status.playbackStatus?.currentTrackId ?? ''}</output>
          <output aria-label="shared-position">{status.playbackStatus?.positionMs ?? ''}</output>
          <output aria-label="shared-audio-track">{status.audioStatus?.currentTrackId ?? ''}</output>
          <output aria-label="visual-state">{status.playbackVisualIntent?.state ?? ''}</output>
          <button type="button" onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <PendingPlaybackProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('queue-track').textContent).toBe(first.id));
    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(screen.getByLabelText('queue-track').textContent).toBe(second.id));
    await waitFor(() => expect(screen.getByLabelText('shared-track').textContent).toBe(second.id));
    expect(screen.getByLabelText('visual-state').textContent).toBe('playing');

    const finishSecondPlay = resolveSecondPlay ?? (() => undefined);
    finishSecondPlay();
    await waitFor(() => expect(screen.getByLabelText('shared-position').textContent).toBe('0'));
    expect(screen.getByLabelText('visual-state').textContent).toBe('playing');

    if (audioStatusListeners.length === 0) {
      throw new Error('audio status listener was not captured');
    }

    act(() => {
      emitAudioStatus({
        state: 'playing',
        currentTrackId: first.id,
        currentFilePath: first.path,
        positionSeconds: 23,
        durationSeconds: first.duration,
        error: null,
      } as AudioStatus);
    });
    expect(screen.getByLabelText('shared-track').textContent).toBe(second.id);
    expect(screen.getByLabelText('shared-position').textContent).toBe('0');
    expect(screen.getByLabelText('shared-audio-track').textContent).toBe('');

    const afterPositionGuardMs = Date.now() + 16_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(afterPositionGuardMs);
    act(() => {
      emitAudioStatus({
        state: 'playing',
        currentTrackId: second.id,
        currentFilePath: second.path,
        positionSeconds: 23,
        durationSeconds: second.duration,
        error: null,
      } as AudioStatus);
    });
    expect(screen.getByLabelText('shared-track').textContent).toBe(second.id);
    expect(screen.getByLabelText('shared-position').textContent).toBe('0');
    expect(screen.getByLabelText('shared-audio-track').textContent).toBe('');

    act(() => {
      emitAudioStatus({
        state: 'playing',
        currentTrackId: second.id,
        currentFilePath: second.path,
        positionSeconds: 1,
        durationSeconds: second.duration,
        error: null,
      } as AudioStatus);
    });
    dateNowSpy.mockRestore();
    await waitFor(() => expect(screen.getByLabelText('shared-audio-track').textContent).toBe(second.id));
    await waitFor(() => expect(screen.getByLabelText('visual-state').textContent).toBe(''));
  });

  it('does not let a superseded ASIO start failure overwrite the active track', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const firstPlayback = { reject: null as ((error: Error) => void) | null };
    const playLocalFile = vi
      .fn()
      .mockImplementationOnce(() =>
        new Promise((_resolve, reject) => {
          firstPlayback.reject = reject;
        }),
      )
      .mockImplementationOnce((request: { trackId: string; filePath: string }) =>
        Promise.resolve({
          state: 'playing',
          currentTrackId: request.trackId,
          positionMs: 0,
          durationMs: second.duration * 1000,
          filePath: request.filePath,
        }),
      );

    window.echo = {
      playback: {
        playLocalFile,
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: second.id,
          positionMs: 0,
          durationMs: second.duration * 1000,
          filePath: second.path,
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: second.id,
          currentFilePath: second.path,
          positionSeconds: 0,
          durationSeconds: second.duration,
          error: null,
        }),
      },
    } as unknown as Window['echo'];

    const SupersededFailureProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const status = useSharedPlaybackStatus();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([first, second]);
        void queue.playTrack(first).catch(() => undefined);
      }, [queue]);

      return (
        <div>
          <output aria-label="queue-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="shared-track">{status.playbackStatus?.currentTrackId ?? ''}</output>
          <output aria-label="shared-error">{status.error ?? ''}</output>
          <button type="button" onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <SupersededFailureProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('queue-track').textContent).toBe(first.id));
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(screen.getByLabelText('queue-track').textContent).toBe(second.id));

    const rejectFirstPlay = firstPlayback.reject;
    if (!rejectFirstPlay) {
      throw new Error('first playback promise was not captured');
    }
    rejectFirstPlay(new Error('echo-audio-host timeout_waiting_for_ready; mode="asio"'));

    await waitFor(() => expect(screen.getByLabelText('shared-track').textContent).toBe(second.id));
    expect(screen.getByLabelText('shared-error').textContent).toBe('');
  });

  it('suppresses superseded audio session cancellation status errors', async () => {
    let emitAudioStatus: ((status: AudioStatus) => void) | null = null;

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'stopped',
          currentTrackId: null,
          positionMs: 0,
          durationMs: 0,
          filePath: null,
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'stopped',
          error: null,
        }),
        onStatus: vi.fn((listener: (status: AudioStatus) => void) => {
          emitAudioStatus = listener;
          return () => undefined;
        }),
      },
    } as unknown as Window['echo'];

    const StatusProbe = (): JSX.Element => {
      const status = useSharedPlaybackStatus();

      return (
        <div>
          <output aria-label="shared-error">{status.error ?? ''}</output>
          <output aria-label="shared-audio-state">{status.audioStatus?.state ?? ''}</output>
        </div>
      );
    };

    render(<StatusProbe />);

    await waitFor(() => expect(window.echo?.audio?.onStatus).toHaveBeenCalled());
    if (!emitAudioStatus) {
      throw new Error('audio status listener was not captured');
    }

    act(() => {
      emitAudioStatus?.({
        state: 'error',
        error: 'audio_session_run_cancelled',
      } as AudioStatus);
    });
    expect(screen.getByLabelText('shared-error').textContent).toBe('');
    expect(screen.getByLabelText('shared-audio-state').textContent).not.toBe('error');

    act(() => {
      emitAudioStatus?.({
        state: 'error',
        error: 'native_writable_error: device failed',
      } as AudioStatus);
    });
    expect(screen.getByLabelText('shared-error').textContent).toBe('native_writable_error: device failed');
    expect(screen.getByLabelText('shared-audio-state').textContent).toBe('error');
  });

  it('uses HQPlayer Connect status as the shared playback clock while ignoring stale local audio status', async () => {
    const track = makeTrack(1);
    let emitAudioStatus: ((status: AudioStatus) => void) | null = null;
    let emitConnectStatus: ((status: ConnectSessionStatus) => void) | null = null;
    const hqStatus: ConnectSessionStatus = {
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'playing',
      currentTrackId: track.id,
      metadata: {
        title: track.title,
        artist: track.artist,
        album: track.album,
        albumArtist: track.albumArtist,
        durationSeconds: track.duration,
        coverHttpUrl: '',
      },
      positionSeconds: 12.345,
      durationSeconds: track.duration,
      latencyMs: 8,
      error: null,
      updatedAt: '2026-05-24T15:10:00.000Z',
    };

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'paused',
          currentTrackId: track.id,
          positionMs: 0,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'paused',
          currentTrackId: track.id,
          currentFilePath: track.path,
          positionSeconds: 0,
          durationSeconds: track.duration,
          error: null,
        }),
        onStatus: vi.fn((listener: (status: AudioStatus) => void) => {
          emitAudioStatus = listener;
          return () => undefined;
        }),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(hqStatus),
        onStatus: vi.fn((listener: (status: ConnectSessionStatus) => void) => {
          emitConnectStatus = listener;
          return () => undefined;
        }),
      },
    } as unknown as Window['echo'];

    const StatusProbe = (): JSX.Element => {
      const status = useSharedPlaybackStatus();

      return (
        <div>
          <output aria-label="shared-state">{status.playbackStatus?.state ?? ''}</output>
          <output aria-label="shared-position">{status.playbackStatus?.positionMs ?? ''}</output>
          <output aria-label="shared-audio-state">{status.audioStatus?.state ?? ''}</output>
        </div>
      );
    };

    render(<StatusProbe />);

    await waitFor(() => expect(screen.getByLabelText('shared-state').textContent).toBe('playing'));
    expect(screen.getByLabelText('shared-position').textContent).toBe('12345');
    expect(screen.getByLabelText('shared-audio-state').textContent).toBe('');

    if (!emitAudioStatus || !emitConnectStatus) {
      throw new Error('status listeners were not captured');
    }

    act(() => {
      emitAudioStatus?.({
        state: 'paused',
        currentTrackId: track.id,
        currentFilePath: track.path,
        positionSeconds: 0,
        durationSeconds: track.duration,
        error: null,
      } as AudioStatus);
    });
    expect(screen.getByLabelText('shared-state').textContent).toBe('playing');
    expect(screen.getByLabelText('shared-position').textContent).toBe('12345');
    expect(screen.getByLabelText('shared-audio-state').textContent).toBe('');

    act(() => {
      emitConnectStatus?.({ ...hqStatus, positionSeconds: 14.25 });
    });
    await waitFor(() => expect(screen.getByLabelText('shared-position').textContent).toBe('14250'));
  });
});

describe('PlaybackQueueProvider playback modes', () => {
  it('plays a playlist sequence temporarily and resumes the saved queue after the sequence ends', async () => {
    const queueTracks = [makeTrack(1), makeTrack(2)];
    const playlistTracks = [makeTrack(3), makeTrack(4)];
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const PlaylistSequenceProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(queueTracks[0], { replaceQueueWith: queueTracks });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="queue-track-ids">{queue.items.map((item) => item.track.id).join(',')}</output>
          <output aria-label="playlist-active">{queue.playlistPlayback.active ? 'yes' : 'no'}</output>
          <output aria-label="can-next">{queue.canGoNext ? 'yes' : 'no'}</output>
          <button type="button" onClick={() => void queue.playPlaylistSequence(playlistTracks, { label: 'Road Mix', playlistId: 'playlist-1' })}>
            play playlist
          </button>
          <button type="button" onClick={() => void queue.playNext({ autoAdvance: true })}>
            auto next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <PlaylistSequenceProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));
    expect(screen.getByLabelText('queue-track-ids').textContent).toBe('track-1,track-2');

    fireEvent.click(screen.getByRole('button', { name: 'play playlist' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-3'));
    expect(screen.getByLabelText('queue-track-ids').textContent).toBe('track-3,track-4');
    expect(screen.getByLabelText('playlist-active').textContent).toBe('yes');

    fireEvent.click(screen.getByRole('button', { name: 'auto next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-4'));
    expect(screen.getByLabelText('can-next').textContent).toBe('yes');

    fireEvent.click(screen.getByRole('button', { name: 'auto next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-2'));
    expect(screen.getByLabelText('queue-track-ids').textContent).toBe('track-1,track-2');
    expect(screen.getByLabelText('playlist-active').textContent).toBe('no');
    expect(playLocalFile.mock.calls.map((call) => call[0].trackId)).toEqual(['track-1', 'track-3', 'track-4', 'track-2']);
  });

  it('keeps shuffled local playlist playback inside the active playlist', async () => {
    const playlistTracks = [makeTrack(3), makeTrack(4), makeTrack(5)];
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const getTracks = vi.fn().mockResolvedValue({
      items: [makeTrack(99)],
      page: 1,
      pageSize: 128,
      total: 1,
      hasMore: false,
    });
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    const LocalPlaylistShuffleProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="shuffle-mode">{queue.isShuffleEnabled ? 'on' : 'off'}</output>
          <button type="button" onClick={() => void queue.playPlaylistSequence(playlistTracks, { label: 'Local Mix', playlistId: 'playlist-local' })}>
            play playlist
          </button>
          <button type="button" onClick={queue.toggleShuffle}>
            shuffle
          </button>
          <button type="button" onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <LocalPlaylistShuffleProbe />
      </PlaybackQueueProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'play playlist' }));
    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-3'));

    fireEvent.click(screen.getByRole('button', { name: 'shuffle' }));
    await waitFor(() => expect(screen.getByLabelText('shuffle-mode').textContent).toBe('on'));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-5'));
    expect(playLocalFile.mock.calls.map((call) => call[0].trackId)).toEqual(['track-3', 'track-5']);
    expect(getTracks).not.toHaveBeenCalled();
    expect(randomSpy).toHaveBeenCalled();
  });

  it('keeps shuffled streaming playlist playback inside the active playlist', async () => {
    const streamingTracks: LibraryTrack[] = [
      {
        ...makeTrack(1),
        id: 'streaming:qqmusic:first',
        mediaType: 'streaming',
        path: 'streaming:qqmusic:first',
        provider: 'qqmusic',
        providerTrackId: 'first',
        stableKey: 'streaming:qqmusic:first',
      },
      {
        ...makeTrack(2),
        id: 'streaming:qqmusic:second',
        mediaType: 'streaming',
        path: 'streaming:qqmusic:second',
        provider: 'qqmusic',
        providerTrackId: 'second',
        stableKey: 'streaming:qqmusic:second',
      },
      {
        ...makeTrack(3),
        id: 'streaming:qqmusic:third',
        mediaType: 'streaming',
        path: 'streaming:qqmusic:third',
        provider: 'qqmusic',
        providerTrackId: 'third',
        stableKey: 'streaming:qqmusic:third',
      },
    ];
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const getTracks = vi.fn().mockResolvedValue({
      items: [makeTrack(99)],
      page: 1,
      pageSize: 128,
      total: 1,
      hasMore: false,
    });
    const playMediaItem = vi.fn().mockImplementation((request: { item: { trackId: string } }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.item.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: `streaming://${request.item.trackId}`,
      }),
    );

    window.echo = {
      playback: {
        playMediaItem,
      },
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    const StreamingPlaylistShuffleProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="shuffle-mode">{queue.isShuffleEnabled ? 'on' : 'off'}</output>
          <button type="button" onClick={() => void queue.playPlaylistSequence(streamingTracks, { label: 'QQ Mix', playlistId: 'playlist-streaming' })}>
            play playlist
          </button>
          <button type="button" onClick={queue.toggleShuffle}>
            shuffle
          </button>
          <button type="button" onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <StreamingPlaylistShuffleProbe />
      </PlaybackQueueProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'play playlist' }));
    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('streaming:qqmusic:first'));

    fireEvent.click(screen.getByRole('button', { name: 'shuffle' }));
    await waitFor(() => expect(screen.getByLabelText('shuffle-mode').textContent).toBe('on'));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('streaming:qqmusic:third'));
    expect(playMediaItem.mock.calls.map((call) => call[0].item.trackId)).toEqual(['streaming:qqmusic:first', 'streaming:qqmusic:third']);
    expect(getTracks).not.toHaveBeenCalled();
    expect(randomSpy).toHaveBeenCalled();
  });

  it('exits playlist sequence playback and resumes the saved queue item', async () => {
    const queueTracks = [makeTrack(1), makeTrack(2)];
    const playlistTracks = [makeTrack(3), makeTrack(4)];
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const ExitPlaylistSequenceProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(queueTracks[0], { replaceQueueWith: queueTracks });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="queue-track-ids">{queue.items.map((item) => item.track.id).join(',')}</output>
          <output aria-label="playlist-active">{queue.playlistPlayback.active ? 'yes' : 'no'}</output>
          <button type="button" onClick={() => void queue.playPlaylistSequence(playlistTracks, { label: 'Road Mix', playlistId: 'playlist-1' })}>
            play playlist
          </button>
          <button type="button" onClick={() => void queue.exitPlaylistSequence()}>
            exit playlist
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <ExitPlaylistSequenceProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));
    fireEvent.click(screen.getByRole('button', { name: 'play playlist' }));
    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-3'));

    fireEvent.click(screen.getByRole('button', { name: 'exit playlist' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));
    expect(screen.getByLabelText('queue-track-ids').textContent).toBe('track-1,track-2');
    expect(screen.getByLabelText('playlist-active').textContent).toBe('no');
    expect(playLocalFile.mock.calls.map((call) => call[0].trackId)).toEqual(['track-1', 'track-3', 'track-1']);
  });

  it('keeps the persisted queue pointed at the saved queue while playlist playback is active', async () => {
    const queueTracks = [makeTrack(1), makeTrack(2)];
    const playlistTracks = [makeTrack(3), makeTrack(4)];
    const session = makePersistedQueueSession(queueTracks, {
      mode: {
        isShuffleEnabled: true,
        repeatMode: 'all',
        automixEnabled: false,
      },
    });
    const saveQueueSession = vi.fn(async (snapshot) => snapshot);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        getQueueSession: vi.fn().mockResolvedValue(session),
        saveQueueSession,
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const PersistedPlaylistSequenceProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="queue-track-ids">{queue.items.map((item) => item.track.id).join(',')}</output>
          <output aria-label="repeat-mode">{queue.repeatMode}</output>
          <output aria-label="shuffle-mode">{queue.isShuffleEnabled ? 'on' : 'off'}</output>
          <button type="button" onClick={() => void queue.playPlaylistSequence(playlistTracks, { label: 'Road Mix', playlistId: 'playlist-1' })}>
            play playlist
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <PersistedPlaylistSequenceProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));
    await waitForDeferredPlaybackTask(() => expect(saveQueueSession).toHaveBeenCalled());
    saveQueueSession.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'play playlist' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-3'));
    expect(screen.getByLabelText('queue-track-ids').textContent).toBe('track-3,track-4');
    expect(screen.getByLabelText('repeat-mode').textContent).toBe('off');
    expect(screen.getByLabelText('shuffle-mode').textContent).toBe('off');
    await waitForDeferredPlaybackTask(() => expect(saveQueueSession).toHaveBeenCalled());

    const savedSession = saveQueueSession.mock.calls.at(-1)?.[0] as PersistedPlaybackSessionV1 | undefined;
    expect(savedSession?.items.map((item) => item.track.id)).toEqual(['track-1', 'track-2']);
    expect(savedSession).toMatchObject({
      currentTrackId: 'track-1',
      mode: {
        isShuffleEnabled: true,
        repeatMode: 'all',
      },
    });
    const lastSaveCall = saveQueueSession.mock.calls.at(-1) as unknown[] | undefined;
    const broadcastSession = (lastSaveCall?.[1] as { broadcastSnapshot?: PersistedPlaybackSessionV1 } | undefined)?.broadcastSnapshot;
    expect(broadcastSession?.items.map((item) => item.track.id)).toEqual(['track-3', 'track-4']);
    expect(broadcastSession).toMatchObject({
      currentTrackId: 'track-3',
      playlistPlayback: {
        active: true,
        label: 'Road Mix',
        playlistId: 'playlist-1',
        snapshot: {
          currentTrackId: 'track-1',
        },
      },
    });
  });

  it('uses the next queued track for manual next while repeat-one stays enabled', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const RepeatOneManualNextProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.setRepeatMode('one');
        void queue.playTrack(first, { replaceQueueWith: [first, second] });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="repeat-mode">{queue.repeatMode}</output>
          <button type="button" onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <RepeatOneManualNextProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe(first.id));
    expect(screen.getByLabelText('repeat-mode').textContent).toBe('one');

    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe(second.id));
    expect(screen.getByLabelText('repeat-mode').textContent).toBe('one');
    expect(playLocalFile).toHaveBeenLastCalledWith(expect.objectContaining({ trackId: second.id }));
  });

  it('keeps repeat-one for automatic end-of-track advance', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const RepeatOneAutoAdvanceProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.setRepeatMode('one');
        void queue.playTrack(first, { replaceQueueWith: [first, second] });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <button type="button" onClick={() => void queue.playNext({ autoAdvance: true })}>
            auto next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <RepeatOneAutoAdvanceProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe(first.id));

    fireEvent.click(screen.getByRole('button', { name: 'auto next' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('current-track').textContent).toBe(first.id);
    expect(playLocalFile).toHaveBeenLastCalledWith(expect.objectContaining({ trackId: first.id }));
  });

  it('does not repeat recently played queue items while shuffle still has unplayed tracks', async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4)];
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const ShuffleProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue(tracks);
        queue.toggleShuffle();
        void queue.playTrack(tracks[0]);
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <button type="button" onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <ShuffleProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));
    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-2'));
    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));
    await act(async () => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-3'));
    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(3));
    await act(async () => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-4'));

    expect(randomSpy).toHaveBeenCalled();
  });

  it('loads shuffle candidates from the full song library when the current queue came from Songs', async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const getTracks = vi.fn().mockResolvedValue({
      items: [tracks[0], tracks[1], tracks[2]],
      page: 1,
      pageSize: 50,
      total: 3,
      hasMore: false,
    });

    window.echo = {
      playback: {
        playLocalFile: vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
          Promise.resolve({
            state: 'playing',
            currentTrackId: request.trackId,
            positionMs: 0,
            durationMs: 120000,
            filePath: request.filePath,
          }),
        ),
      },
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    const LibraryShuffleProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.toggleShuffle();
        void queue.playTrack(tracks[0], {
          replaceQueueWith: [tracks[0]],
          source: { type: 'songs', label: 'Songs', search: 'visible-only', sort: 'default', hideDuplicates: true },
        });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <button type="button" disabled={!queue.canGoNext} onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <LibraryShuffleProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'next' }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-2'));
    expect(getTracks).toHaveBeenCalledWith({
      page: 1,
      pageSize: 128,
      search: undefined,
      sort: 'random',
      hideDuplicates: undefined,
      showDuplicatesOnly: undefined,
      duplicateMode: 'strict',
      excludeTrackIds: ['track-1'],
      randomWindow: true,
    });
  });

  it('loads shuffle candidates from the current folder when the current queue came from Folders', async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
    const getTracks = vi.fn();
    const getFolderTracks = vi.fn().mockResolvedValue({
      items: [tracks[1], tracks[2]],
      page: 1,
      pageSize: 128,
      total: 3,
      hasMore: false,
    });

    window.echo = {
      playback: {
        playLocalFile: vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
          Promise.resolve({
            state: 'playing',
            currentTrackId: request.trackId,
            positionMs: 0,
            durationMs: 120000,
            filePath: request.filePath,
          }),
        ),
      },
      library: {
        getFolderTracks,
        getTracks,
      },
    } as unknown as Window['echo'];

    const folderSource = {
      type: 'folder' as const,
      label: 'Music / Rock',
      folderId: 'folder-1',
      path: 'D:\\Music\\Rock',
      recursive: true,
      search: 'solo',
      sort: 'default',
    };

    const FolderShuffleProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.toggleShuffle();
        void queue.playTrack(tracks[0], {
          replaceQueueWith: [tracks[0]],
          source: folderSource,
        });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <button type="button" onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <FolderShuffleProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-2'));
    expect(getFolderTracks).toHaveBeenCalledWith({
      folderId: 'folder-1',
      path: 'D:\\Music\\Rock',
      recursive: true,
      page: 1,
      pageSize: 128,
      search: 'solo',
      sort: 'random',
      excludeTrackIds: ['track-1'],
      randomWindow: true,
    });
    expect(getTracks).not.toHaveBeenCalled();
  });

  it('loads shuffle candidates from the full song library when the current queue is manual', async () => {
    const tracks = [makeTrack(1), makeTrack(2)];
    const getTracks = vi.fn().mockResolvedValue({
      items: [tracks[1]],
      page: 1,
      pageSize: 128,
      total: 2,
      hasMore: false,
    });

    window.echo = {
      playback: {
        playLocalFile: vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
          Promise.resolve({
            state: 'playing',
            currentTrackId: request.trackId,
            positionMs: 0,
            durationMs: 120000,
            filePath: request.filePath,
          }),
        ),
      },
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    const ManualShuffleProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.toggleShuffle();
        void queue.playTrack(tracks[0], { replaceQueueWith: [tracks[0]] });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <button type="button" disabled={!queue.canGoNext} onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <ManualShuffleProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'next' }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-2'));
    expect(getTracks).toHaveBeenCalledWith({
      page: 1,
      pageSize: 128,
      search: undefined,
      sort: 'random',
      hideDuplicates: undefined,
      showDuplicatesOnly: undefined,
      duplicateMode: 'strict',
      excludeTrackIds: ['track-1'],
      randomWindow: true,
    });
  });

  it('keeps shuffled liked playback inside the active liked source', async () => {
    const likedTracks = [makeTrack(1), makeTrack(2)];
    const outsideTrack = makeTrack(99);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const getTracks = vi.fn().mockResolvedValue({
      items: [outsideTrack],
      page: 1,
      pageSize: 128,
      total: 1,
      hasMore: false,
    });
    const getLikedTracks = vi.fn().mockResolvedValue({
      items: [makeLikedPlaylistItem(likedTracks[1], 'netease')],
      page: 1,
      pageSize: 128,
      total: 2,
      hasMore: false,
    });

    window.echo = {
      playback: {
        playLocalFile: vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
          Promise.resolve({
            state: 'playing',
            currentTrackId: request.trackId,
            positionMs: 0,
            durationMs: 120000,
            filePath: request.filePath,
          }),
        ),
      },
      library: {
        getLikedTracks,
        getTracks,
      },
    } as unknown as Window['echo'];

    const LikedShuffleProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.toggleShuffle();
        void queue.playTrack(likedTracks[0], {
          replaceQueueWith: [likedTracks[0]],
          source: { type: 'liked', label: 'NetEase liked', sourceProvider: 'netease' },
        });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <button type="button" disabled={!queue.canGoNext} onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <LikedShuffleProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'next' }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-2'));
    expect(getLikedTracks).toHaveBeenCalledWith({
      page: 1,
      pageSize: 128,
      search: undefined,
      sort: 'random',
      sourceProvider: 'netease',
      randomWindow: true,
    });
    expect(getTracks).not.toHaveBeenCalled();
  });

  it('reuses full-library shuffle batches instead of querying on every next track', async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );
    const getTracks = vi.fn().mockResolvedValue({
      items: [tracks[1], tracks[2]],
      page: 1,
      pageSize: 128,
      total: 3,
      hasMore: false,
    });

    window.echo = {
      playback: {
        playLocalFile,
      },
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    const BatchedShuffleProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.toggleShuffle();
        void queue.playTrack(tracks[0], { replaceQueueWith: [tracks[0]] });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <button type="button" onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <BatchedShuffleProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-2'));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-3'));

    expect(getTracks).toHaveBeenCalledTimes(1);
  });

  it('uses full-library candidates before queued songs while shuffle is enabled', async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const getTracks = vi.fn().mockResolvedValue({
      items: [tracks[2]],
      page: 1,
      pageSize: 500,
      total: 3,
      hasMore: false,
    });

    window.echo = {
      playback: {
        playLocalFile: vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
          Promise.resolve({
            state: 'playing',
            currentTrackId: request.trackId,
            positionMs: 0,
            durationMs: 120000,
            filePath: request.filePath,
          }),
        ),
      },
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    const QueuedSongsShuffleProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.toggleShuffle();
        void queue.playTrack(tracks[0], {
          replaceQueueWith: tracks,
          source: { type: 'songs', label: 'Songs', sort: 'random' },
        });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <button type="button" onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <QueuedSongsShuffleProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-3'));
    expect(getTracks).toHaveBeenCalledWith({
      page: 1,
      pageSize: 128,
      search: undefined,
      sort: 'random',
      hideDuplicates: undefined,
      showDuplicatesOnly: undefined,
      duplicateMode: 'strict',
      excludeTrackIds: ['track-1'],
      randomWindow: true,
    });
  });

  it('refreshes a random Songs queue after the loaded random page is exhausted', async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4)];
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );
    const getTracks = vi.fn().mockResolvedValue({
      items: [tracks[2], tracks[3]],
      page: 1,
      pageSize: 2,
      total: 4,
      hasMore: true,
    });

    window.echo = {
      playback: {
        playLocalFile,
      },
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    const RandomQueueRefreshProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(tracks[0], {
          replaceQueueWith: [tracks[0], tracks[1]],
          source: { type: 'songs', label: 'Songs', sort: 'random' },
        });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="queue-track-ids">{queue.items.map((item) => item.track.id).join(',')}</output>
          <button type="button" disabled={!queue.canGoNext} onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <RandomQueueRefreshProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-1'));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-2'));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-3'));
    expect(screen.getByLabelText('queue-track-ids').textContent).toBe('track-3,track-4');
    expect(getTracks).toHaveBeenCalledWith({
      page: 1,
      pageSize: 2,
      search: undefined,
      sort: 'random',
      hideDuplicates: undefined,
      showDuplicatesOnly: undefined,
      duplicateMode: 'strict',
      excludeTrackIds: ['track-2', 'track-1'],
      randomWindow: true,
    });
  });

  it('does not fall back to the loaded queue when library shuffle returns no fresh candidates', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );
    const getTracks = vi.fn().mockResolvedValue({
      items: [first],
      page: 1,
      pageSize: 500,
      total: 1,
      hasMore: false,
    });

    window.echo = {
      playback: {
        playLocalFile,
      },
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    const ExhaustedLibraryShuffleProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.toggleShuffle();
        void queue.playTrack(first, {
          replaceQueueWith: [first, second],
          source: { type: 'songs', label: 'Songs', sort: 'default' },
        });
      }, [queue]);

      return (
        <div>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <button type="button" disabled={!queue.canGoNext} onClick={() => void queue.playNext()}>
            next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <ExhaustedLibraryShuffleProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe(first.id));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(getTracks).toHaveBeenCalledTimes(1));
    expect(playLocalFile).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('current-track').textContent).toBe(first.id);
  });

  it('turns off repeat-all when shuffle is enabled', async () => {
    const ModeProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();

      return (
        <div>
          <span data-testid="shuffle">{queue.isShuffleEnabled ? 'on' : 'off'}</span>
          <span data-testid="repeat">{queue.repeatMode}</span>
          <button type="button" onClick={() => queue.setRepeatMode('all')}>
            repeat all
          </button>
          <button type="button" onClick={queue.toggleShuffle}>
            shuffle
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <ModeProbe />
      </PlaybackQueueProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'repeat all' }));
    expect(screen.getByTestId('repeat').textContent).toBe('all');

    fireEvent.click(screen.getByRole('button', { name: 'shuffle' }));

    await waitFor(() => expect(screen.getByTestId('shuffle').textContent).toBe('on'));
    expect(screen.getByTestId('repeat').textContent).toBe('off');
  });

  it('keeps auto-fill queue off by default and fills a random queue only after enabling it', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const third = makeTrack(3);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 120000,
        filePath: request.filePath,
      }),
    );
    const getTracks = vi.fn().mockResolvedValue({ items: [second, third], total: 2, page: 1, pageSize: 96 });

    window.echo = {
      playback: {
        playLocalFile,
      },
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    const AutoFillProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        void queue.playTrack(first, { replaceQueueWith: [first] });
      }, [queue]);

      return (
        <div>
          <output aria-label="auto-fill">{queue.autoFillQueueEnabled ? 'on' : 'off'}</output>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="queue-track-ids">{queue.items.map((item) => item.track.id).join(',')}</output>
          <button type="button" onClick={() => queue.setAutoFillQueueEnabled(true)}>
            enable auto fill
          </button>
          <button type="button" onClick={() => void queue.playNext({ autoAdvance: true })}>
            auto next
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <AutoFillProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe(first.id));
    expect(screen.getByLabelText('auto-fill').textContent).toBe('off');

    fireEvent.click(screen.getByRole('button', { name: 'auto next' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(getTracks).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'enable auto fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'auto next' }));

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe(second.id));
    expect(getTracks).toHaveBeenCalledWith(expect.objectContaining({ sort: 'random', randomWindow: true }));
    expect(screen.getByLabelText('queue-track-ids').textContent).toBe('track-2,track-3');
    expect(playLocalFile).toHaveBeenCalledTimes(2);
  });

  it('remembers shuffle and repeat mode across provider restarts', async () => {
    const ModeProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();

      return (
        <div>
          <span data-testid="shuffle">{queue.isShuffleEnabled ? 'on' : 'off'}</span>
          <span data-testid="repeat">{queue.repeatMode}</span>
          <button type="button" onClick={queue.toggleShuffle}>
            shuffle
          </button>
          <button type="button" onClick={() => queue.setRepeatMode('one')}>
            repeat one
          </button>
        </div>
      );
    };

    const firstRender = render(
      <PlaybackQueueProvider>
        <ModeProbe />
      </PlaybackQueueProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'shuffle' }));
    fireEvent.click(screen.getByRole('button', { name: 'repeat one' }));

    await waitFor(() => expect(screen.getByTestId('shuffle').textContent).toBe('on'));
    expect(screen.getByTestId('repeat').textContent).toBe('one');

    firstRender.unmount();

    render(
      <PlaybackQueueProvider>
        <ModeProbe />
      </PlaybackQueueProvider>,
    );

    expect(screen.getByTestId('shuffle').textContent).toBe('on');
    expect(screen.getByTestId('repeat').textContent).toBe('one');
  });

  it('remembers queue items and the current track across provider restarts', async () => {
    const tracks = [makeTrack(1), makeTrack(2)];

    const QueueMemoryProbe = ({ seed = false }: { seed?: boolean }): JSX.Element => {
      const queue = usePlaybackQueue();
      const didSeedRef = useRef(false);

      useEffect(() => {
        if (!seed || didSeedRef.current) {
          return;
        }

        didSeedRef.current = true;
        queue.replaceQueue(tracks, { startTrackId: tracks[1].id });
      }, [queue, seed]);

      return (
        <div>
          <output aria-label="queue-size">{queue.items.length}</output>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="current-title">{queue.currentTrack?.title ?? ''}</output>
        </div>
      );
    };

    const firstRender = render(
      <PlaybackQueueProvider>
        <QueueMemoryProbe seed />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('queue-size').textContent).toBe('2'));
    expect(screen.getByLabelText('current-track').textContent).toBe('track-2');

    firstRender.unmount();

    render(
      <PlaybackQueueProvider>
        <QueueMemoryProbe />
      </PlaybackQueueProvider>,
    );

    expect(screen.getByLabelText('queue-size').textContent).toBe('2');
    expect(screen.getByLabelText('current-track').textContent).toBe('track-2');
    expect(screen.getByLabelText('current-title').textContent).toBe('Track 2');
  });

  it('removes every queued instance of a track by track id', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);

    const RemoveTrackProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didSeedRef = useRef(false);

      useEffect(() => {
        if (didSeedRef.current) {
          return;
        }

        didSeedRef.current = true;
        queue.appendToQueue(first);
        queue.appendToQueue(second);
        queue.appendToQueue(first);
      }, [queue]);

      return (
        <div>
          <output aria-label="queue-track-ids">{queue.items.map((item) => item.track.id).join(',')}</output>
          <button type="button" onClick={() => queue.removeTrackFromQueue(first.id)}>
            remove first
          </button>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <RemoveTrackProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('queue-track-ids').textContent).toBe('track-1,track-2,track-1'));
    fireEvent.click(screen.getByRole('button', { name: 'remove first' }));

    await waitFor(() => expect(screen.getByLabelText('queue-track-ids').textContent).toBe('track-2'));
  });
});

describe('PlaybackQueueProvider persisted queue session', () => {
  const renderSessionProbe = (): void => {
    const SessionProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();

      return (
        <div>
          <output aria-label="queue-size">{queue.items.length}</output>
          <output aria-label="current-track">{queue.currentTrackId ?? ''}</output>
          <output aria-label="repeat-mode">{queue.repeatMode}</output>
          <output aria-label="shuffle-mode">{queue.isShuffleEnabled ? 'on' : 'off'}</output>
          <output aria-label="automix-mode">{queue.automixEnabled ? 'on' : 'off'}</output>
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <SessionProbe />
      </PlaybackQueueProvider>,
    );
  };

  it('hydrates queue, current item, and playback mode from the main process session', async () => {
    const tracks = [makeTrack(1), makeTrack(2)];
    const session = makePersistedQueueSession(tracks, {
      currentQueueId: 'queue-2',
      currentTrackId: tracks[1].id,
      lastPlayedTrack: tracks[1],
      mode: {
        isShuffleEnabled: true,
        repeatMode: 'one',
        automixEnabled: true,
      },
    });

    window.echo = {
      playback: {
        getQueueSession: vi.fn().mockResolvedValue(session),
        saveQueueSession: vi.fn(async (snapshot) => snapshot),
      },
    } as unknown as Window['echo'];

    renderSessionProbe();

    await waitFor(() => expect(screen.getByLabelText('queue-size').textContent).toBe('2'));
    expect(screen.getByLabelText('current-track').textContent).toBe('track-2');
    expect(screen.getByLabelText('repeat-mode').textContent).toBe('one');
    expect(screen.getByLabelText('shuffle-mode').textContent).toBe('on');
    expect(screen.getByLabelText('automix-mode').textContent).toBe('off');
  });

  it('does not write an empty queue before main-process hydration finishes', () => {
    vi.useFakeTimers();
    const saveQueueSession = vi.fn(async (snapshot) => snapshot);
    window.echo = {
      playback: {
        getQueueSession: vi.fn(() => new Promise<PersistedPlaybackSessionV1 | null>(() => undefined)),
        saveQueueSession,
      },
    } as unknown as Window['echo'];

    renderSessionProbe();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveQueueSession).not.toHaveBeenCalled();
  });

  it('migrates the legacy localStorage active queue into the main process session once', async () => {
    const tracks = [makeTrack(1), makeTrack(2)];
    const legacy = makePersistedQueueSession(tracks, {
      currentQueueId: 'queue-2',
      currentTrackId: tracks[1].id,
      lastPlayedTrack: tracks[1],
      mode: {
        isShuffleEnabled: true,
        repeatMode: 'all',
        automixEnabled: false,
      },
    });
    window.localStorage.setItem('echo-next:playback-queue', JSON.stringify({
      version: 1,
      items: legacy.items,
      currentQueueId: legacy.currentQueueId,
      currentTrackId: legacy.currentTrackId,
      lastPlayedTrack: legacy.lastPlayedTrack,
      history: legacy.history,
    }));
    window.localStorage.setItem('echo-next:playback-mode', JSON.stringify({
      isShuffleEnabled: true,
      repeatMode: 'all',
    }));
    window.localStorage.setItem('echo-next:automix-enabled', 'true');

    const saveQueueSession = vi.fn(async (snapshot) => snapshot);
    window.echo = {
      playback: {
        getQueueSession: vi.fn().mockResolvedValue(null),
        saveQueueSession,
      },
    } as unknown as Window['echo'];

    renderSessionProbe();

    await waitFor(() => expect(screen.getByLabelText('current-track').textContent).toBe('track-2'));
    await waitForDeferredPlaybackTask(() => expect(saveQueueSession).toHaveBeenCalled());
    expect(saveQueueSession.mock.calls[0]?.[0]).toMatchObject({
      currentQueueId: 'queue-2',
      currentTrackId: 'track-2',
      mode: {
        isShuffleEnabled: true,
        repeatMode: 'all',
        automixEnabled: false,
      },
    });
    expect(window.localStorage.getItem('echo-next:playback-queue')).toBeNull();
    expect(window.localStorage.getItem('echo-next:playback-mode')).toBeNull();
    expect(window.localStorage.getItem('echo-next:automix-enabled')).toBeNull();
  });

  it('starts the restored current queue item from the persisted resume position', async () => {
    const tracks = [makeTrack(1), makeTrack(2)];
    const session = makePersistedQueueSession(tracks, {
      resume: {
        queueId: 'queue-1',
        trackId: 'track-1',
        filePath: tracks[0].path,
        positionMs: 42000,
        durationMs: 120000,
        state: 'paused',
        updatedAt: '2026-05-21T00:03:00.000Z',
      },
    });
    const playLocalFile = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: 'track-1',
      positionMs: 42000,
      durationMs: 120000,
      filePath: tracks[0].path,
    });
    window.echo = {
      playback: {
        getQueueSession: vi.fn().mockResolvedValue(session),
        saveQueueSession: vi.fn(async (snapshot) => snapshot),
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const PlayProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      return (
        <div>
          {queue.items.map((item) => (
            <button key={item.queueId} type="button" onClick={() => void queue.playQueueItem(item.queueId)}>
              {item.track.title}
            </button>
          ))}
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <PlayProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Track 1' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Track 1' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalled());
    expect(playLocalFile.mock.calls[0]?.[0].startSeconds).toBe(42);
  });

  it('does not reuse the resume position for a different queue item', async () => {
    const tracks = [makeTrack(1), makeTrack(2)];
    const session = makePersistedQueueSession(tracks, {
      resume: {
        queueId: 'queue-1',
        trackId: 'track-1',
        filePath: tracks[0].path,
        positionMs: 42000,
        durationMs: 120000,
        state: 'paused',
        updatedAt: '2026-05-21T00:03:00.000Z',
      },
    });
    const playLocalFile = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: 'track-2',
      positionMs: 0,
      durationMs: 120000,
      filePath: tracks[1].path,
    });
    window.echo = {
      playback: {
        getQueueSession: vi.fn().mockResolvedValue(session),
        saveQueueSession: vi.fn(async (snapshot) => snapshot),
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const PlayProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      return (
        <div>
          {queue.items.map((item) => (
            <button key={item.queueId} type="button" onClick={() => void queue.playQueueItem(item.queueId)}>
              {item.track.title}
            </button>
          ))}
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <PlayProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Track 2' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Track 2' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalled());
    expect(playLocalFile.mock.calls[0]?.[0].startSeconds).toBeUndefined();
  });

  it('consumes the restored resume position after playing another queue item', async () => {
    const tracks = [makeTrack(1), makeTrack(2)];
    const session = makePersistedQueueSession(tracks, {
      resume: {
        queueId: 'queue-1',
        trackId: 'track-1',
        filePath: tracks[0].path,
        positionMs: 42000,
        durationMs: 120000,
        state: 'paused',
        updatedAt: '2026-05-21T00:03:00.000Z',
      },
    });
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; startSeconds?: number }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: Math.round((request.startSeconds ?? 0) * 1000),
        durationMs: 120000,
        filePath: tracks.find((track) => track.id === request.trackId)?.path ?? '',
      }),
    );
    window.echo = {
      playback: {
        getQueueSession: vi.fn().mockResolvedValue(session),
        saveQueueSession: vi.fn(async (snapshot) => snapshot),
        playLocalFile,
      },
    } as unknown as Window['echo'];

    const PlayProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      return (
        <div>
          {queue.items.map((item) => (
            <button key={item.queueId} type="button" onClick={() => void queue.playQueueItem(item.queueId)}>
              {item.track.title}
            </button>
          ))}
        </div>
      );
    };

    render(
      <PlaybackQueueProvider>
        <PlayProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Track 2' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Track 2' }));
    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(playLocalFile.mock.calls[0]?.[0].startSeconds).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Track 1' }));
    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));
    expect(playLocalFile.mock.calls[1]?.[0].startSeconds).toBeUndefined();
  });
});
