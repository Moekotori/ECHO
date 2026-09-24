import { createHash } from 'node:crypto';
import type { LyricsSearchCandidate } from '../../shared/types/lyrics';
import { getDurationDelta } from './lyricsScoring';
import { normalizeTextForIdentity } from './lyricsTextNormalization';

export type DedupableLyricsCandidate = LyricsSearchCandidate & {
  raw?: unknown;
  providerPriority?: number;
  hasTranslation?: boolean;
  hasRomanization?: boolean;
  secondaryLyricsPriority?: number;
  lyricsFingerprint?: string;
};

const textHash = (value: string | null | undefined): string =>
  createHash('sha1').update((value ?? '').trim()).digest('hex').slice(0, 16);

const makeCandidateContentIdentity = (
  candidate: DedupableLyricsCandidate,
  lyricsTextHash: string,
): string => [
  lyricsTextHash,
  normalizeTextForIdentity(candidate.title),
  normalizeTextForIdentity(candidate.artist),
  candidate.instrumental ? 'instrumental' : 'vocal',
].join('|');

export const makeCandidateIdentity = (candidate: DedupableLyricsCandidate): string => {
  if (candidate.providerLyricsId) {
    return `${candidate.provider}:${candidate.providerLyricsId}`;
  }

  const lyricHash = textHash(JSON.stringify(candidate.raw ?? {}));
  return [
    normalizeTextForIdentity(candidate.title),
    normalizeTextForIdentity(candidate.artist),
    normalizeTextForIdentity(candidate.album),
    candidate.durationSeconds ? String(Math.round(candidate.durationSeconds)) : '',
    candidate.hasSynced ? 'synced' : candidate.hasPlain ? 'plain' : candidate.instrumental ? 'instrumental' : 'empty',
    lyricHash,
  ].join('|');
};

const riskRank = (risk: LyricsSearchCandidate['risk']): number => (risk === 'low' ? 0 : risk === 'medium' ? 1 : 2);
const confidenceRank = (confidence: LyricsSearchCandidate['confidence']): number =>
  confidence === 'high' ? 0 : confidence === 'balanced' ? 1 : 2;
const wordTimingScoreTolerance = 0.03;
const providerRank = (provider: LyricsSearchCandidate['provider']): number => {
  if (provider === 'manual') return 0;
  if (provider === 'local') return 1;
  if (provider === 'lrclib') return 2;
  return 3;
};

const mergeReasons = (left?: string[], right?: string[]): string[] | undefined => {
  const merged = [...(left ?? []), ...(right ?? [])].filter(Boolean);
  return merged.length ? Array.from(new Set(merged)) : undefined;
};

const betterCandidate = <T extends DedupableLyricsCandidate>(left: T, right: T): T => {
  const riskDelta = riskRank(right.risk) - riskRank(left.risk);
  if (riskDelta !== 0) {
    return riskDelta < 0 ? right : left;
  }

  if (
    Boolean(right.hasWordTiming) !== Boolean(left.hasWordTiming) &&
    Math.abs(right.score - left.score) <= wordTimingScoreTolerance
  ) {
    return right.hasWordTiming ? right : left;
  }

  if (right.score !== left.score) {
    return right.score > left.score ? right : left;
  }

  if ((right.secondaryLyricsPriority ?? 0) !== (left.secondaryLyricsPriority ?? 0)) {
    return (right.secondaryLyricsPriority ?? 0) > (left.secondaryLyricsPriority ?? 0) ? right : left;
  }

  if ((right.providerPriority ?? 0) !== (left.providerPriority ?? 0)) {
    return (right.providerPriority ?? 0) > (left.providerPriority ?? 0) ? right : left;
  }

  if (right.hasSynced !== left.hasSynced) {
    return right.hasSynced ? right : left;
  }

  return providerRank(right.provider) < providerRank(left.provider) ? right : left;
};

export const dedupeLyricsCandidates = <T extends DedupableLyricsCandidate>(candidates: T[]): T[] => {
  const byIdentity = new Map<string, T>();
  const byText = new Map<string, string>();

  for (const candidate of candidates) {
    const identity = makeCandidateIdentity(candidate);
    const lyricsTextHash = candidate.contentFingerprint
      ?? candidate.lyricsFingerprint
      ?? textHash(JSON.stringify(candidate.raw ?? {}));
    const contentIdentity = makeCandidateContentIdentity(candidate, lyricsTextHash);
    const existingIdentity = byText.get(contentIdentity) ?? identity;
    const existing = byIdentity.get(existingIdentity);
    const matchedSources = existing
      ? Array.from(
          new Map(
            [...(existing.matchedSources ?? []), ...(candidate.matchedSources ?? [])]
              .map((source) => [`${source.provider}:${source.sourceLabel}`, source]),
          ).values(),
        )
      : candidate.matchedSources;
    const reasons = existing
      ? mergeReasons(
          mergeReasons(existing.reasons, candidate.reasons),
          new Set(matchedSources?.map((source) => source.provider)).size >= 2
            ? ['multi_source_agreement']
            : undefined,
        )
      : candidate.reasons;
    const merged = existing
      ? {
          ...betterCandidate(existing, candidate),
          reasons,
          matchedSources,
        }
      : candidate;

    byIdentity.set(existingIdentity, merged as T);
    byText.set(contentIdentity, existingIdentity);
  }

  return Array.from(byIdentity.values());
};

export const sortLyricsCandidates = <T extends DedupableLyricsCandidate>(queryDuration: number | null | undefined, candidates: T[]): T[] =>
  [...candidates].sort((left, right) => {
    const riskDelta = riskRank(left.risk) - riskRank(right.risk);
    if (riskDelta !== 0) return riskDelta;

    const confidenceDelta = confidenceRank(left.confidence) - confidenceRank(right.confidence);
    if (confidenceDelta !== 0) return confidenceDelta;

    const titleDelta = (right.titleScore ?? 0) - (left.titleScore ?? 0);
    if (titleDelta !== 0) return titleDelta;

    const artistDelta = (right.artistScore ?? 0) - (left.artistScore ?? 0);
    if (artistDelta !== 0) return artistDelta;

    const leftDelta = getDurationDelta(queryDuration, left.durationSeconds) ?? Number.MAX_SAFE_INTEGER;
    const rightDelta = getDurationDelta(queryDuration, right.durationSeconds) ?? Number.MAX_SAFE_INTEGER;
    if (leftDelta !== rightDelta) return leftDelta - rightDelta;

    const versionDelta = (right.versionScore ?? 0) - (left.versionScore ?? 0);
    if (versionDelta !== 0) return versionDelta;

    if (right.hasSynced !== left.hasSynced) return right.hasSynced ? 1 : -1;

    if (
      Boolean(right.hasWordTiming) !== Boolean(left.hasWordTiming) &&
      Math.abs(right.score - left.score) <= wordTimingScoreTolerance
    ) {
      return right.hasWordTiming ? 1 : -1;
    }

    if (right.score !== left.score) return right.score - left.score;

    const leftAuto = left.reasons?.includes('auto_accept') ? 1 : 0;
    const rightAuto = right.reasons?.includes('auto_accept') ? 1 : 0;
    if (rightAuto !== leftAuto) return rightAuto - leftAuto;

    const secondaryLyricsDelta = (right.secondaryLyricsPriority ?? 0) - (left.secondaryLyricsPriority ?? 0);
    if (secondaryLyricsDelta !== 0) return secondaryLyricsDelta;

    const priorityDelta = (right.providerPriority ?? 0) - (left.providerPriority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;

    const providerDelta = providerRank(left.provider) - providerRank(right.provider);
    if (providerDelta !== 0) return providerDelta;

    return 0;
  });
