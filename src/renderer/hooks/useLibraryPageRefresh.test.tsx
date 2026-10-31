// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useLibraryPageRefresh } from './useLibraryPageRefresh';

it('batches library bursts, uses the latest callback, and cancels pending work on unmount', () => {
  vi.useFakeTimers();
  try {
    const first = vi.fn(); const latest = vi.fn();
    const { rerender, unmount } = renderHook(({ refresh }) => useLibraryPageRefresh(refresh), { initialProps: { refresh: first } });
    const structural = new Event('library:changed');
    act(() => { window.dispatchEvent(structural); window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } })); });
    rerender({ refresh: latest });
    act(() => vi.advanceTimersByTime(120));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith(structural);
    act(() => window.dispatchEvent(new Event('library:changed')));
    unmount(); act(() => vi.runAllTimers());
    expect(latest).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
