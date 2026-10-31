import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';
import type { AudioStatus } from '../../shared/types/audio';

export function createDesktopLyricsApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['desktopLyrics'] {
  let lastHandledRevealRequestId = 0;
  let pendingRevealMenuToggle = false;
  const revealMenuHandlers = new Set<() => void>();
  ipcRenderer.on(IpcChannels.DesktopLyricsRevealMenu, (_event, requestId: unknown) => {
    const normalizedRequestId =
      typeof requestId === 'number' && Number.isSafeInteger(requestId) && requestId > 0
        ? requestId
        : null;
    if (normalizedRequestId !== null) {
      if (normalizedRequestId <= lastHandledRevealRequestId) {
        return;
      }
      lastHandledRevealRequestId = normalizedRequestId;
    }

    if (revealMenuHandlers.size === 0) {
      pendingRevealMenuToggle = !pendingRevealMenuToggle;
      return;
    }

    for (const handler of revealMenuHandlers) {
      handler();
    }
  });

  return {
    show: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsShow),
    hide: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsHide),
    getState: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsGetState),
    setLocked: (locked) => ipcRenderer.invoke(IpcChannels.DesktopLyricsSetLocked, locked),
    setStyle: (patch) => ipcRenderer.invoke(IpcChannels.DesktopLyricsSetStyle, patch),
    resetBounds: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsResetBounds),
    revealMenu: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsRevealMenu),
    setMousePassthrough: (passthrough) => {
      ipcRenderer.send(IpcChannels.DesktopLyricsSetMousePassthrough, passthrough);
    },
    publishAudioStatus: (status) => {
      ipcRenderer.send(IpcChannels.DesktopLyricsRendererAudioStatus, status);
    },
    publishPlaybackStatus: (status) => {
      ipcRenderer.send(IpcChannels.DesktopLyricsRendererPlaybackStatus, status);
    },
    getLastAudioStatus: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsGetLastAudioStatus),
    getLastPlaybackStatus: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsGetLastPlaybackStatus),
    onStateChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown): void => {
        handler(state as Awaited<ReturnType<EchoApi['desktopLyrics']['getState']>>);
      };
      ipcRenderer.on(IpcChannels.DesktopLyricsStateChanged, listener);
      return () => ipcRenderer.off(IpcChannels.DesktopLyricsStateChanged, listener);
    },
    onRevealMenu: (handler) => {
      revealMenuHandlers.add(handler);
      if (pendingRevealMenuToggle) {
        pendingRevealMenuToggle = false;
        handler();
      }
      return () => {
        revealMenuHandlers.delete(handler);
      };
    },
    onAudioStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as AudioStatus);
      };
      ipcRenderer.on(IpcChannels.DesktopLyricsAudioStatus, listener);
      return () => ipcRenderer.off(IpcChannels.DesktopLyricsAudioStatus, listener);
    },
    onPlaybackStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as NonNullable<Awaited<ReturnType<EchoApi['desktopLyrics']['getLastPlaybackStatus']>>>);
      };
      ipcRenderer.on(IpcChannels.DesktopLyricsPlaybackStatus, listener);
      return () => ipcRenderer.off(IpcChannels.DesktopLyricsPlaybackStatus, listener);
    },
  };
}
