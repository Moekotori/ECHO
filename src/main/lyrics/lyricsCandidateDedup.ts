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
};

const textHash = (value: string | null | undefined): string =>
  createHash('sha1').update((value ?? '').trim()).digest('hex').slice(0, 16);

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
  if ((right.secondaryLyricsPriority ?? 0) !== (left.secondaryLyricsPriority ?? 0)) {
    return (right.secondaryLyricsPriority ?? 0) > (left.secondaryLyricsPriority ?? 0) ? right : left;
  }

  if ((right.providerPriority ?? 0) !== (left.providerPriority ?? 0)) {
    return (right.providerPriority ?? 0) > (left.providerPriority ?? 0) ? right : left;
  }

  if (right.score !== left.score) {
    return right.score > left.score ? right : left;
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
    const lyricsTextHash = textHash(JSON.stringify(candidate.raw ?? {}));
    const existingIdentity = byText.get(lyricsTextHash) ?? identity;
    const existing = byIdentity.get(existingIdentity);
    const merged = existing
      ? {
          ...betterCandidate(existing, candidate),
          reasons: mergeReasons(existing.reasons, candidate.reasons),
        }
      : candidate;

    byIdentity.set(existingIdentity, merged as T);
    byText.set(lyricsTextHash, existingIdentity);
  }

  return Array.from(byIdentity.values());
};

export const sortLyricsCandidates = <T extends DedupableLyricsCandidate>(queryDuration: number | null | undefined, candidates: T[]): T[] =>
  [...candidates].sort((left, right) => {
    const riskDelta = riskRank(left.risk) - riskRank(right.risk);
    if (riskDelta !== 0) return riskDelta;

    if (right.score !== left.score) return right.score - left.score;
    if (right.hasSynced !== left.hasSynced) return right.hasSynced ? 1 : -1;

    const leftAuto = left.reasons?.includes('auto_accept') ? 1 : 0;
    const rightAuto = right.reasons?.includes('auto_accept') ? 1 : 0;
    if (rightAuto !== leftAuto) return rightAuto - leftAuto;

    const secondaryLyricsDelta = (right.secondaryLyricsPriority ?? 0) - (left.secondaryLyricsPriority ?? 0);
    if (secondaryLyricsDelta !== 0) return secondaryLyricsDelta;

    const priorityDelta = (right.providerPriority ?? 0) - (left.providerPriority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;

    const providerDelta = providerRank(left.provider) - providerRank(right.provider);
    if (providerDelta !== 0) return providerDelta;

    const leftDelta = getDurationDelta(queryDuration, left.durationSeconds) ?? Number.MAX_SAFE_INTEGER;
    const rightDelta = getDurationDelta(queryDuration, right.durationSeconds) ?? Number.MAX_SAFE_INTEGER;
    if (leftDelta !== rightDelta) return leftDelta - rightDelta;

    return 0;
  });
