/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearReadableColorSampleCache, sampleImageUrl, sampleVideoElement } from './lyricsReadableColor';

describe('lyrics readable color image sampling', () => {
  afterEach(() => {
    clearReadableColorSampleCache();
    vi.useRealTimers();
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
      removeAttribute(_name: string) {}
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

  it('releases stalled image requests and permits a retry', async () => {
    vi.useFakeTimers();
    const images: HTMLImageElement[] = [];
    vi.stubGlobal('Image', class {
      constructor() {
        const image = document.createElement('img');
        images.push(image);
        return image;
      }
    });
    const first = sampleImageUrl('https://example.test/stalled.jpg');
    expect(sampleImageUrl('https://example.test/stalled.jpg')).toBe(first);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await first).toBeNull();
    expect(images[0].onload).toBeNull();
    expect(images[0].onerror).toBeNull();
    expect(images[0].hasAttribute('src')).toBe(false);
    const retry = sampleImageUrl('https://example.test/stalled.jpg');
    expect(images).toHaveLength(2);
    images[1].dispatchEvent(new Event('error'));
    expect(await retry).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reuses one sampling surface and replaces it after a tainted frame', async () => {
    const createElement = vi.spyOn(document, 'createElement');
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(), drawImage,
      getImageData: () => ({ data: new Uint8ClampedArray(32 * 32 * 4).fill(255) }),
    } as unknown as CanvasRenderingContext2D);
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
    for (let index = 0; index < 100; index += 1) {
      expect(await sampleVideoElement(video)).not.toBeNull();
    }
    expect(createElement.mock.calls.filter(([tag]) => String(tag) === 'canvas')).toHaveLength(1);
    drawImage.mockImplementationOnce(() => { throw new DOMException('Tainted', 'SecurityError'); });
    expect(await sampleVideoElement(video)).toBeNull();
    expect(await sampleVideoElement(video)).not.toBeNull();
    expect(createElement.mock.calls.filter(([tag]) => String(tag) === 'canvas')).toHaveLength(2);
  });
});
