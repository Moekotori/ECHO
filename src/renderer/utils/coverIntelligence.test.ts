// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { analyzeCoverPixels, readCoverIntelligenceEnabled, writeCoverIntelligenceEnabled } from './coverIntelligence';

const solidPixels = (colors: Array<[number, number, number, number]>): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([r, g, b, a], index) => {
    pixels[index * 4] = r;
    pixels[index * 4 + 1] = g;
    pixels[index * 4 + 2] = b;
    pixels[index * 4 + 3] = a;
  });
  return pixels;
};

describe('coverIntelligence', () => {
  it('keeps the feature disabled by default and persists opt-in locally', () => {
    window.localStorage.clear();

    expect(readCoverIntelligenceEnabled()).toBe(false);
    writeCoverIntelligenceEnabled(true);
    expect(readCoverIntelligenceEnabled()).toBe(true);
    writeCoverIntelligenceEnabled(false);
    expect(readCoverIntelligenceEnabled()).toBe(false);
  });

  it('classifies blue-heavy artwork as a cool palette', () => {
    const result = analyzeCoverPixels(
      solidPixels([
        [30, 70, 210, 255],
        [20, 130, 190, 255],
        [42, 92, 160, 255],
        [230, 236, 250, 255],
      ]),
      2,
      2,
      'cool',
      '2026-06-14T00:00:00.000Z',
    );

    expect(result?.temperature).toBe('cool');
    expect(result?.moodLabels).toContain('cool');
    expect(result?.dominantColor.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('classifies orange-heavy artwork as a warm palette', () => {
    const result = analyzeCoverPixels(
      solidPixels([
        [230, 82, 26, 255],
        [210, 130, 36, 255],
        [170, 78, 28, 255],
        [250, 210, 150, 255],
      ]),
      2,
      2,
      'warm',
      '2026-06-14T00:00:00.000Z',
    );

    expect(result?.temperature).toBe('warm');
    expect(result?.moodLabels).toContain('warm');
  });
});
