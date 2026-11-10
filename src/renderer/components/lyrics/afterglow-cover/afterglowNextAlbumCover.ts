import type { LibraryTrack } from '../../../../shared/types/library';
import type { QueueItem } from '../../../stores/PlaybackQueueProvider';

type NextAlbumCoverInput = {
  currentTrack: LibraryTrack | null;
  currentQueueId: string | null;
  currentCoverUrl: string | null;
  items: readonly QueueItem[];
  upcomingItem: QueueItem | null;
  isShuffleEnabled: boolean;
  repeatMode: 'off' | 'one' | 'all';
  coverUrlForTrack: (track: LibraryTrack) => string | null;
};

const albumKey = (track: LibraryTrack): string | null => {
  const album = track.album?.trim().toLocaleLowerCase();
  if (!album) return null;
  const artist = (track.albumArtist || track.artist || '').trim().toLocaleLowerCase();
  return `${artist}\u0000${album}`;
};

/** Show the next distinct album that has artwork; never invent an order in shuffle. */
export const resolveAfterglowNextAlbumCover = ({
  currentTrack,
  currentQueueId,
  currentCoverUrl,
  items,
  upcomingItem,
  isShuffleEnabled,
  repeatMode,
  coverUrlForTrack,
}: NextAlbumCoverInput): string | null => {
  if (!currentTrack || repeatMode === 'one') return null;
  const currentAlbumKey = albumKey(currentTrack);
  const candidateCover = (item: QueueItem | null): string | null => {
    if (!item || item.track.unavailable === true || item.track.id === currentTrack.id) return null;
    if (currentAlbumKey && albumKey(item.track) === currentAlbumKey) return null;
    const cover = coverUrlForTrack(item.track);
    return cover && cover !== currentCoverUrl ? cover : null;
  };

  if (isShuffleEnabled) return candidateCover(upcomingItem);

  const currentIndex = currentQueueId
    ? items.findIndex((item) => item.queueId === currentQueueId)
    : items.findIndex((item) => item.track.id === currentTrack.id);
  if (currentIndex < 0) return null;

  for (let offset = 1; offset < items.length; offset += 1) {
    const index = currentIndex + offset;
    if (index >= items.length && repeatMode !== 'all') break;
    const cover = candidateCover(items[index % items.length]);
    if (cover) return cover;
  }
  return null;
};
