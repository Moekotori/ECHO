import type { LibraryTrack } from '../../shared/types/library';
import type { MvMatchCandidate, MvSettings, NetworkMvProviderId } from '../../shared/types/mv';
import type { MainMvOnlineProvider } from './OnlineMvProviders';
import { MV_MATCH_ALGORITHM_VERSION } from './MvScoring';
import { parseCoverIdentity } from '../matching/coverIdentity';

export const normalizeMvAutoApplyThreshold = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0.3, Math.min(1, value)) : 0.7;

const directTrackSearchQuery = (track: Pick<LibraryTrack, 'title' | 'artist' | 'albumArtist'>): string | undefined => {
  const query = [track.title, track.artist || track.albumArtist]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' ');
  return query || undefined;
};

const titleOnlyTrackSearchQuery = (track: Pick<LibraryTrack, 'title'>): string | undefined => {
  const query = track.title?.trim();
  return query || undefined;
};

type NetworkSearchPlan = {
  primaryQuery: string | undefined;
  fallbackQuery: string | undefined;
};

const networkSearchPlan = (
  track: Pick<LibraryTrack, 'title' | 'artist' | 'albumArtist'>,
  settings: MvSettings,
  query?: string | null,
): NetworkSearchPlan => {
  const explicitQuery = query?.trim();
  if (explicitQuery) {
    return { primaryQuery: explicitQuery, fallbackQuery: undefined };
  }

  const cover = parseCoverIdentity(track.title);
  const searchTrack = { ...track, title: cover.title };
  const baseQuery = settings.titleOnlySearch === true ? titleOnlyTrackSearchQuery(searchTrack) : directTrackSearchQuery(searchTrack);
  if (cover.cover) {
    return { primaryQuery: baseQuery, fallbackQuery: baseQuery ? `${baseQuery} cover` : undefined };
  }
  return {
    primaryQuery: baseQuery ? `${baseQuery} MV` : undefined,
    fallbackQuery: baseQuery,
  };
};

const mergeSearchCandidates = (primary: MvMatchCandidate[], fallback: MvMatchCandidate[]): MvMatchCandidate[] => {
  const merged = new Map(primary.map((candidate) => [candidate.id, candidate]));
  for (const candidate of fallback) {
    if (!merged.has(candidate.id)) {
      merged.set(candidate.id, candidate);
    }
  }
  return [...merged.values()];
};

export const hasCurrentAutoDecision = (candidate: MvMatchCandidate): boolean => {
  if (candidate.autoEligible === false) {
    return false;
  }
  if (candidate.matchVersion !== undefined && candidate.matchVersion !== MV_MATCH_ALGORITHM_VERSION) {
    return false;
  }
  if (!candidate.decision) {
    return true;
  }

  return candidate.decision.algorithmVersion === MV_MATCH_ALGORITHM_VERSION &&
    candidate.decision.autoAccept &&
    candidate.decision.risk === 'low';
};

const searchProviderWithFallback = async (
  provider: MainMvOnlineProvider,
  track: LibraryTrack,
  settings: MvSettings,
  plan: NetworkSearchPlan,
): Promise<MvMatchCandidate[]> => {
  const primary = await provider.search(track, settings, plan.primaryQuery).catch(() => [] as MvMatchCandidate[]);
  const threshold = normalizeMvAutoApplyThreshold(settings.autoApplyThreshold);
  const hasSafePrimaryCandidate = primary.some(
    (candidate) => candidate.playableInApp && hasCurrentAutoDecision(candidate) && candidate.score >= threshold,
  );
  if ((provider.id !== 'bilibili' && !parseCoverIdentity(track.title).cover) || !plan.fallbackQuery || hasSafePrimaryCandidate) {
    return primary;
  }

  const fallback = await provider.search(track, settings, plan.fallbackQuery).catch(() => [] as MvMatchCandidate[]);
  return mergeSearchCandidates(primary, fallback);
};

/** Share concurrent lookups only. Never cache a transient provider failure as a miss. */
export class MvSearchCoordinator {
  private readonly inFlight = new Map<string, Promise<MvMatchCandidate[]>>();

  constructor(private readonly providers: Map<NetworkMvProviderId, MainMvOnlineProvider>) {}

  async search(track: LibraryTrack, settings: MvSettings, query?: string | null): Promise<MvMatchCandidate[]> {
    const plan = networkSearchPlan(track, settings, query);
    const enabled = new Set(settings.enabledProviders);
    const ordered = [...new Set(settings.providerOrder)].filter((id) => enabled.has(id));
    const results = await Promise.all(ordered.map(async (id) => {
      const provider = this.providers.get(id);
      if (!provider) return [];
      const key = JSON.stringify([id, track, settings, plan]);
      const existing = this.inFlight.get(key);
      if (existing) return existing;
      const pending = searchProviderWithFallback(provider, track, settings, plan).catch(() => [] as MvMatchCandidate[]);
      this.inFlight.set(key, pending);
      try {
        return await pending;
      } finally {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
      }
    }));
    return results.flat();
  }
}
