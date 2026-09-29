// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isImeComposingKeyEvent, useImeAwareDebouncedSearch } from './imeInput';

const SearchProbe = ({ onSearchChange }: { onSearchChange: (value: string) => void }): JSX.Element => {
  const { search, searchInputProps } = useImeAwareDebouncedSearch(250);

  useEffect(() => {
    onSearchChange(search);
  }, [onSearchChange, search]);

  return <input aria-label="Search" type="search" {...searchInputProps} />;
};

describe('imeInput', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects Windows IME composing key events', () => {
    expect(isImeComposingKeyEvent({ key: 'Process' })).toBe(true);
    expect(isImeComposingKeyEvent({ keyCode: 229 })).toBe(true);
    expect(isImeComposingKeyEvent({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeComposingKeyEvent({ key: 'Enter' })).toBe(false);
  });

  it('keeps search commits paused until IME composition ends', () => {
    vi.useFakeTimers();
    const onSearchChange = vi.fn();
    render(<SearchProbe onSearchChange={onSearchChange} />);

    const input = screen.getByLabelText('Search') as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'zhong' } });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(input.value).toBe('zhong');
    expect(onSearchChange).toHaveBeenLastCalledWith('');

    fireEvent.change(input, { target: { value: '中' } });
    fireEvent.compositionEnd(input);

    expect(onSearchChange).toHaveBeenLastCalledWith('中');
  });
});
