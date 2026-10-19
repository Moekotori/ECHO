// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerCoverEntryMenu } from './PlayerCoverEntryMenu';

afterEach(cleanup);

describe('PlayerCoverEntryMenu', () => {
  it('persists the shortcut and broadcasts it without navigating', async () => {
    const setSettings = vi.fn().mockResolvedValue({ playerBarCoverOpensMv: true });
    window.echo = { app: { setSettings } } as unknown as Window['echo'];
    const close = vi.fn();
    const changed = vi.fn();
    const navigate = vi.fn();
    window.addEventListener('settings:changed', changed);
    window.addEventListener('app:navigate:lyrics', navigate);
    try {
      render(<PlayerCoverEntryMenu position={{ x: 20, y: 800 }} opensMv={false} onClose={close} />);
      const options = screen.getAllByRole('menuitemradio');
      expect(options[0].getAttribute('aria-checked')).toBe('true');
      expect(document.activeElement).toBe(options[0]);
      fireEvent.keyDown(options[0], { key: 'ArrowDown' });
      expect(document.activeElement).toBe(options[1]);
      fireEvent.click(options[1]);
      await waitFor(() => expect(close).toHaveBeenCalledOnce());
      expect(setSettings).toHaveBeenCalledWith({ playerBarCoverOpensMv: true });
      expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ playerBarCoverOpensMv: true });
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('settings:changed', changed);
      window.removeEventListener('app:navigate:lyrics', navigate);
    }
  });

  it('keeps the menu open when saving fails and allows dismissal', async () => {
    window.echo = { app: { setSettings: vi.fn().mockRejectedValue(new Error('Save failed')) } } as unknown as Window['echo'];
    const close = vi.fn();
    render(<PlayerCoverEntryMenu position={{ x: 20, y: 20 }} opensMv={true} onClose={close} />);
    fireEvent.click(screen.getAllByRole('menuitemradio')[0]);
    expect((await screen.findByRole('alert')).textContent).toBe('Save failed');
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});
