export type Rgb = {
  r: number;
  g: number;
  b: number;
};

export type ReadableColorSample = {
  averageRgb: Rgb;
  dominantRgb?: Rgb;
  luminance: number;
  luminanceP10?: number;
  luminanceP90?: number;
  luminanceDeviation: number;
  saturation: number;
  edgeContrast: number;
  complexity: number;
  pixelCount: number;
};

export const readableLyricsCssVarNames = [
  '--lyrics-smart-primary-color',
  '--lyrics-smart-secondary-color',
  '--lyrics-smart-shadow',
  '--lyrics-smart-stroke',
  '--lyrics-smart-scrim-color',
  '--lyrics-smart-scrim-background',
  '--lyrics-smart-scrim-opacity',
] as const;

export type ReadableLyricsCssVarName = (typeof readableLyricsCssVarNames)[number];
export type ReadableLyricsCssVars = Partial<Record<ReadableLyricsCssVarName, string>>;

type ReadableColorOptions = {
  sample?: ReadableColorSample | null;
  userColor?: string | null;
  themeMode?: 'light' | 'dark';
};

type AnalyzePixelsOptions = {
  width?: number;
  maxSamples?: number;
};

const sampleCanvasSize = 32;
const minReadableContrast = 4.5;
const strongReadableContrast = 7;
const nearlyBlack = { r: 8, g: 12, b: 18 };
const pureWhite = { r: 255, g: 255, b: 255 };

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const roundChannel = (value: number): number => Math.round(clamp(value, 0, 255));

const toCssRgb = (rgb: Rgb): string => `rgb(${roundChannel(rgb.r)} ${roundChannel(rgb.g)} ${roundChannel(rgb.b)})`;

const rgba = (rgb: Rgb, alpha: number): string =>
  `rgba(${roundChannel(rgb.r)}, ${roundChannel(rgb.g)}, ${roundChannel(rgb.b)}, ${clamp(alpha, 0, 1).toFixed(2)})`;

export const parseHexColor = (value: string | null | undefined): Rgb | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const short = /^#([0-9a-f]{3})$/iu.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split('').map((channel) => parseInt(`${channel}${channel}`, 16));
    return { r, g, b };
  }

  const full = /^#([0-9a-f]{6})$/iu.exec(trimmed);
  if (!full) {
    return null;
  }

  const raw = full[1];
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
};

const srgbToLinear = (value: number): number => {
  const normalized = clamp(value, 0, 255) / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (rgb: Rgb): number =>
  0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);

export const contrastRatio = (left: Rgb | number, right: Rgb | number): number => {
  const leftLuminance = typeof left === 'number' ? left : relativeLuminance(left);
  const rightLuminance = typeof right === 'number' ? right : relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

const rgbToHsl = (rgb: Rgb): { h: number; s: number; l: number } => {
  const r = clamp(rgb.r, 0, 255) / 255;
  const g = clamp(rgb.g, 0, 255) / 255;
  const b = clamp(rgb.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }

  return { h: h * 60, s, l };
};

const hueToRgb = (p: number, q: number, t: number): number => {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
};

const hslToRgb = (h: number, s: number, l: number): Rgb => {
  const hue = ((h % 360) + 360) % 360 / 360;
  const saturation = clamp(s, 0, 1);
  const lightness = clamp(l, 0, 1);

  if (saturation === 0) {
    const channel = lightness * 255;
    return { r: channel, g: channel, b: channel };
  }

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  return {
    r: hueToRgb(p, q, hue + 1 / 3) * 255,
    g: hueToRgb(p, q, hue) * 255,
    b: hueToRgb(p, q, hue - 1 / 3) * 255,
  };
};

const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb => {
  const weight = clamp(amount, 0, 1);
  return {
    r: from.r + (to.r - from.r) * weight,
    g: from.g + (to.g - from.g) * weight,
    b: from.b + (to.b - from.b) * weight,
  };
};

const hueDistance = (left: number, right: number): number => {
  const distance = Math.abs((((left - right) % 360) + 540) % 360 - 180);
  return clamp(distance / 180, 0, 1);
};

const mixHue = (from: number, to: number, amount: number): number => {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return ((from + delta * clamp(amount, 0, 1)) % 360 + 360) % 360;
};

const getVisibleColorfulness = (hsl: { s: number; l: number }): number =>
  hsl.s * (1 - Math.abs(hsl.l * 2 - 1));

const fallbackSampleForTheme = (themeMode: 'light' | 'dark'): ReadableColorSample => ({
  averageRgb: themeMode === 'dark' ? { r: 16, g: 21, b: 31 } : { r: 244, g: 247, b: 251 },
  luminance: themeMode === 'dark' ? 0.008 : 0.925,
  luminanceP10: themeMode === 'dark' ? 0.004 : 0.86,
  luminanceP90: themeMode === 'dark' ? 0.06 : 0.98,
  luminanceDeviation: 0.08,
  saturation: 0.12,
  edgeContrast: 0.04,
  complexity: 0.14,
  pixelCount: 1,
});

const getSampleLuminanceRange = (sample: ReadableColorSample): { low: number; high: number; width: number } => {
  const estimatedSpread = clamp(sample.luminanceDeviation * 1.9 + sample.edgeContrast * 1.15, 0.018, 0.48);
  const low = clamp(Math.min(sample.luminanceP10 ?? sample.luminance - estimatedSpread, sample.luminance), 0, 1);
  const high = clamp(Math.max(sample.luminanceP90 ?? sample.luminance + estimatedSpread, sample.luminance), 0, 1);

  return {
    low,
    high,
    width: Math.max(0, high - low),
  };
};

const getLocalScrimOpacity = (sample: ReadableColorSample, rangeWidth = getSampleLuminanceRange(sample).width): number =>
  clamp(0.045 + sample.complexity * 0.28 + rangeWidth * 0.36 + sample.saturation * 0.05, 0.06, 0.48);

const mixLuminance = (from: number, to: number, amount: number): number =>
  from + (to - from) * clamp(amount, 0, 1);

const assistedContrast = (
  textLuminance: number,
  backgroundLuminance: number,
  textIsLight: boolean,
  scrimOpacity: number,
): number => {
  const scrimLuminance = textIsLight ? 0 : 1;
  return contrastRatio(textLuminance, mixLuminance(backgroundLuminance, scrimLuminance, scrimOpacity));
};

const worstRangeContrast = (
  textLuminance: number,
  sample: ReadableColorSample,
  textIsLight: boolean,
  scrimOpacity: number,
): number => {
  const range = getSampleLuminanceRange(sample);
  return Math.min(
    assistedContrast(textLuminance, range.low, textIsLight, scrimOpacity),
    assistedContrast(textLuminance, sample.luminance, textIsLight, scrimOpacity),
    assistedContrast(textLuminance, range.high, textIsLight, scrimOpacity),
  );
};

const ensureContrast = (rgb: Rgb, backgroundLuminance: number, targetContrast: number, preferLight: boolean): Rgb => {
  const anchor = preferLight ? pureWhite : nearlyBlack;
  let candidate = rgb;

  for (let index = 0; index < 16; index += 1) {
    if (contrastRatio(candidate, backgroundLuminance) >= targetContrast) {
      return candidate;
    }
    candidate = mixRgb(candidate, anchor, 0.18);
  }

  return contrastRatio(anchor, backgroundLuminance) > contrastRatio(candidate, backgroundLuminance)
    ? anchor
    : candidate;
};

const ensureRangeContrast = (
  rgb: Rgb,
  sample: ReadableColorSample,
  targetContrast: number,
  preferLight: boolean,
  anchorOverride?: Rgb,
): Rgb => {
  const anchor = anchorOverride ?? (preferLight ? pureWhite : nearlyBlack);
  const fallbackAnchor = preferLight ? pureWhite : nearlyBlack;
  const scrimOpacity = getLocalScrimOpacity(sample);
  let candidate = rgb;
  let best = rgb;
  let bestScore = -Infinity;

  for (let index = 0; index < 18; index += 1) {
    const luminance = relativeLuminance(candidate);
    const textIsLight = luminance >= 0.5;
    const rangeContrast = worstRangeContrast(luminance, sample, textIsLight, scrimOpacity);
    const meanContrast = contrastRatio(luminance, sample.luminance);
    const score = rangeContrast * 1.8 + meanContrast * 0.45;

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }

    if (rangeContrast >= targetContrast && meanContrast >= minReadableContrast) {
      return candidate;
    }

    candidate = mixRgb(candidate, anchor, 0.16);
  }

  const bestRangeContrast = worstRangeContrast(relativeLuminance(best), sample, relativeLuminance(best) >= 0.5, scrimOpacity);
  const fallbackRangeContrast = worstRangeContrast(relativeLuminance(fallbackAnchor), sample, preferLight, scrimOpacity);
  if (bestRangeContrast < minReadableContrast && fallbackRangeContrast > bestRangeContrast) {
    return fallbackAnchor;
  }

  return best;
};

const uniqueColors = (colors: Rgb[]): Rgb[] => {
  const seen = new Set<string>();
  const result: Rgb[] = [];

  for (const color of colors) {
    const key = `${roundChannel(color.r)}:${roundChannel(color.g)}:${roundChannel(color.b)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(color);
    }
  }

  return result;
};

const choosePrimaryColor = (
  sample: ReadableColorSample,
  userColor: string | null | undefined,
): Rgb => {
  const userRgb = parseHexColor(userColor) ?? { r: 49, g: 64, b: 84 };
  const userHsl = rgbToHsl(userRgb);
  const backgroundHsl = rgbToHsl(sample.averageRgb);
  const hasUserHue = userHsl.s >= 0.12;
  const hasBackgroundHue = backgroundHsl.s >= 0.1;
  const baseHue = hasUserHue
    ? mixHue(userHsl.h, backgroundHsl.h, hasBackgroundHue ? 0.16 : 0)
    : hasBackgroundHue
      ? backgroundHsl.h
      : 214;
  const complementHue = (baseHue + 180) % 360;
  const tintSaturation = hasUserHue
    ? clamp(userHsl.s * 0.74 + backgroundHsl.s * 0.22 + 0.08, 0.28, 0.72)
    : clamp(backgroundHsl.s * 0.72 + 0.3, 0.3, 0.68);
  const darkTint = hslToRgb(baseHue, tintSaturation, 0.13);
  const deepTint = hslToRgb(baseHue, tintSaturation, 0.19);
  const shadedTint = mixRgb(hslToRgb(baseHue, tintSaturation, 0.24), sample.averageRgb, 0.07);
  const complementDarkTint = hslToRgb(complementHue, tintSaturation * 0.82, 0.17);
  const lightTint = hslToRgb(baseHue, Math.min(tintSaturation * 0.62, 0.46), 0.88);
  const brightTint = hslToRgb(baseHue, Math.min(tintSaturation * 0.5, 0.38), 0.95);
  const complementLightTint = hslToRgb(complementHue, Math.min(tintSaturation * 0.48, 0.34), 0.92);
  const darkAnchor = hslToRgb(baseHue, clamp(tintSaturation * 0.92, 0.36, 0.68), 0.09);
  const lightAnchor = hslToRgb(baseHue, clamp(tintSaturation * 0.48, 0.18, 0.44), 0.97);
  const backgroundLuminance = sample.luminance;
  const range = getSampleLuminanceRange(sample);
  const scrimOpacity = getLocalScrimOpacity(sample, range.width);
  const targetContrast = sample.complexity > 0.44 || range.width > 0.34 ? strongReadableContrast : minReadableContrast;
  const softBrightBackground = backgroundLuminance > 0.56 && range.width < 0.28 && sample.complexity < 0.42;
  const userLuminance = relativeLuminance(userRgb);
  const userIsLight = userLuminance >= 0.5;
  if (
    softBrightBackground &&
    hasUserHue &&
    contrastRatio(userLuminance, backgroundLuminance) >= minReadableContrast &&
    worstRangeContrast(userLuminance, sample, userIsLight, scrimOpacity) >= minReadableContrast
  ) {
    return userRgb;
  }
  const candidates = uniqueColors([
    userRgb,
    darkTint,
    deepTint,
    shadedTint,
    complementDarkTint,
    darkAnchor,
    lightTint,
    brightTint,
    complementLightTint,
    lightAnchor,
    nearlyBlack,
    pureWhite,
  ]);

  const ranked = candidates
    .map((rgb) => {
      const hsl = rgbToHsl(rgb);
      const luminance = relativeLuminance(rgb);
      const candidateIsLight = luminance >= 0.5;
      const meanContrast = contrastRatio(luminance, backgroundLuminance);
      const rawRangeContrast = Math.min(contrastRatio(luminance, range.low), contrastRatio(luminance, range.high));
      const assistedRangeContrast = worstRangeContrast(luminance, sample, candidateIsLight, scrimOpacity);
      const scoredMeanContrast = softBrightBackground ? Math.min(meanContrast, 8.5) : meanContrast;
      const scoredRangeContrast = softBrightBackground ? Math.min(assistedRangeContrast, 9) : assistedRangeContrast;
      const dominantDirectionBonus =
        backgroundLuminance < 0.36 && candidateIsLight
          ? 0.34
          : backgroundLuminance > 0.56 && !candidateIsLight
            ? 0.34
            : 0;
      const mixedBackgroundBonus = range.width > 0.42 && !candidateIsLight ? 0.26 : 0;
      const hueBonus = (1 - hueDistance(hsl.h, baseHue)) * 0.32 + (hasBackgroundHue ? (1 - hueDistance(hsl.h, backgroundHsl.h)) * 0.14 : 0);
      const visibleColorfulness = getVisibleColorfulness(hsl);
      const colorfulnessBonus = clamp(visibleColorfulness, 0, 0.42) * 1.75;
      const neutralPenalty = visibleColorfulness < 0.05 ? 1.05 : 0;
      const comfortableContrastPenalty = softBrightBackground
        ? Math.max(0, meanContrast - 8.5) * 0.82 + Math.max(0, 0.034 - luminance) * 42
        : Math.max(0, meanContrast - 15) * 0.035;
      const weakRawPenalty = Math.max(0, minReadableContrast - meanContrast) * 0.18;
      const userColorAffinityBonus =
        meanContrast >= minReadableContrast && visibleColorfulness >= 0.04
          ? (1 - hueDistance(hsl.h, userHsl.h)) * (hasUserHue ? 1.35 : 0.38) +
            (1 - clamp(
              (Math.abs(rgb.r - userRgb.r) + Math.abs(rgb.g - userRgb.g) + Math.abs(rgb.b - userRgb.b)) / (255 * 3),
              0,
              1,
            )) * (hasUserHue ? 3.2 : 0.6)
          : 0;
      return {
        rgb,
        assistedRangeContrast,
        colorfulness: visibleColorfulness,
        meanContrast,
        score:
          scoredRangeContrast * 1.85 +
          scoredMeanContrast * 0.48 +
          rawRangeContrast * 0.28 +
          dominantDirectionBonus +
          mixedBackgroundBonus +
          hueBonus -
          neutralPenalty +
          colorfulnessBonus -
          comfortableContrastPenalty +
          userColorAffinityBonus -
          weakRawPenalty,
        textIsLight: candidateIsLight,
      };
    })
    .sort((left, right) => right.score - left.score);

  const neutralBest = ranked[0].colorfulness < 0.08;
  const coloredBest = ranked.find(
    (candidate) =>
      candidate.colorfulness >= 0.055 &&
      candidate.assistedRangeContrast >= targetContrast &&
      candidate.meanContrast >= minReadableContrast,
  );
  const best = coloredBest && (neutralBest || coloredBest.score >= ranked[0].score - 2.6)
    ? coloredBest
    : ranked[0];
  return ensureRangeContrast(best.rgb, sample, targetContrast, best.textIsLight, best.textIsLight ? lightAnchor : darkAnchor);
};

export const createReadableLyricsColorVars = (options: ReadableColorOptions = {}): ReadableLyricsCssVars => {
  const themeMode = options.themeMode ?? 'light';
  const sample = options.sample ?? fallbackSampleForTheme(themeMode);
  const primary = choosePrimaryColor(sample, options.userColor);
  const primaryLuminance = relativeLuminance(primary);
  const primaryIsLight = primaryLuminance >= 0.5;
  const range = getSampleLuminanceRange(sample);
  const targetContrast = sample.complexity > 0.44 || range.width > 0.34 ? strongReadableContrast : minReadableContrast;
  const secondarySeed = mixRgb(primary, sample.averageRgb, sample.complexity > 0.5 ? 0.08 : 0.18);
  const secondary = ensureRangeContrast(
    ensureContrast(secondarySeed, sample.luminance, minReadableContrast, primaryIsLight),
    sample,
    minReadableContrast,
    primaryIsLight,
  );
  const primaryContrast = contrastRatio(primaryLuminance, sample.luminance);
  const primaryRangeContrast = worstRangeContrast(primaryLuminance, sample, primaryIsLight, getLocalScrimOpacity(sample, range.width));
  const needsAssist =
    sample.complexity > 0.24 ||
    range.width > 0.16 ||
    primaryContrast < strongReadableContrast ||
    primaryRangeContrast < targetContrast;
  const scrimOpacity = needsAssist
    ? getLocalScrimOpacity(sample, range.width)
    : 0;
  const shadowStrength = clamp(0.14 + sample.complexity * 0.44 + range.width * 0.26 + (primaryContrast < strongReadableContrast ? 0.12 : 0), 0.14, 0.82);
  const strokeStrength = clamp(0.16 + sample.complexity * 0.36 + range.width * 0.22, 0.16, 0.66);
  const contrastColor = primaryIsLight ? { r: 0, g: 0, b: 0 } : pureWhite;
  const secondaryGlow = primaryIsLight
    ? `0 2px 18px ${rgba(contrastColor, shadowStrength)}, 0 0 2px ${rgba(contrastColor, Math.min(0.9, shadowStrength + 0.18))}`
    : `0 1px 2px ${rgba(contrastColor, Math.min(0.72, shadowStrength + 0.16))}, 0 2px 16px ${rgba({ r: 0, g: 0, b: 0 }, Math.max(0.12, shadowStrength * 0.32))}`;

  return {
    '--lyrics-smart-primary-color': toCssRgb(primary),
    '--lyrics-smart-secondary-color': toCssRgb(secondary),
    '--lyrics-smart-shadow': secondaryGlow,
    '--lyrics-smart-stroke': needsAssist ? `0.014em ${rgba(contrastColor, strokeStrength)}` : '0px transparent',
    '--lyrics-smart-scrim-color': primaryIsLight ? 'rgb(0 0 0)' : 'rgb(255 255 255)',
    '--lyrics-smart-scrim-background': needsAssist ? rgba(contrastColor, scrimOpacity) : 'transparent',
    '--lyrics-smart-scrim-opacity': scrimOpacity.toFixed(2),
  };
};

export const analyzePixelBuffer = (
  pixels: Uint8ClampedArray,
  options: AnalyzePixelsOptions = {},
): ReadableColorSample | null => {
  if (pixels.length < 4) {
    return null;
  }

  const pixelTotal = Math.floor(pixels.length / 4);
  const step = Math.max(1, Math.floor(pixelTotal / (options.maxSamples ?? 4096)));
  const width = options.width && options.width > 0 ? Math.round(options.width) : 0;
  let count = 0;
  let meanLuminance = 0;
  let m2 = 0;
  let saturationSum = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let weightSum = 0;
  let dominantRedSum = 0;
  let dominantGreenSum = 0;
  let dominantBlueSum = 0;
  let dominantWeightSum = 0;
  let edgeSum = 0;
  let edgeCount = 0;
  const luminanceSamples: number[] = [];

  for (let pixelIndex = 0; pixelIndex < pixelTotal; pixelIndex += step) {
    const offset = pixelIndex * 4;
    const alpha = pixels[offset + 3] / 255;
    if (alpha < 0.08) {
      continue;
    }

    const rgb = {
      r: pixels[offset],
      g: pixels[offset + 1],
      b: pixels[offset + 2],
    };
    const luminance = relativeLuminance(rgb);
    count += 1;
    const delta = luminance - meanLuminance;
    meanLuminance += delta / count;
    m2 += delta * (luminance - meanLuminance);
    luminanceSamples.push(luminance);
    saturationSum += rgbToHsl(rgb).s;
    rSum += rgb.r * alpha;
    gSum += rgb.g * alpha;
    bSum += rgb.b * alpha;
    weightSum += alpha;

    const maxChannel = Math.max(rgb.r, rgb.g, rgb.b);
    const minChannel = Math.min(rgb.r, rgb.g, rgb.b);
    const visibleSaturation = maxChannel === 0 ? 0 : (maxChannel - minChannel) / maxChannel;
    const visibleLightness = (maxChannel + minChannel) / 510;
    if (visibleSaturation >= 0.12 && visibleLightness >= 0.1 && visibleLightness <= 0.92) {
      const midToneWeight = 1 - Math.min(0.82, Math.abs(visibleLightness - 0.55) * 1.4);
      const dominantWeight = alpha * (0.35 + visibleSaturation * 1.9) * midToneWeight;
      dominantRedSum += rgb.r * dominantWeight;
      dominantGreenSum += rgb.g * dominantWeight;
      dominantBlueSum += rgb.b * dominantWeight;
      dominantWeightSum += dominantWeight;
    }

    if (width > 0) {
      const x = pixelIndex % width;
      const previousPixelIndex = pixelIndex - 1;
      const upperPixelIndex = pixelIndex - width;
      if (x > 0 && previousPixelIndex >= 0 && pixels[previousPixelIndex * 4 + 3] > 24) {
        edgeSum += Math.abs(luminance - relativeLuminance({
          r: pixels[previousPixelIndex * 4],
          g: pixels[previousPixelIndex * 4 + 1],
          b: pixels[previousPixelIndex * 4 + 2],
        }));
        edgeCount += 1;
      }
      if (upperPixelIndex >= 0 && pixels[upperPixelIndex * 4 + 3] > 24) {
        edgeSum += Math.abs(luminance - relativeLuminance({
          r: pixels[upperPixelIndex * 4],
          g: pixels[upperPixelIndex * 4 + 1],
          b: pixels[upperPixelIndex * 4 + 2],
        }));
        edgeCount += 1;
      }
    }
  }

  if (count === 0) {
    return null;
  }

  const luminanceDeviation = Math.sqrt(m2 / Math.max(1, count - 1));
  luminanceSamples.sort((left, right) => left - right);
  const luminanceP10 = luminanceSamples[Math.floor((luminanceSamples.length - 1) * 0.1)] ?? meanLuminance;
  const luminanceP90 = luminanceSamples[Math.ceil((luminanceSamples.length - 1) * 0.9)] ?? meanLuminance;
  const saturation = saturationSum / count;
  const edgeContrast = edgeCount > 0 ? edgeSum / edgeCount : 0;
  const luminanceRange = Math.max(0, luminanceP90 - luminanceP10);
  const complexity = clamp(luminanceDeviation * 1.72 + luminanceRange * 0.78 + edgeContrast * 1.3 + saturation * 0.22, 0, 1);

  return {
    averageRgb: {
      r: rSum / Math.max(weightSum, 1),
      g: gSum / Math.max(weightSum, 1),
      b: bSum / Math.max(weightSum, 1),
    },
    ...(dominantWeightSum > 0
      ? {
          dominantRgb: {
            r: dominantRedSum / dominantWeightSum,
            g: dominantGreenSum / dominantWeightSum,
            b: dominantBlueSum / dominantWeightSum,
          },
        }
      : {}),
    luminance: meanLuminance,
    luminanceP10,
    luminanceP90,
    luminanceDeviation,
    saturation,
    edgeContrast,
    complexity,
    pixelCount: count,
  };
};

const drawToSampleCanvas = (
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): ReadableColorSample | null => {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }

  canvas.width = sampleCanvasSize;
  canvas.height = sampleCanvasSize;
  context.clearRect(0, 0, sampleCanvasSize, sampleCanvasSize);
  context.drawImage(source, 0, 0, sampleCanvasSize, sampleCanvasSize);
  const imageData = context.getImageData(0, 0, sampleCanvasSize, sampleCanvasSize);
  return analyzePixelBuffer(imageData.data, { width: sampleCanvasSize });
};

export const sampleImageUrl = async (url: string): Promise<ReadableColorSample | null> =>
  new Promise((resolve) => {
    if (!url || typeof Image === 'undefined' || typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const image = new Image();
    let settled = false;
    const finish = (sample: ReadableColorSample | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(sample);
    };

    if (/^https?:\/\//iu.test(url)) {
      image.crossOrigin = 'anonymous';
    }

    image.onload = () => {
      try {
        finish(drawToSampleCanvas(image, image.naturalWidth, image.naturalHeight));
      } catch {
        finish(null);
      }
    };
    image.onerror = () => finish(null);
    image.src = url;

    if (image.complete && image.naturalWidth > 0) {
      queueMicrotask(() => {
        try {
          finish(drawToSampleCanvas(image, image.naturalWidth, image.naturalHeight));
        } catch {
          finish(null);
        }
      });
    }
  });

export const sampleVideoElement = async (video: HTMLVideoElement): Promise<ReadableColorSample | null> => {
  if (typeof document === 'undefined' || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null;
  }

  try {
    return drawToSampleCanvas(video, video.videoWidth, video.videoHeight);
  } catch {
    return null;
  }
};
