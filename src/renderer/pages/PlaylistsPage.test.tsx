// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DragEvent } from 'react';
import type { LibraryPage, LibraryPlaylist, LibraryPlaylistItem, LibraryTrack } from '../../shared/types/library';
import { translations, isLocale, localeOptions } from '../i18n/locales.testing';
import { PlaybackQueueProvider } from '../stores/PlaybackQueueProvider';
import { consumePendingStreamingDetailNavigation } from '../utils/streamingDetailNavigation';
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
    onOpenArtist,
    onOpenAlbum,
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
    onOpenArtist?: (track: LibraryTrack) => void;
    onOpenAlbum?: (track: LibraryTrack) => void;
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
          <button type="button" onClick={() => onOpenArtist?.(track)}>
            Open artist for {track.title}
          </button>
          <button type="button" onClick={() => onOpenAlbum?.(track)}>
            Open album for {track.title}
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

const originalClipboard = window.navigator.clipboard;

afterEach(() => {
  consumePendingStreamingDetailNavigation();
  cleanup();
  window.localStorage.clear();
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: originalClipboard,
  });
  vi.restoreAllMocks();
});

describe('PlaylistsPage detail links', () => {
  it('searches the cover wall without reordering or changing the open playlist', async () => {
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([playlist(), playlist({ id: 'night', name: 'Night Mix' })]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: { getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }) },
    } as unknown as Window['echo'];
    renderPlaylistsPage();
    const wall = document.querySelector('.playlist-list') as HTMLElement;
    await within(wall).findByRole('button', { name: /Road Mix/ });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索歌单' }), { target: { value: 'NIGHT' } });
    expect(within(wall).queryByRole('button', { name: /Road Mix/ })).toBeNull();
    const night = within(wall).getByRole('button', { name: /Night Mix/ });
    expect(night.draggable).toBe(false);
    expect(window.echo.library.getPlaylistItems).not.toHaveBeenCalledWith('night', expect.anything());
    fireEvent.click(night);
    expect(await screen.findByRole('heading', { name: 'Night Mix' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回歌单墙' }));
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(within(wall).getByRole('button', { name: /Road Mix/ }).draggable).toBe(true);
  });

  it('opens a playlist from the cover wall and returns to the wall', async () => {
    window.echo = {
      library: { getPlaylists: vi.fn().mockResolvedValue([playlist()]), getPlaylistItems: vi.fn().mockResolvedValue(page([item()])), getLikedTrackIds: vi.fn().mockResolvedValue({}) },
      playback: { getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }) },
    } as unknown as Window['echo'];
    renderPlaylistsPage();
    const card = await screen.findByRole('button', { name: /Road Mix/ });
    expect(document.querySelector('.playlists-page')?.getAttribute('data-view')).toBe('wall');
    expect(card.querySelector('.playlist-wall-cover')).toBeTruthy();
    fireEvent.click(card);
    expect(document.querySelector('.playlists-page')?.getAttribute('data-view')).toBe('detail');
    fireEvent.click(screen.getByRole('button', { name: '返回歌单墙' }));
    expect(document.querySelector('.playlists-page')?.getAttribute('data-view')).toBe('wall');
  });

  it('hides removed streaming entry points and historical provider playlists when the bridge is absent', async () => {
    const localPlaylist = playlist();
    const remotePlaylist = playlist({ id: 'remote-files', name: 'Remote files', sourceProvider: 'remote' });
    const oldImports = (['netease', 'qqmusic', 'kugou', 'spotify'] as const).map((sourceProvider) =>
      playlist({ id: sourceProvider, name: `Old ${sourceProvider} import`, sourceProvider }),
    );
    const getPlaylistItems = vi.fn().mockResolvedValue(page([item()]));
    window.localStorage.setItem('echo-next.playlist-list-order.v1', JSON.stringify({ orderedIds: ['netease'] }));
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([...oldImports, localPlaylist, remotePlaylist]),
        getPlaylistItems,
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    renderPlaylistsPage();

    await screen.findByRole('button', { name: 'Song One' });
    expect(screen.queryByRole('tab', { name: '流媒体收藏' })).toBeNull();
    expect(screen.queryByText('每日推荐')).toBeNull();
    expect(screen.queryByText('添加流媒体歌单')).toBeNull();
    expect(screen.queryByText('流媒体歌单')).toBeNull();
    expect(screen.queryByRole('button', { name: '同步' })).toBeNull();
    expect(screen.queryByPlaceholderText(/粘贴网易云/)).toBeNull();
    for (const oldImport of oldImports) {
      expect(screen.queryByText(oldImport.name)).toBeNull();
    }
    expect(screen.getByText('Remote files')).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建本地歌单' })).toBeTruthy();
    expect(screen.getByText('智能生成')).toBeTruthy();
    expect(getPlaylistItems.mock.calls.every(([id]) => id === localPlaylist.id)).toBe(true);
  });
});


describe('PlaylistsPage actions menu', () => {
  it('renames the selected playlist from the menu', async () => {
    const renamed = playlist({ name: 'Road Mix 2' });
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
    fireEvent.change(screen.getByLabelText('歌单名称'), { target: { value: 'Road Mix 2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

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
      Array.from(sidebar.querySelectorAll('.playlist-wall-card strong span')).map((element) => element.textContent ?? '');
    const getPlaylistButton = (name: string): HTMLElement =>
      Array.from(sidebar.querySelectorAll('.playlist-wall-card')).find((element) => element.querySelector('strong span')?.textContent === name) as HTMLElement;

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
      expect(Array.from(restoredSidebar.querySelectorAll('.playlist-wall-card strong span')).map((element) => element.textContent ?? '')).toEqual([
        'Night Mix',
        'Road Mix',
        'Morning Mix',
      ]),
    );
  });

  it('portals the playlist sidebar context menu to the document body for viewport positioning', async () => {
    const localPlaylist = playlist({ id: 'playlist-local', name: 'Road Mix', sourceProvider: 'local', itemCount: 1 });
    window.echo = {
      library: {
        getPlaylists: vi.fn().mockResolvedValue([localPlaylist]),
        getPlaylistItems: vi.fn().mockResolvedValue(page([])),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      },
    } as unknown as Window['echo'];

    const { container } = renderPlaylistsPage();

    await screen.findAllByText('Road Mix');
    const playlistButton = container.querySelector('.playlist-wall-card') as HTMLElement;
    fireEvent.contextMenu(playlistButton, { clientX: 32, clientY: 48 });

    const layer = document.querySelector('.playlist-context-menu-layer') as HTMLElement;
    const menu = document.querySelector('.playlist-context-menu') as HTMLElement;
    expect(layer.parentElement).toBe(document.body);
    expect(container.contains(layer)).toBe(false);
    expect(menu.style.left).toBe('32px');
    expect(menu.style.top).toBe('48px');
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
});
