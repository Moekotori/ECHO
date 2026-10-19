// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { preloadRemoteCoverUrls } from './remoteCoverPreload';

const images: HTMLImageElement[] = [];
const setup = (): void => {
  vi.useFakeTimers();
  vi.stubGlobal('Image', class {
    src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { images.push(this as unknown as HTMLImageElement); }
    removeAttribute(): void { this.src = ''; }
  });
};
afterEach(() => { images.length = 0; vi.unstubAllGlobals(); vi.useRealTimers(); });

it('releases finished images and keeps the number of live preloads bounded', () => {
  setup();
  const rememberUrl = vi.fn();
  const cancel = preloadRemoteCoverUrls(['one', 'two', 'three'], { concurrency: 2, rememberUrl });
  expect(images.map(image => image.src)).toEqual(['one', 'two']);
  const loaded = images[0].onload!;
  loaded.call(images[0], new Event('load'));
  expect(images.map(image => image.src)).toEqual(['', 'two', 'three']);
  expect(rememberUrl).toHaveBeenCalledExactlyOnceWith('one');
  loaded.call(images[0], new Event('load'));
  expect(rememberUrl).toHaveBeenCalledTimes(1);
  cancel();
  expect(images.every(image => image.src === '' && image.onload === null)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('times out stuck preloads and continues the queue without remembering failures', () => {
  setup();
  const rememberUrl = vi.fn();
  const cancel = preloadRemoteCoverUrls(['stuck', 'next'], { concurrency: 1, rememberUrl });
  vi.advanceTimersByTime(12_000);
  expect(images.map(image => image.src)).toEqual(['', 'next']);
  expect(rememberUrl).not.toHaveBeenCalled();
  images[1].onerror!.call(images[1], new Event('error'));
  expect(images[1].src).toBe('');
  expect(vi.getTimerCount()).toBe(0);
  cancel();
});

it('cancels timers, releases image sources, and ignores late events on route exit', () => {
  setup();
  const rememberUrl = vi.fn();
  const cancel = preloadRemoteCoverUrls(['one', 'two'], { concurrency: 1, rememberUrl });
  const lateLoad = images[0].onload!;
  cancel();
  lateLoad.call(images[0], new Event('load'));
  vi.advanceTimersByTime(24_000);
  expect(images).toHaveLength(1);
  expect(images[0].src).toBe('');
  expect(rememberUrl).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
