import type {
  DiagnosticCoverProtocolActiveRequest,
  DiagnosticCoverProtocolOutcome,
  DiagnosticCoverProtocolRequest,
  DiagnosticCoverProtocolResourceSummary,
  DiagnosticCoverProtocolScheme,
  DiagnosticCoverProtocolSnapshot,
} from '../../shared/types/diagnostics';
import { hashText } from './Logger';

const maxRecentRequests = 120;
const maxTrackedResourceKeys = 5000;
const maxResourceSummaries = 2000;
const topResourceLimit = 24;

type BeginCoverProtocolDiagnosticOptions = {
  scheme: DiagnosticCoverProtocolScheme;
  routeKind: string;
  variant?: string;
  method: string;
  url: string;
  resourceIdentity?: string | null;
  targetHost?: string;
};

type FinishCoverProtocolDiagnosticOptions = {
  outcome: DiagnosticCoverProtocolOutcome;
  statusCode: number;
  source?: string;
  knownBytes?: number;
  contentType?: string | null;
  cacheControl?: string | null;
  error?: string;
};

type ActiveCoverProtocolRequest = Omit<BeginCoverProtocolDiagnosticOptions, 'url' | 'resourceIdentity'> & {
  id: number;
  startedAt: string;
  startedAtMs: number;
  urlHash: string;
  resourceHash?: string;
};

type ResourceStats = {
  scheme: DiagnosticCoverProtocolScheme;
  routeKind: string;
  variant?: string;
  resourceHash: string;
  targetHost?: string;
  requestCount: number;
  knownBytes: number;
  lastOutcome: DiagnosticCoverProtocolOutcome;
  lastStatusCode: number;
  lastCompletedAt: string;
};

let nextRequestId = 1;
let totalRequests = 0;
let totalKnownBytesServed = 0;
let uniqueResourceTrackingTruncated = false;

const activeRequests = new Map<number, ActiveCoverProtocolRequest>();
const recentRequests: DiagnosticCoverProtocolRequest[] = [];
const seenResourceKeys = new Set<string>();
const resourceStats = new Map<string, ResourceStats>();
const byScheme: Record<string, number> = {};
const byOutcome: Record<string, number> = {};
const bySource: Record<string, number> = {};
const byStatusCode: Record<string, number> = {};
const byRouteKind: Record<string, number> = {};
const byVariant: Record<string, number> = {};
const byTargetHost: Record<string, number> = {};

const nowIso = (): string => new Date().toISOString();

const increment = (record: Record<string, number>, key: string | undefined, by = 1): void => {
  const normalized = key?.trim() || 'unknown';
  record[normalized] = (record[normalized] ?? 0) + by;
};

const normalizeKnownBytes = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

const resourceKeyFor = (request: ActiveCoverProtocolRequest): string | null => {
  if (!request.resourceHash) {
    return null;
  }

  return [
    request.scheme,
    request.routeKind,
    request.variant ?? '',
    request.targetHost ?? '',
    request.resourceHash,
  ].join('|');
};

const rememberUniqueResource = (key: string | null): void => {
  if (!key || seenResourceKeys.has(key)) {
    return;
  }

  if (seenResourceKeys.size >= maxTrackedResourceKeys) {
    uniqueResourceTrackingTruncated = true;
    return;
  }

  seenResourceKeys.add(key);
};

const updateResourceStats = (
  request: ActiveCoverProtocolRequest,
  completedAt: string,
  result: FinishCoverProtocolDiagnosticOptions,
  knownBytes: number,
): void => {
  const key = resourceKeyFor(request);
  if (!key) {
    return;
  }

  const existing = resourceStats.get(key);
  if (!existing && resourceStats.size >= maxResourceSummaries) {
    return;
  }

  const stats: ResourceStats = existing ?? {
    scheme: request.scheme,
    routeKind: request.routeKind,
    variant: request.variant,
    resourceHash: request.resourceHash!,
    targetHost: request.targetHost,
    requestCount: 0,
    knownBytes: 0,
    lastOutcome: result.outcome,
    lastStatusCode: result.statusCode,
    lastCompletedAt: completedAt,
  };

  stats.requestCount += 1;
  stats.knownBytes += knownBytes;
  stats.lastOutcome = result.outcome;
  stats.lastStatusCode = result.statusCode;
  stats.lastCompletedAt = completedAt;
  resourceStats.set(key, stats);
};

const cloneCounters = (record: Record<string, number>): Record<string, number> => ({ ...record });

export const beginCoverProtocolDiagnostic = (
  options: BeginCoverProtocolDiagnosticOptions,
): { finish: (result: FinishCoverProtocolDiagnosticOptions) => void } => {
  const id = nextRequestId;
  nextRequestId += 1;
  const startedAt = nowIso();
  const active: ActiveCoverProtocolRequest = {
    scheme: options.scheme,
    routeKind: options.routeKind || 'unknown',
    variant: options.variant || undefined,
    method: options.method || 'GET',
    targetHost: options.targetHost,
    id,
    startedAt,
    startedAtMs: Date.now(),
    urlHash: hashText(options.url),
    resourceHash: options.resourceIdentity ? hashText(options.resourceIdentity) : undefined,
  };
  let finished = false;

  activeRequests.set(id, active);

  return {
    finish(result) {
      if (finished) {
        return;
      }
      finished = true;

      const completedAt = nowIso();
      const knownBytes = normalizeKnownBytes(result.knownBytes) ?? 0;
      activeRequests.delete(id);
      totalRequests += 1;
      totalKnownBytesServed += knownBytes;
      increment(byScheme, active.scheme);
      increment(byOutcome, result.outcome);
      increment(bySource, result.source);
      increment(byStatusCode, String(result.statusCode));
      increment(byRouteKind, active.routeKind);
      increment(byVariant, active.variant ?? active.routeKind);
      increment(byTargetHost, active.targetHost);

      const resourceKey = resourceKeyFor(active);
      rememberUniqueResource(resourceKey);
      updateResourceStats(active, completedAt, result, knownBytes);

      recentRequests.unshift({
        id,
        scheme: active.scheme,
        routeKind: active.routeKind,
        variant: active.variant,
        method: active.method,
        urlHash: active.urlHash,
        resourceHash: active.resourceHash,
        targetHost: active.targetHost,
        source: result.source,
        outcome: result.outcome,
        statusCode: result.statusCode,
        startedAt: active.startedAt,
        completedAt,
        durationMs: Math.max(0, Date.now() - active.startedAtMs),
        knownBytes: knownBytes || undefined,
        contentType: result.contentType ?? undefined,
        cacheControl: result.cacheControl ?? undefined,
        error: result.error,
      });
      if (recentRequests.length > maxRecentRequests) {
        recentRequests.length = maxRecentRequests;
      }
    },
  };
};

export const getCoverProtocolDiagnosticsSnapshot = (): DiagnosticCoverProtocolSnapshot => {
  const now = Date.now();
  const active: DiagnosticCoverProtocolActiveRequest[] = Array.from(activeRequests.values())
    .sort((left, right) => right.startedAtMs - left.startedAtMs)
    .map((request) => ({
      id: request.id,
      scheme: request.scheme,
      routeKind: request.routeKind,
      variant: request.variant,
      method: request.method,
      urlHash: request.urlHash,
      resourceHash: request.resourceHash,
      targetHost: request.targetHost,
      startedAt: request.startedAt,
      activeMs: Math.max(0, now - request.startedAtMs),
    }));
  const topResources: DiagnosticCoverProtocolResourceSummary[] = Array.from(resourceStats.values())
    .sort((left, right) =>
      (right.knownBytes - left.knownBytes) ||
      (right.requestCount - left.requestCount) ||
      right.lastCompletedAt.localeCompare(left.lastCompletedAt),
    )
    .slice(0, topResourceLimit)
    .map((resource) => ({ ...resource }));

  return {
    timestamp: nowIso(),
    totalRequests,
    activeRequestCount: activeRequests.size,
    activeRequests: active,
    recentRequests: [...recentRequests],
    maxRecentRequests,
    byScheme: cloneCounters(byScheme),
    byOutcome: cloneCounters(byOutcome),
    bySource: cloneCounters(bySource),
    byStatusCode: cloneCounters(byStatusCode),
    byRouteKind: cloneCounters(byRouteKind),
    byVariant: cloneCounters(byVariant),
    byTargetHost: cloneCounters(byTargetHost),
    totalKnownBytesServed,
    recentKnownBytesServed: recentRequests.reduce((total, request) => total + (request.knownBytes ?? 0), 0),
    trackedUniqueResourceCount: seenResourceKeys.size,
    uniqueResourceTrackingTruncated,
    topResources,
  };
};

export const resetCoverProtocolDiagnosticsForTests = (): void => {
  nextRequestId = 1;
  totalRequests = 0;
  totalKnownBytesServed = 0;
  uniqueResourceTrackingTruncated = false;
  activeRequests.clear();
  recentRequests.length = 0;
  seenResourceKeys.clear();
  resourceStats.clear();
  for (const record of [byScheme, byOutcome, bySource, byStatusCode, byRouteKind, byVariant, byTargetHost]) {
    for (const key of Object.keys(record)) {
      delete record[key];
    }
  }
};
