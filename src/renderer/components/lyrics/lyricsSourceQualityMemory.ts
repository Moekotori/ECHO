import type { LyricsMatchRisk, LyricsProviderId, LyricsSearchCandidate } from '../../../shared/types/lyrics';

export type LyricsSourceQualityEventKind = 'candidate' | 'applied' | 'rejected' | 'skipped';

export type LyricsSourceQualityEvent = {
  kind: LyricsSourceQualityEventKind;
  provider: LyricsProviderId;
  score: number;
  risk: LyricsMatchRisk;
  hasSynced: boolean;
  hasPlain: boolean;
  instrumental: boolean;
  reasons: string[];
  at: number;
};

type LyricsSourceQualityMemory = {
  version: 1;
  events: LyricsSourceQualityEvent[];
};

export type LyricsSourceQualityProviderSummary = {
  provider: LyricsProviderId;
  candidateCount: number;
  appliedCount: number;
  rejectedCount: number;
  skippedCount: number;
  averageScore: number;
  bestScore: number;
  lowRiskCount: number;
  syncedCount: number;
  latestAt: number;
};

const storageKey = 'echo-next.lyrics.source-quality.v1';
const maxStoredEvents = 360;
const maxStoredReasons = 6;

const clampScore = (score: number): number => {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(1, score));
};

const normalizeRisk = (risk: LyricsSearchCandidate['risk']): LyricsMatchRisk => (
  risk === 'low' || risk === 'medium' || risk === 'high' ? risk : 'high'
);

const normalizeEvent = (
  candidate: LyricsSearchCandidate,
  kind: LyricsSourceQualityEventKind,
  at: number,
): LyricsSourceQualityEvent => ({
  kind,
  provider: candidate.provider,
  score: clampScore(candidate.score),
  risk: normalizeRisk(candidate.risk),
  hasSynced: candidate.hasSynced === true,
  hasPlain: candidate.hasPlain === true,
  instrumental: candidate.instrumental === true,
  reasons: (candidate.reasons ?? [])
    .filter((reason): reason is string => typeof reason === 'string' && reason.length > 0)
    .slice(0, maxStoredReasons),
  at,
});

const isStoredEvent = (value: unknown): value is LyricsSourceQualityEvent => {
  const event = value as Partial<LyricsSourceQualityEvent>;
  return (
    event.kind === 'candidate' ||
    event.kind === 'applied' ||
    event.kind === 'rejected' ||
    event.kind === 'skipped'
  ) && (
    event.provider === 'local' ||
    event.provider === 'lrclib' ||
    event.provider === 'netease' ||
    event.provider === 'qqmusic' ||
    event.provider === 'kugou' ||
    event.provider === 'kuwo' ||
    event.provider === 'musixmatch' ||
    event.provider === 'genius' ||
    event.provider === 'manual'
  ) && typeof event.score === 'number' && typeof event.at === 'number';
};

const readMemory = (): LyricsSourceQualityMemory => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { version: 1, events: [] };
    }

    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return { version: 1, events: [] };
    }

    const parsed = JSON.parse(raw) as Partial<LyricsSourceQualityMemory>;
    const events = Array.isArray(parsed.events)
      ? parsed.events.filter(isStoredEvent).slice(-maxStoredEvents)
      : [];
    return { version: 1, events };
  } catch {
    return { version: 1, events: [] };
  }
};

const writeMemory = (memory: LyricsSourceQualityMemory): boolean => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        events: memory.events.slice(-maxStoredEvents),
      } satisfies LyricsSourceQualityMemory),
    );
    return true;
  } catch {
    return false;
  }
};

export const recordLyricsSourceQualityCandidates = (
  candidates: LyricsSearchCandidate[],
  now: number = Date.now(),
): boolean => {
  if (candidates.length === 0) {
    return false;
  }

  const memory = readMemory();
  const nextEvents = candidates.map((candidate) => normalizeEvent(candidate, 'candidate', now));
  return writeMemory({
    version: 1,
    events: [...memory.events, ...nextEvents].slice(-maxStoredEvents),
  });
};

export const recordLyricsSourceQualityOutcome = (
  candidate: LyricsSearchCandidate | null | undefined,
  kind: Exclude<LyricsSourceQualityEventKind, 'candidate'>,
  now: number = Date.now(),
): boolean => {
  if (!candidate) {
    return false;
  }

  const memory = readMemory();
  return writeMemory({
    version: 1,
    events: [...memory.events, normalizeEvent(candidate, kind, now)].slice(-maxStoredEvents),
  });
};

export const readLyricsSourceQualitySummaries = (): LyricsSourceQualityProviderSummary[] => {
  const summaries = new Map<LyricsProviderId, LyricsSourceQualityProviderSummary & { scoreTotal: number }>();

  for (const event of readMemory().events) {
    const existing =
      summaries.get(event.provider) ??
      {
        provider: event.provider,
        candidateCount: 0,
        appliedCount: 0,
        rejectedCount: 0,
        skippedCount: 0,
        averageScore: 0,
        bestScore: 0,
        lowRiskCount: 0,
        syncedCount: 0,
        latestAt: 0,
        scoreTotal: 0,
      };

    if (event.kind === 'candidate') {
      existing.candidateCount += 1;
      existing.scoreTotal += event.score;
      existing.bestScore = Math.max(existing.bestScore, event.score);
      if (event.risk === 'low') {
        existing.lowRiskCount += 1;
      }
      if (event.hasSynced) {
        existing.syncedCount += 1;
      }
    } else if (event.kind === 'applied') {
      existing.appliedCount += 1;
    } else if (event.kind === 'rejected') {
      existing.rejectedCount += 1;
    } else if (event.kind === 'skipped') {
      existing.skippedCount += 1;
    }

    existing.latestAt = Math.max(existing.latestAt, event.at);
    summaries.set(event.provider, existing);
  }

  return Array.from(summaries.values())
    .map(({ scoreTotal, ...summary }) => ({
      ...summary,
      averageScore: summary.candidateCount > 0 ? scoreTotal / summary.candidateCount : 0,
    }))
    .sort((left, right) => right.latestAt - left.latestAt || left.provider.localeCompare(right.provider));
};
