import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../app/appSettings';
import { createDatabase } from '../database/createDatabase';
import { createLibraryService, type LibraryService } from './LibraryService';
import { LibraryStore } from './LibraryStore';
import { NetworkMetadataStore } from './network/NetworkMetadataStore';
import type { TrackWrite } from './libraryTypes';

const tempRoots: string[] = [];
let activeService: LibraryService | null = null;

const makeTempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'echo-album-index-'));
  tempRoots.push(root);
  return root;
};

const baseTrack = (folderId: string, filePath: string, overrides: Partial<TrackWrite> = {}): TrackWrite => ({
  id: 'track-1',
  path: filePath,
  folderId,
  sizeBytes: 1024,
  mtimeMs: 1,
  title: 'Indexed Song',
  artist: 'Indexed Artist',
  album: '',
  albumArtist: 'Indexed Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 180,
  codec: 'FLAC',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  bpm: null,
  replayGainTrackGainDb: null,
  replayGainAlbumGainDb: null,
  replayGainTrackPeak: null,
  replayGainAlbumPeak: null,
  replayGainIntegratedLufs: null,
  coverId: null,
  fieldSources: {
    title: 'embedded',
    artist: 'embedded',
    album: 'unknown',
    albumArtist: 'artist_fallback',
    codec: 'technical',
  },
  embeddedMetadataStatus: 'missing',
  embeddedCoverStatus: 'missing',
  metadataStatus: 'ok',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const seedTrack = (
  databasePath: string,
  root: string,
  overrides: Partial<TrackWrite> = {},
): { folderPath: string; trackPath: string } => {
  const folderPath = join(root, 'Music');
  mkdirSync(folderPath, { recursive: true });
  const trackPath = join(folderPath, 'song.flac');
  const database = createDatabase(databasePath);
  const store = new LibraryStore(database);
  const folder = store.addFolder(folderPath);
  store.upsertTrack(baseTrack(folder.id, trackPath, overrides));
  database.close();
  return { folderPath, trackPath };
};

const seedNetworkAlbumCandidate = (databasePath: string, trackId: string): string => {
  const database = createDatabase(databasePath);
  const networkStore = new NetworkMetadataStore(database);
  const candidate = networkStore.upsertMetadataCandidate(
    trackId,
    null,
    {
      provider: 'mock',
      providerItemId: `mock:${trackId}:album`,
      title: null,
      artist: null,
      album: 'Recovered Album',
      albumArtist: 'Recovered Album Artist',
      year: null,
      genre: null,
      duration: null,
      trackNo: null,
      discNo: null,
      coverUrl: null,
      raw: { test: true },
    },
    0.99,
  );
  database.close();
  return candidate.id;
};

const openService = (databasePath: string, root: string): LibraryService => {
  activeService = createLibraryService(databasePath, {
    appSettings: () => defaultSettings,
    coverCacheDir: join(root, 'covers'),
    artistImageCacheDir: join(root, 'artist-images'),
    artistImageProviders: [],
  });
  return activeService;
};

afterEach(() => {
  activeService?.close();
  activeService = null;
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('network metadata album indexing', () => {
  it('indexes a recovered album immediately after applying a metadata candidate without cover art', async () => {
    const root = makeTempRoot();
    const databasePath = join(root, 'library.sqlite');
    seedTrack(databasePath, root);
    const candidateId = seedNetworkAlbumCandidate(databasePath, 'track-1');
    const service = openService(databasePath, root);

    expect(service.getAlbumForTrack('track-1')).toBeNull();

    const result = await service.applyNetworkSelected(candidateId, { fields: ['album', 'albumArtist'] });

    expect(result).toMatchObject({
      status: 'applied_missing_only',
      appliedFields: {
        album: 'Recovered Album',
        albumArtist: 'Recovered Album Artist',
      },
    });
    expect(service.getAlbumForTrack('track-1')).toMatchObject({
      title: 'Recovered Album',
      albumArtist: 'Recovered Album Artist',
      trackCount: 1,
    });
    expect(service.getAlbums({ search: 'Recovered Album', pageSize: 10 }).total).toBe(1);
  });

  it('repairs orphaned album-track links with a global album grouping refresh', () => {
    const root = makeTempRoot();
    const databasePath = join(root, 'library.sqlite');
    seedTrack(databasePath, root, {
      album: 'Already Tagged Album',
      albumArtist: 'Already Tagged Artist',
      fieldSources: {
        title: 'embedded',
        artist: 'embedded',
        album: 'embedded',
        albumArtist: 'embedded',
        codec: 'technical',
      },
      embeddedMetadataStatus: 'present',
    });
    const service = openService(databasePath, root);

    expect(service.getAlbumForTrack('track-1')).toBeNull();

    service.refreshAlbumGrouping();

    expect(service.getAlbumForTrack('track-1')).toMatchObject({
      title: 'Already Tagged Album',
      albumArtist: 'Already Tagged Artist',
      trackCount: 1,
    });
  });
});
