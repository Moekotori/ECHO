import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { StreamingPlaylistDetail, StreamingTrack } from '../../shared/types/streaming';
import { streamingStableKey } from '../../shared/types/streaming';

export type ParsedM3u8Entry = {
  url: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
};

export type ParsedM3u8Playlist = {
  title: string | null;
  entries: ParsedM3u8Entry[];
};

export const encodeM3u8ProviderTrackId = (url: string): string => Buffer.from(url, 'utf8').toString('base64url');

export const decodeM3u8ProviderTrackId = (providerTrackId: string): string => Buffer.from(providerTrackId, 'base64url').toString('utf8');

const httpUrlPattern = /^https?:\/\/\S+/iu;

const parseExtInf = (line: string): { duration: number | null; title: string | null } | null => {
  const match = line.match(/^#EXTINF:([^,]*),(.*)$/iu);
  if (!match) {
    return null;
  }

  const duration = Number.parseFloat(match[1].trim());
  const title = match[2].trim();
  return {
    duration: Number.isFinite(duration) && duration >= 0 ? duration : null,
    title: title || null,
  };
};

const titleParts = (value: string | null, fallbackUrl: string): { title: string; artist: string } => {
  const fallbackTitle = (() => {
    try {
      const url = new URL(fallbackUrl);
      const fileName = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
      return fileName.replace(/\.[^.]+$/u, '') || url.hostname;
    } catch {
      return 'Untitled Stream';
    }
  })();

  const title = value?.trim() || fallbackTitle;
  const split = title.match(/^(.+?)\s+-\s+(.+)$/u);
  if (split) {
    return { title: split[2].trim() || title, artist: split[1].trim() || 'Unknown Artist' };
  }

  return { title, artist: 'Unknown Artist' };
};

export const parseM3u8Playlist = (content: string): ParsedM3u8Playlist => {
  const entries: ParsedM3u8Entry[] = [];
  let playlistTitle: string | null = null;
  let pendingExtInf: { duration: number | null; title: string | null } | null = null;

  for (const rawLine of content.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith('#PLAYLIST:')) {
      playlistTitle = line.slice('#PLAYLIST:'.length).trim() || playlistTitle;
      continue;
    }

    const extInf = parseExtInf(line);
    if (extInf) {
      pendingExtInf = extInf;
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    if (!httpUrlPattern.test(line)) {
      pendingExtInf = null;
      continue;
    }

    const parts = titleParts(pendingExtInf?.title ?? null, line);
    entries.push({
      url: line,
      title: parts.title,
      artist: parts.artist,
      album: playlistTitle ?? 'M3U8 Playlist',
      duration: pendingExtInf?.duration ?? null,
    });
    pendingExtInf = null;
  }

  return { title: playlistTitle, entries };
};

export const m3u8PlaylistIdForFile = (filePath: string): string =>
  createHash('sha1').update(filePath).digest('hex').slice(0, 24);

export const buildM3u8StreamingPlaylistDetail = (
  filePath: string,
  content: string,
): StreamingPlaylistDetail => {
  const parsed = parseM3u8Playlist(content);
  const playlistTitle = (parsed.title ?? basename(filePath).replace(/\.(m3u8?|txt)$/iu, '')) || 'M3U8 Playlist';
  const providerPlaylistId = m3u8PlaylistIdForFile(filePath);
  const tracks: StreamingTrack[] = parsed.entries.map((entry) => {
    const providerTrackId = encodeM3u8ProviderTrackId(entry.url);
    return {
      id: streamingStableKey('m3u8', providerTrackId),
      provider: 'm3u8',
      providerTrackId,
      stableKey: streamingStableKey('m3u8', providerTrackId),
      title: entry.title,
      artist: entry.artist,
      artists: [],
      album: entry.album,
      albumId: null,
      albumArtist: null,
      duration: entry.duration,
      coverUrl: null,
      coverThumb: null,
      qualities: ['standard'],
      explicit: false,
      playable: true,
      unavailableReason: null,
      lyricsStatus: 'unknown',
      mvStatus: 'unknown',
    };
  });

  return {
    id: `streaming:m3u8:playlist:${providerPlaylistId}`,
    provider: 'm3u8',
    providerPlaylistId,
    title: playlistTitle,
    description: `Imported from ${basename(filePath)}`,
    creator: null,
    coverUrl: null,
    coverThumb: null,
    trackCount: tracks.length,
    tracks,
    page: 1,
    pageSize: tracks.length,
    total: tracks.length,
    hasMore: false,
  };
};
