// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { preloadStartupArtworkUrls } from './useLibraryStartupArtworkPreloader';

afterEach(() => vi.unstubAllGlobals());

it('releases each completed preload and cancels only the remaining work', () => {
  const images: HTMLImageElement[] = [];
  vi.stubGlobal('Image', class {
    constructor() {
      const image = document.createElement('img');
      images.push(image);
      return image;
    }
  });
  const rememberUrl = vi.fn();
  const cancel = preloadStartupArtworkUrls(['first', 'second', 'third', 'fourth'], { concurrency: 2, rememberUrl });
  expect(images).toHaveLength(2);
  const firstHandler = images[0].onload!;
  images[0].dispatchEvent(new Event('load'));
  expect(images).toHaveLength(3);
  expect(images[0].onload).toBeNull();
  expect(images[0].onerror).toBeNull();
  firstHandler.call(images[0], new Event('load'));
  expect(images).toHaveLength(3);
  expect(rememberUrl).toHaveBeenCalledExactlyOnceWith('first');
  const lateHandler = images[1].onload!;
  cancel();
  expect(images[0].getAttribute('src')).toBe('first');
  expect(images[1].getAttribute('src')).toBe('');
  expect(images[2].onload).toBeNull();
  lateHandler.call(images[1], new Event('load'));
  expect(images).toHaveLength(3);
  expect(rememberUrl).toHaveBeenCalledTimes(1);
});
