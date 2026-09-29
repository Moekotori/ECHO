import { fetchWithNetworkProxy } from '../../../network/networkFetch';

export const fetchJsonWithTimeout = async (
  url: string,
  signal: AbortSignal | undefined,
  headers: Record<string, string> = {},
  timeoutMs = 6000,
): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetchWithNetworkProxy(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'ECHO-Next/0.1',
        ...headers,
      },
    });

    if (!response.ok) {
      throw new Error(`request_failed:${response.status}`);
    }

    const text = await response.text();
    const jsonText = text.trim().replace(/^[^(]*\((.*)\);?$/s, '$1');
    return JSON.parse(jsonText) as unknown;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
};

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

export const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const buildSearchQuery = (title: string, artist: string, filename: string): string => {
  const titleText = title && title !== 'Untitled' ? title : filename.replace(/\.[^.]+$/, '');
  const artistText = artist && artist !== 'Unknown Artist' ? artist : '';
  return [titleText, artistText].filter(Boolean).join(' ').trim();
};
