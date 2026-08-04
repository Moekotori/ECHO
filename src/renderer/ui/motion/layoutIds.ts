export const playerCoverLayoutId = (trackId: string | null | undefined): string | undefined =>
  trackId ? `player-cover-${trackId}` : undefined;
