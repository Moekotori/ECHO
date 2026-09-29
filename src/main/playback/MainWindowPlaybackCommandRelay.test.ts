import { afterEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import {
  MainWindowPlaybackCommandRelay,
  isValidMainWindowControlRequest,
} from './MainWindowPlaybackCommandRelay';

afterEach(() => {
  vi.useRealTimers();
});

describe('MainWindowPlaybackCommandRelay', () => {
  it('relays a validated control request and resolves only from the main window', async () => {
    const webContents = { send: vi.fn() };
    const relay = new MainWindowPlaybackCommandRelay({
      getWindow: () => ({ isDestroyed: () => false, webContents: webContents as never }),
      now: () => 42,
    });

    const pending = relay.executeControl({ type: 'play' });
    expect(webContents.send).toHaveBeenCalledWith(
      IpcChannels.PlaybackMainWindowCommandRequest,
      expect.objectContaining({ command: 'control', args: [{ type: 'play' }] }),
    );
    const request = webContents.send.mock.calls[0][1] as { id: string };

    relay.receiveResult({ send: vi.fn() } as never, { id: request.id, ok: true });
    relay.receiveResult(webContents as never, { id: request.id, ok: true, value: 'done' });
    await expect(pending).resolves.toBe('done');
    relay.dispose();
  });

  it('rejects timed out commands and validates the explicit semantic controls', async () => {
    vi.useFakeTimers();
    const relay = new MainWindowPlaybackCommandRelay({
      getWindow: () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } as never }),
      timeoutMs: 25,
    });
    const pending = relay.executeControl({ type: 'pause' });
    const rejection = expect(pending).rejects.toThrow('main_window_playback_command_timeout');
    await vi.advanceTimersByTimeAsync(25);
    await rejection;

    expect(isValidMainWindowControlRequest({ type: 'stop' })).toBe(true);
    expect(isValidMainWindowControlRequest({ type: 'seek', positionSeconds: -1 })).toBe(false);
    expect(isValidMainWindowControlRequest({ type: 'setVolume', volume: 1.2 })).toBe(false);
    expect(isValidMainWindowControlRequest({ type: 'setPlaybackOrder', mode: 'shuffle' })).toBe(true);
    expect(isValidMainWindowControlRequest({ type: 'setPlaybackOrder', mode: 'unsupported' })).toBe(false);
    relay.dispose();
  });
});
