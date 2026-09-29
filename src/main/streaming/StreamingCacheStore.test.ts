import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { LibraryStore } from '../library/LibraryStore';
import { StreamingCacheStore } from './StreamingCacheStore';
import type { StreamingPlaylistDetail, StreamingTrack } from '../../shared/types/streaming';

const track = (overrides: Partial<StreamingTrack> = {}): StreamingTrack => ({
  id: 'streaming:netease:track-1',
  provider: 'netease',
  providerTrackId: 'track-1',
  stableKey: 'streaming:netease:track-1',
  title: 'Imported Song',
  artist: 'Imported Artist',
  artists: [],
  album: 'Imported Album',
  albumId: 'album-1',
  albumArtist: 'Imported Artist',
  duration: 180,
  coverUrl: 'echo-image://remote/album-large',
  coverThumb: 'echo-image://remote/album-thumb',
  qualities: ['standard', 'high'],
  explicit: false,
  playable: true,
  unavailableReason: null,
  lyricsStatus: 'available',
  mvStatus: 'unknown',
  ...overrides,
});

const playlist = (tracks: StreamingTrack[]): StreamingPlaylistDetail => ({
  id: 'streaming:netease:playlist:playlist-1',
  provider: 'netease',
  providerPlaylistId: 'playlist-1',
  title: 'Imported Playlist',
  description: 'Streaming playlist description',
  creator: 'Tester',
  coverUrl: 'echo-image://remote/playlist-large',
  coverThumb: 'echo-image://remote/playlist-thumb',
  trackCount: tracks.length,
  tracks,
  page: 1,
  pageSize: 500,
  total: tracks.length,
  hasMore: false,
});

const insertLocalTrack = (
  database: EchoDatabase,
  overrides: {
    id?: string;
    path?: string;
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
  } = {},
): string => {
  const now = new Date('2026-05-19T00:00:00.000Z').toISOString();
  const id = overrides.id ?? 'local-track-1';
  database
    .prepare(
      `INSERT OR IGNORE INTO folders (id, path, name, created_at, updated_at)
       VALUES ('folder-downloads', 'D:\\Downloads', 'Downloads', ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO tracks (
        id, path, folder_id, size_bytes, mtime_ms,
        title, artist, album, album_artist, duration,
        field_sources_json, created_at, updated_at
      ) VALUES (?, ?, 'folder-downloads', 4, 1, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    )
    .run(
      id,
      overrides.path ?? `D:\\Downloads\\${id}.flac`,
      overrides.title ?? 'Imported Song',
      overrides.artist ?? 'Imported Artist',
      overrides.album ?? 'Imported Album',
      overrides.artist ?? 'Imported Artist',
      overrides.duration ?? 180,
      now,
      now,
    );
  return id;
};

describe('StreamingCacheStore', () => {
  let database: EchoDatabase | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  it('keeps imported playlist and track remote covers visible through the library store', () => {
    database = createDatabase(':memory:');
    const cache = new StreamingCacheStore(database);
    const library = new LibraryStore(database);

    const imported = cache.importStreamingPlaylistPage(playlist([track({ playable: false })]), {
      reset: true,
      startPosition: 0,
    });

    expect(imported.playlist.coverThumb).toBe('echo-image://remote/playlist-large');
    expect(library.getPlaylist(imported.playlist.id)?.coverThumb).toBe('echo-image://remote/playlist-large');

    database.prepare('UPDATE playlists SET cover_url = NULL WHERE id = ?').run(imported.playlist.id);
    expect(library.getPlaylist(imported.playlist.id)?.coverThumb).toBe('echo-image://remote/album-large');

    const [item] = library.getPlaylistItems(imported.playlist.id, { pageSize: 10 }).items;
    expect(item).toMatchObject({
      mediaType: 'stream_track',
      coverThumb: 'echo-image://remote/album-large',
      unavailable: false,
    });
  });

  it('can import NetEase daily recommendations as a protected system playlist', () => {
    database = createDatabase(':memory:');
    const cache = new StreamingCacheStore(database);
    const library = new LibraryStore(database);

    const imported = cache.importStreamingPlaylistPage(
      {
        ...playlist([track()]),
        providerPlaylistId: 'daily-recommend',
        title: '每日推荐',
        description: 'Daily recommendations',
      },
      {
        reset: true,
        startPosition: 0,
        kind: 'system',
        addedFrom: 'netease-daily-recommend',
      },
    );

    expect(imported.playlist).toMatchObject({
      kind: 'system',
      sourceProvider: 'netease',
      sourcePlaylistId: 'daily-recommend',
      itemCount: 1,
    });
    expect(() => library.deletePlaylist(imported.playlist.id)).toThrow(/cannot be deleted/i);
  });

  it('reports NetEase djradio source info for cached playlist tracks', () => {
    database = createDatabase(':memory:');
    const cache = new StreamingCacheStore(database);
    const podcastTrack = track({
      id: 'streaming:netease:3370584713',
      providerTrackId: '3370584713',
      stableKey: 'streaming:netease:3370584713',
      albumId: null,
    });

    cache.importStreamingPlaylistPage(
      {
        ...playlist([podcastTrack]),
        providerPlaylistId: 'djradio:990232286',
        title: 'NetEase Podcast',
      },
      {
        reset: true,
        startPosition: 0,
      },
    );

    expect(cache.getTrackSourceInfo('netease', '3370584713')).toMatchObject({
      provider: 'netease',
      providerTrackId: '3370584713',
      albumId: null,
      sourcePlaylistIds: ['djradio:990232286'],
      isNeteaseDjRadio: true,
    });
  });

  it('backs up existing imported playlist items before a reset import clears them', () => {
    database = createDatabase(':memory:');
    const backup = vi.fn((playlistId: string) => {
      const library = new LibraryStore(database!);
      expect(library.getPlaylistItems(playlistId, { pageSize: 10 }).total).toBe(1);
    });
    const cache = new StreamingCacheStore(database, backup);

    const firstImport = cache.importStreamingPlaylistPage(playlist([track()]), {
      reset: true,
      startPosition: 0,
    });
    cache.importStreamingPlaylistPage(playlist([track({ id: 'streaming:netease:track-2', providerTrackId: 'track-2', stableKey: 'streaming:netease:track-2' })]), {
      reset: true,
      startPosition: 0,
    });

    expect(backup).toHaveBeenCalledWith(firstImport.playlist.id);
  });

  it('keeps downloaded local playlist items when a streaming playlist refresh resets rows', () => {
    database = createDatabase(':memory:');
    const cache = new StreamingCacheStore(database);
    const library = new LibraryStore(database);

    const firstImport = cache.importStreamingPlaylistPage(playlist([track()]), {
      reset: true,
      startPosition: 0,
    });
    const localTrackId = insertLocalTrack(database);
    expect(
      library.linkStreamingPlaylistItemsToLocalTrack({
        provider: 'netease',
        providerTrackId: 'track-1',
        stableKey: 'streaming:netease:track-1',
        trackId: localTrackId,
      }),
    ).toBe(1);

    const [linkedBeforeRefresh] = library.getPlaylistItems(firstImport.playlist.id, { pageSize: 10 }).items;
    database.prepare('UPDATE playlist_items SET added_from = ? WHERE id = ?').run('streaming-download', linkedBeforeRefresh.id);

    cache.importStreamingPlaylistPage(playlist([track()]), {
      reset: true,
      startPosition: 0,
    });
    const [linkedAfterRefresh] = library.getPlaylistItems(firstImport.playlist.id, { pageSize: 10 }).items;

    expect(linkedAfterRefresh).toMatchObject({
      mediaType: 'track',
      mediaId: localTrackId,
      sourceProvider: 'local',
      sourceItemId: 'D:\\Downloads\\local-track-1.flac',
      addedFrom: 'streaming-download:netease:track-1',
      unavailable: false,
    });
    expect(linkedAfterRefresh.track?.id).toBe(localTrackId);
    expect(linkedAfterRefresh.track?.mediaType).toBe('local');
  });
});
