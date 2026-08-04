import { Transform } from 'node:stream';
import { performance } from 'node:perf_hooks';
import type { TransformCallback } from 'node:stream';
import type { EchoSdmWorkerRequest, EchoSdmWorkerResult, EchoSrcFirWorkerBackend } from './EchoSrcCudaWorker';
import type { AudioSdmModulatorProfile, AudioSdmQualityProfile, AudioSdmTargetRate } from '../../shared/types/audio';

export const sdmBaseSampleRate = 2_822_400;
export const sdmBaseSampleRate48k = 3_072_000;

const sdmTargetMultipliers: Record<AudioSdmTargetRate, number> = {
  dsd64: 1,
  dsd128: 2,
  dsd256: 4,
  dsd512: 8,
};

const sdmModulatorProfiles: Record<AudioSdmQualityProfile, AudioSdmModulatorProfile> = {
  safe: {
    id: 'echo-sdm-ef1-safe',
    name: 'ECHO SDM EF1 Safe',
    order: 1,
    noiseShaper: '1st-order tone-safe direct error feedback',
    feedbackCoefficients: [0.95],
    ditherAmplitude: 0.0000005,
    inputLimit: 0.985,
    stabilityLimit: 3,
    recommendedHeadroomDb: 8,
  },
  hifi: {
    id: 'echo-sdm-ef1-hifi',
    name: 'ECHO SDM EF1 HiFi',
    order: 1,
    noiseShaper: '1st-order low-tonal direct error feedback',
    feedbackCoefficients: [1],
    ditherAmplitude: 0.0000002,
    inputLimit: 0.98,
    stabilityLimit: 3.25,
    recommendedHeadroomDb: 8,
  },
  reference: {
    id: 'echo-sdm-ef2-reference',
    name: 'ECHO SDM EF2 Reference',
    order: 2,
    noiseShaper: '2nd-order tone-safe direct error feedback',
    feedbackCoefficients: [1.2, -0.25],
    ditherAmplitude: 0.0000001,
    inputLimit: 0.975,
    stabilityLimit: 3.5,
    recommendedHeadroomDb: 9,
  },
  insane: {
    id: 'echo-sdm-ef2-insane',
    name: 'ECHO SDM EF2 Insane',
    order: 2,
    noiseShaper: '2nd-order aggressive low-tonal direct error feedback',
    feedbackCoefficients: [1.4, -0.45],
    ditherAmplitude: 0.00000005,
    inputLimit: 0.965,
    stabilityLimit: 3.75,
    recommendedHeadroomDb: 10,
  },
};

const resolveSdmBaseSampleRate = (sourceSampleRate?: number | null): number => {
  const rounded = Math.round(Number(sourceSampleRate));
  if (Number.isFinite(rounded) && rounded > 0 && rounded % 48000 === 0) {
    return sdmBaseSampleRate48k;
  }
  return sdmBaseSampleRate;
};

export const resolveSdmNativeSampleRate = (targetRate: AudioSdmTargetRate, sourceSampleRate?: number | null): number =>
  resolveSdmBaseSampleRate(sourceSampleRate) * sdmTargetMultipliers[targetRate];

export const resolveSdmDopTransportSampleRate = (targetRate: AudioSdmTargetRate, sourceSampleRate?: number | null): number =>
  Math.round(resolveSdmNativeSampleRate(targetRate, sourceSampleRate) / 16);

export const resolveSdmModulatorProfile = (qualityProfile: AudioSdmQualityProfile): AudioSdmModulatorProfile => {
  const profile = sdmModulatorProfiles[qualityProfile] ?? sdmModulatorProfiles.safe;
  return {
    ...profile,
    feedbackCoefficients: [...profile.feedbackCoefficients],
  };
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const dsdSilenceByte = 0x69;
const sdmIdleSilenceThreshold = 0.00012;
const sdmIdleLockThreshold = 0.00035;
const sdmIdleUnlockThreshold = 0.0009;
const sdmIdleLockFrames = 96;

const nextDither = (state: Uint32Array, channel: number, amplitude: number): number => {
  state[channel] = (Math.imul(state[channel] || 0x9e3779b9, 1664525) + 1013904223) >>> 0;
  return (((state[channel] / 0x100000000) - 0.5) * amplitude);
};

const readFloat32LeBuffer = (buffer: Buffer): Float32Array => {
  const samples = new Float32Array(buffer.length / Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT);
  }
  return samples;
};

const convertDop24LeToNativeDsdRaw = (dop: Buffer, channels: number): Buffer => {
  const frameBytes = channels * 3;
  const frames = Math.floor(dop.length / frameBytes);
  const output = Buffer.allocUnsafe(frames * channels * 2);

  for (let frame = 0; frame < frames; frame += 1) {
    const dopFrameOffset = frame * frameBytes;
    const nativeFrameOffset = frame * channels * 2;
    for (let channel = 0; channel < channels; channel += 1) {
      const dopOffset = dopFrameOffset + channel * 3;
      output[nativeFrameOffset + channel] = dop[dopOffset] ?? dsdSilenceByte;
      output[nativeFrameOffset + channels + channel] = dop[dopOffset + 1] ?? dsdSilenceByte;
    }
  }

  return output;
};

const defaultSdmMaxBlockFrames = 8192;

const isSdmWorkerCancellationReason = (reason: string): boolean =>
  reason === 'src_cuda_worker_disposed' ||
  reason === 'sdm_cuda_worker_disposed' ||
  reason === 'audio_session_run_cancelled';

export type PcmToDsdDoPTransformOptions = {
  channels: number;
  qualityProfile: AudioSdmQualityProfile;
  outputFormat?: 'dop24le' | 'dsd-native-raw';
  backend?: EchoSrcFirWorkerBackend;
  workerClient?: PcmToDsdDoPWorkerClientLike;
  fallbackToCpuOnError?: boolean;
  maxBlockFrames?: number;
  targetBatchFrames?: number;
  sourceSampleRate?: number | null;
  onBackendFallback?: (reason: string) => void;
  onMetrics?: (metrics: PcmToDsdDoPTransformMetrics) => void;
};

export type PcmToDsdDoPWorkerClientLike = {
  processSdm: (request: EchoSdmWorkerRequest) => Promise<EchoSdmWorkerResult>;
};

export type PcmToDsdDoPTransformMetrics = {
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

export class PcmToDsdDoPTransform extends Transform {
  private readonly channels: number;
  private readonly profile: AudioSdmModulatorProfile;
  private readonly feedbackCoefficients: number[];
  private readonly errorHistory: Float64Array;
  private readonly ditherState: Uint32Array;
  private readonly idleRunFrames: Uint32Array;
  private readonly idleLocked: Uint32Array;
  private readonly previousSamples: Float32Array;
  private readonly requestedBackend: EchoSrcFirWorkerBackend;
  private readonly outputFormat: 'dop24le' | 'dsd-native-raw';
  private readonly maxBlockFrames: number;
  private readonly targetBatchFrames: number;
  private readonly batchingEnabled: boolean;
  private readonly sourceSampleRate: number | null;
  private carry = Buffer.alloc(0);
  private pcmCarry = Buffer.alloc(0);
  private dopFrameIndex = 0;
  private backendFallbackReason: string | null = null;
  private requestCount = 0;
  private batchCount = 0;
  private totalProcessMs = 0;
  private maxProcessMs = 0;

  constructor(private readonly options: PcmToDsdDoPTransformOptions) {
    super();
    this.channels = Math.max(1, Math.min(2, Math.round(options.channels)));
    this.profile = resolveSdmModulatorProfile(options.qualityProfile);
    this.feedbackCoefficients = this.profile.feedbackCoefficients;
    this.errorHistory = new Float64Array(this.channels * this.feedbackCoefficients.length);
    this.ditherState = new Uint32Array(this.channels);
    this.idleRunFrames = new Uint32Array(this.channels);
    this.idleLocked = new Uint32Array(this.channels);
    this.previousSamples = new Float32Array(this.channels);
    this.requestedBackend = options.backend ?? 'cpu';
    this.outputFormat = options.outputFormat ?? 'dop24le';
    this.maxBlockFrames = Math.max(1, Math.round(options.maxBlockFrames ?? defaultSdmMaxBlockFrames));
    this.targetBatchFrames = Math.max(1, Math.round(options.targetBatchFrames ?? 1));
    this.batchingEnabled = this.requestedBackend === 'cuda' && this.targetBatchFrames > 1;
    this.sourceSampleRate = typeof options.sourceSampleRate === 'number' && Number.isFinite(options.sourceSampleRate) && options.sourceSampleRate > 0
      ? options.sourceSampleRate
      : null;
    for (let channel = 0; channel < this.channels; channel += 1) {
      this.ditherState[channel] = (0x9e3779b9 + channel * 0x85ebca6b) >>> 0;
    }
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
    const frameBytes = this.channels * Float32Array.BYTES_PER_ELEMENT;
    const input = this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk;
    const completeBytes = input.length - (input.length % frameBytes);
    this.carry = completeBytes < input.length ? Buffer.from(input.subarray(completeBytes)) : Buffer.alloc(0);

    if (completeBytes === 0) {
      return;
    }

    const completeInput = input.subarray(0, completeBytes);
    if (!this.batchingEnabled) {
      await this.processPcmBatch(completeInput, completeBytes / frameBytes);
      return;
    }

    this.pcmCarry = this.pcmCarry.length > 0
      ? Buffer.concat([this.pcmCarry, completeInput])
      : Buffer.from(completeInput);
    await this.drainPcmCarry(false);
  }

  private async flushPending(): Promise<void> {
    if (this.carry.length > 0) {
      throw new Error('pcm_to_dsd_unaligned_pcm_tail');
    }

    await this.drainPcmCarry(true);
  }

  private async drainPcmCarry(force: boolean): Promise<void> {
    const frameBytes = this.channels * Float32Array.BYTES_PER_ELEMENT;
    let pendingFrames = Math.floor(this.pcmCarry.length / frameBytes);

    while (pendingFrames >= this.targetBatchFrames || (force && pendingFrames > 0)) {
      const batchFrames = force ? pendingFrames : this.targetBatchFrames;
      const batchBytes = batchFrames * frameBytes;
      const batch = this.pcmCarry.subarray(0, batchBytes);
      this.pcmCarry = batchBytes < this.pcmCarry.length ? Buffer.from(this.pcmCarry.subarray(batchBytes)) : Buffer.alloc(0);
      await this.processPcmBatch(batch, batchFrames);
      pendingFrames = Math.floor(this.pcmCarry.length / frameBytes);
    }
  }

  private async processPcmBatch(batch: Buffer, inputFrames: number): Promise<void> {
    const startedAt = performance.now();
    const frameBytes = this.channels * Float32Array.BYTES_PER_ELEMENT;
    const requestCountBefore = this.requestCount;
    const outputs: Buffer[] = [];
    let outputFrames = 0;
    let backend: EchoSrcFirWorkerBackend = 'cpu';

    for (let frameOffset = 0; frameOffset < inputFrames; frameOffset += this.maxBlockFrames) {
      const blockFrames = Math.min(this.maxBlockFrames, inputFrames - frameOffset);
      const blockStart = frameOffset * frameBytes;
      const blockEnd = blockStart + blockFrames * frameBytes;
      const result = await this.convertFramesBlock(batch.subarray(blockStart, blockEnd), frameBytes);
      outputs.push(result.output);
      outputFrames += result.output.length / (this.channels * 3);
      backend = result.backend;
    }

    if (outputs.length === 1) {
      this.push(outputs[0]!);
    } else if (outputs.length > 1) {
      outputs.forEach((output) => this.push(output));
    }

    this.recordMetrics(
      backend,
      inputFrames,
      outputFrames,
      performance.now() - startedAt,
      this.requestCount - requestCountBefore,
    );
  }

  private async convertFramesBlock(input: Buffer, frameBytes: number): Promise<{ output: Buffer; backend: EchoSrcFirWorkerBackend }> {
    if (this.shouldUseWorker()) {
      try {
        return {
          output: await this.convertFramesWithWorker(input),
          backend: 'cuda',
        };
      } catch (error) {
        if (!this.options.fallbackToCpuOnError) {
          throw error;
        }

        const reason = error instanceof Error ? error.message : String(error);
        if (isSdmWorkerCancellationReason(reason)) {
          throw error;
        }

        this.backendFallbackReason = reason || 'sdm_cuda_worker_failed';
        this.options.onBackendFallback?.(this.backendFallbackReason);
      }
    }

    return {
      output: this.convertFramesCpu(input, frameBytes),
      backend: 'cpu',
    };
  }

  private shouldUseWorker(): boolean {
    return this.requestedBackend === 'cuda' && this.backendFallbackReason === null && Boolean(this.options.workerClient);
  }

  private async convertFramesWithWorker(input: Buffer): Promise<Buffer> {
    const workerClient = this.options.workerClient;
    if (!workerClient) {
      throw new Error('sdm_cuda_worker_missing');
    }

    this.requestCount += 1;
    const result = await workerClient.processSdm({
      backend: 'cuda',
      channels: this.channels,
      input: readFloat32LeBuffer(input),
      feedbackCoefficients: Float32Array.from(this.feedbackCoefficients),
      errorHistory: Float32Array.from(this.errorHistory),
      ditherState: Uint32Array.from(this.ditherState),
      idleRunFrames: Uint32Array.from(this.idleRunFrames),
      idleLocked: Uint32Array.from(this.idleLocked),
      previousSamples: Float32Array.from(this.previousSamples),
      dopFrameIndex: this.dopFrameIndex,
      ditherAmplitude: this.profile.ditherAmplitude,
      inputLimit: this.profile.inputLimit,
      stabilityLimit: this.profile.stabilityLimit,
    });
    this.applyWorkerState(result);
    const dopOutput = Buffer.from(result.output);
    return this.outputFormat === 'dsd-native-raw'
      ? convertDop24LeToNativeDsdRaw(dopOutput, this.channels)
      : dopOutput;
  }

  private applyWorkerState(result: EchoSdmWorkerResult): void {
    if (result.errorHistory.length === this.errorHistory.length) {
      for (let index = 0; index < result.errorHistory.length; index += 1) {
        this.errorHistory[index] = result.errorHistory[index]!;
      }
    }
    if (result.ditherState.length === this.ditherState.length) {
      this.ditherState.set(result.ditherState);
    }
    if (result.idleRunFrames?.length === this.idleRunFrames.length) {
      this.idleRunFrames.set(result.idleRunFrames);
    }
    if (result.idleLocked?.length === this.idleLocked.length) {
      this.idleLocked.set(result.idleLocked);
    }
    if (result.previousSamples?.length === this.previousSamples.length) {
      this.previousSamples.set(result.previousSamples);
    }
    this.dopFrameIndex = result.dopFrameIndex;
  }

  private convertFramesCpu(input: Buffer, frameBytes: number): Buffer {
    const frames = Math.floor(input.length / frameBytes);
    const output = Buffer.allocUnsafe(frames * this.channels * (this.outputFormat === 'dsd-native-raw' ? 2 : 3));
    let outputOffset = 0;

    for (let frame = 0; frame < frames; frame += 1) {
      const marker = (this.dopFrameIndex & 1) === 0 ? 0x05 : 0xfa;
      const frameOffset = frame * frameBytes;
      const nativeFrameOffset = frame * this.channels * 2;

      for (let channel = 0; channel < this.channels; channel += 1) {
        const sample = clamp(input.readFloatLE(frameOffset + channel * 4), -0.999, 0.999);
        const [firstByte, secondByte] = this.modulateSample(channel, sample);
        if (this.outputFormat === 'dsd-native-raw') {
          output[nativeFrameOffset + channel] = firstByte;
          output[nativeFrameOffset + this.channels + channel] = secondByte;
        } else {
          output[outputOffset] = firstByte;
          output[outputOffset + 1] = secondByte;
          output[outputOffset + 2] = marker;
          outputOffset += 3;
        }
      }

      this.dopFrameIndex += 1;
    }

    return output;
  }

  private resetChannelErrorHistory(channel: number): void {
    const base = channel * this.feedbackCoefficients.length;
    for (let index = 0; index < this.feedbackCoefficients.length; index += 1) {
      this.errorHistory[base + index] = 0;
    }
    this.previousSamples[channel] = 0;
  }

  private shouldEmitIdleSilence(channel: number, sample: number): boolean {
    const magnitude = Math.abs(sample);
    const wasLocked = this.idleLocked[channel] === 1;

    if (wasLocked) {
      if (magnitude < sdmIdleUnlockThreshold) {
        this.idleRunFrames[channel] = Math.min(sdmIdleLockFrames, (this.idleRunFrames[channel] ?? 0) + 1);
        this.resetChannelErrorHistory(channel);
        return true;
      }
      this.idleLocked[channel] = 0;
      this.idleRunFrames[channel] = 0;
      return false;
    }

    if (magnitude <= sdmIdleSilenceThreshold) {
      this.idleLocked[channel] = 1;
      this.idleRunFrames[channel] = sdmIdleLockFrames;
      this.resetChannelErrorHistory(channel);
      return true;
    }

    if (magnitude <= sdmIdleLockThreshold) {
      const runFrames = Math.min(sdmIdleLockFrames, (this.idleRunFrames[channel] ?? 0) + 1);
      this.idleRunFrames[channel] = runFrames;
      if (runFrames >= sdmIdleLockFrames) {
        this.idleLocked[channel] = 1;
        this.resetChannelErrorHistory(channel);
        return true;
      }
    } else {
      this.idleRunFrames[channel] = 0;
    }

    return false;
  }

  private recordMetrics(
    backend: EchoSrcFirWorkerBackend,
    inputFrames: number,
    outputFrames: number,
    processMs: number,
    lastRequestCount: number,
  ): void {
    this.totalProcessMs += processMs;
    this.batchCount += 1;
    this.maxProcessMs = Math.max(this.maxProcessMs, processMs);
    const sourceSampleRate = this.sourceSampleRate;
    const audioMs = sourceSampleRate ? (inputFrames / sourceSampleRate) * 1000 : null;
    this.options.onMetrics?.({
      backend,
      requestCount: this.requestCount,
      lastRequestCount,
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

  private modulateSample(channel: number, sample: number): [number, number] {
    let firstByte = 0;
    let secondByte = 0;
    const base = channel * this.feedbackCoefficients.length;
    const order = this.feedbackCoefficients.length;
    const clampedSample = clamp(sample, -this.profile.inputLimit, this.profile.inputLimit);
    if (this.shouldEmitIdleSilence(channel, clampedSample)) {
      return [dsdSilenceByte, dsdSilenceByte];
    }

    const previousSample = clamp(this.previousSamples[channel] ?? clampedSample, -this.profile.inputLimit, this.profile.inputLimit);
    for (let bit = 0; bit < 16; bit += 1) {
      const bitSample = previousSample + (clampedSample - previousSample) * ((bit + 1) / 16);
      let decision = bitSample + nextDither(this.ditherState, channel, this.profile.ditherAmplitude);
      for (let historyIndex = 0; historyIndex < order; historyIndex += 1) {
        decision += (this.feedbackCoefficients[historyIndex] ?? 0) * (this.errorHistory[base + historyIndex] ?? 0);
      }
      decision = clamp(decision, -this.profile.stabilityLimit, this.profile.stabilityLimit);

      const one = decision >= 0;
      const quantizationError = clamp(decision - (one ? 1 : -1), -this.profile.stabilityLimit, this.profile.stabilityLimit);
      for (let historyIndex = order - 1; historyIndex > 0; historyIndex -= 1) {
        this.errorHistory[base + historyIndex] = this.errorHistory[base + historyIndex - 1] ?? 0;
      }
      this.errorHistory[base] = quantizationError;

      if (one) {
        if (bit < 8) {
          firstByte |= 1 << bit;
        } else {
          secondByte |= 1 << (bit - 8);
        }
      }
    }

    this.previousSamples[channel] = clampedSample;
    return [firstByte, secondByte];
  }
}
