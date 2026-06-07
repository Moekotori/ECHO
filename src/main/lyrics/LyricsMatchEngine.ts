import { randomUUID } from 'node:crypto';
import type { LyricsProviderId, LyricsQuery } from '../../shared/types/lyrics';
import type { LyricsProvider, LyricsProviderResult } from './LyricsProvider';
import { dedupeLyricsCandidates, sortLyricsCandidates, type DedupableLyricsCandidate } from './lyricsCandidateDedup';
import { buildNormalizedLyricsQuery, type NormalizedLyricsQuery } from './lyricsQueryBuilder';
import { evaluateLyricsCandidate, type LyricsMatchDecision } from './lyricsScoring';

export type LyricsMatchEngineOptions = {
  enabledProviders: LyricsProviderId[];
  networkEnabled: boolean;
  providerTimeoutMs: number;
  totalMatchTimeoutMs: number;
  autoAcceptScore: number;
  coverAutoAcceptScore: number;
  deepSearchEnabled: boolean;
  collectAllCandidates: boolean;
  preferPrimaryProvider: boolean;
  relaxedAutoAccept: boolean;
  preferredSecondaryFields: Array<'translation' | 'romanization'>;
  isRejected?: (provider: LyricsProviderId, providerLyricsId: string | null) => boolean;
};

export type MatchedLyricsCandidate = DedupableLyricsCandidate & {
  decision: LyricsMatchDecision;
  providerResult: LyricsProviderResult;
};

export type LyricsMatchEngineResult = {
  normalized: NormalizedLyricsQuery;
  accepted: MatchedLyricsCandidate | null;
  candidates: MatchedLyricsCandidate[];
};

const defaultOptions: LyricsMatchEngineOptions = {
  enabledProviders: ['local', 'lrclib'],
  networkEnabled: true,
  providerTimeoutMs: 4500,
  totalMatchTimeoutMs: 6000,
  autoAcceptScore: 0.7,
  coverAutoAcceptScore: 0.97,
  deepSearchEnabled: true,
  collectAllCandidates: false,
  preferPrimaryProvider: true,
  relaxedAutoAccept: false,
  preferredSecondaryFields: [],
};

const providerPriorityBonus = (priority: number): number => Math.min(0.01, Math.max(0, priority / 100000));
const providerOrderPriority = (order: LyricsProviderId[], provider: LyricsProvider): number => {
  const index = order.indexOf(provider.id);
  if (index < 0) {
    return provider.priority;
  }

  return 10000 - index * 100;
};

const sortProvidersByOrder = (providers: LyricsProvider[], order: LyricsProviderId[]): LyricsProvider[] =>
  [...providers].sort((left, right) => providerOrderPriority(order, right) - providerOrderPriority(order, left));

const streamingPrimaryProviderFromQuery = (query: LyricsQuery): LyricsProviderId => {
  if (query.mediaType !== 'streaming') {
    return 'netease';
  }

  const identity = `${query.trackId ?? ''}\n${query.stableKey ?? ''}`;
  if (/(?:^|\n)streaming:qqmusic:/u.test(identity)) {
    return 'qqmusic';
  }
  if (/(?:^|\n)streaming:kugou:/u.test(identity)) {
    return 'kugou';
  }
  if (/(?:^|\n)streaming:kuwo:/u.test(identity)) {
    return 'kuwo';
  }

  return 'netease';
};

const hasText = (value: string | null | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

const isRelaxedAutoAcceptCandidate = (candidate: MatchedLyricsCandidate | null, settings: LyricsMatchEngineOptions): boolean => {
  if (!settings.relaxedAutoAccept || !candidate) {
    return false;
  }

  const decision = candidate.decision;
  return (
    !decision.rejected &&
    decision.risk === 'medium' &&
    decision.score > settings.autoAcceptScore &&
    decision.titleScore >= 0.82 &&
    decision.artistScore >= 0.75 &&
    decision.durationScore >= 0.62 &&
    decision.versionScore >= 0.7
  );
};

const isAutoAcceptCandidate = (candidate: MatchedLyricsCandidate | null, settings: LyricsMatchEngineOptions): boolean =>
  Boolean(candidate?.decision.autoAccept && candidate.decision.risk === 'low') || isRelaxedAutoAcceptCandidate(candidate, settings);

const localDecision = (provider: LyricsProvider, result: LyricsProviderResult, settings: LyricsMatchEngineOptions): LyricsMatchDecision => {
  const reasons = result.matchReasons?.length ? [...result.matchReasons] : ['local_sidecar_priority'];
  const needsManualDurationCheck = reasons.includes('candidate_only_duration');
  const score = needsManualDurationCheck ? 0.42 : 1;
  const autoAccept = !needsManualDurationCheck;
  return {
    score,
    autoAccept,
    candidateOnly: needsManualDurationCheck,
    rejected: false,
    risk: needsManualDurationCheck ? 'medium' : 'low',
    reasons,
    providerPriorityBonus: providerPriorityBonus(providerOrderPriority(settings.enabledProviders, provider)),
    titleScore: 1,
    artistScore: 1,
    albumScore: 1,
    durationScore: needsManualDurationCheck ? 0.32 : 1,
    versionScore: 1,
  };
};

const sanitizeQueryForProvider = (query: LyricsQuery, provider: LyricsProvider): LyricsQuery =>
  provider.id === 'local'
    ? query
    : {
        trackId: query.trackId,
        mediaType: query.mediaType,
        sourceId: query.sourceId,
        stableKey: query.stableKey,
        title: query.title,
        artist: query.artist,
        album: query.album ?? null,
        durationSeconds: query.durationSeconds ?? null,
        filePath: null,
      };

const mergeSignals = (parent: AbortSignal, child: AbortController): (() => void) => {
  const abort = (): void => child.abort();
  parent.addEventListener('abort', abort, { once: true });
  return () => parent.removeEventListener('abort', abort);
};

export class LyricsMatchEngine {
  constructor(private readonly providers: LyricsProvider[]) {}

  async match(query: LyricsQuery, options: Partial<LyricsMatchEngineOptions> = {}): Promise<LyricsMatchEngineResult> {
    const settings = { ...defaultOptions, ...options };
    const normalized = buildNormalizedLyricsQuery(query);
    const enabled = new Set(settings.enabledProviders);
    const orderedProviders = sortProvidersByOrder(this.providers, settings.enabledProviders);
    const localProviders = orderedProviders.filter((provider) => provider.id === 'local' && enabled.has(provider.id));
    const networkProviders = settings.networkEnabled
      ? orderedProviders.filter((provider) => provider.id !== 'local' && enabled.has(provider.id))
      : [];

    const localCollected: MatchedLyricsCandidate[] = [];
    for (const provider of localProviders) {
      const localCandidates = await this.searchProvider(provider, query, normalized, settings, new AbortController().signal);
      if (localCandidates.length) {
        localCollected.push(...localCandidates);
      }

      if (localCandidates.length && !settings.collectAllCandidates) {
        const sorted = sortLyricsCandidates(normalized.durationSeconds, dedupeLyricsCandidates(localCandidates));
        const accepted = sorted.find((candidate) => isAutoAcceptCandidate(candidate, settings)) ?? null;
        if (!accepted) {
          continue;
        }

        return {
          normalized,
          accepted,
          candidates: sorted,
        };
      }
    }

    if (!networkProviders.length) {
      const candidates = sortLyricsCandidates(normalized.durationSeconds, dedupeLyricsCandidates(localCollected));
      return {
        normalized,
        accepted: candidates.find((candidate) => isAutoAcceptCandidate(candidate, settings)) ?? null,
        candidates,
      };
    }

    if (!settings.deepSearchEnabled) {
      const collected: MatchedLyricsCandidate[] = [...localCollected];
      for (const provider of networkProviders) {
        const providerCandidates = await this.searchProvider(provider, query, normalized, settings, new AbortController().signal);
        collected.push(...providerCandidates);
        const sorted = sortLyricsCandidates(normalized.durationSeconds, dedupeLyricsCandidates(collected));
        const accepted = sorted.find((candidate) => isAutoAcceptCandidate(candidate, settings)) ?? null;
        if (accepted && !settings.collectAllCandidates) {
          return { normalized, accepted, candidates: sorted };
        }
      }

      const candidates = sortLyricsCandidates(normalized.durationSeconds, dedupeLyricsCandidates(collected));
      return {
        normalized,
        accepted: candidates.find((candidate) => isAutoAcceptCandidate(candidate, settings)) ?? null,
        candidates,
      };
    }

    const totalController = new AbortController();
    const totalTimer = setTimeout(() => totalController.abort(), settings.totalMatchTimeoutMs);
    const pending = new Map<LyricsProviderId, Promise<MatchedLyricsCandidate[]>>();
    const collected: MatchedLyricsCandidate[] = [...localCollected];
    let accepted: MatchedLyricsCandidate | null = null;
    const primaryProviderId = streamingPrimaryProviderFromQuery(query);
    const primaryProvider = settings.preferPrimaryProvider && !settings.collectAllCandidates
      ? networkProviders.find((provider) => provider.id === primaryProviderId)
      : undefined;
    const remainingNetworkProviders = primaryProvider
      ? networkProviders.filter((provider) => provider.id !== primaryProvider.id)
      : networkProviders;

    try {
      if (primaryProvider && !totalController.signal.aborted) {
        const primaryCandidates = await this.searchProvider(primaryProvider, query, normalized, settings, totalController.signal);
        collected.push(...primaryCandidates);
        const sorted = sortLyricsCandidates(normalized.durationSeconds, dedupeLyricsCandidates(collected));
        accepted = sorted.find((candidate) => candidate.provider === primaryProvider.id && isAutoAcceptCandidate(candidate, settings)) ?? null;
        if (accepted) {
          return { normalized, accepted, candidates: sorted };
        }
      }

      for (const provider of remainingNetworkProviders) {
        pending.set(provider.id, this.searchProvider(provider, query, normalized, settings, totalController.signal));
      }

      while (pending.size && !totalController.signal.aborted) {
        const next = await Promise.race(
          Array.from(pending.entries()).map(async ([id, promise]) => ({
            id,
            candidates: await promise.catch(() => [] as MatchedLyricsCandidate[]),
          })),
        );
        pending.delete(next.id);
        collected.push(...next.candidates);
        const sorted = sortLyricsCandidates(normalized.durationSeconds, dedupeLyricsCandidates(collected));
        accepted = sorted.find((candidate) => isAutoAcceptCandidate(candidate, settings)) ?? null;
        if (accepted && !settings.collectAllCandidates) {
          totalController.abort();
          break;
        }
      }
    } finally {
      clearTimeout(totalTimer);
    }

    const candidates = sortLyricsCandidates(normalized.durationSeconds, dedupeLyricsCandidates(collected));
    return {
      normalized,
      accepted: accepted ?? candidates.find((candidate) => isAutoAcceptCandidate(candidate, settings)) ?? null,
      candidates,
    };
  }

  private async searchProvider(
    provider: LyricsProvider,
    query: LyricsQuery,
    normalized: NormalizedLyricsQuery,
    settings: LyricsMatchEngineOptions,
    totalSignal: AbortSignal,
  ): Promise<MatchedLyricsCandidate[]> {
    const controller = new AbortController();
    const detach = mergeSignals(totalSignal, controller);
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let detachTimeoutAbort = (): void => {};

    try {
      const providerSearch = provider.search({
        query: sanitizeQueryForProvider(query, provider),
        normalized,
        timeoutMs: settings.providerTimeoutMs,
        signal: controller.signal,
        collectAllCandidates: settings.collectAllCandidates,
      }).catch(() => [] as LyricsProviderResult[]);
      const timeoutSearch = new Promise<LyricsProviderResult[]>((resolve) => {
        const resolveEmpty = (): void => {
          timedOut = true;
          controller.abort();
          resolve([]);
        };
        totalSignal.addEventListener('abort', resolveEmpty, { once: true });
        detachTimeoutAbort = () => totalSignal.removeEventListener('abort', resolveEmpty);
        timer = setTimeout(() => {
          resolveEmpty();
        }, settings.providerTimeoutMs);
      });
      const results = await Promise.race([providerSearch, timeoutSearch]);

      return timedOut || controller.signal.aborted
        ? []
        : results
        .map((result) => this.resultToCandidate(provider, normalized, result, settings))
        .filter((candidate): candidate is MatchedLyricsCandidate => Boolean(candidate));
    } catch {
      return [];
    } finally {
      detach();
      if (timer) {
        clearTimeout(timer);
      }
      detachTimeoutAbort();
    }
  }

  private resultToCandidate(
    provider: LyricsProvider,
    normalized: NormalizedLyricsQuery,
    result: LyricsProviderResult,
    settings: LyricsMatchEngineOptions,
  ): MatchedLyricsCandidate | null {
    if (!result.title || !result.artist) {
      return null;
    }

    const rejectedByUser = settings.isRejected?.(provider.id, result.providerLyricsId) ?? false;
    const base = {
      provider: provider.id,
      providerLyricsId: result.providerLyricsId,
      title: result.title,
      artist: result.artist,
      album: result.album,
      durationSeconds: result.durationSeconds,
      instrumental: result.instrumental,
      hasSynced: Boolean(result.karaokeLyrics || result.syncedLyrics || result.instrumental),
      hasPlain: Boolean(result.plainLyrics),
      sourceLabel: result.sourceLabel ?? provider.label,
    };
    const decision = provider.id === 'local'
      ? localDecision(provider, result, settings)
      : evaluateLyricsCandidate(normalized, base, {
          autoAcceptScore: settings.autoAcceptScore,
          coverAutoAcceptScore: settings.coverAutoAcceptScore,
          providerPriorityBonus: providerPriorityBonus(providerOrderPriority(settings.enabledProviders, provider)),
          rejectedByUser,
        });

    if (decision.autoAccept) {
      decision.reasons.push('auto_accept');
    }

    for (const reason of result.matchReasons ?? []) {
      if (!decision.reasons.includes(reason)) {
        decision.reasons.push(reason);
      }
    }

    const hasTranslation = hasText(result.translationLyrics);
    const hasRomanization = hasText(result.romanizationLyrics);
    const secondaryLyricsPriority = settings.preferredSecondaryFields.reduce((priority, field) => {
      if (field === 'translation' && hasTranslation) {
        return priority + 1;
      }

      if (field === 'romanization' && hasRomanization) {
        return priority + 1;
      }

      return priority;
    }, 0);

    return {
      id: randomUUID(),
      ...base,
      score: decision.score,
      risk: decision.risk,
      reasons: decision.reasons,
      titleScore: decision.titleScore,
      artistScore: decision.artistScore,
      albumScore: decision.albumScore,
      durationScore: decision.durationScore,
      versionScore: decision.versionScore,
      raw: result.raw ?? result,
      providerPriority: providerOrderPriority(settings.enabledProviders, provider),
      hasTranslation,
      hasRomanization,
      secondaryLyricsPriority,
      decision,
      providerResult: result,
    };
  }
}
