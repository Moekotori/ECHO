// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { analyzeCoverImage } from './coverIntelligence';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const setupImages = () => {
  const images: HTMLImageElement[] = [];
  vi.stubGlobal('Image', class {
    constructor() {
      const image = document.createElement('img');
      Object.defineProperties(image, { naturalWidth: { value: 32 }, naturalHeight: { value: 32 } });
      images.push(image);
      return image;
    }
  });
  return images;
};

it.each(['load', 'error', 'abort', 'timeout'] as const)('releases listeners and the image on %s', async (outcome) => {
  vi.useFakeTimers();
  const images = setupImages();
  const controller = new AbortController();
  const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(32 * 32 * 4).fill(255) }),
  } as unknown as CanvasRenderingContext2D);
  const storage = { getItem: () => null, setItem: () => undefined } as unknown as Storage;
  const result = analyzeCoverImage('https://example.test/cover', outcome, { signal: controller.signal, timeoutMs: 100, storage })
    .then(() => 'loaded', () => 'failed');
  if (outcome === 'abort') controller.abort();
  else if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(100);
  else images[0].dispatchEvent(new Event(outcome));
  expect(await result).toBe(outcome === 'load' ? 'loaded' : 'failed');
  expect(images[0].onload).toBeNull();
  expect(images[0].onerror).toBeNull();
  expect(images[0].hasAttribute('src')).toBe(false);
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it('does not start loading for an already cancelled request', async () => {
  const images = setupImages();
  const controller = new AbortController();
  controller.abort();
  await expect(analyzeCoverImage('https://example.test/cover', 'cancelled', { signal: controller.signal }))
    .rejects.toMatchObject({ name: 'AbortError' });
  expect(images[0].hasAttribute('src')).toBe(false);
});
