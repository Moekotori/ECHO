import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { LibraryStore } from './LibraryStore';
import { RemoteLibraryStore } from './remote/RemoteLibraryStore';

const now = '2026-01-01T00:00:00.000Z';
let database: EchoDatabase | null = null;

const makeStore = (remoteAlbumMergeStrategy: 'conservative' | 'standard' = 'conservative'): LibraryStore => {
  database = createDatabase(':memory:');
  return new LibraryStore(database, () => ({ remoteAlbumMergeStrategy }));
};

const seedRemoteSource = (provider = 'webdav'): string => {
  const sourceId = `${provider}-source`;
  database!
    .prepare(
      `INSERT INTO remote_sources (
        id, provider, display_name, status, base_url, username, auth_type, encrypted_secret,
        config_json, sync_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sourceId, provider, provider, 'enabled', 'https://example.test', null, 'none', null, '{}', 'index', now, now);
  return sourceId;
};

const seedRemoteTrack = (
  sourceId: string,
  provider: string,
  id: string,
  overrides: {
    path?: string;
    title?: string;
    artist?: string;
    album?: string;
    albumArtist?: string;
    trackNo?: number | null;
    year?: number | null;
    coverId?: string | null;
    fieldSources?: Record<string, string>;
  } = {},
): void => {
  const remotePath = overrides.path ?? `/Music/${overrides.album ?? 'Album'}/${id}.flac`;
  database!
    .prepare(
      `INSERT INTO remote_tracks (
        id, source_id, provider, remote_path, remote_url_hash, stable_key, title, artist,
        album, album_artist, track_no, disc_no, year, genre, duration, codec, sample_rate,
        bit_depth, bitrate, size_bytes, modified_at, etag, cover_id, cover_status,
        metadata_status, lyrics_status, mv_status, availability, field_sources_json,
        search_terms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sourceId,
      provider,
      remotePath,
      `hash-${id}`,
      `stable-${id}`,
      overrides.title ?? id,
      overrides.artist ?? 'Artist',
      overrides.album ?? 'Album',
      overrides.albumArtist ?? overrides.artist ?? 'Artist',
      overrides.trackNo ?? null,
      null,
      overrides.year ?? null,
      null,
      180,
      'flac',
      44100,
      16,
      900000,
      1024,
      now,
      null,
      overrides.coverId ?? null,
      overrides.coverId ? 'ok' : 'pending',
      'ok',
      'pending',
      'pending',
      'available',
      JSON.stringify(overrides.fieldSources ?? {}),
      '',
      now,
      now,
    );
};

afterEach(() => {
  database?.close();
  database = null;
});

describe('LibraryStore remote album grouping', () => {
  it('groups Subsonic tracks by server album id even when track artists differ', () => {
    const store = makeStore();
    const sourceId = seedRemoteSource('subsonic');

    seedRemoteTrack(sourceId, 'subsonic', 'song-1', {
      title: 'One',
      artist: 'Artist One',
      album: 'Shared Album',
      albumArtist: 'Artist One',
      trackNo: 1,
      fieldSources: { albumId: 'server-album-1', coverArt: 'cover-1' },
    });
    seedRemoteTrack(sourceId, 'subsonic', 'song-2', {
      title: 'Two',
      artist: 'Artist Two',
      album: 'Shared Album',
      albumArtist: 'Artist Two',
      trackNo: 2,
      fieldSources: { albumId: 'server-album-1', coverArt: 'cover-1' },
    });

    const albums = store.getAlbums({ sourceProvider: 'remote', search: 'Shared Album', pageSize: 10 });

    expect(albums.total).toBe(1);
    expect(albums.items[0]).toMatchObject({
      mediaType: 'remote',
      sourceId,
      provider: 'subsonic',
      title: 'Shared Album',
      albumArtist: 'Various Artists',
      trackCount: 2,
    });
    expect(store.getAlbumTracks(albums.items[0]!.id).items.map((track) => track.id)).toEqual(['song-1', 'song-2']);
  });

  it('does not split Subsonic albums by per-track coverArt when server album id is missing', () => {
    const store = makeStore();
    const sourceId = seedRemoteSource('subsonic');

    seedRemoteTrack(sourceId, 'subsonic', 'song-1', {
      title: 'One',
      artist: 'Artist One',
      album: 'Exploded Album',
      albumArtist: 'Artist One',
      trackNo: 1,
      fieldSources: { coverArt: 'song-cover-1' },
    });
    seedRemoteTrack(sourceId, 'subsonic', 'song-2', {
      title: 'Two',
      artist: 'Artist Two',
      album: 'Exploded Album',
      albumArtist: 'Artist Two',
      trackNo: 2,
      fieldSources: { coverArt: 'song-cover-2' },
    });

    const albums = store.getAlbums({ sourceProvider: 'remote', search: 'Exploded Album', pageSize: 10 });

    expect(albums.total).toBe(1);
    expect(albums.items[0]).toMatchObject({
      provider: 'subsonic',
      title: 'Exploded Album',
      albumArtist: 'Various Artists',
      trackCount: 2,
    });
  });

  it('groups fallback WebDAV album artists only inside the same source folder', () => {
    const store = makeStore();
    const sourceId = seedRemoteSource('webdav');

    seedRemoteTrack(sourceId, 'webdav', 'same-folder-1', {
      path: '/Music/Compilation/01.flac',
      artist: 'Artist One',
      album: 'Greatest Hits',
      albumArtist: 'Artist One',
      trackNo: 1,
      fieldSources: { albumArtist: 'artist_fallback' },
    });
    seedRemoteTrack(sourceId, 'webdav', 'same-folder-2', {
      path: '/Music/Compilation/02.flac',
      artist: 'Artist Two',
      album: 'Greatest Hits',
      albumArtist: 'Artist Two',
      trackNo: 2,
      fieldSources: { albumArtist: 'artist_fallback' },
    });
    seedRemoteTrack(sourceId, 'webdav', 'other-folder', {
      path: '/Music/Other/01.flac',
      artist: 'Other Artist',
      album: 'Greatest Hits',
      albumArtist: 'Other Artist',
      trackNo: 1,
      fieldSources: { albumArtist: 'artist_fallback' },
    });

    const albums = store.getAlbums({ sourceProvider: 'remote', search: 'Greatest Hits', pageSize: 10 });

    expect(albums.total).toBe(2);
    expect(albums.items.map((album) => album.trackCount).sort((left, right) => left - right)).toEqual([1, 2]);
    expect(albums.items.find((album) => album.trackCount === 2)).toMatchObject({
      albumArtist: 'Various Artists',
    });
  });

  it('keeps title suffix variants split in conservative mode', () => {
    const store = makeStore('conservative');
    const sourceId = seedRemoteSource('subsonic');

    seedRemoteTrack(sourceId, 'subsonic', 'epic-1', {
      path: '/Music/Spangle call Lilli line/epic/01.flac',
      title: 'epic',
      artist: 'Spangle call Lilli line',
      album: 'epic',
      albumArtist: 'Spangle call Lilli line',
      trackNo: 1,
    });
    seedRemoteTrack(sourceId, 'subsonic', 'epic-single-1', {
      path: '/Music/Spangle call Lilli line/epic/02.flac',
      title: 'epic - Single',
      artist: 'Spangle call Lilli line',
      album: 'epic - Single',
      albumArtist: 'Spangle call Lilli line',
      trackNo: 2,
    });

    const albums = store.getAlbums({ sourceProvider: 'remote', search: 'epic', pageSize: 10 });

    expect(albums.total).toBe(2);
  });

  it('merges remote title suffix variants in standard mode', () => {
    const store = makeStore('standard');
    const sourceId = seedRemoteSource('subsonic');

    seedRemoteTrack(sourceId, 'subsonic', 'epic-1', {
      path: '/Music/Spangle call Lilli line/epic/01.flac',
      title: 'epic',
      artist: 'Spangle call Lilli line',
      album: 'epic',
      albumArtist: 'Spangle call Lilli line',
      trackNo: 1,
    });
    seedRemoteTrack(sourceId, 'subsonic', 'epic-single-1', {
      path: '/Music/Spangle call Lilli line/epic/02.flac',
      title: 'epic - Single',
      artist: 'Spangle call Lilli line',
      album: 'epic - Single',
      albumArtist: 'Spangle call Lilli line',
      trackNo: 2,
    });

    const albums = store.getAlbums({ sourceProvider: 'remote', search: 'epic', pageSize: 10 });

    expect(albums.total).toBe(1);
    expect(albums.items[0]).toMatchObject({
      provider: 'subsonic',
      title: 'epic',
      albumArtist: 'Spangle call Lilli line',
      trackCount: 2,
    });
    expect(store.getAlbumTracks(albums.items[0]!.id).items.map((track) => track.id)).toEqual(['epic-1', 'epic-single-1']);
  });

  it('previews remote album counts before applying a merge strategy', () => {
    makeStore('conservative');
    const sourceId = seedRemoteSource('subsonic');

    seedRemoteTrack(sourceId, 'subsonic', 'epic-1', {
      path: '/Music/Spangle call Lilli line/epic/01.flac',
      artist: 'Spangle call Lilli line',
      album: 'epic',
      albumArtist: 'Spangle call Lilli line',
      trackNo: 1,
    });
    seedRemoteTrack(sourceId, 'subsonic', 'epic-single-1', {
      path: '/Music/Spangle call Lilli line/epic/02.flac',
      artist: 'Spangle call Lilli line',
      album: 'epic - Single',
      albumArtist: 'Spangle call Lilli line',
      trackNo: 2,
    });

    const preview = new RemoteLibraryStore(database!).previewAlbumGrouping('conservative', 'standard');

    expect(preview).toMatchObject({
      sourceCount: 1,
      trackCount: 2,
      currentAlbumCount: 2,
      targetAlbumCount: 1,
    });
  });
});
