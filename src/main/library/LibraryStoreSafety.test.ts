import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { AlbumService } from './AlbumService';
import { LibraryStore } from './LibraryStore';
import type { TrackWrite } from './libraryTypes';

let database: EchoDatabase | null = null;

const makeStore = (): LibraryStore => {
  database = createDatabase(':memory:');
  return new LibraryStore(database);
};

const baseTrack = (folderId: string, path: string, overrides: Partial<TrackWrite> = {}): TrackWrite => ({
  id: 'track-1',
  path,
  folderId,
  sizeBytes: 1024,
  mtimeMs: 1,
  title: 'Safe Title',
  artist: 'Safe Artist',
  album: 'Safe Album',
  albumArtist: 'Safe Artist',
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
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

afterEach(() => {
  database?.close();
  database = null;
});

describe('LibraryStore track metadata safety', () => {
  it('sanitizes unsafe track text before writing and when reading stale rows', () => {
    const store = makeStore();
    const folder = store.addFolder('D:\\Music');
    const path = 'D:\\Music\\Bad Artist - Bad Title.flac';
    const badText = `\u0000APIC image/jpeg Front cover JFIF ${'x'.repeat(4096)}`;

    store.upsertTrack(baseTrack(folder.id, path, {
      title: badText,
      artist: badText,
      album: badText,
      albumArtist: badText,
      genre: badText,
      codec: badText,
    }));

    const written = store.getTrack('track-1');
    expect(written).toMatchObject({
      title: 'Bad Title',
      artist: 'Bad Artist',
      album: '',
      albumArtist: 'Bad Artist',
      genre: null,
      codec: null,
    });
    expect(store.getTracks({ search: 'APIC', pageSize: 10 }).total).toBe(0);
    expect(store.getTracks({ search: 'Bad Title', pageSize: 10 }).total).toBe(1);

    database!.prepare(
      `UPDATE tracks
       SET title = ?, artist = ?, album = ?, album_artist = ?, genre = ?, codec = ?
       WHERE id = ?`,
    ).run(badText, badText, badText, badText, badText, badText, 'track-1');

    const readBack = store.getTrack('track-1');
    expect(readBack).toMatchObject({
      title: 'Bad Title',
      artist: 'Bad Artist',
      album: '',
      albumArtist: 'Bad Artist',
      genre: null,
      codec: null,
    });
  });

  it('backfills Japanese romaji search terms for existing tracks', async () => {
    const store = makeStore();
    const folder = store.addFolder('D:\\Music');
    const path = 'D:\\Music\\Japanese.flac';

    store.upsertTrack(baseTrack(folder.id, path, {
      title: '君が好き',
      artist: 'Echo Artist',
    }));

    expect(store.getTracks({ search: 'kimi', pageSize: 10 }).total).toBe(0);
    expect(await store.rebuildJapaneseRomanizedSearchTerms()).toBe(1);

    const page = store.getTracks({ search: 'kimi', pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0]?.title).toBe('君が好き');
  });

  it('sanitizes stale album and artist rows before returning them to the renderer', () => {
    const store = makeStore();
    const folder = store.addFolder('D:\\Music');
    const path = 'D:\\Music\\Safe Artist - Safe Title.flac';
    const badText = `APIC image/jpeg Front cover JFIF ${'x'.repeat(4096)}`;

    store.upsertTrack(baseTrack(folder.id, path));
    store.refreshAlbums(new AlbumService(), '2026-01-01T00:00:00.000Z');
    store.refreshArtists();
    database!.prepare('UPDATE albums SET title = ?, album_artist = ?').run(badText, badText);
    database!.prepare('UPDATE artists SET name = ?, sort_name = ?').run(badText, badText);

    expect(store.getAlbums({ pageSize: 1 }).items[0]).toMatchObject({
      title: '',
      albumArtist: 'Unknown Artist',
    });
    expect(store.getArtists({ pageSize: 1 }).items[0]).toMatchObject({
      name: 'Unknown Artist',
      sortName: 'Unknown Artist',
    });
  });

  it('keeps numeric slash artists intact while still splitting collaborations', () => {
    const store = makeStore();
    const folder = store.addFolder('D:\\Music');

    store.upsertTrack(baseTrack(folder.id, 'D:\\Music\\numeric.flac', {
      id: 'track-numeric',
      title: 'Numeric Slash Song',
      artist: '22/7',
      album: 'Numeric Slash Album',
      albumArtist: '22/7',
    }));
    store.upsertTrack(baseTrack(folder.id, 'D:\\Music\\collab.flac', {
      id: 'track-collab',
      title: 'Collab Song',
      artist: 'The Weeknd/Daft Punk',
      album: 'Collab Album',
      albumArtist: 'The Weeknd/Daft Punk',
    }));
    store.upsertTrack(baseTrack(folder.id, 'D:\\Music\\feat-dot.flac', {
      id: 'track-feat-dot',
      title: 'Feat Dot Song',
      artist: 'Aimer feat. milet',
      album: 'Feat Dot Album',
      albumArtist: 'Aimer feat. milet',
    }));
    store.refreshAlbums(new AlbumService(), '2026-01-01T00:00:00.000Z');
    store.refreshArtists();

    const artists = store.getArtists({ pageSize: 20 }).items;
    const artistNames = artists.map((artist) => artist.name);
    const numericArtist = artists.find((artist) => artist.name === '22/7')!;
    const miletArtist = artists.find((artist) => artist.name === 'milet')!;

    expect(artistNames).toContain('22/7');
    expect(artistNames).not.toContain('22');
    expect(artistNames).not.toContain('7');
    expect(artistNames).toContain('The Weeknd');
    expect(artistNames).toContain('Daft Punk');
    expect(artistNames).not.toContain('The Weeknd/Daft Punk');
    expect(artistNames).toContain('Aimer');
    expect(artistNames).toContain('milet');
    expect(artistNames).not.toContain('Aimer feat. milet');
    expect(store.getArtistTracks(numericArtist.id, { pageSize: 10 }).items.map((track) => track.title)).toEqual(['Numeric Slash Song']);
    expect(store.getArtistTracks(miletArtist.id, { pageSize: 10 }).items.map((track) => track.title)).toEqual(['Feat Dot Song']);
    expect(store.getArtistAlbums(miletArtist.id, { pageSize: 10 }).items.map((album) => album.title)).toEqual(['Feat Dot Album']);
  });

  it('filters filename track numbers out of the artist index', () => {
    const store = makeStore();
    const folder = store.addFolder('D:\\Music');
    const suzuki = '\u9234\u6728\u3053\u306e\u307f';
    const kanade = '\u5bb5\u5d0e\u594f (\u6960\u6728\u3068\u3082\u308a)';

    store.upsertTrack(baseTrack(folder.id, 'D:\\Music\\02 - Track Number Only.wav', {
      id: 'track-number-only',
      title: 'Track Number Only',
      artist: '02',
      album: 'Number Album',
      albumArtist: '02',
      fieldSources: {
        artist: 'filename_fallback',
        albumArtist: 'artist_fallback',
      },
    }));
    store.upsertTrack(baseTrack(folder.id, `D:\\Music\\02. ${suzuki} - Delighting.wav`, {
      id: 'track-indexed-dotted',
      title: 'Delighting',
      artist: `02. ${suzuki}`,
      album: 'Indexed Album',
      albumArtist: `02. ${suzuki}`,
      fieldSources: {
        artist: 'filename_fallback',
        albumArtist: 'artist_fallback',
      },
    }));
    store.upsertTrack(baseTrack(folder.id, `D:\\Music\\001-${kanade} - Mirai.wav`, {
      id: 'track-indexed-compact',
      title: 'Mirai',
      artist: `001-${kanade}`,
      album: 'Compact Album',
      albumArtist: `001-${kanade}`,
      fieldSources: {
        artist: 'filename_fallback',
        albumArtist: 'artist_fallback',
      },
    }));
    store.upsertTrack(baseTrack(folder.id, 'D:\\Music\\164 - Amanojaku.flac', {
      id: 'track-numeric-real',
      title: 'Amanojaku',
      artist: '164/GUMI',
      album: 'Real Numeric Artist',
      albumArtist: '164/GUMI',
    }));
    store.refreshAlbums(new AlbumService(), '2026-01-01T00:00:00.000Z');
    store.refreshArtists();

    const artistNames = store.getArtists({ pageSize: 20 }).items.map((artist) => artist.name);
    const suzukiArtist = store.getArtists({ search: suzuki, pageSize: 1 }).items[0];

    expect(artistNames).not.toContain('02');
    expect(artistNames).not.toContain(`02. ${suzuki}`);
    expect(artistNames).not.toContain(`001-${kanade}`);
    expect(artistNames).toEqual(expect.arrayContaining([suzuki, kanade, '164', 'GUMI']));
    expect(store.getArtistTracks(suzukiArtist.id, { pageSize: 10 }).items.map((track) => track.title)).toEqual(['Delighting']);
  });

  it('counts only available tracks when paging album detail tracks', () => {
    const store = makeStore();
    const folder = store.addFolder('D:\\Music');

    store.upsertTrack(baseTrack(folder.id, 'D:\\Music\\one.flac', { id: 'track-1', title: 'One', trackNo: 1 }));
    store.upsertTrack(baseTrack(folder.id, 'D:\\Music\\two.flac', { id: 'track-2', title: 'Two', trackNo: 2 }));
    store.refreshAlbums(new AlbumService(), '2026-01-01T00:00:00.000Z');

    const album = store.getAlbums({ pageSize: 1 }).items[0];
    database!.prepare('UPDATE tracks SET missing = 1 WHERE id = ?').run('track-2');

    const tracks = store.getAlbumTracks(album.id, { page: 1, pageSize: 10 });

    expect(tracks.total).toBe(1);
    expect(tracks.hasMore).toBe(false);
    expect(tracks.items.map((track) => track.id)).toEqual(['track-1']);
  });

  it('seeds album rows for newly scanned tracks before the full grouping refresh runs', () => {
    const store = makeStore();
    const folder = store.addFolder('D:\\Music');
    const albumService = new AlbumService();

    store.upsertTrack(baseTrack(folder.id, 'D:\\Music\\one.flac', { id: 'track-1', title: 'One', trackNo: 1 }));

    expect(store.getAlbums({ pageSize: 10 }).total).toBe(0);

    store.seedAlbumsForTracks(['track-1'], albumService, '2026-01-01T00:00:00.000Z');

    const seededAlbum = store.getAlbums({ pageSize: 10 }).items[0];
    expect(seededAlbum).toMatchObject({
      title: 'Safe Album',
      albumArtist: 'Safe Artist',
      trackCount: 1,
    });
    expect(store.getAlbumTracks(seededAlbum.id, { pageSize: 10 }).items.map((track) => track.id)).toEqual(['track-1']);

    store.upsertTrack(baseTrack(folder.id, 'D:\\Music\\two.flac', { id: 'track-2', title: 'Two', trackNo: 2 }));
    store.seedAlbumsForTracks(['track-2'], albumService, '2026-01-01T00:00:01.000Z');

    expect(store.getAlbums({ pageSize: 10 }).items[0]).toMatchObject({
      title: 'Safe Album',
      trackCount: 2,
      duration: 240,
    });
    expect(store.getFolderOverviews()[0]).toMatchObject({ albumCount: 1, trackCount: 2 });
  });
});
