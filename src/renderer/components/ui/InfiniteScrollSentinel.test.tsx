// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { InfiniteScrollSentinel } from './InfiniteScrollSentinel';

type FrameCallback = FrameRequestCallback;

class IdleIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = '';
  thresholds = [];
}

const setRect = (element: Element, rect: Partial<DOMRectReadOnly>): void => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  });
};

const renderSentinel = (props: Partial<ComponentProps<typeof InfiniteScrollSentinel>> = {}) =>
  render(
    <main className="page-surface">
      <InfiniteScrollSentinel canLoadMore isLoading={false} onLoadMore={vi.fn()} {...props} />
    </main>,
  );

describe('InfiniteScrollSentinel', () => {
  let frames: Map<number, FrameCallback>;
  let nextFrameId: number;

  const runNextFrame = (): void => {
    const [id, callback] = frames.entries().next().value as [number, FrameCallback];
    frames.delete(id);
    callback(performance.now());
  };

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal('IntersectionObserver', IdleIntersectionObserver);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads when scroll passes the sentinel even if IntersectionObserver does not report an intersection', () => {
    const onLoadMore = vi.fn();
    const { container } = renderSentinel({ onLoadMore });
    const root = container.querySelector('.page-surface')!;
    const sentinel = container.querySelector('.infinite-scroll-sentinel')!;

    setRect(root, { bottom: 700, height: 700 });
    setRect(sentinel, { top: 1800 });
    runNextFrame();
    expect(onLoadMore).not.toHaveBeenCalled();

    setRect(sentinel, { top: 1500 });
    fireEvent.scroll(root);
    runNextFrame();

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not load while the sentinel is still beyond the fallback distance', () => {
    const onLoadMore = vi.fn();
    const { container } = renderSentinel({ onLoadMore, fallbackDistance: 300 });
    const root = container.querySelector('.page-surface')!;
    const sentinel = container.querySelector('.infinite-scroll-sentinel')!;

    setRect(root, { bottom: 700, height: 700 });
    setRect(sentinel, { top: 1201 });
    runNextFrame();
    fireEvent.scroll(root);
    runNextFrame();

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does not load again while loading', () => {
    const onLoadMore = vi.fn();
    const { container } = renderSentinel({ isLoading: true, onLoadMore });
    const root = container.querySelector('.page-surface')!;

    fireEvent.scroll(root);

    expect(frames.size).toBe(0);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('loads the next page after loading finishes if the sentinel is still within reach', () => {
    const onLoadMore = vi.fn();
    const { container, rerender } = renderSentinel({ onLoadMore });
    const root = container.querySelector('.page-surface')!;
    const sentinel = container.querySelector('.infinite-scroll-sentinel')!;

    setRect(root, { bottom: 700, height: 700 });
    setRect(sentinel, { top: 800 });
    runNextFrame();
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <main className="page-surface">
        <InfiniteScrollSentinel canLoadMore isLoading onLoadMore={onLoadMore} />
      </main>,
    );
    rerender(
      <main className="page-surface">
        <InfiniteScrollSentinel canLoadMore isLoading={false} onLoadMore={onLoadMore} />
      </main>,
    );
    runNextFrame();

    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });
});
