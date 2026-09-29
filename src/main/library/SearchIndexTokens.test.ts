import { describe, expect, it } from 'vitest';
import { buildFtsSearchQuery } from './LibraryStore';
import { buildTrackSearchTerms, buildTrackSearchTermsAsync } from './SearchIndexTokens';

const baseFields = {
  artist: 'Echo Artist',
  album: 'Echo Album',
  albumArtist: 'Echo Artist',
};

describe('buildTrackSearchTerms', () => {
  it('adds Chinese grams, full pinyin, and pinyin initials', () => {
    const terms = buildTrackSearchTerms({
      ...baseFields,
      title: '\u4f1a\u9b54\u6cd5\u7684\u8001\u4eba',
    }).split(' ');

    expect(terms).toEqual(expect.arrayContaining(['\u9b54\u6cd5', '\u8001\u4eba', 'mofa', 'laoren', 'hmf']));
  });

  it('normalizes punctuation and path tokens without requiring a full path scan', () => {
    const terms = buildTrackSearchTerms({
      ...baseFields,
      title: 'Bootleg Live Take',
      path: 'D:\\Music\\Bootleg-Live-Take.flac',
    }).split(' ');

    expect(terms).toEqual(expect.arrayContaining(['bootleg', 'live', 'take', 'bootleglivetake']));
  });

  it('adds Japanese romaji tokens for kana and kanji titles', async () => {
    const terms = (await buildTrackSearchTermsAsync({
      ...baseFields,
      title: '\u541b\u304c\u597d\u304d',
    })).split(' ');
    const singleKanjiTerms = (await buildTrackSearchTermsAsync({
      ...baseFields,
      title: '\u541b',
    })).split(' ');

    expect(terms).toEqual(expect.arrayContaining(['kimi', 'suki', 'kimigasuki', 'kgs', '\u304d\u307f', '\u30ad\u30df']));
    expect(singleKanjiTerms).toContain('kimi');
  });

  it('adds practical romaji variants for long vowels and particles', async () => {
    const tokyoTerms = (await buildTrackSearchTermsAsync({
      ...baseFields,
      title: '\u6771\u4eac',
    })).split(' ');
    const particleTerms = (await buildTrackSearchTermsAsync({
      ...baseFields,
      title: '\u304d\u3087\u3046\u306f\u541b\u3078',
    })).split(' ');
    const apostropheTerms = (await buildTrackSearchTermsAsync({
      ...baseFields,
      title: '\u65b0\u4e00',
    })).split(' ');

    expect(tokyoTerms).toEqual(expect.arrayContaining(['tokyo', '\u3068\u3046\u304d\u3087\u3046', '\u30c8\u30a6\u30ad\u30e7\u30a6']));
    expect(particleTerms).toEqual(expect.arrayContaining(['kyo', 'wa', 'kimi', 'e', 'kyowakimie', 'kwke']));
    expect(apostropheTerms).toEqual(expect.arrayContaining(['shin', 'ichi', 'shinichi']));
  });
});

describe('buildFtsSearchQuery', () => {
  it('escapes FTS syntax terms and expands cross-script Chinese variants', () => {
    expect(buildFtsSearchQuery('magic OR "live"')).toBe('magic* AND "OR" AND live*');
    expect(buildFtsSearchQuery('\u7231\u4e0e\u68a6')).toContain('\u611b\u8207\u5922*');
  });

  it('honors the cross-script search switch', () => {
    expect(buildFtsSearchQuery('\u7231\u4e0e\u68a6', { chineseCrossScriptSearchEnabled: false })).toBe('\u7231\u4e0e\u68a6*');
  });
});
