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
  sourceId?: unknown;
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

  const sourceId = clean(input.sourceId);
  const sourcePrefix = sourceId ? `${provider}:source:${sourceId}` : provider;
  const coverArt = clean(input.fieldSources?.coverArt);
  if (coverArt) {
    return `${sourcePrefix}:cover-art:${coverArt}`;
  }

  const albumId = clean(input.fieldSources?.albumId ?? input.fieldSources?.serverAlbumId);
  if ((provider === 'subsonic' || provider === 'jellyfin' || provider === 'emby') && albumId) {
    return `${sourcePrefix}:album:${albumId}`;
  }

  const remotePath = normalizeRemotePath(input.remotePath);
  const stableKey = clean(input.stableKey);
  if (remotePath && stableKey) {
    return `${sourcePrefix}:path:${remotePath}:${stableKey}`;
  }

  return null;
};

export const subsonicDirectCoverUrlFor = (
  trackId: unknown,
  sourceId: unknown,
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
  const normalizedSourceId = clean(sourceId);
  const coverArt = clean(fieldSources?.coverArt);
  const cacheKey = remoteCoverCacheKeyFor({ sourceId: normalizedSourceId, provider, fieldSources, remotePath, stableKey });
  const params = new URLSearchParams({ size: String(normalizedSize) });
  if (cacheKey) {
    params.set('cacheKey', cacheKey);
  }
  if (normalizedSourceId && coverArt && cacheKey) {
    params.set('sourceId', normalizedSourceId);
    params.set('coverArt', coverArt);
    return `echo-image://subsonic-cover/${encodeURIComponent(cacheKey)}?${params.toString()}`;
  }

  return `echo-image://subsonic-cover/${encodeURIComponent(String(trackId))}?${params.toString()}`;
};
