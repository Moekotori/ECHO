// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryTrack } from '../../shared/types/library';
import { I18nProvider } from '../i18n/I18nProvider';
import { PlaybackQueueProvider, usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { QueuePage } from './QueuePage';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 64,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 64 })),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));

vi.mock('../components/library/OsuTimingPanel', () => ({
  OsuTimingPanel: () => null,
}));

vi.mock('../components/library/TrackTagEditorDrawer', () => ({
  TrackTagEditorDrawer: () => null,
}));

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
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 320000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

const QueueSeeder = ({ startTrackId, tracks }: { startTrackId?: string; tracks: LibraryTrack[] }): null => {
  const queue = usePlaybackQueue();
  const didSeedRef = useRef(false);

  useEffect(() => {
    if (didSeedRef.current) {
      return;
    }

    didSeedRef.current = true;
    queue.replaceQueue(tracks, startTrackId ? { startTrackId } : undefined);
  }, [queue, startTrackId, tracks]);

  return null;
};

const QueueSourceProbe = (): JSX.Element => {
  const queue = usePlaybackQueue();

  return (
    <output aria-label="queue-sources">
      {queue.items.map((item) => `${item.source.type}:${'sort' in item.source ? item.source.sort ?? '' : ''}`).join(',')}
    </output>
  );
};

const renderQueuePage = (tracks: LibraryTrack[], options: { startTrackId?: string } = {}): void => {
  render(
    <I18nProvider>
      <PlaybackQueueProvider>
        <QueueSeeder startTrackId={options.startTrackId} tracks={tracks} />
        <QueueSourceProbe />
        <QueuePage />
      </PlaybackQueueProvider>
    </I18nProvider>,
  );
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('QueuePage', () => {
  it('uses original artwork for the large now-playing cover only', async () => {
    const track: LibraryTrack = {
      ...makeTrack(1),
      coverId: 'cover 1',
      coverThumb: 'echo-cover://thumb/cover%201',
    };

    renderQueuePage([track], { startTrackId: track.id });

    await waitFor(() =>
      expect(document.querySelector('.queue-now-cover img')?.getAttribute('src')).toBe('echo-cover://original/cover%201'),
    );
    expect(document.querySelector('.queue-row-cover img')?.getAttribute('src')).toBe('echo-cover://thumb/cover%201');
  });

  it('plays a queued item when its row is double-clicked', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 180000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
      library: {
        startPlaybackHistory: vi.fn().mockResolvedValue({ historyId: 'history-1' }),
      },
    } as unknown as Window['echo'];

    renderQueuePage([first, second]);

    const secondTitle = await screen.findByText('Track 2');
    const secondRow = secondTitle.closest('.queue-row');
    expect(secondRow).toBeTruthy();

    fireEvent.doubleClick(secondRow!);

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: second.id })));
  });

  it('generates random queues as refreshable song-library random queues', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const getTracks = vi.fn().mockResolvedValue({
      items: [first, second],
      page: 1,
      pageSize: 96,
      total: 2,
      hasMore: false,
    });

    window.echo = {
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    renderQueuePage([]);

    fireEvent.click(await screen.findByRole('button', { name: 'Generate random queue' }));

    await waitFor(() =>
      expect(getTracks).toHaveBeenCalledWith({
        page: 1,
        pageSize: 96,
        sort: 'random',
        randomWindow: true,
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('queue-sources').textContent).toBe('songs:random,songs:random'));
  });

  it('does not treat double-clicks inside the action group as row playback', async () => {
    const first = makeTrack(1);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 180000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
      library: {
        startPlaybackHistory: vi.fn().mockResolvedValue({ historyId: 'history-1' }),
      },
    } as unknown as Window['echo'];

    renderQueuePage([first]);

    const firstRow = (await screen.findByText('Track 1')).closest('.queue-row');
    const actionGroup = firstRow?.querySelector('.queue-row-actions');
    expect(actionGroup).toBeTruthy();

    fireEvent.doubleClick(actionGroup!);

    expect(playLocalFile).not.toHaveBeenCalled();
  });

  it('does not create a local playlist from remote-only queue items', async () => {
    const remoteTrack: LibraryTrack = {
      ...makeTrack(1),
      id: 'remote-track-1',
      path: 'webdav://source/music/track-1.flac',
      sourceId: 'remote-source-1',
      remotePath: '/music/track-1.flac',
      stableKey: 'remote:source-1:/music/track-1.flac',
    };
    const createPlaylist = vi.fn().mockResolvedValue({
      id: 'playlist-queue',
      name: 'Queue Playlist',
    });
    const addTracksToPlaylist = vi.fn().mockResolvedValue([{ id: 'playlist-item-1' }]);
    const deletePlaylist = vi.fn();

    window.echo = {
      library: {
        createPlaylist,
        addTracksToPlaylist,
        deletePlaylist,
      },
    } as unknown as Window['echo'];

    renderQueuePage([remoteTrack]);

    await screen.findByText('Track 1');
    fireEvent.click(screen.getByRole('button', { name: '保存为歌单' }));

    await waitFor(() => expect(screen.getByText('当前队列没有可保存到本地歌单的已入库歌曲。')).toBeTruthy());
    expect(createPlaylist).not.toHaveBeenCalled();
    expect(addTracksToPlaylist).not.toHaveBeenCalled();
    expect(deletePlaylist).not.toHaveBeenCalled();
  });

  it('does not create a playlist from streaming-only queue items', async () => {
    const streamingTrack: LibraryTrack = {
      ...makeTrack(2),
      id: 'streaming:netease:200',
      mediaType: 'streaming',
      path: 'streaming:netease:200',
      provider: 'netease',
      providerTrackId: '200',
      stableKey: 'streaming:netease:200',
      codec: null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
    };
    const createPlaylist = vi.fn().mockResolvedValue({
      id: 'playlist-queue',
      name: 'Queue Playlist',
    });
    const addStreamingTrackToPlaylist = vi.fn().mockResolvedValue({ id: 'playlist-item-streaming' });

    window.echo = {
      library: {
        createPlaylist,
        addTracksToPlaylist: vi.fn(),
        addStreamingTrackToPlaylist,
      },
    } as unknown as Window['echo'];

    renderQueuePage([streamingTrack]);

    await screen.findByText('Track 2');
    fireEvent.click(screen.getByRole('button', { name: '保存为歌单' }));

    await waitFor(() => expect(screen.getByText('当前队列没有可保存到本地歌单的已入库歌曲。')).toBeTruthy());
    expect(createPlaylist).not.toHaveBeenCalled();
    expect(addStreamingTrackToPlaylist).not.toHaveBeenCalled();
  });

  it('skips remote and streaming items when saving a mixed queue to a local playlist', async () => {
    const localTrack = makeTrack(1);
    const remoteTrack: LibraryTrack = {
      ...makeTrack(3),
      id: 'remote-track-3',
      mediaType: 'remote',
      path: 'webdav://source/music/track-3.flac',
      sourceId: 'remote-source-1',
      remotePath: '/music/track-3.flac',
      stableKey: 'remote:source-1:/music/track-3.flac',
    };
    const streamingTrack: LibraryTrack = {
      ...makeTrack(2),
      id: 'streaming:netease:200',
      mediaType: 'streaming',
      path: 'streaming:netease:200',
      provider: 'netease',
      providerTrackId: '200',
      stableKey: 'streaming:netease:200',
    };
    const createPlaylist = vi.fn().mockResolvedValue({
      id: 'playlist-queue',
      name: 'Queue Playlist',
    });
    const addTracksToPlaylist = vi.fn().mockResolvedValue([{ id: 'playlist-item-local' }]);
    const addStreamingTrackToPlaylist = vi.fn();

    window.echo = {
      library: {
        createPlaylist,
        addTracksToPlaylist,
        addStreamingTrackToPlaylist,
      },
    } as unknown as Window['echo'];

    renderQueuePage([localTrack, remoteTrack, streamingTrack]);

    await screen.findByText('Track 2');
    fireEvent.click(screen.getByRole('button', { name: '保存为歌单' }));

    await waitFor(() => expect(addTracksToPlaylist).toHaveBeenCalledWith('playlist-queue', ['track-1']));
    expect(addStreamingTrackToPlaylist).not.toHaveBeenCalled();
  });
});
