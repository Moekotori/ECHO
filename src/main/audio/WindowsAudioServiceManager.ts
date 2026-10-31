import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptionsWithoutStdio } from 'node:child_process';

type SpawnLike = typeof spawn;

export type WindowsAudioServiceManagerDependencies = {
  spawn?: SpawnLike;
  platform?: NodeJS.Platform | string;
  delay?: (ms: number) => Promise<void>;
  logger?: (message: string) => void;
};

const servicePollIntervalMs = 500;
const defaultServiceTimeoutMs = 10_000;

const quotePowerShellString = (value: string): string => `'${value.replace(/'/gu, "''")}'`;

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

const spawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
  spawnImpl: SpawnLike,
): ChildProcess => spawnImpl(command, args, options);

export const waitForExit = async (proc: ChildProcess, label = 'process'): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };

    proc.once('error', (error) => {
      settle(() => reject(error));
    });
    proc.once('exit', (code, signal) => {
      settle(() => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`${label} exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}`));
      });
    });
  });

const collectProcessOutput = async (
  proc: ChildProcess,
  label: string,
): Promise<{ stdout: string; stderr: string }> => {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  proc.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  proc.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
  await waitForExit(proc, label);

  return {
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  };
};

const serviceIsRunning = async (
  name: string,
  spawnImpl: SpawnLike,
): Promise<boolean> => {
  const proc = spawnProcess('sc.exe', ['query', name], { windowsHide: true }, spawnImpl);

  try {
    const { stdout } = await collectProcessOutput(proc, `sc query ${name}`);
    return /STATE\s*:\s*\d+\s+RUNNING/iu.test(stdout);
  } catch {
    return false;
  }
};

export const waitForServiceRunning = async (
  name: string,
  timeoutMs: number,
  dependencies: WindowsAudioServiceManagerDependencies = {},
): Promise<void> => {
  const spawnImpl = dependencies.spawn ?? spawn;
  const delay = dependencies.delay ?? defaultDelay;
  const deadline = Date.now() + Math.max(1, timeoutMs);

  while (Date.now() <= deadline) {
    if (await serviceIsRunning(name, spawnImpl)) {
      return;
    }

    await delay(servicePollIntervalMs);
  }

  throw new Error(`Windows audio service did not reach RUNNING: ${name}`);
};

export const restartWindowsAudioService = async (
  dependencies: WindowsAudioServiceManagerDependencies = {},
): Promise<void> => {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new Error('Windows audio service restart is only available on Windows');
  }

  const spawnImpl = dependencies.spawn ?? spawn;
  const script = [
    'net stop /y audiosrv',
    'net stop /y AudioEndpointBuilder',
    'net start AudioEndpointBuilder',
    'net start audiosrv',
  ].join(' & ');
  const cmdArgument = `/d /s /c "${script}"`;
  const elevatedCommand = [
    'Start-Process',
    '-FilePath',
    'cmd.exe',
    '-Verb',
    'RunAs',
    '-WindowStyle',
    'Hidden',
    '-Wait',
    '-ArgumentList',
    quotePowerShellString(cmdArgument),
  ].join(' ');

  dependencies.logger?.('[WindowsAudioServiceManager] requesting elevated Windows audio service restart');
  const proc = spawnProcess(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', elevatedCommand],
    { windowsHide: true },
    spawnImpl,
  );

  await waitForExit(proc, 'Windows audio service restart');
  await waitForServiceRunning('AudioEndpointBuilder', defaultServiceTimeoutMs, dependencies);
  await waitForServiceRunning('audiosrv', defaultServiceTimeoutMs, dependencies);
};
