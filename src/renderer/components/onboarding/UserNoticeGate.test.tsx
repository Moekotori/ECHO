// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { currentUserNoticeVersion } from '../../../shared/types/appSettings';
import { UserNoticeGate } from './UserNoticeGate';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.echo = undefined as unknown as typeof window.echo;
});

describe('UserNoticeGate', () => {
  it('opens notice links through the desktop bridge', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    window.echo = {
      app: {
        openExternalUrl,
      },
    } as unknown as Window['echo'];

    render(<UserNoticeGate onAccepted={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'https://echonext.moe/zh/docs/' }));
    fireEvent.click(screen.getByRole('button', { name: 'https://echonext.moe/zh/docs/community-boundaries/' }));
    fireEvent.click(screen.getByRole('button', { name: 'https://openai.com/zh-Hans-CN/business/partners/' }));

    await waitFor(() => {
      expect(openExternalUrl).toHaveBeenCalledWith('https://echonext.moe/zh/docs/');
      expect(openExternalUrl).toHaveBeenCalledWith('https://echonext.moe/zh/docs/community-boundaries/');
      expect(openExternalUrl).toHaveBeenCalledWith('https://openai.com/zh-Hans-CN/business/partners/');
    });
  });

  it('shows the AI-written-code notice', () => {
    render(<UserNoticeGate onAccepted={vi.fn()} />);

    expect(screen.getByText(/Codex 5\.5/u)).toBeTruthy();
    expect(screen.getByText(/Claude Fable/u)).toBeTruthy();
    expect(screen.getByText(/ICPC World Final Winner/u)).toBeTruthy();
    expect(screen.getByText(/vibe coding/u)).toBeTruthy();
  });

  it('persists the accepted notice version before entering', async () => {
    const acceptedSettings = { userNoticeAcceptedVersion: currentUserNoticeVersion } as never;
    const setSettings = vi.fn().mockResolvedValue(acceptedSettings);
    const onAccepted = vi.fn();
    window.echo = {
      app: {
        setSettings,
      },
    } as unknown as Window['echo'];

    render(<UserNoticeGate onAccepted={onAccepted} />);

    fireEvent.click(screen.getByRole('button', { name: '\u6211\u5df2\u9605\u8bfb\u5e76\u540c\u610f' }));

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith({ userNoticeAcceptedVersion: currentUserNoticeVersion });
      expect(onAccepted).toHaveBeenCalledWith(acceptedSettings);
    });
  });

  it('exits the app when declined', async () => {
    const quit = vi.fn().mockResolvedValue(undefined);
    window.echo = {
      app: {
        quit,
      },
    } as unknown as Window['echo'];

    render(<UserNoticeGate onAccepted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '\u4e0d\u540c\u610f\uff0c\u9000\u51fa' }));

    await waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
  });
});
