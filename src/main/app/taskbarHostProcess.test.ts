import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exists: true,
  children: [] as Array<ReturnType<typeof createMockChild>>,
  recordMainRuntimeIssue: vi.fn(),
  spawn: vi.fn(),
}));

const createMockChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { writable: boolean; write: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = { writable: true, write: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
};

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => mocks.exists),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: mocks.spawn,
  };
});

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => 'D:\\ECHODevelopers\\ECHODev'),
  },
}));

vi.mock('../diagnostics/DevConsoleService', () => ({
  recordMainRuntimeIssue: mocks.recordMainRuntimeIssue,
}));

const loadModule = async () => {
  vi.resetModules();
  return import('./taskbarHostProcess');
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.exists = true;
  mocks.children.splice(0);
  mocks.recordMainRuntimeIssue.mockReset();
  mocks.spawn.mockReset();
  mocks.spawn.mockImplementation(() => {
    const child = createMockChild();
    mocks.children.push(child);
    return child;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('taskbarHostProcess', () => {
  it('reports ready only after the native handshake and flushes a pending show request', async () => {
    const host = await loadModule();
    const stateChanged = vi.fn();
    host.setTaskbarHostStateChangedCallback(stateChanged);

    host.showTaskbarHost();
    expect(host.startTaskbarHost()).toBe(true);
    expect(host.getTaskbarHostDiagnostics().state).toBe('starting');

    mocks.children[0].stdout.emit('data', Buffer.from('{"type":"ready"}\n'));

    expect(host.isTaskbarHostReady()).toBe(true);
    expect(host.getTaskbarHostDiagnostics()).toMatchObject({
      state: 'ready',
      hostPathAvailable: true,
      lastError: null,
    });
    expect(mocks.children[0].stdin.write).toHaveBeenCalledWith('{"type":"show"}\n');
    expect(stateChanged).toHaveBeenCalled();
  });

  it('restarts an unexpectedly exited visible host with bounded backoff', async () => {
    const host = await loadModule();
    host.showTaskbarHost();
    expect(host.startTaskbarHost()).toBe(true);

    mocks.children[0].emit('exit', 1, null);
    expect(host.getTaskbarHostDiagnostics()).toMatchObject({
      state: 'restarting',
      restartAttempts: 1,
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(host.getTaskbarHostDiagnostics().state).toBe('starting');
  });

  it('does not restart after an intentional stop', async () => {
    const host = await loadModule();
    host.showTaskbarHost();
    expect(host.startTaskbarHost()).toBe(true);
    mocks.children[0].stdout.emit('data', Buffer.from('{"type":"ready"}\n'));

    host.stopTaskbarHost();
    mocks.children[0].emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(host.getTaskbarHostDiagnostics()).toMatchObject({
      state: 'stopped',
      restartAttempts: 0,
      lastError: null,
    });
  });

  it('stops retrying after three unexpected exits within one minute', async () => {
    const host = await loadModule();
    host.showTaskbarHost();
    expect(host.startTaskbarHost()).toBe(true);

    mocks.children[0].emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(500);
    mocks.children[1].emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(1_500);
    mocks.children[2].emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(4_000);
    mocks.children[3].emit('exit', 1, null);

    expect(mocks.spawn).toHaveBeenCalledTimes(4);
    expect(host.getTaskbarHostDiagnostics()).toMatchObject({
      state: 'error',
      restartAttempts: 3,
    });
    expect(host.getTaskbarHostDiagnostics().lastError).toContain('automatic restart limit reached');
    expect(mocks.recordMainRuntimeIssue).toHaveBeenCalledWith(
      'taskbar-host-restart-limit',
      expect.stringContaining('automatic restart limit reached'),
      expect.objectContaining({ reason: expect.stringContaining('3 attempts') }),
    );
  });

  it('reports a missing native executable instead of generic Windows support', async () => {
    mocks.exists = false;
    const host = await loadModule();

    host.showTaskbarHost();
    expect(host.startTaskbarHost()).toBe(false);
    expect(host.getTaskbarHostDiagnostics()).toMatchObject({
      state: 'missing',
      hostPathAvailable: false,
      lastError: 'echo-taskbar-host.exe not found',
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
