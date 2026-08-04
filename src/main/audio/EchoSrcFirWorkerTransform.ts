import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import { performance } from 'node:perf_hooks';
import type { EchoSrcFirWorkerBackend, EchoSrcFirWorkerRequest, EchoSrcFirWorkerResult } from './EchoSrcCudaWorker';
import { processFirInterleavedFloat32Cpu } from './EchoSrcFirEngine';

export type EchoSrcFirWorkerClientLike = {
  processFir: (request: EchoSrcFirWorkerRequest) => Promise<EchoSrcFirWorkerResult>;
};

export type EchoSrcFirWorkerTransformMetrics = {
  backend: EchoSrcFirWorkerBackend;
  requestCount: number;
  lastRequestCount: number;
  batchCount: number;
  targetBatchFrames: number;
  maxBlockFrames: number;
  lastInputFrames: number;
  lastOutputFrames: number;
  lastProcessMs: number;
  averageProcessMs: number;
  maxProcessMs: number;
  realtimeRatio: number | null;
};

export type EchoSrcFirWorkerTransformOptions = {
  client: EchoSrcFirWorkerClientLike;
  backend: EchoSrcFirWorkerBackend;
  channels: number;
  taps: Float32Array;
  stages?: Array<{
    taps: Float32Array;
    upsampleFactor?: 1 | 2;
    label?: string;
  }>;
  upsampleFactor?: 1 | 2 | 4 | 8;
  maxBlockFrames?: number;
  targetBatchFrames?: number;
  sourceSampleRate?: number;
  fallbackToCpuOnError?: boolean;
  onBackendFallback?: (reason: string) => void;
  onMetrics?: (metrics: EchoSrcFirWorkerTransformMetrics) => void;
};

const defaultMaxBlockFrames = 16_384;

type EchoSrcFirWorkerTransformStage = {
  taps: Float32Array;
  upsampleFactor: 1 | 2 | 4 | 8;
  label: string;
};

const isEchoSrcFirWorkerCancellationReason = (reason: string): boolean =>
  reason === 'src_cuda_worker_disposed' || reason === 'audio_session_run_cancelled';

const readFloat32LeBuffer = (buffer: Buffer): Float32Array => {
  const samples = new Float32Array(buffer.length / 4);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readFloatLE(index * 4);
  }
  return samples;
};

const writeFloat32LeBuffer = (samples: Float32Array): Buffer => {
  const buffer = Buffer.allocUnsafe(samples.length * 4);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeFloatLE(samples[index], index * 4);
  }
  return buffer;
};

export class EchoSrcFirWorkerTransform extends Transform {
  private readonly channels: number;
  private readonly stages: EchoSrcFirWorkerTransformStage[];
  private readonly maxBlockFrames: number;
  private readonly targetBatchFrames: number;
  private readonly batchingEnabled: boolean;
  private readonly sourceSampleRate: number | null;
  private histories: Float32Array[];
  private byteCarry = Buffer.alloc(0);
  private pcmCarry = Buffer.alloc(0);
  private backendFallbackReason: string | null = null;
  private requestCount = 0;
  private batchCount = 0;
  private totalProcessMs = 0;
  private maxProcessMs = 0;

  constructor(private readonly options: EchoSrcFirWorkerTransformOptions) {
    super();
    this.channels = Math.max(1, Math.round(options.channels));
    this.maxBlockFrames = Math.max(1, Math.round(options.maxBlockFrames ?? defaultMaxBlockFrames));
    this.targetBatchFrames = Math.max(1, Math.round(options.targetBatchFrames ?? 1));
    this.batchingEnabled = typeof options.targetBatchFrames === 'number' && options.targetBatchFrames > 1;
    this.sourceSampleRate = typeof options.sourceSampleRate === 'number' && Number.isFinite(options.sourceSampleRate) && options.sourceSampleRate > 0
      ? options.sourceSampleRate
      : null;
    this.stages = options.stages?.length
      ? options.stages.map((stage, index) => ({
        taps: stage.taps,
        upsampleFactor: stage.upsampleFactor ?? 1,
        label: stage.label ?? `stage-${index + 1}`,
      }))
      : [{
        taps: options.taps,
        upsampleFactor: options.upsampleFactor ?? 1,
        label: 'stage-1',
      }];
    this.histories = this.stages.map((stage) => new Float32Array(Math.max(0, stage.taps.length - 1) * this.channels));
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    void this.processChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).then(
      () => callback(),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
    );
  }

  override _flush(callback: TransformCallback): void {
    void this.flushPending().then(
      () => callback(),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
    );
  }

  private async processChunk(chunk: Buffer): Promise<void> {
    const combined = this.byteCarry.length > 0 ? Buffer.concat([this.byteCarry, chunk]) : chunk;
    const frameByteSize = this.channels * 4;
    const completeBytes = Math.floor(combined.length / frameByteSize) * frameByteSize;
    this.byteCarry = completeBytes < combined.length ? Buffer.from(combined.subarray(completeBytes)) : Buffer.alloc(0);

    if (completeBytes === 0) {
      return;
    }

    if (!this.batchingEnabled) {
      await this.processPcmBatch(combined.subarray(0, completeBytes), completeBytes / frameByteSize);
      return;
    }

    this.pcmCarry = this.pcmCarry.length > 0
      ? Buffer.concat([this.pcmCarry, combined.subarray(0, completeBytes)])
      : Buffer.from(combined.subarray(0, completeBytes));
    await this.drainPcmCarry(false);
  }

  private async flushPending(): Promise<void> {
    if (this.byteCarry.length > 0) {
      throw new Error('echo_src_fir_worker_unaligned_pcm_tail');
    }

    await this.drainPcmCarry(true);
  }

  private async drainPcmCarry(force: boolean): Promise<void> {
    const frameByteSize = this.channels * 4;
    let pendingFrames = Math.floor(this.pcmCarry.length / frameByteSize);

    while (pendingFrames >= this.targetBatchFrames || (force && pendingFrames > 0)) {
      const batchFrames = force ? pendingFrames : this.targetBatchFrames;
      const batchBytes = batchFrames * frameByteSize;
      const batch = this.pcmCarry.subarray(0, batchBytes);
      this.pcmCarry = batchBytes < this.pcmCarry.length ? Buffer.from(this.pcmCarry.subarray(batchBytes)) : Buffer.alloc(0);
      await this.processPcmBatch(batch, batchFrames);
      pendingFrames = Math.floor(this.pcmCarry.length / frameByteSize);
    }
  }

  private async processPcmBatch(batch: Buffer, inputFrames: number): Promise<void> {
    const startedAt = performance.now();
    const requestCountBefore = this.requestCount;
    let input = readFloat32LeBuffer(batch);
    for (let stageIndex = 0; stageIndex < this.stages.length; stageIndex += 1) {
      input = await this.processStage(stageIndex, input);
    }
    this.push(writeFloat32LeBuffer(input));
    const elapsedMs = performance.now() - startedAt;
    this.recordMetrics(inputFrames, input.length / this.channels, elapsedMs, this.requestCount - requestCountBefore);
  }

  private async processStage(stageIndex: number, input: Float32Array): Promise<Float32Array> {
    const stage = this.stages[stageIndex]!;
    const upsampled = this.upsample(input, stage.upsampleFactor);
    const maxBlockSamples = Math.max(this.channels, this.maxBlockFrames * this.channels * stage.upsampleFactor);
    const outputs: Float32Array[] = [];
    let outputLength = 0;

    for (let offset = 0; offset < upsampled.length; offset += maxBlockSamples) {
      const block = upsampled.subarray(offset, Math.min(upsampled.length, offset + maxBlockSamples));
      const result = await this.processFirBlock(stageIndex, block);
      this.histories[stageIndex] = result.history;
      outputs.push(result.output);
      outputLength += result.output.length;
    }

    if (outputs.length === 1) {
      return outputs[0]!;
    }

    const output = new Float32Array(outputLength);
    let cursor = 0;
    outputs.forEach((chunk) => {
      output.set(chunk, cursor);
      cursor += chunk.length;
    });
    return output;
  }

  private async processFirBlock(stageIndex: number, block: Float32Array): Promise<EchoSrcFirWorkerResult> {
    const stage = this.stages[stageIndex]!;
    if (this.backendFallbackReason) {
      return this.processFirBlockCpu(stageIndex, block);
    }

    try {
      this.requestCount += 1;
      return await this.options.client.processFir({
        backend: this.options.backend,
        channels: this.channels,
        input: block,
        taps: stage.taps,
        history: this.histories[stageIndex]!,
      });
    } catch (error) {
      if (!this.options.fallbackToCpuOnError || this.options.backend !== 'cuda') {
        throw error;
      }

      const reason = error instanceof Error ? error.message : String(error);
      if (isEchoSrcFirWorkerCancellationReason(reason)) {
        throw error;
      }

      this.backendFallbackReason = reason || 'echo_src_cuda_worker_failed';
      this.options.onBackendFallback?.(this.backendFallbackReason);
      return this.processFirBlockCpu(stageIndex, block);
    }
  }

  private processFirBlockCpu(stageIndex: number, block: Float32Array): EchoSrcFirWorkerResult {
    const stage = this.stages[stageIndex]!;
    const result = processFirInterleavedFloat32Cpu(block, this.channels, stage.taps, {
      history: this.histories[stageIndex]!,
    });
    this.requestCount += 1;
    return {
      backend: 'cpu',
      output: result.output,
      history: result.state.history,
    };
  }

  private upsample(input: Float32Array, upsampleFactor: 1 | 2 | 4 | 8): Float32Array {
    if (upsampleFactor === 1) {
      return input;
    }

    const output = new Float32Array(input.length * upsampleFactor);
    const frameCount = input.length / this.channels;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const outputFrame = frame * upsampleFactor;
      for (let channel = 0; channel < this.channels; channel += 1) {
        output[(outputFrame * this.channels) + channel] = input[(frame * this.channels) + channel] * upsampleFactor;
      }
    }
    return output;
  }

  private recordMetrics(inputFrames: number, outputFrames: number, processMs: number, requestCount: number): void {
    this.batchCount += 1;
    this.totalProcessMs += processMs;
    this.maxProcessMs = Math.max(this.maxProcessMs, processMs);
    const audioMs = this.sourceSampleRate ? (inputFrames / this.sourceSampleRate) * 1000 : null;
    this.options.onMetrics?.({
      backend: this.backendFallbackReason ? 'cpu' : this.options.backend,
      requestCount: this.requestCount,
      lastRequestCount: requestCount,
      batchCount: this.batchCount,
      targetBatchFrames: this.targetBatchFrames,
      maxBlockFrames: this.maxBlockFrames,
      lastInputFrames: inputFrames,
      lastOutputFrames: outputFrames,
      lastProcessMs: processMs,
      averageProcessMs: this.totalProcessMs / this.batchCount,
      maxProcessMs: this.maxProcessMs,
      realtimeRatio: audioMs && processMs > 0 ? audioMs / processMs : null,
    });
  }
}
