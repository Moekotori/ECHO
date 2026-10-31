const localCoverVariantPattern = /^echo-cover:\/\/(?:thumb|album|large|original)\//u;

export const largeCoverUrlFromCachedVariant = (coverUrl: string | null | undefined): string | null => {
  const largeUrl = coverUrl?.replace(localCoverVariantPattern, 'echo-cover://large/') ?? null;
  return largeUrl?.startsWith('echo-cover://large/') ? largeUrl : null;
};

export const localCoverDisplayUrl = (
  coverId: string | null | undefined,
  cachedCoverUrl?: string | null,
): string | null =>
  coverId
    ? `echo-cover://large/${encodeURIComponent(coverId)}`
    : largeCoverUrlFromCachedVariant(cachedCoverUrl);
