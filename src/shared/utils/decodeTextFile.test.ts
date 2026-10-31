import { describe, expect, it } from 'vitest';
import { decodeTextFileBytes } from './decodeTextFile';

describe('decodeTextFileBytes', () => {
  it('decodes UTF-8 text', () => {
    expect(decodeTextFileBytes(new TextEncoder().encode('[00:01.00]幸存者'))).toBe('[00:01.00]幸存者');
  });

  it('decodes GBK compatible Chinese lyric files as GB18030', () => {
    const bytes = new Uint8Array([
      0x5b, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x2e, 0x30, 0x30, 0x5d,
      0xd0, 0xd2, 0xb4, 0xe6, 0xd5, 0xdf,
    ]);

    expect(decodeTextFileBytes(bytes)).toBe('[00:01.00]幸存者');
  });

  it('decodes UTF-16 LE text with a BOM', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x5b, 0x00, 0x30, 0x00, 0x30, 0x00, 0x5d, 0x00]);

    expect(decodeTextFileBytes(bytes)).toBe('[00]');
  });
});
