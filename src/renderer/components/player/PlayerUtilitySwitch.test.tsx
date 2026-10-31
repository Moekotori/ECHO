// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlayerUtilitySwitch } from './PlayerUtilitySwitch';

afterEach(cleanup);

it('shows an explicit switch and text for both enabled and disabled states', () => {
  const toggle = vi.fn();
  const { rerender } = render(<PlayerUtilitySwitch label="桌面歌词" icon={<span />} checked={false} onClick={toggle} />);
  const control = screen.getByRole('switch', { name: '桌面歌词' });
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByText('已关闭')).toBeTruthy();
  expect(control.querySelector('.player-utility-toggle-thumb')).not.toBeNull();
  fireEvent.click(control);
  expect(toggle).toHaveBeenCalledTimes(1);
  rerender(<PlayerUtilitySwitch label="桌面歌词" icon={<span />} checked onClick={toggle} />);
  expect(screen.getByRole('switch', { name: '桌面歌词' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('已开启')).toBeTruthy();
});

it('blocks repeated toggling while a window action is pending', () => {
  const toggle = vi.fn();
  render(<PlayerUtilitySwitch label="迷你播放器" icon={<span />} checked={false} disabled onClick={toggle} />);
  fireEvent.click(screen.getByRole('switch', { name: '迷你播放器' }));
  expect(toggle).not.toHaveBeenCalled();
});
