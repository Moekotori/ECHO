import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AudioStatus } from '../../shared/types/audio';
import { getDaemonClient } from '../audio/DaemonClient';

export const registerAudioIpc = async (): Promise<void> => {
  const daemonClient = getDaemonClient();

  // Start the daemon binary (uses resolveBinary → electron-app/build/echo-audio-daemon)
  try {
    await daemonClient.spawn();
  } catch (err) {
    console.error('[audioIpc] Failed to start daemon:', err);
    // Continue — the UI will show "Daemon is not running" on command attempts
  }

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

  // ── Backward-compat shims for old IPC channels ──
  ipcMain.handle(IpcChannels.AudioGetStatus, async () => {
    try { return await daemonClient.command('getStatus'); }
    catch { return buildStatus(null); }
  });
  ipcMain.handle(IpcChannels.AudioSetOutput, async (_event, params: unknown) => daemonClient.command('setOutput', params));
  ipcMain.handle(IpcChannels.AudioListDevices, async () => {
    try { return await daemonClient.command('device.list'); }
    catch { return { devices: [] }; }
  });
  ipcMain.handle(IpcChannels.AudioResetEngine, async () => daemonClient.command('stop'));
  ipcMain.handle(IpcChannels.AudioForceRestart, async () => {
    await daemonClient.command('stop');
    daemonClient.shutdown();
    return daemonClient.spawn();
  });
  ipcMain.handle(IpcChannels.AudioOpenAsioControlPanel, async () => daemonClient.command('openAsioControlPanel'));

  // Push daemon status periodically to renderer (backward compat)
  let statusInterval: ReturnType<typeof setInterval> | null = null;

  const buildStatus = (raw: unknown) => ({
    state: 'idle', position: 0, duration: 0, volume: 1,
    outputMode: 'shared', deviceName: '', sampleRate: 0,
    sharedDeviceSampleRate: 0, actualDeviceSampleRate: 0,
    dspActive: false, dspClippingRisk: false, dspLimiterProtecting: false,
    eqEnabled: false, eqPresetName: null,
    replayGainAppliedDb: 0, replayGainPreventedClipping: false,
    underrunCallbacks: 0, bitPerfectCandidate: false,
    warnings: [],
    ...(typeof raw === 'object' && raw ? raw : {}),
  });

  // Push default status immediately — renderer renders before daemon is ready
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IpcChannels.AudioStatus, buildStatus(null));
  }

  daemonClient.on('event.ready', () => {
    if (statusInterval) clearInterval(statusInterval);
    const pushStatus = async () => {
      try {
        const raw = await daemonClient.command('getStatus');
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(IpcChannels.AudioStatus, buildStatus(raw));
        }
      } catch { /* daemon not ready yet */ }
    };
    pushStatus();
    statusInterval = setInterval(pushStatus, 1000);
  });
  daemonClient.on('event.shutdown', () => {
    if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
  });
};
