import { afterEach, describe, expect, it } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { NativePcmHostProcess } from './NativePcmHostProcess';
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

  it('createSpawnArgs includes --rpc-stdin-fd 3 and --rpc-stdout-fd 4 at end', () => {
    const host = makeHost();
    const args = exposeHost(host).createSpawnArgs({ ...minimalOptions });

    const len = args.length;
    expect(args[len - 4]).toBe('--rpc-stdin-fd');
    expect(args[len - 3]).toBe('3');
    expect(args[len - 2]).toBe('--rpc-stdout-fd');
    expect(args[len - 1]).toBe('4');
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
});
