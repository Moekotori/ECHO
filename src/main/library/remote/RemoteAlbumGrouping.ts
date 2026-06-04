import type { RemoteAlbumMergeStrategy } from '../../../shared/types/appSettings';
import { normalizeAlbumTitleForLooseMerge } from '../AlbumService';

export type RemoteAlbumGroupingTrack = {
  id: string;
  sourceId: string;
  provider: string;
  remotePath: string;
  album: string;
  albumArtist: string;
  artist: string;
  year: number | null;
  fieldSources: Record<string, string>;
};

const serverAlbumProviders = new Set(['subsonic', 'jellyfin', 'emby']);
const fallbackAlbumArtistSources = new Set(['artist_fallback', 'filename_fallback', 'unknown', 'missing']);

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const lowerClean = (value: unknown): string => clean(value).toLocaleLowerCase();

export const normalizeRemoteAlbumMergeStrategy = (value: unknown): RemoteAlbumMergeStrategy =>
  value === 'standard' ? 'standard' : 'conservative';

export const remoteDirectoryName = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.replace(/\\/gu, '/').replace(/\/+$/u, '');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index).toLocaleLowerCase() : '';
};

export const normalizeRemoteAlbumTitleForMerge = (value: unknown): string => {
  const normalized = typeof value === 'string' ? normalizeAlbumTitleForLooseMerge(value) : '';
  if (!normalized || normalized === 'unknown album') {
    return normalized;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length > 1 && tokens[tokens.length - 1] === 'single') {
    tokens.pop();
  }

  return tokens.join(' ');
};

export const remoteAlbumGroupingKey = (
  track: RemoteAlbumGroupingTrack,
  strategy: RemoteAlbumMergeStrategy,
): string => {
  const albumTitle = clean(track.album);
  const conservativeAlbum = albumTitle ? albumTitle.toLocaleLowerCase() : track.id;
  const standardAlbum = normalizeRemoteAlbumTitleForMerge(track.album);
  const albumIdentity = strategy === 'standard' && standardAlbum && standardAlbum !== 'unknown album' ? standardAlbum : conservativeAlbum;
  const yearIdentity = track.year ? String(track.year) : '';
  const coverArtIdentity = clean(track.fieldSources.coverArt);
  const albumArtistIdentity = lowerClean(track.albumArtist || track.artist || 'Unknown Artist') || 'unknown artist';
  const albumArtistSource = lowerClean(track.fieldSources.albumArtist);
  const albumArtistLooksFallback =
    fallbackAlbumArtistSources.has(albumArtistSource) || lowerClean(track.albumArtist) === lowerClean(track.artist);
  const serverAlbumIdentity = clean(track.fieldSources.albumId || track.fieldSources.serverAlbumId);

  if (serverAlbumProviders.has(track.provider) && serverAlbumIdentity) {
    return [track.sourceId, track.provider, 'server-album', serverAlbumIdentity].join('\u001f');
  }

  if (serverAlbumProviders.has(track.provider) && albumTitle) {
    return [
      track.sourceId,
      track.provider,
      'server-title',
      ...(strategy === 'standard' ? [remoteDirectoryName(track.remotePath)] : []),
      albumIdentity,
      yearIdentity,
    ].join('\u001f');
  }

  if (!serverAlbumProviders.has(track.provider) && albumArtistLooksFallback) {
    return [
      track.sourceId,
      track.provider,
      'folder-album',
      remoteDirectoryName(track.remotePath),
      albumIdentity,
      yearIdentity,
      ...(strategy === 'standard' ? [] : [coverArtIdentity]),
    ].join('\u001f');
  }

  return [track.sourceId, track.provider, albumArtistIdentity, albumIdentity, yearIdentity].join('\u001f');
};
