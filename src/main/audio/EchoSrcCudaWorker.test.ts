import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearEchoSrcCudaWorkerStatusCache,
  EchoSrcCudaWorkerClient,
  resolveEchoSrcCudaWorkerBinary,
  resolveEchoSrcCudaWorkerStatus,
} from './EchoSrcCudaWorker';

const createFakeWorker = (
  onRequest: (request: Record<string, unknown>) => Record<string, unknown>,
) => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let pendingText = '';
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      pendingText += chunk.toString();
      let newlineIndex = pendingText.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = pendingText.slice(0, newlineIndex);
        pendingText = pendingText.slice(newlineIndex + 1);
        const response = onRequest(JSON.parse(line) as Record<string, unknown>);
        stdout.write(`${JSON.stringify(response)}\n`);
        newlineIndex = pendingText.indexOf('\n');
      }
      callback();
    },
  });
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    killed: false,
    kill: vi.fn(() => {
      child.killed = true;
      stdout.end();
      stderr.end();
      return true;
    }),
  });

  return child;
};

describe('EchoSrcCudaWorker', () => {
  const devWorkerPath = 'G:\\ECHODev\\electron-app\\build\\echo-src-cuda-worker.exe';

  beforeEach(() => {
    clearEchoSrcCudaWorkerStatusCache();
  });

  it('resolves the development worker binary from electron-app/build', () => {
    if (process.platform !== 'win32') return;
    expect(resolveEchoSrcCudaWorkerBinary({
      cwd: 'G:\\ECHODev',
      resourcesPath: 'G:\\missing',
      appPath: null,
      exists: (path) => path === devWorkerPath,
      isExecutable: () => true,
    })).toBe(devWorkerPath);
  });

  it('accepts a CUDA-built worker with the expected protocol', () => {
    if (process.platform !== 'win32') return;
    const execFileSync = vi.fn().mockReturnValue('{"type":"status","ok":true,"protocol":1,"cudaBuilt":true}\n');

    expect(resolveEchoSrcCudaWorkerStatus({
      cwd: 'G:\\ECHODev',
      resourcesPath: 'G:\\missing',
      appPath: null,
      exists: (path) => path === devWorkerPath,
      isExecutable: () => true,
      execFileSync,
    })).toMatchObject({
      available: true,
      protocol: 1,
      cudaBuilt: true,
      error: null,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      devWorkerPath,
      ['--status'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('rejects a worker that was built without CUDA support', () => {
    if (process.platform !== 'win32') return;
    const execFileSync = vi.fn().mockReturnValue('{"type":"status","ok":true,"protocol":1,"cudaBuilt":false}\n');

    expect(resolveEchoSrcCudaWorkerStatus({
      cwd: 'G:\\ECHODev',
      resourcesPath: 'G:\\missing',
      appPath: null,
      exists: (path) => path === devWorkerPath,
      isExecutable: () => true,
      execFileSync,
    })).toMatchObject({
      available: false,
      protocol: 1,
      cudaBuilt: false,
      error: 'src_cuda_worker_built_without_cuda',
    });
  });

  it('processes FIR blocks through the long-lived worker client', async () => {
    const requests: Record<string, unknown>[] = [];
    const client = new EchoSrcCudaWorkerClient({
      workerPath: 'G:\\ECHODev\\electron-app\\build\\echo-src-cuda-worker.exe',
      spawn: vi.fn(() => createFakeWorker((request) => {
        requests.push(request);
        return {
          type: 'firResult',
          ok: true,
          backend: request.backend,
          output: [0.5, 1.25, 2.25],
          history: [2, 3],
        };
      }) as never),
    });

    await expect(client.processFir({
      backend: 'cuda',
      channels: 1,
      taps: new Float32Array([0.5, 0.25, 0.25]),
      history: new Float32Array([0, 0]),
      input: new Float32Array([1, 2, 3]),
    })).resolves.toMatchObject({
      backend: 'cuda',
      output: new Float32Array([0.5, 1.25, 2.25]),
      history: new Float32Array([2, 3]),
    });
    expect(requests[0]).toMatchObject({
      type: 'fir',
      backend: 'cuda',
      channels: 1,
      input: [1, 2, 3],
      taps: [0.5, 0.25, 0.25],
      history: [0, 0],
    });

    client.dispose();
  });

  it('processes SDM blocks through the long-lived worker client', async () => {
    const requests: Record<string, unknown>[] = [];
    const client = new EchoSrcCudaWorkerClient({
      workerPath: 'G:\\ECHODev\\electron-app\\build\\echo-src-cuda-worker.exe',
      spawn: vi.fn(() => createFakeWorker((request) => {
        requests.push(request);
        return {
          type: 'sdmResult',
          ok: true,
          backend: request.backend,
          output: [0x55, 0xaa, 0x05, 0xaa, 0x55, 0xfa],
          errorHistory: [0.25],
          ditherState: [1234],
          idleRunFrames: [77],
          idleLocked: [1],
          dopFrameIndex: 2,
        };
      }) as never),
    });

    await expect(client.processSdm({
      backend: 'cuda',
      channels: 1,
      input: new Float32Array([0, 0.25]),
      feedbackCoefficients: new Float32Array([0.65]),
      errorHistory: new Float32Array([0]),
      ditherState: new Uint32Array([42]),
      dopFrameIndex: 0,
      ditherAmplitude: 0.000004,
      inputLimit: 0.995,
      stabilityLimit: 2.5,
    })).resolves.toMatchObject({
      backend: 'cuda',
      output: new Uint8Array([0x55, 0xaa, 0x05, 0xaa, 0x55, 0xfa]),
      errorHistory: new Float32Array([0.25]),
      ditherState: new Uint32Array([1234]),
      idleRunFrames: new Uint32Array([77]),
      idleLocked: new Uint32Array([1]),
      dopFrameIndex: 2,
    });
    expect(requests[0]).toMatchObject({
      type: 'sdm',
      backend: 'cuda',
      channels: 1,
      input: [0, 0.25],
      feedbackCoefficients: [0.649999976],
      errorHistory: [0],
      ditherState: [42],
      idleRunFrames: [0],
      idleLocked: [0],
      dopFrameIndex: 0,
    });

    client.dispose();
  });

  it('rejects worker-side FIR errors', async () => {
    const client = new EchoSrcCudaWorkerClient({
      workerPath: 'G:\\ECHODev\\electron-app\\build\\echo-src-cuda-worker.exe',
      spawn: vi.fn(() => createFakeWorker(() => ({
        type: 'error',
        ok: false,
        code: 'cuda_not_built',
        detail: '',
      })) as never),
    });

    await expect(client.processFir({
      backend: 'cuda',
      channels: 1,
      taps: new Float32Array([1]),
      history: new Float32Array([]),
      input: new Float32Array([1]),
    })).rejects.toThrow('cuda_not_built');

    client.dispose();
  });
});
