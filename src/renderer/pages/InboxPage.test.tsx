// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryInboxTrackPage, LibraryTrack } from '../../shared/types/library';
import { translations, isLocale, localeOptions } from '../i18n/locales';
import { InboxPage } from './InboxPage';

let libraryBridge: Record<string, unknown> | null = null;
const queueMock = vi.hoisted(() => ({
  appendTracksToQueue: vi.fn(),
}));

vi.mock('../utils/echoBridge', () => ({
  getLibraryBridge: () => libraryBridge,
}));

vi.mock('../stores/PlaybackQueueProvider', () => ({
  usePlaybackQueue: () => queueMock,
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

const track = (id: string, overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id,
  path: `D:\\Music\\${id}.flac`,
  title: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  metadataStatus: 'ok',
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

const inboxPage = (overrides: Partial<LibraryInboxTrackPage> = {}): LibraryInboxTrackPage => ({
  page: 1,
  pageSize: 60,
  total: 1,
  hasMore: false,
  scope: 'latest',
  filter: 'all',
  status: 'all',
  batches: [
    {
      id: 'batch-1',
      scanJobId: 'scan-1',
      folderId: 'folder-1',
      folderName: 'Music',
      folderPath: 'D:\\Music',
      addedCount: 1,
      missingCoverCount: 1,
      metadataIssueCount: 0,
      createdAt: '2026-05-20T00:00:00.000Z',
      finishedAt: '2026-05-20T00:00:00.000Z',
    },
  ],
  selectedBatch: {
    id: 'batch-1',
    scanJobId: 'scan-1',
    folderId: 'folder-1',
    folderName: 'Music',
    folderPath: 'D:\\Music',
    addedCount: 1,
    missingCoverCount: 1,
    metadataIssueCount: 0,
    createdAt: '2026-05-20T00:00:00.000Z',
    finishedAt: '2026-05-20T00:00:00.000Z',
  },
  story: {
    trackCount: 1,
    albumCount: 1,
    artistCount: 1,
    folderCount: 1,
    missingCoverCount: 1,
    metadataIssueCount: 0,
    unknownArtistCount: 0,
    unknownAlbumCount: 0,
    suspiciousCount: 0,
    pendingCount: 1,
    processedCount: 0,
    ignoredCount: 0,
    coverCompleteness: 0,
    metadataCompleteness: 100,
    totalDuration: 180,
    topFolders: [{ value: 'folder-1', label: 'Music', count: 1 }],
    topArtists: [{ value: 'Artist', label: 'Artist', count: 1 }],
  },
  albums: [
    {
      album: 'Album',
      albumArtist: 'Artist',
      coverId: null,
      coverThumb: null,
      trackCount: 1,
      missingCoverCount: 1,
      metadataIssueCount: 0,
      duration: 180,
    },
  ],
  facets: {
    folders: [{ value: 'folder-1', label: 'Music', count: 1 }],
    albums: [{ value: 'Album', label: 'Album', count: 1 }],
    artists: [{ value: 'Artist', label: 'Artist', count: 1 }],
  },
  items: [
    {
      batchId: 'batch-1',
      addedAt: '2026-05-20T00:00:00.000Z',
      track: track('track-1'),
      reasons: ['missing_cover'],
      inboxStatus: 'pending',
    },
  ],
  ...overrides,
});

afterEach(() => {
  cleanup();
  libraryBridge = null;
  queueMock.appendTracksToQueue.mockReset();
  vi.restoreAllMocks();
});

describe('InboxPage', () => {
  it('loads new-song inbox rows and applies bounded filters', async () => {
    const getLibraryInboxTracks = vi.fn().mockResolvedValue(inboxPage());
    libraryBridge = {
      getLibraryInboxTracks,
      onLibraryChanged: vi.fn(),
    };

    render(<InboxPage />);

    expect(await screen.findByText('Song track-1')).toBeTruthy();
    expect(screen.getByText('新增专辑墙')).toBeTruthy();
    expect(screen.getByText(/新增 1 首/)).toBeTruthy();
    expect(screen.getByText('封面完整率')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /资料异常/ })[0]);

    await waitFor(() =>
      expect(getLibraryInboxTracks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope: 'latest',
          filter: 'metadata_issue',
          status: 'all',
          page: 1,
          pageSize: 60,
        }),
      ),
    );
  });

  it('creates a playlist from the current inbox filter without touching playback APIs', async () => {
    const getLibraryInboxTracks = vi.fn().mockResolvedValue(inboxPage());
    const createPlaylistFromLibraryInbox = vi.fn().mockResolvedValue({
      playlist: { name: 'Inbox Picks' },
      addedCount: 1,
      matchedCount: 1,
      skippedCount: 0,
      truncated: false,
      limit: 1000,
    });
    libraryBridge = {
      getLibraryInboxTracks,
      createPlaylistFromLibraryInbox,
      onLibraryChanged: vi.fn(),
    };

    render(<InboxPage />);

    await screen.findByText('Song track-1');
    fireEvent.click(screen.getByRole('button', { name: /生成待听歌单/ }));

    await waitFor(() =>
      expect(createPlaylistFromLibraryInbox).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'latest',
          filter: 'all',
          name: '新歌待听清单',
        }),
      ),
    );
    expect(await screen.findByText(/Inbox Picks/)).toBeTruthy();
  });

  it('adds the current inbox filter to queue through the bridge', async () => {
    const queuedTrack = track('queued-1');
    const getLibraryInboxTracks = vi.fn().mockResolvedValue(inboxPage());
    const addLibraryInboxToQueue = vi.fn().mockResolvedValue({
      tracks: [queuedTrack],
      addedCount: 1,
      matchedCount: 1,
      skippedCount: 0,
      truncated: false,
      limit: 1000,
    });
    libraryBridge = {
      getLibraryInboxTracks,
      addLibraryInboxToQueue,
      onLibraryChanged: vi.fn(),
    };

    render(<InboxPage />);

    await screen.findByText('Song track-1');
    fireEvent.click(screen.getAllByRole('button', { name: /加入队列/ })[0]);

    await waitFor(() =>
      expect(addLibraryInboxToQueue).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'latest',
          filter: 'all',
          status: 'all',
        }),
      ),
    );
    expect(queueMock.appendTracksToQueue).toHaveBeenCalledWith([queuedTrack], { type: 'manual', label: '新歌收件箱' });
  });

  it('marks selected inbox rows without changing playback', async () => {
    const getLibraryInboxTracks = vi.fn().mockResolvedValue(inboxPage());
    const updateLibraryInboxItemState = vi.fn().mockResolvedValue({
      updatedCount: 1,
      matchedCount: 1,
      skippedCount: 0,
      truncated: false,
      limit: 1000,
    });
    libraryBridge = {
      getLibraryInboxTracks,
      updateLibraryInboxItemState,
      onLibraryChanged: vi.fn(),
    };

    render(<InboxPage />);

    await screen.findByText('Song track-1');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '标记已处理' }));

    await waitFor(() =>
      expect(updateLibraryInboxItemState).toHaveBeenCalledWith({
        status: 'processed',
        items: [{ batchId: 'batch-1', trackId: 'track-1' }],
        query: undefined,
      }),
    );
    expect(queueMock.appendTracksToQueue).not.toHaveBeenCalled();
  });
});
