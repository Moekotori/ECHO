import type { LibraryTrack, PlaybackHistoryEntry, PlaybackStatsAlbum } from '../../../shared/types/library';

const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
const albumIdentity = (title: string, artist: string): string =>
  JSON.stringify([title.trim().toLocaleLowerCase(), artist.trim().toLocaleLowerCase()]);

export const selectRediscoveryAlbums = (
  albums: PlaybackStatsAlbum[],
  recentHistory: PlaybackHistoryEntry[],
  currentTrack: LibraryTrack | null,
  now = Date.now(),
): PlaybackStatsAlbum[] => {
  const cutoff = now - thirtyDaysMs;
  const excluded = new Set(recentHistory
    .filter((entry) => Date.parse(entry.startedAt) >= cutoff)
    .map((entry) => albumIdentity(entry.album, entry.albumArtist || entry.artist)));
  if (currentTrack) excluded.add(albumIdentity(currentTrack.album, currentTrack.albumArtist || currentTrack.artist));
  const seen = new Set<string>();
  return albums.filter((album) => {
    const identity = albumIdentity(album.title, album.albumArtist);
    const lastPlayed = Date.parse(album.lastPlayedAt ?? '');
    if (album.mediaType === 'remote' || !album.albumId || !album.title.trim() || album.playCount < 1 ||
      !Number.isFinite(lastPlayed) || lastPlayed >= cutoff || excluded.has(identity) || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).sort((a, b) => Date.parse(a.lastPlayedAt!) - Date.parse(b.lastPlayedAt!)).slice(0, 4);
};
