import { describe, expect, it } from 'vitest';
import { parseCoverIdentity } from './coverIdentity';

describe('cover identity', () => {
  it.each([
    ['晴天（Cover. 周杰伦）', '晴天', null, '周杰伦'],
    ['晴天（cover 周杰伦）', '晴天', null, '周杰伦'],
    ['晴天 (翻唱 周杰伦)', '晴天', null, '周杰伦'],
    ['Echo Song (covered by Singer)', 'Echo Song', 'Singer', null],
    ['Echo Song - cover by Singer', 'Echo Song', 'Singer', null],
    ['Echo Song Cover', 'Echo Song', null, null],
    ['夜に駆ける【歌ってみた】', '夜に駆ける', null, null],
    ['夜に駆ける (カバー)', '夜に駆ける', null, null],
    ['晴天【翻唱】', '晴天', null, null],
    ['Echo Song (Live) (Cover)', 'Echo Song (Live)', null, null],
  ])('separates recording roles in %s', (input, title, performer, originalArtist) => {
    expect(parseCoverIdentity(input)).toEqual({ title, cover: true, performer, originalArtist });
  });

  it.each(['Cover Me', 'Undercover', 'Discover', 'Echo Song (Guest)', 'Live and Let Die'])('preserves song identity: %s', (title) => {
    expect(parseCoverIdentity(title)).toEqual({ title, cover: false, performer: null, originalArtist: null });
  });
});
