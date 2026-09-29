import { describe, expect, it } from 'vitest';
import type { AudioCudaRuntimeStatus } from '../../shared/types/audio';
import {
  analyzeEchoSrcFirTaps,
  createEchoSrcFirCompositeTaps,
  createEchoSrcFirPlan,
  createEchoSrcFirStagePlans,
  createEchoSrcFirState,
  createEchoSrcFirTaps,
  createWindowedSincLowpassTaps,
  getEchoSrcFirProfileSpec,
  processFirInterleavedFloat32Cpu,
  resolveEchoSrcFirBackendStatus,
} from './EchoSrcFirEngine';

const expectCloseArray = (actual: Float32Array, expected: number[], precision = 6): void => {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, precision);
  });
};

describe('EchoSrcFirEngine', () => {
  it('maps HQ-style filter profiles to deterministic FIR specs', () => {
    expect(getEchoSrcFirProfileSpec('poly-sinc-gauss-long')).toMatchObject({
      profile: 'poly-sinc-gauss-long',
      tapCount: 1023,
      window: 'gaussian',
      phase: 'linear',
      cutoffScale: 0.965,
    });
    expect(getEchoSrcFirProfileSpec('poly-sinc-ext2-xla').tapCount).toBeGreaterThan(
      getEchoSrcFirProfileSpec('poly-sinc-ext2-long').tapCount,
    );
    expect(getEchoSrcFirProfileSpec('poly-sinc-ext2-medium')).toMatchObject({
      profile: 'poly-sinc-ext2-medium',
      tapCount: 767,
      window: 'blackman-harris',
      phase: 'linear',
    });
    expect(getEchoSrcFirProfileSpec('poly-sinc-gauss-hires-mp')).toMatchObject({
      profile: 'poly-sinc-gauss-hires-mp',
      tapCount: 1023,
      window: 'gaussian',
      phase: 'minimum',
    });
    expect(getEchoSrcFirProfileSpec('poly-sinc-xtr-short-mp')).toMatchObject({
      profile: 'poly-sinc-xtr-short-mp',
      tapCount: 767,
      window: 'kaiser',
      phase: 'minimum',
    });
    expect(getEchoSrcFirProfileSpec('poly-sinc-gauss-xl')).toMatchObject({
      profile: 'poly-sinc-gauss-xl',
      tapCount: 3071,
      window: 'gaussian',
      phase: 'linear',
    });
    expect(getEchoSrcFirProfileSpec('poly-sinc-xtr-xla')).toMatchObject({
      profile: 'poly-sinc-xtr-xla',
      tapCount: 3071,
      phase: 'minimum',
    });
    expect(getEchoSrcFirProfileSpec('minringFIR-lp').phase).toBe('minimum');
    expect(getEchoSrcFirProfileSpec('minringFIR-mp')).toMatchObject({
      profile: 'minringFIR-mp',
      tapCount: 1023,
      window: 'kaiser',
      phase: 'minimum',
      attenuationDb: 145,
      cutoffScale: 0.93,
    });
    expect(getEchoSrcFirProfileSpec('apod-fast')).toMatchObject({
      profile: 'apod-fast',
      tapCount: 767,
      window: 'kaiser',
      phase: 'linear',
      cutoffScale: 0.9,
    });
    expect(getEchoSrcFirProfileSpec('apod-minring')).toMatchObject({
      profile: 'apod-minring',
      tapCount: 1535,
      window: 'kaiser',
      phase: 'minimum',
      cutoffScale: 0.875,
    });
    expect(getEchoSrcFirProfileSpec('sinc-L').tapCount).toBeGreaterThan(getEchoSrcFirProfileSpec('sinc-M').tapCount);
    expect(getEchoSrcFirProfileSpec('sinc-xla').tapCount).toBeGreaterThan(getEchoSrcFirProfileSpec('sinc-long').tapCount);
  });

  it('creates normalized low-pass taps for upsampling plans', () => {
    const plan = createEchoSrcFirPlan('poly-sinc-gauss-long', 44100, 352800);
    const taps = createEchoSrcFirTaps(plan);
    const sum = taps.reduce((total, value) => total + value, 0);

    expect(plan.normalizedCutoff).toBeCloseTo(0.057296875, 5);
    expect(taps.length).toBe(1023);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('gives transparent, soft, and minimum-ringing filters distinct real rolloff plans', () => {
    const ext2Plan = createEchoSrcFirPlan('poly-sinc-ext2-long', 44100, 352800);
    const gaussPlan = createEchoSrcFirPlan('poly-sinc-gauss-long', 44100, 352800);
    const minringPlan = createEchoSrcFirPlan('minringFIR-mp', 44100, 352800);
    const ext2Analysis = analyzeEchoSrcFirTaps(ext2Plan, createEchoSrcFirTaps(ext2Plan));
    const gaussAnalysis = analyzeEchoSrcFirTaps(gaussPlan, createEchoSrcFirTaps(gaussPlan));
    const minringAnalysis = analyzeEchoSrcFirTaps(minringPlan, createEchoSrcFirTaps(minringPlan));

    expect(ext2Plan.normalizedCutoff).toBeGreaterThan(gaussPlan.normalizedCutoff);
    expect(gaussPlan.normalizedCutoff).toBeGreaterThan(minringPlan.normalizedCutoff);
    expect(ext2Analysis.peakIndex).toBe((ext2Plan.tapCount - 1) / 2);
    expect(gaussAnalysis.peakIndex).toBe((gaussPlan.tapCount - 1) / 2);
    expect(minringAnalysis.peakIndex).toBeLessThan(gaussAnalysis.peakIndex / 10);
    expect(ext2Analysis.stopbandPeakDb).toBeLessThan(-80);
    expect(gaussAnalysis.stopbandPeakDb).toBeLessThan(-80);
    expect(minringAnalysis.stopbandPeakDb).toBeLessThan(-80);
  });

  it('uses apodizing profiles with earlier cutoff for audible source-ringing cleanup', () => {
    const transparentPlan = createEchoSrcFirPlan('poly-sinc-ext2-long', 44100, 352800);
    const apodFastPlan = createEchoSrcFirPlan('apod-fast', 44100, 352800);
    const apodLongPlan = createEchoSrcFirPlan('apod-long', 44100, 352800);
    const apodMinringPlan = createEchoSrcFirPlan('apod-minring', 44100, 352800);
    const apodFastAnalysis = analyzeEchoSrcFirTaps(apodFastPlan, createEchoSrcFirTaps(apodFastPlan));
    const apodLongAnalysis = analyzeEchoSrcFirTaps(apodLongPlan, createEchoSrcFirTaps(apodLongPlan));
    const apodMinringAnalysis = analyzeEchoSrcFirTaps(apodMinringPlan, createEchoSrcFirTaps(apodMinringPlan));

    expect(apodFastPlan.normalizedCutoff).toBeLessThan(transparentPlan.normalizedCutoff);
    expect(apodLongPlan.normalizedCutoff).toBeLessThan(apodFastPlan.normalizedCutoff);
    expect(apodMinringPlan.normalizedCutoff).toBeLessThan(apodFastPlan.normalizedCutoff);
    expect(apodLongPlan.tapCount).toBeGreaterThan(apodFastPlan.tapCount);
    expect(apodMinringAnalysis.peakIndex).toBeLessThan(apodFastAnalysis.peakIndex / 8);
    expect(apodFastAnalysis.stopbandPeakDb).toBeLessThan(-70);
    expect(apodLongAnalysis.stopbandPeakDb).toBeLessThan(-80);
    expect(apodMinringAnalysis.stopbandPeakDb).toBeLessThan(-70);
  });

  it('plans staged 2x FIR chains for higher-ratio SRC', () => {
    const stagePlans = createEchoSrcFirStagePlans('poly-sinc-gauss-long', 44100, 352800);
    const mixedStagePlans = createEchoSrcFirStagePlans('poly-sinc-gauss-long', 44100, 352800, {
      resolveProfile: (stageSourceRate) => (stageSourceRate < 50_000 ? 'poly-sinc-gauss-long' : 'poly-sinc-hb'),
    });
    const compositeTaps = createEchoSrcFirCompositeTaps(
      stagePlans.map((stage) => ({
        taps: createEchoSrcFirTaps(stage.plan),
        upsampleFactor: stage.upsampleFactor,
      })),
    );
    const analysis = analyzeEchoSrcFirTaps(createEchoSrcFirPlan('poly-sinc-gauss-long', 44100, 352800), compositeTaps);

    expect(stagePlans.map((stage) => [stage.plan.sourceSampleRate, stage.plan.targetSampleRate])).toEqual([
      [44100, 88200],
      [88200, 176400],
      [176400, 352800],
    ]);
    expect(mixedStagePlans.map((stage) => stage.plan.profile)).toEqual([
      'poly-sinc-gauss-long',
      'poly-sinc-hb',
      'poly-sinc-hb',
    ]);
    expect(compositeTaps.length).toBeGreaterThan(stagePlans[0]!.plan.tapCount);
    expect(analysis.dcGain).toBeCloseTo(1, 4);
    expect(analysis.stopbandPeakDb).toBeLessThan(-60);
  });

  it('turns minimum-phase profiles into front-loaded FIR impulses', () => {
    const linearPlan = createEchoSrcFirPlan('poly-sinc-gauss-long', 44100, 352800);
    const minimumPlan = createEchoSrcFirPlan('poly-sinc-gauss-hires-mp', 44100, 352800);
    const linearTaps = createEchoSrcFirTaps(linearPlan);
    const minimumTaps = createEchoSrcFirTaps(minimumPlan);
    const linear = analyzeEchoSrcFirTaps(linearPlan, linearTaps);
    const minimum = analyzeEchoSrcFirTaps(minimumPlan, minimumTaps);

    expect(linear.peakIndex).toBe((linearTaps.length - 1) / 2);
    expect(linear.energyCentroid).toBeCloseTo(linear.peakIndex, 3);
    expect(minimum.peakIndex).toBeLessThan(linear.peakIndex / 10);
    expect(minimum.energyCentroid).toBeLessThan(linear.energyCentroid / 10);
    expect(minimum.dcGain).toBeCloseTo(1, 5);
    expect(minimum.stopbandPeakDb).toBeLessThan(-80);
    expect(Math.abs(minimumTaps[0]! - minimumTaps[minimumTaps.length - 1]!)).toBeGreaterThan(1e-6);
  });

  it('keeps an impulse response equal to the FIR taps on mono PCM', () => {
    const taps = createWindowedSincLowpassTaps({
      tapCount: 5,
      normalizedCutoff: 0.25,
      window: 'hann',
    });
    const input = new Float32Array([1, 0, 0, 0, 0]);
    const result = processFirInterleavedFloat32Cpu(input, 1, taps);

    expectCloseArray(result.output, Array.from(taps));
  });

  it('preserves interleaved channel independence and streaming history', () => {
    const taps = new Float32Array([0.5, 0.25, 0.25]);
    const first = new Float32Array([1, 10, 2, 20]);
    const second = new Float32Array([3, 30]);
    const firstResult = processFirInterleavedFloat32Cpu(first, 2, taps, createEchoSrcFirState(2, taps));
    const secondResult = processFirInterleavedFloat32Cpu(second, 2, taps, firstResult.state);

    expectCloseArray(firstResult.output, [0.5, 5, 1.25, 12.5]);
    expectCloseArray(secondResult.output, [2.25, 22.5]);
  });

  it('reports CUDA as unavailable until the worker is built with CUDA', () => {
    const cudaRuntime: AudioCudaRuntimeStatus = {
      available: true,
      source: 'nvidia-smi',
      deviceName: 'NVIDIA GeForce RTX 5070 Ti',
      driverVersion: '610.47',
      cudaVersion: '13.3',
      error: null,
    };
    const cudaWorker = {
      available: false,
      path: 'G:\\ECHODev\\electron-app\\build\\echo-src-cuda-worker.exe',
      protocol: 1,
      cudaBuilt: false,
      error: 'src_cuda_worker_built_without_cuda',
    };

    expect(resolveEchoSrcFirBackendStatus('cpu', cudaRuntime, cudaWorker)).toMatchObject({
      backend: 'cpu',
      available: true,
      active: true,
      reason: null,
    });
    expect(resolveEchoSrcFirBackendStatus('cuda', cudaRuntime, cudaWorker)).toMatchObject({
      backend: 'cuda',
      available: false,
      active: false,
      reason: 'src_cuda_worker_built_without_cuda',
      cudaRuntime,
      cudaWorker,
    });
    expect(resolveEchoSrcFirBackendStatus('cuda', cudaRuntime, {
      ...cudaWorker,
      available: true,
      cudaBuilt: true,
      error: null,
    })).toMatchObject({
      backend: 'cuda',
      available: true,
      active: true,
      reason: null,
    });
  });
});
