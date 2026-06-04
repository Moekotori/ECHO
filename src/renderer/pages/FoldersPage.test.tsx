// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryFolderNode, LibraryFolderOverview, LibraryPage, LibraryScanStatus, LibraryTrack } from '../../shared/types/library';
import { I18nProvider } from '../i18n/I18nProvider';
import { PlaybackQueueProvider } from '../stores/PlaybackQueueProvider';
import { rememberLibraryScanStatus, resetLibraryScanSessionForTests } from '../stores/libraryScanSession';
import { __resetFoldersPageSessionForTests, FoldersPage } from './FoldersPage';
import type { RemoteDirectoryItem, RemoteSource } from '../../shared/types/remoteSources';

vi.mock('../components/library/TrackList', () => ({
  TrackList: ({
    tracks,
    currentTrackId,
    selectedTrackIds = {},
    onToggleSelected,
    onOpenTrackMenu,
  }: {
    tracks: LibraryTrack[];
    currentTrackId: string | null;
    selectedTrackIds?: Record<string, boolean>;
    onToggleSelected?: (track: LibraryTrack) => void;
    onOpenTrackMenu?: (track: LibraryTrack, position: { x: number; y: number }) => void;
  }) => (
    <div data-testid="folder-track-list">
      <span data-testid="current-track-id">{currentTrackId ?? 'none'}</span>
      {tracks.map((item) => (
        <button
          key={item.id}
          type="button"
          className="track-row"
          data-selected={selectedTrackIds[item.id] ? 'true' : undefined}
          onClick={(event) => {
            if (event.ctrlKey || event.metaKey) {
              onToggleSelected?.(item);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            onOpenTrackMenu?.(item, { x: event.clientX, y: event.clientY });
          }}
        >
          {item.title}
          <span>{item.artist}</span>
          <span>{item.duration}</span>
          {item.coverThumb ? <img alt={`${item.title} cover`} src={item.coverThumb} /> : null}
        </button>
      ))}
    </div>
  ),
}));

const track = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\Root.flac',
  title: 'Root Song',
  artist: 'Root Artist',
  album: 'Root Album',
  albumArtist: 'Root Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 60,
  codec: 'FLAC',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
  ...overrides,
});

const overview = (overrides: Partial<LibraryFolderOverview> = {}): LibraryFolderOverview => ({
  id: 'folder-1',
  path: 'D:\\Music',
  name: 'Music',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastScanAt: null,
  recentScan: null,
  trackCount: 2,
  albumCount: 1,
  artistCount: 1,
  totalDuration: 180,
  totalSizeBytes: 1024,
  missingTrackCount: 0,
  losslessTrackCount: 2,
  hiResTrackCount: 0,
  childFolderCount: 1,
  coverThumbs: [],
  ...overrides,
});

const childNode = (overrides: Partial<LibraryFolderNode> = {}): LibraryFolderNode => ({
  folderId: 'folder-1',
  path: 'D:\\Music\\Rock',
  parentPath: 'D:\\Music',
  name: 'Rock',
  depth: 1,
  trackCount: 1,
  directTrackCount: 1,
  childFolderCount: 0,
  totalDuration: 120,
  totalSizeBytes: 512,
  coverThumbs: [],
  ...overrides,
});

const page = (items: LibraryTrack[], total = items.length): LibraryPage<LibraryTrack> => ({
  items,
  page: 1,
  pageSize: 100,
  total,
  hasMore: false,
});

const scanStatus = (overrides: Partial<LibraryScanStatus> = {}): LibraryScanStatus => ({
  id: 'scan-1',
  folderId: 'folder-1',
  status: 'running',
  phase: 'reading_metadata',
  totalFiles: 2,
  processedFiles: 1,
  skippedFiles: 0,
  addedTracks: 0,
  updatedTracks: 0,
  removedTracks: 0,
  coverCount: 0,
  errorCount: 0,
  errors: [],
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
  ...overrides,
});

const remoteSource = (overrides: Partial<RemoteSource> = {}): RemoteSource => ({
  id: 'remote-1',
  provider: 'baidu',
  displayName: 'Baidu Music',
  status: 'enabled',
  baseUrl: null,
  username: null,
  authType: 'token',
  config: { rootPath: '/Music', credentialMode: 'oauth-refresh' },
  syncMode: 'index',
  lastTestAt: null,
  lastSyncAt: null,
  lastError: null,
  indexedTrackCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const remoteItem = (overrides: Partial<RemoteDirectoryItem> = {}): RemoteDirectoryItem => ({
  sourceId: 'remote-1',
  provider: 'baidu',
  path: '/Music/song.flac',
  name: 'song.flac',
  kind: 'file',
  sizeBytes: 2048,
  modifiedAt: '2026-01-01T00:00:00.000Z',
  etag: 'fsid:1',
  contentType: 'audio/flac',
  audio: true,
  ...overrides,
});

const renderFoldersPage = () =>
  render(
    <I18nProvider>
      <PlaybackQueueProvider>
        <FoldersPage />
      </PlaybackQueueProvider>
    </I18nProvider>,
  );

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

let libraryMock: {
  getFolderOverviews: ReturnType<typeof vi.fn>;
  getFolderChildren: ReturnType<typeof vi.fn>;
  getFolderTracks: ReturnType<typeof vi.fn>;
  openLibraryFolderPath: ReturnType<typeof vi.fn>;
  chooseFolder: ReturnType<typeof vi.fn>;
  addFolder: ReturnType<typeof vi.fn>;
  scanFolder: ReturnType<typeof vi.fn>;
  removeFolder: ReturnType<typeof vi.fn>;
  getScanStatus: ReturnType<typeof vi.fn>;
};
let remoteSourcesMock: {
  list: ReturnType<typeof vi.fn>;
  browse: ReturnType<typeof vi.fn>;
  lookupTracks: ReturnType<typeof vi.fn>;
  listIndexedTracks: ReturnType<typeof vi.fn>;
  listIndexedTracksPage: ReturnType<typeof vi.fn>;
  getIndexedFolderStats: ReturnType<typeof vi.fn>;
  previewDirectoryItems: ReturnType<typeof vi.fn>;
  sync: ReturnType<typeof vi.fn>;
  getSyncStatus: ReturnType<typeof vi.fn>;
  getJobStatus: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  resetLibraryScanSessionForTests();
  __resetFoldersPageSessionForTests();

  libraryMock = {
    getFolderOverviews: vi.fn().mockResolvedValue([overview()]),
    getFolderChildren: vi.fn().mockResolvedValue([childNode()]),
    getFolderTracks: vi.fn().mockResolvedValue(page([track()])),
    openLibraryFolderPath: vi.fn().mockResolvedValue(undefined),
    chooseFolder: vi.fn().mockResolvedValue(null),
    addFolder: vi.fn(),
    scanFolder: vi.fn(),
    removeFolder: vi.fn(),
    getScanStatus: vi.fn().mockResolvedValue(scanStatus()),
  };
  remoteSourcesMock = {
    list: vi.fn().mockResolvedValue([remoteSource()]),
    browse: vi.fn().mockResolvedValue([
      remoteItem({ path: '/Music/Album', name: 'Album', kind: 'directory', audio: false, sizeBytes: null }),
      remoteItem(),
    ]),
    lookupTracks: vi.fn().mockResolvedValue([]),
    listIndexedTracks: vi.fn().mockResolvedValue([]),
    listIndexedTracksPage: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0, hasMore: false }),
    getIndexedFolderStats: vi.fn().mockResolvedValue({
      sourceId: 'remote-1',
      rootPath: '/Music',
      trackCount: 0,
      totalSizeBytes: 0,
      albumCount: 0,
      artistCount: 0,
    }),
    previewDirectoryItems: vi.fn().mockResolvedValue([]),
    sync: vi.fn().mockResolvedValue({
      sourceId: 'remote-1',
      status: 'running',
      phase: 'scanning',
      discoveredCount: 0,
      parsedCount: 0,
      writtenCount: 0,
      skippedCount: 0,
      missingCount: 0,
      failedCount: 0,
      currentPath: null,
      errors: [],
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
    }),
    getSyncStatus: vi.fn().mockResolvedValue({
      sourceId: 'remote-1',
      status: 'idle',
      phase: 'idle',
      discoveredCount: 0,
      parsedCount: 0,
      writtenCount: 0,
      skippedCount: 0,
      missingCount: 0,
      failedCount: 0,
      currentPath: null,
      errors: [],
      startedAt: null,
      finishedAt: null,
    }),
    getJobStatus: vi.fn().mockResolvedValue({
      sourceId: 'remote-1',
      pending: { metadata: 0, cover: 0, lyrics: 0, mv: 0, 'duration-backfill': 0 },
      running: { metadata: 0, cover: 0, lyrics: 0, mv: 0, 'duration-backfill': 0 },
      completed: { metadata: 0, cover: 0, lyrics: 0, mv: 0, 'duration-backfill': 0 },
      failed: { metadata: 0, cover: 0, lyrics: 0, mv: 0, 'duration-backfill': 0 },
      skipped: { metadata: 0, cover: 0, lyrics: 0, mv: 0, 'duration-backfill': 0 },
      concurrency: { metadata: 0, cover: 0, lyrics: 0, mv: 0, 'duration-backfill': 0 },
      current: [],
      paused: false,
      lastError: null,
      updatedAt: null,
    }),
  };

  Object.defineProperty(window, 'echo', {
    configurable: true,
    value: {
      library: libraryMock,
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
      remoteSources: remoteSourcesMock,
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  resetLibraryScanSessionForTests();
  __resetFoldersPageSessionForTests();
});

describe('FoldersPage', () => {
  it('loads root overviews first and fetches child nodes lazily', async () => {
    renderFoldersPage();

    expect(await screen.findByRole('heading', { name: 'Folders' })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Music').length).toBeGreaterThan(0));
    expect(libraryMock.getFolderOverviews).toHaveBeenCalledTimes(1);
    expect(libraryMock.getFolderChildren).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Music/i }).querySelector('.folder-expand-hit')!);

    await waitFor(() => expect(libraryMock.getFolderChildren).toHaveBeenCalledWith({ folderId: 'folder-1', parentPath: 'D:\\Music' }));
    expect(await screen.findByText('Rock')).toBeTruthy();
  });

  it('keeps expanded local subfolders when the folders page remounts', async () => {
    const firstRender = renderFoldersPage();

    await screen.findByRole('heading', { name: 'Folders' });
    fireEvent.click(screen.getByRole('button', { name: /Music/i }).querySelector('.folder-expand-hit')!);

    await screen.findByText('Rock');
    await waitFor(() => expect(libraryMock.getFolderChildren).toHaveBeenCalledWith({ folderId: 'folder-1', parentPath: 'D:\\Music' }));

    firstRender.unmount();
    libraryMock.getFolderChildren.mockClear();

    renderFoldersPage();

    await screen.findByRole('heading', { name: 'Folders' });
    expect(await screen.findByText('Rock')).toBeTruthy();
    expect(libraryMock.getFolderChildren).not.toHaveBeenCalled();
  });

  it('restores the expanded local tree and selected folder after a cold restart', async () => {
    const firstRender = renderFoldersPage();

    await screen.findByRole('heading', { name: 'Folders' });
    fireEvent.click(screen.getByRole('button', { name: /Music/i }).querySelector('.folder-expand-hit')!);
    const rockButton = (await screen.findByText('Rock')).closest('button');
    expect(rockButton).toBeTruthy();
    fireEvent.click(rockButton!);

    await waitFor(() =>
      expect(libraryMock.getFolderTracks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          folderId: 'folder-1',
          path: 'D:\\Music\\Rock',
        }),
      ),
    );
    expect(window.localStorage.getItem('echo-next.local-folder-tree-view.v1')).toContain('D:\\\\Music\\\\Rock');

    firstRender.unmount();
    __resetFoldersPageSessionForTests();
    libraryMock.getFolderChildren.mockClear();
    libraryMock.getFolderTracks.mockClear();

    renderFoldersPage();

    const restoredRockButton = (await screen.findByText('Rock')).closest('button');
    expect(restoredRockButton?.getAttribute('data-active')).toBe('true');
    await waitFor(() => expect(libraryMock.getFolderChildren).toHaveBeenCalledWith({ folderId: 'folder-1', parentPath: 'D:\\Music' }));
    await waitFor(() =>
      expect(libraryMock.getFolderTracks).toHaveBeenCalledWith(
        expect.objectContaining({
          folderId: 'folder-1',
          path: 'D:\\Music\\Rock',
        }),
      ),
    );
  });

  it('ignores Escape folder-up navigation while the folders page is hidden', async () => {
    const { container } = renderFoldersPage();

    await screen.findByRole('heading', { name: 'Folders' });
    fireEvent.click(screen.getByRole('button', { name: /Music/i }).querySelector('.folder-expand-hit')!);

    const rockButton = (await screen.findByText('Rock')).closest('button');
    expect(rockButton).toBeTruthy();
    fireEvent.click(rockButton!);
    expect(rockButton?.getAttribute('data-active')).toBe('true');

    container.querySelector('.folders-workbench')?.setAttribute('hidden', '');
    fireEvent.keyDown(window, { key: 'Escape' });

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(rockButton?.getAttribute('data-active')).toBe('true');
  });

  it('loads scoped tracks for the selected folder and recursive toggle', async () => {
    renderFoldersPage();

    await waitFor(() =>
      expect(libraryMock.getFolderTracks).toHaveBeenCalledWith(
        expect.objectContaining({
          folderId: 'folder-1',
          path: 'D:\\Music',
          recursive: true,
          page: 1,
          pageSize: 100,
        }),
      ),
    );

    fireEvent.click(screen.getByLabelText('Include subfolders'));

    await waitFor(() =>
      expect(libraryMock.getFolderTracks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          folderId: 'folder-1',
          path: 'D:\\Music',
          recursive: false,
        }),
      ),
    );
  });

  it('plays the selected folder in folder order instead of random sort', async () => {
    window.localStorage.setItem('echo-next.folders.sort', 'random');
    libraryMock.getFolderTracks.mockResolvedValue(
      page([
        track({ id: 'track-1', title: 'First Folder Song' }),
        track({ id: 'track-2', title: 'Second Folder Song', path: 'D:\\Music\\Second.flac' }),
      ]),
    );

    renderFoldersPage();

    await screen.findByText('First Folder Song');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() =>
      expect(libraryMock.getFolderTracks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          folderId: 'folder-1',
          path: 'D:\\Music',
          recursive: true,
          page: 1,
          pageSize: 500,
          sort: 'default',
        }),
      ),
    );
    await waitFor(() =>
      expect(window.echo?.playback?.playLocalFile).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: 'track-1',
          filePath: 'D:\\Music\\Root.flac',
        }),
      ),
    );
  });

  it('randomizes playback from the selected folder only', async () => {
    libraryMock.getFolderTracks.mockResolvedValue(
      page([
        track({ id: 'track-1', title: 'First Folder Song' }),
        track({ id: 'track-2', title: 'Second Folder Song', path: 'D:\\Music\\Second.flac' }),
      ]),
    );

    renderFoldersPage();

    await screen.findByText('First Folder Song');
    fireEvent.click(screen.getByRole('button', { name: 'Random' }));

    await waitFor(() =>
      expect(libraryMock.getFolderTracks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          folderId: 'folder-1',
          path: 'D:\\Music',
          recursive: true,
          page: 1,
          pageSize: 500,
          sort: 'random',
        }),
      ),
    );
  });

  it('supports Ctrl+click multi-select for folder tracks', async () => {
    libraryMock.getFolderTracks.mockResolvedValue(
      page([
        track({ id: 'track-1', title: 'Root Song' }),
        track({ id: 'track-2', title: 'Second Song', path: 'D:\\Music\\Second.flac' }),
      ]),
    );

    renderFoldersPage();

    await screen.findByText('Root Song');
    const firstRow = screen.getByText('Root Song').closest('.track-row');
    const secondRow = screen.getByText('Second Song').closest('.track-row');

    fireEvent.click(firstRow!, { ctrlKey: true });
    fireEvent.click(secondRow!, { ctrlKey: true });

    expect(firstRow?.getAttribute('data-selected')).toBe('true');
    expect(secondRow?.getAttribute('data-selected')).toBe('true');

    fireEvent.click(firstRow!, { ctrlKey: true });

    expect(firstRow?.getAttribute('data-selected')).toBeNull();
    expect(secondRow?.getAttribute('data-selected')).toBe('true');
  });

  it('selects all available folder tracks with Ctrl+A', async () => {
    libraryMock.getFolderTracks.mockResolvedValue(
      page([
        track({ id: 'track-1', title: 'Root Song' }),
        track({ id: 'track-2', title: 'Second Song', path: 'D:\\Music\\Second.flac' }),
        track({ id: 'track-3', title: 'Missing Song', path: 'D:\\Music\\Missing.flac', unavailable: true }),
      ]),
    );

    renderFoldersPage();

    await screen.findByText('Root Song');

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

    await waitFor(() => expect(screen.getByText('Root Song').closest('.track-row')?.getAttribute('data-selected')).toBe('true'));
    expect(screen.getByText('Second Song').closest('.track-row')?.getAttribute('data-selected')).toBe('true');
    expect(screen.getByText('Missing Song').closest('.track-row')?.getAttribute('data-selected')).toBeNull();
    expect(libraryMock.getFolderTracks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        folderId: 'folder-1',
        path: 'D:\\Music',
        recursive: true,
        pageSize: 500,
      }),
    );

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

    await waitFor(() => expect(screen.getByText('Root Song').closest('.track-row')?.getAttribute('data-selected')).toBeNull());
    expect(screen.getByText('Second Song').closest('.track-row')?.getAttribute('data-selected')).toBeNull();
  });

  it('remembers local root folder order after dragging folders', async () => {
    libraryMock.getFolderOverviews.mockResolvedValue([
      overview({ id: 'folder-1', name: 'Music A', path: 'D:\\Music A' }),
      overview({ id: 'folder-2', name: 'Music B', path: 'D:\\Music B' }),
      overview({ id: 'folder-3', name: 'Music C', path: 'D:\\Music C' }),
    ]);

    const firstRender = renderFoldersPage();
    const getFolderNames = (): string[] =>
      Array.from(document.querySelectorAll('.folder-root-button strong')).map((element) => element.textContent ?? '');

    await waitFor(() => expect(getFolderNames()).toEqual(['Music A', 'Music B', 'Music C']));

    const dataTransfer = dragDataTransfer();
    fireEvent.dragStart(screen.getByRole('button', { name: /Music A/i }), { dataTransfer });
    fireEvent.dragOver(screen.getByRole('button', { name: /Music B/i }), { dataTransfer });
    fireEvent.drop(screen.getByRole('button', { name: /Music B/i }), { dataTransfer });

    await waitFor(() => expect(getFolderNames()).toEqual(['Music B', 'Music A', 'Music C']));
    expect(window.localStorage.getItem('echo-next.folder-root-order.v1')).toContain('folder-2');

    firstRender.unmount();
    renderFoldersPage();

    await waitFor(() => expect(getFolderNames()).toEqual(['Music B', 'Music A', 'Music C']));
  });

  it('marks a single folder cover so it can fill the cover tile', async () => {
    libraryMock.getFolderOverviews.mockResolvedValue([overview({ coverThumbs: ['echo-cover://album/cover-1'] })]);

    const { container } = renderFoldersPage();

    await waitFor(() => expect(container.querySelector('.folder-cover-stack img')).toBeTruthy());
    const coverImage = container.querySelector('.folder-cover-stack img');
    const coverStack = coverImage?.closest('.folder-cover-stack');

    expect(coverImage?.getAttribute('src')).toBe('echo-cover://album/cover-1');
    expect(coverStack?.getAttribute('data-cover-count')).toBe('1');
  });

  it('opens the shared track context menu for folder tracks', async () => {
    renderFoldersPage();

    await screen.findByText('Root Song');
    const row = screen.getByText('Root Song').closest('.track-row');
    expect(row).toBeTruthy();

    fireEvent.contextMenu(row!, { clientX: 240, clientY: 180 });

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(5);
    expect(screen.getByRole('menuitem', { name: 'osu! Timing' })).toBeTruthy();
  });

  it('opens osu timing from a folder track context menu', async () => {
    libraryMock.getFolderTracks.mockResolvedValue(
      page([track({ bpm: 150, bpmConfidence: 0.82, beatOffsetMs: 24, analysisStatus: 'complete' })]),
    );

    renderFoldersPage();

    await screen.findByText('Root Song');
    const row = screen.getByText('Root Song').closest('.track-row');
    expect(row).toBeTruthy();

    fireEvent.contextMenu(row!, { clientX: 240, clientY: 180 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'osu! Timing' }));

    expect(await screen.findByRole('dialog', { name: 'osu! Timing' })).toBeTruthy();
    expect(screen.getByText('24,400,4,1,0,100,1,0')).toBeTruthy();
  });

  it('does not broadcast a global library change when folder import only starts a scan', async () => {
    const changedHandler = vi.fn();
    libraryMock.addFolder.mockResolvedValue(overview({ path: 'D:\\New Music', name: 'New Music' }));
    libraryMock.scanFolder.mockResolvedValue(scanStatus({ folderId: 'folder-1' }));
    window.addEventListener('library:changed', changedHandler);

    try {
      const { container } = renderFoldersPage();

      await screen.findByRole('heading', { name: 'Folders' });
      fireEvent.change(container.querySelector('.folder-import-box input')!, { target: { value: 'D:\\New Music' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add + scan' }));

      await waitFor(() => expect(libraryMock.scanFolder).toHaveBeenCalledWith('folder-1'));
      expect(changedHandler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('library:changed', changedHandler);
    }
  });

  it('refreshes folder overviews once for each terminal scan job', async () => {
    renderFoldersPage();

    await waitFor(() => expect(libraryMock.getFolderOverviews).toHaveBeenCalledTimes(1));
    libraryMock.getFolderOverviews.mockClear();

    act(() => {
      rememberLibraryScanStatus(scanStatus({
        id: 'scan-complete',
        status: 'completed',
        phase: 'finished',
        processedFiles: 2,
        addedTracks: 2,
        finishedAt: '2026-01-01T00:01:00.000Z',
      }));
    });

    await waitFor(() => expect(libraryMock.getFolderOverviews).toHaveBeenCalledTimes(1));

    act(() => {
      rememberLibraryScanStatus(scanStatus({
        id: 'scan-complete',
        status: 'completed',
        phase: 'finished',
        processedFiles: 2,
        updatedTracks: 1,
        finishedAt: '2026-01-01T00:01:05.000Z',
      }));
    });

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(libraryMock.getFolderOverviews).toHaveBeenCalledTimes(1);
  });

  it('separates remote folder browsing from local folder APIs', async () => {
    renderFoldersPage();

    fireEvent.click(await screen.findByRole('button', { name: '网盘' }));

    await waitFor(() => expect(remoteSourcesMock.list).toHaveBeenCalled());
    await waitFor(() => expect(remoteSourcesMock.browse).toHaveBeenCalledWith('remote-1', '/Music'));
    await waitFor(() => expect(screen.getAllByText('Baidu Music').length).toBeGreaterThan(0));
    expect(await screen.findByText('百度网盘 · 已启用 · OAuth 自动续期')).toBeTruthy();
    expect(await screen.findByText('song')).toBeTruthy();
    expect(remoteSourcesMock.getIndexedFolderStats).toHaveBeenCalledWith('remote-1', '/Music');
    expect(remoteSourcesMock.listIndexedTracksPage).toHaveBeenCalledWith('remote-1', expect.objectContaining({ rootPath: '/Music', page: 1, pageSize: 100 }));
    expect(remoteSourcesMock.previewDirectoryItems).toHaveBeenCalledWith('remote-1', [expect.objectContaining({ path: '/Music/song.flac' })], { includeCover: true, limit: 12 });

    fireEvent.click(screen.getByRole('button', { name: /Album/ }));
    await waitFor(() => expect(remoteSourcesMock.browse).toHaveBeenLastCalledWith('remote-1', '/Music/Album'));
    expect(libraryMock.getFolderChildren).not.toHaveBeenCalled();
  });

  it('hydrates unindexed remote browser tracks with metadata and covers', async () => {
    remoteSourcesMock.previewDirectoryItems.mockResolvedValue([
      {
        remotePath: '/Music/song.flac',
        title: 'Tagged Song',
        artist: 'Tagged Artist',
        album: 'Tagged Album',
        albumArtist: 'Tagged Artist',
        trackNo: 2,
        discNo: null,
        year: null,
        genre: null,
        duration: 245,
        codec: 'FLAC',
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 1200000,
        coverThumb: 'data:image/jpeg;base64,abc',
        metadataStatus: 'ok',
        coverStatus: 'ok',
        fieldSources: { title: 'embedded', artist: 'embedded', album: 'embedded', duration: 'technical' },
      },
    ]);

    renderFoldersPage();

    fireEvent.click(await screen.findByRole('button', { name: '网盘' }));

    expect(await screen.findByText('Tagged Song')).toBeTruthy();
    expect(await screen.findByText('Tagged Artist')).toBeTruthy();
    expect(await screen.findByText('245')).toBeTruthy();
    expect(screen.getByAltText('Tagged Song cover').getAttribute('src')).toBe('data:image/jpeg;base64,abc');
  });

  it('shows cached indexed remote tracks for a selected folder without previewing every file again', async () => {
    const cachedTrack = track({
        id: 'remote-cached-1',
        mediaType: 'remote',
        sourceId: 'remote-1',
        sourceDisplayName: 'Baidu Music',
        provider: 'baidu',
        remotePath: '/Music/Album/cached.flac',
        title: 'Cached Song',
        artist: 'Cached Artist',
        album: 'Cached Album',
        duration: 188,
        coverThumb: 'echo-cover://remote/cached-thumb',
      });
    remoteSourcesMock.getIndexedFolderStats.mockResolvedValue({
      sourceId: 'remote-1',
      rootPath: '/Music',
      trackCount: 1,
      totalSizeBytes: 2048,
      albumCount: 1,
      artistCount: 1,
    });
    remoteSourcesMock.listIndexedTracksPage.mockResolvedValue({
      items: [cachedTrack],
      page: 1,
      pageSize: 100,
      total: 1,
      hasMore: false,
    });

    renderFoldersPage();

    fireEvent.click(await screen.findByRole('button', { name: '网盘' }));

    expect(await screen.findByText('Cached Song')).toBeTruthy();
    expect(await screen.findByText('Cached Artist')).toBeTruthy();
    expect(screen.getByAltText('Cached Song cover').getAttribute('src')).toBe('echo-cover://remote/cached-thumb');
    expect(remoteSourcesMock.previewDirectoryItems).not.toHaveBeenCalled();
  });

  it('shows indexed Subsonic tracks even when directory browsing is unavailable', async () => {
    const cachedTrack = track({
      id: 'remote-subsonic-1',
      mediaType: 'remote',
      sourceId: 'remote-subsonic',
      sourceDisplayName: 'Navidrome',
      provider: 'subsonic',
      remotePath: 'subsonic:song:song-1',
      title: 'Subsonic Song',
      artist: 'Subsonic Artist',
      album: 'Subsonic Album',
      duration: 188,
      coverThumb: 'echo-image://subsonic-cover/remote-subsonic-1?size=512',
    });
    remoteSourcesMock.list.mockResolvedValue([
      remoteSource({
        id: 'remote-subsonic',
        provider: 'subsonic',
        displayName: 'Navidrome',
        baseUrl: 'http://127.0.0.1:4533',
        authType: 'basic',
        config: {},
        indexedTrackCount: 6114,
      }),
    ]);
    remoteSourcesMock.browse.mockRejectedValue(new Error('Subsonic browse failed'));
    remoteSourcesMock.getIndexedFolderStats.mockResolvedValue({
      sourceId: 'remote-subsonic',
      rootPath: '/',
      trackCount: 6114,
      totalSizeBytes: 1024,
      albumCount: 100,
      artistCount: 50,
    });
    remoteSourcesMock.listIndexedTracksPage.mockResolvedValue({
      items: [cachedTrack],
      page: 1,
      pageSize: 100,
      total: 6114,
      hasMore: true,
    });

    renderFoldersPage();

    fireEvent.click(await screen.findByRole('button', { name: '网盘' }));

    expect(await screen.findByText('Subsonic Song')).toBeTruthy();
    expect(await screen.findByText('Subsonic Artist')).toBeTruthy();
    expect(remoteSourcesMock.getIndexedFolderStats).toHaveBeenCalledWith('remote-subsonic', '/');
    expect(remoteSourcesMock.listIndexedTracksPage).toHaveBeenCalledWith('remote-subsonic', expect.objectContaining({ rootPath: '/', page: 1, pageSize: 100 }));
    expect(remoteSourcesMock.previewDirectoryItems).not.toHaveBeenCalled();
  });

  it('opens settings from the remote empty state', async () => {
    remoteSourcesMock.list.mockResolvedValue([]);
    const onNavigateSettings = vi.fn();
    window.addEventListener('app:navigate:settings', onNavigateSettings);

    try {
      renderFoldersPage();

      fireEvent.click(await screen.findByRole('button', { name: '网盘' }));
      fireEvent.click(await screen.findByRole('button', { name: '添加网盘来源' }));

      expect(onNavigateSettings).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('app:navigate:settings', onNavigateSettings);
    }
  });
});
