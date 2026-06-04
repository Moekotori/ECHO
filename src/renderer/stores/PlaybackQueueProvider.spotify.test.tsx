// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryTrack } from '../../shared/types/library';
import type { PersistedPlaybackSessionV1 } from '../../shared/types/playback';
import { PlaybackQueueProvider, usePlaybackQueue } from './PlaybackQueueProvider';
import { pauseSpotifyPlayback, playSpotifyTrack } from '../integrations/spotify/spotifyPlayback';

vi.mock('../integrations/spotify/spotifyPlayback', () => ({
  isSpotifyTrack: (track: LibraryTrack | null | undefined): boolean =>
    track?.mediaType === 'streaming' && track.provider === 'spotify',
  playSpotifyTrack: vi.fn(async (track: LibraryTrack, startSeconds = 0) => ({
    state: 'playing',
    currentTrackId: track.id,
    positionMs: Math.round(startSeconds * 1000),
    durationMs: Math.round(track.duration * 1000),
    filePath: track.stableKey ?? track.path,
  })),
  pauseSpotifyPlayback: vi.fn(async (track: LibraryTrack) => ({
    state: 'paused',
    currentTrackId: track.id,
    positionMs: 12_000,
    durationMs: Math.round(track.duration * 1000),
    filePath: track.stableKey ?? track.path,
  })),
}));

const makeTrack = (index: number, overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
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
  ...overrides,
});

const makeSpotifyTrack = (): LibraryTrack =>
  makeTrack(1, {
    id: 'streaming:spotify:abc123',
    path: 'streaming:spotify:abc123',
    stableKey: 'streaming:spotify:abc123',
    mediaType: 'streaming',
    provider: 'spotify',
    providerTrackId: 'abc123',
    codec: 'spotify',
    sampleRate: null,
    bitDepth: null,
    bitrate: null,
  });

const makeSession = (track: LibraryTrack): PersistedPlaybackSessionV1 => ({
  version: 1,
  items: [
    {
      queueId: 'queue-spotify',
      track,
      source: { type: 'manual', label: 'Manual queue' },
      addedAt: '2026-05-21T00:00:00.000Z',
    },
  ],
  currentQueueId: 'queue-spotify',
  currentTrackId: track.id,
  lastPlayedTrack: track,
  history: [],
  mode: {
    isShuffleEnabled: false,
    repeatMode: 'off',
    automixEnabled: false,
  },
  resume: {
    queueId: 'queue-spotify',
    trackId: track.id,
    filePath: track.path,
    positionMs: 42_000,
    durationMs: 120_000,
    state: 'paused',
    updatedAt: '2026-05-21T00:03:00.000Z',
  },
  updatedAt: '2026-05-21T00:00:00.000Z',
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as Partial<Window>).echo;
});

describe('PlaybackQueueProvider Spotify boundaries', () => {
  it('passes the restored resume position into Spotify playback', async () => {
    const track = makeSpotifyTrack();
    window.echo = {
      playback: {
        getQueueSession: vi.fn().mockResolvedValue(makeSession(track)),
        saveQueueSession: vi.fn(async (snapshot) => snapshot),
        stop: vi.fn().mockResolvedValue({
          state: 'stopped',
          currentTrackId: null,
          positionMs: 0,
          durationMs: 0,
          filePath: null,
        }),
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

    await screen.findByRole('button', { name: 'Track 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Track 1' }));

    await waitFor(() => expect(playSpotifyTrack).toHaveBeenCalledWith(track, 42));
  });

  it('pauses Spotify before switching from a Spotify item to local playback', async () => {
    const spotifyTrack = makeSpotifyTrack();
    const localTrack = makeTrack(2);
    const playLocalFile = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: localTrack.id,
      positionMs: 0,
      durationMs: localTrack.duration * 1000,
      filePath: localTrack.path,
    });

    window.echo = {
      playback: {
        playLocalFile,
        stop: vi.fn().mockResolvedValue({
          state: 'stopped',
          currentTrackId: null,
          positionMs: 0,
          durationMs: 0,
          filePath: null,
        }),
      },
    } as unknown as Window['echo'];

    const QueueProbe = (): JSX.Element => {
      const queue = usePlaybackQueue();
      const didStartRef = useRef(false);

      useEffect(() => {
        if (didStartRef.current) {
          return;
        }

        didStartRef.current = true;
        queue.replaceQueue([spotifyTrack, localTrack]);
        void queue.playTrack(spotifyTrack);
      }, [queue]);

      return <button type="button" onClick={() => void queue.playNext()}>next</button>;
    };

    render(
      <PlaybackQueueProvider>
        <QueueProbe />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(playSpotifyTrack).toHaveBeenCalledWith(spotifyTrack, 0));
    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: localTrack.id })));
    expect(pauseSpotifyPlayback).toHaveBeenCalledWith(spotifyTrack);
    expect(vi.mocked(pauseSpotifyPlayback).mock.invocationCallOrder[0]).toBeLessThan(
      playLocalFile.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });
});
