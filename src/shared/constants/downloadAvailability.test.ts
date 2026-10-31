import { describe, expect, it } from 'vitest';
import { assertMusicDownloadsEnabled, musicDownloadsEnabled, musicDownloadsDisabledMessage } from './downloadAvailability';

describe('music download availability', () => {
  it('keeps music downloads disabled in the shipped policy', () => {
    expect(musicDownloadsEnabled).toBe(false);
    expect(assertMusicDownloadsEnabled).toThrow(musicDownloadsDisabledMessage);
  });
});
