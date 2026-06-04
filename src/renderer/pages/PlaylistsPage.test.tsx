// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DragEvent } from 'react';
import type { DownloadJob } from '../../shared/types/downloads';
import type { LibraryPage, LibraryPlaylist, LibraryPlaylistItem, LibraryTrack } from '../../shared/types/library';
import type { StreamingFavoriteTrack, StreamingFavoritesSnapshot } from '../../shared/types/streaming';
import { translations, isLocale, localeOptions } from '../i18n/locales';
import { PlaybackQueueProvider, usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { PlaylistsPage } from './PlaylistsPage';

vi.mock('../components/library/TrackList', () => ({
  TrackList: ({
    tracks,
    isTrackDraggable,
    onTrackDragEnd,
    onTrackDragOver,
    onTrackDragStart,
    onTrackDrop,
    onOpenTrackMenu,
    onPlay,
    onToggleLiked,
  }: {
    tracks: LibraryTrack[];
    isTrackDraggable?: (track: LibraryTrack) => boolean;
    onTrackDragEnd?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
    onTrackDragOver?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
    onTrackDragStart?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
    onTrackDrop?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
    onOpenTrackMenu?: (track: LibraryTrack, position: { x: number; y: number }) => void;
    onPlay?: (track: LibraryTrack) => void;
    onToggleLiked?: (track: LibraryTrack) => void;
  }) => (
    <div data-testid="playlist-track-list">
      {tracks.map((track) => (
        <div
          data-testid={`playlist-track-row-${track.playlistItemId ?? track.id}`}
          draggable={isTrackDraggable?.(track) ?? false}
          key={track.playlistItemId ?? track.id}
          onDragEnd={(event) => onTrackDragEnd?.(event, track)}
          onDragOver={(event) => onTrackDragOver?.(event, track)}
          onDragStart={(event) => onTrackDragStart?.(event, track)}
          onDrop={(event) => onTrackDrop?.(event, track)}
        >
          <button type="button" onClick={() => onPlay?.(track)}>
            {track.title}
          </button>
          <button type="button" onClick={() => onToggleLiked?.(track)}>
            Like {track.title}
          </button>
          <button type="button" onClick={() => onOpenTrackMenu?.(track, { x: 12, y: 34 })}>
            Open menu for {track.title}
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../components/library/TrackContextMenu', () => ({
  TrackContextMenu: ({
    onAction,
    track,
  }: {
    onAction: (action: 'show-in-folder' | 'copy-path' | 'open-system' | 'remove-from-playlist', track: LibraryTrack) => void;
    track: LibraryTrack;
  }) => (
    <div role="menu">
      <button type="button" onClick={() => onAction('show-in-folder', track)}>
        Show in folder
      </button>
      <button type="button" onClick={() => onAction('copy-path', track)}>
        Copy path
      </button>
      <button type="button" onClick={() => onAction('open-system', track)}>
        Open with system
      </button>
      <button type="button" onClick={() => onAction('remove-from-playlist', track)}>
        Remove from playlist
      </button>
    </div>
  ),
}));

vi.mock('../i18n/I18nProvider', async () => {
  const actual = await vi.importActual<typeof import('../i18n/I18nProvider')>('../i18n/I18nProvider');
  const fallbackLocale = 'zh-CN' as const;
  const interpolate = (text: string, options?: Record<string, string | number>): string =>
    options
      ? Object.entries(options).reduce((current, [key, value]) => current.replaceAll(`{${key}}`, String(value)), text)
      : text;
  const resolveLocale = (): keyof typeof translations => {
    const stored = window.localStorage.getItem('echo-next.locale');
    return isLocale(stored) ? stored : fallbackLocale;
  };

  return {
    ...actual,
    useI18n: () => {
      const locale = resolveLocale();
      return {
        locale,
        localeOptions,
        setLocale: vi.fn(),
        t: (key: keyof (typeof translations)[typeof fallbackLocale], options?: Record<string, string | number>) =>
          interpolate(translations[locale][key] ?? translations[fallbackLocale][key] ?? String(key), options),
      };
    },
  };
});

const playlist = (overrides: Partial<LibraryPlaylist> = {}): LibraryPlaylist => ({
  id: 'playlist-1',
  name: 'Road Mix',
  description: 'Manual local playlist',
  kind: 'manual',
  sourceProvider: 'local',
  sourcePlaylistId: null,
  coverId: null,
  coverThumb: null,
  sortMode: 'manual',
  itemCount: 1,
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
  ...overrides,
});

const track = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\Song.flac',
  title: 'Song One',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 180,
  codec: 'FLAC',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
  ...overrides,
});

const item = (overrides: Partial<LibraryPlaylistItem> = {}): LibraryPlaylistItem => ({
  id: 'item-1',
  playlistId: 'playlist-1',
  mediaType: 'track',
  mediaId: 'track-1',
  sourceProvider: 'local',
  sourceItemId: null,
  titleSnapshot: 'Song One',
  artistSnapshot: 'Artist',
  albumSnapshot: 'Album',
  durationSnapshot: 180,
  coverId: null,
  coverThumb: null,
  position: 0,
  addedAt: '2026-05-14T00:00:00.000Z',
  addedFrom: 'manual',
  unavailable: false,
  track: track(),
  ...overrides,
});

const page = (items: LibraryPlaylistItem[]): LibraryPage<LibraryPlaylistItem> => ({
  items,
  page: 1,
  pageSize: 100,
  total: items.length,
  hasMore: false,
});

const streamingFavoritesSnapshot = (overrides: Partial<StreamingFavoritesSnapshot> = {}): StreamingFavoritesSnapshot => ({
  version: 1,
  updatedAt: '2026-05-29T00:00:00.000Z',
  providers: {
    bilibili: [],
    youtube: [],
    soundcloud: [],
  },
  collections: [],
  ...overrides,
});

const streamingFavoriteTrack = (overrides: Partial<StreamingFavoriteTrack> = {}): StreamingFavoriteTrack => ({
  id: 'streaming:youtube:video-1',
  provider: 'youtube',
  providerTrackId: 'video-1',
  stableKey: 'streaming:youtube:video-1',
  title: 'Video Song',
  artist: 'Video Artist',
  album: 'YouTube',
  albumArtist: 'Video Artist',
  duration: 180,
  coverUrl: null,
  coverThumb: null,
  qualities: ['high'],
  playable: true,
  unavailableReason: null,
  lyricsStatus: 'unknown',
  mvStatus: 'unknown',
  webUrl: 'https://www.youtube.com/watch?v=video-1',
  addedAt: '2026-05-29T00:00:00.000Z',
  updatedAt: '2026-05-29T00:00:00.000Z',
  ...overrides,
});

const downloadJob = (overrides: Partial<DownloadJob> = {}): DownloadJob => ({
  id: 'job-1',
  sourceUrl: 'https://cdn.example/song.mp3',
  provider: 'unknown' as const,
  audioStrategy: 'best_available' as const,
  status: 'queued' as const,
  title: 'Remote Song',
  durationSeconds: null,
  thumbnailUrl: null,
  webpageUrl: null,
  outputPath: null,
  downloadedBytes: null,
  totalBytes: null,
  speedBytesPerSecond: null,
  etaSeconds: null,
  importedTrackId: null,
  progress: 0,
  error: null,
  createdAt: '2026-05-19T00:00:00.000Z',
  updatedAt: '2026-05-19T00:00:00.000Z',
  completedAt: null,
  ...overrides,
});

const dragDataTransfer = () => {
  const data = new Map<string, string>();
  return {
    dropEffect: '',
    effectAllowed: '',
    getData: vi.fn((type: string) => data.get(type) ?? ''),
    setData: vi.fn((type: string, value: string) => {
      data.set(type, value);
    }),
  };
};

const renderPlaylistsPage = () =>
  render(
    <PlaybackQueueProvider>
      <PlaylistsPage />
    </PlaybackQueueProvider>,
  );

const QueueProbe = (): JSX.Element => {
  const queue = usePlaybackQueue();
  return <output aria-label="queue-track-ids">{queue.items.map((item) => item.track.id).join(',')}</output>;
};

const originalClipboard = window.navigator.clipboard;

const installClipboardWriteMock = () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: originalClipboard,
  });
  vi.restoreAllMocks();
});

describe('PlaylistsPage share actions', () => {
  it('copies the external link for an imported streaming playlist', async () => {
    const writeText = installClipboardWriteMock();
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ sourceProvider: 'qqmusic', sourcePlaylistId: '123456', itemCount: 0 })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(await screen.findByRole('button', { name: '分享' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://y.qq.com/n/ryqq/playlist/123456'));
    expect(await screen.findByText('歌单链接已复制')).toBeTruthy();
  });

  it('copies the source link for an imported streaming favorite collection', async () => {
    const writeText = installClipboardWriteMock();
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([]),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      streaming: {
        getFavorites: vi.fn().mockResolvedValue(streamingFavoritesSnapshot({
          collections: [
            {
              id: 'collection-1',
              provider: 'youtube',
              providerPlaylistId: 'PL123',
              name: 'Imported Mix',
              sourceName: 'Imported Mix',
              tracks: [],
              createdAt: '2026-05-29T00:00:00.000Z',
              updatedAt: '2026-05-29T00:00:00.000Z',
            },
          ],
        })),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(screen.getAllByRole('tab')[1]);
    fireEvent.click(await screen.findByRole('button', { name: /Imported Mix/u }));
    fireEvent.click(await screen.findByRole('button', { name: '分享' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://www.youtube.com/playlist?list=PL123'));
  });
});

describe('PlaylistsPage actions menu', () => {
  it('renames the selected playlist from the menu', async () => {
    const renamed = playlist({ name: 'Road Mix 2' });
    window.prompt = vi.fn(() => 'Road Mix 2');
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValueOnce([playlist()]).mockResolvedValue([renamed]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([item()])),
        updatePlaylist: vi.fn().mockResolvedValue(renamed),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(await screen.findByRole('button', { name: '更多歌单操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名歌单' }));

    await waitFor(() =>
      expect(window.echo.library.updatePlaylist).toHaveBeenCalledWith({ playlistId: 'playlist-1', name: 'Road Mix 2' }),
    );
    expect(await screen.findByText('歌单已重命名')).toBeTruthy();
  });

  it('updates sort mode and exports the playlist from the menu', async () => {
    const sorted = playlist({ sortMode: 'titleAsc' });
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValueOnce([playlist()]).mockResolvedValue([sorted]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([item()])),
        updatePlaylist: vi.fn().mockResolvedValue(sorted),
        exportPlaylist: vi.fn().mockResolvedValue('D:\\Exports\\Road Mix.json'),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(await screen.findByRole('button', { name: '更多歌单操作' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '歌名 A-Z' }));
    await waitFor(() =>
      expect(window.echo.library.updatePlaylist).toHaveBeenCalledWith({ playlistId: 'playlist-1', sortMode: 'titleAsc' }),
    );
    expect(await screen.findByText('排序方式已更新')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '更多歌单操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }));

    await waitFor(() =>
      expect(window.echo.library.exportPlaylist).toHaveBeenCalledWith({ playlistId: 'playlist-1', format: 'json' }),
    );
    expect(await screen.findByText('歌单已导出：D:\\Exports\\Road Mix.json')).toBeTruthy();
  });

  it('shows streaming quality only for remote playlists and sends the selected quality to playback', async () => {
    const remoteTrackItem = item({
      mediaType: 'stream_track',
      mediaId: 'streaming:qqmusic:song-mid',
      sourceProvider: 'qqmusic',
      sourceItemId: 'song-mid',
      titleSnapshot: 'Remote Song',
      track: null,
    });
    const playMediaItem = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: 'streaming:qqmusic:song-mid',
      positionMs: 0,
      durationMs: 180000,
      filePath: null,
    });
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ sourceProvider: 'qqmusic', sourcePlaylistId: '123' })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([remoteTrackItem])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
        startPlaybackHistory: vi.fn().mockResolvedValue({ historyId: 'history-1' }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
        playMediaItem,
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    const qualityButton = await screen.findByRole('button', { name: 'Streaming quality' });
    expect(qualityButton.textContent).toContain('Lossless');

    fireEvent.click(await screen.findByRole('button', { name: 'Remote Song' }));
    await waitFor(() =>
      expect(playMediaItem).toHaveBeenCalledWith(expect.objectContaining({
        item: expect.objectContaining({
          mediaType: 'streaming',
          provider: 'qqmusic',
          providerTrackId: 'song-mid',
          quality: 'lossless',
        }),
      })),
    );

    fireEvent.click(qualityButton);
    fireEvent.click(screen.getByRole('option', { name: 'Standard' }));
    expect(qualityButton.textContent).toContain('Standard');
    expect(window.localStorage.getItem('echo-next.streaming.quality')).toBe('standard');
    fireEvent.click(screen.getByRole('button', { name: 'Remote Song' }));
    await waitFor(() =>
      expect(playMediaItem).toHaveBeenLastCalledWith(expect.objectContaining({
        item: expect.objectContaining({
          quality: 'standard',
        }),
      })),
    );
  });

  it('restores the remembered streaming quality for remote playlists', async () => {
    window.localStorage.setItem('echo-next.streaming.quality', 'high');
    const remoteTrackItem = item({
      mediaType: 'stream_track',
      mediaId: 'streaming:qqmusic:song-mid',
      sourceProvider: 'qqmusic',
      sourceItemId: 'song-mid',
      titleSnapshot: 'Remote Song',
      track: null,
    });
    const playMediaItem = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: 'streaming:qqmusic:song-mid',
      positionMs: 0,
      durationMs: 180000,
      filePath: null,
    });
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ sourceProvider: 'qqmusic', sourcePlaylistId: '123' })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([remoteTrackItem])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
        startPlaybackHistory: vi.fn().mockResolvedValue({ historyId: 'history-1' }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
        playMediaItem,
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    const qualityButton = await screen.findByRole('button', { name: 'Streaming quality' });
    expect(qualityButton.textContent).toContain('High');
    fireEvent.click(await screen.findByRole('button', { name: 'Remote Song' }));

    await waitFor(() =>
      expect(playMediaItem).toHaveBeenCalledWith(expect.objectContaining({
        item: expect.objectContaining({
          mediaType: 'streaming',
          provider: 'qqmusic',
          providerTrackId: 'song-mid',
          quality: 'high',
        }),
      })),
    );
  });

  it('sends selected quality when remote playlist items include cached track details', async () => {
    const remoteTrackItem = item({
      mediaType: 'stream_track',
      mediaId: 'streaming:netease:123',
      sourceProvider: 'netease',
      sourceItemId: '123',
      titleSnapshot: 'NetEase Song',
      track: track({
        id: 'streaming:netease:123',
        mediaType: 'streaming',
        path: 'streaming:netease:123',
        provider: 'netease',
        providerTrackId: '123',
        stableKey: 'streaming:netease:123',
        title: 'NetEase Song',
        codec: null,
        sampleRate: null,
        bitDepth: null,
        bitrate: null,
      }),
    });
    const playMediaItem = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: 'streaming:netease:123',
      positionMs: 0,
      durationMs: 180000,
      filePath: null,
    });
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ sourceProvider: 'netease', sourcePlaylistId: '163289102' })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([remoteTrackItem])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
        startPlaybackHistory: vi.fn().mockResolvedValue({ historyId: 'history-1' }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
        playMediaItem,
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(await screen.findByRole('button', { name: 'NetEase Song' }));
    await waitFor(() =>
      expect(playMediaItem).toHaveBeenCalledWith(expect.objectContaining({
        item: expect.objectContaining({
          mediaType: 'streaming',
          provider: 'netease',
          providerTrackId: '123',
          quality: 'lossless',
        }),
      })),
    );
  });

  it('queues the remaining remote playlist tracks after playing one item', async () => {
    const firstItem = item({
      id: 'item-1',
      mediaType: 'stream_track',
      mediaId: 'streaming:netease:track-1',
      sourceProvider: 'netease',
      sourceItemId: 'track-1',
      titleSnapshot: 'Song One',
      track: null,
    });
    const secondItem = item({
      id: 'item-2',
      mediaType: 'stream_track',
      mediaId: 'streaming:netease:track-2',
      sourceProvider: 'netease',
      sourceItemId: 'track-2',
      titleSnapshot: 'Song Two',
      track: null,
    });
    const thirdItem = item({
      id: 'item-3',
      mediaType: 'stream_track',
      mediaId: 'streaming:netease:track-3',
      sourceProvider: 'netease',
      sourceItemId: 'track-3',
      titleSnapshot: 'Song Three',
      track: null,
    });
    const playMediaItem = vi.fn().mockImplementation((request: { item: { trackId: string } }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.item.trackId,
        positionMs: 0,
        durationMs: 180000,
        filePath: null,
      }),
    );
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ sourceProvider: 'netease', sourcePlaylistId: '163289102', itemCount: 3 })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([firstItem, secondItem, thirdItem])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
        startPlaybackHistory: vi.fn().mockResolvedValue({ historyId: 'history-1' }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
        playMediaItem,
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueProbe />
        <PlaylistsPage />
      </PlaybackQueueProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Song Two' }));

    await waitFor(() => expect(playMediaItem).toHaveBeenCalledWith(expect.objectContaining({
      item: expect.objectContaining({ trackId: 'streaming:netease:track-2' }),
    })));
    await waitFor(() => expect(screen.getByLabelText('queue-track-ids').textContent).toBe('streaming:netease:track-2,streaming:netease:track-3'));
  });

  it('hides streaming quality for local playlists', async () => {
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist()]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([item()])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    await screen.findByRole('button', { name: 'Song One' });
    expect(screen.queryByRole('button', { name: 'Streaming quality' })).toBeNull();
  });

  it('starts playlist playback from the primary action and lets the user exit it', async () => {
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
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist()]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([item()])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
        playLocalFile,
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(await screen.findByRole('button', { name: '播放歌单' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-1' })));
    expect(await screen.findByText('正在按歌单顺序播放：Road Mix')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: '退出歌单播放' }));

    expect(await screen.findByText('已退出歌单播放，恢复原队列')).toBeTruthy();
  });

  it('saves manual order changes for local playlists after dragging rows', async () => {
    const firstItem = item();
    const secondItem = item({
      id: 'item-2',
      mediaId: 'track-2',
      titleSnapshot: 'Song Two',
      position: 1,
      track: track({ id: 'track-2', title: 'Song Two' }),
    });
    const movePlaylistItem = vi.fn().mockResolvedValue(undefined);
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ itemCount: 2 })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([firstItem, secondItem])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
        movePlaylistItem,
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    const firstRow = await screen.findByTestId('playlist-track-row-item-1');
    const secondRow = await screen.findByTestId('playlist-track-row-item-2');
    expect(firstRow).toHaveProperty('draggable', true);

    const dataTransfer = dragDataTransfer();
    fireEvent.dragStart(firstRow, { dataTransfer });
    fireEvent.dragOver(secondRow, { dataTransfer });
    fireEvent.drop(secondRow, { dataTransfer });

    await waitFor(() => expect(movePlaylistItem).toHaveBeenCalledWith('playlist-1', 'item-1', 1));
    expect(await screen.findByText('歌单顺序已保存')).toBeTruthy();
  });

  it('remembers sidebar playlist order after dragging playlists', async () => {
    const firstPlaylist = playlist({ id: 'playlist-1', name: 'Road Mix', itemCount: 1 });
    const secondPlaylist = playlist({ id: 'playlist-2', name: 'Night Mix', itemCount: 2 });
    const thirdPlaylist = playlist({ id: 'playlist-3', name: 'Morning Mix', itemCount: 3 });
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([firstPlaylist, secondPlaylist, thirdPlaylist]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([item()])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    const firstRender = renderPlaylistsPage();
    await screen.findAllByText('Road Mix');
    const sidebar = document.querySelector('.playlist-sidebar') as HTMLElement;
    const getPlaylistNames = (): string[] =>
      Array.from(sidebar.querySelectorAll('.playlist-list-item strong span')).map((element) => element.textContent ?? '');
    const getPlaylistButton = (name: string): HTMLElement =>
      Array.from(sidebar.querySelectorAll('.playlist-list-item')).find((element) => element.querySelector('strong span')?.textContent === name) as HTMLElement;

    await waitFor(() => expect(getPlaylistNames()).toEqual(['Road Mix', 'Night Mix', 'Morning Mix']));

    const dataTransfer = dragDataTransfer();
    fireEvent.dragStart(getPlaylistButton('Road Mix'), { dataTransfer });
    fireEvent.dragOver(getPlaylistButton('Night Mix'), { dataTransfer });
    fireEvent.drop(getPlaylistButton('Night Mix'), { dataTransfer });

    await waitFor(() => expect(getPlaylistNames()).toEqual(['Night Mix', 'Road Mix', 'Morning Mix']));
    expect(window.localStorage.getItem('echo-next.playlist-list-order.v1')).toContain('playlist-2');

    firstRender.unmount();
    renderPlaylistsPage();
    await screen.findAllByText('Road Mix');
    const restoredSidebar = document.querySelector('.playlist-sidebar') as HTMLElement;
    await waitFor(() =>
      expect(Array.from(restoredSidebar.querySelectorAll('.playlist-list-item strong span')).map((element) => element.textContent ?? '')).toEqual([
        'Night Mix',
        'Road Mix',
        'Morning Mix',
      ]),
    );
  });

  it('remembers streaming favorite sidebar order after dragging favorite lists', async () => {
    const favorites = streamingFavoritesSnapshot({
      providers: {
        bilibili: [streamingFavoriteTrack({ provider: 'bilibili', providerTrackId: 'bv-1', stableKey: 'streaming:bilibili:bv-1' })],
        youtube: [],
        soundcloud: [],
      },
      collections: [
        {
          id: 'streaming-favorites:youtube:PL123',
          provider: 'youtube',
          providerPlaylistId: 'PL123',
          name: 'YouTube Picks',
          sourceName: 'YouTube Picks',
          tracks: [streamingFavoriteTrack()],
          createdAt: '2026-05-29T00:00:00.000Z',
          updatedAt: '2026-05-29T00:00:00.000Z',
        },
      ],
    });
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ itemCount: 0 })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
      streaming: {
        getFavorites: vi.fn().mockResolvedValue(favorites),
      },
    } as unknown as Window['echo'];

    const firstRender = renderPlaylistsPage();
    fireEvent.click((await screen.findAllByRole('tab'))[1]);

    await screen.findByText('Bilibili');
    const sidebar = document.querySelector('.playlist-sidebar') as HTMLElement;
    const getFavoriteNames = (): string[] =>
      Array.from(sidebar.querySelectorAll('.playlist-list--favorites .playlist-list-item strong span')).map((element) => element.textContent ?? '');
    const getFavoriteButton = (name: string): HTMLElement =>
      Array.from(sidebar.querySelectorAll('.playlist-list--favorites .playlist-list-item')).find((element) => element.querySelector('strong span')?.textContent === name) as HTMLElement;

    await waitFor(() => expect(getFavoriteNames()).toEqual(['Bilibili', 'YouTube', 'SoundCloud', 'YouTube Picks']));

    const dataTransfer = dragDataTransfer();
    fireEvent.dragStart(getFavoriteButton('Bilibili'), { dataTransfer });
    fireEvent.dragOver(getFavoriteButton('YouTube'), { dataTransfer });
    fireEvent.drop(getFavoriteButton('YouTube'), { dataTransfer });

    await waitFor(() => expect(getFavoriteNames()).toEqual(['YouTube', 'Bilibili', 'SoundCloud', 'YouTube Picks']));
    expect(window.localStorage.getItem('echo-next.streaming-favorite-list-order.v1')).toContain('provider:youtube');

    firstRender.unmount();
    renderPlaylistsPage();
    fireEvent.click((await screen.findAllByRole('tab'))[1]);

    await screen.findByText('Bilibili');
    const restoredSidebar = document.querySelector('.playlist-sidebar') as HTMLElement;
    await waitFor(() =>
      expect(Array.from(restoredSidebar.querySelectorAll('.playlist-list--favorites .playlist-list-item strong span')).map((element) => element.textContent ?? '')).toEqual([
        'YouTube',
        'Bilibili',
        'SoundCloud',
        'YouTube Picks',
      ]),
    );
  });

  it('keeps remote playlists out of manual drag sorting', async () => {
    const remoteTrackItem = item({
      mediaType: 'stream_track',
      mediaId: 'streaming:netease:123',
      sourceProvider: 'netease',
      sourceItemId: '123',
      titleSnapshot: 'NetEase Song',
      track: null,
    });
    const movePlaylistItem = vi.fn().mockResolvedValue(undefined);
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ sourceProvider: 'netease', sourcePlaylistId: '123' })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([remoteTrackItem])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
        movePlaylistItem,
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    const remoteRow = await screen.findByTestId('playlist-track-row-item-1');
    expect(remoteRow).toHaveProperty('draggable', false);

    const dataTransfer = dragDataTransfer();
    fireEvent.dragStart(remoteRow, { dataTransfer });
    fireEvent.drop(remoteRow, { dataTransfer });

    expect(movePlaylistItem).not.toHaveBeenCalled();
  });

  it('adds selected local audio files to the current local playlist', async () => {
    const emptyPage = page([]);
    const addedItem = item({ id: 'item-added', mediaId: 'track-added', track: track({ id: 'track-added', title: 'Added Song' }) });
    const chooseImportFiles = vi.fn().mockResolvedValue(['D:\\Music\\Added Song.flac', 'D:\\Maps\\Beatmap.osz']);
    const addLocalAudioFilesToPlaylist = vi.fn().mockResolvedValue({
      importedCount: 2,
      addedCount: 2,
      skippedCount: 0,
      failedCount: 0,
      trackIds: ['track-added', 'track-osu'],
      items: [addedItem],
    });
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ itemCount: 0 })]),
        getPlaylistItems: vi.fn().mockResolvedValueOnce(emptyPage).mockResolvedValue(page([addedItem])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
        chooseImportFiles,
        addLocalAudioFilesToPlaylist,
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(await screen.findByRole('button', { name: '添加本地歌曲' }));

    await waitFor(() => expect(chooseImportFiles).toHaveBeenCalled());
    await waitFor(() =>
      expect(addLocalAudioFilesToPlaylist).toHaveBeenCalledWith('playlist-1', ['D:\\Music\\Added Song.flac', 'D:\\Maps\\Beatmap.osz']),
    );
    expect(await screen.findByText('已添加 2 首本地歌曲')).toBeTruthy();
  });

  it('likes NetEase and QQ streaming playlist tracks through the provider bridge', async () => {
    const remoteTrackItem = item({
      mediaType: 'stream_track',
      mediaId: 'streaming:netease:1983779468',
      sourceProvider: 'netease',
      sourceItemId: '1983779468',
      titleSnapshot: 'Remote Like Song',
      track: null,
    });
    const toggleTrackLiked = vi.fn();
    const setTrackLiked = vi.fn().mockResolvedValue({ liked: true });
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ sourceProvider: 'netease', sourcePlaylistId: 'daily-recommend' })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([remoteTrackItem])),
        getLikedTrackIds: vi.fn().mockResolvedValue({ 'streaming:netease:1983779468': false }),
        toggleTrackLiked,
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
      streaming: {
        setTrackLiked,
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Like Remote Like Song' }));

    await waitFor(() =>
      expect(setTrackLiked).toHaveBeenCalledWith({
        provider: 'netease',
        providerTrackId: '1983779468',
        liked: true,
      }),
    );
    expect(toggleTrackLiked).not.toHaveBeenCalled();
  });

  it('runs local file actions from the track context menu', async () => {
    const openTrackInFolder = vi.fn().mockResolvedValue(undefined);
    const copyTrackPath = vi.fn().mockResolvedValue(undefined);
    const openTrackWithSystem = vi.fn().mockResolvedValue(undefined);
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist()]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([item()])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
        openTrackInFolder,
        copyTrackPath,
        openTrackWithSystem,
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Open menu for Song One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));
    await waitFor(() => expect(openTrackInFolder).toHaveBeenCalledWith('track-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Open menu for Song One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
    await waitFor(() => expect(copyTrackPath).toHaveBeenCalledWith('track-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Open menu for Song One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open with system' }));
    await waitFor(() => expect(openTrackWithSystem).toHaveBeenCalledWith('track-1'));
  });

  it('removes a song from the selected playlist from the track context menu', async () => {
    const removePlaylistItem = vi.fn().mockResolvedValue(undefined);
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist()]),
        getPlaylistItems: vi.fn().mockResolvedValueOnce(page([item()])).mockResolvedValue(page([])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
        removePlaylistItem,
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Open menu for Song One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from playlist' }));

    await waitFor(() => expect(removePlaylistItem).toHaveBeenCalledWith('item-1'));
    expect(await screen.findByText('已从歌单移除：Song One')).toBeTruthy();
  });

  it('refreshes a remote playlist by re-importing its source playlist', async () => {
    const remotePlaylist = playlist({
      sourceProvider: 'qqmusic',
      sourcePlaylistId: '778899',
      name: 'QQ Mix',
    });
    const importPlaylistFromUrl = vi.fn().mockResolvedValue({
      playlistId: 'playlist-1',
      playlistName: 'QQ Mix',
      importedCount: 2,
      provider: 'qqmusic',
      providerPlaylistId: '778899',
    });
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([remotePlaylist]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([
          item({
            mediaType: 'stream_track',
            mediaId: 'streaming:qqmusic:song-mid',
            sourceProvider: 'qqmusic',
            sourceItemId: 'song-mid',
            titleSnapshot: 'Untitled',
            track: null,
          }),
        ])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
      streaming: {
        importPlaylistFromUrl,
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(await screen.findByRole('button', { name: '刷新歌单' }));

    await waitFor(() =>
      expect(importPlaylistFromUrl).toHaveBeenCalledWith('https://y.qq.com/n/ryqq/playlist/778899'),
    );
    expect(await screen.findByText('已刷新歌单：QQ Mix，共 2 首')).toBeTruthy();
  });

  it('imports Spotify playlist links from the sidebar form', async () => {
    const spotifyUrl = 'https://open.spotify.com/playlist/5MFN2Ep3ZU2FIQWIXNSLrT?si=866d26088e4a4a47';
    const importedPlaylist = playlist({
      id: 'spotify-playlist',
      sourceProvider: 'spotify',
      sourcePlaylistId: '5MFN2Ep3ZU2FIQWIXNSLrT',
      name: 'Spotify Mix',
      itemCount: 1,
    });
    const importedItem = item({
      id: 'spotify-item-1',
      playlistId: 'spotify-playlist',
      mediaType: 'stream_track',
      mediaId: 'streaming:spotify:track-1',
      sourceProvider: 'spotify',
      sourceItemId: 'track-1',
      titleSnapshot: 'Spotify Song',
      artistSnapshot: 'Spotify Artist',
      track: null,
    });
    const importPlaylistFromUrl = vi.fn().mockResolvedValue({
      playlistId: 'spotify-playlist',
      playlistName: 'Spotify Mix',
      importedCount: 1,
      provider: 'spotify',
      providerPlaylistId: '5MFN2Ep3ZU2FIQWIXNSLrT',
    });
    const getPlaylistItems = vi.fn(async (playlistId: string) =>
      page(playlistId === 'spotify-playlist' ? [importedItem] : []),
    );
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValueOnce([playlist({ itemCount: 0 })]).mockResolvedValue([importedPlaylist]),
        getPlaylistItems,
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
      streaming: {
        importPlaylistFromUrl,
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    const input = await screen.findByPlaceholderText('粘贴网易云 / QQ 音乐 / 酷狗 / Spotify 歌单链接');
    fireEvent.change(input, { target: { value: spotifyUrl } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    await waitFor(() => expect(importPlaylistFromUrl).toHaveBeenCalledWith(spotifyUrl));
    expect(await screen.findByText('已添加歌单：Spotify Mix，共 1 首')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Spotify Song' })).toBeTruthy();
  });

  it('imports streaming favorite links as a named collection and renames it', async () => {
    const importedTrack = streamingFavoriteTrack();
    const importedSnapshot = streamingFavoritesSnapshot({
      collections: [
        {
          id: 'streaming-favorites:youtube:PL123',
          provider: 'youtube',
          providerPlaylistId: 'PL123',
          name: 'YouTube Favorites',
          sourceName: 'YouTube Favorites',
          tracks: [importedTrack],
          createdAt: '2026-05-29T00:00:00.000Z',
          updatedAt: '2026-05-29T00:00:00.000Z',
        },
      ],
    });
    const renamedSnapshot = streamingFavoritesSnapshot({
      collections: [
        {
          ...importedSnapshot.collections[0],
          name: 'Night Picks',
        },
      ],
    });
    const syncedTrack = streamingFavoriteTrack({ providerTrackId: 'video-2', stableKey: 'streaming:youtube:video-2', title: 'Video Two' });
    const syncedSnapshot = streamingFavoritesSnapshot({
      collections: [
        {
          ...renamedSnapshot.collections[0],
          tracks: [importedTrack, syncedTrack],
        },
      ],
    });
    const deletedSnapshot = streamingFavoritesSnapshot();
    const importFavoritesFromUrl = vi.fn().mockResolvedValue({
      provider: 'youtube',
      providerPlaylistId: 'PL123',
      collectionId: 'streaming-favorites:youtube:PL123',
      playlistName: 'YouTube Favorites',
      importedCount: 1,
      addedCount: 1,
      snapshot: importedSnapshot,
    });
    const renameFavoriteCollection = vi.fn().mockResolvedValue({
      collection: renamedSnapshot.collections[0],
      snapshot: renamedSnapshot,
    });
    const syncFavoriteCollection = vi.fn().mockResolvedValue({
      provider: 'youtube',
      providerPlaylistId: 'PL123',
      collectionId: 'streaming-favorites:youtube:PL123',
      playlistName: 'Night Picks',
      importedCount: 2,
      addedCount: 1,
      snapshot: syncedSnapshot,
    });
    const deleteFavoriteCollection = vi.fn().mockResolvedValue({
      collectionId: 'streaming-favorites:youtube:PL123',
      snapshot: deletedSnapshot,
    });
    window.prompt = vi.fn(() => 'Night Picks');
    window.confirm = vi.fn(() => true);
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ itemCount: 0 })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
      streaming: {
        getFavorites: vi.fn().mockResolvedValue(streamingFavoritesSnapshot()),
        importFavoritesFromUrl,
        renameFavoriteCollection,
        syncFavoriteCollection,
        deleteFavoriteCollection,
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    fireEvent.click(await screen.findByRole('tab', { name: '流媒体收藏' }));
    const input = await screen.findByPlaceholderText('粘贴 Bilibili 收藏 / YouTube 播放列表 / SoundCloud sets');
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/playlist?list=PL123' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    await waitFor(() => expect(importFavoritesFromUrl).toHaveBeenCalledWith('https://www.youtube.com/playlist?list=PL123'));
    expect(await screen.findByText('已导入收藏表：YouTube Favorites，新增 1 / 读取 1 首')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Video Song' })).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: '重命名' }));
    await waitFor(() =>
      expect(renameFavoriteCollection).toHaveBeenCalledWith({ collectionId: 'streaming-favorites:youtube:PL123', name: 'Night Picks' }),
    );
    expect(await screen.findByText('收藏表已重命名')).toBeTruthy();
    expect(await screen.findAllByText('Night Picks')).toHaveLength(2);

    fireEvent.click(await screen.findByRole('button', { name: '同步' }));
    await waitFor(() =>
      expect(syncFavoriteCollection).toHaveBeenCalledWith({ collectionId: 'streaming-favorites:youtube:PL123' }),
    );
    expect(await screen.findByRole('button', { name: 'Video Two' })).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    await waitFor(() =>
      expect(deleteFavoriteCollection).toHaveBeenCalledWith({ collectionId: 'streaming-favorites:youtube:PL123' }),
    );
    expect(screen.queryByRole('button', { name: 'Video Song' })).toBeNull();
  });

  it('guides Spotify owner-restricted playlist imports through the system browser', async () => {
    const spotifyUrl = 'https://open.spotify.com/playlist/5MFN2Ep3ZU2FIQWIXNSLrT?si=866d26088e4a4a47';
    const importPlaylistFromUrl = vi.fn().mockRejectedValue(
      new Error("Spotify only allows this playlist's owner or collaborators to read its track list through the Web API. (Forbidden)"),
    );
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    window.echo = {
      app: {
        openExternalUrl,
      },
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist({ itemCount: 0 })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
      streaming: {
        importPlaylistFromUrl,
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    const input = await screen.findByPlaceholderText('粘贴网易云 / QQ 音乐 / 酷狗 / Spotify 歌单链接');
    fireEvent.change(input, { target: { value: spotifyUrl } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(await screen.findByText(/Spotify 限制了非创建者\/协作者歌单的曲目读取/u)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '打开 Spotify 复制歌单' }));

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith(spotifyUrl));
  });

  it('queues a remote playlist download in playlist order and uses the playlist folder', async () => {
    const remotePlaylist = playlist({
      sourceProvider: 'netease',
      sourcePlaylistId: 'playlist-123',
      name: 'Daily Mix',
      itemCount: 2,
    });
    const firstItem = item({
      id: 'item-1',
      mediaType: 'stream_track',
      mediaId: 'streaming:netease:track-1',
      sourceProvider: 'netease',
      sourceItemId: 'track-1',
      titleSnapshot: 'First Remote',
      artistSnapshot: 'Artist A',
      track: null,
      position: 0,
    });
    const secondItem = item({
      id: 'item-2',
      mediaType: 'stream_track',
      mediaId: 'streaming:netease:track-2',
      sourceProvider: 'netease',
      sourceItemId: 'track-2',
      titleSnapshot: 'Second Remote',
      artistSnapshot: 'Artist B',
      track: track({ id: 'local-match-2', title: 'Second Remote', artist: 'Artist B', codec: 'FLAC' }),
      position: 1,
    });
    const resolvePlayback = vi.fn(async ({ providerTrackId }: { providerTrackId: string }) => ({
      url: `https://cdn.example/${providerTrackId}.mp3`,
      headers: { Referer: 'https://music.163.com/' },
      mimeType: 'audio/mpeg',
      codec: 'mp3',
      downloadAuthorizationToken: `download-token-${providerTrackId}`,
    }));
    const createUrlJob = vi.fn(async (url: string, options: Record<string, unknown>) =>
      downloadJob({
        id: `job-${String(options.streamingProviderTrackId)}`,
        sourceUrl: url,
        title: String(options.title),
      }),
    );
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([remotePlaylist]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([firstItem, secondItem])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ downloadsFeatureUnlocked: true }),
      },
      streaming: {
        resolvePlayback,
        getTrack: vi.fn(async ({ providerTrackId }: { providerTrackId: string }) => ({
          id: providerTrackId,
          provider: 'netease',
          providerTrackId,
          title: providerTrackId === 'track-1' ? 'First Remote' : 'Second Remote',
          artist: providerTrackId === 'track-1' ? 'Artist A' : 'Artist B',
          album: 'Daily Album',
          albumArtist: 'Daily Artists',
          duration: 180,
          coverUrl: null,
          coverThumb: null,
          liked: false,
        })),
      },
      downloads: {
        getSettings: vi.fn().mockResolvedValue({
          audioStrategy: 'best_available',
          importToLibrary: true,
          bindMvAfterImport: true,
          outputDirectory: 'D:\\Downloads',
        }),
        getJobs: vi.fn().mockResolvedValue([]),
        createUrlJob,
        onJobsUpdated: vi.fn(() => () => undefined),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    const downloadButton = await screen.findByRole('button', { name: '下载歌单' });
    await waitFor(() => expect(downloadButton).toHaveProperty('disabled', false));
    fireEvent.click(downloadButton);

    await waitFor(() => expect(createUrlJob).toHaveBeenCalledTimes(2));
    expect(createUrlJob.mock.calls.map((call) => call[0])).toEqual([
      'https://cdn.example/track-1.mp3',
      'https://cdn.example/track-2.mp3',
    ]);
    expect(createUrlJob.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        outputSubdirectory: 'Daily Mix',
        streamingProvider: 'netease',
        streamingProviderTrackId: 'track-1',
        downloadAuthorizationToken: 'download-token-track-1',
      }),
    );
    expect(createUrlJob.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        outputSubdirectory: 'Daily Mix',
        streamingProviderTrackId: 'track-2',
        downloadAuthorizationToken: 'download-token-track-2',
      }),
    );
    expect(await screen.findByText('已按歌单顺序加入下载队列：2 首')).toBeTruthy();

    cleanup();
    renderPlaylistsPage();

    await waitFor(() => expect(screen.queryByText('下载歌单：Daily Mix')).toBeNull());
  });
});
