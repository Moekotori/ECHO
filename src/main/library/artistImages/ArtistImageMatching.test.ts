import { describe, expect, it } from 'vitest';
import {
  ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE,
  artistImageConfidence,
  normalizeArtistImageName,
} from './ArtistImageMatching';

describe('artist image matching', () => {
  it('normalizes width, casing, and extra whitespace for artist names', () => {
    expect(normalizeArtistImageName('  Ａｉｍｅｒ  ')).toBe('aimer');
    expect(normalizeArtistImageName('周   杰倫')).toBe('周 杰倫');
  });

  it('assigns automatic-match confidence to exact normalized names', () => {
    expect(artistImageConfidence('Aimer', 'ＡＩＭＥＲ')).toBeGreaterThanOrEqual(ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
    expect(artistImageConfidence('米津玄師', '米津玄師')).toBeGreaterThanOrEqual(ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
  });

  it('keeps short and numeric names below the automatic-match threshold', () => {
    expect(artistImageConfidence('A', 'A')).toBeLessThan(ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
    expect(artistImageConfidence('12', '12')).toBeLessThan(ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
  });

  it('does not auto-match loose contains results', () => {
    expect(artistImageConfidence('Flow', 'Flowing Lights')).toBeLessThan(ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
  });
});
