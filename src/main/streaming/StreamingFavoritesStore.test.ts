import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { StreamingTrack } from '../../shared/types/streaming';
import { StreamingFavoritesStore } from './StreamingFavoritesStore';

let tempRoot: string | null = null;

const makeStore = (): StreamingFavoritesStore => {
  tempRoot = mkdtempSync(join(tmpdir(), 'echo-streaming-favorites-'));
  return new StreamingFavoritesStore(join(tempRoot, 'streaming-favorites.json'));
};

const makeTrack = (patch: Partial<StreamingTrack> = {}): StreamingTrack => ({
  id: 'streaming:youtube:abc123',
  provider: 'youtube',
  providerTrackId: 'abc123',
  stableKey: 'streaming:youtube:abc123',
  title: 'Video Song',
  artist: 'Video Artist',
  artists: [],
  album: 'YouTube',
  albumId: null,
  albumArtist: 'Video Artist',
  duration: 123,
  coverUrl: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
  coverThumb: 'https://i.ytimg.com/vi/abc123/default.jpg',
  qualities: ['high'],
  explicit: false,
  playable: true,
  unavailableReason: null,
  lyricsStatus: 'unknown',
  mvStatus: 'unknown',
  ...patch,
});

describe('StreamingFavoritesStore', () => {
  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('stores favorite tracks by provider with portable web URLs', () => {
    const store = makeStore();
    const result = store.setFavorite(makeTrack(), true);

    expect(result.favorite).toBe(true);
    expect(result.item).toMatchObject({
      provider: 'youtube',
      providerTrackId: 'abc123',
      title: 'Video Song',
      webUrl: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(result.snapshot.providers.youtube).toHaveLength(1);
    expect(result.snapshot.providers.bilibili).toEqual([]);

    const persisted = JSON.parse(readFileSync(join(tempRoot!, 'streaming-favorites.json'), 'utf8')) as unknown;
    expect(persisted).toMatchObject({
      version: 1,
      providers: {
        youtube: [
          {
            providerTrackId: 'abc123',
            webUrl: 'https://www.youtube.com/watch?v=abc123',
          },
        ],
      },
    });
  });

  it('deduplicates and removes favorites', () => {
    const store = makeStore();
    store.setFavorite(makeTrack({ title: 'First title' }), true);
    const updated = store.setFavorite(makeTrack({ title: 'Updated title' }), true);

    expect(updated.snapshot.providers.youtube).toHaveLength(1);
    expect(updated.snapshot.providers.youtube[0].title).toBe('Updated title');

    const removed = store.setFavorite(makeTrack(), false);
    expect(removed.favorite).toBe(false);
    expect(removed.item).toBeNull();
    expect(removed.snapshot.providers.youtube).toEqual([]);
  });

  it('imports favorite playlist tracks without rewriting existing added times', () => {
    const store = makeStore();
    const first = store.setFavorite(makeTrack({ title: 'Existing title' }), true).item;
    const imported = store.importTracks([
      makeTrack({ title: 'Updated title' }),
      makeTrack({ providerTrackId: 'new-video', stableKey: 'streaming:youtube:new-video', title: 'New Video' }),
    ]);

    expect(imported.importedCount).toBe(2);
    expect(imported.addedCount).toBe(1);
    expect(imported.snapshot.providers.youtube.map((item) => item.providerTrackId)).toEqual(['abc123', 'new-video']);
    expect(imported.snapshot.providers.youtube[0]).toMatchObject({
      title: 'Updated title',
      addedAt: first?.addedAt,
    });
  });

  it('imports playlist links as named collections without changing default provider favorites', () => {
    const store = makeStore();
    store.setFavorite(makeTrack({ providerTrackId: 'default-video', stableKey: 'streaming:youtube:default-video' }), true);

    const imported = store.importCollection('youtube', 'PL123', 'YouTube Favorites', [
      makeTrack({ providerTrackId: 'abc123', stableKey: 'streaming:youtube:abc123' }),
      makeTrack({ providerTrackId: 'new-video', stableKey: 'streaming:youtube:new-video', title: 'New Video' }),
    ]);

    expect(imported.importedCount).toBe(2);
    expect(imported.addedCount).toBe(2);
    expect(imported.snapshot.providers.youtube.map((item) => item.providerTrackId)).toEqual(['default-video']);
    expect(imported.collection).toMatchObject({
      id: 'streaming-favorites:youtube:PL123',
      provider: 'youtube',
      providerPlaylistId: 'PL123',
      name: 'YouTube Favorites',
      sourceName: 'YouTube Favorites',
    });
    expect(imported.collection.tracks.map((item) => item.providerTrackId)).toEqual(['abc123', 'new-video']);
  });

  it('renames imported favorite collections and preserves the custom name on refresh', () => {
    const store = makeStore();
    const imported = store.importCollection('youtube', 'PL123', 'YouTube Favorites', [makeTrack()]);
    const renamed = store.renameCollection(imported.collection.id, 'Night Picks');
    const refreshed = store.importCollection('youtube', 'PL123', 'Remote Title Changed', [makeTrack({ title: 'Updated Song' })]);

    expect(renamed.collection.name).toBe('Night Picks');
    expect(refreshed.collection).toMatchObject({
      name: 'Night Picks',
      sourceName: 'Remote Title Changed',
    });
    expect(refreshed.collection.tracks[0].title).toBe('Updated Song');
  });

  it('deletes imported favorite collections without touching default provider favorites', () => {
    const store = makeStore();
    store.setFavorite(makeTrack({ providerTrackId: 'default-video', stableKey: 'streaming:youtube:default-video' }), true);
    const imported = store.importCollection('youtube', 'PL123', 'YouTube Favorites', [makeTrack()]);

    const deleted = store.deleteCollection(imported.collection.id);

    expect(deleted.collectionId).toBe('streaming-favorites:youtube:PL123');
    expect(deleted.snapshot.collections).toEqual([]);
    expect(deleted.snapshot.providers.youtube.map((item) => item.providerTrackId)).toEqual(['default-video']);
  });

  it('rejects providers outside local streaming favorites', () => {
    const store = makeStore();

    expect(() => store.setFavorite(makeTrack({ provider: 'netease', providerTrackId: '1', stableKey: 'streaming:netease:1' }), true))
      .toThrow('This streaming provider does not support local favorites.');
  });
});
