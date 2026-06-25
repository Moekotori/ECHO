import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('audio IPC daemon command handler', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const sessionHandlers = new Map<string, (...args: unknown[]) => void>();
  const daemonListeners = new Map<string, (...args: unknown[]) => void>();
  const commandMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

  beforeEach(() => {
    vi.resetModules();
    handlers.clear();
    sessionHandlers.clear();
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

    vi.doMock('../audio/AudioSession', () => ({
      getAudioSession: () => ({
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          sessionHandlers.set(event, handler);
        }),
        getStatus: vi.fn(() => ({ host: 'ready', state: 'idle' })),
      }),
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

  it('subscribes to AudioSession events', async () => {
    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    expect(sessionHandlers.has('status')).toBe(true);
    expect(sessionHandlers.has('session-reset')).toBe(true);
    expect(sessionHandlers.has('automix-advance')).toBe(true);
  });

  it('listens for daemon events', async () => {
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

describe('audio IPC session event forwarding', () => {
  const sessionHandlers = new Map<string, (...args: unknown[]) => void>();
  const sendMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    sessionHandlers.clear();
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

    vi.doMock('../audio/AudioSession', () => ({
      getAudioSession: () => ({
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          sessionHandlers.set(event, handler);
        }),
        getStatus: vi.fn(() => ({ host: 'ready', state: 'idle' })),
      }),
    }));

    vi.doMock('../audio/DaemonClient', () => ({
      getDaemonClient: () => ({
        on: vi.fn(),
        command: vi.fn(),
      }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards AudioSession status events via IpcChannels.AudioStatus', async () => {
    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    const statusHandler = sessionHandlers.get('status')!;
    statusHandler({ host: 'ready', state: 'playing' });

    expect(sendMock).toHaveBeenCalledWith('audio:status', { host: 'ready', state: 'playing' });
  });

  it('forwards AudioSession session-reset events via IpcChannels.AudioSessionReset', async () => {
    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    const resetHandler = sessionHandlers.get('session-reset')!;
    resetHandler({ reason: 'restart' });

    expect(sendMock).toHaveBeenCalledWith('audio:session-reset', { reason: 'restart' });
  });
});
