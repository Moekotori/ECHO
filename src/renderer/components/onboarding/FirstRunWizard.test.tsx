// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FirstRunWizard, getSupportedFirstRunOutputModes } from './FirstRunWizard';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.echo = undefined as unknown as typeof window.echo;
});

describe('FirstRunWizard', () => {
  it('leaves onboarding incomplete when adding a chosen folder fails', async () => {
    const setSettings = vi.fn().mockImplementation(async patch => patch);
    const onClose = vi.fn();
    window.echo = {
      app: { getSettings: vi.fn().mockResolvedValue({ onboardingCompleted: false }), setSettings },
      audio: { setOutput: vi.fn().mockResolvedValue(undefined) },
      library: {
        chooseFolder: vi.fn().mockResolvedValue('Music'),
        addFolder: vi.fn().mockRejectedValue(new Error('folder unavailable')),
      },
    } as unknown as Window['echo'];
    render(<FirstRunWizard initialSettings={null} onClose={onClose} onCompleted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
    await waitFor(() => expect(document.querySelectorAll('.first-run-folder-list li')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    fireEvent.click(document.querySelector('.first-run-primary')!);
    await screen.findByText('folder unavailable');
    expect(setSettings).not.toHaveBeenCalledWith(expect.objectContaining({ onboardingCompleted: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('marks completion on skip so the native window can enter the main view', async () => {
    const setSettings = vi.fn().mockResolvedValue({ onboardingCompleted: true });
    const onClose = vi.fn();
    window.echo = { app: { setSettings } } as unknown as Window['echo'];
    render(<FirstRunWizard initialSettings={null} onClose={onClose} onCompleted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '跳过设置' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(setSettings).toHaveBeenCalledWith({ onboardingCompleted: true });
  });

  it('shows current shortcuts and saves the close choice only when finishing', async () => {
    const setSettings = vi.fn().mockImplementation(async patch => patch);
    const existing = { hideToTrayOnClose: false, localShortcuts: { playPause: { enabled: true, accelerator: 'Ctrl+P' } } };
    window.echo = {
      app: { getSettings: vi.fn().mockResolvedValue(existing), setSettings },
      audio: { setOutput: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Window['echo'];
    render(<FirstRunWizard initialSettings={existing as Parameters<typeof FirstRunWizard>[0]['initialSettings']} onClose={vi.fn()} onCompleted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /日常操作/ }));
    expect(screen.getByText('Ctrl + P')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: '关闭时隐藏到托盘' }));
    expect(setSettings).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.first-run-primary')!);
    expect(document.querySelector('.first-run-immersive-stage')?.getAttribute('data-step')).toBe('summary');
    fireEvent.click(document.querySelector('.first-run-primary')!);
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ hideToTrayOnClose: true })));
  });

  it('offers CoreAudio shared and exclusive output on macOS', () => {
    expect(getSupportedFirstRunOutputModes('darwin')).toMatchObject([
      { mode: 'shared', label: 'CoreAudio Shared' },
      { mode: 'exclusive', label: 'CoreAudio Exclusive' },
    ]);
  });

  it('offers WASAPI and ASIO output on Windows', () => {
    expect(getSupportedFirstRunOutputModes('win32').map((item) => item.mode)).toEqual([
      'shared',
      'system',
      'exclusive',
      'asio',
    ]);
  });

  it('offers the Community Linux shared and system output modes', () => {
    expect(getSupportedFirstRunOutputModes('linux')).toMatchObject([
      { mode: 'shared', labelKey: 'firstRun.audio.linuxShared.label' },
      { mode: 'system' },
    ]);
  });

  it('does not expose the external docs purchase path', () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    window.echo = {
      app: {
        openExternalUrl,
      },
    } as unknown as Window['echo'];

    render(<FirstRunWizard initialSettings={null} onClose={vi.fn()} onCompleted={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '查看 ECHO 文档' })).toBeNull();

    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it('keeps ECHO Pro out of the first-run flow', () => {
    render(<FirstRunWizard initialSettings={null} onClose={vi.fn()} onCompleted={vi.fn()} />);

    expect(screen.queryByText('ECHO Pro')).toBeNull();
  });

  it('recommends Ultralight without enabling it for a new profile', () => {
    render(<FirstRunWizard initialSettings={null} onClose={vi.fn()} onCompleted={vi.fn()} />);

    const toggle = document.querySelector('.first-run-ultralight-toggle input') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByText('推荐开启')).toBeTruthy();
  });

  it('shows language and library together and advances directly to output', () => {
    render(<FirstRunWizard initialSettings={null} onClose={vi.fn()} onCompleted={vi.fn()} />);

    expect(document.querySelector('.first-run-substep-slot')).toBeNull();

    expect(screen.getByRole('listbox', { name: '语言' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '社区版与 Steam 版差距极大' })).toBeTruthy();
    expect(screen.getByText(/上 GitHub 发帖前，请先注意基本礼貌/)).toBeTruthy();
    // Language, music folders and cache location share the first page.
    expect(document.querySelector('.first-run-substep-slot')).toBeNull();
    expect(document.querySelectorAll('.first-run-path-preview')).toHaveLength(2);
    expect(screen.queryByText('选择可选性能功能')).toBeNull();
    expect(screen.queryByText('减轻占用播放')).toBeNull();
    expect(screen.getByRole('button', { name: /扫描性能/ })).toBeTruthy();

    fireEvent.click(document.querySelector('.first-run-primary')!);
    expect(document.querySelector('.first-run-immersive-stage')?.getAttribute('data-step')).toBe('audio');
    fireEvent.click(screen.getByRole('button', { name: '外观' }));
    expect(document.querySelector('.first-run-substep-slot')).toBeNull();
    // Theme cards are available on demand and start collapsed.
    const presets = document.querySelector('.first-run-preset-disclosure') as HTMLDetailsElement;
    expect(presets.open).toBe(false);
    fireEvent.click(presets.querySelector('summary')!);
    expect(presets.open).toBe(true);
    expect(presets.querySelectorAll('.first-run-appearance-preset-grid button').length).toBeGreaterThan(1);
    expect(document.querySelector('.first-run-wallpaper-section')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(document.querySelectorAll('.first-run-summary-configuration dl > div')).toHaveLength(7);
    expect(screen.getByText('缓存')).toBeTruthy();
    expect(screen.getByText('扫描')).toBeTruthy();
    expect(screen.getByText('ECHO Ultralight')).toBeTruthy();
    expect(screen.getByText('暂不开启')).toBeTruthy();
    expect(document.querySelector('.first-run-immersive-stage-heading')?.textContent).toContain('可以开始了');
  });

  it('imports folders selected across multiple picks and supports removal', async () => {
    const chooseFolder = vi.fn().mockResolvedValueOnce('D:\\Music').mockResolvedValueOnce('E:\\Anime');
    const addFolder = vi.fn().mockImplementation(async (path: string) => ({ id: path }));
    const scanFolder = vi.fn().mockResolvedValue({ state: 'queued' });
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({}),
        setSettings: vi.fn().mockImplementation(async (patch) => patch),
      },
      audio: {
        setOutput: vi.fn().mockResolvedValue(undefined),
      },
      library: { chooseFolder, addFolder, scanFolder },
    } as unknown as Window['echo'];

    render(<FirstRunWizard initialSettings={null} onClose={vi.fn()} onCompleted={vi.fn()} />);

    const primaryButton = (): HTMLButtonElement => document.querySelector('.first-run-primary') as HTMLButtonElement;

    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
    await waitFor(() => expect(document.querySelectorAll('.first-run-folder-list li')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '继续添加文件夹' }));
    await waitFor(() => expect(document.querySelectorAll('.first-run-folder-list li')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: /移除此文件夹: E:\\Anime/ }));
    expect(document.querySelectorAll('.first-run-folder-list li')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    fireEvent.click(primaryButton());

    await waitFor(() => expect(addFolder).toHaveBeenCalledTimes(1));
    expect(addFolder).toHaveBeenCalledWith('D:\\Music');
    expect(scanFolder).toHaveBeenCalledWith('D:\\Music');
  });

  it('previews theme drafts immediately and saves the selected appearance only on Finish', async () => {
    const setSettings = vi.fn().mockImplementation(async (patch) => patch);
    window.echo = {
      app: { getSettings: vi.fn().mockResolvedValue({}), setSettings },
      audio: { setOutput: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Window['echo'];
    render(<FirstRunWizard initialSettings={null} onClose={vi.fn()} onCompleted={vi.fn()} />);
    const rootTheme = document.documentElement.dataset.theme;
    const backdrop = document.querySelector('.first-run-backdrop') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(backdrop.style.colorScheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe(rootTheme);
    expect(setSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '外观' }));
    expect(screen.getByRole('button', { name: /深色.*夜间/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /浅色.*清爽/ }));
    expect(backdrop.style.colorScheme).toBe('light');
    expect(screen.getByRole('button', { name: '浅色' }).getAttribute('aria-pressed')).toBe('true');

    const preview = document.querySelector('.first-run-appearance-preview') as HTMLElement;
    const lightBackground = preview.style.getPropertyValue('--fr-preview-bg');
    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(preview.style.getPropertyValue('--fr-preview-bg')).not.toBe(lightBackground);
    const classicAccent = preview.style.getPropertyValue('--fr-preview-accent');
    const presets = document.querySelector('.first-run-preset-disclosure') as HTMLDetailsElement;
    fireEvent.click(presets.querySelector('summary')!);
    fireEvent.click(screen.getByRole('button', { name: '樱粉奶霜' }));
    expect(preview.style.getPropertyValue('--fr-preview-accent')).not.toBe(classicAccent);
    expect(setSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    fireEvent.click(document.querySelector('.first-run-primary')!);
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
      appearanceTheme: 'dark', appearanceThemePreset: 'sakuraMilk',
    })));
  });

  it('preserves an existing low-load setting when finishing without a performance choice', async () => {
    const existingSettings = { lowLoadPlaybackModeEnabled: true };
    let storedSettings = { ...existingSettings };
    const getSettings = vi.fn().mockImplementation(async () => storedSettings);
    const setSettings = vi.fn().mockImplementation(async (patch) => {
      storedSettings = { ...storedSettings, ...patch };
      return storedSettings;
    });
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

    render(<FirstRunWizard initialSettings={existingSettings as Parameters<typeof FirstRunWizard>[0]['initialSettings']} onClose={onClose} onCompleted={onCompleted} />);

    const primaryButton = (): HTMLButtonElement => document.querySelector('.first-run-primary') as HTMLButtonElement;

    // Library choices are available on the first page.
    expect(screen.queryByText('选择可选性能功能')).toBeNull();
    expect(screen.queryByText('减轻占用播放')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /扫描性能/ }));
    fireEvent.click(screen.getByRole('option', { name: /低占用/ }));

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    fireEvent.click(primaryButton());

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
        ultraLightOnMinimizeOrTrayEnabled: false,
        scanPerformanceMode: 'low',
      }));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(setSettings.mock.calls[0]?.[0]).not.toHaveProperty('lowLoadPlaybackModeEnabled');
    expect(setOutput).toHaveBeenCalledWith(expect.objectContaining({ outputMode: expect.any(String) }));
    expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({
      lowLoadPlaybackModeEnabled: true,
    }));
    expect(onClose).toHaveBeenCalled();
  });
});
