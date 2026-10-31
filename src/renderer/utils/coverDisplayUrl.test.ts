import { describe, expect, it } from 'vitest';
import { largeCoverUrlFromCachedVariant, localCoverDisplayUrl } from './coverDisplayUrl';

describe('coverDisplayUrl', () => {
  it('uses the static large variant for local renderer artwork', () => {
    expect(localCoverDisplayUrl('cover 1')).toBe('echo-cover://large/cover%201');
    expect(largeCoverUrlFromCachedVariant('echo-cover://original/cover%201')).toBe('echo-cover://large/cover%201');
    expect(largeCoverUrlFromCachedVariant('echo-cover://thumb/cover%201')).toBe('echo-cover://large/cover%201');
  });

  it('does not rewrite remote or inline artwork as a local cover', () => {
    expect(localCoverDisplayUrl(null, 'https://example.com/cover.jpg')).toBeNull();
    expect(largeCoverUrlFromCachedVariant('data:image/png;base64,AAAA')).toBeNull();
  });
});
