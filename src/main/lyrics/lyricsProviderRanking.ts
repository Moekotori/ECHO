import type { LyricsProviderSearchRequest } from './LyricsProvider';
import { evaluateLyricsCandidate } from './lyricsScoring';

export type LyricsProviderMetadata = {
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
};

export const rankLyricsProviderItems = <T extends LyricsProviderMetadata>(
  request: LyricsProviderSearchRequest,
  items: T[],
): T[] => items
  .map((item, index) => ({
    item,
    index,
    decision: evaluateLyricsCandidate(request.normalized, {
      provider: 'manual',
      providerLyricsId: null,
      title: item.title,
      artist: item.artist,
      album: item.album,
      durationSeconds: item.durationSeconds,
      instrumental: false,
      hasSynced: true,
      hasPlain: true,
      sourceLabel: 'provider-metadata',
    }),
  }))
  .sort((left, right) => {
    if (right.decision.titleScore !== left.decision.titleScore) {
      return right.decision.titleScore - left.decision.titleScore;
    }
    if (right.decision.artistScore !== left.decision.artistScore) {
      return right.decision.artistScore - left.decision.artistScore;
    }
    if (right.decision.durationScore !== left.decision.durationScore) {
      return right.decision.durationScore - left.decision.durationScore;
    }
    if (right.decision.versionScore !== left.decision.versionScore) {
      return right.decision.versionScore - left.decision.versionScore;
    }
    if (right.decision.score !== left.decision.score) {
      return right.decision.score - left.decision.score;
    }
    return left.index - right.index;
  })
  .map(({ item }) => item);

export const providerLyricsFetchLimit = (request: LyricsProviderSearchRequest): number =>
  request.collectAllCandidates ? 5 : 2;
