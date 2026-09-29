import { describe, expect, it } from 'vitest';
import { highResolutionCoverUrl } from './HighResolutionCover';

describe('highResolutionCoverUrl', () => {
  it('requests the original NetEase cover art without a resize parameter', () => {
    expect(highResolutionCoverUrl('netease-cloud-music', 'https://p.music.126.net/abc.jpg?param=300y300')).toBe(
      'https://p.music.126.net/abc.jpg',
    );
  });

  it('requests the original QQ Music album art instead of a fixed-size resize', () => {
    expect(highResolutionCoverUrl('qq-music', 'https://y.gtimg.cn/music/photo_new/T002R300x300M000abc.jpg')).toBe(
      'https://y.gtimg.cn/music/photo_new/T002R500x500M000abc.jpg',
    );
  });

  it('uses the original Cover Art Archive endpoint instead of the thumbnail endpoint', () => {
    expect(highResolutionCoverUrl('musicbrainz', 'https://coverartarchive.org/release/abc/front-250')).toBe(
      'https://coverartarchive.org/release/abc/front',
    );
  });
});
