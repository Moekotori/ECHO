// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DebouncedSearchInput } from './DebouncedSearchInput';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('DebouncedSearchInput', () => {
  it('keeps typing out of the parent render until a search is committed', () => {
    vi.useFakeTimers();
    const renders = vi.fn();
    function Page(): JSX.Element {
      const [search, setSearch] = useState('');
      renders(search);
      return <DebouncedSearchInput aria-label="Search" onSearchChange={setSearch} />;
    }
    render(<Page />);
    renders.mockClear();
    const input = screen.getByRole('searchbox');
    for (const value of ['m', 'mo', 'mof', 'mofa']) fireEvent.change(input, { target: { value } });
    expect(renders).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(250); });
    expect(renders).toHaveBeenCalledTimes(1);
    expect(renders).toHaveBeenLastCalledWith('mofa');
  });

  it('cancels an older draft timer when IME composition begins', () => {
    vi.useFakeTimers();
    const onSearchChange = vi.fn();
    render(<DebouncedSearchInput aria-label="Search" onSearchChange={onSearchChange} />);
    const input = screen.getByRole('searchbox');
    onSearchChange.mockClear();
    fireEvent.change(input, { target: { value: 'old' } });
    fireEvent.compositionStart(input);
    act(() => { vi.advanceTimersByTime(500); });
    expect(onSearchChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '中文' } });
    fireEvent.compositionEnd(input);
    expect(onSearchChange).toHaveBeenCalledExactlyOnceWith('中文');
    act(() => { vi.advanceTimersByTime(500); });
    expect(onSearchChange).toHaveBeenCalledTimes(1);
  });

  it('does not repeat equivalent searches and cancels pending work on unmount', () => {
    vi.useFakeTimers();
    const onSearchChange = vi.fn();
    const view = render(<DebouncedSearchInput aria-label="Search" onSearchChange={onSearchChange} />);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'song' } });
    act(() => { vi.advanceTimersByTime(250); });
    onSearchChange.mockClear();
    fireEvent.change(input, { target: { value: ' song ' } });
    act(() => { vi.advanceTimersByTime(250); });
    expect(onSearchChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'pending' } });
    view.unmount();
    act(() => { vi.advanceTimersByTime(250); });
    expect(onSearchChange).not.toHaveBeenCalled();
  });

  it('restores the current search when returning from a detail view', () => {
    const onSearchChange = vi.fn();
    render(<DebouncedSearchInput aria-label="Search" initialValue="saved search" onSearchChange={onSearchChange} />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('saved search');
    expect(onSearchChange).toHaveBeenCalledExactlyOnceWith('saved search');
  });
});
