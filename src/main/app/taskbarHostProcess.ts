/**
 * Manages the echo-taskbar-host.exe native process.
 *
 * This is a pure Win32 + Direct2D executable. By default it creates
 * its window in the system-tools band, which keeps the mini player stable
 * across Start menu, Win+D, and taskbar z-order changes.
 *
 * IPC protocol: JSON over stdio.
 *   We send: {"type":"state","title":"...","artist":"...","playing":true,"position":12.5,"duration":180.0}
 *            {"type":"show"} / {"type":"hide"} / {"type":"quit"}
 *   We recv: {"type":"ready"}
 *            {"type":"click","action":"playPause"|"next"|"prev"}
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { app } from 'electron';
import { recordMainRuntimeIssue } from '../diagnostics/DevConsoleService';

let taskbarHostProcess: ChildProcess | null = null;
let isReady = false;
let pendingState: string | null = null;
let pendingShow = false;

const resolveHostPath = (): string | null => {
  const exeName = 'echo-taskbar-host.exe';
  const candidates: string[] = [];

  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, exeName));
  }

  const appPath = app.getAppPath();
  candidates.push(join(appPath, '..', '..', 'electron-app', 'build', exeName));
  candidates.push(join(appPath, 'electron-app', 'build', exeName));
  candidates.push(join(process.cwd(), 'electron-app', 'build', exeName));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

type ClickCallback = (action: 'playPause' | 'next' | 'prev') => void;
let clickCallback: ClickCallback | null = null;

type DoubleClickCallback = () => void;
let doubleClickCallback: DoubleClickCallback | null = null;

type ReadyCallback = () => void;
let readyCallback: ReadyCallback | null = null;

export const setTaskbarHostClickCallback = (cb: ClickCallback): void => {
  clickCallback = cb;
};

export const setTaskbarHostDoubleClickCallback = (cb: DoubleClickCallback): void => {
  doubleClickCallback = cb;
};

export const setTaskbarHostReadyCallback = (cb: ReadyCallback): void => {
  readyCallback = cb;
};

export const startTaskbarHost = (): boolean => {
  if (taskbarHostProcess) {
    return true;
  }

  if (process.platform !== 'win32') {
    return false;
  }

  const hostPath = resolveHostPath();
  if (!hostPath) {
    console.log('[taskbar-host] echo-taskbar-host.exe not found');
    return false;
  }

  try {
    const hostEnv = {
      ...process.env,
      ECHO_TASKBAR_WINDOW_BAND: process.env.ECHO_TASKBAR_WINDOW_BAND ?? 'system-tools',
    };

    taskbarHostProcess = spawn(hostPath, [], {
      env: hostEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: false,
    });

    let stdoutBuffer = '';
    taskbarHostProcess.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString('utf8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'ready') {
            isReady = true;
            console.log('[taskbar-host] ready');
            if (pendingState) {
              sendToHost(pendingState);
              pendingState = null;
            }
            if (pendingShow) {
              sendToHost('{"type":"show"}');
            }
            if (readyCallback) {
              try { readyCallback(); } catch { /* best-effort */ }
            }
          } else if (msg.type === 'click' && clickCallback) {
            clickCallback(msg.action);
          } else if (msg.type === 'doubleClick' && doubleClickCallback) {
            doubleClickCallback();
          }
        } catch {
          // Non-JSON output; ignore.
        }
      }
    });

    taskbarHostProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf8').trim();
      if (text) {
        console.log(`[taskbar-host] stderr: ${text}`);
      }
    });

    taskbarHostProcess.on('exit', (code, signal) => {
      console.log(`[taskbar-host] exited (code=${code}, signal=${signal})`);
      taskbarHostProcess = null;
      isReady = false;
      pendingShow = false;
    });

    taskbarHostProcess.on('error', (err) => {
      console.log(`[taskbar-host] process error: ${err.message}`);
      recordMainRuntimeIssue('taskbar-host-process-error', err.message, {});
      taskbarHostProcess = null;
      isReady = false;
      pendingShow = false;
    });

    return true;
  } catch (e) {
    console.log(`[taskbar-host] Failed to start: ${e}`);
    return false;
  }
};

const sendToHost = (json: string): void => {
  if (!taskbarHostProcess?.stdin?.writable) {
    return;
  }
  taskbarHostProcess.stdin.write(`${json}\n`);
};

export const updateTaskbarHostState = (state: {
  title: string;
  artist: string;
  playing: boolean;
  position: number;
  duration: number;
  coverPath?: string;
  lyrics?: string;
}): void => {
  const json = JSON.stringify({ type: 'state', ...state });
  if (isReady) {
    sendToHost(json);
  } else {
    pendingState = json;
  }
};

export const showTaskbarHost = (): void => {
  pendingShow = true;
  if (isReady) {
    sendToHost('{"type":"show"}');
  }
};

export const hideTaskbarHost = (): void => {
  pendingShow = false;
  if (isReady) {
    sendToHost('{"type":"hide"}');
  }
};

export const stopTaskbarHost = (): void => {
  if (taskbarHostProcess) {
    try {
      sendToHost('{"type":"quit"}');
      setTimeout(() => {
        if (taskbarHostProcess) {
          taskbarHostProcess.kill();
          taskbarHostProcess = null;
        }
      }, 1000);
    } catch {
      if (taskbarHostProcess) {
        taskbarHostProcess.kill();
        taskbarHostProcess = null;
      }
    }
  }

  isReady = false;
  pendingShow = false;
};

export const isTaskbarHostReady = (): boolean => isReady;