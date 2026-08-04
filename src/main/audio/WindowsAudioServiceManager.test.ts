import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { restartWindowsAudioService, waitForServiceRunning } from './WindowsAudioServiceManager';

const createChild = (stdoutText = '', exitCode = 0): ChildProcess => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout,
    stderr,
    kill: vi.fn(() => true),
  }) as unknown as ChildProcess;

  queueMicrotask(() => {
    if (stdoutText) {
      stdout.write(stdoutText);
    }
    stdout.end();
    stderr.end();
    child.emit('exit', exitCode, null);
  });

  return child;
};

describe('WindowsAudioServiceManager', () => {
  it('runs the elevated Windows audio restart script and waits for both services', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const spawn = vi.fn((command: string, args: string[]) => {
      calls.push({ command, args });

      if (command === 'powershell.exe') {
        return createChild();
      }

      return createChild('STATE              : 4  RUNNING\n');
    });

    await restartWindowsAudioService({ platform: 'win32', spawn: spawn as never });

    expect(calls[0].command).toBe('powershell.exe');
    expect(calls[0].args.join(' ')).toContain('Start-Process');
    expect(calls[0].args.join(' ')).toContain('net stop /y audiosrv');
    expect(calls[0].args.join(' ')).toContain('net stop /y AudioEndpointBuilder');
    expect(calls[0].args.join(' ')).toContain('net start AudioEndpointBuilder');
    expect(calls[0].args.join(' ')).toContain('net start audiosrv');
    expect(calls.slice(1).map((call) => call.args)).toEqual([
      ['query', 'AudioEndpointBuilder'],
      ['query', 'audiosrv'],
    ]);
  });

  it('rejects Windows audio service restart on non-Windows platforms', async () => {
    await expect(restartWindowsAudioService({ platform: 'linux' })).rejects.toThrow(
      'only available on Windows',
    );
  });

  it('polls sc query until a service is running', async () => {
    const spawn = vi
      .fn()
      .mockImplementationOnce(() => createChild('STATE              : 1  STOPPED\n'))
      .mockImplementationOnce(() => createChild('STATE              : 4  RUNNING\n'));

    await waitForServiceRunning('audiosrv', 1000, {
      spawn: spawn as never,
      delay: async () => undefined,
    });

    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
