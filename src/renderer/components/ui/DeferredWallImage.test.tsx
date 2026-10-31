// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { DeferredWallImage } from './DeferredWallImage';
import { wallImageOffscreenGraceMs } from './wallImageResidency';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DeferredWallImage', () => {
  it('loads priority images immediately even when scrolling is active', () => {
    const { container } = render(<DeferredWallImage alt="" decoding="async" paused priority src="echo-cover://album/priority" />);

    expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('echo-cover://album/priority');
  });

  it('waits for scroll idle before starting non-priority images', async () => {
    const { container, rerender } = render(<DeferredWallImage alt="" paused src="echo-cover://album/deferred" />);

    expect(container.querySelector('img')).toBeNull();

    rerender(<DeferredWallImage alt="" paused={false} src="echo-cover://album/deferred" />);

    await waitFor(() => {
      expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('echo-cover://album/deferred');
    });
  });

  it('limits concurrent non-priority image starts', async () => {
    const { container } = render(
      <>
        {Array.from({ length: 12 }, (_, index) => (
          <DeferredWallImage alt="" key={index} src={`echo-cover://album/${index}`} />
        ))}
      </>,
    );

    await waitFor(() => {
      expect(container.querySelectorAll('img')).toHaveLength(8);
    });
  });

  it('releases slow image slots so jumped-to rows can start loading', async () => {
    vi.useFakeTimers();
    const { container } = render(
      <>
        {Array.from({ length: 12 }, (_, index) => (
          <DeferredWallImage alt="" key={index} src={`echo-cover://album/${index}`} />
        ))}
      </>,
    );

    expect(container.querySelectorAll('img')).toHaveLength(8);

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    expect(container.querySelectorAll('img')).toHaveLength(12);
  });

  it('loads visible images immediately while scrolling', async () => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      options?: IntersectionObserverInit;
      disconnect: ReturnType<typeof vi.fn>;
      observe: ReturnType<typeof vi.fn>;
    }> = [];
    class FakeIntersectionObserver {
      readonly disconnect = vi.fn();
      readonly observe = vi.fn();
      readonly unobserve = vi.fn();
      readonly takeRecords = vi.fn(() => []);

      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observers.push({ callback, options, disconnect: this.disconnect, observe: this.observe });
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

    const { container } = render(
      <>
        {Array.from({ length: 12 }, (_, index) => (
          <DeferredWallImage alt="" key={index} paused src={`echo-cover://album/${index}`} />
        ))}
      </>,
    );

    expect(container.querySelectorAll('img')).toHaveLength(0);

    await act(async () => {
      observers
        .filter((observer) => observer.options?.rootMargin === '0px')
        .forEach((observer) =>
          observer.callback(
            observer.observe.mock.calls.map(([target]) => ({ target, isIntersecting: true } as IntersectionObserverEntry)),
            observer as unknown as IntersectionObserver,
          ),
        );
    });

    expect(container.querySelectorAll('img')).toHaveLength(12);
  });
});


describe('wall image memory residency', () => {
  const observers: Array<{
    callback: IntersectionObserverCallback;
    options?: IntersectionObserverInit;
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];

  beforeEach(() => {
    observers.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observers.push({ callback, options, ...this });
      }
    });
  });

  const notify = (margin: string, target: Element, inside: boolean): void => {
    const observer = [...observers].reverse().find((item) => item.options?.rootMargin === margin);
    if (!observer) throw new Error(`Missing observer: ${margin}`);
    act(() => observer.callback([{
      target, isIntersecting: inside, time: performance.now(),
    } as IntersectionObserverEntry], {} as IntersectionObserver));
  };

  it('releases far-offscreen images after a grace and restores them when visible, even during scroll', () => {
    const { container } = render(<DeferredWallImage alt="cover" paused src="echo-cover://album/1" />);
    const anchor = container.querySelector('span')!;
    notify('0px', anchor, true);
    expect(container.querySelector('img')).not.toBeNull();
    notify('0px', anchor, false);
    notify('1120px 0px', anchor, false);
    act(() => vi.advanceTimersByTime(wallImageOffscreenGraceMs - 1));
    expect(container.querySelector('img')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('img')).toBeNull();
    notify('0px', anchor, true);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('echo-cover://album/1');
  });

  it('keeps nearby and priority covers mounted and cancels release on a quick return', () => {
    const { container } = render(<>
      <DeferredWallImage alt="priority" priority src="echo-cover://album/priority" />
      <DeferredWallImage alt="nearby" src="echo-cover://album/nearby" />
    </>);
    const anchor = container.querySelectorAll('span')[1]!;
    notify('0px', anchor, true);
    notify('1120px 0px', anchor, false);
    act(() => vi.advanceTimersByTime(1000));
    notify('1120px 0px', anchor, true);
    act(() => vi.advanceTimersByTime(wallImageOffscreenGraceMs));
    expect(container.querySelectorAll('img')).toHaveLength(2);
    const residency = observers.find(item => item.options?.rootMargin === '1120px 0px')!;
    expect(residency.observe).toHaveBeenCalledTimes(1);
  });

  it('releases observers and pending timers on unmount and ignores late callbacks', () => {
    const { container, unmount } = render(<DeferredWallImage alt="cover" src="echo-cover://album/1" />);
    const anchor = container.querySelector('span')!;
    notify('0px', anchor, true);
    notify('1120px 0px', anchor, false);
    unmount();
    notify('1120px 0px', anchor, false);
    act(() => vi.advanceTimersByTime(wallImageOffscreenGraceMs));
    expect(vi.getTimerCount()).toBe(0);
    expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true);
  });
});
