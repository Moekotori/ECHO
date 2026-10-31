import { afterEach, describe, expect, it, vi } from 'vitest';
import { installIpcPerformanceDiagnostics } from './IpcPerformanceDiagnostics';
import { getPlaybackPerformanceSnapshot } from './PlaybackPerformanceDiagnostics';

describe('IpcPerformanceDiagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves synchronous IPC handler return values while recording slow handlers', () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };

    installIpcPerformanceDiagnostics(ipcMain);
    ipcMain.handle('library:get-tracks', () => {
      now = 1_420;
      return 'tracks';
    });

    const result = handlers.get('library:get-tracks')?.({});

    expect(result).toBe('tracks');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[ipc-perf] library:get-tracks 420ms SLOW'));
  });

  it('records failed async IPC handlers without swallowing the original error', async () => {
    let now = 2_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };

    installIpcPerformanceDiagnostics(ipcMain);
    ipcMain.handle('library:scan-folder', async () => {
      now = 2_500;
      throw new Error('scan failed');
    });

    await expect(handlers.get('library:scan-folder')?.({})).rejects.toThrow('scan failed');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[ipc-perf] library:scan-folder 500ms SLOW failed=true'));
  });

  it('exposes an async IPC handler as active until its promise settles', async () => {
    let now = 3_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };
    let resolveHandler!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      resolveHandler = resolve;
    });

    installIpcPerformanceDiagnostics(ipcMain);
    ipcMain.handle('library:get-playback-stats-dashboard', () => pending);
    const result = handlers.get('library:get-playback-stats-dashboard')?.({});
    now = 4_250;

    expect(getPlaybackPerformanceSnapshot()).toMatchObject({
      activeIpcChannel: 'library:get-playback-stats-dashboard',
      activeIpcElapsedMs: 1250,
      activeIpcCount: 1,
    });

    resolveHandler('stats');
    await expect(result).resolves.toBe('stats');
    expect(getPlaybackPerformanceSnapshot()).toMatchObject({
      activeIpcChannel: null,
      activeIpcCount: 0,
    });
  });
});
