// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingHelpTooltip } from './SettingHelpTooltip';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SettingHelpTooltip', () => {
  it('shows help for pointer and keyboard users and closes with Escape', () => {
    vi.useFakeTimers();
    render(<SettingHelpTooltip label="了解新手教程">重新打开第一次启动时的向导。</SettingHelpTooltip>);

    const trigger = screen.getByRole('button', { name: '了解新手教程' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    expect(screen.getByRole('tooltip').textContent).toBe('重新打开第一次启动时的向导。');

    fireEvent.mouseLeave(trigger.parentElement as HTMLElement);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('lets the pointer cross into the bubble and read without dismissing it', () => {
    vi.useFakeTimers();
    render(<SettingHelpTooltip label="Help">Long explanation</SettingHelpTooltip>);
    const trigger = screen.getByRole('button', { name: 'Help' });
    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    fireEvent.mouseLeave(trigger.parentElement as HTMLElement);
    act(() => vi.advanceTimersByTime(80));
    fireEvent.mouseEnter(screen.getByRole('tooltip'));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip').textContent).toBe('Long explanation');
    fireEvent.scroll(screen.getByRole('tooltip'));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.mouseLeave(screen.getByRole('tooltip'));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('pins on click, toggles closed and dismisses for outside interaction or Escape', () => {
    render(<><SettingHelpTooltip label="Help">Explanation</SettingHelpTooltip><button>Elsewhere</button></>);
    const trigger = screen.getByRole('button', { name: 'Help' });
    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('data-pinned')).toBe('true');
    fireEvent.mouseLeave(trigger.parentElement as HTMLElement);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.focus(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.scroll(document);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('bounds long help to the available space at the bottom right of a small window', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 280, right: 304, top: 180, bottom: 204, width: 24, height: 24, x: 280, y: 180, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    render(<SettingHelpTooltip label="Help">Long explanation</SettingHelpTooltip>);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const bubble = screen.getByRole('tooltip');
    expect(bubble.style.left).toBe('24px');
    expect(bubble.style.width).toBe('272px');
    expect(bubble.style.bottom).toBe('66px');
    expect(bubble.style.maxHeight).toBe('150px');
  });

  it('mounts the help bubble on the document top layer above later setting rows', () => {
    const { container } = render(
      <div className="setting-row">
        <SettingHelpTooltip label="了解新手教程">重新打开第一次启动时的向导。</SettingHelpTooltip>
      </div>,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: '了解新手教程' }).parentElement as HTMLElement);
    const tooltip = screen.getByRole('tooltip');

    expect(tooltip.parentElement).toBe(document.body);
    expect(container.contains(tooltip)).toBe(false);
  });
});
