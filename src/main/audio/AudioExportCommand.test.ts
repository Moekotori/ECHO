import { describe, expect, it } from 'vitest';
import {
  appendAudioExportExtension,
  buildAudioExportFfmpegArgs,
  normalizeAudioExportFormat,
  normalizeAudioExportPlaybackRate,
} from './AudioExportCommand';

describe('AudioExportCommand', () => {
  it('builds a speed-aware MP3 export command', () => {
    const args = buildAudioExportFfmpegArgs({
      inputPath: 'D:\\Music\\source.flac',
      outputPath: 'D:\\Exports\\source.mp3',
      format: 'mp3',
      playbackRate: 1.25,
    });

    expect(args).toEqual(expect.arrayContaining(['-map', '0:a:0', '-vn', '-sn', '-dn']));
    expect(args).toEqual(expect.arrayContaining(['-af', 'atempo=1.250000']));
    expect(args).toEqual(expect.arrayContaining(['-codec:a', 'libmp3lame', '-q:a', '2']));
    expect(args.at(-1)).toBe('D:\\Exports\\source.mp3');
  });

  it('keeps cue track start and duration in the export command', () => {
    const args = buildAudioExportFfmpegArgs({
      inputPath: 'D:\\Music\\album.flac',
      outputPath: 'D:\\Exports\\track.flac',
      format: 'flac',
      playbackRate: 1,
      startSeconds: 62.3456,
      durationSeconds: 180.2,
    });

    expect(args).toEqual(expect.arrayContaining(['-ss', '62.346']));
    expect(args).toEqual(expect.arrayContaining(['-t', '180.200']));
    expect(args).not.toContain('atempo=1.000000');
    expect(args).toEqual(expect.arrayContaining(['-codec:a', 'flac', '-compression_level', '8']));
  });

  it('normalizes unsupported formats and playback rates', () => {
    expect(normalizeAudioExportFormat('aac')).toBe('mp3');
    expect(normalizeAudioExportPlaybackRate(4)).toBe(2);
    expect(normalizeAudioExportPlaybackRate(0.1)).toBe(0.5);
  });

  it('only appends an extension when the user did not type one', () => {
    expect(appendAudioExportExtension('D:\\Exports\\song', 'ogg')).toBe('D:\\Exports\\song.ogg');
    expect(appendAudioExportExtension('D:\\Exports\\song.custom', 'ogg')).toBe('D:\\Exports\\song.custom');
  });
});
