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

  it('opens the ECHO Next Pro purchase link from its dedicated page', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    window.echo = {
      app: {
        openExternalUrl,
      },
    } as unknown as Window['echo'];

    render(<FirstRunWizard initialSettings={null} onClose={vi.fn()} onCompleted={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /ECHO Next Pro/ }));
    expect(screen.getByText('DSP Center')).toBeTruthy();
    expect(screen.getByText(/OPRA 耳机校正.*FIR 房间校正/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /打开赞助渠道/ }));

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith('https://afdian.com/a/echonext'));
  });

  it('groups the original setup flow into phases while keeping the library substeps', () => {
    render(<FirstRunWizard initialSettings={null} onClose={vi.fn()} onCompleted={vi.fn()} />);

    expect(document.querySelectorAll('.first-run-phase-nav button')).toHaveLength(6);
    expect(document.querySelector('.first-run-workspace-header button')).toBeNull();
    expect(document.querySelector('.first-run-substep-single')?.textContent).toContain('语言');

    fireEvent.click(screen.getByRole('button', { name: /选择文件夹.*缓存.*扫描/ }));

    const substeps = Array.from(document.querySelectorAll('.first-run-substep-nav button')) as HTMLButtonElement[];
    expect(substeps).toHaveLength(3);
    expect(substeps[0]?.getAttribute('aria-current')).toBe('step');
    expect(substeps[1]?.disabled).toBe(false);
    expect(substeps[2]?.disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /外观.*osu!.*账号/ }));

    const personalizationSubsteps = Array.from(document.querySelectorAll('.first-run-substep-nav button')) as HTMLButtonElement[];
    expect(personalizationSubsteps).toHaveLength(3);
    expect(personalizationSubsteps.map((button) => button.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('外观'),
      expect.stringContaining('osu!'),
      expect.stringContaining('账号'),
    ]));

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(document.querySelectorAll('.first-run-summary-after li')).toHaveLength(3);
    expect(document.querySelectorAll('.first-run-summary-configuration dl > div')).toHaveLength(4);
    expect(document.querySelector('.first-run-immersive-stage-heading')?.textContent).toContain('可以开始了');
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

    const featureButtons = Array.from(document.querySelectorAll('.first-run-immersive-stage .first-run-options button')) as HTMLButtonElement[];
    expect(featureButtons).toHaveLength(2);
    featureButtons.forEach((button) => fireEvent.click(button));

    fireEvent.click(primaryButton());
    fireEvent.click(primaryButton());

    expect(screen.getByRole('heading', { name: '你是 osu! 玩家吗？' })).toBeTruthy();
    const osuPlayerChoice = document.querySelector('.first-run-osu-choice--yes') as HTMLButtonElement;
    fireEvent.click(osuPlayerChoice);
    expect(osuPlayerChoice.getAttribute('aria-pressed')).toBe('true');

    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(primaryButton());
    }
    fireEvent.click(primaryButton());

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
        lowLoadPlaybackModeEnabled: true,
        albumWallVirtualizationEnabled: true,
        osuDownloaderFeatureEnabled: true,
      }));
    });
    expect(setOutput).toHaveBeenCalledWith(expect.objectContaining({ outputMode: expect.any(String) }));
    expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({
      lowLoadPlaybackModeEnabled: true,
      albumWallVirtualizationEnabled: true,
      osuDownloaderFeatureEnabled: true,
    }));
    expect(onClose).toHaveBeenCalled();
  });
});
