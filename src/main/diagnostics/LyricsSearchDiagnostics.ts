import type {
  DiagnosticLyricsSearchActiveRequest,
  DiagnosticLyricsSearchEvent,
  DiagnosticLyricsSearchSnapshot,
  DiagnosticLyricsSearchStorageSnapshot,
} from '../../shared/types/diagnostics';

const maxRecentSearches = 50;

type LyricsSearchKind = DiagnosticLyricsSearchEvent['kind'];
type LyricsSearchTrigger = DiagnosticLyricsSearchEvent['trigger'];

type LyricsSearchInputSummary = DiagnosticLyricsSearchEvent['input'];

type BeginLyricsSearchDiagnosticOptions = {
  kind: LyricsSearchKind;
  trigger: LyricsSearchTrigger;
  providerId: string | null;
  enabledProviderCount: number;
  networkEnabled: boolean;
  deepSearchEnabled: boolean;
  trackIdHash: string;
  queryHash: string;
  staleKey: string;
  input: LyricsSearchInputSummary;
  lyricsCacheHitBeforeSearch: boolean;
};

type FinishLyricsSearchDiagnosticOptions = {
  status: DiagnosticLyricsSearchEvent['status'];
  rawCandidateCount: number;
  returnedCandidateCount: number;
  storedCandidateRowsTouched: number;
  storedCandidateCacheHits: number;
  storedCandidateWrites: number;
  rejectedCandidateCount: number;
  canceled?: boolean;
  error?: string;
  storage?: DiagnosticLyricsSearchStorageSnapshot | null;
};

type ActiveLyricsSearchDiagnostic = BeginLyricsSearchDiagnosticOptions & {
  id: number;
  sequence: number;
  startedAt: string;
  startedAtMs: number;
  activeAtStart: number;
};

let nextSearchId = 1;
let nextSearchSequence = 1;
let lastObservedStorage: DiagnosticLyricsSearchStorageSnapshot | null = null;

const activeSearches = new Map<number, ActiveLyricsSearchDiagnostic>();
const latestSequenceByStaleKey = new Map<string, number>();
const recentSearches: DiagnosticLyricsSearchEvent[] = [];

const nowIso = (): string => new Date().toISOString();

const pushRecentSearch = (event: DiagnosticLyricsSearchEvent): void => {
  recentSearches.unshift(event);
  if (recentSearches.length > maxRecentSearches) {
    recentSearches.length = maxRecentSearches;
  }
};

export const beginLyricsSearchDiagnostic = (
  options: BeginLyricsSearchDiagnosticOptions,
): { finish: (result: FinishLyricsSearchDiagnosticOptions) => void; isStale: () => boolean } => {
  const id = nextSearchId;
  nextSearchId += 1;
  const sequence = nextSearchSequence;
  nextSearchSequence += 1;
  const startedAt = nowIso();
  const active: ActiveLyricsSearchDiagnostic = {
    ...options,
    id,
    sequence,
    startedAt,
    startedAtMs: Date.now(),
    activeAtStart: activeSearches.size + 1,
  };

  activeSearches.set(id, active);
  latestSequenceByStaleKey.set(options.staleKey, sequence);

  return {
    isStale() {
      return latestSequenceByStaleKey.get(active.staleKey) !== active.sequence;
    },
    finish(result) {
      const completedAt = nowIso();
      const durationMs = Math.max(0, Date.now() - active.startedAtMs);
      const stale = latestSequenceByStaleKey.get(active.staleKey) !== active.sequence;
      activeSearches.delete(id);
      if (result.storage) {
        lastObservedStorage = result.storage;
      }

      pushRecentSearch({
        id,
        kind: active.kind,
        trigger: active.trigger,
        status: result.status,
        startedAt: active.startedAt,
        completedAt,
        durationMs,
        activeAtStart: active.activeAtStart,
        activeAtEnd: activeSearches.size,
        providerId: active.providerId,
        enabledProviderCount: active.enabledProviderCount,
        networkEnabled: active.networkEnabled,
        deepSearchEnabled: active.deepSearchEnabled,
        trackIdHash: active.trackIdHash,
        queryHash: active.queryHash,
        input: active.input,
        result: {
          rawCandidateCount: result.rawCandidateCount,
          returnedCandidateCount: result.returnedCandidateCount,
          storedCandidateRowsTouched: result.storedCandidateRowsTouched,
          storedCandidateCacheHits: result.storedCandidateCacheHits,
          storedCandidateWrites: result.storedCandidateWrites,
          rejectedCandidateCount: result.rejectedCandidateCount,
          lyricsCacheHitBeforeSearch: active.lyricsCacheHitBeforeSearch,
        },
        canceled: result.canceled === true,
        stale,
        error: result.error,
        storage: result.storage ?? null,
      });
    },
  };
};

export const getLyricsSearchDiagnosticsSnapshot = (): DiagnosticLyricsSearchSnapshot => {
  const now = Date.now();
  const activeRequests: DiagnosticLyricsSearchActiveRequest[] = Array.from(activeSearches.values())
    .sort((left, right) => right.startedAtMs - left.startedAtMs)
    .map((active) => ({
      id: active.id,
      kind: active.kind,
      trigger: active.trigger,
      startedAt: active.startedAt,
      activeMs: Math.max(0, now - active.startedAtMs),
      providerId: active.providerId,
      trackIdHash: active.trackIdHash,
      queryHash: active.queryHash,
    }));

  return {
    timestamp: nowIso(),
    activeSearchCount: activeSearches.size,
    activeByKind: {
      track: activeRequests.filter((request) => request.kind === 'track').length,
      snapshot: activeRequests.filter((request) => request.kind === 'snapshot').length,
    },
    activeRequests,
    recentSearches: [...recentSearches],
    lastObservedStorage,
    maxRecentSearches,
  };
};
