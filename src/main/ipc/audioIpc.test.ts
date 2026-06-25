import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('audio IPC daemon command handler', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const daemonListeners = new Map<string, (...args: unknown[]) => void>();
  const commandMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

  beforeEach(() => {
    vi.resetModules();
    handlers.clear();
    daemonListeners.clear();
    commandMock.mockReset();

    const daemonEventEmitter = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        daemonListeners.set(event, listener);
      }),
      command: commandMock,
    };

    vi.doMock('electron', () => ({
      BrowserWindow: {
        getAllWindows: vi.fn(() => []),
      },
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        }),
      },
    }));

    vi.doMock('../audio/DaemonClient', () => ({
      getDaemonClient: () => daemonEventEmitter,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a daemon:command IPC handler', async () => {
    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    expect(handlers.has('daemon:command')).toBe(true);
  });

  it('routes commands through daemonClient.command()', async () => {
    commandMock.mockResolvedValue('pong');

    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    const handler = handlers.get('daemon:command')!;
    const result = await handler({}, { method: 'ping', params: { value: 42 } });

    expect(commandMock).toHaveBeenCalledWith('ping', { value: 42 });
    expect(result).toBe('pong');
  });

  it('subscribes to daemon events for status forwarding', async () => {
    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    expect(daemonListeners.has('event.status')).toBe(true);
    expect(daemonListeners.has('event.sessionReset')).toBe(true);
    expect(daemonListeners.has('event.automixAdvance')).toBe(true);
  });

  it('listens for unified daemon events', async () => {
    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    expect(daemonListeners.has('daemon:event')).toBe(true);
  });

  it('propagates daemon:command errors', async () => {
    commandMock.mockRejectedValue(new Error('daemon_error'));

    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    const handler = handlers.get('daemon:command')!;
    await expect(handler({}, { method: 'fail' })).rejects.toThrow('daemon_error');
  });
});

describe('audio IPC daemon event forwarding', () => {
  const daemonListeners = new Map<string, (...args: unknown[]) => void>();
  const sendMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    daemonListeners.clear();
    sendMock.mockReset();

    vi.doMock('electron', () => ({
      BrowserWindow: {
        getAllWindows: vi.fn(() => [
          { webContents: { send: sendMock } },
        ]),
      },
      ipcMain: {
        handle: vi.fn(),
      },
    }));

    vi.doMock('../audio/DaemonClient', () => ({
      getDaemonClient: () => ({
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          daemonListeners.set(event, listener);
        }),
        command: vi.fn(),
      }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards daemon event.status via IpcChannels.AudioStatus', async () => {
    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    const statusHandler = daemonListeners.get('event.status')!;
    statusHandler({ host: 'ready', state: 'playing' });

    expect(sendMock).toHaveBeenCalledWith('audio:status', { host: 'ready', state: 'playing' });
  });

  it('forwards daemon event.sessionReset via IpcChannels.AudioSessionReset', async () => {
    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    const resetHandler = daemonListeners.get('event.sessionReset')!;
    resetHandler({ reason: 'restart' });

    expect(sendMock).toHaveBeenCalledWith('audio:session-reset', { reason: 'restart' });
  });
});
