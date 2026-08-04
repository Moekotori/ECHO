import { describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../../database/createDatabase';
import type { FieldSources } from '../libraryTypes';
import type { NetworkMetadataProvider } from './NetworkMetadataProvider';
import { NetworkMetadataService } from './NetworkMetadataService';
import type { NetworkTrackLookup } from './networkTypes';

const now = '2026-05-12T00:00:00.000Z';

const sources = (overrides: Partial<FieldSources> = {}): FieldSources => ({
  title: 'embedded',
  artist: 'embedded',
  album: 'embedded',
  albumArtist: 'embedded',
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

const insertTrack = (database: EchoDatabase): string => {
  database
    .prepare(
      `INSERT OR IGNORE INTO folders (id, path, name, status, enabled, created_at, updated_at)
       VALUES ('folder', 'C:/Music', 'Music', 'active', 1, ?, ?)`,
    )
    .run(now, now);

  database
    .prepare(
      `INSERT INTO tracks (
        id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
        duration, codec, sample_rate, bit_depth, bitrate, cover_id, metadata_status,
        embedded_metadata_status, embedded_cover_status, network_metadata_status,
        field_sources_json, missing, created_at, updated_at
      ) VALUES ('track', 'C:/Music/Local Song.flac', 'folder', 1, 1, 'Local Song', 'Local Artist', 'Local Album', 'Local Artist',
        180, 'FLAC', 44100, 16, 1000, NULL, 'ok',
        'present', 'missing', 'none', ?, 0, ?, ?)`,
    )
    .run(JSON.stringify(sources()), now, now);

  return 'track';
};

describe('Network tag candidates', () => {
  it('passes current title, artist, filename, and duration into provider search', async () => {
    const database = db();
    const trackId = insertTrack(database);
    let received: NetworkTrackLookup | null = null;
    const provider: NetworkMetadataProvider = {
      name: 'mock',
      async findMetadata(track) {
        received = track;
        return [];
      },
    };

    await new NetworkMetadataService(database, [provider]).searchNetworkTagCandidates({ trackId, providers: ['mock'] });

    expect(received).toMatchObject({
      title: 'Local Song',
      artist: 'Local Artist',
      filename: 'Local Song.flac',
      duration: 180,
    });
    database.close();
  });

  it('sorts tag editor candidates by confidence', async () => {
    const database = db();
    const trackId = insertTrack(database);
    const provider: NetworkMetadataProvider = {
      name: 'mock',
      async findMetadata() {
        return [
          {
            provider: 'mock',
            providerItemId: 'weak',
            title: 'Local Song',
            artist: 'Other Artist',
            album: 'Other Album',
            albumArtist: 'Other Artist',
            year: null,
            genre: null,
            duration: 240,
            trackNo: null,
            discNo: null,
            coverUrl: null,
            raw: {},
          },
          {
            provider: 'mock',
            providerItemId: 'strong',
            title: 'Local Song',
            artist: 'Local Artist',
            album: 'Local Album',
            albumArtist: 'Local Artist',
            year: null,
            genre: null,
            duration: 180,
            trackNo: null,
            discNo: null,
            coverUrl: 'https://example.test/cover.jpg',
            raw: {},
          },
        ];
      },
    };

    const candidates = await new NetworkMetadataService(database, [provider]).searchNetworkTagCandidates({ trackId, providers: ['mock'] });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ title: 'Local Song', artist: 'Local Artist', coverPreviewUrl: 'https://example.test/cover.jpg' });
    expect(candidates[0].confidence).toBeGreaterThan(candidates[1].confidence);
    database.close();
  });

  it('returns a friendly provider unavailable error when every provider fails', async () => {
    const database = db();
    const trackId = insertTrack(database);
    const provider: NetworkMetadataProvider = {
      name: 'mock',
      async findMetadata() {
        throw new Error('rate limited');
      },
    };

    await expect(new NetworkMetadataService(database, [provider]).searchNetworkTagCandidates({ trackId, providers: ['mock'] })).rejects.toThrow(
      '网络来源暂时不可用，请稍后再试。',
    );
    database.close();
  });
});
