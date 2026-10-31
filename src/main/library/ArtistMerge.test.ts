import { describe, expect, it } from 'vitest';
import {
  artistMergeKeyForName,
  chooseArtistDisplayName,
  findArtistMergeKey,
  splitArtistCreditParts,
  type ArtistMergeExisting,
} from './ArtistMerge';

const existing = (name: string, key = artistMergeKeyForName(name, 'standard')): ArtistMergeExisting => ({
  key,
  name,
  trackIds: new Set<string>(),
  albumIds: new Set<string>(),
});

describe('ArtistMerge', () => {
  it('keeps conservative matching to punctuation, symbols, width, and case', () => {
    expect(artistMergeKeyForName('Aoi--', 'conservative')).toBe(artistMergeKeyForName('aoi', 'conservative'));
    expect(artistMergeKeyForName('25\u6642\u3001\u30ca\u30a4\u30c8\u30b3\u30fc\u30c9\u3067\u3002', 'conservative')).toBe(
      artistMergeKeyForName('25\u6642 \u30ca\u30a4\u30c8\u30b3\u30fc\u30c9\u3067', 'conservative'),
    );
    expect(artistMergeKeyForName('Aiobahn +81', 'conservative')).not.toBe(artistMergeKeyForName('Aiobahn', 'conservative'));
  });

  it('keeps spaced ampersand artist names intact while preserving clear collaboration separators', () => {
    expect(splitArtistCreditParts('MYTH & ROID')).toEqual(['MYTH & ROID']);
    expect(splitArtistCreditParts('MYTH \uff06 ROID')).toEqual(['MYTH \uff06 ROID']);
    expect(splitArtistCreditParts('Afterglow,FLOW')).toEqual(['Afterglow', 'FLOW']);
    expect(splitArtistCreditParts('2PM/\u5c39\u6069\u60e0')).toEqual(['2PM', '\u5c39\u6069\u60e0']);
    expect(splitArtistCreditParts('Aimer feat. milet')).toEqual(['Aimer', 'milet']);
    expect(splitArtistCreditParts('Aimer ft. milet')).toEqual(['Aimer', 'milet']);
    expect(splitArtistCreditParts('Aimer featuring milet')).toEqual(['Aimer', 'milet']);
  });

  it('lets standard matching merge safe suffix aliases without merging short typos', () => {
    expect(artistMergeKeyForName('Aiobahn +81', 'standard')).toBe(artistMergeKeyForName('Aiobahn', 'standard'));
    expect(artistMergeKeyForName('Artist - Topic', 'standard')).toBe(artistMergeKeyForName('artist', 'standard'));
    expect(artistMergeKeyForName('AIKA', 'standard')).not.toBe(artistMergeKeyForName('aiko', 'standard'));
  });

  it('uses high-threshold fuzzy matching only for long near-identical names', () => {
    const artists = [{ ...existing('Nightcord Project'), albumIds: new Set(['album-1']) }];
    expect(findArtistMergeKey('Nightcord Projct', artists, 'standard', { albumId: 'album-1' })).toBe(artists[0].key);
    expect(findArtistMergeKey('Nightcord Projct', artists, 'standard')).not.toBe(artists[0].key);
    expect(findArtistMergeKey('Daycore Project', artists, 'standard', { albumId: 'album-1' })).not.toBe(artists[0].key);
  });

  it('prefers cleaner display names inside a merged group', () => {
    expect(chooseArtistDisplayName('Aoi--', 'Aoi')).toBe('Aoi');
    expect(chooseArtistDisplayName('Aiobahn +81', 'Aiobahn')).toBe('Aiobahn');
  });
});
