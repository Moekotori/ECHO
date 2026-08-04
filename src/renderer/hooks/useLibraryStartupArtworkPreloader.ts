import { useEffect } from 'react';
import type { LibraryAlbum, LibraryArtist, LibrarySort, LibraryTrack } from '../../shared/types/library';
import { readStoredLibrarySort } from '../utils/librarySortMemory';
import { readStoredLibrarySourceMode } from '../utils/librarySourceMode';

const startupArtworkPreloadDelayMs = 900;
const startupArtworkPreloadConcurrency = 4;
const startupArtworkMaxImages = 132;
const startupSongsPageSize = 100;
const startupAlbumsPageSize = 90;
const startupArtistsPageSize = 96;
const maxRememberedStartupArtworkUrls = 1600;

const songsSortStorageKey = 'echo-next.songs.sort';
const songsHideDuplicatesStorageKey = 'echo-next.songs.hide-duplicates';
const albumsSortStorageKey = 'echo-next.albums.sort';
const artistsSortStorageKey = 'echo-next.artists.sort';

const songsSortValues = new Set<LibrarySort>([
  'default',
  'createdAsc',
  'createdDesc',
  'titleAsc',
  'titleDesc',
  'durationAsc',
  'durationDesc',
  'fileModifiedAsc',
  'fileModifiedDesc',
  'qualityAsc',
  'qualityDesc',
  'frequent',
  'random',
  'artist',
  'artistAlbum',
  'album',
  'recent',
]);
const albumSortValues = new Set<LibrarySort>([
  'default',
  'titleAsc',
  'titleDesc',
  'artist',
  'createdAsc',
  'createdDesc',
  'durationAsc',
  'durationDesc',
  'fileModifiedAsc',
  'fileModifiedDesc',
  'recent',
  'random',
]);
const artistSortValues = new Set<LibrarySort>([
  'default',
  'titleAsc',
  'titleDesc',
  'frequent',
  'createdAsc',
  'createdDesc',
  'random',
]);

const rememberedStartupArtworkUrls = new Set<string>();

const readStoredSongsHideDuplicates = (): boolean => {
  try {
    return window.localStorage.getItem(songsHideDuplicatesStorageKey) === 'true';
  } catch {
    return false;
  }
};

const rememberStartupArtworkUrl = (url: string): void => {
  rememberedStartupArtworkUrls.add(url);
  while (rememberedStartupArtworkUrls.size > maxRememberedStartupArtworkUrls) {
    const oldest = rememberedStartupArtworkUrls.values().next().value;
    if (typeof oldest !== 'string') {
      break;
    }
    rememberedStartupArtworkUrls.delete(oldest);
  }
};

const isArtworkUrl = (url: string | null | undefined): url is string => typeof url === 'string' && url.trim().length > 0;

const artistArtworkUrls = (artist: LibraryArtist): string[] => {
  const urls: string[] = [];

  if (isArtworkUrl(artist.avatarThumbUrl)) {
    urls.push(artist.avatarThumbUrl);
  } else if (isArtworkUrl(artist.avatarUrl)) {
    urls.push(artist.avatarUrl);
  }

  if (artist.coverSource !== 'default' && isArtworkUrl(artist.coverThumb)) {
    urls.push(artist.coverThumb);
  }

  return urls;
};

export const selectStartupArtworkUrls = (
  groups: string[][],
  limit: number,
  rememberedUrls: ReadonlySet<string> = rememberedStartupArtworkUrls,
): string[] => {
  const urls: string[] = [];
  const seen = new Set<string>();
  let groupIndex = 0;

  while (urls.length < limit) {
    let addedFromAnyGroup = false;

    for (const group of groups) {
      const url = group[groupIndex];
      if (!url) {
        continue;
      }
      addedFromAnyGroup = true;
      if (seen.has(url) || rememberedUrls.has(url)) {
        continue;
      }
      seen.add(url);
      urls.push(url);
      if (urls.length >= limit) {
        break;
      }
    }

    if (!addedFromAnyGroup) {
      break;
    }
    groupIndex += 1;
  }

  return urls;
};

export const collectStartupArtworkUrls = (
  pages: {
    tracks?: LibraryTrack[];
    albums?: LibraryAlbum[];
    artists?: LibraryArtist[];
  },
  limit = startupArtworkMaxImages,
  rememberedUrls: ReadonlySet<string> = rememberedStartupArtworkUrls,
): string[] =>
  selectStartupArtworkUrls(
    [
      (pages.tracks ?? []).map((track) => track.coverThumb).filter(isArtworkUrl),
      (pages.albums ?? []).map((album) => album.coverThumb).filter(isArtworkUrl),
      (pages.artists ?? []).flatMap(artistArtworkUrls),
    ],
    limit,
    rememberedUrls,
  );

export const preloadStartupArtworkUrls = (
  urls: string[],
  options: { concurrency?: number; rememberUrl?: (url: string) => void } = {},
): (() => void) => {
  if (typeof Image === 'undefined' || urls.length === 0) {
    return () => undefined;
  }

  const concurrency = Math.max(1, Math.floor(options.concurrency ?? startupArtworkPreloadConcurrency));
  const rememberUrl = options.rememberUrl ?? rememberStartupArtworkUrl;
  const imageRefs: HTMLImageElement[] = [];
  let activeCount = 0;
  let cancelled = false;
  let nextIndex = 0;

  const pump = (): void => {
    if (cancelled) {
      return;
    }

    while (activeCount < concurrency && nextIndex < urls.length) {
      const url = urls[nextIndex];
      nextIndex += 1;
      activeCount += 1;

      const image = new Image();
      imageRefs.push(image);
      const finish = (loaded: boolean): void => {
        activeCount -= 1;
        if (loaded) {
          rememberUrl(url);
        }
        pump();
      };
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.decoding = 'async';
      image.src = url;
    }
  };

  pump();

  return () => {
    cancelled = true;
    for (const image of imageRefs) {
      image.onload = null;
      image.onerror = null;
      image.src = '';
    }
  };
};

export const useLibraryStartupArtworkPreloader = (): void => {
  useEffect(() => {
    let cancelled = false;
    let cancelPreload: (() => void) | null = null;

    const timer = window.setTimeout(() => {
      const library = window.echo?.library;
      if (!library) {
        return;
      }

      const sourceProvider = readStoredLibrarySourceMode();
      const songsSort = readStoredLibrarySort(songsSortStorageKey, songsSortValues, 'default');
      const albumsSort = readStoredLibrarySort(albumsSortStorageKey, albumSortValues, 'default');
      const artistsSort = readStoredLibrarySort(artistsSortStorageKey, artistSortValues, 'default');
      const hideDuplicates = readStoredSongsHideDuplicates();

      void Promise.allSettled([
        library.getTracks({
          duplicateMode: 'strict',
          hideDuplicates,
          page: 1,
          pageSize: startupSongsPageSize,
          showDuplicatesOnly: false,
          sort: songsSort,
          sourceProvider,
        }),
        library.getAlbums({
          page: 1,
          pageSize: startupAlbumsPageSize,
          sort: albumsSort,
          sourceProvider,
        }),
        library.getArtists({
          page: 1,
          pageSize: startupArtistsPageSize,
          sort: artistsSort,
          sourceProvider,
        }),
      ]).then(([tracksResult, albumsResult, artistsResult]) => {
        if (cancelled) {
          return;
        }

        const urls = collectStartupArtworkUrls({
          tracks: tracksResult.status === 'fulfilled' ? tracksResult.value.items : [],
          albums: albumsResult.status === 'fulfilled' ? albumsResult.value.items : [],
          artists: artistsResult.status === 'fulfilled' ? artistsResult.value.items : [],
        });
        cancelPreload = preloadStartupArtworkUrls(urls);
      });
    }, startupArtworkPreloadDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cancelPreload?.();
    };
  }, []);
};
