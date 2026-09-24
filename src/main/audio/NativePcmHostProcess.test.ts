import { afterEach, describe, expect, it } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativePcmHostProcess, resolveHostBinary } from './NativePcmHostProcess';
import type { NativeOutputStartOptions } from './audioTypes';

interface TestablePcmHostProcess {
  createSpawnArgs(options: NativeOutputStartOptions): string[];
  proc: ChildProcessWithoutNullStreams | null;
}

function exposeHost(host: NativePcmHostProcess): TestablePcmHostProcess {
  return host as unknown as TestablePcmHostProcess;
}

const minimalOptions: NativeOutputStartOptions = {
  requestedOutputSampleRate: 44100,
  channels: 2,
};

function makeHost(): NativePcmHostProcess {
  return new NativePcmHostProcess({
    hostBinary: '/fake/echo-audio-host',
    platform: 'linux',
  });
}

describe('NativePcmHostProcess.createSpawnArgs', () => {
  afterEach(() => {
    // no persistent state to clean
  });

  it('createSpawnArgs includes -sr and -ch at position 0-3 (always)', () => {
    const host = makeHost();
    const args = exposeHost(host).createSpawnArgs(minimalOptions);

    expect(args[0]).toBe('-sr');
    expect(args[1]).toBe('44100');
    expect(args[2]).toBe('-ch');
    expect(args[3]).toBe('2');
  });

  it('createSpawnArgs includes -buffer when bufferSizeFrames > 0', () => {
    const host = makeHost();
    const options: NativeOutputStartOptions = {
      ...minimalOptions,
      bufferSizeFrames: 512,
    };
    const args = exposeHost(host).createSpawnArgs(options);

    const bufferIdx = args.indexOf('-buffer');
    expect(bufferIdx).toBeGreaterThan(-1);
    expect(args[bufferIdx + 1]).toBe('512');
  });

  it('createSpawnArgs includes -fifo-ms when shared mode and fifoCapacityMs > 0', () => {
    const host = makeHost();
    const options: NativeOutputStartOptions = {
      ...minimalOptions,
      fifoCapacityMs: 100,
    };
    const args = exposeHost(host).createSpawnArgs(options);

    const fifoIdx = args.indexOf('-fifo-ms');
    expect(fifoIdx).toBeGreaterThan(-1);
    expect(args[fifoIdx + 1]).toBe('100');
  });

  it('createSpawnArgs includes -prebuffer-ms when startupPrebufferMs >= 0', () => {
    const host = makeHost();
    const options: NativeOutputStartOptions = {
      ...minimalOptions,
      startupPrebufferMs: 50,
    };
    const args = exposeHost(host).createSpawnArgs(options);

    const idx = args.indexOf('-prebuffer-ms');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('50');
  });

  it('createSpawnArgs includes --no-stdin when isDaemonRunning() returns true', () => {
    const host = makeHost();
    const mockProc = { killed: false, exitCode: null } as unknown as ChildProcessWithoutNullStreams;
    exposeHost(host).proc = mockProc;

    const args = exposeHost(host).createSpawnArgs({ ...minimalOptions });

    expect(args).toContain('--no-stdin');
  });

  it('createSpawnArgs separates fd3/fd4 RPC from fd5 PCM input', () => {
    const host = makeHost();
    const args = exposeHost(host).createSpawnArgs({ ...minimalOptions });

    const len = args.length;
    expect(args.slice(len - 7)).toEqual([
      '--rpc-stdin-fd', '3',
      '--rpc-stdout-fd', '4',
      '--pcm-input-fd', '5',
      '--no-stdin',
    ]);
    expect(args).not.toContain('--defer-device-open');
  });

  it('createSpawnArgs does NOT include exclusive flag when exclusive is false', () => {
    const host = makeHost();
    const options: NativeOutputStartOptions = {
      ...minimalOptions,
      exclusive: false,
    };
    const args = exposeHost(host).createSpawnArgs(options);

    expect(args).not.toContain('-exclusive');
  });

  it('passes miniaudio only when the experimental output is explicitly requested', () => {
    const host = makeHost();
    const defaultArgs = exposeHost(host).createSpawnArgs({
      ...minimalOptions,
      useMiniaudioOutput: false,
    });
    const experimentalArgs = exposeHost(host).createSpawnArgs({
      ...minimalOptions,
      useMiniaudioOutput: true,
    });

    expect(defaultArgs).not.toContain('miniaudio');
    expect(experimentalArgs).toContain('-shared-backend');
    expect(experimentalArgs).toContain('miniaudio');
  });

  it('uses the native host ASIO DSD switch for raw DSD input', () => {
    const host = makeHost();
    const args = exposeHost(host).createSpawnArgs({
      requestedOutputSampleRate: 5_644_800,
      channels: 2,
      asio: true,
      inputFormat: 'dsd-native-raw',
      nativeDsdSampleRate: 5_644_800,
    });

    expect(args).toContain('-dop-output');
    expect(args).toContain('-asio-native-dsd-output');
    expect(args).not.toContain('-native-dsd-sr');
  });
});

describe('resolveHostBinary Windows runtime closure', () => {
  it('accepts the packaged host only when all four required libav DLLs are present', () => {
    if (process.platform !== 'win32') {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), 'echo-host-runtime-'));
    const resources = join(root, 'resources');
    const hostPath = join(resources, 'echo-audio-host.exe');
    const requiredDlls = ['avcodec-62.dll', 'avformat-62.dll', 'avutil-60.dll', 'swresample-6.dll'];
    try {
      mkdirSync(resources, { recursive: true });
      writeFileSync(hostPath, Buffer.from('MZ-host'));
      for (const name of requiredDlls) {
        writeFileSync(join(resources, name), Buffer.from(`MZ-${name}`));
      }

      expect(resolveHostBinary({
        appPath: null,
        cwd: join(root, 'empty'),
        resourcesPath: resources,
        userDataPath: null,
        includeMigrationFallback: false,
      })).toBe(hostPath);

      rmSync(join(resources, 'avcodec-62.dll'));
      expect(resolveHostBinary({
        appPath: null,
        cwd: join(root, 'empty'),
        resourcesPath: resources,
        userDataPath: null,
        includeMigrationFallback: false,
      })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
