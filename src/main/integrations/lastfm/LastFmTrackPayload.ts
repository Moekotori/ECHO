import { basename } from 'node:path';
import type { AudioStatus } from '../../../shared/types/audio';
import type { LastFmTrackPayload } from '../../../shared/types/lastfm';
import type { LibraryTrack } from '../../../shared/types/library';

type LastFmPayloadTrack = Partial<Pick<LibraryTrack, 'title' | 'artist' | 'album' | 'albumArtist' | 'duration' | 'path'>> | null;

export const cleanText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');

export const isUnknownText = (value: unknown, kind: 'artist' | 'album' | 'title'): boolean => {
  const text = cleanText(value).toLowerCase();
  if (!text) {
    return true;
  }

  if (kind === 'artist') {
    return text === 'unknown artist' || text === '<unknown>';
  }

  if (kind === 'album') {
    return text === 'unknown album';
  }

  return text === 'unknown track' || text === 'unknown title';
};

export const firstUseful = (kind: 'artist' | 'album' | 'title', ...values: unknown[]): string => {
  for (const value of values) {
    const text = cleanText(value);
    if (text && !isUnknownText(text, kind)) {
      return text;
    }
  }

  return '';
};

export const pathFileName = (path: unknown): string => {
  const text = String(path ?? '').split(/[?#]/)[0];
  const parts = text.split(/[/\\]/).filter(Boolean);
  return parts.at(-1) ?? '';
};

export const stripExtension = (name: unknown): string => cleanText(name).replace(/\.[^/.]+$/, '');

export const parseArtistTitle = (text: unknown): { artist: string; title: string } | null => {
  const value = cleanText(text);
  if (!value) {
    return null;
  }

  const separators = [' - ', ' -- ', ' | ', ' _ ', ' / ', ' \u2013 ', ' \u2014 '];
  for (const separator of separators) {
    if (!value.includes(separator)) {
      continue;
    }

    const [left, ...rest] = value.split(separator);
    const artist = cleanText(left);
    const title = cleanText(rest.join(separator));
    if (artist && title) {
      return { artist, title };
    }
  }

  return null;
};

const durationFrom = (track: LastFmPayloadTrack, audioStatus?: AudioStatus | null): number => {
  const values = [track?.duration, audioStatus?.durationSeconds];
  for (const value of values) {
    const duration = Number(value);
    if (Number.isFinite(duration) && duration > 0) {
      return duration;
    }
  }

  return 0;
};

export const buildLastFmTrackPayload = (track: LastFmPayloadTrack, audioStatus?: AudioStatus | null): LastFmTrackPayload | null => {
  const fileName = pathFileName(audioStatus?.currentFilePath ?? track?.path ?? '');
  const fileTitle = stripExtension(fileName ? basename(fileName) : '');
  const parsed = parseArtistTitle(track?.title) || parseArtistTitle(fileTitle);
  const title = firstUseful('title', track?.title, parsed?.title, fileTitle);

  if (!title) {
    return null;
  }

  const artist = firstUseful('artist', track?.artist, track?.albumArtist, parsed?.artist) || 'Unknown Artist';
  const album = firstUseful('album', track?.album);

  return {
    artist,
    title,
    album,
    duration: durationFrom(track, audioStatus),
  };
};

export const buildLastFmTrackIdentity = (track: LastFmPayloadTrack, audioStatus?: AudioStatus | null): string => {
  const payload = buildLastFmTrackPayload(track, audioStatus);
  if (!payload) {
    return '';
  }

  return [
    cleanText(audioStatus?.currentTrackId),
    cleanText(audioStatus?.currentFilePath),
    cleanText(payload.artist),
    cleanText(payload.title),
    cleanText(payload.album),
  ].join('\u001f');
};

export const getLastFmScrobbleThresholdSec = (durationSec: number, minimumSeconds = 30): number => {
  const minimum = Number.isFinite(minimumSeconds) && minimumSeconds > 0 ? minimumSeconds : 30;
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration <= 0) {
    return minimum;
  }

  return Math.max(minimum, Math.min(240, duration * 0.5));
};
