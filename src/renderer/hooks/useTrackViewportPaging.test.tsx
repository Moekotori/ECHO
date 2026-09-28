// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTrackViewportPaging } from './useTrackViewportPaging';

describe('viewport track paging', () => {
  it('requests a distant page directly instead of filling every preceding page', async () => {
    const load = vi.fn(async () => undefined);
    const { result } = renderHook(() => useTrackViewportPaging({ queryKey: 'songs', pageSize: 100,
      loadedStartIndex: 0, loadedCount: 100, isLoading: false, onLoadPage: load }));
    act(() => result.current({ firstIndex: 10000, lastIndex: 10012 }));
    await waitFor(() => expect(load).toHaveBeenCalledWith(101, 'window'));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid scrolling to the latest viewport while a read is in progress', async () => {
    let finish!: () => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook((props) => useTrackViewportPaging({ queryKey: 'songs', pageSize: 100,
      ...props, onLoadPage: load }), { initialProps: { loadedStartIndex: 0, loadedCount: 100, isLoading: false } });
    act(() => result.current({ firstIndex: 1000, lastIndex: 1010 }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    act(() => {
      result.current({ firstIndex: 3000, lastIndex: 3010 });
      result.current({ firstIndex: 5000, lastIndex: 5010 });
    });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      rerender({ loadedStartIndex: 1000, loadedCount: 100, isLoading: false });
      finish();
    });
    await waitFor(() => expect(load).toHaveBeenNthCalledWith(2, 51, 'window'));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('loads adjoining rows by appending and can seek back before the loaded window', async () => {
    const load = vi.fn(async () => undefined);
    const { result, rerender } = renderHook((props) => useTrackViewportPaging({ queryKey: 'songs', pageSize: 100,
      ...props, isLoading: false, onLoadPage: load }), { initialProps: { loadedStartIndex: 1000, loadedCount: 100 } });
    act(() => result.current({ firstIndex: 1095, lastIndex: 1105 }));
    await waitFor(() => expect(load).toHaveBeenCalledWith(12, 'append'));
    rerender({ loadedStartIndex: 1000, loadedCount: 200 });
    act(() => result.current({ firstIndex: 100, lastIndex: 110 }));
    await waitFor(() => expect(load).toHaveBeenCalledWith(2, 'window'));
  });

  it('does not retry a failed page in an endless render loop', async () => {
    const load = vi.fn(async () => { throw new Error('query failed'); });
    const { result } = renderHook(() => useTrackViewportPaging({ queryKey: 'songs', pageSize: 100,
      loadedStartIndex: 0, loadedCount: 100, isLoading: false, onLoadPage: load }));
    await act(async () => result.current({ firstIndex: 5000, lastIndex: 5010 }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries a skipped viewport read after another refresh releases the slot', async () => {
    let skipped!: (attempted: boolean) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { skipped = resolve; }))
      .mockResolvedValue(true);
    const { result, rerender } = renderHook((props) => useTrackViewportPaging({ queryKey: 'songs', pageSize: 100,
      loadedStartIndex: 0, loadedCount: 100, ...props, onLoadPage: load }), { initialProps: { isLoading: false } });
    act(() => result.current({ firstIndex: 5000, lastIndex: 5010 }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await act(async () => { rerender({ isLoading: true }); skipped(false); });
    expect(load).toHaveBeenCalledTimes(1);
    rerender({ isLoading: false });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load).toHaveBeenLastCalledWith(51, 'window');
  });
});
