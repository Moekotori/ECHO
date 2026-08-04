import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { processFirInterleavedFloat32Cpu } from './EchoSrcFirEngine';
import { EchoSrcFirWorkerTransform, type EchoSrcFirWorkerTransformMetrics } from './EchoSrcFirWorkerTransform';
import type { EchoSrcFirWorkerClientLike } from './EchoSrcFirWorkerTransform';

const pcmBuffer = (samples: number[]): Buffer => {
  const buffer = Buffer.alloc(samples.length * 4);
  samples.forEach((sample, index) => {
    buffer.writeFloatLE(sample, index * 4);
  });
  return buffer;
};

const pcmSamples = (buffer: Buffer): number[] => {
  const samples: number[] = [];
  for (let index = 0; index < buffer.length / 4; index += 1) {
    samples.push(buffer.readFloatLE(index * 4));
  }
  return samples;
};

describe('EchoSrcFirWorkerTransform', () => {
  it('streams Float32LE PCM through the FIR worker while preserving history', async () => {
    const taps = new Float32Array([0.5, 0.25, 0.25]);
    const processFir = vi.fn<EchoSrcFirWorkerClientLike['processFir']>(async (request) => {
      const result = processFirInterleavedFloat32Cpu(request.input, request.channels, request.taps, {
        history: request.history,
      });
      return {
        backend: request.backend,
        output: result.output,
        history: result.state.history,
      };
    });
    const transform = new EchoSrcFirWorkerTransform({
      backend: 'cuda',
      channels: 2,
      taps,
      maxBlockFrames: 2,
      client: { processFir },
    });
    const outputChunks: Buffer[] = [];
    transform.on('data', (chunk: Buffer) => outputChunks.push(Buffer.from(chunk)));

    transform.write(pcmBuffer([1, 10]));
    transform.end(pcmBuffer([2, 20, 3, 30]));
    await once(transform, 'end');

    expect(processFir).toHaveBeenCalledTimes(2);
    expect(pcmSamples(Buffer.concat(outputChunks))).toEqual([0.5, 5, 1.25, 12.5, 2.25, 22.5]);
  });

  it('rejects a partial Float32 frame tail', async () => {
    const transform = new EchoSrcFirWorkerTransform({
      backend: 'cuda',
      channels: 2,
      taps: new Float32Array([1]),
      client: {
        processFir: vi.fn(),
      },
    });
    const errorPromise = once(transform, 'error');

    transform.end(Buffer.from([1, 2, 3]));

    const [error] = await errorPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('echo_src_fir_worker_unaligned_pcm_tail');
  });

  it('supports integer upsampling before FIR processing', async () => {
    const processFir = vi.fn<EchoSrcFirWorkerClientLike['processFir']>(async (request) => ({
      backend: request.backend,
      output: request.input,
      history: request.history,
    }));
    const transform = new EchoSrcFirWorkerTransform({
      backend: 'cuda',
      channels: 1,
      taps: new Float32Array([1]),
      upsampleFactor: 2,
      client: { processFir },
    });
    const outputChunks: Buffer[] = [];
    transform.on('data', (chunk: Buffer) => outputChunks.push(Buffer.from(chunk)));

    transform.end(pcmBuffer([1, 2]));
    await once(transform, 'end');

    expect(pcmSamples(Buffer.concat(outputChunks))).toEqual([2, 0, 4, 0]);
  });

  it('coalesces small PCM chunks into an explicit CUDA batch with metrics', async () => {
    const metrics: EchoSrcFirWorkerTransformMetrics[] = [];
    const processFir = vi.fn<EchoSrcFirWorkerClientLike['processFir']>(async (request) => ({
      backend: request.backend,
      output: request.input,
      history: request.history,
    }));
    const transform = new EchoSrcFirWorkerTransform({
      backend: 'cuda',
      channels: 1,
      taps: new Float32Array([1]),
      targetBatchFrames: 3,
      sourceSampleRate: 44100,
      client: { processFir },
      onMetrics: (metric) => metrics.push(metric),
    });
    const outputChunks: Buffer[] = [];
    transform.on('data', (chunk: Buffer) => outputChunks.push(Buffer.from(chunk)));

    transform.write(pcmBuffer([1]));
    await new Promise((resolve) => setImmediate(resolve));
    transform.write(pcmBuffer([2]));
    await new Promise((resolve) => setImmediate(resolve));
    expect(processFir).not.toHaveBeenCalled();

    transform.end(pcmBuffer([3]));
    await once(transform, 'end');

    expect(processFir).toHaveBeenCalledTimes(1);
    expect(Array.from(processFir.mock.calls[0]![0].input)).toEqual([1, 2, 3]);
    expect(pcmSamples(Buffer.concat(outputChunks))).toEqual([1, 2, 3]);
    expect(metrics[0]).toMatchObject({
      backend: 'cuda',
      requestCount: 1,
      lastRequestCount: 1,
      batchCount: 1,
      targetBatchFrames: 3,
      lastInputFrames: 3,
      lastOutputFrames: 3,
    });
    expect(metrics[0]!.realtimeRatio).toBeGreaterThan(0);
  });

  it('flushes an underfilled CUDA batch at stream end', async () => {
    const processFir = vi.fn<EchoSrcFirWorkerClientLike['processFir']>(async (request) => ({
      backend: request.backend,
      output: request.input,
      history: request.history,
    }));
    const transform = new EchoSrcFirWorkerTransform({
      backend: 'cuda',
      channels: 1,
      taps: new Float32Array([1]),
      targetBatchFrames: 4,
      client: { processFir },
    });
    const outputChunks: Buffer[] = [];
    transform.on('data', (chunk: Buffer) => outputChunks.push(Buffer.from(chunk)));

    transform.end(pcmBuffer([1, 2]));
    await once(transform, 'end');

    expect(processFir).toHaveBeenCalledTimes(1);
    expect(Array.from(processFir.mock.calls[0]![0].input)).toEqual([1, 2]);
    expect(pcmSamples(Buffer.concat(outputChunks))).toEqual([1, 2]);
  });

  it('supports staged 2x FIR processing for higher-ratio SRC', async () => {
    const processFir = vi.fn<EchoSrcFirWorkerClientLike['processFir']>(async (request) => ({
      backend: request.backend,
      output: request.input,
      history: request.history,
    }));
    const transform = new EchoSrcFirWorkerTransform({
      backend: 'cuda',
      channels: 1,
      taps: new Float32Array([1]),
      stages: [
        { taps: new Float32Array([1]), upsampleFactor: 2, label: '2x-a' },
        { taps: new Float32Array([1]), upsampleFactor: 2, label: '2x-b' },
      ],
      client: { processFir },
    });
    const outputChunks: Buffer[] = [];
    transform.on('data', (chunk: Buffer) => outputChunks.push(Buffer.from(chunk)));

    transform.end(pcmBuffer([1, 2]));
    await once(transform, 'end');

    expect(processFir).toHaveBeenCalledTimes(2);
    expect(pcmSamples(Buffer.concat(outputChunks))).toEqual([4, 0, 0, 0, 8, 0, 0, 0]);
  });

  it('falls back to CPU FIR when the CUDA worker fails mid-stream', async () => {
    const fallbackReasons: string[] = [];
    const transform = new EchoSrcFirWorkerTransform({
      backend: 'cuda',
      channels: 1,
      taps: new Float32Array([0.5, 0.5]),
      fallbackToCpuOnError: true,
      onBackendFallback: (reason) => fallbackReasons.push(reason),
      client: {
        processFir: vi.fn(async () => {
          throw new Error('src_cuda_worker_request_timeout');
        }),
      },
    });
    const outputChunks: Buffer[] = [];
    transform.on('data', (chunk: Buffer) => outputChunks.push(Buffer.from(chunk)));

    transform.end(pcmBuffer([1, 0]));
    await once(transform, 'end');

    expect(fallbackReasons).toEqual(['src_cuda_worker_request_timeout']);
    expect(pcmSamples(Buffer.concat(outputChunks))).toEqual([0.5, 0.5]);
  });

  it('does not report intentional CUDA worker disposal as runtime fallback', async () => {
    const fallbackReasons: string[] = [];
    const transform = new EchoSrcFirWorkerTransform({
      backend: 'cuda',
      channels: 1,
      taps: new Float32Array([1]),
      fallbackToCpuOnError: true,
      onBackendFallback: (reason) => fallbackReasons.push(reason),
      client: {
        processFir: vi.fn(async () => {
          throw new Error('src_cuda_worker_disposed');
        }),
      },
    });
    const errorPromise = once(transform, 'error');

    transform.end(pcmBuffer([1]));

    const [error] = await errorPromise;
    expect((error as Error).message).toBe('src_cuda_worker_disposed');
    expect(fallbackReasons).toEqual([]);
  });
});
