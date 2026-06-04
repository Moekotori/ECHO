const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

const clean = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeRemotePath = (value: unknown): string | null => {
  const path = clean(value);
  if (!path) {
    return null;
  }
  const normalized = path.replace(/\\/gu, '/').replace(/\/+/gu, '/').toLocaleLowerCase();
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

export type RemoteCoverCacheKeyInput = {
  provider: unknown;
  fieldSources?: Record<string, unknown> | null;
  remotePath?: unknown;
  stableKey?: unknown;
};

export const remoteCoverCacheKeyFor = (input: RemoteCoverCacheKeyInput): string | null => {
  const provider = clean(input.provider)?.toLocaleLowerCase();
  if (!provider) {
    return null;
  }

  const coverArt = clean(input.fieldSources?.coverArt);
  if (coverArt) {
    return `${provider}:cover-art:${coverArt}`;
  }

  const albumId = clean(input.fieldSources?.albumId ?? input.fieldSources?.serverAlbumId);
  if ((provider === 'subsonic' || provider === 'jellyfin' || provider === 'emby') && albumId) {
    return `${provider}:album:${albumId}`;
  }

  const remotePath = normalizeRemotePath(input.remotePath);
  const stableKey = clean(input.stableKey);
  if (remotePath && stableKey) {
    return `${provider}:path:${remotePath}:${stableKey}`;
  }

  return null;
};

export const subsonicDirectCoverUrlFor = (
  trackId: unknown,
  provider: unknown,
  coverId: unknown,
  fieldSources?: Record<string, unknown> | null,
  remotePath?: unknown,
  stableKey?: unknown,
  size = 512,
): string | null => {
  if (provider !== 'subsonic' || textOrNull(coverId)) {
    return null;
  }

  const normalizedSize = Number.isFinite(size) ? Math.max(80, Math.min(1024, Math.round(size))) : 512;
  const cacheKey = remoteCoverCacheKeyFor({ provider, fieldSources, remotePath, stableKey });
  const params = new URLSearchParams({ size: String(normalizedSize) });
  if (cacheKey) {
    params.set('cacheKey', cacheKey);
  }
  return `echo-image://subsonic-cover/${encodeURIComponent(String(trackId))}?${params.toString()}`;
};
