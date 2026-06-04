import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChannelBalanceState } from '../../shared/types/audio';
import type { EqState } from '../../shared/types/eq';
import {
  PcmLevelMeterTransform,
  audioLevelMeterTestHooks,
  computeDspEstimatedGainDb,
  createAudioLevelTelemetry,
  type PcmLevelSnapshot,
} from './AudioLevelMeter';

const pcmBuffer = (samples: number[]): Buffer => {
  const buffer = Buffer.alloc(samples.length * 4);
  samples.forEach((sample, index) => {
    buffer.writeFloatLE(sample, index * 4);
  });
  return buffer;
};

const runMeter = async (
  samples: number[],
  options: { channels?: number; maxObservedSamplesPerChunk?: number; sampleRateHz?: number; visualSpectrumEnabled?: boolean } = {},
): Promise<{ snapshot: PcmLevelSnapshot; output: Buffer }> => {
  let snapshot: PcmLevelSnapshot | null = null;
  const meter = new PcmLevelMeterTransform((nextSnapshot) => {
    snapshot = nextSnapshot;
  }, 0, options.maxObservedSamplesPerChunk, options.sampleRateHz, options.channels, options.visualSpectrumEnabled ?? true);
  const outputChunks: Buffer[] = [];
  meter.on('data', (chunk: Buffer) => outputChunks.push(Buffer.from(chunk)));
  const input = pcmBuffer(samples);

  meter.end(input);
  await once(meter, 'end');

  return {
    snapshot: snapshot ?? meter.getSnapshot(),
    output: Buffer.concat(outputChunks),
  };
};

const runMeterChunks = async (
  chunks: number[][],
  options: { channels?: number; maxObservedSamplesPerChunk?: number; sampleRateHz?: number; visualSpectrumEnabled?: boolean } = {},
): Promise<{ snapshots: PcmLevelSnapshot[]; output: Buffer }> => {
  const snapshots: PcmLevelSnapshot[] = [];
  const meter = new PcmLevelMeterTransform((nextSnapshot) => {
    snapshots.push(nextSnapshot);
  }, 0, options.maxObservedSamplesPerChunk, options.sampleRateHz, options.channels, options.visualSpectrumEnabled ?? true);
  const outputChunks: Buffer[] = [];
  meter.on('data', (chunk: Buffer) => outputChunks.push(Buffer.from(chunk)));

  chunks.forEach((chunk) => meter.write(pcmBuffer(chunk)));
  meter.end();
  await once(meter, 'end');

  return { snapshots, output: Buffer.concat(outputChunks) };
};

const sineSamples = (frequencyHz: number, sampleRateHz = 44100, frameCount = 2048, channels = 1, amplitude = 0.8): number[] => {
  const samples: number[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const value = Math.sin((2 * Math.PI * frequencyHz * frame) / sampleRateHz) * amplitude;
    for (let channel = 0; channel < channels; channel += 1) {
      samples.push(value);
    }
  }
  return samples;
};

const chordSamples = (frequenciesHz: number[], sampleRateHz = 44100, frameCount = 2048, channels = 1, amplitude = 0.8): number[] => {
  const samples: number[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const value =
      frequenciesHz.reduce((sum, frequencyHz, index) => sum + Math.sin((2 * Math.PI * frequencyHz * frame) / sampleRateHz) * (1 - index * 0.08), 0) *
      (amplitude / frequenciesHz.length);
    for (let channel = 0; channel < channels; channel += 1) {
      samples.push(value);
    }
  }
  return samples;
};

const eqState = (overrides: Partial<EqState> = {}): EqState => ({
  enabled: false,
  preampDb: 0,
  presetId: 'flat',
  presetName: 'Flat',
  clippingRisk: false,
  bands: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((frequencyHz) => ({
    frequencyHz,
    gainDb: 0,
    q: 1,
    filterType: 'peaking' as const,
    enabled: true,
  })),
  ...overrides,
});

const channelBalanceState = (overrides: Partial<ChannelBalanceState> = {}): ChannelBalanceState => ({
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: true,
  clippingRisk: false,
  ...overrides,
});

afterEach(() => {
  audioLevelMeterTestHooks.setDebugHooks(null);
});

describe('AudioLevelMeter', () => {
  it('computes peak and RMS for float32 PCM without changing bytes', async () => {
    const input = pcmBuffer([0.5, -0.25]);
    const result = await runMeter([0.5, -0.25]);

    expect(result.snapshot.inputPeakDb).toBe(-6);
    expect(result.snapshot.inputRmsDb).toBe(-8.1);
    expect(result.snapshot.clipCount).toBe(0);
    expect(result.output.equals(input)).toBe(true);
  });

  it('returns null levels for silence without throwing', async () => {
    const result = await runMeter([0, 0, 0, 0]);

    expect(result.snapshot.inputPeakDb).toBeNull();
    expect(result.snapshot.inputRmsDb).toBeNull();
    expect(result.snapshot.clipCount).toBe(0);
    expect(result.snapshot.visualSpectrum.every((value) => value === 0)).toBe(true);
  });

  it('computes a low-frequency visual spectrum bucket from PCM samples', async () => {
    const result = await runMeterChunks(Array.from({ length: 8 }, () => sineSamples(110)), { channels: 1, sampleRateHz: 44100 });
    const snapshot = result.snapshots.at(-1)!;

    const lowBand = Math.max(...snapshot.visualSpectrum.slice(0, 6));
    const highBand = Math.max(...snapshot.visualSpectrum.slice(22));

    expect(snapshot.visualSpectrum).toHaveLength(32);
    expect(snapshot.visualSpectrumVersion).toBe(2);
    expect(snapshot.visualTelemetryState).toBe('pcm');
    expect(lowBand).toBeGreaterThan(0.38);
    expect(lowBand).toBeGreaterThan(highBand);
  });

  it('computes a high-frequency visual spectrum bucket from PCM samples', async () => {
    const result = await runMeterChunks(Array.from({ length: 8 }, () => sineSamples(9000)), { channels: 1, sampleRateHz: 44100 });
    const snapshot = result.snapshots.at(-1)!;

    const lowBand = Math.max(...snapshot.visualSpectrum.slice(0, 6));
    const highBand = Math.max(...snapshot.visualSpectrum.slice(22));

    expect(snapshot.visualSpectrum).toHaveLength(32);
    expect(snapshot.visualTelemetryState).toBe('pcm');
    expect(highBand).toBeGreaterThan(0.38);
    expect(highBand).toBeGreaterThan(lowBand);
  });

  it('keeps multi-band visual spectrum separated instead of fully saturated', async () => {
    const result = await runMeterChunks(Array.from({ length: 8 }, () => chordSamples([90, 220, 520, 1600, 4200, 9800])), { channels: 1, sampleRateHz: 44100 });
    const snapshot = result.snapshots.at(-1)!;
    const activeBands = snapshot.visualSpectrum.filter((value) => value > 0.08);
    const minActiveBand = Math.min(...activeBands);
    const maxBand = Math.max(...snapshot.visualSpectrum);

    expect(snapshot.visualSpectrum).toHaveLength(32);
    expect(activeBands.length).toBeGreaterThan(6);
    expect(activeBands.length).toBeLessThan(30);
    expect(maxBand - minActiveBand).toBeGreaterThan(0.18);
  });

  it('keeps visual spectrum amplitude tied to PCM loudness', async () => {
    const quiet = await runMeterChunks(Array.from({ length: 8 }, () => sineSamples(440, 44100, 2048, 1, 0.005)), { channels: 1, sampleRateHz: 44100 });
    const loud = await runMeterChunks(Array.from({ length: 8 }, () => sineSamples(440, 44100, 2048, 1, 0.8)), { channels: 1, sampleRateHz: 44100 });
    const quietSnapshot = quiet.snapshots.at(-1)!;
    const loudSnapshot = loud.snapshots.at(-1)!;

    expect(loudSnapshot.visualEnergy).toBeGreaterThan(quietSnapshot.visualEnergy);
    expect(Math.max(...loudSnapshot.visualSpectrum)).toBeGreaterThan(Math.max(...quietSnapshot.visualSpectrum));
  });

  it('raises visual transient on a sudden PCM energy increase', async () => {
    const snapshots: PcmLevelSnapshot[] = [];
    const meter = new PcmLevelMeterTransform((nextSnapshot) => {
      snapshots.push(nextSnapshot);
    }, 0, undefined, 44100, 1, true);
    meter.resume();

    meter.write(pcmBuffer(sineSamples(440, 44100, 2048, 1, 0.04)));
    meter.write(pcmBuffer(sineSamples(440, 44100, 2048, 1, 0.8)));
    meter.end();
    await once(meter, 'end');

    expect(snapshots.at(-1)?.visualTransient ?? 0).toBeGreaterThan(snapshots[0]?.visualTransient ?? 0);
  });

  it('ramps visual telemetry from priming to stable PCM over the first snapshots', async () => {
    const snapshots: PcmLevelSnapshot[] = [];
    const meter = new PcmLevelMeterTransform((nextSnapshot) => {
      snapshots.push(nextSnapshot);
    }, 0, undefined, 44100, 1, true);
    meter.resume();

    for (let index = 0; index < 8; index += 1) {
      meter.write(pcmBuffer(sineSamples(440, 44100, 2048, 1, 0.8)));
    }
    meter.end();
    await once(meter, 'end');

    expect(snapshots[0]?.visualTelemetryState).toBe('priming');
    expect(snapshots.at(-1)?.visualTelemetryState).toBe('pcm');
    expect(Math.max(...(snapshots[0]?.visualSpectrum ?? []))).toBeLessThan(Math.max(...(snapshots.at(-1)?.visualSpectrum ?? [])));
  });

  it('limits visual spectrum jumps between adjacent snapshots', async () => {
    const result = await runMeterChunks(
      [
        sineSamples(110, 44100, 2048, 1, 0.8),
        sineSamples(9000, 44100, 2048, 1, 0.8),
        sineSamples(110, 44100, 2048, 1, 0.8),
      ],
      { channels: 1, sampleRateHz: 44100 },
    );

    const maxAdjacentDelta = Math.max(
      ...result.snapshots.slice(1).flatMap((snapshot, snapshotIndex) =>
        snapshot.visualSpectrum.map((value, bandIndex) => Math.abs(value - (result.snapshots[snapshotIndex]?.visualSpectrum[bandIndex] ?? 0)))),
    );

    expect(maxAdjacentDelta).toBeLessThanOrEqual(0.085);
  });

  it('tracks clipping samples and last clip timestamp', async () => {
    const result = await runMeter([1, -1.1, 0.2]);

    expect(result.snapshot.clipCount).toBe(2);
    expect(result.snapshot.lastClipAt).toEqual(expect.any(String));
  });

  it('samples large chunks without changing playback bytes', async () => {
    const samples = [0.1, 0.2, 1.2, 0.3, 0.4];
    const input = pcmBuffer(samples);
    const result = await runMeter(samples, { maxObservedSamplesPerChunk: 3 });

    expect(result.snapshot.inputPeakDb).toBe(1.6);
    expect(result.snapshot.clipCount).toBe(1);
    expect(result.output.equals(input)).toBe(true);
  });

  it('caps spectrum analysis to one FFT window for oversized chunks without changing bytes', async () => {
    const samples = sineSamples(440, 44100, 2048 * 4, 1, 0.8);
    const input = pcmBuffer(samples);
    const result = await runMeter(samples, { channels: 1, sampleRateHz: 44100 });

    expect(result.output.equals(input)).toBe(true);
    expect(result.snapshot.visualSpectrum).toHaveLength(32);
    expect(Math.max(...result.snapshot.visualSpectrum)).toBeLessThanOrEqual(1);
  });

  it('can disable visual spectrum analysis while preserving level metering and bytes', async () => {
    const snapshots: PcmLevelSnapshot[] = [];
    const hooks = {
      computeVisualAnalysis: vi.fn(),
      fftInPlace: vi.fn(),
    };
    audioLevelMeterTestHooks.setDebugHooks(hooks);
    const samples = sineSamples(440, 44100, 2048, 1, 0.8);
    const input = pcmBuffer(samples);
    const meter = new PcmLevelMeterTransform((nextSnapshot) => {
      snapshots.push(nextSnapshot);
    }, 0, undefined, 44100, 1, false);
    const outputChunks: Buffer[] = [];
    meter.on('data', (chunk: Buffer) => outputChunks.push(Buffer.from(chunk)));

    meter.end(input);
    await once(meter, 'end');

    expect(Buffer.concat(outputChunks).equals(input)).toBe(true);
    expect(snapshots.at(-1)?.inputPeakDb).not.toBeNull();
    expect(snapshots.at(-1)?.visualSpectrum).toHaveLength(32);
    expect(snapshots.at(-1)?.visualSpectrum.every((value) => value === 0)).toBe(true);
    expect(snapshots.at(-1)?.visualEnergy).toBe(0);
    expect(snapshots.at(-1)?.visualTransient).toBe(0);
    expect(hooks.computeVisualAnalysis).not.toHaveBeenCalled();
    expect(hooks.fftInPlace).not.toHaveBeenCalled();
  });

  it('adds conservative EQ and channel balance gain to the output estimate', () => {
    const eq = eqState({
      enabled: true,
      preampDb: -4,
      bands: eqState().bands.map((band, index) => (index === 5 ? { ...band, gainDb: 6 } : band)),
    });
    const channelBalance = channelBalanceState({ enabled: true, rightGainDb: 2 });

    expect(computeDspEstimatedGainDb(eq, channelBalance)).toBe(4);
    expect(
      createAudioLevelTelemetry(
        {
          inputPeakDb: -5,
          inputRmsDb: -18,
          visualSpectrum: [],
          visualSpectrumVersion: 2,
          visualEnergy: 0,
          visualTransient: 0,
          visualTelemetryState: 'fallback',
          clipCount: 0,
          lastClipAt: null,
          levelMeterObserveCostMs: 0,
          visualSpectrumComputeCostMs: 0,
        },
        eq,
        channelBalance,
      ),
    ).toMatchObject({
      estimatedOutputPeakDb: -1,
      estimatedOutputRmsDb: -14,
      headroomDb: 1,
      visualSpectrumVersion: 2,
      visualTelemetryState: 'fallback',
    });
  });

  it('ignores bypassed EQ bands when estimating DSP output gain', () => {
    const eq = eqState({
      enabled: true,
      preampDb: -2,
      bands: eqState().bands.map((band, index) => (index === 5 ? { ...band, gainDb: 10, enabled: false } : band)),
    });

    expect(computeDspEstimatedGainDb(eq, channelBalanceState())).toBe(-2);
  });
});
