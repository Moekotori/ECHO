import type { ArtistImageCandidate } from './ArtistImageTypes';
import { fetchWithNetworkProxy } from '../../network/networkFetch';

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

export const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const normalizeImageUrl = (url: string): string => {
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }

  return trimmed.replace(/^http:\/\//iu, 'https://');
};

export const unique = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
};

export const isLikelyDefaultRemoteImageUrl = (url: string | null | undefined): boolean => {
  if (!url) {
    return true;
  }

  const normalized = url.toLocaleLowerCase();
  return /(?:default|nopic|no_pic|placeholder|avatar_default|singer_default|artist_default|noimage|no_image)/u.test(normalized)
    || /\/(?:0|default)\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/u.test(normalized)
    || /2a96cbd8b46e442fc41c2b86b821562f/u.test(normalized)
    || /6y-uleoritedbvrolv0q8a|5639395138885805/u.test(normalized);
};

export const requestJson = async (
  url: string,
  options: {
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 7000);

  try {
    const response = await fetchWithNetworkProxy(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`artist_image_provider_request_failed:${response.status}`);
    }

    const raw = await response.text();
    return raw ? JSON.parse(raw.trim().replace(/^\uFEFF/u, '')) : {};
  } finally {
    clearTimeout(timer);
  }
};

export const requestText = async (
  url: string,
  options: {
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 7000);

  try {
    const response = await fetchWithNetworkProxy(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/html,text/plain,*/*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`artist_image_provider_request_failed:${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timer);
  }
};

export const sortArtistImageCandidates = (candidates: ArtistImageCandidate[]): ArtistImageCandidate[] =>
  candidates.sort((left, right) => {
    const scoreDelta = right.confidence - left.confidence;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const qualityDelta = (right.quality ?? 0) - (left.quality ?? 0);
    if (qualityDelta !== 0) {
      return qualityDelta;
    }

    return left.artistName.localeCompare(right.artistName);
  });
