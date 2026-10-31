import { describe, expect, it } from 'vitest';
import { AlbumService, type AlbumKeyInput } from './AlbumService';

const makeInput = (overrides: Partial<AlbumKeyInput> = {}): AlbumKeyInput => ({
  albumTitle: 'Same Album',
  albumArtist: 'Track Artist',
  fallbackArtist: 'Track Artist',
  albumArtistSource: 'artist_fallback',
  year: 2024,
  filePath: 'D:\\Music\\disc-a\\A.flac',
  trackId: 'track-a',
  coverSourceHash: 'same-cover',
  mergeStrategy: 'standard',
  ...overrides,
});

describe('AlbumService', () => {
  it('standard strategy keeps same title and cover split by folder when albumArtist is not reliable', () => {
    const service = new AlbumService();
    const first = service.makeAlbumKey(makeInput());
    const second = service.makeAlbumKey(makeInput({ filePath: 'D:\\Other\\disc-b\\B.flac', trackId: 'track-b' }));

    expect(first).not.toBe(second);
  });

  it('standard strategy merges disc-number subfolders under the same album folder when albumArtist is not reliable', () => {
    const service = new AlbumService();
    const first = service.makeAlbumKey(makeInput({ filePath: 'D:\\Music\\Pink Floyd\\The Dark Side Of The Moon\\disc1\\A.flac' }));
    const second = service.makeAlbumKey(
      makeInput({
        filePath: 'D:\\Music\\Pink Floyd\\The Dark Side Of The Moon\\Disc 2\\B.flac',
        trackId: 'track-b',
      }),
    );

    expect(first).toBe(second);
  });

  it('standard strategy keeps disc-number subfolders split when their parent album folders differ', () => {
    const service = new AlbumService();
    const first = service.makeAlbumKey(makeInput({ filePath: 'D:\\Music\\Album One\\disc1\\A.flac' }));
    const second = service.makeAlbumKey(
      makeInput({
        filePath: 'D:\\Music\\Album Two\\disc1\\B.flac',
        trackId: 'track-b',
      }),
    );

    expect(first).not.toBe(second);
  });

  it('sameTitleAndCover strategy merges same title and cover across folder and artist differences', () => {
    const service = new AlbumService();
    const first = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover' }));
    const second = service.makeAlbumKey(
      makeInput({
        albumArtist: 'Other Album Artist',
        fallbackArtist: 'Other Artist',
        filePath: 'D:\\Other\\disc-b\\B.flac',
        trackId: 'track-b',
        mergeStrategy: 'sameTitleAndCover',
      }),
    );

    expect(first).toBe(second);
  });

  it('sameTitleAndCover strategy merges same title even when covers differ', () => {
    const service = new AlbumService();
    const first = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover', coverSourceHash: 'cover-a' }));
    const second = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover', coverSourceHash: 'cover-b' }));

    expect(first).toBe(second);
  });

  it('sameTitleAndCover strategy treats normalized title punctuation as the same album', () => {
    const service = new AlbumService();
    const first = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover', albumTitle: '28／29', coverSourceHash: null }));
    const second = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover', albumTitle: '28/29', coverSourceHash: null }));

    expect(first).toBe(second);
  });

  it('sameTitleAndCover strategy does not merge different album titles', () => {
    const service = new AlbumService();
    const first = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover', albumTitle: 'Album One' }));
    const second = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover', albumTitle: 'Album Two' }));

    expect(first).not.toBe(second);
  });

  it('sameTitleAndCover strategy keeps empty and Unknown Album tracks split by track id', () => {
    const service = new AlbumService();
    const emptyFirst = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover', albumTitle: '', trackId: 'track-a' }));
    const emptySecond = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover', albumTitle: '', trackId: 'track-b' }));
    const unknownFirst = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover', albumTitle: 'Unknown Album', trackId: 'track-c' }));
    const unknownSecond = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover', albumTitle: 'Unknown Album', trackId: 'track-d' }));

    expect(emptyFirst).not.toBe(emptySecond);
    expect(unknownFirst).not.toBe(unknownSecond);
  });

  it('sameTitleAndCover strategy merges same title when cover hash is missing', () => {
    const service = new AlbumService();
    const first = service.makeAlbumKey(makeInput({ mergeStrategy: 'sameTitleAndCover', coverSourceHash: null }));
    const second = service.makeAlbumKey(
      makeInput({
        mergeStrategy: 'sameTitleAndCover',
        coverSourceHash: null,
        filePath: 'D:\\Other\\disc-b\\B.flac',
        trackId: 'track-b',
      }),
    );

    expect(first).toBe(second);
  });
});
