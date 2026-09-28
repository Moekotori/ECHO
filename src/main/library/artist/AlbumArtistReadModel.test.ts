import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../../database/createDatabase';
import {
  AlbumArtistReadModel,
  albumArtistCreditForNames,
  isAlbumArtistId,
} from './AlbumArtistReadModel';

const now = '2026-05-20T00:00:00.000Z';

let database: EchoDatabase | null = null;

const createModel = (): AlbumArtistReadModel => {
  database = createDatabase(':memory:');
  database
    .prepare('INSERT INTO folders (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('folder-1', 'D:\\Music', 'Music', now, now);
  return new AlbumArtistReadModel(database);
};

const insertTrack = (overrides: {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  playCount?: number;
  lastPlayedAt?: string | null;
}): void => {
  database!
    .prepare(
      `INSERT INTO tracks (
        id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
        duration, field_sources_json, play_count, last_played_at, missing, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      overrides.id,
      `D:\\Music\\${overrides.id}.flac`,
      'folder-1',
      1024,
      1,
      overrides.title ?? overrides.id,
      overrides.artist ?? 'Artist',
      overrides.album ?? 'Album',
      overrides.albumArtist ?? overrides.artist ?? 'Artist',
      180,
      '{}',
      overrides.playCount ?? 0,
      overrides.lastPlayedAt ?? null,
      0,
      now,
      now,
    );
};

const insertAlbum = (id: string, title: string, albumArtist: string, trackIds: string[]): void => {
  database!
    .prepare(
      `INSERT INTO albums (id, album_key, title, album_artist, year, track_count, duration, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, id, title, albumArtist, 2024, trackIds.length, trackIds.length * 180, now, now);
  const insertAlbumTrack = database!.prepare(
    'INSERT INTO album_tracks (album_id, track_id, disc_no, track_no, position) VALUES (?, ?, 1, ?, ?)',
  );
  trackIds.forEach((trackId, index) => {
    insertAlbumTrack.run(id, trackId, index + 1, index);
  });
};

afterEach(() => {
  database?.close();
  database = null;
});

describe('AlbumArtistReadModel', () => {
  it('keeps the full track credit instead of a primary-only album artist tag', () => {
    expect(albumArtistCreditForNames('2PM', '2PM/尹恩惠')).toBe('2PM/尹恩惠');
    expect(albumArtistCreditForNames('Ado', 'Ado feat. 初音ミク')).toBe('Ado feat. 初音ミク');
    expect(albumArtistCreditForNames('2PM/尹恩惠', '')).toBe('2PM/尹恩惠');
  });

  it('keeps collaboration credits as one artist instead of splitting them', () => {
    const model = createModel();
    insertTrack({
      id: 'duet',
      title: 'Duet Song',
      artist: '2PM/尹恩惠',
      album: 'Duet Album',
      albumArtist: '2PM',
      playCount: 7,
      lastPlayedAt: '2026-05-21T00:00:00.000Z',
    });
    insertTrack({ id: 'solo', title: 'Solo Song', artist: '2PM', album: 'Solo Album', albumArtist: '2PM', playCount: 1 });
    insertAlbum('album-duet', 'Duet Album', '2PM', ['duet']);
    insertAlbum('album-solo', 'Solo Album', '2PM', ['solo']);

    const page = model.getArtists({ pageSize: 20, sort: 'titleAsc' });
    const names = page.items.map((artist) => artist.name);

    expect(names).toEqual(['2PM', '2PM/尹恩惠']);
    expect(page.items.find((artist) => artist.name === '2PM/尹恩惠')).toMatchObject({ trackCount: 1, albumCount: 1 });
    expect(page.items.find((artist) => artist.name === '尹恩惠')).toBeUndefined();

    const byPlays = model.getArtists({ pageSize: 20, sort: 'playCountDesc' }).items.map((artist) => artist.name);
    expect(byPlays[0]).toBe('2PM/尹恩惠');

    const collaboration = page.items.find((artist) => artist.name === '2PM/尹恩惠');
    expect(collaboration && isAlbumArtistId(collaboration.id)).toBe(true);
    expect(model.getArtist(collaboration!.id)?.name).toBe('2PM/尹恩惠');
    expect(model.getArtistTracks(collaboration!.id).items.map((track) => track.title)).toEqual(['Duet Song']);
    expect(model.getArtistAlbums(collaboration!.id).items.map((album) => album.title)).toEqual(['Duet Album']);
  });

  it('falls back to the unsplit track artist when album artist is missing', () => {
    const model = createModel();
    insertTrack({ id: 'pile', title: 'Pile Song', artist: 'Alpha / Beta / Gamma', album: 'Pile Album', albumArtist: '' });

    const [artist] = model.getArtists({ pageSize: 10 }).items;

    expect(artist?.name).toBe('Alpha / Beta / Gamma');
    expect(artist?.trackCount).toBe(1);
  });
});
