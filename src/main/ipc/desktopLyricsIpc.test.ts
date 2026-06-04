import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { DesktopLyricsStylePatch } from '../../shared/types/desktopLyrics';

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const handleMock = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers[channel] = handler;
});
const onMock = vi.fn();
const setDesktopLyricsMousePassthroughMock = vi.fn();
const setDesktopLyricsStyleMock = vi.fn((patch: DesktopLyricsStylePatch) => ({
  settings: patch,
  visible: true,
  locked: false,
  bounds: null,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
    on: onMock,
  },
}));

vi.mock('../app/desktopLyricsWindow', () => ({
  getDesktopLyricsState: vi.fn(),
  getLastDesktopLyricsAudioStatus: vi.fn(),
  getLastDesktopLyricsPlaybackStatus: vi.fn(),
  hideDesktopLyricsWindow: vi.fn(),
  receiveDesktopLyricsRendererAudioStatus: vi.fn(),
  receiveDesktopLyricsRendererPlaybackStatus: vi.fn(),
  resetDesktopLyricsBounds: vi.fn(),
  setDesktopLyricsLocked: vi.fn(),
  setDesktopLyricsMousePassthrough: setDesktopLyricsMousePassthroughMock,
  setDesktopLyricsStyle: setDesktopLyricsStyleMock,
  showDesktopLyricsWindow: vi.fn(),
}));

const resetHandlers = (): void => {
  for (const key of Object.keys(handlers)) {
    delete handlers[key];
  }
};

describe('desktop lyrics IPC', () => {
  beforeEach(async () => {
    resetHandlers();
    handleMock.mockClear();
    onMock.mockClear();
    setDesktopLyricsMousePassthroughMock.mockClear();
    setDesktopLyricsStyleMock.mockClear();
    vi.resetModules();
    const module = await import('./desktopLyricsIpc');
    module.registerDesktopLyricsIpc();
  });

  it('keeps romanization and translation toggles in style patches', () => {
    handlers[IpcChannels.DesktopLyricsSetStyle]!(null, {
      desktopLyricsRomanizationEnabled: false,
      desktopLyricsTranslationEnabled: false,
      desktopLyricsColorMode: 'custom',
      ignored: true,
    });

    expect(setDesktopLyricsStyleMock).toHaveBeenCalledWith({
      desktopLyricsRomanizationEnabled: false,
      desktopLyricsTranslationEnabled: false,
      desktopLyricsColorMode: 'custom',
    });
  });

  it('registers the desktop lyrics mouse passthrough channel', () => {
    expect(onMock).toHaveBeenCalledWith(
      IpcChannels.DesktopLyricsSetMousePassthrough,
      setDesktopLyricsMousePassthroughMock,
    );
  });
});
