// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FirstRunWizard } from './FirstRunWizard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.echo = undefined as unknown as typeof window.echo;
});

describe('FirstRunWizard', () => {
  it('opens the official ECHO docs through the desktop bridge', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    window.echo = {
      app: {
        openExternalUrl,
      },
    } as unknown as Window['echo'];

    render(<FirstRunWizard initialSettings={null} onClose={vi.fn()} onCompleted={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '查看 ECHO 文档' }));

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith('https://echonext.moe/zh/docs/'));
  });

  it('opens the ECHO Next Pro sponsor channel from the summary guide', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    window.echo = {
      app: {
        openExternalUrl,
      },
    } as unknown as Window['echo'];

    render(<FirstRunWizard initialSettings={null} onClose={vi.fn()} onCompleted={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    fireEvent.click(screen.getByRole('button', { name: '打开赞助渠道' }));

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith('https://afdian.com/a/echonext'));
  });

  it('persists optional performance features chosen during first run', async () => {
    const getSettings = vi.fn().mockResolvedValue({});
    const setSettings = vi.fn().mockImplementation(async (patch) => patch);
    const setOutput = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    window.echo = {
      app: {
        getSettings,
        setSettings,
      },
      audio: {
        setOutput,
      },
    } as unknown as Window['echo'];

    render(<FirstRunWizard initialSettings={null} onClose={onClose} onCompleted={onCompleted} />);

    const primaryButton = (): HTMLButtonElement => document.querySelector('.first-run-primary') as HTMLButtonElement;

    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(primaryButton());
    }

    const featureButtons = Array.from(document.querySelectorAll('.first-run-stage .first-run-options button')) as HTMLButtonElement[];
    expect(featureButtons).toHaveLength(4);
    featureButtons.forEach((button) => fireEvent.click(button));

    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(primaryButton());
    }
    fireEvent.click(primaryButton());

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
        lowLoadPlaybackModeEnabled: true,
        albumWallVirtualizationEnabled: true,
        osuDownloaderFeatureEnabled: true,
        audioNativeDirectLocalPlaybackEnabled: true,
      }));
    });
    expect(setOutput).toHaveBeenCalledWith(expect.objectContaining({
      nativeDirectLocalPlaybackEnabled: true,
    }));
    expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({
      lowLoadPlaybackModeEnabled: true,
      albumWallVirtualizationEnabled: true,
      osuDownloaderFeatureEnabled: true,
      audioNativeDirectLocalPlaybackEnabled: true,
    }));
    expect(onClose).toHaveBeenCalled();
  });
});
