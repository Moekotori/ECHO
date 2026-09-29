import { describe, expect, it } from 'vitest';
import { isBrowserPlayableVideo, isSupportedVideoExtension, mimeTypeForVideoPath } from './videoExtensions';

describe('videoExtensions', () => {
  it('treats mp4, webm, and m4v as browser playable', () => {
    for (const filePath of ['clip.mp4', 'clip.webm', 'clip.m4v']) {
      expect(isSupportedVideoExtension(filePath)).toBe(true);
      expect(isBrowserPlayableVideo(filePath)).toBe(true);
    }
  });

  it('supports mkv, avi, and mov without marking them browser playable', () => {
    for (const filePath of ['clip.mkv', 'clip.avi', 'clip.mov']) {
      expect(isSupportedVideoExtension(filePath)).toBe(true);
      expect(isBrowserPlayableVideo(filePath)).toBe(false);
      expect(mimeTypeForVideoPath(filePath)).toMatch(/^video\//);
    }
  });

  it('rejects non-video extensions', () => {
    for (const filePath of ['cover.jpg', 'song.lrc', 'notes.txt']) {
      expect(isSupportedVideoExtension(filePath)).toBe(false);
      expect(isBrowserPlayableVideo(filePath)).toBe(false);
      expect(mimeTypeForVideoPath(filePath)).toBeNull();
    }
  });
});
