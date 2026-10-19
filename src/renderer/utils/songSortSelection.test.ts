import { describe, expect, it } from 'vitest';
import { toggleSongMultiSort } from './songSortSelection';

describe('toggleSongMultiSort', () => {
  it('replaces artist or album keys when artist/album composite sort is selected', () => {
    expect(toggleSongMultiSort(['artist', 'yearDesc'], 'artistAlbum')).toEqual(['yearDesc', 'artistAlbum']);
    expect(toggleSongMultiSort(['albumDesc'], 'artistAlbum')).toEqual(['artistAlbum']);
  });

  it('drops the artist/album composite when a related artist or album sort is selected', () => {
    expect(toggleSongMultiSort(['artistAlbum'], 'artist')).toEqual(['artist']);
    expect(toggleSongMultiSort(['artistAlbum', 'yearDesc'], 'albumDesc')).toEqual(['yearDesc', 'albumDesc']);
  });

  it('still allows stacking separate artist and album keys', () => {
    expect(toggleSongMultiSort(['artist'], 'album')).toEqual(['artist', 'album']);
  });
});
