import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AudioStatus } from '../../shared/types/audio';
import { getAudioSession } from '../audio/AudioSession';
import { getDaemonClient } from '../audio/DaemonClient';

/**
 * Registers IPC handlers for audio daemon communication.
 *
 * AudioSession events (from the existing session layer) are forwarded to
 * renderers on their original channels for backward compatibility.
 * Daemon events are forwarded on the unified 'daemon:event' channel.
 * All command invocations go through the single 'daemon:command' handler,
 * which the daemon client routes via JSON-RPC 2.0.
 */
export const registerAudioIpc = (): void => {
  const session = getAudioSession();
  const daemonClient = getDaemonClient();

  // --- AudioSession event forwarding (backward compat) ---

  session.on('status', (status: AudioStatus) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.AudioStatus, status);
    }
  });

  session.on('session-reset', (event: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.AudioSessionReset, event);
    }
  });

  session.on('automix-advance', (event: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.PlaybackAutomixAdvance, event);
    }
  });

  // --- Daemon event forwarding ---

  daemonClient.on('daemon:event', (event: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.DaemonEvent, event);
    }
  });

  // --- Single daemon command handler ---

  ipcMain.handle(IpcChannels.DaemonCommand, async (_event, { method, params }: { method: string; params?: unknown }) => {
    return daemonClient.command(method, params);
  });
};
