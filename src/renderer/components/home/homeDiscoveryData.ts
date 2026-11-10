import type { ContinuousPlayPreference, LibraryAlbum, LibraryTrack } from '../../../shared/types/library';
import type { EchoApi } from '../../../preload/apiTypes';
import { dailySelectionLimit, loadRankedDailyTracks, type HomeDailyTrack } from './homeDailyRecommendations';

export type HomeDiscoveryLibrary = EchoApi['library'];
const dailyStorageKey = 'echo.home-daily-selection.v1';
const featuredStorageKey = 'echo.home-featured-album.v1';
export const discoveryShelfLimit = 6;

export const discoveryDay = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
};

const localSource = { sourceProvider: 'local' } as const;
const playable = (track: LibraryTrack): boolean =>
  !track.unavailable && track.mediaType !== 'remote' && track.mediaType !== 'streaming';

const rank = (value: string): number => {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
};

/** Only ranks bounded query results, never a renderer copy of the library. */
export function selectDailyTracks(familiar: LibraryTrack[], discoveries: LibraryTrack[], seed: string): LibraryTrack[] {
  const selected = new Map<string, LibraryTrack>();
  const ordered = (tracks: LibraryTrack[]): LibraryTrack[] => tracks.filter(playable)
    .sort((left, right) => rank(`${seed}:${left.id}`) - rank(`${seed}:${right.id}`));
  const add = (tracks: LibraryTrack[], limit: number): void => {
    for (const track of tracks) {
      if (selected.size >= limit) break;
      if (!selected.has(track.id)) selected.set(track.id, track);
    }
  };
  add(ordered(familiar), 4);
  add(ordered(discoveries), 6);
  add(ordered([...discoveries, ...familiar]), dailySelectionLimit);
  return [...selected.values()];
}

export async function loadDailyTracks(library: HomeDiscoveryLibrary, signal: AbortSignal, refresh = false,
  preferences: ContinuousPlayPreference[] = []): Promise<HomeDailyTrack[]> {
  const day = discoveryDay();
  const preferenceKey = rank(JSON.stringify(preferences));
  let previousIds: string[] = [];
  {
    try {
      const raw = window.localStorage.getItem(dailyStorageKey);
      const stored = raw && raw.length < 16384 ? JSON.parse(raw) as {
        day?: string; ids?: unknown; preferenceKey?: number; sourceKey?: string;
        reasons?: Record<string, Pick<HomeDailyTrack, 'discoveryReasons' | 'discoverySeedTitle'>>;
      } : null;
      if (stored?.day === day && Array.isArray(stored.ids)
        && (!stored.sourceKey || stored.sourceKey === JSON.stringify(localSource))) {
        const ids = [...new Set(stored.ids.filter((id): id is string => typeof id === 'string' && id.length < 256))].slice(0, dailySelectionLimit);
        previousIds = ids;
        const cacheMatches = !library.getContinuousPlayRecommendations || stored.preferenceKey === preferenceKey;
        const tracks: HomeDailyTrack[] = [];
        if (!refresh && cacheMatches) {
          signal.throwIfAborted();
          const current = (await Promise.all(ids.map(id => library.getTrack(id)))).flatMap(track => track ? [track] : []);
          signal.throwIfAborted();
          const byId = new Map(current.filter(playable).map(track => [track.id, track]));
          tracks.push(...ids.flatMap(id => {
            const track = byId.get(id);
            return track ? [{ ...track, discoveryReasons: stored.reasons?.[id]?.discoveryReasons?.slice(0, 2),
              discoverySeedTitle: stored.reasons?.[id]?.discoverySeedTitle }] : [];
          }));
          if (tracks.length) return tracks;
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      // Invalid saved IDs regenerate from bounded, current library reads.
    }
  }
  const liked = await library.getLikedTracks({ page: 1, pageSize: 12, ...localSource });
  signal.throwIfAborted();
  const familiar = liked.items.flatMap(item => item.track ? [item.track] : []);
  if (typeof library.getContinuousPlayRecommendations === 'function') {
    const tracks = await loadRankedDailyTracks(library, familiar, preferences, signal, refresh ? previousIds : []);
    const reasons = Object.fromEntries(tracks.map(track => [track.id, {
      discoveryReasons: track.discoveryReasons?.map(reason => ({ ...reason,
        value: typeof reason.value === 'string' ? reason.value.slice(0, 160) : reason.value })),
      discoverySeedTitle: track.discoverySeedTitle?.slice(0, 160),
    }]));
    try { window.localStorage.setItem(dailyStorageKey, JSON.stringify({ day, preferenceKey, ids: tracks.map(track => track.id), reasons })); }
    catch { /* Storage is optional. */ }
    return tracks;
  }
  const random = await library.getTracks({ page: 1, pageSize: 32, ...localSource, sort: 'random', randomWindow: true });
  signal.throwIfAborted();
  const unplayed = await library.getTracks({ page: 1, pageSize: 8, ...localSource, sort: 'playCountAsc' });
  signal.throwIfAborted();
  const tracks = selectDailyTracks(familiar,
    [...unplayed.items, ...random.items], refresh ? `${day}:${Date.now()}` : day);
  try { window.localStorage.setItem(dailyStorageKey, JSON.stringify({ day, ids: tracks.map(track => track.id) })); } catch { /* Storage is optional. */ }
  return tracks;
}

export async function loadDiscoveryAlbums(library: HomeDiscoveryLibrary, signal: AbortSignal): Promise<LibraryAlbum[]> {
  const day = discoveryDay();
  let saved: LibraryAlbum | null = null;
  try {
    const raw = window.localStorage.getItem(featuredStorageKey);
    const ref = raw && raw.length < 1024 ? JSON.parse(raw) as { day?: string; id?: unknown; sourceKey?: string } : null;
    if (ref?.day === day && typeof ref.id === 'string') {
      saved = await library.getAlbum(ref.id);
      signal.throwIfAborted();
      if (saved?.mediaType === 'remote' || saved?.mediaType === 'streaming') saved = null;
    }
  } catch { signal.throwIfAborted(); }
  const page = await library.getAlbums({ page: 1, pageSize: 12, ...localSource, sort: 'random', excludeOsuAlbums: true });
  signal.throwIfAborted();
  const featured = saved ?? page.items[rank(day) % Math.max(1, page.items.length)];
  if (!featured) return [];
  try { window.localStorage.setItem(featuredStorageKey, JSON.stringify({ day, id: featured.id })); } catch { /* Storage is optional. */ }
  return [featured, ...page.items.filter(album => album.id !== featured.id)].slice(0, 12);
}

export async function loadUnplayedAlbums(library: HomeDiscoveryLibrary, signal: AbortSignal): Promise<LibraryAlbum[]> {
  const page = await library.getAlbums({ page: 1, pageSize: 12, ...localSource, sort: 'playCountAsc', excludeOsuAlbums: true });
  signal.throwIfAborted();
  const candidates = page.items.slice(0, 12);
  if (!candidates.length) return [];
  const unplayed = await Promise.all(candidates.map(async album => {
    // A title with any matching history stays off this shelf.
    const history = await library.getPlaybackHistory({ page: 1, pageSize: 1, search: album.title, mediaType: 'local' });
    return history.total === 0 ? album : null;
  }));
  signal.throwIfAborted();
  return unplayed.flatMap(album => album ? [album] : []).slice(0, discoveryShelfLimit);
}

export async function loadYearAlbums(library: HomeDiscoveryLibrary, year: number, signal: AbortSignal): Promise<LibraryAlbum[]> {
  const page = await library.getAlbums({ page: 1, pageSize: 24, filterYear: year, search: String(year), ...localSource, excludeOsuAlbums: true });
  signal.throwIfAborted();
  return page.items.filter(album => album.year === year).slice(0, discoveryShelfLimit);
}

/** Explicit album playback only; the cap protects against malformed huge albums. */
export async function loadDiscoveryAlbumTracks(library: HomeDiscoveryLibrary, albumId: string, signal: AbortSignal): Promise<LibraryTrack[]> {
  const tracks: LibraryTrack[] = [];
  for (let page = 1; page <= 10; page++) {
    signal.throwIfAborted();
    const result = await library.getAlbumTracks(albumId, { page, pageSize: 200 });
    signal.throwIfAborted();
    tracks.push(...result.items.filter(track => !track.unavailable));
    if (!result.hasMore) return tracks;
    if (!result.items.length) break;
  }
  throw new Error('Album exceeds the 2,000-track playback limit.');
}
