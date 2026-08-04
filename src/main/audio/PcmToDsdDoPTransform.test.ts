import { describe, expect, it, vi } from 'vitest';
import type { EchoSdmWorkerRequest } from './EchoSrcCudaWorker';
import { packDop24Le, packNativeDsdBytes } from './DsdDopPipeline';
import { PcmToDsdDoPTransform, resolveSdmDopTransportSampleRate, resolveSdmModulatorProfile, resolveSdmNativeSampleRate } from './PcmToDsdDoPTransform';

const pcmBuffer = (samples: number[]): Buffer => {
  const buffer = Buffer.alloc(samples.length * Float32Array.BYTES_PER_ELEMENT);
  samples.forEach((sample, index) => buffer.writeFloatLE(sample, index * Float32Array.BYTES_PER_ELEMENT));
  return buffer;
};

const runTransform = async (transform: PcmToDsdDoPTransform, input: Buffer): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  transform.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  transform.end(input);
  await new Promise<void>((resolve, reject) => {
    transform.once('end', resolve);
    transform.once('error', reject);
  });
  return Buffer.concat(chunks);
};

const countBits = (value: number): number => {
  let remaining = value & 0xff;
  let count = 0;
  while (remaining) {
    count += remaining & 1;
    remaining >>>= 1;
  }
  return count;
};

const dopPayloadOneDensity = (output: Buffer): number => {
  let ones = 0;
  let bits = 0;
  for (let offset = 0; offset + 2 < output.length; offset += 3) {
    ones += countBits(output[offset] ?? 0) + countBits(output[offset + 1] ?? 0);
    bits += 16;
  }
  return bits > 0 ? ones / bits : 0;
};

const dopPayloadFrameAverages = (output: Buffer, channels = 1, channel = 0): number[] => {
  const frameBytes = channels * 3;
  const averages: number[] = [];

  for (let frameOffset = 0; frameOffset + frameBytes <= output.length; frameOffset += frameBytes) {
    const sampleOffset = frameOffset + channel * 3;
    let sum = 0;
    for (let byteIndex = 0; byteIndex < 2; byteIndex += 1) {
      const byte = output[sampleOffset + byteIndex] ?? 0;
      for (let bit = 0; bit < 8; bit += 1) {
        sum += (byte & (1 << bit)) !== 0 ? 1 : -1;
      }
    }
    averages.push(sum / 16);
  }

  return averages;
};

const mean = (values: number[]): number =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const correlation = (a: number[], b: number[]): number => {
  const length = Math.min(a.length, b.length);
  if (length === 0) {
    return 0;
  }

  const meanA = mean(a.slice(0, length));
  const meanB = mean(b.slice(0, length));
  let numerator = 0;
  let energyA = 0;
  let energyB = 0;

  for (let index = 0; index < length; index += 1) {
    const centeredA = (a[index] ?? 0) - meanA;
    const centeredB = (b[index] ?? 0) - meanB;
    numerator += centeredA * centeredB;
    energyA += centeredA * centeredA;
    energyB += centeredB * centeredB;
  }

  return energyA > 0 && energyB > 0 ? numerator / Math.sqrt(energyA * energyB) : 0;
};

describe('PcmToDsdDoPTransform', () => {
  it('maps SDM targets to DoP transport rates', () => {
    expect(resolveSdmNativeSampleRate('dsd64')).toBe(2_822_400);
    expect(resolveSdmDopTransportSampleRate('dsd64')).toBe(176_400);
    expect(resolveSdmNativeSampleRate('dsd128')).toBe(5_644_800);
    expect(resolveSdmDopTransportSampleRate('dsd128')).toBe(352_800);
  });

  it('uses distinct modulator profiles for each quality tier', () => {
    expect(resolveSdmModulatorProfile('safe')).toMatchObject({
      id: 'echo-sdm-ef1-safe',
      order: 1,
      feedbackCoefficients: [0.95],
    });
    expect(resolveSdmModulatorProfile('hifi').order).toBe(1);
    expect(resolveSdmModulatorProfile('reference').order).toBe(2);
    expect(resolveSdmModulatorProfile('insane').order).toBe(2);
  });

  it('packs stereo PCM frames into DoP24LE with alternating markers', async () => {
    const transform = new PcmToDsdDoPTransform({ channels: 2, qualityProfile: 'safe' });
    const output = await runTransform(transform, pcmBuffer([0, 0, 0, 0]));

    expect(output).toHaveLength(12);
    expect([...output]).toEqual([
      0x69, 0x69, 0x05, 0x69, 0x69, 0x05,
      0x69, 0x69, 0xfa, 0x69, 0x69, 0xfa,
    ]);
    expect([...output].filter((_, index) => index % 3 === 2)).toEqual([0x05, 0x05, 0xfa, 0xfa]);
  });

  it('packs DSF channel blocks into DoP and native DSD without hardware claims', () => {
    const left = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    const right = Buffer.from([0x11, 0x12, 0x13, 0x14, 0xfa]);

    expect([...packDop24Le([left, right], 1, 4, 1)]).toEqual([
      0x02, 0x03, 0xfa, 0x12, 0x13, 0xfa,
      0x04, 0x05, 0x05, 0x14, 0xfa, 0x05,
    ]);
    expect([...packNativeDsdBytes([left, right], 1, 4)]).toEqual([
      0x02, 0x12, 0x03, 0x13, 0x04, 0x14, 0x05, 0xfa,
    ]);
  });

  it('packs generated SDM as native DSD byte frames when requested', async () => {
    const dop = await runTransform(
      new PcmToDsdDoPTransform({ channels: 2, qualityProfile: 'safe' }),
      pcmBuffer([0, 0, 0, 0]),
    );
    const native = await runTransform(
      new PcmToDsdDoPTransform({ channels: 2, qualityProfile: 'safe', outputFormat: 'dsd-native-raw' }),
      pcmBuffer([0, 0, 0, 0]),
    );

    expect(native).toHaveLength(8);
    expect([...native]).toEqual([
      dop[0], dop[3], dop[1], dop[4],
      dop[6], dop[9], dop[7], dop[10],
    ]);
    expect([...native].filter((byte) => byte === 0x05 || byte === 0xfa)).toHaveLength(0);
  });

  it('encodes PCM amplitude as DSD bit density instead of a fixed noise pattern', async () => {
    const frames = 512;
    const silence = await runTransform(
      new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'safe' }),
      pcmBuffer(Array.from({ length: frames }, () => 0)),
    );
    const positive = await runTransform(
      new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'safe' }),
      pcmBuffer(Array.from({ length: frames }, () => 0.5)),
    );
    const negative = await runTransform(
      new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'safe' }),
      pcmBuffer(Array.from({ length: frames }, () => -0.5)),
    );

    expect(dopPayloadOneDensity(silence)).toBeGreaterThan(0.49);
    expect(dopPayloadOneDensity(silence)).toBeLessThan(0.51);
    expect(dopPayloadOneDensity(positive)).toBeGreaterThan(0.70);
    expect(dopPayloadOneDensity(positive)).toBeLessThan(0.80);
    expect(dopPayloadOneDensity(negative)).toBeGreaterThan(0.20);
    expect(dopPayloadOneDensity(negative)).toBeLessThan(0.30);
    expect(Buffer.compare(positive, silence)).not.toBe(0);
    expect(Buffer.compare(negative, silence)).not.toBe(0);
  });

  it('keeps every quality tier on the stable amplitude-encoding modulator', async () => {
    const input = pcmBuffer([0, 0, 0.25, -0.25, 0.5, -0.5, -0.25, 0.25]);
    const safe = await runTransform(new PcmToDsdDoPTransform({ channels: 2, qualityProfile: 'safe' }), input);
    const reference = await runTransform(new PcmToDsdDoPTransform({ channels: 2, qualityProfile: 'reference' }), input);

    expect(safe).toHaveLength(reference.length);
    expect(dopPayloadOneDensity(safe)).toBeGreaterThan(0.40);
    expect(dopPayloadOneDensity(safe)).toBeLessThan(0.60);
    expect(dopPayloadOneDensity(reference)).toBeGreaterThan(0.40);
    expect(dopPayloadOneDensity(reference)).toBeLessThan(0.60);
    expect([...reference].filter((_, index) => index % 3 === 2)).toEqual([0x05, 0x05, 0xfa, 0xfa, 0x05, 0x05, 0xfa, 0xfa]);
  });

  it('uses distinct tone-safe feedback coefficients for each quality tier', async () => {
    const input = pcmBuffer(Array.from({ length: 512 }, (_value, index) => Math.sin(index * 0.19) * 0.6));
    const safe = await runTransform(new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'safe' }), input);
    const hifi = await runTransform(new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'hifi' }), input);
    const reference = await runTransform(new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'reference' }), input);

    expect(Buffer.compare(safe, hifi)).not.toBe(0);
    expect(Buffer.compare(hifi, reference)).not.toBe(0);
    expect(dopPayloadOneDensity(hifi)).toBeGreaterThan(0.35);
    expect(dopPayloadOneDensity(hifi)).toBeLessThan(0.65);
    expect(dopPayloadOneDensity(reference)).toBeGreaterThan(0.35);
    expect(dopPayloadOneDensity(reference)).toBeLessThan(0.65);
  });

  it('keeps generated SDM silence centered after DoP payload averaging', async () => {
    const output = await runTransform(
      new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'hifi' }),
      pcmBuffer(Array.from({ length: 4096 }, () => 0)),
    );
    const frameAverages = dopPayloadFrameAverages(output);

    expect(Math.abs(mean(frameAverages))).toBeLessThan(0.015);
    expect(dopPayloadOneDensity(output)).toBeGreaterThan(0.49);
    expect(dopPayloadOneDensity(output)).toBeLessThan(0.51);
  });

  it('locks sustained near-silence to DSD silence to avoid idle hiss', async () => {
    const frames = 540;
    const output = await runTransform(
      new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'reference' }),
      pcmBuffer(Array.from({ length: frames }, () => 0.00002)),
    );
    const lockedTail = output.subarray((frames - 4) * 3);

    expect([...lockedTail].filter((_, index) => index % 3 !== 2)).toEqual([
      0x69, 0x69,
      0x69, 0x69,
      0x69, 0x69,
      0x69, 0x69,
    ]);
  });

  it('locks very low-level PCM tails to DSD idle before they become audible hiss', async () => {
    const frames = 540;
    const output = await runTransform(
      new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'insane' }),
      pcmBuffer(Array.from({ length: frames }, () => 0.00015)),
    );
    const lockedTail = output.subarray((frames - 4) * 3);

    expect([...lockedTail].filter((_, index) => index % 3 !== 2)).toEqual([
      0x69, 0x69,
      0x69, 0x69,
      0x69, 0x69,
      0x69, 0x69,
    ]);
  });

  it('releases the SDM idle lock when the PCM signal becomes audible again', async () => {
    const output = await runTransform(
      new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'reference' }),
      pcmBuffer([
        ...Array.from({ length: 540 }, () => 0.00002),
        0.02,
        0.02,
      ]),
    );
    const releasedFrame = output.subarray(540 * 3, 540 * 3 + 2);

    expect([...releasedFrame]).not.toEqual([0x69, 0x69]);
  });

  it('preserves a low-frequency PCM tone in the generated SDM payload', async () => {
    const transportRate = resolveSdmDopTransportSampleRate('dsd256', 44100);
    const samples = Array.from({ length: 4096 }, (_value, index) =>
      Math.sin((2 * Math.PI * 1000 * index) / transportRate) * 0.25);
    const output = await runTransform(
      new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'safe' }),
      pcmBuffer(samples),
    );
    const reconstructed = dopPayloadFrameAverages(output);
    const skipFrames = 96;

    expect(correlation(reconstructed.slice(skipFrames), samples.slice(skipFrames))).toBeGreaterThan(0.82);
  });

  it('uses the tone-safe SDM core without collapsing music into a periodic current-like pattern', async () => {
    const transportRate = resolveSdmDopTransportSampleRate('dsd128', 44100);
    const samples = Array.from({ length: 8192 }, (_value, index) =>
      (Math.sin((2 * Math.PI * 1000 * index) / transportRate) * 0.4) +
      (Math.sin((2 * Math.PI * 3700 * index) / transportRate) * 0.08));
    const output = await runTransform(
      new PcmToDsdDoPTransform({ channels: 1, qualityProfile: 'insane' }),
      pcmBuffer(samples),
    );
    const reconstructed = dopPayloadFrameAverages(output);
    const skipFrames = 128;

    expect(correlation(reconstructed.slice(skipFrames), samples.slice(skipFrames))).toBeGreaterThan(0.86);
    expect(Math.abs(mean(reconstructed.slice(skipFrames)))).toBeLessThan(0.02);
    expect(dopPayloadOneDensity(output)).toBeGreaterThan(0.42);
    expect(dopPayloadOneDensity(output)).toBeLessThan(0.58);
  });

  it('routes conversion through a CUDA SDM worker when requested', async () => {
    const processSdm = vi.fn(async (request: EchoSdmWorkerRequest) => ({
      backend: 'cuda' as const,
      output: Uint8Array.from([0x11, 0x22, 0x05, 0x33, 0x44, 0xfa]),
      errorHistory: request.errorHistory,
      ditherState: request.ditherState,
      dopFrameIndex: 2,
    }));
    const metrics = vi.fn();
    const transform = new PcmToDsdDoPTransform({
      channels: 1,
      qualityProfile: 'safe',
      backend: 'cuda',
      workerClient: { processSdm },
      fallbackToCpuOnError: true,
      sourceSampleRate: 44100,
      onMetrics: metrics,
    });
    const output = await runTransform(transform, pcmBuffer([0, 0]));

    expect(output).toEqual(Buffer.from([0x11, 0x22, 0x05, 0x33, 0x44, 0xfa]));
    expect(processSdm).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cuda',
      channels: 1,
      dopFrameIndex: 0,
      input: new Float32Array([0, 0]),
      feedbackCoefficients: new Float32Array([0.95]),
      idleRunFrames: new Uint32Array([0]),
      idleLocked: new Uint32Array([0]),
    }));
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cuda',
      requestCount: 1,
      lastRequestCount: 1,
      batchCount: 1,
      targetBatchFrames: 1,
      maxBlockFrames: 8192,
      lastInputFrames: 2,
      lastOutputFrames: 2,
    }));
  });

  it('converts CUDA worker DoP output to native DSD byte frames when requested', async () => {
    const processSdm = vi.fn(async (request: EchoSdmWorkerRequest) => ({
      backend: 'cuda' as const,
      output: Uint8Array.from([1, 2, 0x05, 5, 6, 0x05, 3, 4, 0xfa, 7, 8, 0xfa]),
      errorHistory: request.errorHistory,
      ditherState: request.ditherState,
      dopFrameIndex: 2,
    }));
    const transform = new PcmToDsdDoPTransform({
      channels: 2,
      qualityProfile: 'safe',
      outputFormat: 'dsd-native-raw',
      backend: 'cuda',
      workerClient: { processSdm },
      fallbackToCpuOnError: true,
    });
    const output = await runTransform(transform, pcmBuffer([0, 0, 0, 0]));

    expect(output).toEqual(Buffer.from([1, 5, 2, 6, 3, 7, 4, 8]));
  });

  it('batches small CUDA SDM chunks and splits worker calls by max block frames', async () => {
    const processSdm = vi.fn(async (request: EchoSdmWorkerRequest) => ({
      backend: 'cuda' as const,
      output: Uint8Array.from(Array.from({ length: request.input.length }, (_value, index) => [
        index,
        index + 1,
        request.dopFrameIndex % 2 === 0 ? 0x05 : 0xfa,
      ]).flat()),
      errorHistory: request.errorHistory,
      ditherState: request.ditherState,
      dopFrameIndex: request.dopFrameIndex + request.input.length,
    }));
    const metrics = vi.fn();
    const transform = new PcmToDsdDoPTransform({
      channels: 1,
      qualityProfile: 'safe',
      backend: 'cuda',
      workerClient: { processSdm },
      fallbackToCpuOnError: true,
      targetBatchFrames: 4,
      maxBlockFrames: 2,
      sourceSampleRate: 176400,
      onMetrics: metrics,
    });
    const chunks: Buffer[] = [];
    const ended = new Promise<void>((resolve, reject) => {
      transform.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      transform.once('end', resolve);
      transform.once('error', reject);
    });
    const writeChunk = (input: Buffer): Promise<void> => new Promise((resolve, reject) => {
      transform.write(input, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    await writeChunk(pcmBuffer([0]));
    await writeChunk(pcmBuffer([0]));
    await writeChunk(pcmBuffer([0]));
    expect(processSdm).not.toHaveBeenCalled();

    transform.end(pcmBuffer([0]));
    await ended;

    expect(processSdm).toHaveBeenCalledTimes(2);
    expect(processSdm.mock.calls[0]?.[0].input).toEqual(new Float32Array([0, 0]));
    expect(processSdm.mock.calls[1]?.[0].input).toEqual(new Float32Array([0, 0]));
    expect(Buffer.concat(chunks)).toHaveLength(12);
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cuda',
      requestCount: 2,
      lastRequestCount: 2,
      batchCount: 1,
      targetBatchFrames: 4,
      maxBlockFrames: 2,
      lastInputFrames: 4,
      lastOutputFrames: 4,
    }));
  });

  it('reports CUDA fallback honestly and emits CPU DoP bytes instead of claiming worker success', async () => {
    const fallbackReasons: string[] = [];
    const metrics = vi.fn();
    const processSdm = vi.fn(async () => {
      throw new Error('sdm_cuda_worker_unavailable_for_test');
    });
    const transform = new PcmToDsdDoPTransform({
      channels: 1,
      qualityProfile: 'safe',
      backend: 'cuda',
      workerClient: { processSdm },
      fallbackToCpuOnError: true,
      onBackendFallback: (reason) => fallbackReasons.push(reason),
      onMetrics: metrics,
    });

    const output = await runTransform(transform, pcmBuffer([0, 0]));

    expect(processSdm).toHaveBeenCalledTimes(1);
    expect(fallbackReasons).toEqual(['sdm_cuda_worker_unavailable_for_test']);
    expect([...output]).toEqual([0x69, 0x69, 0x05, 0x69, 0x69, 0xfa]);
    expect(metrics).toHaveBeenLastCalledWith(expect.objectContaining({
      backend: 'cpu',
      requestCount: 1,
      lastRequestCount: 1,
      lastOutputFrames: 2,
    }));
  });

  it('does not hide intentional CUDA cancellation behind a fallback status', async () => {
    const fallback = vi.fn();
    const transform = new PcmToDsdDoPTransform({
      channels: 1,
      qualityProfile: 'safe',
      backend: 'cuda',
      workerClient: {
        processSdm: vi.fn(async () => {
          throw new Error('audio_session_run_cancelled');
        }),
      },
      fallbackToCpuOnError: true,
      onBackendFallback: fallback,
    });

    await expect(runTransform(transform, pcmBuffer([0]))).rejects.toThrow('audio_session_run_cancelled');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('rejects incomplete Float32 PCM frames', async () => {
    const transform = new PcmToDsdDoPTransform({ channels: 2, qualityProfile: 'safe' });

    await expect(runTransform(transform, Buffer.from([0, 1, 2]))).rejects.toThrow('pcm_to_dsd_unaligned_pcm_tail');
  });
});
