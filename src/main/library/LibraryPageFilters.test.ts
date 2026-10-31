import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { LibraryStore } from './LibraryStore';
import { AlbumArtistReadModel } from './artist/AlbumArtistReadModel';

const now = '2026-10-19T00:00:00.000Z';
let database: EchoDatabase;
afterEach(() => database?.close());
const fixture = (): LibraryStore => {
  database = createDatabase(':memory:');
  const store = new LibraryStore(database);
  for (const id of ['f1', 'f2']) database.prepare('INSERT INTO folders (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, `/music/${id}`, id, now, now);
  database.exec(`INSERT INTO covers (id, source_type, created_at, updated_at) VALUES ('cover', 'embedded', '${now}', '${now}')`);
  const insert = database.prepare(`INSERT INTO tracks (id, path, folder_id, title, artist, album, album_artist, size_bytes, mtime_ms,
    field_sources_json, codec, sample_rate, bit_depth, play_count, created_at, updated_at, cover_id, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, 100, 100, '{}', ?, ?, ?, ?, ?, ?, ?, 180)`);
  for (const [id, folder, title, artist, album, credit, codec, rate, bits, plays, cover] of [
    ['t1', 'f1', 'Zebra', 'One', 'Shared', 'Group A', 'FLAC', 96000, 24, 0, 'cover'],
    ['t2', 'f2', 'Apple', 'Two', 'Shared', 'Group A', 'FLAC', 44100, 16, 2, 'cover'],
    ['t3', 'f1', 'Beta', 'Other', 'Other Album', 'Group B', 'MP3', 44100, 16, 1, null],
    ['t4', 'f1', 'Omega', 'One', 'Shared', 'Group A', 'DSF', 2822400, 1, 0, null],
  ] as const) insert.run(id, `/music/${folder}/${id}.flac`, folder, title, artist, album, credit, codec, rate, bits, plays, now, now, cover);
  for (const [id, title, credit, count] of [['a1', 'Shared', 'Group A', 3], ['a2', 'Other Album', 'Group B', 1]] as const) {
    database.prepare('INSERT INTO albums (id, album_key, title, album_artist, track_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, id, title, credit, count, now, now);
  }
  for (const [album, track] of [['a1', 't1'], ['a1', 't2'], ['a1', 't4'], ['a2', 't3']]) database.prepare('INSERT INTO album_tracks (album_id, track_id) VALUES (?, ?)').run(album, track);
  for (const [id, name, count] of [['ar1', 'One', 2], ['ar2', 'Two', 1], ['ar3', 'Other', 1]] as const) {
    database.prepare('INSERT INTO artists (id, artist_key, name, track_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name.toLowerCase(), name, count, now, now);
  }
  for (const [artist, track] of [['ar1', 't1'], ['ar1', 't4'], ['ar2', 't2'], ['ar3', 't3']]) database.prepare("INSERT INTO artist_tracks (artist_id, track_id, source_name) VALUES (?, ?, 'fixture')").run(artist, track);
  for (const id of ['r1', 'r2']) {
    database.prepare('INSERT INTO remote_sources (id, provider, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, 'webdav', id, now, now);
    database.prepare(`INSERT INTO remote_tracks (id, source_id, provider, remote_path, remote_url_hash, stable_key, title, artist, album, album_artist, created_at, updated_at, availability)
      VALUES (?, ?, 'webdav', '/track.flac', ?, ?, 'Remote track', 'Remote artist', 'Remote album', 'Remote artist', ?, ?, 'available')`).run(id, id, id, id, now, now);
  }
  database.exec(`INSERT INTO lyrics_cache (id, cache_key, track_id, provider, title, artist, kind, lines_json, created_at, updated_at)
    VALUES ('lyrics', 'lyrics', 't1', 'embedded', 'Zebra', 'One', 'plain', '[]', '${now}', '${now}');
    INSERT INTO duplicate_track_groups (id, mode, duplicate_key, representative_track_id, track_count, hidden_count, created_at, updated_at)
      VALUES ('dup', 'strict', 'dup', 't1', 2, 1, '${now}', '${now}');
    INSERT INTO duplicate_track_members (group_id, track_id, quality_score, rank, hidden, created_at, updated_at)
      VALUES ('dup', 't1', 1, 1, 0, '${now}', '${now}'), ('dup', 't4', 0, 2, 1, '${now}', '${now}');`);
  return store;
};

describe('library page filter parity', () => {
  it('keeps CUE tracks in their underlying format and lossless filters', () => {
    const store = fixture();
    database.exec("UPDATE tracks SET path = '/music/f1/album.cue#cueTrack=1', codec = 'CUE/FLAC' WHERE id = 't1'");
    expect(store.getTracks({ sourceProvider: 'local', fileFormatFilter: 'flac' }).items.map(item => item.id)).toContain('t1');
    expect(store.getTracks({ sourceProvider: 'local', fileFormatFilter: 'other' }).items.map(item => item.id)).not.toContain('t1');
    expect(store.getFolderTracks({ folderId: 'f1', folderInsight: 'lossless' }).items.map(item => item.id)).toContain('t1');
    database.exec("UPDATE tracks SET codec = 'CUE/DSF', sample_rate = NULL WHERE id = 't1'");
    expect(store.getTracks({ sourceProvider: 'local', fileFormatFilter: 'dsd' }).items.map(item => item.id)).toContain('t1');
    expect(store.getFolderTracks({ folderId: 'f1', folderInsight: 'hiRes' }).items.map(item => item.id)).toContain('t1');
  });
  it('filters album membership before counting and paging without changing album totals', () => {
    const store = fixture();
    const query = { sourceProvider: 'local' as const, folderIds: ['f2'], pageSize: 1, sort: 'titleDesc' as const };
    const page = store.getAlbums(query);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ id: 'a1', trackCount: 3 });
    expect(store.getAlbums({ ...query, page: 2 }).items).toEqual([]);
    expect(store.getAlbums({ ...query, search: 'Zebra' }).total).toBe(1);
    expect(store.getAlbums({ ...query, folderIds: ['unknown'] }).total).toBe(0);
  });
  it('keeps remote album and artist source filtering separate from local folder scopes', () => {
    const store = fixture();
    expect(store.getAlbums({ sourceProvider: 'remote' }).total).toBe(2);
    expect(store.getAlbums({ sourceProvider: 'remote', sourceId: 'r2' }).items[0].sourceId).toBe('r2');
    expect(store.getAlbums({ sourceId: 'r1', folderIds: ['f1'] }).total).toBe(0);
    expect(store.getArtists({ sourceProvider: 'remote', sourceId: 'r2' }).items[0].sourceId).toBe('r2');
    expect(store.getArtists({ sourceProvider: 'remote', folderIds: ['f1'] }).total).toBe(0);
  });
  it('filters both artist grouping modes and retains listening sort order within the folder', () => {
    const store = fixture();
    expect(store.getArtists({ folderIds: ['f1'], sort: 'playCountDesc' }).items.map((item) => item.name)).toEqual(['Other', 'One']);
    const page = store.getArtists({ folderIds: ['f1'], sort: 'titleAsc', pageSize: 1 });
    expect(page.total).toBe(2);
    expect(store.getArtists({ folderIds: ['f2'] }).items.map((item) => item.name)).toEqual(['Two']);
    const grouped = new AlbumArtistReadModel(database);
    expect(grouped.getArtists({ folderIds: ['f2'] }).items).toMatchObject([{ name: 'Two', trackCount: 1 }]);
    expect(grouped.getArtists({ folderIds: ['f1'], sort: 'titleAsc' }).items.map((item) => item.trackCount)).toEqual([2, 1]);
  });
  it('combines folder insights with recursion, search, pagination and duplicate visibility', () => {
    const store = fixture();
    const query = { folderId: 'f1', recursive: true, pageSize: 1, folderInsight: 'hiRes' as const, sort: 'titleAsc' as const };
    expect(store.getFolderTracks(query)).toMatchObject({ total: 2, hasMore: true });
    expect(store.getFolderTracks({ ...query, page: 2 }).items[0].id).toBe('t1');
    expect(store.getFolderTracks({ ...query, search: 'Zebra' }).total).toBe(1);
    expect(store.getFolderTracks({ folderId: 'f1', hideDuplicates: true }).total).toBe(2);
    expect(store.getFolderTracks({ folderId: 'f1', hideDuplicates: true, folderInsight: 'duplicates' }).total).toBe(2);
    expect(store.getFolderTracks({ folderId: 'f1', folderInsight: 'missingLyrics' }).items.map((item) => item.id)).toEqual(['t3', 't4']);
    expect(store.getFolderTracks({ folderId: 'f1', folderInsight: 'unplayed' }).total).toBe(2);
    expect(store.getTracks({ folderIds: ['f1'], folderInsight: 'hiRes' }).total).toBe(2);
  });
});
