import { describe, expect, it } from 'vitest';
import {
  analyzePixelBuffer,
  contrastRatio,
  createReadableLyricsColorVars,
  parseHexColor,
  relativeLuminance,
  type ReadableColorSample,
} from './lyricsReadableColor';

const sampleFromRgb = (rgb: { r: number; g: number; b: number }, overrides: Partial<ReadableColorSample> = {}): ReadableColorSample => ({
  averageRgb: rgb,
  luminance: relativeLuminance(rgb),
  luminanceDeviation: 0.06,
  saturation: 0.14,
  edgeContrast: 0.02,
  complexity: 0.16,
  pixelCount: 64,
  ...overrides,
});

const rgbFromCss = (value: string | undefined): { r: number; g: number; b: number } => {
  const match = /^rgb\((\d+) (\d+) (\d+)\)$/u.exec(value ?? '');
  if (!match) {
    throw new Error(`Expected rgb() CSS color, received ${value}`);
  }

  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
  };
};

const channelSpread = (rgb: { r: number; g: number; b: number }): number =>
  Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);

describe('lyricsReadableColor', () => {
  it('uses dark readable text on white and light pink backgrounds', () => {
    const whiteSample = sampleFromRgb({ r: 252, g: 252, b: 250 });
    const pinkSample = sampleFromRgb({ r: 255, g: 214, b: 236 }, { saturation: 0.4, complexity: 0.24 });

    for (const sample of [whiteSample, pinkSample]) {
      const vars = createReadableLyricsColorVars({ sample, userColor: '#FFFFFF', themeMode: 'light' });
      const primary = rgbFromCss(vars['--lyrics-smart-primary-color']);

      expect(relativeLuminance(primary)).toBeLessThan(0.12);
      expect(contrastRatio(primary, sample.luminance)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps bright-background smart colors tinted instead of collapsing to black', () => {
    const pinkSample = sampleFromRgb({ r: 255, g: 214, b: 236 }, { saturation: 0.4, complexity: 0.24 });
    const vars = createReadableLyricsColorVars({ sample: pinkSample, userColor: '#FFFFFF', themeMode: 'light' });
    const primary = rgbFromCss(vars['--lyrics-smart-primary-color']);

    expect(relativeLuminance(primary)).toBeLessThan(0.16);
    expect(channelSpread(primary)).toBeGreaterThan(24);
    expect(contrastRatio(primary, pinkSample.luminance)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps soft bright backgrounds readable without pushing the active lyric to near black', () => {
    const lavenderSample = sampleFromRgb(
      { r: 220, g: 216, b: 236 },
      {
        luminanceP10: 0.62,
        luminanceP90: 0.82,
        luminanceDeviation: 0.08,
        saturation: 0.22,
        edgeContrast: 0.04,
        complexity: 0.22,
      },
    );
    const vars = createReadableLyricsColorVars({ sample: lavenderSample, userColor: '#314054', themeMode: 'light' });
    const primary = rgbFromCss(vars['--lyrics-smart-primary-color']);

    expect(relativeLuminance(primary)).toBeGreaterThan(0.035);
    expect(channelSpread(primary)).toBeGreaterThan(24);
    expect(contrastRatio(primary, lavenderSample.luminance)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses light readable text on black and deep blue backgrounds', () => {
    const blackSample = sampleFromRgb({ r: 5, g: 6, b: 8 });
    const blueSample = sampleFromRgb({ r: 14, g: 31, b: 62 }, { saturation: 0.6, complexity: 0.28 });

    for (const sample of [blackSample, blueSample]) {
      const vars = createReadableLyricsColorVars({ sample, userColor: '#314054', themeMode: 'dark' });
      const primary = rgbFromCss(vars['--lyrics-smart-primary-color']);

      expect(relativeLuminance(primary)).toBeGreaterThan(0.68);
      expect(contrastRatio(primary, sample.luminance)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps dark-background smart colors softly tinted instead of pure white', () => {
    const blueSample = sampleFromRgb({ r: 14, g: 31, b: 62 }, { saturation: 0.6, complexity: 0.28 });
    const vars = createReadableLyricsColorVars({ sample: blueSample, userColor: '#FFFFFF', themeMode: 'dark' });
    const primary = rgbFromCss(vars['--lyrics-smart-primary-color']);

    expect(relativeLuminance(primary)).toBeGreaterThan(0.68);
    expect(channelSpread(primary)).toBeGreaterThan(12);
    expect(contrastRatio(primary, blueSample.luminance)).toBeGreaterThanOrEqual(4.5);
  });

  it('raises shadow and scrim assistance on high-saturation complex backgrounds', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 110, 255, 20, 60, 255, 255,
      255, 255, 0, 255, 10, 10, 10, 255,
      30, 220, 160, 255, 255, 120, 0, 255,
      255, 255, 255, 255, 0, 0, 0, 255,
    ]);
    const complexSample = analyzePixelBuffer(pixels, { width: 4 })!;
    const simpleSample = sampleFromRgb({ r: 246, g: 248, b: 250 }, { complexity: 0.08 });
    const complexVars = createReadableLyricsColorVars({ sample: complexSample, userColor: '#FF8A80' });
    const simpleVars = createReadableLyricsColorVars({ sample: simpleSample, userColor: '#FF8A80' });

    expect(complexSample.complexity).toBeGreaterThan(0.45);
    expect(Number(complexVars['--lyrics-smart-scrim-opacity'])).toBeGreaterThan(Number(simpleVars['--lyrics-smart-scrim-opacity']));
    expect(complexVars['--lyrics-smart-stroke']).toContain('rgba');
    expect(complexVars['--lyrics-smart-shadow']).toContain('rgba');
  });

  it('prefers dark text with a local light scrim on mixed bright and dark backgrounds', () => {
    const mixedSample = sampleFromRgb(
      { r: 128, g: 132, b: 138 },
      {
        luminance: 0.42,
        luminanceP10: 0.02,
        luminanceP90: 0.94,
        luminanceDeviation: 0.38,
        saturation: 0.34,
        edgeContrast: 0.36,
        complexity: 0.88,
      },
    );

    const vars = createReadableLyricsColorVars({
      sample: mixedSample,
      userColor: '#FFFFFF',
      themeMode: 'dark',
    });
    const primary = rgbFromCss(vars['--lyrics-smart-primary-color']);
    const primaryLuminance = relativeLuminance(primary);
    const scrimOpacity = Number(vars['--lyrics-smart-scrim-opacity']);

    expect(primaryLuminance).toBeLessThan(0.12);
    expect(vars['--lyrics-smart-scrim-background']).toMatch(/^rgba\(255, 255, 255,/u);
    expect(scrimOpacity).toBeGreaterThanOrEqual(0.4);

    const darkRegionAfterScrim = mixedSample.luminanceP10! + (1 - mixedSample.luminanceP10!) * scrimOpacity;
    expect(contrastRatio(primaryLuminance, darkRegionAfterScrim)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(primaryLuminance, mixedSample.luminanceP90!)).toBeGreaterThanOrEqual(4.5);
  });

  it('returns a stable fallback when sampling fails or color input is invalid', () => {
    const vars = createReadableLyricsColorVars({ sample: null, userColor: 'not-a-color', themeMode: 'light' });
    const primary = rgbFromCss(vars['--lyrics-smart-primary-color']);

    expect(parseHexColor('not-a-color')).toBeNull();
    expect(contrastRatio(primary, relativeLuminance({ r: 244, g: 247, b: 251 }))).toBeGreaterThanOrEqual(4.5);
    expect(vars['--lyrics-smart-scrim-opacity']).toMatch(/^\d+\.\d{2}$/u);
  });
});
