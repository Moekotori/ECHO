import type { LyricsMatchRisk, LyricsQuery, LyricsSearchCandidate } from '../../shared/types/lyrics';
import { buildNormalizedLyricsQuery, type NormalizedLyricsQuery } from './lyricsQueryBuilder';
import {
  extractLyricsVersionFlags,
  getVersionRisk,
  hasLyricsVersionConflict,
  type LyricsVersionFlags,
} from './lyricsVersionFlags';
import { normalizeTextForSearch } from './lyricsTextNormalization';
export { normalizeText, normalizeTextForIdentity, normalizeTextForSearch } from './lyricsTextNormalization';

export type LyricsMatchDecision = {
  score: number;
  autoAccept: boolean;
  candidateOnly: boolean;
  rejected: boolean;
  risk: LyricsMatchRisk;
  reasons: string[];
  providerPriorityBonus: number;
  titleScore: number;
  artistScore: number;
  albumScore: number;
  durationScore: number;
  versionScore: number;
};

export type LyricsScoringOptions = {
  autoAcceptScore?: number;
  coverAutoAcceptScore?: number;
  providerPriorityBonus?: number;
  rejectedByUser?: boolean;
};

const tokens = (value: string, normalizer = normalizeTextForSearch): Set<string> => new Set(normalizer(value).split(' ').filter(Boolean));

export const similarity = (
  left: string | null | undefined,
  right: string | null | undefined,
  normalizer: (value: string | null | undefined) => string = normalizeTextForSearch,
): number => {
  const a = normalizer(left);
  const b = normalizer(right);

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (a.includes(b) || b.includes(a)) {
    return 0.88;
  }

  const leftTokens = tokens(a, normalizer);
  const rightTokens = tokens(b, normalizer);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / union.size;
};

export const getDurationDelta = (queryDuration?: number | null, candidateDuration?: number | null): number | null => {
  const query = Number(queryDuration);
  const candidate = Number(candidateDuration);

  if (!Number.isFinite(query) || !Number.isFinite(candidate) || query <= 0 || candidate <= 0) {
    return null;
  }

  return Math.abs(query - candidate);
};

export const scoreLyricsDuration = (queryDuration?: number | null, candidateDuration?: number | null): number => {
  const delta = getDurationDelta(queryDuration, candidateDuration);

  if (delta === null) {
    return 0.45;
  }

  if (delta <= 1) {
    return 1;
  }

  if (delta <= 2) {
    return 0.96;
  }

  if (delta <= 5) {
    return 0.86;
  }

  if (delta <= 10) {
    return 0.62;
  }

  if (delta <= 20) {
    return 0.32;
  }

  return 0.04;
};

const candidateVersionFlags = (
  candidate: Omit<LyricsSearchCandidate, 'id' | 'score'>,
  queryFlags: LyricsVersionFlags,
): LyricsVersionFlags => {
  const flags = extractLyricsVersionFlags(candidate.title, candidate.album, candidate.artist);
  const queryWantsInstrumental = queryFlags.instrumental || queryFlags.karaoke || queryFlags.offVocal;
  const candidateHasInstrumentalLabel = flags.instrumental || flags.karaoke || flags.offVocal;

  if (candidate.instrumental && (queryWantsInstrumental || candidateHasInstrumentalLabel)) {
    flags.instrumental = true;
  }

  return flags;
};

const scoreLyricsVersion = (queryFlags: LyricsVersionFlags, candidateFlags: LyricsVersionFlags): number => {
  if (
    (queryFlags.instrumental || queryFlags.karaoke || queryFlags.offVocal) &&
    !(candidateFlags.instrumental || candidateFlags.karaoke || candidateFlags.offVocal)
  ) {
    return 0.1;
  }

  if (
    queryFlags.cover !== candidateFlags.cover ||
    queryFlags.live !== candidateFlags.live ||
    queryFlags.remix !== candidateFlags.remix ||
    queryFlags.tvSize !== candidateFlags.tvSize ||
    queryFlags.shortVersion !== candidateFlags.shortVersion
  ) {
    if (queryFlags.cover && !candidateFlags.cover) {
      return 0.72;
    }

    return 0.35;
  }

  return 1;
};

const addReason = (reasons: string[], condition: boolean, reason: string): void => {
  if (condition && !reasons.includes(reason)) {
    reasons.push(reason);
  }
};

export const evaluateLyricsCandidate = (
  query: LyricsQuery | NormalizedLyricsQuery,
  candidate: Omit<LyricsSearchCandidate, 'id' | 'score'> & { score?: number },
  options: LyricsScoringOptions = {},
): LyricsMatchDecision => {
  const normalized = 'versionFlags' in query ? query : buildNormalizedLyricsQuery(query);
  const titleScore = similarity(normalized.rawTitle, candidate.title);
  const artistScore = similarity(normalized.rawArtist, candidate.artist);
  const albumScore = normalized.rawAlbum && candidate.album ? similarity(normalized.rawAlbum, candidate.album) : 0.5;
  const durationScore = scoreLyricsDuration(normalized.durationSeconds, candidate.durationSeconds);
  const flags = candidateVersionFlags(candidate, normalized.versionFlags);
  const versionScore = scoreLyricsVersion(normalized.versionFlags, flags);
  const hasSynced = candidate.hasSynced || candidate.instrumental;
  const weights = hasSynced
    ? { title: 0.34, artist: 0.22, album: 0.08, duration: 0.28, version: 0.08 }
    : { title: 0.38, artist: 0.24, album: 0.1, duration: 0.18, version: 0.1 };
  const providerPriorityBonus = options.providerPriorityBonus ?? 0;
  const rawScore =
    titleScore * weights.title +
    artistScore * weights.artist +
    albumScore * weights.album +
    durationScore * weights.duration +
    versionScore * weights.version +
    providerPriorityBonus;
  const delta = getDurationDelta(normalized.durationSeconds, candidate.durationSeconds);
  const versionConflict = hasLyricsVersionConflict(normalized.versionFlags, flags);
  const risk = getVersionRisk(normalized.versionFlags, flags);
  const reasons: string[] = [];
  let candidateOnly = false;
  let rejected = false;

  addReason(reasons, titleScore >= 0.98, 'title_exact');
  addReason(reasons, titleScore >= 0.82 && titleScore < 0.98, 'title_similar');
  addReason(reasons, artistScore >= 0.98, 'artist_exact');
  addReason(reasons, artistScore < 0.75, 'artist_mismatch');
  addReason(reasons, albumScore >= 0.82, 'album_match');
  addReason(reasons, delta !== null && delta <= 1, 'duration_exact');
  addReason(reasons, delta !== null && delta > 1 && delta <= 5, 'duration_close');
  addReason(reasons, delta !== null && delta > 10, 'duration_mismatch');
  addReason(reasons, versionScore >= 0.9, 'version_match');
  addReason(reasons, versionConflict, 'version_conflict');
  addReason(reasons, normalized.coverIntent, 'cover_intent');
  addReason(reasons, hasSynced && delta !== null && delta <= 5, 'synced_duration_safe');

  if (normalized.coverIntent) {
    candidateOnly = true;
    addReason(reasons, true, 'candidate_only_cover');
  }

  if (delta !== null && delta > 10 && hasSynced) {
    candidateOnly = true;
    addReason(reasons, true, 'candidate_only_duration');
  }

  if (delta !== null && delta > 20 && hasSynced) {
    rejected = true;
  }

  if (versionConflict) {
    candidateOnly = true;
  }

  if ((normalized.versionFlags.instrumental || normalized.versionFlags.karaoke || normalized.versionFlags.offVocal) && versionScore <= 0.1) {
    candidateOnly = true;
    rejected = true;
  }

  if (options.rejectedByUser) {
    rejected = true;
    addReason(reasons, true, 'rejected_by_user');
  }

  const score = Math.max(0, Math.min(1, Number(rawScore.toFixed(4))));
  const autoAcceptScore = options.autoAcceptScore ?? 0.7;
  const coverAutoAcceptScore = options.coverAutoAcceptScore ?? 0.97;
  const hasRequiredIdentity = Boolean(normalized.identityTitle && normalized.identityArtist);
  const hasDurationCaution = hasSynced && delta !== null && delta > 5;
  const hasBlockingDurationMismatch = hasSynced && delta !== null && delta > 10;
  const hasCloseDuration = delta !== null && delta <= 2;
  const hasStrongTitle = titleScore >= 0.98;
  const hasStrongVersionLabelMatch = titleScore >= 0.82 && artistScore >= 0.98 && hasCloseDuration && score >= 0.8;
  const hasInstrumentalMismatch =
    (flags.instrumental || flags.karaoke || flags.offVocal) &&
    !(normalized.versionFlags.instrumental || normalized.versionFlags.karaoke || normalized.versionFlags.offVocal);
  const hasArtistMismatch = artistScore < 0.75;
  const hasUnsafeVersionMismatch = versionConflict || versionScore < 0.9;
  const hasBlockingVersionMismatch = hasInstrumentalMismatch || (hasUnsafeVersionMismatch && !hasStrongVersionLabelMatch);
  const coverAutoAcceptSafe =
    !normalized.coverIntent ||
    (score >= Math.min(coverAutoAcceptScore, 0.9) && hasStrongTitle && !hasArtistMismatch && delta !== null && delta <= 5 && !hasBlockingVersionMismatch);
  const autoAccept =
    hasRequiredIdentity &&
    !rejected &&
    !hasBlockingDurationMismatch &&
    !hasArtistMismatch &&
    !hasBlockingVersionMismatch &&
    coverAutoAcceptSafe &&
    score > autoAcceptScore;
  const effectiveRisk: LyricsMatchRisk = autoAccept
    ? 'low'
    : rejected || risk === 'high' || hasBlockingDurationMismatch || hasArtistMismatch || (hasSynced && delta !== null && delta > 20)
      ? 'high'
      : candidateOnly || risk === 'medium' || hasDurationCaution || hasUnsafeVersionMismatch
        ? 'medium'
        : 'low';

  return {
    score,
    autoAccept,
    candidateOnly: candidateOnly || (!autoAccept && !rejected),
    rejected,
    risk: effectiveRisk,
    reasons,
    providerPriorityBonus,
    titleScore,
    artistScore,
    albumScore,
    durationScore,
    versionScore,
  };
};

export const scoreLyricsCandidate = (query: LyricsQuery, candidate: Omit<LyricsSearchCandidate, 'id' | 'score'>): number =>
  evaluateLyricsCandidate(query, candidate).score;

export const canAutoAcceptLyricsCandidate = (
  query: LyricsQuery,
  candidate: LyricsSearchCandidate,
  threshold = 0.7,
): boolean => evaluateLyricsCandidate(query, candidate, { autoAcceptScore: threshold }).autoAccept;
