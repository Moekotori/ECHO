// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { SteamEditionWelcome } from './SteamEditionWelcome';

const renderWelcome = (onboardingCompleted: boolean): void => {
  window.echo = {
    app: {
      getSettings: vi.fn().mockResolvedValue({ onboardingCompleted }),
      getVersion: vi.fn().mockResolvedValue('v26.9.25'),
      openExternalUrl: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Window['echo'];
  render(<I18nProvider><SteamEditionWelcome /></I18nProvider>);
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  (window as unknown as { echo?: Window['echo'] }).echo = undefined;
});

describe('SteamEditionWelcome', () => {
  it('promotes Steam once to an existing community user after updating', async () => {
    renderWelcome(true);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Steam');
    fireEvent.click(screen.getByRole('button', { name: /前往 Steam|View on Steam/ }));
    await waitFor(() => expect(window.echo?.app?.openExternalUrl).toHaveBeenCalledWith('https://store.steampowered.com/app/5105090/ECHO/'));
    fireEvent.click(screen.getByRole('button', { name: /关闭 Steam 版介绍|Close Steam edition introduction/ }));
    expect(screen.queryByRole('dialog')).toBeNull();

    cleanup();
    renderWelcome(true);
    await waitFor(() => expect(window.echo?.app?.getSettings).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not interrupt a fresh installation or show after its setup', async () => {
    renderWelcome(false);
    await waitFor(() => expect(window.localStorage.getItem('echo:steam-edition-promo:2026-09')).toBe('seen'));
    expect(screen.queryByRole('dialog')).toBeNull();

    cleanup();
    renderWelcome(true);
    await waitFor(() => expect(window.echo?.app?.getSettings).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('can be dismissed with Escape', async () => {
    renderWelcome(true);
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
