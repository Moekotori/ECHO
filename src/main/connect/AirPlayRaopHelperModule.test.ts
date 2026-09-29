import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  getAppPath: vi.fn(() => process.cwd()),
  isPackaged: false,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    spawn: mocks.spawn,
  };
});

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged;
    },
    getAppPath: mocks.getAppPath,
  },
}));

import { AirPlayRaopHelperModule } from './AirPlayReceiverSpikeService';

class FakeHelperProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  kill = vi.fn(() => {
    this.killed = true;
    this.emit('exit', null, 'SIGTERM');
    return true;
  });
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const receiverOptions = {
  name: 'ECHO Next',
  model: 'ECHO-Next-AirPlay-Spike',
  metadata: true,
  latencies: '1000:1000',
  portBase: 49000,
  portRange: 10,
};

describe('AirPlayRaopHelperModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPackaged = false;
    mocks.getAppPath.mockReturnValue(process.cwd());
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: 'D:\\ECHO Next\\resources',
    });
  });

  it('rejects pending helper requests when stdin breaks', async () => {
    const child = new FakeHelperProcess();
    const logs: unknown[] = [];
    mocks.spawn.mockReturnValueOnce(child);
    const module = new AirPlayRaopHelperModule();
    module.setLogHandler((event) => logs.push(event));

    const start = module.startReceiver(receiverOptions, vi.fn());
    child.stdout.write('{"type":"ready"}\n');
    await tick();

    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));

    await expect(start).rejects.toThrow('write EPIPE');
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(logs).toContainEqual(expect.objectContaining({
      source: 'helper',
      level: 'error',
      line: 'helper stdin closed: write EPIPE',
    }));
  });
});
