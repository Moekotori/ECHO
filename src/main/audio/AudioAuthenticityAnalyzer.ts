import { existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { LibraryTrack } from '../../shared/types/library';
import type {
  PluginAudioAnalysisEvidence,
  PluginAudioAnalysisReport,
  PluginAudioAnalysisVerdict,
} from '../../shared/types/plugins';
import {
  isDsdCodec,
  isDsdFilePath,
  readDsdNativeSampleRate,
} from './DsdProbe';
import {
  AudioAuthenticitySpectrumProbe,
  type AudioAuthenticitySpectrumProbeRequest,
  type AudioAuthenticitySpectrumProbeResult,
} from './AudioAuthenticitySpectrumProbe';

type AudioAuthenticityAnalyzerDependencies = {
  now?: () => Date;
  existsSync?: (path: string) => boolean;
  statSync?: typeof statSync;
  readDsdNativeSampleRate?: (filePath: string) => Promise<number | null>;
  probeSpectrum?: (request: AudioAuthenticitySpectrumProbeRequest) => Promise<AudioAuthenticitySpectrumProbeResult | null>;
};

const losslessCodecs = new Set(['flac', 'alac', 'wav', 'wave', 'aiff', 'aif', 'ape']);
const lossyCodecs = new Set(['mp3', 'aac', 'ogg', 'opus', 'vorbis', 'wma']);
const losslessExtensions = new Set(['.flac', '.alac', '.wav', '.wave', '.aiff', '.aif', '.ape']);
const lossyExtensions = new Set(['.mp3', '.aac', '.m4a', '.ogg', '.opus', '.wma']);
const dsdNativeRateFloor = 1_000_000;
const safeDsdTextTranscodePattern = /(?:pcm\s*(?:to|2)\s*dsd|upsampl|up[-_\s]?convert|converted\s+to\s+dsd|dsd\s+convert|remodulat|noise[-_\s]?shap|hqplayer|foobar|sacd[-_\s]?r|\u5347\u9891|\u5347\u91c7\u6837|\u5347\u53d6\u6837|\u8f6c\s*dsd|\u8f49\s*dsd|\u8f6c\u7801|\u8f49\u78bc|\u8f6c\u5236|\u8f49\u88fd|\u5047\s*dsd|fake\s*dsd)/iu;
const safeHiresTextTranscodePattern = /(?:upsampl|up[-_\s]?convert|fake\s*hi[-_\s]?res|converted\s+to\s+(?:96|192|384)|44\.1\s*(?:to|2)\s*(?:88\.2|96|176\.4|192)|48\s*(?:to|2)\s*(?:96|192)|\u5347\u9891|\u5347\u91c7\u6837|\u5347\u53d6\u6837|\u5047\s*hi[-_\s]?res|\u5047\s*\u9ad8\u89e3\u6790|\u8f6c\u7801|\u8f49\u78bc|\u8f6c\u5236|\u8f49\u88fd)/iu;

const cleanText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const positiveNumber = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
};

const normalizedCodecTokens = (codec: string | null): string[] =>
  (codec ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);

const hasCodecToken = (codec: string | null, tokens: Set<string>): boolean =>
  normalizedCodecTokens(codec).some((token) => tokens.has(token));

const evidence = (id: string, severity: PluginAudioAnalysisEvidence['severity'], message: string): PluginAudioAnalysisEvidence => ({
  id,
  severity,
  message,
});

const clampConfidence = (value: number): number =>
  Math.max(0, Math.min(1, Math.round(value * 100) / 100));

const formatKhz = (value: number): string =>
  value >= 1_000_000
    ? `${Math.round(value / 10_000) / 100} MHz`
    : `${Math.round(value / 100) / 10} kHz`;

const formatMbps = (value: number): string =>
  `${Math.round(value / 10_000) / 100} Mbps`;

const formatDb = (value: number | null): string =>
  value === null ? 'unavailable' : `${Math.round(value * 10) / 10} dB`;

const formatHz = (value: number | null): string =>
  value === null ? 'unavailable' : value >= 1_000 ? `${Math.round(value / 100) / 10} kHz` : `${Math.round(value)} Hz`;

const dsdFamily = (sampleRate: number): string => {
  const multiple = Math.round(sampleRate / 44_100);
  return multiple >= 64 ? `DSD${multiple}` : `${formatKhz(sampleRate)} DSD`;
};

const observedBitrate = (bitrate: number | null, fileSizeBytes: number | null, durationSeconds: number | null): number | null => {
  if (fileSizeBytes !== null && durationSeconds !== null && durationSeconds > 0) {
    return (fileSizeBytes * 8) / durationSeconds;
  }

  return bitrate;
};

const dsdTextProbe = (track: LibraryTrack, filePath: string | null, codec: string | null): string =>
  [
    filePath,
    codec,
    track.title,
    track.album,
    track.artist,
    track.albumArtist,
    track.genre,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');

const pcmTextProbe = dsdTextProbe;

export class AudioAuthenticityAnalyzer {
  private readonly now: () => Date;
  private readonly exists: (path: string) => boolean;
  private readonly stat: typeof statSync;
  private readonly readDsdRate: (filePath: string) => Promise<number | null>;
  private readonly probeSpectrum: (request: AudioAuthenticitySpectrumProbeRequest) => Promise<AudioAuthenticitySpectrumProbeResult | null>;

  constructor(dependencies: AudioAuthenticityAnalyzerDependencies = {}) {
    this.now = dependencies.now ?? (() => new Date());
    this.exists = dependencies.existsSync ?? existsSync;
    this.stat = dependencies.statSync ?? statSync;
    this.readDsdRate = dependencies.readDsdNativeSampleRate ?? readDsdNativeSampleRate;
    if (dependencies.probeSpectrum) {
      this.probeSpectrum = dependencies.probeSpectrum;
    } else {
      const defaultSpectrumProbe = new AudioAuthenticitySpectrumProbe();
      this.probeSpectrum = (request) => defaultSpectrumProbe.probe(request);
    }
  }

  async analyzeTrack(track: LibraryTrack): Promise<PluginAudioAnalysisReport> {
    const filePath = cleanText(track.path);
    const codec = cleanText(track.codec);
    const extension = filePath ? extname(filePath).toLowerCase() || null : null;
    const sampleRate = positiveNumber(track.sampleRate);
    const bitDepth = positiveNumber(track.bitDepth);
    const bitrate = positiveNumber(track.bitrate);
    const durationSeconds = positiveNumber(track.duration);
    const fileSizeBytes = this.resolveFileSize(filePath);
    const dsdByName = isDsdFilePath(filePath) || isDsdCodec(codec);
    const codecIsLossless = hasCodecToken(codec, losslessCodecs) || (extension !== null && losslessExtensions.has(extension));
    const codecIsLossy = hasCodecToken(codec, lossyCodecs) || (extension !== null && lossyExtensions.has(extension));
    const dsdNativeSampleRate = dsdByName && filePath && this.exists(filePath)
      ? await this.readDsdRate(filePath)
      : null;
    const isHiRes = (sampleRate !== null && sampleRate >= 88_200) || (bitDepth !== null && bitDepth >= 24);
    const shouldRunStandardLosslessSpectrumProbe = Boolean(
      !dsdByName &&
      codecIsLossless &&
      sampleRate !== null &&
      sampleRate >= 32_000 &&
      sampleRate <= 48_000,
    );
    const shouldRunSpectrumProbe = Boolean(
      filePath &&
      this.exists(filePath) &&
      (dsdByName || isHiRes || shouldRunStandardLosslessSpectrumProbe),
    );
    const spectrum = shouldRunSpectrumProbe && filePath
        ? await this.safeProbeSpectrum({
            filePath,
            trackDurationSeconds: durationSeconds,
            isDsd: dsdByName,
            isHiRes,
          })
      : null;
    const spectrumProbeStatus = spectrum?.status ?? (shouldRunSpectrumProbe ? 'unavailable' : 'skipped');
    const metrics = (): PluginAudioAnalysisReport['metrics'] => ({
      codec,
      extension,
      sampleRate,
      bitDepth,
      bitrate,
      durationSeconds,
      fileSizeBytes,
      dsdNativeSampleRate,
      spectrumProbeStatus,
      spectrumProbeWindows: spectrum?.probeWindowCount ?? null,
      spectrumSelectedStartSeconds: spectrum?.selectedStartSeconds ?? null,
      spectralCutoffHz: spectrum?.spectralCutoffHz ?? null,
      upperTrebleToAudibleDb: spectrum?.upperTrebleToAudibleDb ?? null,
      lowUltrasonicToAudibleDb: spectrum?.lowUltrasonicToAudibleDb ?? null,
      highFrequencyToAudibleDb: spectrum?.highFrequencyToAudibleDb ?? null,
      ultrasonicToAudibleDb: spectrum?.ultrasonicToAudibleDb ?? null,
      topBandToAudibleDb: spectrum?.topBandToAudibleDb ?? null,
    });
    const items: PluginAudioAnalysisEvidence[] = [];
    const limitations: string[] = [
      'This report combines host-controlled metadata, file size, DSD header checks, and a short FFmpeg spectral probe when the local file is available.',
      'Spectral cutoff and DSD ultrasonic-noise cues are strong provenance signals, but they still cannot prove the full mastering chain alone.',
    ];

    if (!filePath) {
      return this.report(track.id, 'unsupported', 'unknown', 0.1, {
        ...metrics(),
      }, [evidence('track_path_missing', 'warning', 'Track has no local path exposed to the host analyzer.')], limitations);
    }

    if (dsdByName) {
      items.push(evidence('dsd_container_hint', 'info', 'Track is identified as DSF/DFF/DSD by codec or file extension.'));
      if (dsdNativeSampleRate !== null) {
        items.push(evidence('dsd_header_rate', 'info', `DSD header reports ${dsdFamily(dsdNativeSampleRate)} native rate (${Math.round(dsdNativeSampleRate)} Hz).`));
      } else {
        items.push(evidence('dsd_header_unverified', 'warning', 'No native DSD sample rate was verified from the file header, so the container claim is not enough to trust the source.'));
      }

      const pcmRateMetadata = sampleRate !== null && sampleRate < dsdNativeRateFloor;
      const pcmBitDepthMetadata = bitDepth !== null && bitDepth > 1;
      const textProbe = dsdTextProbe(track, filePath, codec);
      const hasTranscodeTextHint = safeDsdTextTranscodePattern.test(textProbe);
      const measuredBitrate = observedBitrate(bitrate, fileSizeBytes, durationSeconds);
      let dsdBitrateRisk = false;
      let dsdBitrateWarning = false;

      if (pcmRateMetadata) {
        items.push(evidence('dsd_pcm_rate_metadata', 'warning', `Library metadata exposes PCM-rate ${Math.round(sampleRate)} Hz for a DSD-looking track; this may be a decode path or a PCM-sourced conversion, not proof of native DSD provenance.`));
      }

      if (pcmBitDepthMetadata) {
        items.push(evidence('dsd_pcm_bit_depth_metadata', 'risk', `DSD should be 1-bit at the container level, but metadata reports ${Math.round(bitDepth)} bit PCM-style depth.`));
      }

      if (hasTranscodeTextHint) {
        items.push(evidence('dsd_transcode_text_hint', 'risk', 'Path, title, album, artist, or genre contains wording commonly used for PCM-to-DSD conversion or upsampling.'));
      }

      if (dsdNativeSampleRate !== null && measuredBitrate !== null) {
        const expectedStereoBitrate = dsdNativeSampleRate * 2;
        const ratioToStereo = measuredBitrate / expectedStereoBitrate;
        if (ratioToStereo < 0.35) {
          dsdBitrateRisk = true;
          items.push(evidence('dsd_bitrate_far_below_native', 'risk', `Observed bitrate ${formatMbps(measuredBitrate)} is far below uncompressed stereo ${dsdFamily(dsdNativeSampleRate)} around ${formatMbps(expectedStereoBitrate)}. This is suspicious unless the file uses a known compressed DSD variant.`));
        } else if (ratioToStereo < 0.72) {
          dsdBitrateWarning = true;
          items.push(evidence('dsd_bitrate_below_native', 'warning', `Observed bitrate ${formatMbps(measuredBitrate)} is below normal uncompressed stereo ${dsdFamily(dsdNativeSampleRate)} around ${formatMbps(expectedStereoBitrate)}; treat source authenticity as unproven.`));
        } else {
          items.push(evidence('dsd_bitrate_plausible', 'info', `Observed bitrate ${formatMbps(measuredBitrate)} is plausible for ${dsdFamily(dsdNativeSampleRate)} container data.`));
        }
      } else {
        items.push(evidence('dsd_bitrate_unverified', 'warning', 'No reliable duration/file-size bitrate cross-check was available for the DSD container.'));
      }

      this.addSpectrumEvidence(items, spectrum, 'dsd');
      const spectralDsdRisk = spectrum?.status === 'ready' &&
        (spectrum.brickwallLikely || spectrum.pcmBandwidthCutoffLikely);
      const spectralDsdSupport = spectrum?.status === 'ready' &&
        spectrum.dsdUltrasonicNoiseLikely &&
        !spectrum.brickwallLikely &&
        !spectrum.pcmBandwidthCutoffLikely;

      if (hasTranscodeTextHint || dsdBitrateRisk || spectralDsdRisk || (pcmRateMetadata && pcmBitDepthMetadata)) {
        const confidence = spectralDsdRisk
          ? spectrum?.pcmBandwidthCutoffLikely
            ? 0.82
            : 0.86
          : hasTranscodeTextHint || dsdBitrateRisk
            ? 0.8
            : 0.72;
        return this.report(track.id, 'ready', 'likely_pcm_to_dsd', confidence, metrics(), items, limitations);
      }

      if (pcmRateMetadata || pcmBitDepthMetadata || dsdNativeSampleRate === null || dsdBitrateWarning) {
        if (dsdNativeSampleRate === null && pcmRateMetadata) {
          items.push(evidence('dsd_header_missing_pcm_rate', 'risk', 'Track looks like DSD but only PCM-rate metadata was available and the host could not verify a native DSD header.'));
        }
        return this.report(track.id, 'ready', 'dsd_metadata_mismatch', 0.74, metrics(), items, limitations);
      }
      items.push(evidence('dsd_source_not_proven', 'warning', spectralDsdSupport
        ? 'DSD-like ultrasonic noise shaping supports the container claim, but the original mastering chain is still not mathematically provable from the local file alone.'
        : 'Valid DSD container evidence does not prove the original mastering source; use the report as a strong local-file authenticity signal, not a mastering-chain certificate.'));
      const trustedDsdConfidence = spectralDsdSupport
        ? 0.86
        : spectrum?.status === 'ready'
          ? 0.74
          : 0.76;
      return this.report(track.id, 'ready', 'trusted_dsd_container', trustedDsdConfidence, metrics(), items, limitations);
    }

    const isJasHiResContainer = sampleRate !== null && sampleRate >= 96_000 && bitDepth !== null && bitDepth >= 24;
    const isHighBitDepthOnly = bitDepth !== null && bitDepth >= 24 && sampleRate !== null && sampleRate < 88_200;
    const longEnoughForBitrateSignal = durationSeconds === null || durationSeconds >= 45;
    const pcmProbeText = pcmTextProbe(track, filePath, codec);
    const hasHiresTranscodeHint = isHiRes && safeHiresTextTranscodePattern.test(pcmProbeText);

    if (codecIsLossy) {
      items.push(evidence('lossy_codec', 'info', 'Codec or extension is a known lossy format.'));
      return this.report(track.id, 'ready', 'lossy_source', 0.9, metrics(), items, limitations);
    }

    if (!codecIsLossless) {
      items.push(evidence('codec_unknown', 'warning', 'Codec is not enough to classify this file as lossless or lossy.'));
      return this.report(track.id, 'ready', 'unknown', 0.3, metrics(), items, limitations);
    }

    items.push(evidence('lossless_container', 'info', 'Codec or extension is a lossless container.'));
    if (isJasHiResContainer) {
      items.push(evidence('jas_hires_container', 'info', 'Metadata meets the common 96 kHz / 24-bit-or-above Hi-Res container threshold.'));
    } else if (isHighBitDepthOnly) {
      items.push(evidence('high_bit_depth_not_jas_hires', 'warning', 'Bit depth is above CD quality, but sample rate is below the common 96 kHz Hi-Res logo threshold.'));
    }
    const spectralLosslessTranscodeRisk = isHiRes
      ? false
      : this.addStandardLosslessSpectrumEvidence(items, spectrum);
    if (isHiRes) {
      this.addSpectrumEvidence(items, spectrum, 'hires');
    }
    const spectralHiResRisk = isHiRes && spectrum?.status === 'ready' && spectrum.brickwallLikely;
    const spectralHiResSupport = isHiRes &&
      spectrum?.status === 'ready' &&
      !spectrum.brickwallLikely &&
      spectrum.highFrequencyToAudibleDb !== null &&
      spectrum.highFrequencyToAudibleDb > -55;

    if (spectralHiResRisk) {
      return this.report(track.id, 'ready', 'likely_fake_hires', 0.84, metrics(), items, limitations);
    }

    if (hasHiresTranscodeHint) {
      items.push(evidence('hires_transcode_text_hint', 'risk', 'Path, title, album, artist, or genre contains wording commonly used for PCM upsampling or fake Hi-Res releases.'));
      return this.report(track.id, 'ready', 'likely_fake_hires', 0.8, metrics(), items, limitations);
    }

    if (bitrate !== null && longEnoughForBitrateSignal && bitrate < 360_000) {
      items.push(evidence('low_lossless_bitrate', 'risk', 'Average bitrate is unusually low for a normal lossless music file.'));
      return this.report(track.id, 'ready', 'likely_lossy_transcode', spectralLosslessTranscodeRisk ? 0.82 : 0.72, metrics(), items, limitations);
    }

    if (spectralLosslessTranscodeRisk) {
      return this.report(track.id, 'ready', 'likely_lossy_transcode', 0.68, metrics(), items, limitations);
    }

    if (isHiRes && bitrate !== null && longEnoughForBitrateSignal && bitrate < 900_000) {
      items.push(evidence('low_hires_bitrate', 'risk', 'Track is marked Hi-Res or high-bit-depth lossless but has a low average bitrate for that claim.'));
      return this.report(track.id, 'ready', 'likely_fake_hires', 0.76, metrics(), items, limitations);
    }

    if (sampleRate !== null) {
      items.push(evidence('sample_rate_present', 'info', `Sample rate is ${Math.round(sampleRate)} Hz.`));
    }
    if (bitDepth !== null) {
      items.push(evidence('bit_depth_present', 'info', `Bit depth is ${Math.round(bitDepth)} bit.`));
    }
    if (bitrate !== null) {
      items.push(evidence('bitrate_present', 'info', `Average bitrate is ${Math.round(bitrate)} bps.`));
    }

    const trustedLosslessConfidence = isHiRes
      ? spectralHiResSupport
        ? 0.82
        : 0.74
      : 0.76;
    return this.report(track.id, 'ready', 'trusted_lossless', trustedLosslessConfidence, metrics(), items, limitations);
  }

  private resolveFileSize(filePath: string | null): number | null {
    if (!filePath || !this.exists(filePath)) {
      return null;
    }
    try {
      return this.stat(filePath).size;
    } catch {
      return null;
    }
  }

  private async safeProbeSpectrum(request: AudioAuthenticitySpectrumProbeRequest): Promise<AudioAuthenticitySpectrumProbeResult> {
    try {
      const result = await this.probeSpectrum(request);
      return result ?? {
        status: 'unavailable',
        decodeSampleRate: null,
        analyzedDurationSeconds: null,
        selectedStartSeconds: null,
        probeWindowCount: null,
        rmsDb: null,
        upperTrebleToAudibleDb: null,
        lowUltrasonicToAudibleDb: null,
        highFrequencyToAudibleDb: null,
        ultrasonicToAudibleDb: null,
        topBandToAudibleDb: null,
        spectralCutoffHz: null,
        brickwallLikely: false,
        pcmBandwidthCutoffLikely: false,
        dsdUltrasonicNoiseLikely: false,
        error: null,
      };
    } catch (error) {
      return {
        status: 'error',
        decodeSampleRate: null,
        analyzedDurationSeconds: null,
        selectedStartSeconds: null,
        probeWindowCount: null,
        rmsDb: null,
        upperTrebleToAudibleDb: null,
        lowUltrasonicToAudibleDb: null,
        highFrequencyToAudibleDb: null,
        ultrasonicToAudibleDb: null,
        topBandToAudibleDb: null,
        spectralCutoffHz: null,
        brickwallLikely: false,
        pcmBandwidthCutoffLikely: false,
        dsdUltrasonicNoiseLikely: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private addSpectrumEvidence(
    items: PluginAudioAnalysisEvidence[],
    spectrum: AudioAuthenticitySpectrumProbeResult | null,
    mode: 'dsd' | 'hires',
  ): void {
    if (!spectrum || spectrum.status === 'skipped') {
      return;
    }

    if (spectrum.status !== 'ready') {
      items.push(evidence(
        'spectrum_probe_unavailable',
        'warning',
        `Spectral probe status is ${spectrum.status}${spectrum.error ? `: ${spectrum.error}` : ''}.`,
      ));
      return;
    }

    items.push(evidence(
      'spectrum_probe_ready',
      'info',
      `Spectral probe decoded ${Math.round((spectrum.analyzedDurationSeconds ?? 0) * 10) / 10}s at ${formatKhz(spectrum.decodeSampleRate ?? 0)}; high/audible ${formatDb(spectrum.highFrequencyToAudibleDb)}, ultrasonic/audible ${formatDb(spectrum.ultrasonicToAudibleDb)}.`,
    ));

    if (spectrum.brickwallLikely) {
      items.push(evidence(
        mode === 'dsd' ? 'dsd_spectrum_pcm_bandwidth_cutoff' : 'hires_spectrum_brickwall_cutoff',
        'risk',
        `Decoded spectrum has a steep cutoff around ${formatHz(spectrum.spectralCutoffHz)} with very low ultrasonic energy; this is a strong sign of PCM-bandwidth material inside a higher-rate container.`,
      ));
      return;
    }

    if (mode === 'dsd' && spectrum.pcmBandwidthCutoffLikely) {
      items.push(evidence(
        'dsd_spectrum_noise_shaped_pcm_cutoff',
        'risk',
        `The decoded DSD spectrum has weak 18-30 kHz music-band energy but elevated ultrasonic noise. That pattern is consistent with PCM material converted to DSD with noise shaping, not strong evidence of native DSD provenance.`,
      ));
      return;
    }

    if (mode === 'dsd') {
      if (spectrum.dsdUltrasonicNoiseLikely) {
        items.push(evidence(
          'dsd_spectrum_noise_shaping_present',
          'info',
          'Decoded spectrum includes DSD-like ultrasonic noise-shaped energy, which supports the container claim more strongly than metadata alone.',
        ));
      } else {
        items.push(evidence(
          'dsd_spectrum_noise_shaping_not_clear',
          'warning',
          'Spectral probe did not find a clear DSD ultrasonic-noise signature; this may be filtering, quiet content, or PCM-sourced conversion.',
        ));
      }
      return;
    }

    if (spectrum.highFrequencyToAudibleDb !== null && spectrum.highFrequencyToAudibleDb > -55) {
      items.push(evidence(
        'hires_spectrum_high_band_present',
        'info',
        'High-frequency content above the CD audio band is present, supporting the Hi-Res container claim.',
      ));
    } else {
      items.push(evidence(
        'hires_spectrum_high_band_weak',
        'warning',
        'High-frequency energy above the CD audio band is weak; this alone is not proof of fake Hi-Res, but it lowers provenance confidence.',
      ));
    }
  }

  private addStandardLosslessSpectrumEvidence(
    items: PluginAudioAnalysisEvidence[],
    spectrum: AudioAuthenticitySpectrumProbeResult | null,
  ): boolean {
    if (!spectrum || spectrum.status === 'skipped') {
      return false;
    }

    if (spectrum.status !== 'ready') {
      items.push(evidence(
        'spectrum_probe_unavailable',
        'warning',
        `Spectral probe status is ${spectrum.status}${spectrum.error ? `: ${spectrum.error}` : ''}.`,
      ));
      return false;
    }

    items.push(evidence(
      'spectrum_probe_ready',
      'info',
      `Spectral probe decoded ${Math.round((spectrum.analyzedDurationSeconds ?? 0) * 10) / 10}s at ${formatKhz(spectrum.decodeSampleRate ?? 0)}; upper-treble/audible ${formatDb(spectrum.upperTrebleToAudibleDb)}, cutoff ${formatHz(spectrum.spectralCutoffHz)}.`,
    ));

    const hasLossyLowpassSignature =
      spectrum.spectralCutoffHz !== null &&
      spectrum.spectralCutoffHz <= 20_000 &&
      spectrum.upperTrebleToAudibleDb !== null &&
      spectrum.upperTrebleToAudibleDb < -58;

    if (hasLossyLowpassSignature) {
      items.push(evidence(
        'lossless_spectrum_lowpass_cutoff',
        'risk',
        `Lossless container has a steep low-pass around ${formatHz(spectrum.spectralCutoffHz)} and very weak 18-24 kHz energy (${formatDb(spectrum.upperTrebleToAudibleDb)} vs audible band), which is consistent with a lossy-source transcode.`,
      ));
      return true;
    }

    if (spectrum.upperTrebleToAudibleDb !== null && spectrum.upperTrebleToAudibleDb > -45) {
      items.push(evidence(
        'lossless_spectrum_upper_treble_present',
        'info',
        'Sampled windows contain meaningful 18-24 kHz upper-treble energy, so no obvious lossy-codec low-pass was found.',
      ));
    } else {
      items.push(evidence(
        'lossless_spectrum_upper_treble_weak',
        'warning',
        '18-24 kHz upper-treble energy is weak in the sampled windows; this alone can be mastering or material choice, so it is not treated as transcode proof.',
      ));
    }

    return false;
  }

  private report(
    trackId: string,
    status: PluginAudioAnalysisReport['status'],
    verdict: PluginAudioAnalysisVerdict,
    confidence: number,
    metrics: PluginAudioAnalysisReport['metrics'],
    items: PluginAudioAnalysisEvidence[],
    limitations: string[],
  ): PluginAudioAnalysisReport {
    return {
      trackId,
      analyzedAt: this.now().toISOString(),
      status,
      verdict,
      confidence: clampConfidence(confidence),
      metrics,
      evidence: items,
      limitations,
    };
  }
}
