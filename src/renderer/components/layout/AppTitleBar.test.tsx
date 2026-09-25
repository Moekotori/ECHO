// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppTitleBar } from './AppTitleBar';
import { I18nProvider } from '../../i18n/I18nProvider';
import { loadTranslations } from '../../i18n/locales';

beforeAll(async () => {
  await loadTranslations('en-US');
});

beforeEach(() => {
  window.localStorage.setItem('echo-next.locale', 'en-US');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AppTitleBar', () => {
  const renderTitleBar = (props: Parameters<typeof AppTitleBar>[0]): void => {
    render(
      <I18nProvider>
        <AppTitleBar {...props} />
      </I18nProvider>,
    );
  };

  it('keeps album and import file out of the titlebar quick actions', () => {
    const onRouteChange = vi.fn();

    renderTitleBar({
      activeRouteId: 'songs',
      onRouteChange,
      onOpenAudioSettings: vi.fn(),
      onMinimize: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
    });

    expect(screen.queryByRole('button', { name: 'Albums' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import File' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Plugin commands|插件命令/u })).toBeNull();
    expect(screen.getByText('Community')).toBeTruthy();
    expect(onRouteChange).not.toHaveBeenCalled();
  });

  it('shows Community without a Pro badge', () => {
    renderTitleBar({
      activeRouteId: 'songs',
      onRouteChange: vi.fn(),
      onOpenAudioSettings: vi.fn(),
      onMinimize: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
    });

    expect(screen.getByText('Community').className).toBe('app-titlebar-edition');
    expect(screen.queryByText('Pro')).toBeNull();
  });

  it('shows the normalized app version directly after Community', async () => {
    window.echo = {
      app: {
        getVersion: vi.fn().mockResolvedValue('26.7.18'),
      },
    } as unknown as Window['echo'];

    renderTitleBar({
      activeRouteId: 'songs',
      onRouteChange: vi.fn(),
      onOpenAudioSettings: vi.fn(),
      onMinimize: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
    });

    const version = await screen.findByLabelText('ECHO app version v26.7.18');
    expect(version.textContent).toBe('v26.7.18');
    expect(version.previousElementSibling?.textContent).toBe('Community');
  });

  it('keeps navigation buttons as route changes', () => {
    const onRouteChange = vi.fn();

    renderTitleBar({
      activeRouteId: 'songs',
      onRouteChange,
      onOpenAudioSettings: vi.fn(),
      onMinimize: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(onRouteChange).toHaveBeenCalledWith('settings');
  });

  it('preloads settings when the titlebar settings button is approached', () => {
    const onPreloadSettings = vi.fn();
    renderTitleBar({
      activeRouteId: 'songs',
      onRouteChange: vi.fn(),
      onPreloadSettings,
      onOpenAudioSettings: vi.fn(),
      onMinimize: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
    });

    fireEvent.pointerEnter(screen.getByRole('button', { name: /^(Settings|设置)$/u }));

    expect(onPreloadSettings).toHaveBeenCalledTimes(1);
  });

  it('opens the audio drawer from the audio settings button', () => {
    const onRouteChange = vi.fn();
    const onOpenAudioSettings = vi.fn();

    renderTitleBar({
      activeRouteId: 'songs',
      onRouteChange,
      onOpenAudioSettings,
      onMinimize: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Audio Settings' }));

    expect(onOpenAudioSettings).toHaveBeenCalledTimes(1);
    expect(onRouteChange).not.toHaveBeenCalled();
  });

  it('shows an update hint and starts the update when the title-bar icon is clicked', () => {
    const onUpdateAction = vi.fn();

    renderTitleBar({
      activeRouteId: 'songs',
      updateStatus: {
        state: 'available',
        currentVersion: '26.6.6',
        latestVersion: '26.6.7',
        releaseName: null,
        releaseNotes: null,
        downloadPercent: null,
        transferredBytes: null,
        totalBytes: null,
        bytesPerSecond: null,
        error: null,
        checkedAt: '2026-06-07T00:00:00.000Z',
      },
      onRouteChange: vi.fn(),
      onUpdateAction,
      onOpenAudioSettings: vi.fn(),
      onMinimize: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
    });

    const updateButton = screen.getByText('26.6.7').closest('button');
    expect(updateButton).toBeTruthy();
    fireEvent.click(updateButton!);

    expect(onUpdateAction).toHaveBeenCalledTimes(1);
  });

  it('opens the MV drawer from the MV settings button', () => {
    const onRouteChange = vi.fn();
    const onOpenMvSettings = vi.fn();

    renderTitleBar({
      activeRouteId: 'songs',
      onRouteChange,
      onOpenAudioSettings: vi.fn(),
      onOpenMvSettings,
      onMinimize: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'MV Settings' }));

    expect(onOpenMvSettings).toHaveBeenCalledTimes(1);
    expect(onRouteChange).not.toHaveBeenCalled();
  });


  it('wires window control buttons to provided handlers', () => {
    const onMinimize = vi.fn();
    const onToggleMaximize = vi.fn();
    const onToggleFullscreen = vi.fn();
    const onClose = vi.fn();

    renderTitleBar({
      activeRouteId: 'songs',
      onRouteChange: vi.fn(),
      onOpenAudioSettings: vi.fn(),
      onMinimize,
      onToggleMaximize,
      onToggleFullscreen,
      onClose,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an exit fullscreen control while the window is fullscreen', () => {
    const onToggleFullscreen = vi.fn();

    renderTitleBar({
      activeRouteId: 'songs',
      isWindowFullscreen: true,
      onRouteChange: vi.fn(),
      onOpenAudioSettings: vi.fn(),
      onMinimize: vi.fn(),
      onToggleMaximize: vi.fn(),
      onToggleFullscreen,
      onClose: vi.fn(),
    });

    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));

    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it('shows a restore control while the window is maximized', () => {
    const onToggleMaximize = vi.fn();

    renderTitleBar({
      activeRouteId: 'songs',
      isWindowMaximized: true,
      onRouteChange: vi.fn(),
      onOpenAudioSettings: vi.fn(),
      onMinimize: vi.fn(),
      onToggleMaximize,
      onClose: vi.fn(),
    });

    expect(screen.queryByRole('button', { name: 'Maximize' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(onToggleMaximize).toHaveBeenCalledTimes(1);
  });
});
