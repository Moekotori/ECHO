import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { NcmConverter } from './NcmConverter';

describe('NcmConverter platform support', () => {
  it('reports a clear unsupported-platform error on Linux', async () => {
    const converter = new NcmConverter(vi.fn(() => null), 'linux');

    await expect(converter.convertIfNeeded('/music/locked.ncm')).rejects.toThrow('NCM 解密暂不支持当前平台: linux');
  });

  it('returns non-NCM paths unchanged on Linux', async () => {
    const converter = new NcmConverter(vi.fn(() => null), 'linux');

    await expect(converter.convertIfNeeded('/music/song.flac')).resolves.toBe(resolve('/music/song.flac'));
  });
});
