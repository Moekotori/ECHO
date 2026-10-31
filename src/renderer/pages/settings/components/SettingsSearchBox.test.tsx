// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsSearchBox } from './SettingsSearchBox';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const result = { id: 'lyrics-font', sectionKey: 'lyrics' as const, title: '歌词字体', path: '歌词 / 显示', description: '调整歌词字体', targetId: 'font', score: 120 };
const props = () => ({
  activeResultIndex: 0, inputRef: createRef<HTMLInputElement>(), onActiveResultIndexChange: vi.fn(),
  onQueryChange: vi.fn(), onResultSelect: vi.fn(), onSearchKeyDown: vi.fn(), query: '歌词',
  t: (key: string) => key, visibleSearchResults: [result],
});

describe('SettingsSearchBox', () => {
  it('closes outside, preserves the query and reopens on focus or arrow keys', () => {
    const inputProps = props();
    render(<SettingsSearchBox {...inputProps} />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.focus(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe('settings-search-result-lyrics-font');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.value).toBe('歌词');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(inputProps.onSearchKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.blur(input, { relatedTarget: document.body });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(inputProps.onQueryChange).not.toHaveBeenCalled();
  });

  it('selects a result without losing the input focus or triggering a second selection', () => {
    const inputProps = props();
    render(<SettingsSearchBox {...inputProps} />);
    fireEvent.focus(screen.getByRole('combobox'));
    const option = screen.getByRole('option');
    fireEvent.mouseEnter(option);
    expect(inputProps.onActiveResultIndexChange).not.toHaveBeenCalled();
    fireEvent.mouseMove(option);
    expect(inputProps.onActiveResultIndexChange).toHaveBeenCalledWith(0);
    expect(option.tabIndex).toBe(-1);
    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.click(option);
    expect(inputProps.onResultSelect).toHaveBeenCalledExactlyOnceWith(result);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not select or dismiss while the IME is composing', () => {
    const inputProps = props();
    render(<SettingsSearchBox {...inputProps} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    for (const key of ['Enter', 'Escape', 'ArrowDown']) fireEvent.keyDown(input, { key, isComposing: true });
    expect(inputProps.onSearchKeyDown).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(inputProps.onSearchKeyDown).toHaveBeenCalledOnce();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps keyboard selection visible and bounds the popup to the window', () => {
    const scrollIntoView = vi.fn();
    vi.stubGlobal('innerHeight', 400);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ bottom: 100 } as DOMRect);
    const inputProps = props();
    const { rerender } = render(<SettingsSearchBox {...inputProps} visibleSearchResults={[result, { ...result, id: 'second' }]} />);
    fireEvent.focus(screen.getByRole('combobox'));
    screen.getAllByRole('option')[1].scrollIntoView = scrollIntoView;
    rerender(<SettingsSearchBox {...inputProps} activeResultIndex={1} visibleSearchResults={[result, { ...result, id: 'second' }]} />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(screen.getByRole('listbox').style.maxHeight).toBe('276px');
  });

  it('fits above the player footer using the settings panel boundary', () => {
    vi.stubGlobal('innerHeight', 600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { bottom: this.classList.contains('settings-page') ? 440 : 100 } as DOMRect;
    });
    render(<main className="settings-page"><SettingsSearchBox {...props()} /></main>);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox').style.maxHeight).toBe('316px');
  });
});
