import type { AudioOutputMode } from '../../../shared/types/audio';
import type { LyricLine } from '../../../shared/types/lyrics';

export type LyricsSmartAlignmentOutputMode = Extract<AudioOutputMode, 'shared' | 'exclusive' | 'asio' | 'system'>;

export type LyricsSmartAlignmentAnchor = {
  lyricLineTimeMs: number;
  playbackMs: number;
  globalOffsetMs: number;
  outputMode: LyricsSmartAlignmentOutputMode;
};

export type LyricsSmartAlignmentConfidence = 'low' | 'medium' | 'high';

export type LyricsSmartAlignmentReason =
  | 'stable_anchors'
  | 'stable_candidates'
  | 'mixed_evidence'
  | 'single_anchor'
  | 'not_enough_evidence'
  | 'no_candidate_match'
  | 'outlier_rejected'
  | 'possible_drift'
  | 'unstable_evidence'
  | 'offset_too_small'
  | 'offset_too_large';

export type LyricsSmartAlignmentAction = 'auto_apply' | 'noop' | 'collect_more' | 'needs_rematch';

export type LyricsSmartAlignmentCandidate = {
  id: string;
  sourceLabel?: string | null;
  score?: number | null;
  lines: Pick<LyricLine, 'timeMs' | 'text'>[];
};

export type LyricsSmartAlignmentEvaluation = {
  offsetMs: number;
  confidence: LyricsSmartAlignmentConfidence;
  reason: LyricsSmartAlignmentReason;
  action: LyricsSmartAlignmentAction;
  outputMode: LyricsSmartAlignmentOutputMode | null;
  anchorCount: number;
  candidateCount: number;
  matchedLineCount: number;
  evidenceCount: number;
  spreadMs: number;
  driftMs: number;
  driftDetected: boolean;
  canAutoApply: boolean;
  canApply: boolean;
  rejectedAnchors: LyricsSmartAlignmentAnchor[];
  rejectedEvidenceCount: number;
};

const minOffsetMs = -10000;
const maxOffsetMs = 10000;
const minAutoOffsetDeltaMs = 80;
const maxAutoOffsetDeltaMs = 3000;
const minAnchorAutoEvidence = 2;
const minCandidateMatchedLines = 3;
const minCandidateMatchRatio = 0.35;
const minOutlierThresholdMs = 240;
const maxOutlierThresholdMs = 900;
const highConfidenceSpreadMs = 180;
const mediumConfidenceSpreadMs = 420;
const driftThresholdMs = 650;

type AlignmentEvidenceSource = 'anchor' | 'candidate';

type AlignmentEvidence = {
  offsetMs: number;
  lyricLineTimeMs: number;
  source: AlignmentEvidenceSource;
  anchor?: LyricsSmartAlignmentAnchor;
  candidateId?: string;
};

const clampOffset = (value: number): number =>
  Math.max(minOffsetMs, Math.min(maxOffsetMs, Math.round(value)));

const clampOutlierThreshold = (value: number): number =>
  Math.max(minOutlierThresholdMs, Math.min(maxOutlierThresholdMs, Math.round(value)));

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const normalizedLinePattern = /[\p{P}\p{S}\s]+/gu;

const normalizeLyricLineText = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\[[^\]]*\]/gu, '')
    .replace(/\([^)]*\)/gu, '')
    .replace(normalizedLinePattern, '');

const isFiniteAnchor = (anchor: LyricsSmartAlignmentAnchor): boolean =>
  Number.isFinite(anchor.lyricLineTimeMs) &&
  Number.isFinite(anchor.playbackMs) &&
  Number.isFinite(anchor.globalOffsetMs) &&
  (
    anchor.outputMode === 'shared' ||
    anchor.outputMode === 'exclusive' ||
    anchor.outputMode === 'asio' ||
    anchor.outputMode === 'system'
  );

export const getLyricsSmartAlignmentRawOffset = (anchor: LyricsSmartAlignmentAnchor): number =>
  anchor.lyricLineTimeMs - (anchor.playbackMs + anchor.globalOffsetMs);

const detectDrift = (evidence: AlignmentEvidence[]): { driftMs: number; driftDetected: boolean } => {
  if (evidence.length < 3) {
    return { driftMs: 0, driftDetected: false };
  }

  const sorted = [...evidence].sort((left, right) => left.lyricLineTimeMs - right.lyricLineTimeMs);
  const firstEvidence = sorted[0]!;
  const lastEvidence = sorted[sorted.length - 1]!;
  const driftMs = Math.round(lastEvidence.offsetMs - firstEvidence.offsetMs);

  return {
    driftMs,
    driftDetected: Math.abs(driftMs) >= driftThresholdMs,
  };
};

const emptyEvaluation = (reason: LyricsSmartAlignmentReason): LyricsSmartAlignmentEvaluation => ({
  offsetMs: 0,
  confidence: 'low',
  reason,
  action: 'collect_more',
  outputMode: null,
  anchorCount: 0,
  candidateCount: 0,
  matchedLineCount: 0,
  evidenceCount: 0,
  spreadMs: 0,
  driftMs: 0,
  driftDetected: false,
  canAutoApply: false,
  canApply: false,
  rejectedAnchors: [],
  rejectedEvidenceCount: 0,
});

const candidateEvidence = (
  currentLines: Pick<LyricLine, 'timeMs' | 'text'>[],
  candidates: LyricsSmartAlignmentCandidate[],
): { evidence: AlignmentEvidence[]; candidateCount: number; matchedLineCount: number } => {
  const evidence: AlignmentEvidence[] = [];
  let candidateCount = 0;
  let matchedLineCount = 0;
  const currentTimedLines = currentLines.filter((line) => line.timeMs >= 0 && normalizeLyricLineText(line.text).length > 0);

  for (const candidate of candidates) {
    const candidateGroups = new Map<string, Array<Pick<LyricLine, 'timeMs' | 'text'>>>();
    for (const line of candidate.lines) {
      const normalized = line.timeMs >= 0 ? normalizeLyricLineText(line.text) : '';
      if (!normalized) {
        continue;
      }
      const group = candidateGroups.get(normalized) ?? [];
      group.push(line);
      candidateGroups.set(normalized, group);
    }

    const matches: AlignmentEvidence[] = [];
    const candidateCursors = new Map<string, number>();
    for (const line of currentTimedLines) {
      const normalized = normalizeLyricLineText(line.text);
      const group = candidateGroups.get(normalized);
      if (!group?.length) {
        continue;
      }

      const cursor = candidateCursors.get(normalized) ?? 0;
      const matchedLine = group[cursor];
      if (!matchedLine) {
        continue;
      }

      candidateCursors.set(normalized, cursor + 1);
      matches.push({
        offsetMs: line.timeMs - matchedLine.timeMs,
        lyricLineTimeMs: line.timeMs,
        source: 'candidate',
        candidateId: candidate.id,
      });
    }

    const matchRatio = currentTimedLines.length > 0 ? matches.length / currentTimedLines.length : 0;
    if (matches.length >= minCandidateMatchedLines && matchRatio >= minCandidateMatchRatio) {
      candidateCount += 1;
      matchedLineCount += matches.length;
      evidence.push(...matches);
    }
  }

  return { evidence, candidateCount, matchedLineCount };
};

const summarizeEvidence = (
  evidence: AlignmentEvidence[],
  currentOffsetMs: number,
): Pick<
  LyricsSmartAlignmentEvaluation,
  | 'offsetMs'
  | 'confidence'
  | 'reason'
  | 'action'
  | 'spreadMs'
  | 'driftMs'
  | 'driftDetected'
  | 'canAutoApply'
  | 'canApply'
  | 'rejectedAnchors'
  | 'rejectedEvidenceCount'
> => {
  const rawOffsets = evidence.map((item) => item.offsetMs);
  const rawMedian = median(rawOffsets);
  const mad = median(rawOffsets.map((offset) => Math.abs(offset - rawMedian)));
  const outlierThresholdMs = clampOutlierThreshold(mad > 0 ? mad * 3 : minOutlierThresholdMs);
  const accepted = evidence.filter((item) =>
    Math.abs(item.offsetMs - rawMedian) <= outlierThresholdMs,
  );
  const effectiveEvidence = accepted.length ? accepted : evidence;
  const effectiveOffsets = effectiveEvidence.map((item) => item.offsetMs);
  const nextOffsetMs = clampOffset(median(effectiveOffsets));
  const spreadMs = Math.max(...effectiveOffsets.map((offset) => Math.abs(offset - nextOffsetMs)), 0);
  const rejectedEvidence = evidence.filter((item) => !effectiveEvidence.includes(item));
  const rejectedAnchors = rejectedEvidence.flatMap((item) => (item.anchor ? [item.anchor] : []));
  const { driftMs, driftDetected } = detectDrift(effectiveEvidence);
  const anchorEvidenceCount = effectiveEvidence.filter((item) => item.source === 'anchor').length;
  const candidateEvidenceCount = effectiveEvidence.filter((item) => item.source === 'candidate').length;
  const confidence: LyricsSmartAlignmentConfidence =
    effectiveEvidence.length === 1
      ? 'medium'
      : rejectedEvidence.length > 0 || driftDetected || spreadMs > mediumConfidenceSpreadMs
        ? 'low'
        : spreadMs <= highConfidenceSpreadMs
          ? 'high'
          : 'medium';
  let reason: LyricsSmartAlignmentReason =
    effectiveEvidence.length === 1 && anchorEvidenceCount === 1
      ? 'single_anchor'
      : rejectedEvidence.length > 0
        ? 'outlier_rejected'
        : driftDetected
          ? 'possible_drift'
          : spreadMs > mediumConfidenceSpreadMs
            ? 'unstable_evidence'
            : anchorEvidenceCount > 0 && candidateEvidenceCount > 0
              ? 'mixed_evidence'
              : candidateEvidenceCount > 0
                ? 'stable_candidates'
                : 'stable_anchors';
  let action: LyricsSmartAlignmentAction = confidence === 'low' ? 'collect_more' : 'auto_apply';
  const offsetDeltaMs = Math.abs(nextOffsetMs - currentOffsetMs);

  if (driftDetected) {
    action = 'needs_rematch';
    reason = 'possible_drift';
  } else if (offsetDeltaMs < minAutoOffsetDeltaMs) {
    action = 'noop';
    reason = 'offset_too_small';
  } else if (offsetDeltaMs > maxAutoOffsetDeltaMs) {
    action = 'needs_rematch';
    reason = 'offset_too_large';
  } else if (confidence === 'low') {
    action = 'collect_more';
  }

  return {
    offsetMs: nextOffsetMs,
    confidence,
    reason,
    spreadMs: Math.round(spreadMs),
    driftMs,
    driftDetected,
    action,
    canAutoApply: action === 'auto_apply',
    canApply: action === 'auto_apply',
    rejectedAnchors,
    rejectedEvidenceCount: rejectedEvidence.length,
  };
};

export const evaluateLyricsSmartAlignment = ({
  anchors = [],
  currentLines = [],
  candidates = [],
  currentOffsetMs = 0,
}: {
  anchors?: LyricsSmartAlignmentAnchor[];
  currentLines?: Pick<LyricLine, 'timeMs' | 'text'>[];
  candidates?: LyricsSmartAlignmentCandidate[];
  currentOffsetMs?: number;
}): LyricsSmartAlignmentEvaluation => {
  const validAnchors = anchors.filter(isFiniteAnchor);
  const anchorEvidence: AlignmentEvidence[] = validAnchors.map((anchor) => ({
    offsetMs: getLyricsSmartAlignmentRawOffset(anchor),
    lyricLineTimeMs: anchor.lyricLineTimeMs,
    source: 'anchor',
    anchor,
  }));
  const { evidence: matchedCandidateEvidence, candidateCount, matchedLineCount } = candidateEvidence(currentLines, candidates);
  const evidence = [...anchorEvidence, ...matchedCandidateEvidence];

  if (!evidence.length) {
    return {
      ...emptyEvaluation(candidates.length > 0 ? 'no_candidate_match' : 'not_enough_evidence'),
      anchorCount: validAnchors.length,
      candidateCount,
      matchedLineCount,
      outputMode: validAnchors[validAnchors.length - 1]?.outputMode ?? null,
    };
  }

  if (validAnchors.length === 1 && matchedCandidateEvidence.length === 0) {
    const summary = summarizeEvidence(anchorEvidence, currentOffsetMs);
    return {
      ...summary,
      reason: 'single_anchor',
      action: 'collect_more',
      canAutoApply: false,
      canApply: false,
      outputMode: validAnchors[0]!.outputMode,
      anchorCount: validAnchors.length,
      candidateCount,
      matchedLineCount,
      evidenceCount: evidence.length,
    };
  }

  if (validAnchors.length > 0 && validAnchors.length < minAnchorAutoEvidence && matchedCandidateEvidence.length === 0) {
    return {
      ...emptyEvaluation('not_enough_evidence'),
      outputMode: validAnchors[validAnchors.length - 1]?.outputMode ?? null,
      anchorCount: validAnchors.length,
      candidateCount,
      matchedLineCount,
      evidenceCount: evidence.length,
    };
  }

  const summary = summarizeEvidence(evidence, currentOffsetMs);
  const enoughAutoEvidence =
    validAnchors.length >= minAnchorAutoEvidence ||
    matchedCandidateEvidence.length >= minCandidateMatchedLines;

  return {
    ...summary,
    action: enoughAutoEvidence ? summary.action : 'collect_more',
    canAutoApply: enoughAutoEvidence && summary.canAutoApply,
    canApply: enoughAutoEvidence && summary.canApply,
    outputMode: validAnchors[validAnchors.length - 1]?.outputMode ?? null,
    anchorCount: validAnchors.length,
    candidateCount,
    matchedLineCount,
    evidenceCount: evidence.length,
  };
};

export type LyricsSmartAlignmentSuggestion = LyricsSmartAlignmentEvaluation;

export const suggestLyricsSmartAlignment = (
  anchors: LyricsSmartAlignmentAnchor[],
): LyricsSmartAlignmentSuggestion | null => {
  const evaluation = evaluateLyricsSmartAlignment({ anchors });
  if (evaluation.evidenceCount === 0) {
    return null;
  }

  return {
    ...evaluation,
    canApply: evaluation.confidence !== 'low' && evaluation.action !== 'needs_rematch',
    canAutoApply: evaluation.canAutoApply,
  };
};
