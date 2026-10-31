import { describe, expect, it } from 'vitest';
import { isCueFile, isScannableAudioExtension, isSupportedAudioExtension, SUPPORTED_AUDIO_DIALOG_EXTENSIONS } from './audioExtensions';

describe('audio extension constants', () => {
  it('supports common, hifi, dsd, container, ncm, and cue formats for direct playback', () => {
    const supported = [
      '.flac',
      '.mp3',
      '.wav',
      '.m4a',
      '.m4p',
      '.alac',
      '.opus',
      '.aiff',
      '.aif',
      '.cue',
      '.ncm',
      '.dsf',
      '.dff',
      '.ape',
      '.wv',
      '.mka',
      '.mkv',
      '.mp4',
      '.tta',
      '.tak',
      '.ac3',
      '.eac3',
      '.ec3',
      '.dd',
      '.ddp',
      '.thd',
      '.truehd',
      '.mlp',
      '.ac4',
    ];

    for (const extension of supported) {
      expect(isSupportedAudioExtension(`D:\\Music\\Track${extension}`)).toBe(true);
      expect(isSupportedAudioExtension(`/music/Track${extension.toUpperCase()}`)).toBe(true);
    }
  });

  it('does not scan cue sheets as standalone library tracks', () => {
    expect(isSupportedAudioExtension('D:\\Music\\album.cue')).toBe(true);
    expect(isScannableAudioExtension('D:\\Music\\album.cue')).toBe(false);
    expect(isScannableAudioExtension('D:\\Music\\track.flac')).toBe(true);
    expect(isScannableAudioExtension('D:\\Music\\atmos.eac3')).toBe(true);
    expect(isScannableAudioExtension('D:\\Music\\truehd.thd')).toBe(true);
    expect(isScannableAudioExtension('D:\\Music\\ac4.ac4')).toBe(true);
  });

  it('does not treat artwork, lyrics, documents, or executables as audio', () => {
    const unsupported = ['.jpg', '.png', '.txt', '.lrc', '.pdf', '.exe', '.iso'];

    for (const extension of unsupported) {
      expect(isSupportedAudioExtension(`D:\\Music\\Track${extension}`)).toBe(false);
    }
  });

  it('includes cue sheets in the direct playback dialog list', () => {
    expect(isCueFile('album.cue')).toBe(true);
    expect(SUPPORTED_AUDIO_DIALOG_EXTENSIONS).toContain('cue');
    expect(SUPPORTED_AUDIO_DIALOG_EXTENSIONS).toContain('eac3');
    expect(SUPPORTED_AUDIO_DIALOG_EXTENSIONS).toContain('truehd');
    expect(SUPPORTED_AUDIO_DIALOG_EXTENSIONS).toContain('ac4');
  });
});
