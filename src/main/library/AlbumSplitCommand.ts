import { basename, dirname, extname, join } from 'node:path';
import type { AlbumSplitFileNamePattern, AlbumSplitFormat } from '../../shared/types/albumSplit';
import { albumSplitFileNamePatterns, albumSplitFormats } from '../../shared/types/albumSplit';

export type AlbumSplitTrackMetadata = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNumber: number;
  trackTotal: number;
  discNumber: number | null;
  year: number | null;
  genre: string | null;
};

export type AlbumSplitFfmpegInput = {
  inputPath: string;
  outputPath: string;
  format: AlbumSplitFormat;
  startSeconds: number;
  durationSeconds: number | null;
  metadata: AlbumSplitTrackMetadata;
  cover: { path: string; mimeType: string | null } | null;
};

const formatSet = new Set<AlbumSplitFormat>(albumSplitFormats);
const patternSet = new Set<AlbumSplitFileNamePattern>(albumSplitFileNamePatterns);

export const normalizeAlbumSplitFormat = (value: unknown): AlbumSplitFormat =>
  formatSet.has(value as AlbumSplitFormat) ? (value as AlbumSplitFormat) : 'flac';

export const normalizeAlbumSplitFileNamePattern = (value: unknown): AlbumSplitFileNamePattern =>
  patternSet.has(value as AlbumSplitFileNamePattern) ? (value as AlbumSplitFileNamePattern) : 'track-title';

/** Formats that can carry an attached picture through FFmpeg's muxers. */
export const albumSplitFormatSupportsCover = (format: AlbumSplitFormat): boolean => format === 'flac' || format === 'mp3';

export const sanitizeAlbumSplitFileName = (value: string): string => {
  // eslint-disable-next-line no-control-regex -- Control chars are illegal in Windows file names.
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '-').replace(/\s+/gu, ' ').replace(/^\.+/u, '').trim();
  return normalized ? normalized.slice(0, 120) : 'Track';
};

export const buildAlbumSplitOutputDir = (sourcePath: string, albumTitle: string): string =>
  join(dirname(sourcePath), sanitizeAlbumSplitFileName(`${albumTitle || basename(sourcePath, extname(sourcePath))} - Tracks`));

export const buildAlbumSplitBackupDir = (sourcePath: string, albumTitle: string): string =>
  join(dirname(sourcePath), sanitizeAlbumSplitFileName(`${albumTitle || basename(sourcePath, extname(sourcePath))} ECHO backup`));

export const buildAlbumSplitFileName = (
  pattern: AlbumSplitFileNamePattern,
  format: AlbumSplitFormat,
  track: { trackNumber: number; discNumber: number | null; title: string; artist: string },
  options: { multiDisc?: boolean; trackTotal?: number } = {},
): string => {
  const width = Math.max(2, String(options.trackTotal ?? 0).length);
  const number = String(track.trackNumber).padStart(width, '0');
  const prefix = options.multiDisc && track.discNumber ? `${track.discNumber}-${number}` : number;
  const title = track.title.trim() || `Track ${track.trackNumber}`;
  const artist = track.artist.trim();
  let stem: string;
  switch (pattern) {
    case 'track-artist-title':
      stem = artist ? `${prefix} - ${artist} - ${title}` : `${prefix} - ${title}`;
      break;
    case 'artist-title':
      stem = artist ? `${artist} - ${title}` : title;
      break;
    case 'title':
      stem = title;
      break;
    case 'track-title':
    default:
      stem = `${prefix} - ${title}`;
      break;
  }
  return `${sanitizeAlbumSplitFileName(stem)}.${format}`;
};

const encoderArgs: Record<AlbumSplitFormat, string[]> = {
  flac: ['-codec:a', 'flac', '-compression_level', '8'],
  mp3: ['-codec:a', 'libmp3lame', '-q:a', '0'],
  wav: ['-codec:a', 'pcm_s16le'],
  ogg: ['-codec:a', 'libvorbis', '-q:a', '6'],
};

const formatSeconds = (value: number): string => Math.max(0, value).toFixed(3);

const metadataPairs = (metadata: AlbumSplitTrackMetadata): string[] => {
  const pairs: Array<[string, string]> = [
    ['title', metadata.title],
    ['artist', metadata.artist],
    ['album', metadata.album],
    ['album_artist', metadata.albumArtist],
    ['track', metadata.trackTotal > 0 ? `${metadata.trackNumber}/${metadata.trackTotal}` : String(metadata.trackNumber)],
  ];
  if (metadata.discNumber) {
    pairs.push(['disc', String(metadata.discNumber)]);
  }
  if (metadata.year) {
    pairs.push(['date', String(metadata.year)]);
  }
  if (metadata.genre) {
    pairs.push(['genre', metadata.genre]);
  }
  return pairs.filter(([, value]) => value.trim().length > 0).flatMap(([key, value]) => ['-metadata', `${key}=${value}`]);
};

/**
 * One FFmpeg invocation per track. Input seeking (`-ss` before `-i`) keeps long lossless files
 * fast; the source's own metadata is dropped so each track only carries its own tags.
 */
export const buildAlbumSplitFfmpegArgs = (input: AlbumSplitFfmpegInput): string[] => {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-nostats', '-y'];

  if (input.startSeconds > 0) {
    args.push('-ss', formatSeconds(input.startSeconds));
  }
  args.push('-i', input.inputPath);

  const withCover = Boolean(input.cover) && albumSplitFormatSupportsCover(input.format);
  if (withCover && input.cover) {
    args.push('-i', input.cover.path);
  }

  if (input.durationSeconds !== null && input.durationSeconds > 0) {
    args.push('-t', formatSeconds(input.durationSeconds));
  }

  args.push('-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1');

  if (withCover && input.cover) {
    const mime = (input.cover.mimeType ?? '').toLowerCase();
    const canCopy = mime === 'image/jpeg' || mime === 'image/png';
    args.push('-map', '1:v:0');
    args.push(...(canCopy ? ['-codec:v', 'copy'] : ['-codec:v', 'mjpeg', '-q:v', '2']));
    args.push('-disposition:v:0', 'attached_pic', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
    if (input.format === 'mp3') {
      args.push('-id3v2_version', '3');
    }
  } else if (input.format === 'mp3') {
    args.push('-id3v2_version', '3');
  }

  args.push(...metadataPairs(input.metadata));
  args.push(...encoderArgs[input.format], input.outputPath);
  return args;
};
