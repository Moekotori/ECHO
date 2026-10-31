import { extname } from 'node:path';
import { audioExportFormats, type AudioExportFormat } from '../../shared/types/audio';

export type AudioExportCommandInput = {
  inputPath: string;
  outputPath: string;
  format: AudioExportFormat;
  playbackRate?: number;
  startSeconds?: number;
  durationSeconds?: number | null;
};

const audioExportFormatSet = new Set<AudioExportFormat>(audioExportFormats);

export const normalizeAudioExportFormat = (value: unknown): AudioExportFormat =>
  audioExportFormatSet.has(value as AudioExportFormat) ? (value as AudioExportFormat) : 'mp3';

export const normalizeAudioExportPlaybackRate = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0.5, Math.min(2, numeric)) : 1;
};

export const appendAudioExportExtension = (filePath: string, format: AudioExportFormat): string => {
  const currentExtension = extname(filePath);
  return currentExtension ? filePath : `${filePath}.${format}`;
};

export const formatAudioExportPlaybackRate = (value: unknown): string => `${normalizeAudioExportPlaybackRate(value).toFixed(2)}x`;

export const sanitizeAudioExportFileName = (value: string): string => {
  // eslint-disable-next-line no-control-regex -- Control chars are illegal in Windows file names.
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, 120) : 'ECHO Next Export';
};

const audioEncoderArgs: Record<AudioExportFormat, string[]> = {
  mp3: ['-codec:a', 'libmp3lame', '-q:a', '2'],
  wav: ['-codec:a', 'pcm_s24le'],
  flac: ['-codec:a', 'flac', '-compression_level', '8'],
  ogg: ['-codec:a', 'libvorbis', '-q:a', '5'],
};

const formatSeconds = (value: number): string => Math.max(0, value).toFixed(3);

export const buildAudioExportFfmpegArgs = (input: AudioExportCommandInput): string[] => {
  const playbackRate = normalizeAudioExportPlaybackRate(input.playbackRate);
  const startSeconds = Number(input.startSeconds ?? 0);
  const durationSeconds = Number(input.durationSeconds ?? 0);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-nostats',
    '-y',
  ];

  if (Number.isFinite(startSeconds) && startSeconds > 0) {
    args.push('-ss', formatSeconds(startSeconds));
  }

  args.push(
    '-i',
    input.inputPath,
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-map_metadata',
    '0',
  );

  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    args.push('-t', formatSeconds(durationSeconds));
  }

  if (Math.abs(playbackRate - 1) >= 0.001) {
    args.push('-af', `atempo=${playbackRate.toFixed(6)}`);
  }

  args.push(...audioEncoderArgs[input.format], input.outputPath);
  return args;
};
