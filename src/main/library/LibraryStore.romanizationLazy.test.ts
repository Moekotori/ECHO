import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryStore } from './LibraryStore';
const mocks = vi.hoisted(() => ({ preload: vi.fn(), build: vi.fn() }));
vi.mock('./SearchIndexTokens', async importOriginal => ({
  ...await importOriginal<typeof import('./SearchIndexTokens')>(),
  preloadSearchIndexRomanizer: mocks.preload,
  buildTrackSearchTermsAsync: mocks.build,
}));

type Row = { rowid: number; id: string; title: string; path?: string; remote_path?: string };
function createStore(local: Row[] = [], remote: Row[] = []) {
  let complete = false;
  const updates: unknown[][] = [];
  const database = {
    prepare(sql: string) { return {
      get: () => complete ? { value: 'complete' } : undefined,
      all: (cursor: number) => (sql.includes('FROM remote_tracks') ? remote : local).filter(row => row.rowid > cursor),
      run: (...args: unknown[]) => { if (sql.includes('INSERT INTO library_maintenance_flags')) complete = true; else updates.push(args); },
    }; },
    transaction: (work: () => void) => work,
  };
  // Exercise paged backfill without constructing or modifying a native database.
  const store: LibraryStore = Object.assign(Object.create(LibraryStore.prototype), { database });
  return { store, updates, completed: () => complete };
}

describe('Japanese search backfill lazy initialization', () => {
  beforeEach(() => { mocks.preload.mockReset().mockResolvedValue(true); mocks.build.mockReset().mockResolvedValue('romaji'); });
  it('does not initialize the dictionary for empty or Latin-only libraries', async () => {
    for (const rows of [[], [{ rowid: 1, id: 'a', title: 'English song', path: '/music/song.flac' }]]) {
      const fixture = createStore(rows);
      await expect(fixture.store.rebuildJapaneseRomanizedSearchTerms()).resolves.toBe(0);
      expect(fixture.completed()).toBe(true);
    }
    expect(mocks.preload).not.toHaveBeenCalled(); expect(mocks.build).not.toHaveBeenCalled();
  });
  it('initializes once for local and remote Japanese candidates, including paths', async () => {
    const fixture = createStore([{ rowid: 1, id: 'a', title: 'English', path: '/音楽/song.flac' }],
      [{ rowid: 1, id: 'b', title: '君が好き', remote_path: '/music/song.flac' }]);
    await expect(fixture.store.rebuildJapaneseRomanizedSearchTerms()).resolves.toBe(2);
    expect(mocks.preload).toHaveBeenCalledOnce(); expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(fixture.updates).toEqual([['romaji', 'a'], ['romaji', 'b']]);
    expect(fixture.completed()).toBe(true);
  });
  it('leaves failed initialization retryable', async () => {
    const fixture = createStore([{ rowid: 1, id: 'a', title: '日本語' }]);
    mocks.preload.mockResolvedValueOnce(false);
    await expect(fixture.store.rebuildJapaneseRomanizedSearchTerms()).resolves.toBe(0);
    expect(fixture.completed()).toBe(false); expect(fixture.updates).toEqual([]);
    await expect(fixture.store.rebuildJapaneseRomanizedSearchTerms()).resolves.toBe(1);
    expect(fixture.completed()).toBe(true); expect(mocks.preload).toHaveBeenCalledTimes(2);
  });
});
