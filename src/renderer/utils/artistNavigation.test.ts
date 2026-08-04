// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryArtist, LibraryPage } from '../../shared/types/library';
import {
  consumePendingArtistDetailNavigation,
  openArtistDetailByName,
} from './artistNavigation';

const artist = (name: string): LibraryArtist => ({
  id: `artist-${name}`,
  mediaType: 'local',
  sourceId: null,
  sourceDisplayName: null,
  provider: null,
  artistKey: name.normalize('NFKC').toLocaleLowerCase(),
  name,
  sortName: name.normalize('NFKC').toLocaleLowerCase(),
  role: 'both',
  trackCount: 1,
  albumCount: 1,
  coverId: null,
  coverThumb: null,
  avatarThumbUrl: null,
  avatarUrl: null,
  avatarStatus: null,
  avatarProvider: null,
});

const page = (items: LibraryArtist[]): LibraryPage<LibraryArtist> => ({
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
  hasMore: false,
});

describe('artistNavigation', () => {
  beforeEach(() => {
    consumePendingArtistDetailNavigation();
    delete (window as unknown as { echo?: unknown }).echo;
  });

  it('keeps numeric slash artist names intact when locating details', async () => {
    const numericSlashArtist = artist('22/7');
    const getArtists = vi.fn(async ({ search }: { search?: string }) => page(search === '22/7' ? [numericSlashArtist] : []));
    (window as unknown as { echo: { library: { getArtists: typeof getArtists } } }).echo = {
      library: { getArtists },
    };

    const result = await openArtistDetailByName('22/7');

    expect(result?.name).toBe('22/7');
    expect(getArtists.mock.calls.map(([query]) => query.search)).toEqual(['22/7']);
  });

  it('still falls back to slash collaboration artist parts', async () => {
    const weeknd = artist('The Weeknd');
    const getArtists = vi.fn(async ({ search }: { search?: string }) => page(search === 'The Weeknd' ? [weeknd] : []));
    (window as unknown as { echo: { library: { getArtists: typeof getArtists } } }).echo = {
      library: { getArtists },
    };

    const result = await openArtistDetailByName('The Weeknd/Daft Punk');

    expect(result?.name).toBe('The Weeknd');
    expect(getArtists.mock.calls.map(([query]) => query.search)).toEqual(['The Weeknd/Daft Punk', 'The Weeknd']);
  });
});
