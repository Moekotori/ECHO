import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { DesktopLyricsStylePatch } from '../../shared/types/desktopLyrics';
import {
  getDesktopLyricsState,
  getLastDesktopLyricsAudioStatus,
  getLastDesktopLyricsPlaybackStatus,
  hideDesktopLyricsWindow,
  receiveDesktopLyricsRendererAudioStatus,
  receiveDesktopLyricsRendererPlaybackStatus,
  revealDesktopLyricsMenu,
  resetDesktopLyricsBounds,
  setDesktopLyricsLocked,
  setDesktopLyricsMousePassthrough,
  setDesktopLyricsStyle,
  showDesktopLyricsWindow,
} from '../app/desktopLyricsWindow';

const normalizeStylePatch = (value: unknown): DesktopLyricsStylePatch => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  return {
    ...(input.desktopLyricsFontSizePx !== undefined ? { desktopLyricsFontSizePx: Number(input.desktopLyricsFontSizePx) } : {}),
    ...(input.desktopLyricsSecondaryFontSizePx !== undefined
      ? { desktopLyricsSecondaryFontSizePx: Number(input.desktopLyricsSecondaryFontSizePx) }
      : {}),
    ...(input.desktopLyricsScalePercent !== undefined ? { desktopLyricsScalePercent: Number(input.desktopLyricsScalePercent) } : {}),
    ...(typeof input.desktopLyricsFontFamily === 'string' ? { desktopLyricsFontFamily: input.desktopLyricsFontFamily } : {}),
    ...(typeof input.desktopLyricsFontFilePath === 'string' || input.desktopLyricsFontFilePath === null
      ? { desktopLyricsFontFilePath: input.desktopLyricsFontFilePath }
      : {}),
    ...(input.desktopLyricsColorMode === 'theme' || input.desktopLyricsColorMode === 'custom' || input.desktopLyricsColorMode === 'gradient'
      ? { desktopLyricsColorMode: input.desktopLyricsColorMode }
      : {}),
    ...(typeof input.desktopLyricsColor === 'string' ? { desktopLyricsColor: input.desktopLyricsColor } : {}),
    ...(typeof input.desktopLyricsStrokeColor === 'string' ? { desktopLyricsStrokeColor: input.desktopLyricsStrokeColor } : {}),
    ...(typeof input.desktopLyricsGradientStartColor === 'string'
      ? { desktopLyricsGradientStartColor: input.desktopLyricsGradientStartColor }
      : {}),
    ...(typeof input.desktopLyricsGradientEndColor === 'string'
      ? { desktopLyricsGradientEndColor: input.desktopLyricsGradientEndColor }
      : {}),
    ...(input.desktopLyricsOpacityPercent !== undefined ? { desktopLyricsOpacityPercent: Number(input.desktopLyricsOpacityPercent) } : {}),
    ...(input.desktopLyricsTextDirection === 'horizontal' || input.desktopLyricsTextDirection === 'vertical'
      ? { desktopLyricsTextDirection: input.desktopLyricsTextDirection }
      : {}),
    ...(typeof input.desktopLyricsRomanizationEnabled === 'boolean'
      ? { desktopLyricsRomanizationEnabled: input.desktopLyricsRomanizationEnabled }
      : {}),
    ...(typeof input.desktopLyricsTranslationEnabled === 'boolean'
      ? { desktopLyricsTranslationEnabled: input.desktopLyricsTranslationEnabled }
      : {}),
  };
};

export const registerDesktopLyricsIpc = (): void => {
  ipcMain.handle(IpcChannels.DesktopLyricsShow, () => showDesktopLyricsWindow());
  ipcMain.handle(IpcChannels.DesktopLyricsHide, () => hideDesktopLyricsWindow());
  ipcMain.handle(IpcChannels.DesktopLyricsGetState, () => getDesktopLyricsState());
  ipcMain.handle(IpcChannels.DesktopLyricsSetLocked, (_event, locked: unknown) => setDesktopLyricsLocked(locked === true));
  ipcMain.handle(IpcChannels.DesktopLyricsSetStyle, (_event, patch: unknown) => setDesktopLyricsStyle(normalizeStylePatch(patch)));
  ipcMain.handle(IpcChannels.DesktopLyricsResetBounds, () => resetDesktopLyricsBounds());
  ipcMain.handle(IpcChannels.DesktopLyricsRevealMenu, () => revealDesktopLyricsMenu());
  ipcMain.handle(IpcChannels.DesktopLyricsGetLastAudioStatus, () => getLastDesktopLyricsAudioStatus());
  ipcMain.handle(IpcChannels.DesktopLyricsGetLastPlaybackStatus, () => getLastDesktopLyricsPlaybackStatus());
  ipcMain.on(IpcChannels.DesktopLyricsRendererAudioStatus, receiveDesktopLyricsRendererAudioStatus);
  ipcMain.on(IpcChannels.DesktopLyricsRendererPlaybackStatus, receiveDesktopLyricsRendererPlaybackStatus);
  ipcMain.on(IpcChannels.DesktopLyricsSetMousePassthrough, setDesktopLyricsMousePassthrough);
};
