import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { LibraryStore } from './LibraryStore';
import type { LibraryFolder, TrackWrite } from './libraryTypes';

let database: EchoDatabase | null = null;

const makeStore = (): LibraryStore => {
  database = createDatabase(':memory:');
  return new LibraryStore(database);
};

const baseTrack = (folder: LibraryFolder, id: string, overrides: Partial<TrackWrite> = {}): TrackWrite => ({
  id,
  path: `D:\\Music\\${id}.flac`,
  folderId: folder.id,
  sizeBytes: 1024,
  mtimeMs: 1,
  title: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 120,
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
    album: 'embedded',
    albumArtist: 'embedded',
    genre: 'embedded',
    codec: 'technical',
  },
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  metadataStatus: 'ok',
  updatedAt: '2026-05-20T00:00:00.000Z',
  ...overrides,
});

afterEach(() => {
  database?.close();
  database = null;
});

describe('LibraryStore new-songs inbox', () => {
  it('records scan batches by track id and serves paged issue filters', () => {
    const store = makeStore();
    const folder = store.addFolder('D:\\Music');
    const scan = store.createScanJob(folder.id);

    store.upsertTrack(baseTrack(folder, 'track-1'));
    store.upsertTrack(
      baseTrack(folder, 'track-2', {
        album: 'Unknown Album',
        metadataStatus: 'fallback',
        fieldSources: {
          title: 'filename_fallback',
          artist: 'embedded',
          album: 'unknown',
          albumArtist: 'artist_fallback',
        },
      }),
    );

    const batch = store.recordLibraryInboxBatch({
      scanJobId: scan.id,
      folder,
      trackIds: ['track-1', 'track-2'],
      createdAt: '2026-05-20T01:00:00.000Z',
      finishedAt: '2026-05-20T01:00:00.000Z',
    });

    expect(batch).toMatchObject({
      scanJobId: scan.id,
      folderId: folder.id,
      addedCount: 2,
      missingCoverCount: 2,
      metadataIssueCount: 1,
    });

    const firstPage = store.getLibraryInboxTracks({ page: 1, pageSize: 1 });
    expect(firstPage.total).toBe(2);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.facets.folders[0]).toMatchObject({ value: folder.id, count: 2 });
    expect(firstPage.story).toMatchObject({
      trackCount: 2,
      albumCount: 2,
      artistCount: 1,
      folderCount: 1,
      missingCoverCount: 2,
      metadataIssueCount: 1,
      unknownAlbumCount: 1,
      pendingCount: 2,
      processedCount: 0,
      ignoredCount: 0,
      coverCompleteness: 0,
      metadataCompleteness: 50,
    });
    expect(firstPage.items[0].inboxStatus).toBe('pending');
    expect(firstPage.albums.map((item) => item.album)).toEqual(expect.arrayContaining(['Album', 'Unknown Album']));

    const issuePage = store.getLibraryInboxTracks({ filter: 'metadata_issue', pageSize: 10 });
    expect(issuePage.total).toBe(1);
    expect(issuePage.items[0].track.id).toBe('track-2');
    expect(issuePage.items[0].reasons).toEqual(expect.arrayContaining(['metadata_fallback', 'unknown_album']));
  });

  it('tracks inbox item state without modifying tracks', () => {
    const store = makeStore();
    const folder = store.addFolder('D:\\Music');
    const scan = store.createScanJob(folder.id);

    store.upsertTrack(baseTrack(folder, 'track-1'));
    store.upsertTrack(baseTrack(folder, 'track-2'));
    const batch = store.recordLibraryInboxBatch({
      scanJobId: scan.id,
      folder,
      trackIds: ['track-1', 'track-2'],
      createdAt: '2026-05-20T01:00:00.000Z',
      finishedAt: '2026-05-20T01:00:00.000Z',
    });

    expect(batch).toBeTruthy();
    const result = store.updateLibraryInboxItemState({
      status: 'processed',
      items: [{ batchId: batch!.id, trackId: 'track-1' }],
    });

    expect(result).toMatchObject({ updatedCount: 1, matchedCount: 1, truncated: false });
    expect(store.getLibraryInboxTracks({ status: 'processed' }).items.map((item) => item.track.id)).toEqual(['track-1']);
    const pendingPage = store.getLibraryInboxTracks({ status: 'pending' });
    expect(pendingPage.items.map((item) => item.track.id)).toEqual(['track-2']);
    expect(pendingPage.story).toMatchObject({ pendingCount: 1, processedCount: 0 });

    store.updateLibraryInboxItemState({
      status: 'pending',
      items: [{ batchId: batch!.id, trackId: 'track-1' }],
    });

    expect(store.getLibraryInboxTracks({ status: 'pending' }).total).toBe(2);
  });

  it('returns bounded local queue tracks from the current inbox filter', () => {
    const store = makeStore();
    const folder = store.addFolder('D:\\Music');
    const scan = store.createScanJob(folder.id);
    const trackIds = Array.from({ length: 1005 }, (_value, index) => `track-${index + 1}`);

    for (const trackId of trackIds) {
      store.upsertTrack(baseTrack(folder, trackId));
    }

    store.recordLibraryInboxBatch({
      scanJobId: scan.id,
      folder,
      trackIds,
      createdAt: '2026-05-20T02:00:00.000Z',
      finishedAt: '2026-05-20T02:00:00.000Z',
    });

    const result = store.getLibraryInboxQueueTracks({ scope: 'latest' });

    expect(result.matchedCount).toBe(1005);
    expect(result.addedCount).toBe(1000);
    expect(result.skippedCount).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.tracks[0]).toMatchObject({ id: 'track-1', mediaType: 'local' });
  });

  it('caps playlist creation from a large inbox batch', () => {
    const store = makeStore();
    const folder = store.addFolder('D:\\Music');
    const scan = store.createScanJob(folder.id);
    const trackIds = Array.from({ length: 1005 }, (_value, index) => `track-${index + 1}`);

    for (const trackId of trackIds) {
      store.upsertTrack(baseTrack(folder, trackId));
    }

    store.recordLibraryInboxBatch({
      scanJobId: scan.id,
      folder,
      trackIds,
      createdAt: '2026-05-20T02:00:00.000Z',
      finishedAt: '2026-05-20T02:00:00.000Z',
    });

    const result = store.createPlaylistFromLibraryInbox({ scope: 'latest' });

    expect(result.matchedCount).toBe(1005);
    expect(result.addedCount).toBe(1000);
    expect(result.skippedCount).toBe(5);
    expect(result.truncated).toBe(true);
    expect(store.getPlaylist(result.playlist.id)?.itemCount).toBe(1000);
  });
});
