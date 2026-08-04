import { describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../../database/createDatabase';
import type { CoverResult, FieldSources } from '../libraryTypes';
import { NetworkMetadataMerge } from './NetworkMetadataMerge';
import { NetworkMetadataService } from './NetworkMetadataService';
import { NetworkMetadataStore } from './NetworkMetadataStore';
import type { NetworkMetadataProvider } from './NetworkMetadataProvider';
import { matchScore, NETWORK_VISIBLE_CANDIDATE_THRESHOLD } from './matchScore';

const now = '2026-05-12T00:00:00.000Z';

const sources = (overrides: Partial<FieldSources> = {}): FieldSources => ({
  title: 'unknown',
  artist: 'unknown',
  album: 'unknown',
  albumArtist: 'unknown',
  trackNo: 'unknown',
  discNo: 'unknown',
  year: 'unknown',
  genre: 'unknown',
  duration: 'technical',
  codec: 'technical',
  sampleRate: 'technical',
  bitDepth: 'technical',
  bitrate: 'technical',
  ...overrides,
});

const db = (): EchoDatabase => createDatabase(':memory:');

const insertTrack = (
  database: EchoDatabase,
  options: {
    embeddedMetadataStatus?: string;
    embeddedCoverStatus?: string;
    coverSource?: string;
    fieldSources?: FieldSources;
    title?: string;
    artist?: string;
    album?: string;
  } = {},
): string => {
  database
    .prepare(
      `INSERT OR IGNORE INTO folders (id, path, name, status, enabled, created_at, updated_at)
       VALUES ('folder', 'C:/Music', 'Music', 'active', 1, ?, ?)`,
    )
    .run(now, now);

  const coverId = options.coverSource ? `cover-${options.coverSource}` : null;
  if (coverId) {
    database
      .prepare(
        `INSERT OR REPLACE INTO covers (
          id, source_type, source_hash, mime_type, thumb_path, album_path, large_path, original_ref,
          cache_version, warnings_json, errors_json, cover_thumb, cover_large, cover_original, created_at, updated_at
        ) VALUES (?, ?, ?, 'image/svg+xml', 'thumb', 'album', 'large', 'original', 1, '[]', '[]', 'thumb', 'large', 'original', ?, ?)`,
      )
      .run(coverId, options.coverSource, `hash-${options.coverSource}`, now, now);
  }

  database
    .prepare(
      `INSERT INTO tracks (
        id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
        duration, codec, sample_rate, bit_depth, bitrate, cover_id, metadata_status,
        embedded_metadata_status, embedded_cover_status, network_metadata_status,
        field_sources_json, missing, created_at, updated_at
      ) VALUES ('track', 'C:/Music/track.flac', 'folder', 1, 1, ?, ?, ?, ?, 180, 'FLAC', 44100, 16, 1000, ?, 'ok',
        ?, ?, 'none', ?, 0, ?, ?)`,
    )
    .run(
      options.title ?? 'Local Title',
      options.artist ?? 'Unknown Artist',
      options.album ?? '',
      options.artist ?? 'Unknown Artist',
      coverId,
      options.embeddedMetadataStatus ?? 'missing',
      options.embeddedCoverStatus ?? 'missing',
      JSON.stringify(options.fieldSources ?? sources()),
      now,
      now,
    );

  return 'track';
};

const insertCandidate = (database: EchoDatabase, score = 0.96): string =>
  new NetworkMetadataStore(database).upsertMetadataCandidate(
    'track',
    null,
    {
      provider: 'mock',
      providerItemId: `candidate-${score}`,
      title: 'Network Title',
      artist: 'Network Artist',
      album: 'Network Album',
      albumArtist: 'Network Album Artist',
      year: 2026,
      genre: 'Electronic',
      duration: 180,
      trackNo: 2,
      discNo: 1,
      coverUrl: null,
      raw: {},
    },
    score,
  ).id;

const track = (database: EchoDatabase): Record<string, unknown> =>
  database.prepare<[], Record<string, unknown>>("SELECT * FROM tracks WHERE id = 'track'").get()!;

const networkCover = (): CoverResult => ({
  source: 'network',
  sourceHash: 'network-hash',
  mimeType: 'image/png',
  thumbPath: 'C:/cache/thumb.webp',
  albumPath: 'C:/cache/album.webp',
  largePath: 'C:/cache/large.webp',
  originalRef: 'C:/cache/original.png',
  warnings: [],
  errors: [],
});

describe('Network metadata required guards', () => {
  it('embedded_metadata_status pending blocks network track writes', () => {
    const database = db();
    insertTrack(database, { embeddedMetadataStatus: 'pending' });
    new NetworkMetadataMerge(database).applyMissingOnly(insertCandidate(database));
    expect(track(database).title).toBe('Local Title');
    database.close();
  });

  it('embedded_metadata_status reading blocks network track writes', () => {
    const database = db();
    insertTrack(database, { embeddedMetadataStatus: 'reading' });
    new NetworkMetadataMerge(database).applyMissingOnly(insertCandidate(database));
    expect(track(database).artist).toBe('Unknown Artist');
    database.close();
  });

  it('embedded_metadata_status present does not overwrite embedded title', () => {
    const database = db();
    insertTrack(database, { embeddedMetadataStatus: 'present', title: 'Embedded Title', fieldSources: sources({ title: 'embedded' }) });
    new NetworkMetadataMerge(database).applyMissingOnly(insertCandidate(database), true);
    expect(track(database).title).toBe('Embedded Title');
    database.close();
  });

  it('embedded artist is protected from network', () => {
    const database = db();
    insertTrack(database, { embeddedMetadataStatus: 'error', artist: 'Embedded Artist', fieldSources: sources({ artist: 'embedded' }) });
    new NetworkMetadataMerge(database).applyMissingOnly(insertCandidate(database), true);
    expect(track(database).artist).toBe('Embedded Artist');
    database.close();
  });

  it('embedded album is protected from network', () => {
    const database = db();
    insertTrack(database, { embeddedMetadataStatus: 'error', album: 'Embedded Album', fieldSources: sources({ album: 'embedded' }) });
    new NetworkMetadataMerge(database).applyMissingOnly(insertCandidate(database), true);
    expect(track(database).album).toBe('Embedded Album');
    database.close();
  });

  it('embedded_cover_status pending blocks network cover apply', () => {
    const database = db();
    insertTrack(database, { embeddedCoverStatus: 'pending', coverSource: 'default' });
    const result = new NetworkMetadataMerge(database).applyCoverIfMissing('track', networkCover(), 0.96);
    expect(result.reason).toBe('embedded_cover_not_ready');
    database.close();
  });

  it('embedded cover is protected from network cover', () => {
    const database = db();
    insertTrack(database, { embeddedCoverStatus: 'present', coverSource: 'embedded' });
    const result = new NetworkMetadataMerge(database).applyCoverIfMissing('track', networkCover(), 0.96);
    expect(result.reason).toBe('cover_source_embedded_protected');
    database.close();
  });

  it('folder cover is protected from network cover', () => {
    const database = db();
    insertTrack(database, { embeddedCoverStatus: 'missing', coverSource: 'folder' });
    const result = new NetworkMetadataMerge(database).applyCoverIfMissing('track', networkCover(), 0.96);
    expect(result.reason).toBe('cover_source_folder_protected');
    database.close();
  });

  it('default cover can be replaced by high-score network cover', () => {
    const database = db();
    insertTrack(database, { embeddedCoverStatus: 'missing', coverSource: 'default' });
    const result = new NetworkMetadataMerge(database).applyCoverIfMissing('track', networkCover(), 0.96);
    expect(result.appliedFields.coverId).toBeTruthy();
    database.close();
  });

  it('score below 0.92 does not auto apply missing only', () => {
    const database = db();
    insertTrack(database);
    const result = new NetworkMetadataMerge(database).applyMissingOnly(insertCandidate(database, 0.91));
    expect(result.reason).toBe('score_below_auto_apply_threshold');
    database.close();
  });

  it('rejected candidate is not listed again', () => {
    const database = db();
    insertTrack(database);
    const candidateId = insertCandidate(database);
    new NetworkMetadataMerge(database).reject(candidateId);
    expect(new NetworkMetadataStore(database).listTrackMetadataCandidates('track')).toHaveLength(0);
    database.close();
  });

  it('provider error does not change local library metadata', async () => {
    const database = db();
    insertTrack(database, { title: 'Local Safe Title' });
    const provider: NetworkMetadataProvider = {
      name: 'mock',
      async findMetadata() {
        throw new Error('offline');
      },
    };
    const result = await new NetworkMetadataService(database, [provider]).repairMissingMetadata('track');
    expect(result.errors.join('\n')).toContain('offline');
    expect(track(database).title).toBe('Local Safe Title');
    database.close();
  });

  it('applied_fields_json records accepted fields', () => {
    const database = db();
    insertTrack(database);
    new NetworkMetadataMerge(database).applyMissingOnly(insertCandidate(database));
    const decision = database.prepare<[], { applied_fields_json: string }>('SELECT applied_fields_json FROM network_metadata_decisions').get()!;
    expect(JSON.parse(decision.applied_fields_json)).toMatchObject({ artist: 'Network Artist' });
    database.close();
  });

  it('filename_fallback field can be replaced by high-score network', () => {
    const database = db();
    insertTrack(database, { title: 'Filename Guess', fieldSources: sources({ title: 'filename_fallback' }) });
    new NetworkMetadataMerge(database).applyMissingOnly(insertCandidate(database));
    expect(track(database).title).toBe('Network Title');
    database.close();
  });

  it('Unknown Artist can be completed by high-score network', () => {
    const database = db();
    insertTrack(database, { artist: 'Unknown Artist', fieldSources: sources({ artist: 'unknown' }) });
    new NetworkMetadataMerge(database).applyMissingOnly(insertCandidate(database));
    expect(track(database).artist).toBe('Network Artist');
    database.close();
  });

  it('repairs stale pending readiness before applying selected network metadata', () => {
    const database = db();
    insertTrack(database, {
      embeddedMetadataStatus: 'pending',
      embeddedCoverStatus: 'pending',
      title: 'Filename Guess',
      artist: 'Unknown Artist',
      fieldSources: sources({ title: 'filename_fallback', artist: 'unknown' }),
    });
    database
      .prepare(
        `INSERT INTO scan_jobs (id, folder_id, status, phase, errors_json, created_at, updated_at, finished_at)
         VALUES ('job', 'folder', 'completed', 'finished', '[]', ?, ?, ?)`,
      )
      .run(now, now, now);

    const result = new NetworkMetadataMerge(database).applyMissingOnly(insertCandidate(database, 0.89), true);
    const updated = track(database);

    expect(result.status).toBe('applied_missing_only');
    expect(updated.embedded_metadata_status).toBe('missing');
    expect(updated.artist).toBe('Network Artist');
    database.close();
  });

  it('does not repair pending readiness while a scan is active', () => {
    const database = db();
    insertTrack(database, {
      embeddedMetadataStatus: 'pending',
      fieldSources: sources({ artist: 'unknown' }),
    });
    database
      .prepare(
        `INSERT INTO scan_jobs (id, folder_id, status, phase, errors_json, created_at, updated_at)
         VALUES ('job', 'folder', 'running', 'reading_metadata', '[]', ?, ?)`,
      )
      .run(now, now);

    const result = new NetworkMetadataMerge(database).applyMissingOnly(insertCandidate(database), true);

    expect(result.reason).toBe('embedded_metadata_not_ready');
    expect(track(database).embedded_metadata_status).toBe('pending');
    database.close();
  });

  it('scores Chinese metadata candidates instead of stripping CJK text', () => {
    const score = matchScore(
      {
        title: '晴天',
        artist: '周杰伦',
        album: '叶惠美',
        duration: 269,
        filename: '晴天.flac',
      },
      {
        title: '晴天',
        artist: '周杰伦',
        album: '叶惠美',
        duration: 269,
      },
    );

    expect(score).toBeGreaterThanOrEqual(NETWORK_VISIBLE_CANDIDATE_THRESHOLD);
  });

  it('scans missing metadata targets and lists candidates without applying them', async () => {
    const database = db();
    insertTrack(database, { artist: 'Unknown Artist', coverSource: 'default', fieldSources: sources({ artist: 'unknown' }) });
    const provider: NetworkMetadataProvider = {
      name: 'mock',
      async findMetadata() {
        return [
          {
            provider: 'mock',
            providerItemId: 'scan-candidate',
            title: 'Local Title',
            artist: 'Network Artist',
            album: null,
            albumArtist: 'Network Artist',
            year: null,
            genre: null,
            duration: 180,
            trackNo: null,
            discNo: null,
            coverUrl: null,
            raw: {},
          },
        ];
      },
    };

    const result = await new NetworkMetadataService(database, [provider]).scanMissingMetadata(10, ['mock']);

    expect(result.scannedCount).toBe(1);
    expect(result.candidateCount).toBe(1);
    expect(result.diagnostics).toMatchObject({ targetCount: 1, noCandidateCount: 0, appliedCount: 0 });
    expect(result.items[0].reasons).toEqual(expect.arrayContaining(['missing_cover', 'unknown_artist']));
    expect(result.items[0].candidates.metadata[0].artist).toBe('Network Artist');
    expect(track(database).artist).toBe('Unknown Artist');
    database.close();
  });

  it('bulk scans tracks that only miss cover art', async () => {
    const database = db();
    insertTrack(database, {
      artist: 'Embedded Artist',
      album: 'Embedded Album',
      fieldSources: sources({ title: 'embedded', artist: 'embedded', album: 'embedded', albumArtist: 'embedded' }),
      embeddedMetadataStatus: 'present',
      embeddedCoverStatus: 'missing',
    });
    const provider: NetworkMetadataProvider = {
      name: 'mock',
      async findMetadata() {
        return [
          {
            provider: 'mock',
            providerItemId: 'cover-candidate',
            title: 'Local Title',
            artist: 'Embedded Artist',
            album: 'Embedded Album',
            albumArtist: 'Embedded Artist',
            year: null,
            genre: null,
            duration: 180,
            trackNo: null,
            discNo: null,
            coverUrl: 'https://example.invalid/cover.jpg',
            raw: {},
          },
        ];
      },
    };

    const result = await new NetworkMetadataService(database, [provider]).scanMissingMetadata(10, ['mock']);

    expect(result.scannedCount).toBe(1);
    expect(result.diagnostics).toMatchObject({ targetCount: 1, noCandidateCount: 0 });
    expect(result.items[0].reasons).toEqual(['missing_cover']);
    expect(result.items[0].candidates.metadata[0].coverUrl).toBe('https://example.invalid/cover.jpg');
    database.close();
  });

  it('filters bulk scan targets by selected missing fields', async () => {
    const database = db();
    database
      .prepare(
        `INSERT OR IGNORE INTO folders (id, path, name, status, enabled, created_at, updated_at)
         VALUES ('folder', 'C:/Music', 'Music', 'active', 1, ?, ?)`,
      )
      .run(now, now);
    database
      .prepare(
        `INSERT OR REPLACE INTO covers (
          id, source_type, source_hash, mime_type, thumb_path, album_path, large_path, original_ref,
          cache_version, warnings_json, errors_json, cover_thumb, cover_large, cover_original, created_at, updated_at
        ) VALUES ('cover-embedded', 'embedded', 'hash-embedded', 'image/jpeg', 'thumb', 'album', 'large', 'original', 1, '[]', '[]', 'thumb', 'large', 'original', ?, ?)`,
      )
      .run(now, now);
    const statement = database.prepare(
      `INSERT INTO tracks (
        id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
        duration, codec, sample_rate, bit_depth, bitrate, cover_id, metadata_status,
        embedded_metadata_status, embedded_cover_status, network_metadata_status,
        field_sources_json, missing, created_at, updated_at
      ) VALUES (?, ?, 'folder', 1, 1, ?, ?, ?, ?, 180, 'FLAC', 44100, 16, 1000, ?, 'ok',
        'missing', 'missing', 'none', ?, 0, ?, ?)`,
    );
    statement.run(
      'missing-cover',
      'C:/Music/missing-cover.flac',
      'Cover Track',
      'Known Artist',
      'Known Album',
      'Known Artist',
      null,
      JSON.stringify(sources({ title: 'embedded', artist: 'embedded', album: 'embedded', albumArtist: 'embedded' })),
      now,
      now,
    );
    statement.run(
      'missing-artist',
      'C:/Music/missing-artist.flac',
      'Artist Track',
      'Unknown Artist',
      'Known Album',
      'Unknown Artist',
      'cover-embedded',
      JSON.stringify(sources({ title: 'embedded', album: 'embedded', albumArtist: 'embedded' })),
      now,
      now,
    );

    const result = await new NetworkMetadataService(database, []).scanMissingMetadata(10, [], ['cover']);

    expect(result.items.map((item) => item.track.id)).toEqual(['missing-cover']);
    database.close();
  });

  it('scans missing metadata across the library before applying the result limit', async () => {
    const database = db();
    database
      .prepare(
        `INSERT OR IGNORE INTO folders (id, path, name, status, enabled, created_at, updated_at)
         VALUES ('folder', 'C:/Music', 'Music', 'active', 1, ?, ?)`,
      )
      .run(now, now);

    for (let index = 0; index < 12; index += 1) {
      const coverId = `cover-${index}`;
      database
        .prepare(
          `INSERT INTO covers (
            id, source_type, source_hash, mime_type, thumb_path, album_path, large_path, original_ref,
            cache_version, warnings_json, errors_json, cover_thumb, cover_large, cover_original, created_at, updated_at
          ) VALUES (?, 'embedded', ?, 'image/png', 'thumb', 'album', 'large', 'original', 1, '[]', '[]', 'thumb', 'large', 'original', ?, ?)`,
        )
        .run(coverId, `hash-${index}`, now, now);
      database
        .prepare(
          `INSERT INTO tracks (
            id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
            duration, codec, sample_rate, bit_depth, bitrate, cover_id, metadata_status,
            embedded_metadata_status, embedded_cover_status, network_metadata_status,
            field_sources_json, missing, created_at, updated_at
          ) VALUES (?, ?, 'folder', 1, 1, ?, 'Artist', 'Album', 'Artist', 180, 'FLAC', 44100, 16, 1000, ?, 'ok',
            'present', 'present', 'none', ?, 0, ?, ?)`,
        )
        .run(
          `complete-${index}`,
          `C:/Music/complete-${index}.flac`,
          `Complete ${index}`,
          coverId,
          JSON.stringify(sources({ title: 'embedded', artist: 'embedded', album: 'embedded', albumArtist: 'embedded' })),
          now,
          now,
        );
    }

    database
      .prepare(
        `INSERT INTO tracks (
          id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
          duration, codec, sample_rate, bit_depth, bitrate, cover_id, metadata_status,
          embedded_metadata_status, embedded_cover_status, network_metadata_status,
          field_sources_json, missing, created_at, updated_at
        ) VALUES ('old-missing', 'C:/Music/old-missing.flac', 'folder', 1, 1, 'Old Missing', 'Unknown Artist', '', 'Unknown Artist',
          180, 'FLAC', 44100, 16, 1000, NULL, 'ok', 'missing', 'missing', 'none', ?, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(JSON.stringify(sources()));

    const result = await new NetworkMetadataService(database, []).scanMissingMetadata(1, []);

    expect(result.scannedCount).toBe(1);
    expect(result.items[0].track.id).toBe('old-missing');
    database.close();
  });
});
