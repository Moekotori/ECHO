import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { LibraryStore } from './LibraryStore';

const openStores: EchoDatabase[] = [];

const now = '2024-01-01T00:00:00.000Z';

const createStore = (): LibraryStore => {
  const database = createDatabase(':memory:');
  openStores.push(database);
  return new LibraryStore(database);
};

const seedTrack = (store: LibraryStore, id: string, overrides: Record<string, unknown> = {}): void => {
  store.transaction(() => {
    const database = (store as unknown as { database: EchoDatabase }).database;
    database
      .prepare(
        `INSERT INTO folders (id, path, name, status, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(`folder-${id}`, `D:/Music/${id}`, id, 'active', 1, now, now);
    database
      .prepare(
        `INSERT INTO tracks (
          id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
          duration, codec, sample_rate, bit_depth, bitrate, cover_id, field_sources_json,
          created_at, updated_at, missing
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        `D:/Music/${id}.flac`,
        `folder-${id}`,
        10,
        1,
        overrides.title ?? `Track ${id}`,
        overrides.artist ?? 'Artist',
        overrides.album ?? 'Album',
        overrides.albumArtist ?? 'Artist',
        overrides.duration ?? 180,
        'FLAC',
        44100,
        16,
        900000,
        overrides.coverId ?? null,
        '{}',
        now,
        now,
        overrides.missing ?? 0,
      );
  });
};

const recordCompletedPlay = (store: LibraryStore, trackId: string, startedAt: string, overrides: Record<string, unknown> = {}): void => {
  const entry = store.createPlaybackHistoryEntry({
    trackId,
    trackPath: `D:/Music/${trackId}.flac`,
    title: String(overrides.title ?? `Track ${trackId}`),
    artist: String(overrides.artist ?? 'Artist'),
    album: String(overrides.album ?? 'Album'),
    albumArtist: String(overrides.albumArtist ?? overrides.artist ?? 'Artist'),
    coverId: null,
    durationSeconds: 180,
    startedAt,
  });

  store.finishPlaybackHistoryEntry(entry.id, {
    playedSeconds: 180,
    durationSeconds: 180,
    completed: true,
    endedAt: startedAt,
  });
};

const seedAlbum = (store: LibraryStore, id: string, overrides: Record<string, unknown> = {}): void => {
  const database = (store as unknown as { database: EchoDatabase }).database;
  database
    .prepare(
      `INSERT INTO albums (id, album_key, title, album_artist, year, cover_id, track_count, duration, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      `album-key-${id}`,
      overrides.title ?? `Album ${id}`,
      overrides.albumArtist ?? 'Album Artist',
      2024,
      overrides.coverId ?? null,
      overrides.trackCount ?? 1,
      overrides.duration ?? 180,
      now,
      now,
    );
};

afterEach(() => {
  while (openStores.length > 0) {
    openStores.pop()?.close();
  }
});

describe('LibraryStore liked media', () => {
  it('generates a local smart playlist from frequent recent history', () => {
    const store = createStore();
    for (let index = 1; index <= 5; index += 1) {
      const trackId = `heavy-${index}`;
      seedTrack(store, trackId, { artist: 'Repeat Artist', album: 'Repeat Album' });
      for (let play = 0; play < 4; play += 1) {
        recordCompletedPlay(store, trackId, `2026-01-${String(index + play).padStart(2, '0')}T00:00:00.000Z`, {
          artist: 'Repeat Artist',
          album: 'Repeat Album',
        });
      }
    }

    for (let index = 1; index <= 9; index += 1) {
      const trackId = `varied-${index}`;
      seedTrack(store, trackId, { artist: `Artist ${index}`, album: `Album ${index}` });
      recordCompletedPlay(store, trackId, `2026-02-${String(index).padStart(2, '0')}T00:00:00.000Z`, {
        artist: `Artist ${index}`,
        album: `Album ${index}`,
      });
    }

    seedTrack(store, 'missing-hot', { artist: 'Missing Artist', album: 'Missing Album', missing: 1 });
    for (let play = 0; play < 8; play += 1) {
      recordCompletedPlay(store, 'missing-hot', `2026-03-${String(play + 1).padStart(2, '0')}T00:00:00.000Z`, {
        artist: 'Missing Artist',
        album: 'Missing Album',
      });
    }

    const result = store.createSmartPlaylistFromListeningHistory({
      name: 'Smart Mix',
      limit: 10,
      recentDays: 3650,
    });
    const page = store.getPlaylistItems(result.playlist.id);
    const repeatedAlbumCount = page.items.filter((item) => item.albumSnapshot === 'Repeat Album').length;

    expect(result.playlist.name).toBe('Smart Mix');
    expect(page.total).toBe(10);
    expect(page.items.map((item) => item.mediaId)).not.toContain('missing-hot');
    expect(repeatedAlbumCount).toBeLessThanOrEqual(2);
  });

  it('creates liked system playlists and protects them from deletion', () => {
    const store = createStore();

    const songs = store.getLikedSongsPlaylist();
    const albums = store.getLikedAlbumsPlaylist();

    expect(songs.kind).toBe('system');
    expect(songs.sourcePlaylistId).toBe('liked-tracks');
    expect(albums.kind).toBe('system');
    expect(albums.sourcePlaylistId).toBe('liked-albums');
    expect(() => store.deletePlaylist(songs.id)).toThrow(/cannot be deleted/i);
    expect(() => store.updatePlaylist({ playlistId: albums.id, name: 'Rename' })).toThrow(/cannot be renamed/i);
  });

  it('likes, deduplicates, unlikes, and clears tracks', () => {
    const store = createStore();
    seedTrack(store, 'track-1', { title: 'Alpha' });

    const first = store.likeTrack('track-1');
    const second = store.likeTrack('track-1');

    expect(second.id).toBe(first.id);
    expect(store.getLikedSongsPlaylist().itemCount).toBe(1);
    expect(store.getLikedTrackIds(['track-1', 'track-2'])).toEqual({ 'track-1': true, 'track-2': false });

    store.unlikeTrack('track-1');
    expect(store.isTrackLiked('track-1')).toBe(false);
    expect(store.getLikedSongsPlaylist().itemCount).toBe(0);

    store.likeTrack('track-1');
    store.clearLikedTracks();
    expect(store.getLikedTracks().total).toBe(0);
    expect(store.getLikedSongsPlaylist().kind).toBe('system');
  });

  it('likes, deduplicates, unlikes, and clears albums', () => {
    const store = createStore();
    seedAlbum(store, 'album-1', { title: 'Album Alpha' });

    const first = store.likeAlbum('album-1');
    const second = store.likeAlbum('album-1');

    expect(second.id).toBe(first.id);
    expect(store.getLikedAlbumsPlaylist().itemCount).toBe(1);
    expect(store.getLikedAlbumIds(['album-1', 'album-2'])).toEqual({ 'album-1': true, 'album-2': false });

    store.unlikeAlbum('album-1');
    expect(store.isAlbumLiked('album-1')).toBe(false);
    expect(store.getLikedAlbumsPlaylist().itemCount).toBe(0);

    store.likeAlbum('album-1');
    store.clearLikedAlbums();
    expect(store.getLikedAlbums().total).toBe(0);
    expect(store.getLikedAlbumsPlaylist().kind).toBe('system');
  });

  it('keeps unavailable liked snapshots when local media disappears', () => {
    const store = createStore();
    const database = (store as unknown as { database: EchoDatabase }).database;
    seedTrack(store, 'track-1', { title: 'Snapshot Track' });
    seedAlbum(store, 'album-1', { title: 'Snapshot Album' });

    store.likeTrack('track-1');
    store.likeAlbum('album-1');
    database.prepare('UPDATE tracks SET missing = 1 WHERE id = ?').run('track-1');
    database.prepare('DELETE FROM albums WHERE id = ?').run('album-1');

    const likedTrack = store.getLikedTracks().items[0];
    const likedAlbum = store.getLikedAlbums().items[0];

    expect(likedTrack.unavailable).toBe(true);
    expect(likedTrack.titleSnapshot).toBe('Snapshot Track');
    expect(likedTrack.track).toBeNull();
    expect(likedAlbum.unavailable).toBe(true);
    expect(likedAlbum.titleSnapshot).toBe('Snapshot Album');
    expect(likedAlbum.album).toBeNull();
  });
});
