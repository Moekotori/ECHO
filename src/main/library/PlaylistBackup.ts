import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import electron from 'electron';
import type { EchoDatabase } from '../database/createDatabase';
import type { AppSettings } from '../../shared/types/appSettings';

type DbRow = Record<string, unknown>;

export type PlaylistBackupReason = 'streaming-refresh' | 'delete' | 'clear' | 'remove-item';

type PlaylistBackupSnapshot = {
  formatVersion: 1;
  app: 'ECHO Next';
  reason: PlaylistBackupReason;
  backedUpAt: string;
  playlist: DbRow;
  itemCount: number;
  items: DbRow[];
};

const backupFolderName = 'ECHO Next Playlist Backups';

const sanitizeFileName = (value: string): string => {
  const normalized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, 80) : 'playlist';
};

const timestampForFileName = (date: Date): string => date.toISOString().replace(/[:.]/g, '-');

export const buildPlaylistBackupSnapshot = (
  database: EchoDatabase,
  playlistId: string,
  reason: PlaylistBackupReason,
  date = new Date(),
): PlaylistBackupSnapshot | null => {
  const playlist = database.prepare<[string], DbRow>('SELECT * FROM playlists WHERE id = ?').get(playlistId);
  if (!playlist) {
    return null;
  }

  const items = database
    .prepare<[string], DbRow>(
      `SELECT
        playlist_items.*,
        tracks.path AS track_path,
        tracks.title AS track_title,
        tracks.artist AS track_artist,
        tracks.album AS track_album,
        tracks.album_artist AS track_album_artist,
        tracks.duration AS track_duration,
        tracks.cover_id AS track_cover_id,
        tracks.missing AS track_missing,
        streaming_tracks.title AS streaming_title,
        streaming_tracks.artist AS streaming_artist,
        streaming_tracks.album AS streaming_album,
        streaming_tracks.duration AS streaming_duration,
        streaming_tracks.cover_url AS streaming_cover_url,
        streaming_tracks.playable AS streaming_playable,
        streaming_tracks.unavailable_reason AS streaming_unavailable_reason
       FROM playlist_items
       LEFT JOIN tracks ON tracks.id = playlist_items.media_id
       LEFT JOIN streaming_tracks
         ON streaming_tracks.provider = playlist_items.source_provider
        AND streaming_tracks.provider_track_id = playlist_items.source_item_id
       WHERE playlist_items.playlist_id = ?
       ORDER BY playlist_items.position ASC, playlist_items.added_at ASC`,
    )
    .all(playlistId);

  return {
    formatVersion: 1,
    app: 'ECHO Next',
    reason,
    backedUpAt: date.toISOString(),
    playlist,
    itemCount: items.length,
    items,
  };
};

export const writePlaylistBackupSnapshot = (
  snapshot: PlaylistBackupSnapshot,
  downloadsDirectory: string,
  date = new Date(snapshot.backedUpAt),
): string => {
  const backupDirectory = join(downloadsDirectory, backupFolderName);
  mkdirSync(backupDirectory, { recursive: true });

  const playlistName = typeof snapshot.playlist.name === 'string' ? snapshot.playlist.name : 'playlist';
  const source = typeof snapshot.playlist.source_provider === 'string' ? snapshot.playlist.source_provider : 'local';
  const fileName = `${timestampForFileName(date)}_${sanitizeFileName(playlistName)}_${source}_${snapshot.reason}.json`;
  const filePath = join(backupDirectory, fileName);

  writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return filePath;
};

export const backupPlaylistToDownloads = (
  database: EchoDatabase,
  playlistId: string,
  reason: PlaylistBackupReason,
  date = new Date(),
): string | null => {
  const snapshot = buildPlaylistBackupSnapshot(database, playlistId, reason, date);
  if (!snapshot) {
    return null;
  }

  const electronApp = (electron as unknown as { app?: { getPath: (name: string) => string } }).app;
  if (!electronApp) {
    return null;
  }

  return writePlaylistBackupSnapshot(snapshot, electronApp.getPath('downloads'), date);
};

export const backupPlaylistIfEnabled = (
  database: EchoDatabase,
  playlistId: string,
  reason: PlaylistBackupReason,
  readSettings: () => Pick<AppSettings, 'playlistBackupsEnabled'>,
): string | null => {
  if (readSettings().playlistBackupsEnabled === false) {
    return null;
  }

  return backupPlaylistToDownloads(database, playlistId, reason);
};
