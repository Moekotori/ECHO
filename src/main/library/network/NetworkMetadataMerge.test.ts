import { describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../../database/createDatabase';
import type { CoverResult, FieldSources } from '../libraryTypes';
import { NetworkMetadataMerge } from './NetworkMetadataMerge';
import { NetworkMetadataService } from './NetworkMetadataService';
import { NetworkMetadataStore } from './NetworkMetadataStore';
import type { NetworkMetadataProvider } from './NetworkMetadataProvider';

const now = '2026-05-12T00:00:00.000Z';

const baseSources = (overrides: Partial<FieldSources> = {}): FieldSources => ({
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

const seedTrack = (
  database: EchoDatabase,
  options: {
    id?: string;
    embeddedMetadataStatus?: string;
    embeddedCoverStatus?: string;
    coverSource?: string;
    fieldSources?: FieldSources;
    title?: string;
    artist?: string;
    album?: string;
  } = {},
): string => {
  const trackId = options.id ?? 'track-1';
  database
    .prepare(
      `INSERT INTO folders (id, path, name, status, enabled, created_at, updated_at)
       VALUES ('folder-1', 'C:/Music', 'Music', 'active', 1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(now, now);

  let coverId: string | null = null;
  if (options.coverSource) {
    coverId = `cover-${options.coverSource}`;
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
      `INSERT OR REPLACE INTO tracks (
        id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
        track_no, disc_no, year, genre, duration, codec, sample_rate, bit_depth, bitrate,
        cover_id, metadata_status, embedded_metadata_status, embedded_cover_status, network_metadata_status,
        field_sources_json, missing, created_at, updated_at
      ) VALUES (?, ?, 'folder-1', 1, 1, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 180, 'FLAC', 44100, 16, 1000,
        ?, 'ok', ?, ?, 'none', ?, 0, ?, ?)`,
    )
    .run(
      trackId,
      `C:/Music/${trackId}.flac`,
      options.title ?? 'Unknown Title',
      options.artist ?? 'Unknown Artist',
      options.album ?? '',
      options.artist ?? 'Unknown Artist',
      coverId,
      options.embeddedMetadataStatus ?? 'missing',
      options.embeddedCoverStatus ?? 'missing',
      JSON.stringify(options.fieldSources ?? baseSources()),
      now,
      now,
    );

  return trackId;
};

const seedCandidate = (database: EchoDatabase, trackId: string, score = 0.95): string => {
  const store = new NetworkMetadataStore(database);
  return store.upsertMetadataCandidate(
    trackId,
    null,
    {
      provider: 'mock',
      providerItemId: `candidate-${trackId}-${score}`,
      title: 'Network Title',
      artist: 'Network Artist',
      album: 'Network Album',
      albumArtist: 'Network Album Artist',
      year: 2025,
      genre: 'Ambient',
      duration: 180,
      trackNo: 7,
      discNo: 1,
      coverUrl: null,
      raw: { ok: true },
    },
    score,
  ).id;
};

const readTrack = (database: EchoDatabase, trackId: string): Record<string, unknown> =>
  database.prepare<[string], Record<string, unknown>>('SELECT * FROM tracks WHERE id = ?').get(trackId)!;

const coverResult = (sourceHash: string): CoverResult => ({
  source: 'network',
  sourceHash,
  mimeType: 'image/png',
  thumbPath: `C:/cache/${sourceHash}/thumb.webp`,
  albumPath: `C:/cache/${sourceHash}/album.webp`,
  largePath: `C:/cache/${sourceHash}/large.webp`,
  originalRef: `C:/cache/${sourceHash}/original.png`,
  warnings: [],
  errors: [],
});

describe('NetworkMetadataMerge', () => {
  it('does not write tracks while embedded metadata is pending or reading', () => {
    for (const status of ['pending', 'reading']) {
      const database = createDatabase(':memory:');
      const trackId = seedTrack(database, { embeddedMetadataStatus: status });
      const candidateId = seedCandidate(database, trackId);
      const result = new NetworkMetadataMerge(database).applyMissingOnly(candidateId);

      expect(result.reason).toBe('embedded_metadata_not_ready');
      expect(readTrack(database, trackId).title).toBe('Unknown Title');
      database.close();
    }
  });

  it('does not overwrite embedded title, artist, or album when embedded metadata is present', () => {
    const database = createDatabase(':memory:');
    const trackId = seedTrack(database, {
      embeddedMetadataStatus: 'present',
      title: 'Embedded Title',
      artist: 'Embedded Artist',
      album: 'Embedded Album',
      fieldSources: baseSources({ title: 'embedded', artist: 'embedded', album: 'embedded' }),
    });

    const result = new NetworkMetadataMerge(database).applyMissingOnly(seedCandidate(database, trackId));
    const track = readTrack(database, trackId);

    expect(result.reason).toBe('embedded_metadata_present');
    expect(track.title).toBe('Embedded Title');
    expect(track.artist).toBe('Embedded Artist');
    expect(track.album).toBe('Embedded Album');
    database.close();
  });

  it('protects embedded artist and embedded album even when applying selected', () => {
    const database = createDatabase(':memory:');
    const trackId = seedTrack(database, {
      embeddedMetadataStatus: 'error',
      artist: 'Embedded Artist',
      album: 'Embedded Album',
      fieldSources: baseSources({ artist: 'embedded', album: 'embedded' }),
    });

    new NetworkMetadataMerge(database).applyMissingOnly(seedCandidate(database, trackId), true);
    const track = readTrack(database, trackId);

    expect(track.artist).toBe('Embedded Artist');
    expect(track.album).toBe('Embedded Album');
    expect(track.title).toBe('Network Title');
    database.close();
  });

  it('blocks network covers while embedded cover is pending and protects embedded or folder covers', () => {
    for (const testCase of [
      { embeddedCoverStatus: 'pending', coverSource: 'default', reason: 'embedded_cover_not_ready' },
      { embeddedCoverStatus: 'present', coverSource: 'embedded', reason: 'cover_source_embedded_protected' },
      { embeddedCoverStatus: 'missing', coverSource: 'folder', reason: 'cover_source_folder_protected' },
    ]) {
      const database = createDatabase(':memory:');
      const trackId = seedTrack(database, testCase);
      const result = new NetworkMetadataMerge(database).applyCoverIfMissing(trackId, coverResult(`net-${testCase.reason}`), 0.96);

      expect(result.reason).toBe(testCase.reason);
      expect(readTrack(database, trackId).cover_id).toBe(`cover-${testCase.coverSource}`);
      database.close();
    }
  });

  it('replaces a default cover with high-score network cover', () => {
    const database = createDatabase(':memory:');
    const trackId = seedTrack(database, { coverSource: 'default', embeddedCoverStatus: 'missing' });
    const result = new NetworkMetadataMerge(database).applyCoverIfMissing(trackId, coverResult('network-cover'), 0.96);
    const track = readTrack(database, trackId);
    const cover = database.prepare<[string], { source_type: string }>('SELECT source_type FROM covers WHERE id = ?').get(String(track.cover_id));

    expect(result.appliedFields.coverId).toBeTruthy();
    expect(cover?.source_type).toBe('network');
    database.close();
  });

  it('does not auto apply below 0.92 and records applied_fields_json when accepted', () => {
    const database = createDatabase(':memory:');
    const trackId = seedTrack(database, { fieldSources: baseSources({ title: 'filename_fallback', artist: 'unknown' }) });
    const merge = new NetworkMetadataMerge(database);

    expect(merge.applyMissingOnly(seedCandidate(database, trackId, 0.91)).reason).toBe('score_below_auto_apply_threshold');
    const accepted = merge.applyMissingOnly(seedCandidate(database, trackId, 0.95));
    const decision = database.prepare('SELECT applied_fields_json FROM network_metadata_decisions WHERE track_id = ?').get(trackId) as {
      applied_fields_json: string;
    };

    expect(accepted.appliedFields.title).toBe('Network Title');
    expect(JSON.parse(decision.applied_fields_json)).toMatchObject({ title: 'Network Title', artist: 'Network Artist' });
    database.close();
  });

  it('hides rejected candidates from candidate lists and does not auto apply them again', () => {
    const database = createDatabase(':memory:');
    const trackId = seedTrack(database);
    const candidateId = seedCandidate(database, trackId);
    const merge = new NetworkMetadataMerge(database);

    merge.reject(candidateId);
    const second = merge.applyMissingOnly(candidateId);

    expect(second.status).toBe('rejected');
    expect(new NetworkMetadataStore(database).listTrackMetadataCandidates(trackId)).toHaveLength(0);
    database.close();
  });

  it('provider errors do not affect local library rows', async () => {
    const database = createDatabase(':memory:');
    const trackId = seedTrack(database, { title: 'Local Title' });
    const provider: NetworkMetadataProvider = {
      name: 'mock',
      async findMetadata() {
        throw new Error('provider down');
      },
    };

    const result = await new NetworkMetadataService(database, [provider]).repairMissingMetadata(trackId);

    expect(result.errors.join('\n')).toContain('provider down');
    expect(readTrack(database, trackId).title).toBe('Local Title');
    expect(readTrack(database, trackId).network_metadata_status).toBe('error');
    database.close();
  });

  it('high-confidence network can replace filename fallback and Unknown Artist fields', () => {
    const database = createDatabase(':memory:');
    const trackId = seedTrack(database, {
      title: 'File Guess',
      artist: 'Unknown Artist',
      fieldSources: baseSources({ title: 'filename_fallback', artist: 'unknown' }),
    });

    new NetworkMetadataMerge(database).applyMissingOnly(seedCandidate(database, trackId, 0.96));
    const track = readTrack(database, trackId);

    expect(track.title).toBe('Network Title');
    expect(track.artist).toBe('Network Artist');
    database.close();
  });
});
