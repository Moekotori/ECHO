import { describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { LibraryStore } from './LibraryStore';

const now = '2026-05-20T00:00:00.000Z';

const createStore = (): { database: EchoDatabase; store: LibraryStore } => {
  const database = createDatabase(':memory:');
  database
    .prepare('INSERT INTO folders (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('folder-1', 'D:\\Music', 'Music', now, now);
  database
    .prepare(
      `INSERT INTO covers (
        id, source_type, source_hash, mime_type, thumb_path, album_path, large_path, original_ref,
        cache_version, warnings_json, errors_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('cover-1', 'embedded', 'hash-1', 'image/jpeg', 'thumb.jpg', 'album.jpg', 'large.jpg', 'cover.jpg', 1, '[]', '[]', now, now);

  return { database, store: new LibraryStore(database) };
};

const insertTrack = (
  database: EchoDatabase,
  overrides: Partial<{
    id: string;
    title: string;
    artist: string;
    album: string;
    albumArtist: string;
    coverId: string | null;
    metadataStatus: string;
    embeddedMetadataStatus: string;
    embeddedCoverStatus: string;
    networkMetadataStatus: string;
    fieldSources: Record<string, string>;
  }> = {},
): void => {
  const id = overrides.id ?? `track-${Math.random().toString(16).slice(2)}`;
  const title = overrides.title ?? 'Song';
  const artist = overrides.artist ?? 'Artist';
  const album = overrides.album ?? 'Album';
  const albumArtist = overrides.albumArtist ?? artist;
  const path = `D:\\Music\\${id}.flac`;

  database
    .prepare(
      `INSERT INTO tracks (
        id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
        duration, search_terms, cover_id, metadata_status, embedded_metadata_status, embedded_cover_status,
        network_metadata_status, field_sources_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      path,
      'folder-1',
      1024,
      1,
      title,
      artist,
      album,
      albumArtist,
      180,
      `${title} ${artist} ${album} ${path}`,
      Object.prototype.hasOwnProperty.call(overrides, 'coverId') ? overrides.coverId : 'cover-1',
      overrides.metadataStatus ?? 'ok',
      overrides.embeddedMetadataStatus ?? 'present',
      overrides.embeddedCoverStatus ?? 'present',
      overrides.networkMetadataStatus ?? 'none',
      JSON.stringify(overrides.fieldSources ?? {}),
      now,
      now,
    );
};

describe('Library quality dashboard queries', () => {
  it('summarizes local metadata quality issues without touching remote or playback state', () => {
    const { database, store } = createStore();
    insertTrack(database, { id: 'missing-cover', title: 'Missing Cover', coverId: null, embeddedCoverStatus: 'missing' });
    insertTrack(database, {
      id: 'fallback',
      title: 'Fallback',
      metadataStatus: 'fallback',
      fieldSources: { title: 'filename_fallback' },
    });
    insertTrack(database, {
      id: 'unknown',
      title: 'Unknown',
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      albumArtist: 'Unknown Artist',
    });
    insertTrack(database, {
      id: 'embedded-error',
      title: 'Embedded Error',
      embeddedMetadataStatus: 'error',
      embeddedCoverStatus: 'error',
    });
    insertTrack(database, { id: 'candidate', title: 'Candidate', networkMetadataStatus: 'candidate_found' });
    database
      .prepare(
        `INSERT INTO network_metadata_candidates (
          id, track_id, provider, provider_item_id, title, artist, album, album_artist,
          year, genre, duration, track_no, disc_no, cover_url, score, raw_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('candidate-1', 'candidate', 'mock', 'mock-1', 'Candidate', 'Artist', 'Album', 'Artist', 2026, 'Pop', 180, 1, 1, null, 0.95, '{}', now);

    const overview = Object.fromEntries(store.getLibraryQualityOverview().map((item) => [item.kind, item.count]));

    expect(overview.missing_cover).toBe(1);
    expect(overview.fallback_metadata).toBe(1);
    expect(overview.unknown_artist_album).toBe(1);
    expect(overview.embedded_read_failed).toBe(1);
    expect(overview.network_candidate).toBe(1);
  });

  it('does not count folder artwork as missing cover just because embedded art is absent', () => {
    const { database, store } = createStore();
    database
      .prepare(
        `INSERT INTO covers (
          id, source_type, source_hash, mime_type, thumb_path, album_path, large_path, original_ref,
          cache_version, warnings_json, errors_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('cover-folder', 'folder', 'hash-folder', 'image/jpeg', 'thumb.jpg', 'album.jpg', 'large.jpg', 'folder.jpg', 1, '[]', '[]', now, now);
    insertTrack(database, {
      id: 'folder-cover',
      title: 'Folder Cover',
      coverId: 'cover-folder',
      embeddedCoverStatus: 'missing',
    });

    const overview = Object.fromEntries(store.getLibraryQualityOverview().map((item) => [item.kind, item.count]));
    const page = store.getLibraryQualityIssues({ kind: 'missing_cover' });

    expect(overview.missing_cover).toBe(0);
    expect(page.total).toBe(0);
  });

  it('returns paged issue rows with reasons and clamps page size to 100', () => {
    const { database, store } = createStore();
    insertTrack(database, { id: 'first', title: 'First Missing Cover', coverId: null });
    insertTrack(database, { id: 'second', title: 'Second Missing Cover', coverId: null });

    const page = store.getLibraryQualityIssues({ kind: 'missing_cover', page: 1, pageSize: 999 });

    expect(page.pageSize).toBe(100);
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.track.title)).toEqual(['First Missing Cover', 'Second Missing Cover']);
    expect(page.items[0].reasons).toContain('missing_cover');
  });

  it('filters issue rows through the existing local track FTS index', () => {
    const { database, store } = createStore();
    insertTrack(database, { id: 'visible', title: 'Visible Needle', coverId: null });
    insertTrack(database, { id: 'hidden', title: 'Other Song', coverId: null });

    const page = store.getLibraryQualityIssues({ kind: 'missing_cover', search: 'Needle' });

    expect(page.total).toBe(1);
    expect(page.items[0]?.track.id).toBe('visible');
  });
});
