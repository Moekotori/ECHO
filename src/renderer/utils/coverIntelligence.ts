const coverIntelligenceEnabledStorageKey = 'echo-next.cover-intelligence.enabled';
const coverIntelligenceCacheStorageKey = 'echo-next.cover-intelligence.cache.v1';
const coverIntelligenceCacheVersion = 1;
const coverIntelligenceMaxEntries = 240;
const coverIntelligenceMaxAnalysisSize = 36;
const coverIntelligenceLoadTimeoutMs = 2600;

export type CoverTemperature = 'cool' | 'warm' | 'neutral';
export type CoverMoodLabel = 'cool' | 'warm' | 'dark' | 'bright' | 'vivid' | 'muted';

export type CoverIntelligenceColor = {
  hex: string;
  r: number;
  g: number;
  b: number;
};

export type CoverIntelligenceResult = {
  version: 1;
  sourceKey: string;
  analyzedAt: string;
  dominantColor: CoverIntelligenceColor;
  brightness: number;
  contrast: number;
  saturation: number;
  coolScore: number;
  warmScore: number;
  temperature: CoverTemperature;
  moodLabels: CoverMoodLabel[];
};

type CoverIntelligenceCachePayload = {
  version: 1;
  entries: Record<string, CoverIntelligenceResult>;
  order: string[];
};

type AnalyzeCoverImageOptions = {
  storage?: Storage | null;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const safeStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;

const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === rn) {
    h = 60 * (((gn - bn) / delta) % 6);
  } else if (max === gn) {
    h = 60 * ((bn - rn) / delta + 2);
  } else {
    h = 60 * ((rn - gn) / delta + 4);
  }

  return { h: h < 0 ? h + 360 : h, s, l };
};

const relativeLuminance = (r: number, g: number, b: number): number => {
  const transform = (value: number): number => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
};

const temperatureScores = (hue: number, saturation: number, luminance: number): { cool: number; warm: number } => {
  if (saturation < 0.12) {
    return { cool: 0, warm: 0 };
  }

  const vividness = saturation * (0.45 + Math.min(0.55, Math.abs(luminance - 0.5) + 0.22));
  const isCool = (hue >= 165 && hue <= 285) || (hue >= 120 && hue < 165 && saturation > 0.36);
  const isWarm = hue <= 68 || hue >= 318 || (hue > 68 && hue < 120 && saturation > 0.42);

  return {
    cool: isCool ? vividness : 0,
    warm: isWarm ? vividness : 0,
  };
};

const moodLabelsFor = (
  temperature: CoverTemperature,
  brightness: number,
  saturation: number,
): CoverMoodLabel[] => {
  const labels: CoverMoodLabel[] = [];
  if (temperature !== 'neutral') {
    labels.push(temperature);
  }
  if (brightness < 0.32) {
    labels.push('dark');
  } else if (brightness > 0.72) {
    labels.push('bright');
  }
  if (saturation > 0.48) {
    labels.push('vivid');
  } else if (saturation < 0.18) {
    labels.push('muted');
  }
  return labels;
};

const emptyCache = (): CoverIntelligenceCachePayload => ({
  version: coverIntelligenceCacheVersion,
  entries: {},
  order: [],
});

const readCache = (storage = safeStorage()): CoverIntelligenceCachePayload => {
  if (!storage) {
    return emptyCache();
  }

  try {
    const raw = storage.getItem(coverIntelligenceCacheStorageKey);
    if (!raw) {
      return emptyCache();
    }
    const parsed = JSON.parse(raw) as Partial<CoverIntelligenceCachePayload> | null;
    if (parsed?.version !== coverIntelligenceCacheVersion || !parsed.entries || !Array.isArray(parsed.order)) {
      return emptyCache();
    }
    return {
      version: coverIntelligenceCacheVersion,
      entries: parsed.entries,
      order: parsed.order.filter((key) => typeof key === 'string' && parsed.entries?.[key]),
    };
  } catch {
    return emptyCache();
  }
};

const writeCache = (cache: CoverIntelligenceCachePayload, storage = safeStorage()): void => {
  if (!storage) {
    return;
  }

  try {
    const order = cache.order.filter((key, index, keys) => cache.entries[key] && keys.indexOf(key) === index);
    while (order.length > coverIntelligenceMaxEntries) {
      const droppedKey = order.shift();
      if (droppedKey) {
        delete cache.entries[droppedKey];
      }
    }

    storage.setItem(coverIntelligenceCacheStorageKey, JSON.stringify({ ...cache, order }));
  } catch {
    // Cache writes are best effort; analysis should never break the UI.
  }
};

export const readCoverIntelligenceEnabled = (storage = safeStorage()): boolean => {
  if (!storage) {
    return false;
  }

  try {
    return storage.getItem(coverIntelligenceEnabledStorageKey) === '1';
  } catch {
    return false;
  }
};

export const writeCoverIntelligenceEnabled = (enabled: boolean, storage = safeStorage()): void => {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(coverIntelligenceEnabledStorageKey, enabled ? '1' : '0');
  } catch {
    // Local preference writes are best effort.
  }
};

export const coverIntelligenceSourceKey = (source: { coverId?: string | null; coverThumb?: string | null }): string | null => {
  if (source.coverId) {
    return `cover:${source.coverId}`;
  }

  return source.coverThumb ? `thumb:${source.coverThumb}` : null;
};

export const getCachedCoverIntelligence = (
  sourceKey: string | null,
  storage = safeStorage(),
): CoverIntelligenceResult | null => {
  if (!sourceKey) {
    return null;
  }

  return readCache(storage).entries[sourceKey] ?? null;
};

const rememberCoverIntelligence = (
  result: CoverIntelligenceResult,
  storage = safeStorage(),
): void => {
  const cache = readCache(storage);
  cache.entries[result.sourceKey] = result;
  cache.order = [result.sourceKey, ...cache.order.filter((key) => key !== result.sourceKey)];
  writeCache(cache, storage);
};

export const analyzeCoverPixels = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sourceKey = 'inline',
  analyzedAt = new Date().toISOString(),
): CoverIntelligenceResult | null => {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) {
    return null;
  }

  let totalWeight = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let luminanceSum = 0;
  let luminanceSquareSum = 0;
  let saturationSum = 0;
  let coolScore = 0;
  let warmScore = 0;

  for (let index = 0; index < width * height * 4; index += 4) {
    const alpha = pixels[index + 3] / 255;
    if (alpha < 0.18) {
      continue;
    }

    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const { h, s, l } = rgbToHsl(r, g, b);
    const luminance = relativeLuminance(r, g, b);
    const edgePenalty = 1 - Math.min(0.46, Math.abs(l - 0.5) * 0.42);
    const weight = alpha * (0.38 + s) * edgePenalty;
    const scores = temperatureScores(h, s, luminance);

    totalWeight += weight;
    redSum += r * weight;
    greenSum += g * weight;
    blueSum += b * weight;
    luminanceSum += luminance * weight;
    luminanceSquareSum += luminance * luminance * weight;
    saturationSum += s * weight;
    coolScore += scores.cool * weight;
    warmScore += scores.warm * weight;
  }

  if (totalWeight <= 0) {
    return null;
  }

  const r = Math.round(redSum / totalWeight);
  const g = Math.round(greenSum / totalWeight);
  const b = Math.round(blueSum / totalWeight);
  const brightness = clamp01(luminanceSum / totalWeight);
  const saturation = clamp01(saturationSum / totalWeight);
  const contrast = clamp01(Math.sqrt(Math.max(0, luminanceSquareSum / totalWeight - brightness * brightness)) * 2.4);
  const normalizedCool = clamp01(coolScore / totalWeight);
  const normalizedWarm = clamp01(warmScore / totalWeight);
  const temperature: CoverTemperature =
    normalizedCool > normalizedWarm + 0.055
      ? 'cool'
      : normalizedWarm > normalizedCool + 0.055
        ? 'warm'
        : 'neutral';

  return {
    version: coverIntelligenceCacheVersion,
    sourceKey,
    analyzedAt,
    dominantColor: {
      hex: rgbToHex(r, g, b),
      r,
      g,
      b,
    },
    brightness,
    contrast,
    saturation,
    coolScore: normalizedCool,
    warmScore: normalizedWarm,
    temperature,
    moodLabels: moodLabelsFor(temperature, brightness, saturation),
  };
};

const loadCoverPixels = (
  src: string,
  options: Pick<AnalyzeCoverImageOptions, 'signal' | 'timeoutMs'> = {},
): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> =>
  new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      reject(new Error('Cover analysis requires a browser image runtime.'));
      return;
    }

    const image = new Image();
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error('Cover analysis timed out.'));
    }, options.timeoutMs ?? coverIntelligenceLoadTimeoutMs);

    const cleanup = (): void => {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
    };

    const abort = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new DOMException('Cover analysis was aborted.', 'AbortError'));
    };

    options.signal?.addEventListener('abort', abort, { once: true });
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (settled) {
        return;
      }

      try {
        const naturalWidth = image.naturalWidth || image.width;
        const naturalHeight = image.naturalHeight || image.height;
        const scale = Math.min(1, coverIntelligenceMaxAnalysisSize / Math.max(naturalWidth, naturalHeight));
        const width = Math.max(1, Math.round(naturalWidth * scale));
        const height = Math.max(1, Math.round(naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          throw new Error('Canvas 2D context is unavailable.');
        }
        context.drawImage(image, 0, 0, width, height);
        const imageData = context.getImageData(0, 0, width, height);
        settled = true;
        cleanup();
        resolve({ pixels: imageData.data, width, height });
      } catch (error) {
        settled = true;
        cleanup();
        reject(error);
      }
    };
    image.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error('Cover image could not be loaded.'));
    };
    image.src = src;
  });

export const analyzeCoverImage = async (
  src: string,
  sourceKey: string,
  options: AnalyzeCoverImageOptions = {},
): Promise<CoverIntelligenceResult | null> => {
  const storage = options.storage ?? safeStorage();
  const cached = getCachedCoverIntelligence(sourceKey, storage);
  if (cached) {
    return cached;
  }

  const loaded = await loadCoverPixels(src, options);
  const result = analyzeCoverPixels(loaded.pixels, loaded.width, loaded.height, sourceKey);
  if (result) {
    rememberCoverIntelligence(result, storage);
  }
  return result;
};

export const tryAnalyzeCoverImage = async (
  src: string | null,
  sourceKey: string | null,
  options: AnalyzeCoverImageOptions = {},
): Promise<CoverIntelligenceResult | null> => {
  if (!src || !sourceKey) {
    return null;
  }

  try {
    return await analyzeCoverImage(src, sourceKey, options);
  } catch {
    return null;
  }
};
