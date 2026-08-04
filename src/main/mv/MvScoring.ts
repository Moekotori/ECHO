import { basename, dirname, extname, normalize } from 'node:path';
import type { LibraryTrack } from '../../shared/types/library';
import { isBrowserPlayableVideo } from '../../shared/constants/videoExtensions';

const sourceWords = [
  'official',
  'official mv',
  'official music video',
  'mv',
  'music video',
  'video',
  'pv',
  'hd',
  'hq',
  '1080p',
  '720p',
  '4k',
  'lyrics',
  'lyric',
  'audio',
  'feat',
  'ft',
  'featuring',
];

const sourceWordPattern = sourceWords
  .sort((left, right) => right.length - left.length)
  .map((word) => word.replace(/\s+/g, '\\s+'))
  .join('|');

export const normalizeMvText = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(new RegExp(`[\\[(（【]\\s*(${sourceWordPattern})\\s*[\\])）】]`, 'gi'), ' ')
    .replace(new RegExp(`\\b(${sourceWordPattern})\\b`, 'gi'), ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripSourceWords = (value: string): string => {
  let result = ` ${value} `;
  for (const word of sourceWords) {
    result = result.replace(new RegExp(`\\s${word.replace(/\s+/g, '\\s+')}\\s`, 'gi'), ' ');
  }

  return result.replace(/\s+/g, ' ').trim();
};

const containsAllWords = (haystack: string, needle: string): boolean => {
  const words = needle.split(' ').filter((word) => word.length > 1);
  return words.length > 0 && words.every((word) => haystack.includes(word));
};

export type MvScoreResult = {
  score: number;
  reasons: string[];
};

export const scoreLocalMvCandidate = (track: LibraryTrack, filePath: string): MvScoreResult => {
  const audioBase = normalizeMvText(basename(track.path, extname(track.path)));
  const videoBase = normalizeMvText(basename(filePath, extname(filePath)));
  const comparableVideoBase = stripSourceWords(videoBase);
  const title = normalizeMvText(track.title);
  const artist = normalizeMvText(track.artist || track.albumArtist);
  const artistTitle = normalizeMvText(`${track.artist || track.albumArtist} - ${track.title}`);
  const titleArtist = normalizeMvText(`${track.title} - ${track.artist || track.albumArtist}`);
  const reasons: string[] = [];
  let score = 0;

  if (videoBase === audioBase || comparableVideoBase === audioBase) {
    score += 0.55;
    reasons.push('same basename');
  } else if (comparableVideoBase === title || videoBase === title) {
    score += 0.35;
    reasons.push('title exact');
  } else if (comparableVideoBase === artistTitle || comparableVideoBase === titleArtist) {
    score += 0.5;
    reasons.push('artist/title exact');
  } else if (title && containsAllWords(comparableVideoBase, title)) {
    score += 0.24;
    reasons.push('title words');
  }

  if (artist && comparableVideoBase.includes(artist)) {
    score += 0.15;
    reasons.push('artist included');
  }

  const parentFolder = normalize(dirname(filePath)).split(/[\\/]/).pop()?.toLocaleLowerCase() ?? '';
  if (['mv', 'video', 'videos'].includes(parentFolder)) {
    score += 0.1;
    reasons.push('mv folder');
  }

  // TODO: add duration scoring when a lightweight, reliable video probe is available.
  if (isBrowserPlayableVideo(filePath)) {
    score += 0.05;
    reasons.push('browser playable');
  }

  return {
    score: Math.min(1, Number(score.toFixed(4))),
    reasons,
  };
};
