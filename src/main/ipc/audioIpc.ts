import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AudioStatus } from '../../shared/types/audio';
import { getDaemonClient } from '../audio/DaemonClient';

export const registerAudioIpc = (): void => {
  const daemonClient = getDaemonClient();

  // Forward daemon status events to renderers (backward compat)
  daemonClient.on('event.status', (status: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.AudioStatus, status as AudioStatus);
    }
  });

  // Forward daemon session-reset events
  daemonClient.on('event.sessionReset', (event: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.AudioSessionReset, event);
    }
  });

  // Forward daemon automix-advance events
  daemonClient.on('event.automixAdvance', (event: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.PlaybackAutomixAdvance, event);
    }
  });

  // Forward other daemon events on unified channel
  daemonClient.on('daemon:event', (event: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.DaemonEvent, event);
    }
  });

  // Single daemon command handler
  ipcMain.handle(IpcChannels.DaemonCommand, async (_event, { method, params }: { method: string; params?: unknown }) => {
    return daemonClient.command(method, params);
  });
};
