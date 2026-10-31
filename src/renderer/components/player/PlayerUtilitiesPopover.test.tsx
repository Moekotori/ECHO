// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlayerUtilitiesPopover } from './PlayerUtilitiesPopover';
import { SleepTimerPopover } from './SleepTimerPopover';
import type { SleepTimerStatus } from '../../../shared/types/sleepTimer';

const idle: SleepTimerStatus = { isActive: false, remainingMs: 0, durationMinutes: 0, action: 'pause', fadeOutEnabled: false };
const active: SleepTimerStatus = { ...idle, isActive: true, remainingMs: 300_000, durationMinutes: 5 };
const api = { getStatus: vi.fn(), start: vi.fn(), cancel: vi.fn(), onTick: vi.fn() };
const close = vi.fn();
const openQueue = vi.fn();
const panel = (isOpen = true) => <PlayerUtilitiesPopover isOpen={isOpen} onOpenChange={close} onOpenQueue={openQueue}
  windowControls={<button>迷你播放器</button>} sleepPanel={(visible) => <SleepTimerPopover embedded isVisible={visible} onClose={() => {}} />}>
  <span>音量</span>
</PlayerUtilitiesPopover>;
const openSleep = async () => {
  fireEvent.click(screen.getByRole('tab', { name: '睡眠定时' }));
  await waitFor(() => expect(api.getStatus).toHaveBeenCalled());
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getStatus.mockResolvedValue(idle);
  api.start.mockResolvedValue(active);
  api.cancel.mockResolvedValue(idle);
  api.onTick.mockReturnValue(vi.fn());
  window.echo = { sleepTimer: api } as unknown as Window['echo'];
});
afterEach(() => cleanup());

describe('player utility flows', () => {
  it('retains a timer draft across tabs and close/reopen and submits the selected settings', async () => {
    const { rerender } = render(panel());
    await openSleep();
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    fireEvent.click(screen.getByRole('switch', { name: '触发前渐弱' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('tab', { name: '快捷操作' }));
    fireEvent.click(screen.getByRole('tab', { name: '睡眠定时' }));
    rerender(panel(false));
    rerender(panel());
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('12');
    expect(screen.getByRole('button', { name: '停止' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith({ durationMinutes: 12, action: 'stop', fadeOut: false }));
  });

  it('rejects fractional minutes and blocks duplicate requests while starting', async () => {
    let resolveStart!: (status: SleepTimerStatus) => void;
    api.start.mockReturnValue(new Promise<SleepTimerStatus>((resolve) => { resolveStart = resolve; }));
    render(panel());
    await openSleep();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1.5' } });
    expect((screen.getByRole('button', { name: '确定' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '5分钟' }));
    fireEvent.click(screen.getByRole('button', { name: '10分钟' }));
    expect(api.start).toHaveBeenCalledTimes(1);
    resolveStart(active);
    await screen.findByText('05:00');
  });

  it('shows start and cancellation failures and allows a retry', async () => {
    api.start.mockRejectedValueOnce(new Error('start failed')).mockResolvedValueOnce(active);
    api.cancel.mockRejectedValueOnce(new Error('cancel failed')).mockResolvedValueOnce(idle);
    render(panel());
    await openSleep();
    fireEvent.click(screen.getByRole('button', { name: '5分钟' }));
    await screen.findByText('start failed');
    fireEvent.click(screen.getByRole('button', { name: '5分钟' }));
    await screen.findByText('05:00');
    fireEvent.click(screen.getByRole('button', { name: '取消定时器' }));
    await screen.findByText('cancel failed');
    expect(screen.getByText('05:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消定时器' }));
    await screen.findByRole('button', { name: '5分钟' });
  });

  it('exposes a timer switch with an explicit 30-minute default and reflects cancellation', async () => {
    render(panel());
    await openSleep();
    const control = screen.getByRole('switch', { name: '睡眠定时器' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(control);
    await waitFor(() => expect(api.start).toHaveBeenCalledWith({ durationMinutes: 30, action: 'pause', fadeOut: true }));
    await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(control);
    await waitFor(() => expect(api.cancel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('false'));
  });

  it('consumes Escape before page navigation and restores focus to its opener', () => {
    render(panel());
    const navigateBack = vi.fn();
    document.addEventListener('keydown', navigateBack);
    try {
      const tab = screen.getByRole('tab', { name: '播放' });
      tab.focus();
      expect(fireEvent.keyDown(tab, { key: 'Escape' })).toBe(false);
      expect(navigateBack).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledWith(false);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '快捷操作' }));
    } finally {
      document.removeEventListener('keydown', navigateBack);
    }
  });

  it('navigates tabs by keyboard and closes the popover when opening the queue', () => {
    render(panel());
    fireEvent.keyDown(screen.getByRole('tab', { name: '播放' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: '快捷操作' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '播放队列' }));
    expect(close).toHaveBeenCalledWith(false);
    expect(openQueue).toHaveBeenCalledTimes(1);
  });
});
