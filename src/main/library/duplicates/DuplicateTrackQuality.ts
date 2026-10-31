import type { TrackLikeForDuplicate } from './DuplicateTrackTypes';

const LOSSLESS_CODECS = new Set(['FLAC', 'ALAC', 'WAV', 'AIFF', 'AIF', 'APE', 'WV', 'DSF', 'DFF', 'TTA', 'TAK']);
const LOSSY_CODECS = new Set(['OPUS', 'AAC', 'M4A', 'OGG', 'MP3', 'WMA']);

export const normalizeCodec = (codec?: string | null): string => (codec ?? '').normalize('NFKC').trim().toUpperCase();

export const isLosslessCodec = (codec?: string | null): boolean => LOSSLESS_CODECS.has(normalizeCodec(codec));

const clampPositive = (value: number | null | undefined, cap: number): number => {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(value, cap);
};

export const scoreTrackQuality = (track: TrackLikeForDuplicate): number => {
  const codec = normalizeCodec(track.codec);
  let score = 0;

  if (LOSSLESS_CODECS.has(codec)) {
    score += 10_000;
  } else if (LOSSY_CODECS.has(codec)) {
    score += 2_000;
  } else {
    score += 250;
  }

  score += clampPositive(track.bitDepth, 32) * 100;
  score += (clampPositive(track.sampleRate, 192_000) / 1_000) * 10;
  score += clampPositive(track.bitrate, 10_000_000) / 10_000;

  if (track.coverId) {
    score += 25;
  }

  if (track.metadataStatus?.toLowerCase() === 'ok') {
    score += 25;
  }

  return Math.round(score);
};

export const compareTrackQuality = (a: TrackLikeForDuplicate, b: TrackLikeForDuplicate): number => {
  const scoreDelta = scoreTrackQuality(b) - scoreTrackQuality(a);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const sizeDelta = (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
  if (sizeDelta !== 0) {
    return sizeDelta;
  }

  return (a.path ?? '').localeCompare(b.path ?? '');
};
