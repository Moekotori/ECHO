// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppTitleBar } from './AppTitleBar';
import { I18nProvider } from '../../i18n/I18nProvider';

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
    expect(onRouteChange).not.toHaveBeenCalled();
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
