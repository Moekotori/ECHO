// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeWallImageVisibility } from './wallImageVisibility';

type Observer = {
  callback: IntersectionObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
const observers: Observer[] = [];
const cleanups: Array<() => void> = [];
const register = (...args: Parameters<typeof observeWallImageVisibility>) => {
  const stop = observeWallImageVisibility(...args);
  cleanups.push(stop);
  return stop;
};
const notify = (observer: Observer, target: HTMLElement, time = performance.now()) => {
  const rect = target.getBoundingClientRect();
  observer.callback([{
    target, time, isIntersecting: true, intersectionRatio: 1,
    boundingClientRect: rect, intersectionRect: rect, rootBounds: null,
  }], {} as IntersectionObserver);
};

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback) {
      observers.push({ callback, observe: this.observe, unobserve: this.unobserve, disconnect: this.disconnect });
    }
  });
});
afterEach(() => {
  cleanups.splice(0).forEach(stop => stop());
  observers.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shared wall image visibility', () => {
  it('shares one observer across mounted images while keeping roots and margins independent', () => {
    const root = document.createElement('div');
    const stops = Array.from({ length: 100 }, () => register(document.createElement('span'), root, '720px 0px', vi.fn()));
    expect(observers).toHaveLength(1);
    register(document.createElement('span'), root, '0px', vi.fn());
    register(document.createElement('span'), document.createElement('div'), '720px 0px', vi.fn());
    expect(observers).toHaveLength(3);
    stops.forEach(stop => stop());
    expect(observers[0]!.unobserve).toHaveBeenCalledTimes(100);
    expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(observers[1]!.disconnect).not.toHaveBeenCalled();
    register(document.createElement('span'), root, '720px 0px', vi.fn());
    expect(observers).toHaveLength(4);
  });

  it('keeps a second owner on the same anchor alive when a one-shot owner leaves', () => {
    const anchor = document.createElement('span');
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = register(anchor, null, '0px', first);
    const stopSecond = register(anchor, null, '0px', second);
    const observer = observers[0]!;
    notify(observer, anchor);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    stopFirst();
    notify(observer, anchor);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    expect(observer.unobserve).not.toHaveBeenCalled();
    stopSecond();
    notify(observer, anchor);
    expect(second).toHaveBeenCalledTimes(2);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('ignores queued entries from a previous owner when an anchor is reused for a new image', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const anchor = document.createElement('span');
    register(document.createElement('span'), null, '0px', vi.fn());
    const oldCallback = vi.fn();
    const stopOld = register(anchor, null, '0px', oldCallback);
    stopOld();
    vi.mocked(performance.now).mockReturnValue(10);
    const nextCallback = vi.fn();
    register(anchor, null, '0px', nextCallback);
    notify(observers[0]!, anchor, 5);
    expect(nextCallback).not.toHaveBeenCalled();
    notify(observers[0]!, anchor, 11);
    expect(nextCallback).toHaveBeenCalledTimes(1);
    expect(oldCallback).not.toHaveBeenCalled();
  });
});
