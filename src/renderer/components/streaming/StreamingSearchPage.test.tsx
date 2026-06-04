// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../../shared/types/appSettings';
import type {
  StreamingAlbum,
  StreamingArtist,
  StreamingArtistDetail,
  StreamingProviderDescriptor,
  StreamingSearchResult,
  StreamingTrack,
} from '../../../shared/types/streaming';
import { I18nProvider } from '../../i18n/I18nProvider';
import { PlaybackQueueProvider } from '../../stores/PlaybackQueueProvider';
import { StreamingSearchPage } from './StreamingSearchPage';
import { updateStreamingSearchMemory } from './streamingSearchMemory';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => {
    const rowSize = estimateSize();
    return {
      getTotalSize: () => count * rowSize,
      getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size: rowSize,
        start: index * rowSize,
      })),
      measureElement: () => undefined,
    };
  },
}));

const provider: StreamingProviderDescriptor = {
  name: 'netease',
  displayName: 'NetEase Cloud Music',
  enabled: true,
  supportsSearch: true,
  supportsPlayback: true,
  supportsLyrics: true,
  supportsMv: true,
  requiresAccount: false,
};

const qqProvider: StreamingProviderDescriptor = {
  name: 'qqmusic',
  displayName: 'QQ Music',
  enabled: true,
  supportsSearch: true,
  supportsPlayback: true,
  supportsLyrics: true,
  supportsMv: true,
  requiresAccount: false,
};

const kugouProvider: StreamingProviderDescriptor = {
  name: 'kugou',
  displayName: 'KuGou Music',
  enabled: true,
  supportsSearch: true,
  supportsPlayback: true,
  supportsLyrics: true,
  supportsMv: false,
  requiresAccount: false,
};

const artist: StreamingArtist = {
  id: 'streaming:netease:artist:jay',
  provider: 'netease',
  providerArtistId: 'jay',
  name: '周杰伦',
  avatarUrl: null,
  coverUrl: null,
};

const track: StreamingTrack = {
  id: 'streaming:netease:song:sunny',
  provider: 'netease',
  providerTrackId: 'sunny',
  stableKey: 'streaming:netease:sunny',
  title: '晴天',
  artist: '周杰伦',
  artists: [],
  album: '叶惠美',
  albumId: 'album-yhm',
  albumArtist: '周杰伦',
  duration: 269,
  coverUrl: null,
  coverThumb: null,
  qualities: ['high', 'lossless'],
  explicit: false,
  playable: true,
  unavailableReason: null,
  lyricsStatus: 'unknown',
  mvStatus: 'unknown',
};

const searchResult: StreamingSearchResult = {
  provider: 'netease',
  query: '周杰伦',
  page: 1,
  pageSize: 30,
  total: 1,
  hasMore: false,
  tracks: [],
  albums: [],
  artists: [artist],
  playlists: [],
  mvs: [],
};

const qqArtistWithMidName: StreamingArtist = {
  id: 'streaming:qqmusic:artist:002DYpxl3hW3EP',
  provider: 'qqmusic',
  providerArtistId: '002DYpxl3hW3EP',
  name: '002DYpxl3hW3EP',
  avatarUrl: null,
  coverUrl: null,
};

const qqArtistAlbum: StreamingAlbum = {
  id: 'streaming:qqmusic:album:0003lclS1T2kXW',
  provider: 'qqmusic',
  providerAlbumId: '0003lclS1T2kXW',
  title: 'My Worlds - The Collection',
  artist: 'Justin Bieber',
  artists: [{
    id: 'streaming:qqmusic:artist:002DYpxl3hW3EP',
    provider: 'qqmusic',
    providerArtistId: '002DYpxl3hW3EP',
    name: 'Justin Bieber',
  }],
  coverUrl: null,
  coverThumb: null,
  releaseDate: '2010-11-19',
  trackCount: 31,
};

const trackSearchResult: StreamingSearchResult = {
  ...searchResult,
  query: '晴天',
  tracks: [track],
  artists: [],
};

const albumSearchResult: StreamingSearchResult = {
  ...searchResult,
  query: 'album',
  tracks: [],
  albums: [qqArtistAlbum],
  artists: [],
};

const resetStreamingMemory = (): void => {
  updateStreamingSearchMemory({
    provider: 'netease',
    quality: 'lossless',
    activeTab: 'track',
    input: '',
    query: '',
    resultKey: null,
    result: null,
    failedCoverUrls: {},
    scrollTop: 0,
  });
};

const renderStreamingSearchPage = (): void => {
  render(
    <I18nProvider>
      <PlaybackQueueProvider>
        <StreamingSearchPage />
      </PlaybackQueueProvider>
    </I18nProvider>,
  );
};

afterEach(() => {
  cleanup();
  resetStreamingMemory();
  window.localStorage.clear();
  vi.restoreAllMocks();
  delete (window as Partial<Window>).echo;
});

describe('StreamingSearchPage artist detail', () => {
  it('opens a streaming artist detail even when cached top tracks miss artist refs', async () => {
    const legacyCachedTrack = { ...track, artists: undefined } as unknown as StreamingTrack;
    const artistDetail: StreamingArtistDetail = {
      ...artist,
      topTracks: [legacyCachedTrack],
      albums: [],
    };

    updateStreamingSearchMemory({
      provider: 'netease',
      quality: 'lossless',
      activeTab: 'artist',
      input: '周杰伦',
      query: '周杰伦',
      result: searchResult,
      failedCoverUrls: {},
      scrollTop: 0,
    });

    window.echo = {
      streaming: {
        getProviders: vi.fn().mockResolvedValue([provider]),
        search: vi.fn().mockResolvedValue(searchResult),
        getArtist: vi.fn().mockResolvedValue(artistDetail),
      },
    } as unknown as Window['echo'];

    renderStreamingSearchPage();

    fireEvent.click(await screen.findByRole('button', { name: /周杰伦/ }));

    expect(await screen.findByRole('heading', { name: '周杰伦' })).toBeTruthy();
    await waitFor(() => expect(window.echo?.streaming?.getArtist).toHaveBeenCalledWith({
      provider: 'netease',
      providerArtistId: 'jay',
    }));
    expect(await screen.findByText('晴天')).toBeTruthy();
    expect(screen.getAllByText('周杰伦').length).toBeGreaterThan(0);
  });

  it('uses QQ Music album metadata when the artist detail name is a provider id', async () => {
    const qqSearchResult: StreamingSearchResult = {
      provider: 'qqmusic',
      query: 'Justin Bieber',
      page: 1,
      pageSize: 30,
      total: 1,
      hasMore: false,
      tracks: [],
      albums: [],
      artists: [qqArtistWithMidName],
      playlists: [],
      mvs: [],
    };
    const artistDetail: StreamingArtistDetail = {
      ...qqArtistWithMidName,
      topTracks: [],
      albums: [qqArtistAlbum],
    };

    updateStreamingSearchMemory({
      provider: 'qqmusic',
      quality: 'lossless',
      activeTab: 'artist',
      input: 'Justin Bieber',
      query: 'Justin Bieber',
      result: qqSearchResult,
      failedCoverUrls: {},
      scrollTop: 0,
    });

    window.echo = {
      streaming: {
        getProviders: vi.fn().mockResolvedValue([qqProvider]),
        search: vi.fn().mockResolvedValue(qqSearchResult),
        getArtist: vi.fn().mockResolvedValue(artistDetail),
      },
    } as unknown as Window['echo'];

    renderStreamingSearchPage();

    fireEvent.click(await screen.findByRole('button', { name: /002DYpxl3hW3EP/ }));

    expect(await screen.findByRole('heading', { name: 'Justin Bieber' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '002DYpxl3hW3EP' })).toBeNull();
    expect(await screen.findByText('My Worlds - The Collection')).toBeTruthy();
  });

  it('reopens artist detail without keeping the return animation state', async () => {
    const artistDetail: StreamingArtistDetail = {
      ...artist,
      topTracks: [],
      albums: [],
    };

    updateStreamingSearchMemory({
      provider: 'netease',
      quality: 'lossless',
      activeTab: 'artist',
      input: artist.name,
      query: artist.name,
      result: searchResult,
      failedCoverUrls: {},
      scrollTop: 0,
    });

    window.echo = {
      streaming: {
        getProviders: vi.fn().mockResolvedValue([provider]),
        search: vi.fn().mockResolvedValue(searchResult),
        getArtist: vi.fn().mockResolvedValue(artistDetail),
      },
    } as unknown as Window['echo'];

    renderStreamingSearchPage();

    const clickResultArtist = async (): Promise<void> => {
      const artistLabels = await screen.findAllByText(artist.name);
      const artistCard = artistLabels
        .map((element) => element.closest('[role="button"]'))
        .find((element): element is HTMLElement => element instanceof HTMLElement);
      if (!artistCard) {
        throw new Error('Expected artist result card to be rendered');
      }
      fireEvent.click(artistCard);
    };

    await clickResultArtist();
    expect(await screen.findByRole('heading', { name: artist.name })).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Streaming' }));
    await waitFor(() => expect(document.querySelector('.streaming-artist-page')).toBeNull());

    await clickResultArtist();
    const detailPage = await waitFor(() => {
      const element = document.querySelector('.streaming-artist-page');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    expect(detailPage.classList.contains('is-returning')).toBe(false);
  });
});

describe('StreamingSearchPage download visibility', () => {
  const primeTrackSearch = (): void => {
    updateStreamingSearchMemory({
      provider: 'netease',
      quality: 'lossless',
      activeTab: 'track',
      input: '晴天',
      query: '晴天',
      result: trackSearchResult,
      failedCoverUrls: {},
      scrollTop: 0,
    });
  };

  it('restores cached results without refreshing search on mount', async () => {
    const resultKey = 'netease:track:鏅村ぉ';
    updateStreamingSearchMemory({
      provider: 'netease',
      quality: 'lossless',
      activeTab: 'track',
      input: trackSearchResult.query,
      query: trackSearchResult.query,
      resultKey,
      result: trackSearchResult,
      failedCoverUrls: {},
      scrollTop: 0,
    });

    const search = vi.fn().mockResolvedValue(trackSearchResult);
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ streamingDownloadActionsEnabled: false } as AppSettings),
      },
      streaming: {
        getProviders: vi.fn().mockResolvedValue([provider]),
        search,
      },
    } as unknown as Window['echo'];

    renderStreamingSearchPage();

    await waitFor(() => expect(document.querySelector('.streaming-row')).toBeTruthy());
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(search).not.toHaveBeenCalled();
  });

  it('hides streaming download actions by default', async () => {
    primeTrackSearch();

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ streamingDownloadActionsEnabled: false } as AppSettings),
      },
      streaming: {
        getProviders: vi.fn().mockResolvedValue([provider]),
        search: vi.fn().mockResolvedValue(trackSearchResult),
      },
    } as unknown as Window['echo'];

    renderStreamingSearchPage();

    expect(await screen.findByText('晴天')).toBeTruthy();
    await waitFor(() => expect(window.echo?.app?.getSettings).toHaveBeenCalled());
    expect(screen.queryByTitle('下载')).toBeNull();
  });

  it('shows streaming download actions when downloads are unlocked', async () => {
    primeTrackSearch();

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ downloadsFeatureUnlocked: true, streamingDownloadActionsEnabled: false } as AppSettings),
      },
      streaming: {
        getProviders: vi.fn().mockResolvedValue([provider]),
        search: vi.fn().mockResolvedValue(trackSearchResult),
      },
    } as unknown as Window['echo'];

    renderStreamingSearchPage();

    expect(await screen.findByText('晴天')).toBeTruthy();
    expect(await screen.findByTitle('下载')).toBeTruthy();
  });
  it('queues every downloadable track from a streaming album detail', async () => {
    const albumTracks: StreamingTrack[] = [
      { ...track, provider: 'qqmusic', providerTrackId: 'song-mid-1', stableKey: 'streaming:qqmusic:song-mid-1', title: 'Album Track 1', album: qqArtistAlbum.title },
      { ...track, provider: 'qqmusic', providerTrackId: 'song-mid-2', stableKey: 'streaming:qqmusic:song-mid-2', title: 'Album Track 2', album: qqArtistAlbum.title },
    ];
    const albumDetail = { ...qqArtistAlbum, tracks: albumTracks };
    const resolvePlayback = vi.fn(async ({ providerTrackId }: { providerTrackId: string }) => ({
      provider: 'qqmusic',
      providerTrackId,
      url: `https://cdn.example/${providerTrackId}.m4a`,
      headers: { Referer: 'https://y.qq.com/' },
      mimeType: 'audio/mp4',
      codec: 'm4a',
      quality: 'lossless',
      bitrate: null,
      expiresAt: null,
      downloadAuthorizationToken: `download-token-${providerTrackId}`,
    }));
    const createUrlJob = vi.fn(async (url: string, options: Record<string, unknown>) => ({
      id: `job-${String(createUrlJob.mock.calls.length)}`,
      sourceUrl: url,
      provider: 'unknown',
      audioStrategy: 'best_available',
      status: 'queued',
      title: options.title,
      durationSeconds: null,
      thumbnailUrl: null,
      webpageUrl: options.webpageUrl,
      outputPath: null,
      downloadedBytes: null,
      totalBytes: null,
      speedBytesPerSecond: null,
      etaSeconds: null,
      importedTrackId: null,
      progress: 0,
      error: null,
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z',
      completedAt: null,
    }));
    const noticeHandler = vi.fn();
    window.addEventListener('app:show-chrome-notice', noticeHandler);

    updateStreamingSearchMemory({
      provider: 'qqmusic',
      quality: 'lossless',
      activeTab: 'album',
      input: 'album',
      query: 'album',
      result: albumSearchResult,
      failedCoverUrls: {},
      scrollTop: 0,
    });

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ downloadsFeatureUnlocked: true, streamingDownloadActionsEnabled: true } as AppSettings),
      },
      streaming: {
        getProviders: vi.fn().mockResolvedValue([qqProvider]),
        search: vi.fn().mockResolvedValue(albumSearchResult),
        getAlbum: vi.fn().mockResolvedValue(albumDetail),
        resolvePlayback,
      },
      downloads: {
        createUrlJob,
        onJobsUpdated: vi.fn(() => () => undefined),
      },
    } as unknown as Window['echo'];

    try {
      renderStreamingSearchPage();

      fireEvent.click(await screen.findByText(qqArtistAlbum.title));
      expect(await screen.findByText('Album Track 1')).toBeTruthy();

      fireEvent.click(await screen.findByRole('button', { name: /下载专辑|涓嬭浇涓撹緫/u }));

      await waitFor(() => expect(createUrlJob).toHaveBeenCalledTimes(2));
      expect(resolvePlayback).toHaveBeenCalledWith({
        provider: 'qqmusic',
        providerTrackId: 'song-mid-1',
        quality: 'lossless',
      });
      expect(createUrlJob.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
        title: 'Album Track 1',
        album: qqArtistAlbum.title,
        outputSubdirectory: `${qqArtistAlbum.artist} - ${qqArtistAlbum.title}`,
        deferImportToLibrary: true,
        streamingProvider: 'qqmusic',
        streamingProviderTrackId: 'song-mid-1',
        downloadAuthorizationToken: 'download-token-song-mid-1',
      }));
      expect(noticeHandler).toHaveBeenCalled();
    } finally {
      window.removeEventListener('app:show-chrome-notice', noticeHandler);
    }
  });
});

describe('StreamingSearchPage provider visibility', () => {
  it('hides KuGou Music from streaming source tabs', async () => {
    let refreshProviders: (() => void) | null = null;
    window.echo = {
      accounts: {
        onStatusesChanged: vi.fn((handler: () => void) => {
          refreshProviders = handler;
          return vi.fn();
        }),
      },
      streaming: {
        getProviders: vi.fn().mockResolvedValue([provider, qqProvider, kugouProvider]),
        search: vi.fn().mockResolvedValue(trackSearchResult),
      },
    } as unknown as Window['echo'];

    renderStreamingSearchPage();
    (refreshProviders as (() => void) | null)?.();

    expect(await screen.findByRole('button', { name: /NetEase Cloud Music/ })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /QQ Music/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /KuGou Music/ })).toBeNull();
  });

  it('falls back from remembered KuGou source before searching', async () => {
    updateStreamingSearchMemory({
      provider: 'kugou',
      quality: 'lossless',
      activeTab: 'track',
      input: 'sunny',
      query: 'sunny',
      resultKey: null,
      result: null,
      failedCoverUrls: {},
      scrollTop: 0,
    });

    const search = vi.fn().mockResolvedValue(trackSearchResult);
    window.echo = {
      streaming: {
        getProviders: vi.fn().mockResolvedValue([provider, kugouProvider]),
        search,
      },
    } as unknown as Window['echo'];

    renderStreamingSearchPage();

    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ provider: 'netease' }));
    expect(search).not.toHaveBeenCalledWith(expect.objectContaining({ provider: 'kugou' }));
  });
});
