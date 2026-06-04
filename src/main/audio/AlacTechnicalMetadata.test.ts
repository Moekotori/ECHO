import { describe, expect, it } from 'vitest';
import { shouldPreferTagLibForAlacTechnicalFields } from './AlacTechnicalMetadata';

describe('ALAC technical metadata correction', () => {
  it('uses TagLib technical fields for ALAC in m4a/mp4 containers', () => {
    expect(shouldPreferTagLibForAlacTechnicalFields('D:\\Music\\Track.m4a', 'ALAC')).toBe(true);
    expect(shouldPreferTagLibForAlacTechnicalFields('D:\\Music\\Track.mp4', 'MPEG-4', 'Apple Lossless')).toBe(true);
  });

  it('does not override unrelated codecs or containers', () => {
    expect(shouldPreferTagLibForAlacTechnicalFields('D:\\Music\\Track.m4a', 'AAC')).toBe(false);
    expect(shouldPreferTagLibForAlacTechnicalFields('D:\\Music\\Track.flac', 'ALAC')).toBe(false);
  });
});
