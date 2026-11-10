import type { CSSProperties } from 'react';
import { contrastRatio, type ReadableColorSample, type Rgb } from '../lyricsReadableColor';

type AfterglowCoverVar =
  | '--afterglow-cover-bg-rgb'
  | '--afterglow-cover-bar-rgb'
  | '--afterglow-cover-wash-rgb'
  | '--afterglow-cover-accent-rgb';

export type AfterglowCoverPalette = CSSProperties & Record<AfterglowCoverVar, string>;

const clampChannel = (value: number): number => Math.round(Math.max(0, Math.min(255, value)));
const channels = (color: Rgb): string => `${clampChannel(color.r)} ${clampChannel(color.g)} ${clampChannel(color.b)}`;
const mix = (left: Rgb, right: Rgb, amount: number): Rgb => ({
  r: left.r + (right.r - left.r) * amount,
  g: left.g + (right.g - left.g) * amount,
  b: left.b + (right.b - left.b) * amount,
});

const ink = { r: 9, g: 10, b: 13 };
const ivory = { r: 249, g: 245, b: 237 };
const fallbackAccent = { r: 236, g: 182, b: 119 };

/** Keep the stage dark and the sung-word accent readable for bright and dark covers alike. */
export const createAfterglowCoverPalette = (sample: ReadableColorSample | null): AfterglowCoverPalette => {
  const source = sample?.dominantRgb ?? sample?.averageRgb ?? fallbackAccent;
  const background = mix(source, ink, sample ? 0.88 : 0.92);
  const bar = mix(source, ink, sample ? 0.75 : 0.82);
  const wash = mix(source, ink, 0.52);
  const chroma = Math.max(source.r, source.g, source.b) - Math.min(source.r, source.g, source.b);
  const accentSource = chroma < 22 ? fallbackAccent : source;
  let accent = mix(accentSource, ivory, 0.43);
  if (contrastRatio(accent, background) < 4.5) {
    accent = mix(accent, ivory, 0.52);
  }

  return {
    '--afterglow-cover-bg-rgb': channels(background),
    '--afterglow-cover-bar-rgb': channels(bar),
    '--afterglow-cover-wash-rgb': channels(wash),
    '--afterglow-cover-accent-rgb': channels(accent),
  };
};
