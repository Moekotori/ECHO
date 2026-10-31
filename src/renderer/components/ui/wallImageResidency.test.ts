// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeWallImageResidency, wallImageOffscreenGraceMs } from './wallImageResidency';

describe('wall image residency', () => {
  const observers: Array<{ callback: IntersectionObserverCallback; observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const stops: Array<() => void> = [];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback) { observers.push({ callback, ...this }); }
    });
  });
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    observers.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const entry = (target: HTMLElement, isIntersecting: boolean): IntersectionObserverEntry => ({
    target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect: target.getBoundingClientRect(), intersectionRect: target.getBoundingClientRect(),
    rootBounds: null, time: performance.now(),
  });
  const observe = (anchor: HTMLElement, release: () => void, root: HTMLElement | null = null) => {
    const stop = observeWallImageResidency(anchor, root, '1120px 0px', release);
    stops.push(stop);
    return stop;
  };
  it('shares one observer/timer for many images and releases only after the grace', () => {
    const images = Array.from({ length: 100 }, () => document.createElement('span'));
    const release = vi.fn();
    images.forEach((image) => observe(image, release));
    expect(observers).toHaveLength(1);
    observers[0].callback(images.map((image) => entry(image, false)), {} as IntersectionObserver);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(wallImageOffscreenGraceMs - 1);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(release).toHaveBeenCalledTimes(100);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels release on return and gives a later departure its own grace', () => {
    const anchor = document.createElement('span');
    const release = vi.fn();
    observe(anchor, release);
    const notify = (inside: boolean) => observers[0].callback([entry(anchor, inside)], {} as IntersectionObserver);
    notify(false);
    vi.advanceTimersByTime(2000);
    notify(true);
    notify(false);
    vi.advanceTimersByTime(500);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(release).toHaveBeenCalledOnce();
  });
  it('disconnects empty pools, cancels timers and ignores late events after teardown', () => {
    const anchor = document.createElement('span');
    const release = vi.fn();
    const stop = observe(anchor, release);
    const observer = observers[0];
    observer.callback([entry(anchor, false)], {} as IntersectionObserver);
    stop();
    observer.callback([entry(anchor, false)], {} as IntersectionObserver);
    vi.advanceTimersByTime(5000);
    expect(release).not.toHaveBeenCalled();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    observe(anchor, release);
    expect(observers).toHaveLength(2);
  });
  it('isolates scroll roots and does not postpone release on repeated outside events', () => {
    const anchor = document.createElement('span');
    const release = vi.fn();
    observe(anchor, release);
    observe(document.createElement('span'), vi.fn(), document.createElement('div'));
    expect(observers).toHaveLength(2);
    observers[0].callback([entry(anchor, false)], {} as IntersectionObserver);
    vi.advanceTimersByTime(2000);
    observers[0].callback([entry(anchor, false)], {} as IntersectionObserver);
    vi.advanceTimersByTime(500);
    expect(release).toHaveBeenCalledOnce();
  });

  it('ignores an old queued departure when the same anchor now holds a new cover', () => {
    // Keep the shared observer alive while a cover changes its src.
    observe(document.createElement('span'), vi.fn());
    const anchor = document.createElement('span');
    const oldRelease = vi.fn();
    const stopOld = observe(anchor, oldRelease);
    const staleEntry = entry(anchor, false);
    vi.advanceTimersByTime(10);
    stopOld();
    const newRelease = vi.fn();
    observe(anchor, newRelease);
    const observer = observers[0];
    observer.callback([staleEntry], {} as IntersectionObserver);
    vi.advanceTimersByTime(wallImageOffscreenGraceMs);
    expect(newRelease).not.toHaveBeenCalled();
    expect(oldRelease).not.toHaveBeenCalled();

    observer.callback([entry(anchor, false)], {} as IntersectionObserver);
    vi.advanceTimersByTime(wallImageOffscreenGraceMs);
    expect(newRelease).toHaveBeenCalledOnce();
  });
});
