import { createHash, randomUUID } from 'node:crypto';
import type { LyricsProviderId, LyricsQuery, LyricsSearchCandidate } from '../../shared/types/lyrics';
import type { LyricsProvider, LyricsProviderResult } from './LyricsProvider';
import { dedupeLyricsCandidates, sortLyricsCandidates, type DedupableLyricsCandidate } from './lyricsCandidateDedup';
import { buildNormalizedLyricsQuery, type NormalizedLyricsQuery } from './lyricsQueryBuilder';
import { evaluateLyricsCandidate, type LyricsMatchDecision } from './lyricsScoring';
import { parsePlainLyrics, parseSyncedLyrics } from './lyricsParser';

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
  ambiguityGraceMs: number;
  minimumAutoAcceptScoreMargin: number;
  contentConflictGateEnabled: boolean;
  preferredSecondaryFields: Array<'translation' | 'romanization'>;
  isRejected?: (provider: LyricsProviderId, providerLyricsId: string | null) => boolean;
  onBackgroundCandidates?: (candidates: MatchedLyricsCandidate[]) => void | Promise<void>;
  onBackgroundMatch?: (result: LyricsMatchEngineResult) => void | Promise<void>;
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
  totalMatchTimeoutMs: 4000,
  autoAcceptScore: 0.78,
  coverAutoAcceptScore: 0.97,
  deepSearchEnabled: true,
  collectAllCandidates: false,
  preferPrimaryProvider: false,
  relaxedAutoAccept: false,
  ambiguityGraceMs: 250,
  minimumAutoAcceptScoreMargin: 0.06,
  contentConflictGateEnabled: true,
  preferredSecondaryFields: [],
};

const automaticBackgroundTimeoutMs = 8000;
const automaticForegroundTimeoutMs = 2500;
const balancedCandidateGraceMs = 500;
const maxAutomaticNetworkConcurrency = 5;

const providerOrderPriority = (order: LyricsProviderId[], provider: LyricsProvider): number => {
  const index = order.indexOf(provider.id);
  if (index < 0) {
    return provider.priority;
  }

  return 10000 - index * 100;
};

const sortProvidersByOrder = (providers: LyricsProvider[], order: LyricsProviderId[]): LyricsProvider[] =>
  [...providers].sort((left, right) => providerOrderPriority(order, right) - providerOrderPriority(order, left));

const hasText = (value: string | null | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

const hasWordTiming = (result: LyricsProviderResult): boolean => {
  const sources = [result.karaokeLyrics, result.syncedLyrics].filter((source): source is string => Boolean(source));
  return sources.some((source) => parseSyncedLyrics(source).some((line) => Boolean(line.words?.length)));
};

const lyricsCreditLinePattern =
  /^(?:(?:作词|作詞|词|詞|作曲|编曲|編曲|混音|制作人|製作人|歌词提供|歌詞提供)|(?:lyrics?|lyricist|composer|arranger|producer|written by|lrc by))\s*[:：]/iu;

const previewLinesFromResult = (result: LyricsProviderResult): string[] => {
  const source = result.karaokeLyrics ?? result.syncedLyrics ?? result.plainLyrics;
  if (!source) {
    return [];
  }

  const lines = result.karaokeLyrics || result.syncedLyrics
    ? parseSyncedLyrics(source)
    : parsePlainLyrics(source);
  const seen = new Set<string>();
  const preview: string[] = [];
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    preview.push(text);
    if (preview.length >= 4) {
      break;
    }
  }

  return preview;
};

const lyricsFingerprintFromResult = (result: LyricsProviderResult): string | undefined => {
  const source = result.karaokeLyrics ?? result.syncedLyrics ?? result.plainLyrics;
  if (!source) {
    return undefined;
  }

  const lines = result.karaokeLyrics || result.syncedLyrics
    ? parseSyncedLyrics(source)
    : parsePlainLyrics(source);
  const normalized = lines
    .map((line) => line.text.normalize('NFKC').toLocaleLowerCase().trim())
    .filter((line) => line && !lyricsCreditLinePattern.test(line))
    .map((line) => line.replace(/[^\p{Letter}\p{Number}]+/gu, ''))
    .filter(Boolean)
    .filter((line, index, all) => all.indexOf(line) === index)
    .sort()
    .join('\n');
  return normalized ? createHash('sha1').update(normalized).digest('hex') : undefined;
};

const isHighConfidenceCandidate = (candidate: MatchedLyricsCandidate | null): boolean =>
  candidate?.decision.confidence === 'high' && candidate.decision.autoAcceptEligible;

export type LyricsAutoApplySelection<T extends LyricsSearchCandidate = LyricsSearchCandidate> = {
  accepted: T | null;
  blocked: T[];
  blockedReason?: 'lyrics_content_conflict' | 'ambiguous_score_margin';
};

const hasStrongComparableMetadata = (candidate: LyricsSearchCandidate): boolean =>
  (candidate.titleScore ?? 0) >= 0.98 &&
  (candidate.artistScore ?? 0) >= 0.98 &&
  (candidate.versionScore ?? 0) >= 0.9 &&
  candidate.durationDeltaSeconds !== null &&
  candidate.durationDeltaSeconds !== undefined &&
  candidate.autoAcceptEligible === true;

export const selectLyricsAutoApplyCandidate = <T extends LyricsSearchCandidate>(
  candidates: T[],
  options: {
    minimumScoreMargin?: number;
    contentConflictGateEnabled?: boolean;
  } = {},
): LyricsAutoApplySelection<T> => {
  const contenders = candidates.filter((candidate) =>
    candidate.autoAcceptEligible === true &&
    candidate.confidence !== 'blocked' &&
    candidate.risk !== 'high',
  );
  const primary = contenders[0] ?? null;
  if (!primary) {
    return { accepted: null, blocked: [] };
  }

  if (primary.provider === 'local') {
    return { accepted: primary, blocked: [] };
  }

  if (
    options.contentConflictGateEnabled !== false &&
    hasStrongComparableMetadata(primary) &&
    primary.contentFingerprint
  ) {
    const conflicts = contenders.filter((candidate) =>
      candidate !== primary &&
      candidate.provider !== 'local' &&
      hasStrongComparableMetadata(candidate) &&
      Boolean(candidate.contentFingerprint) &&
      candidate.contentFingerprint !== primary.contentFingerprint,
    );
    if (conflicts.length) {
      return {
        accepted: null,
        blocked: [primary, ...conflicts],
        blockedReason: 'lyrics_content_conflict',
      };
    }
  }

  const runnerUp = contenders.find((candidate) => candidate !== primary && candidate.provider !== 'local');
  if (
    runnerUp &&
    (options.minimumScoreMargin ?? 0.06) > 0 &&
    primary.score - runnerUp.score < (options.minimumScoreMargin ?? 0.06)
  ) {
    return {
      accepted: null,
      blocked: [primary, runnerUp],
      blockedReason: 'ambiguous_score_margin',
    };
  }

  return { accepted: primary, blocked: [] };
};

const annotateBlockedSelection = (selection: LyricsAutoApplySelection<MatchedLyricsCandidate>): void => {
  if (!selection.blockedReason) {
    return;
  }

  for (const candidate of selection.blocked) {
    const reasons = Array.from(new Set([
      ...(candidate.reasons ?? []),
      ...candidate.decision.reasons,
      selection.blockedReason,
      'candidate_only_ambiguity',
    ]));
    candidate.reasons = reasons;
    candidate.confidence = 'blocked';
    candidate.autoAcceptEligible = false;
    candidate.risk = candidate.risk === 'high' ? 'high' : 'medium';
    candidate.decision.reasons = reasons;
    candidate.decision.autoAccept = false;
    candidate.decision.autoAcceptEligible = false;
    candidate.decision.confidence = 'blocked';
    candidate.decision.candidateOnly = true;
    candidate.decision.risk = candidate.risk;
  }
};

const finalizeAutomaticCandidate = (
  candidates: MatchedLyricsCandidate[],
  settings: LyricsMatchEngineOptions,
): MatchedLyricsCandidate | null => {
  const selection = selectLyricsAutoApplyCandidate(candidates, {
    minimumScoreMargin: settings.minimumAutoAcceptScoreMargin,
    contentConflictGateEnabled: settings.contentConflictGateEnabled,
  });
  annotateBlockedSelection(selection);
  return selection.accepted;
};

const localDecision = (provider: LyricsProvider, result: LyricsProviderResult, _settings: LyricsMatchEngineOptions): LyricsMatchDecision => {
  const reasons = result.matchReasons?.length ? [...result.matchReasons] : ['local_sidecar_priority'];
  const needsManualDurationCheck = reasons.includes('candidate_only_duration');
  const score = needsManualDurationCheck ? 0.42 : 1;
  const autoAccept = !needsManualDurationCheck;
  return {
    score,
    autoAccept,
    confidence: autoAccept ? 'high' : 'blocked',
    autoAcceptEligible: autoAccept,
    durationDeltaSeconds: needsManualDurationCheck ? 11 : 0,
    candidateOnly: needsManualDurationCheck,
    rejected: false,
    risk: needsManualDurationCheck ? 'medium' : 'low',
    reasons,
    providerPriorityBonus: 0,
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
    const settings = {
      ...defaultOptions,
      ...options,
      ambiguityGraceMs: Math.max(0, Math.min(500, options.ambiguityGraceMs ?? defaultOptions.ambiguityGraceMs)),
      minimumAutoAcceptScoreMargin: Math.max(
        0,
        Math.min(0.2, options.minimumAutoAcceptScoreMargin ?? defaultOptions.minimumAutoAcceptScoreMargin),
      ),
    };
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
        const accepted = finalizeAutomaticCandidate(sorted, settings);
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
        accepted: finalizeAutomaticCandidate(candidates, settings),
        candidates,
      };
    }

    if (!settings.deepSearchEnabled) {
      const collected: MatchedLyricsCandidate[] = [...localCollected];
      for (const provider of networkProviders) {
        const providerCandidates = await this.searchProvider(provider, query, normalized, settings, new AbortController().signal);
        collected.push(...providerCandidates);
        const sorted = sortLyricsCandidates(normalized.durationSeconds, dedupeLyricsCandidates(collected));
        const accepted = finalizeAutomaticCandidate(sorted, settings);
        if (accepted && !settings.collectAllCandidates) {
          return { normalized, accepted, candidates: sorted };
        }
      }

      const candidates = sortLyricsCandidates(normalized.durationSeconds, dedupeLyricsCandidates(collected));
      return {
        normalized,
        accepted: finalizeAutomaticCandidate(candidates, settings),
        candidates,
      };
    }

    const totalController = new AbortController();
    const foregroundTimeoutMs = settings.collectAllCandidates
      ? settings.totalMatchTimeoutMs
      : Math.min(settings.totalMatchTimeoutMs, automaticForegroundTimeoutMs);
    const backgroundEnabled = !settings.collectAllCandidates &&
      Boolean(settings.onBackgroundCandidates || settings.onBackgroundMatch);
    const totalTimeoutMs = backgroundEnabled
      ? Math.max(foregroundTimeoutMs, automaticBackgroundTimeoutMs)
      : foregroundTimeoutMs;
    const totalTimer = setTimeout(() => totalController.abort(), totalTimeoutMs);
    let foregroundTimer: ReturnType<typeof setTimeout> | null = null;
    let ambiguityGraceTimer: ReturnType<typeof setTimeout> | null = null;
    let ambiguityGraceDeadline: Promise<{ ambiguityGraceExpired: true }> | null = null;
    const foregroundDeadline = new Promise<{ foregroundExpired: true }>((resolve) => {
      foregroundTimer = setTimeout(() => resolve({ foregroundExpired: true }), foregroundTimeoutMs);
    });
    const pending = new Map<LyricsProviderId, Promise<MatchedLyricsCandidate[]>>();
    const collected: MatchedLyricsCandidate[] = [...localCollected];
    let backgroundScheduled = false;
    let nextProviderIndex = 0;
    const maxNetworkConcurrency = Math.min(maxAutomaticNetworkConcurrency, networkProviders.length);
    const startNextProvider = (): void => {
      if (nextProviderIndex >= networkProviders.length || totalController.signal.aborted) {
        return;
      }

      const provider = networkProviders[nextProviderIndex];
      nextProviderIndex += 1;
      pending.set(provider.id, this.searchProvider(provider, query, normalized, settings, totalController.signal));
    };

    const collectRemainingInBackground = async (): Promise<void> => {
      try {
        while (pending.size && !totalController.signal.aborted) {
          const next = await Promise.race(
            Array.from(pending.entries()).map(async ([id, promise]) => ({
              id,
              candidates: await promise.catch(() => [] as MatchedLyricsCandidate[]),
            })),
          );
          pending.delete(next.id);
          startNextProvider();
          if (!next.candidates.length) {
            continue;
          }

          collected.push(...next.candidates);
          const backgroundCandidates = sortLyricsCandidates(
            normalized.durationSeconds,
            dedupeLyricsCandidates(collected),
          );
          await settings.onBackgroundCandidates?.(backgroundCandidates);
        }

        const backgroundCandidates = sortLyricsCandidates(
          normalized.durationSeconds,
          dedupeLyricsCandidates(collected),
        );
        const backgroundAccepted = finalizeAutomaticCandidate(backgroundCandidates, settings);
        await settings.onBackgroundMatch?.({
          normalized,
          accepted: backgroundAccepted,
          candidates: backgroundCandidates,
        });
      } catch {
        // Background candidates are opportunistic and must never affect playback.
      } finally {
        clearTimeout(totalTimer);
        totalController.abort();
      }
    };

    try {
      for (let index = 0; index < maxNetworkConcurrency; index += 1) {
        startNextProvider();
      }

      while (pending.size && !totalController.signal.aborted) {
        const providerRaces = Array.from(pending.entries()).map(async ([id, promise]) => ({
          id,
          candidates: await promise.catch(() => [] as MatchedLyricsCandidate[]),
        }));
        const next = await Promise.race([
          ...providerRaces,
          foregroundDeadline,
          ...(ambiguityGraceDeadline ? [ambiguityGraceDeadline] : []),
        ]);
        if ('foregroundExpired' in next) {
          if (backgroundEnabled && pending.size) {
            backgroundScheduled = true;
            void collectRemainingInBackground();
          } else {
            totalController.abort();
          }
          break;
        }
        if ('ambiguityGraceExpired' in next) {
          if (backgroundEnabled && pending.size) {
            backgroundScheduled = true;
            void collectRemainingInBackground();
          } else {
            totalController.abort();
          }
          break;
        }
        pending.delete(next.id);
        startNextProvider();
        collected.push(...next.candidates);
        const sorted = sortLyricsCandidates(normalized.durationSeconds, dedupeLyricsCandidates(collected));
        const hasHighConfidenceCandidate = sorted.some((candidate) => isHighConfidenceCandidate(candidate));
        const hasBalancedAutoCandidate = sorted.some((candidate) =>
          candidate.decision.autoAcceptEligible &&
          candidate.decision.confidence === 'balanced' &&
          candidate.decision.risk !== 'high',
        );
        if (
          (hasHighConfidenceCandidate || hasBalancedAutoCandidate) &&
          !settings.collectAllCandidates &&
          !ambiguityGraceDeadline &&
          pending.size
        ) {
          const graceMs = hasHighConfidenceCandidate
            ? settings.ambiguityGraceMs
            : Math.max(settings.ambiguityGraceMs, balancedCandidateGraceMs);
          ambiguityGraceDeadline = new Promise<{ ambiguityGraceExpired: true }>((resolve) => {
            ambiguityGraceTimer = setTimeout(
              () => resolve({ ambiguityGraceExpired: true }),
              graceMs,
            );
          });
        }
      }
    } finally {
      if (foregroundTimer) {
        clearTimeout(foregroundTimer);
      }
      if (ambiguityGraceTimer) {
        clearTimeout(ambiguityGraceTimer);
      }
      if (!backgroundScheduled) {
        clearTimeout(totalTimer);
      }
    }

    const candidates = sortLyricsCandidates(normalized.durationSeconds, dedupeLyricsCandidates(collected));
    return {
      normalized,
      accepted: finalizeAutomaticCandidate(candidates, settings),
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
      hasWordTiming: hasWordTiming(result),
      hasPlain: Boolean(result.plainLyrics),
      sourceLabel: result.sourceLabel ?? provider.label,
    };
    const decision = provider.id === 'local'
      ? localDecision(provider, result, settings)
      : evaluateLyricsCandidate(normalized, base, {
          autoAcceptScore: settings.autoAcceptScore,
          coverAutoAcceptScore: settings.coverAutoAcceptScore,
          providerPriorityBonus: 0,
          rejectedByUser,
        });

    if (decision.autoAccept) {
      decision.reasons.push('auto_accept');
      decision.reasons.push(decision.confidence === 'high' ? 'confidence_high' : 'confidence_balanced');
    }
    if (base.hasWordTiming) {
      decision.reasons.push('word_timed');
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
      confidence: decision.confidence,
      autoAcceptEligible: decision.autoAcceptEligible,
      durationDeltaSeconds: decision.durationDeltaSeconds,
      previewLines: previewLinesFromResult(result),
      contentFingerprint: lyricsFingerprintFromResult(result),
      matchedSources: [{ provider: provider.id, sourceLabel: result.sourceLabel ?? provider.label }],
      risk: decision.risk,
      reasons: decision.reasons,
      titleScore: decision.titleScore,
      artistScore: decision.artistScore,
      albumScore: decision.albumScore,
      durationScore: decision.durationScore,
      versionScore: decision.versionScore,
      raw: result.raw ?? result,
      lyricsFingerprint: lyricsFingerprintFromResult(result),
      providerPriority: providerOrderPriority(settings.enabledProviders, provider),
      hasTranslation,
      hasRomanization,
      secondaryLyricsPriority,
      decision,
      providerResult: result,
    };
  }
}
