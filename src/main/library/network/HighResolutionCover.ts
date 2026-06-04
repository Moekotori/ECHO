import type { NetworkProviderName } from './networkTypes';

export const highResolutionCoverUrl = (
  provider: NetworkProviderName,
  coverUrl: string | null | undefined,
): string | null => {
  if (!coverUrl?.trim()) {
    return null;
  }

  const trimmed = coverUrl.trim();

  try {
    const url = new URL(trimmed);

    if (provider === 'netease-cloud-music' || url.hostname.endsWith('music.126.net')) {
      url.searchParams.delete('param');
      return url.toString();
    }

    if (provider === 'qq-music' || url.hostname.endsWith('gtimg.cn')) {
      return trimmed.replace(/T002R\d+x\d+M000/u, 'T002R0x0M000');
    }

    if (provider === 'musicbrainz' || url.hostname.endsWith('coverartarchive.org')) {
      return trimmed.replace(/\/front-\d+(?=$|[?#])/u, '/front');
    }

    return trimmed;
  } catch {
    return trimmed;
  }
};
