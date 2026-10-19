import type { LibrarySort } from '../../shared/types/library';
import { unifiedTrackOrderSql } from './LibraryTrackSortOrder';

/** Keep large metadata/cover payloads out of the UNION and its sorting buffer. */
export const trackSortProjection = (
  sorts: LibrarySort[], searchActive: boolean, media: 'local' | 'remote', withPlaybackStats: boolean,
): string => {
  const local = media === 'local';
  const table = local ? 'tracks' : 'remote_tracks';
  const stats = local ? 'local_playback_stats' : 'remote_playback_stats';
  const expressions: Record<string, string> = {
    id: `${table}.id`,
    media_type: `'${media}'`,
    title: `${table}.title`, artist: `${table}.artist`, album: `${table}.album`,
    disc_no: `${table}.disc_no`, track_no: `${table}.track_no`,
    year: `${table}.year`, duration: local ? 'tracks.duration' : 'COALESCE(remote_tracks.duration, 0)',
    created_at: `${table}.created_at`, updated_at: `${table}.updated_at`,
    mtime_ms: local ? 'tracks.mtime_ms' : "COALESCE(CAST(strftime('%s', remote_tracks.modified_at) AS INTEGER) * 1000, 0)",
    codec: `${table}.codec`, sample_rate: `${table}.sample_rate`, bit_depth: `${table}.bit_depth`,
    bitrate: `${table}.bitrate`, size_bytes: `${table}.size_bytes`, bpm: local ? 'tracks.bpm' : 'NULL',
    path: local ? 'tracks.path' : "'remote://' || remote_tracks.source_id || remote_tracks.remote_path",
    play_count: withPlaybackStats ? `COALESCE(${stats}.play_count, 0)` : local ? 'tracks.play_count' : '0',
    last_played_at: withPlaybackStats ? `${stats}.last_played_at` : local ? 'tracks.last_played_at' : 'NULL',
    search_rank: searchActive && (sorts[0] ?? 'default') === 'default' ? `bm25(${table}_fts)` : '0',
  };
  // Relevance is needed only for the default search order. Explicit sorts avoid bm25.
  const order = unifiedTrackOrderSql(sorts, searchActive);
  // Both UNION branches must have exactly the same columns, in the same order.
  const columns = new Set(['id', 'media_type', 'play_count', 'last_played_at', 'search_rank']);
  for (const name of order.match(/\b[a-z_]+\b/g) ?? []) {
    if (Object.hasOwn(expressions, name)) columns.add(name);
  }
  return [...columns].map((name) => `${expressions[name]} AS ${name}`).join(', ');
};
