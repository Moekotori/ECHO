import { describe, expect, it } from 'vitest';
import type { LibraryTrack } from '../../shared/types/library';
import { AudioAuthenticityAnalyzer } from './AudioAuthenticityAnalyzer';

type AnalyzerDependencies = ConstructorParameters<typeof AudioAuthenticityAnalyzer>[0];

const createAnalyzer = (dependencies: AnalyzerDependencies = {}): AudioAuthenticityAnalyzer =>
  new AudioAuthenticityAnalyzer({
    probeSpectrum: async () => null,
    ...dependencies,
  });

const track = (overrides: Partial<LibraryTrack>): LibraryTrack => ({
  id: 'track-1',
  mediaType: 'local',
  path: 'D:\\Music\\Song.flac',
  sourceId: null,
  provider: null,
  providerTrackId: null,
  remotePath: null,
  stableKey: 'track-1',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 180,
  codec: 'FLAC',
  sampleRate: 44_100,
  bitDepth: 16,
  bitrate: 920_000,
  bpm: null,
  coverId: null,
  coverThumb: null,
  metadataStatus: 'complete',
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
  unavailable: false,
  ...overrides,
} as LibraryTrack);

describe('AudioAuthenticityAnalyzer', () => {
  it('marks normal lossless containers as trusted with explicit evidence', async () => {
    const analyzer = createAnalyzer({
      now: () => new Date('2026-06-06T00:00:00.000Z'),
      existsSync: () => false,
    });

    await expect(analyzer.analyzeTrack(track({}))).resolves.toMatchObject({
      trackId: 'track-1',
      analyzedAt: '2026-06-06T00:00:00.000Z',
      status: 'ready',
      verdict: 'trusted_lossless',
      metrics: {
        codec: 'FLAC',
        extension: '.flac',
        sampleRate: 44_100,
        bitDepth: 16,
        bitrate: 920_000,
      },
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'lossless_container' }),
      ]),
    });
  });

  it('flags unusually low bitrate lossless containers as likely transcodes', async () => {
    const analyzer = createAnalyzer({ existsSync: () => false });

    await expect(analyzer.analyzeTrack(track({ bitrate: 256_000 }))).resolves.toMatchObject({
      verdict: 'likely_lossy_transcode',
      confidence: 0.72,
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'low_lossless_bitrate', severity: 'risk' }),
      ]),
    });
  });

  it('flags CD-quality lossless containers with codec-like low-pass spectrum as likely transcodes', async () => {
    const analyzer = createAnalyzer({
      existsSync: () => true,
      probeSpectrum: async () => ({
        status: 'ready',
        decodeSampleRate: 192_000,
        analyzedDurationSeconds: 10,
        selectedStartSeconds: 24,
        probeWindowCount: 3,
        rmsDb: -18,
        upperTrebleToAudibleDb: -66,
        lowUltrasonicToAudibleDb: -82,
        highFrequencyToAudibleDb: -88,
        ultrasonicToAudibleDb: -92,
        topBandToAudibleDb: -96,
        spectralCutoffHz: 18_000,
        brickwallLikely: true,
        pcmBandwidthCutoffLikely: false,
        dsdUltrasonicNoiseLikely: false,
        error: null,
      }),
    });

    await expect(analyzer.analyzeTrack(track({
      path: 'D:\\Music\\Album\\Suspicious.flac',
      codec: 'FLAC',
      sampleRate: 44_100,
      bitDepth: 16,
      bitrate: 920_000,
    }))).resolves.toMatchObject({
      verdict: 'likely_lossy_transcode',
      confidence: 0.68,
      metrics: {
        spectrumProbeStatus: 'ready',
        spectralCutoffHz: 18_000,
        upperTrebleToAudibleDb: -66,
      },
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'spectrum_probe_ready', severity: 'info' }),
        expect.objectContaining({ id: 'lossless_spectrum_lowpass_cutoff', severity: 'risk' }),
      ]),
    });
  });

  it('does not flag CD-quality lossless only because the spectrum ends at CD bandwidth', async () => {
    const analyzer = createAnalyzer({
      existsSync: () => true,
      probeSpectrum: async () => ({
        status: 'ready',
        decodeSampleRate: 192_000,
        analyzedDurationSeconds: 10,
        selectedStartSeconds: 24,
        probeWindowCount: 3,
        rmsDb: -18,
        upperTrebleToAudibleDb: -28,
        lowUltrasonicToAudibleDb: -72,
        highFrequencyToAudibleDb: -78,
        ultrasonicToAudibleDb: -86,
        topBandToAudibleDb: -90,
        spectralCutoffHz: 22_000,
        brickwallLikely: true,
        pcmBandwidthCutoffLikely: false,
        dsdUltrasonicNoiseLikely: false,
        error: null,
      }),
    });

    const result = await analyzer.analyzeTrack(track({
      path: 'D:\\Music\\Album\\Normal.flac',
      codec: 'FLAC',
      sampleRate: 44_100,
      bitDepth: 16,
      bitrate: 920_000,
    }));

    expect(result).toMatchObject({
      verdict: 'trusted_lossless',
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'lossless_spectrum_upper_treble_present', severity: 'info' }),
      ]),
    });
    expect(result.evidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'hires_spectrum_brickwall_cutoff' }),
    ]));
  });

  it('treats valid DSD headers as container evidence instead of proof of native source', async () => {
    const analyzer = createAnalyzer({
      existsSync: () => true,
      readDsdNativeSampleRate: async () => 2_822_400,
    });

    await expect(analyzer.analyzeTrack(track({
      path: 'D:\\Music\\Dsd.dsf',
      codec: 'DSF',
      sampleRate: 2_822_400,
      bitDepth: 1,
      bitrate: 5_644_800,
    }))).resolves.toMatchObject({
      verdict: 'trusted_dsd_container',
      confidence: 0.76,
      metrics: {
        dsdNativeSampleRate: 2_822_400,
      },
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'dsd_header_rate' }),
        expect.objectContaining({ id: 'dsd_bitrate_plausible' }),
        expect.objectContaining({ id: 'dsd_source_not_proven', severity: 'warning' }),
      ]),
    });
  });

  it('flags PCM-rate and PCM-depth DSD metadata as likely PCM-to-DSD conversion', async () => {
    const analyzer = createAnalyzer({
      existsSync: () => true,
      readDsdNativeSampleRate: async () => 2_822_400,
    });

    await expect(analyzer.analyzeTrack(track({
      path: 'D:\\Music\\PCM2DSD\\Song.dsf',
      codec: 'DSF',
      sampleRate: 44_100,
      bitDepth: 24,
      bitrate: 1_200_000,
    }))).resolves.toMatchObject({
      verdict: 'likely_pcm_to_dsd',
      confidence: 0.8,
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'dsd_pcm_rate_metadata', severity: 'warning' }),
        expect.objectContaining({ id: 'dsd_pcm_bit_depth_metadata', severity: 'risk' }),
        expect.objectContaining({ id: 'dsd_transcode_text_hint', severity: 'risk' }),
      ]),
    });
  });

  it('flags DSD containers with implausibly low observed bitrate as suspicious conversion', async () => {
    const analyzer = createAnalyzer({
      existsSync: () => true,
      readDsdNativeSampleRate: async () => 2_822_400,
    });

    await expect(analyzer.analyzeTrack(track({
      path: 'D:\\Music\\Album\\Song.dsf',
      codec: 'DSF',
      sampleRate: 44_100,
      bitDepth: 1,
      bitrate: 1_017_000,
    }))).resolves.toMatchObject({
      verdict: 'likely_pcm_to_dsd',
      confidence: 0.8,
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'dsd_bitrate_far_below_native', severity: 'risk' }),
      ]),
    });
  });

  it('flags hi-res containers with upsampling hints as likely fake hi-res', async () => {
    const analyzer = createAnalyzer({ existsSync: () => false });

    await expect(analyzer.analyzeTrack(track({
      path: 'D:\\Music\\44.1-to-192-upsample\\Song.flac',
      codec: 'FLAC',
      sampleRate: 192_000,
      bitDepth: 24,
      bitrate: 2_400_000,
    }))).resolves.toMatchObject({
      verdict: 'likely_fake_hires',
      confidence: 0.8,
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'jas_hires_container', severity: 'info' }),
        expect.objectContaining({ id: 'hires_transcode_text_hint', severity: 'risk' }),
      ]),
    });
  });

  it('downgrades DSD containers when only PCM-rate metadata is available', async () => {
    const analyzer = createAnalyzer({
      existsSync: () => true,
      readDsdNativeSampleRate: async () => 2_822_400,
    });

    await expect(analyzer.analyzeTrack(track({
      path: 'D:\\Music\\Dsd.dsf',
      codec: 'DSF',
      sampleRate: 44_100,
      bitDepth: 1,
      bitrate: 5_644_800,
    }))).resolves.toMatchObject({
      verdict: 'dsd_metadata_mismatch',
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'dsd_pcm_rate_metadata', severity: 'warning' }),
      ]),
    });
  });

  it('uses spectral brickwall evidence to flag PCM-sourced DSD with high confidence', async () => {
    const analyzer = createAnalyzer({
      existsSync: () => true,
      readDsdNativeSampleRate: async () => 2_822_400,
      probeSpectrum: async () => ({
        status: 'ready',
        decodeSampleRate: 192_000,
        analyzedDurationSeconds: 10,
        selectedStartSeconds: 24,
        probeWindowCount: 3,
        rmsDb: -18,
        upperTrebleToAudibleDb: -70,
        lowUltrasonicToAudibleDb: -74,
        highFrequencyToAudibleDb: -70,
        ultrasonicToAudibleDb: -76,
        topBandToAudibleDb: -82,
        spectralCutoffHz: 22_000,
        brickwallLikely: true,
        pcmBandwidthCutoffLikely: false,
        dsdUltrasonicNoiseLikely: false,
        error: null,
      }),
    });

    await expect(analyzer.analyzeTrack(track({
      path: 'D:\\Music\\Dsd.dsf',
      codec: 'DSF',
      sampleRate: 2_822_400,
      bitDepth: 1,
      bitrate: 5_644_800,
    }))).resolves.toMatchObject({
      verdict: 'likely_pcm_to_dsd',
      confidence: 0.86,
      metrics: {
        spectrumProbeStatus: 'ready',
        spectralCutoffHz: 22_000,
        ultrasonicToAudibleDb: -76,
      },
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'dsd_spectrum_pcm_bandwidth_cutoff', severity: 'risk' }),
      ]),
    });
  });

  it('raises DSD container confidence when ultrasonic noise shaping is present', async () => {
    const analyzer = createAnalyzer({
      existsSync: () => true,
      readDsdNativeSampleRate: async () => 2_822_400,
      probeSpectrum: async () => ({
        status: 'ready',
        decodeSampleRate: 192_000,
        analyzedDurationSeconds: 10,
        selectedStartSeconds: 24,
        probeWindowCount: 3,
        rmsDb: -18,
        upperTrebleToAudibleDb: -24,
        lowUltrasonicToAudibleDb: -30,
        highFrequencyToAudibleDb: -28,
        ultrasonicToAudibleDb: -26,
        topBandToAudibleDb: -33,
        spectralCutoffHz: null,
        brickwallLikely: false,
        pcmBandwidthCutoffLikely: false,
        dsdUltrasonicNoiseLikely: true,
        error: null,
      }),
    });

    await expect(analyzer.analyzeTrack(track({
      path: 'D:\\Music\\Dsd.dsf',
      codec: 'DSF',
      sampleRate: 2_822_400,
      bitDepth: 1,
      bitrate: 5_644_800,
    }))).resolves.toMatchObject({
      verdict: 'trusted_dsd_container',
      confidence: 0.86,
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'dsd_spectrum_noise_shaping_present', severity: 'info' }),
      ]),
    });
  });

  it('does not trust DSD just because PCM-to-DSD noise shaping is present', async () => {
    const analyzer = createAnalyzer({
      existsSync: () => true,
      readDsdNativeSampleRate: async () => 2_822_400,
      probeSpectrum: async () => ({
        status: 'ready',
        decodeSampleRate: 192_000,
        analyzedDurationSeconds: 10,
        selectedStartSeconds: 24,
        probeWindowCount: 3,
        rmsDb: -18,
        upperTrebleToAudibleDb: -56,
        lowUltrasonicToAudibleDb: -60,
        highFrequencyToAudibleDb: -44,
        ultrasonicToAudibleDb: -30,
        topBandToAudibleDb: -35,
        spectralCutoffHz: null,
        brickwallLikely: false,
        pcmBandwidthCutoffLikely: true,
        dsdUltrasonicNoiseLikely: true,
        error: null,
      }),
    });

    await expect(analyzer.analyzeTrack(track({
      path: 'D:\\Music\\Dsd.dsf',
      codec: 'DSF',
      sampleRate: 2_822_400,
      bitDepth: 1,
      bitrate: 5_644_800,
    }))).resolves.toMatchObject({
      verdict: 'likely_pcm_to_dsd',
      confidence: 0.82,
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'dsd_spectrum_noise_shaped_pcm_cutoff', severity: 'risk' }),
      ]),
    });
  });

  it('uses spectral brickwall evidence to flag fake hi-res without relying on file names', async () => {
    const analyzer = createAnalyzer({
      existsSync: () => true,
      probeSpectrum: async () => ({
        status: 'ready',
        decodeSampleRate: 192_000,
        analyzedDurationSeconds: 10,
        selectedStartSeconds: 24,
        probeWindowCount: 3,
        rmsDb: -18,
        upperTrebleToAudibleDb: -70,
        lowUltrasonicToAudibleDb: -76,
        highFrequencyToAudibleDb: -72,
        ultrasonicToAudibleDb: -80,
        topBandToAudibleDb: -86,
        spectralCutoffHz: 22_000,
        brickwallLikely: true,
        pcmBandwidthCutoffLikely: false,
        dsdUltrasonicNoiseLikely: false,
        error: null,
      }),
    });

    await expect(analyzer.analyzeTrack(track({
      path: 'D:\\Music\\Album\\Song.flac',
      codec: 'FLAC',
      sampleRate: 192_000,
      bitDepth: 24,
      bitrate: 2_400_000,
    }))).resolves.toMatchObject({
      verdict: 'likely_fake_hires',
      confidence: 0.84,
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'hires_spectrum_brickwall_cutoff', severity: 'risk' }),
      ]),
    });
  });
});
