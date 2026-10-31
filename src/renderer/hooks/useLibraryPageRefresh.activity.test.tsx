// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { RouteActivityProvider } from '../components/ui/RouteActivityContext';
import { useLibraryPageRefresh } from './useLibraryPageRefresh';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('background library wall refresh', () => {
  it('retains one structural refresh during hidden scan bursts and flushes on return', () => {
    vi.useFakeTimers();
    let active = false;
    const wrapper = ({ children }: PropsWithChildren): JSX.Element => <RouteActivityProvider isActive={active}>{children}</RouteActivityProvider>;
    const refresh = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook(({ callback }) => useLibraryPageRefresh(callback), { wrapper, initialProps: { callback: refresh } });
    const structural = new Event('library:changed');
    act(() => {
      window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));
      window.dispatchEvent(structural);
      for (let i = 0; i < 100; i++) window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));
      vi.advanceTimersByTime(20_000);
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    active = true;
    rerender({ callback: latest });
    expect(latest).toHaveBeenCalledExactlyOnceWith(structural);
    expect(refresh).not.toHaveBeenCalled();
    rerender({ callback: latest });
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('defers a queued foreground refresh if the route hides before the debounce fires', () => {
    vi.useFakeTimers();
    let active = true;
    const wrapper = ({ children }: PropsWithChildren): JSX.Element => <RouteActivityProvider isActive={active}>{children}</RouteActivityProvider>;
    const refresh = vi.fn();
    const { rerender, unmount } = renderHook(() => useLibraryPageRefresh(refresh), { wrapper });
    const event = new CustomEvent('library:changed', { detail: { preserveScroll: true } });
    act(() => window.dispatchEvent(event));
    active = false; rerender();
    act(() => vi.advanceTimersByTime(120));
    expect(refresh).not.toHaveBeenCalled();
    active = true; rerender();
    expect(refresh).toHaveBeenCalledExactlyOnceWith(event);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
