import { describe, expect, it } from 'vitest';
import {
  analyzeAudioSpectrumSamples,
  selectBestAudioSpectrumProbeResult,
  type AudioAuthenticitySpectrumProbeResult,
} from './AudioAuthenticitySpectrumProbe';

const sampleRate = 192_000;

const signal = (components: Array<{ frequency: number; amplitude: number }>, seconds = 1): Float32Array => {
  const samples = new Float32Array(Math.round(sampleRate * seconds));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    let value = 0;
    for (const component of components) {
      value += component.amplitude * Math.sin(2 * Math.PI * component.frequency * time);
    }
    samples[index] = value;
  }

  return samples;
};

const result = (overrides: Partial<AudioAuthenticitySpectrumProbeResult>): AudioAuthenticitySpectrumProbeResult => ({
  status: 'ready',
  decodeSampleRate: sampleRate,
  analyzedDurationSeconds: 4,
  selectedStartSeconds: 0,
  probeWindowCount: 3,
  rmsDb: -18,
  upperTrebleToAudibleDb: -30,
  lowUltrasonicToAudibleDb: -32,
  highFrequencyToAudibleDb: -28,
  ultrasonicToAudibleDb: -30,
  topBandToAudibleDb: -35,
  spectralCutoffHz: null,
  brickwallLikely: false,
  pcmBandwidthCutoffLikely: false,
  dsdUltrasonicNoiseLikely: false,
  error: null,
  ...overrides,
});

describe('AudioAuthenticitySpectrumProbe', () => {
  it('detects a hard CD-bandwidth brickwall in high-rate decoded audio', () => {
    const result = analyzeAudioSpectrumSamples(signal([
      { frequency: 1_000, amplitude: 0.35 },
      { frequency: 8_000, amplitude: 0.12 },
    ]), sampleRate);

    expect(result.status).toBe('ready');
    expect(result.brickwallLikely).toBe(true);
    expect(result.spectralCutoffHz).toBeLessThanOrEqual(26_000);
  });

  it('detects noise-shaped PCM-to-DSD when music-band energy is missing above the PCM cutoff', () => {
    const result = analyzeAudioSpectrumSamples(signal([
      { frequency: 1_000, amplitude: 0.35 },
      { frequency: 6_000, amplitude: 0.12 },
      { frequency: 60_000, amplitude: 0.05 },
    ]), sampleRate);

    expect(result.status).toBe('ready');
    expect(result.brickwallLikely).toBe(false);
    expect(result.dsdUltrasonicNoiseLikely).toBe(true);
    expect(result.pcmBandwidthCutoffLikely).toBe(true);
  });

  it('detects PCM-to-DSD when upper treble remains but low ultrasonic content drops out', () => {
    const result = analyzeAudioSpectrumSamples(signal([
      { frequency: 1_000, amplitude: 0.35 },
      { frequency: 20_000, amplitude: 0.08 },
      { frequency: 60_000, amplitude: 0.05 },
    ]), sampleRate);

    expect(result.status).toBe('ready');
    expect(result.dsdUltrasonicNoiseLikely).toBe(true);
    expect(result.pcmBandwidthCutoffLikely).toBe(true);
    expect(result.spectralCutoffHz).toBeLessThanOrEqual(30_000);
  });

  it('does not classify DSD-like ultrasonic energy as PCM cutoff when the upper band is continuous', () => {
    const result = analyzeAudioSpectrumSamples(signal([
      { frequency: 1_000, amplitude: 0.35 },
      { frequency: 20_000, amplitude: 0.08 },
      { frequency: 26_000, amplitude: 0.07 },
      { frequency: 60_000, amplitude: 0.05 },
    ]), sampleRate);

    expect(result.status).toBe('ready');
    expect(result.dsdUltrasonicNoiseLikely).toBe(true);
    expect(result.pcmBandwidthCutoffLikely).toBe(false);
  });

  it('selects the diagnostic DSD risk window over a quiet or merely supportive window', () => {
    const quiet = result({ status: 'too_quiet', rmsDb: -70, selectedStartSeconds: 12 });
    const supportive = result({ dsdUltrasonicNoiseLikely: true, selectedStartSeconds: 48 });
    const risk = result({
      selectedStartSeconds: 96,
      dsdUltrasonicNoiseLikely: true,
      pcmBandwidthCutoffLikely: true,
      upperTrebleToAudibleDb: -58,
      lowUltrasonicToAudibleDb: -61,
    });

    expect(selectBestAudioSpectrumProbeResult([quiet, supportive, risk], true)).toMatchObject({
      selectedStartSeconds: 96,
      pcmBandwidthCutoffLikely: true,
    });
  });

  it('selects a brickwall window for hi-res even when another window has weak high-band content', () => {
    const weak = result({ highFrequencyToAudibleDb: -58, selectedStartSeconds: 32 });
    const brickwall = result({
      selectedStartSeconds: 84,
      brickwallLikely: true,
      spectralCutoffHz: 22_000,
      highFrequencyToAudibleDb: -72,
      topBandToAudibleDb: -80,
    });

    expect(selectBestAudioSpectrumProbeResult([weak, brickwall], false, true)).toMatchObject({
      selectedStartSeconds: 84,
      brickwallLikely: true,
    });
  });

  it('selects upper-treble evidence over CD-bandwidth brickwall for standard lossless probes', () => {
    const lowpass = result({
      selectedStartSeconds: 32,
      spectralCutoffHz: 18_000,
      upperTrebleToAudibleDb: -66,
      brickwallLikely: true,
    });
    const upperTreblePresent = result({
      selectedStartSeconds: 84,
      spectralCutoffHz: 22_000,
      upperTrebleToAudibleDb: -28,
      brickwallLikely: true,
    });

    expect(selectBestAudioSpectrumProbeResult([lowpass, upperTreblePresent], false, false)).toMatchObject({
      selectedStartSeconds: 84,
      upperTrebleToAudibleDb: -28,
    });
  });
});
