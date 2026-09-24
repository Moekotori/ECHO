/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearReadableColorSampleCache, sampleImageUrl } from './lyricsReadableColor';

describe('lyrics readable color image sampling', () => {
  afterEach(() => {
    clearReadableColorSampleCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('deduplicates in-flight and completed sampling for the same URL', async () => {
    const images: Array<{
      complete: boolean;
      naturalHeight: number;
      naturalWidth: number;
      onerror: (() => void) | null;
      onload: (() => void) | null;
    }> = [];

    class FakeImage {
      complete = false;
      crossOrigin = '';
      naturalHeight = 96;
      naturalWidth = 96;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      constructor() {
        images.push(this);
      }

      set src(_value: string) {}
    }

    const pixels = new Uint8ClampedArray(32 * 32 * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 80;
      pixels[index + 1] = 120;
      pixels[index + 2] = 180;
      pixels[index + 3] = 255;
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: pixels })),
    } as unknown as CanvasRenderingContext2D);

    const first = sampleImageUrl('echo-cover://thumb/cover-1');
    const second = sampleImageUrl('echo-cover://thumb/cover-1');

    expect(images).toHaveLength(1);
    images[0].onload?.();

    const [firstSample, secondSample] = await Promise.all([first, second]);
    const cachedSample = await sampleImageUrl('echo-cover://thumb/cover-1');

    expect(firstSample).not.toBeNull();
    expect(secondSample).toBe(firstSample);
    expect(cachedSample).toBe(firstSample);
    expect(images).toHaveLength(1);
  });
});
