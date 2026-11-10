import type { ContinuousPlayPreference, ContinuousPlayReason, LibraryTrack } from '../../../shared/types/library';
import type { EchoApi } from '../../../preload/apiTypes';

export const dailySelectionLimit = 8;

export type HomeDailyTrack = LibraryTrack & {
  discoveryReasons?: ContinuousPlayReason[];
  discoverySeedTitle?: string;
};

export const loadRankedDailyTracks = async (
  library: EchoApi['library'], familiar: LibraryTrack[], preferences: ContinuousPlayPreference[],
  signal: AbortSignal, excludeTrackIds: string[] = [],
): Promise<HomeDailyTrack[]> => {
  const seed = familiar.find(track => !track.unavailable);
  const selected = new Map<string, HomeDailyTrack>();
  const overflow = new Map<string, HomeDailyTrack>();
  const artists = new Set<string>();
  const albums = new Set<string>();
  const add = async (mode: 'similar' | 'deep-cuts' | 'recently-added', target: number): Promise<void> => {
    signal.throwIfAborted();
    const result = await library.getContinuousPlayRecommendations({ mode, limit: 20, preferences,
      seedTrackId: mode === 'similar' ? seed?.id : undefined,
      excludeTrackIds: [...excludeTrackIds, ...(seed ? [seed.id] : []), ...selected.keys()] });
    signal.throwIfAborted();
    for (const item of result.items.slice(0, 20)) {
      if (selected.size >= dailySelectionLimit) break;
      const track = item.track;
      if (!track.unavailable && track.mediaType !== 'remote' && track.mediaType !== 'streaming'
        && track.id !== seed?.id && !selected.has(track.id)) {
        const artist = (track.artist || track.albumArtist || '').normalize('NFKC').trim().toLocaleLowerCase();
        const album = track.album.trim() ? JSON.stringify([track.album, track.albumArtist || track.artist].map(value => value.normalize('NFKC').trim().toLowerCase())) : '';
        const defer = selected.size >= target || (artist && artists.has(artist)) || (album && albums.has(album));
        if (defer && (overflow.has(track.id) || overflow.size >= dailySelectionLimit)) continue;
        const choice = { ...track, discoveryReasons: item.reasons.slice(0, 2),
          discoverySeedTitle: mode === 'similar' ? seed?.title : undefined };
        if (defer) {
          overflow.set(track.id, choice);
          continue;
        }
        selected.set(track.id, choice);
        overflow.delete(track.id);
        if (artist) artists.add(artist);
        if (album) albums.add(album);
      }
    }
  };
  if (seed) await add('similar', 3);
  await add('deep-cuts', 5);
  await add('recently-added', dailySelectionLimit);
  // Small libraries can reuse yesterday's choices after trying fresh candidates.
  if (selected.size + overflow.size < dailySelectionLimit && excludeTrackIds.length) {
    excludeTrackIds = [];
    await add('deep-cuts', dailySelectionLimit);
  }
  for (const [id, track] of overflow) {
    if (selected.size >= dailySelectionLimit) break;
    selected.set(id, track);
  }
  return [...selected.values()];
};
