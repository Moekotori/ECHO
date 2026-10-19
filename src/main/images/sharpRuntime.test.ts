import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

describe('image processing memory profile', () => {
  it('disables only the operation cache and preserves encoded derivatives and decoded pixels', async () => {
    sharp.cache({ memory: 50, files: 20, items: 100 });
    const input = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#427980' } }).png().toBuffer();
    const encode = async (engine: typeof sharp): Promise<Buffer[]> => Promise.all([
      engine(input).resize(48, 48, { fit: 'cover' }).webp({ quality: 80 }).toBuffer(),
      engine(input).resize(128, 128, { fit: 'inside', withoutEnlargement: true }).png().toBuffer(),
      engine(input).resize(48, 48).ensureAlpha().raw().toBuffer(),
    ]);
    const before = await encode(sharp);
    const configured = (await import('./sharpRuntime')).default;
    const after = await encode(configured);
    expect(after).toEqual(before);
    expect(sharp.cache()).toMatchObject({ memory: { max: 0 }, files: { max: 0 }, items: { max: 0, current: 0 } });
  });
});
