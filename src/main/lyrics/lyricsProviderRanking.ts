import type { LyricsProviderSearchRequest } from './LyricsProvider';
import { evaluateLyricsCandidate } from './lyricsScoring';
import { normalizeTextForIdentity } from './lyricsTextNormalization';

export type LyricsProviderMetadata = {
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
  instrumental?: boolean;
};

const metadataDecision = (request: LyricsProviderSearchRequest, item: LyricsProviderMetadata) =>
  evaluateLyricsCandidate(request.normalized, {
    ...item,
    provider: 'manual',
    providerLyricsId: null,
    instrumental: item.instrumental === true,
    hasSynced: true,
    hasPlain: true,
    sourceLabel: 'provider-metadata',
  });

export const hasSafeLyricsProviderItem = (request: LyricsProviderSearchRequest, items: LyricsProviderMetadata[]): boolean =>
  items.some((item) => metadataDecision(request, item).autoAcceptEligible);

/** These providers search title + artist only; album-only variants repeat the same request. */
export const providerSearchVariants = (request: LyricsProviderSearchRequest) => {
  const seen = new Set<string>();
  return request.normalized.searchVariants.filter((variant) => {
    const key = normalizeTextForIdentity(`${variant.title} ${variant.artist}`);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, request.collectAllCandidates ? 8 : 3);
};

export const rankLyricsProviderItems = <T extends LyricsProviderMetadata>(
  request: LyricsProviderSearchRequest,
  items: T[],
): T[] => items
  .map((item, index) => ({
    item,
    index,
    decision: metadataDecision(request, item),
  }))
  .sort((left, right) => {
    if (left.decision.autoAcceptEligible !== right.decision.autoAcceptEligible) {
      return right.decision.autoAcceptEligible ? 1 : -1;
    }
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
