import { Transform } from 'node:stream';
import type { AudioPcmDitherMode } from '../../../shared/types/audio';

const pcmDitherShapeCoefficients = (mode: AudioPcmDitherMode): number[] => {
  switch (mode) {
    case 'ns-5':
      return [0.82, -0.38, 0.19, -0.08, 0.025];
    case 'ns-9':
      return [0.95, -0.52, 0.31, -0.18, 0.1, -0.052, 0.025, -0.01, 0.003];
    case 'ultra-shaped':
      return [1.08, -0.68, 0.46, -0.3, 0.19, -0.11, 0.055, -0.022, 0.006];
    default:
      return [];
  }
};

export class PcmDitherTransform extends Transform {
  private remainder = Buffer.alloc(0);
  private rngState = 0x6d2b79f5;
  private readonly maxInteger: number;
  private readonly lsb: number;
  private readonly previousDither: Float64Array;
  private readonly errorHistory: Float64Array[];
  private readonly shapeCoefficients: number[];

  constructor(
    private readonly mode: AudioPcmDitherMode,
    bitDepth: 16 | 24,
    channels: number,
  ) {
    super();
    const safeChannels = Math.max(1, Math.round(channels));
    this.maxInteger = (2 ** (bitDepth - 1)) - 1;
    this.lsb = 1 / this.maxInteger;
    this.previousDither = new Float64Array(safeChannels);
    this.shapeCoefficients = pcmDitherShapeCoefficients(mode);
    this.errorHistory = Array.from({ length: safeChannels }, () => new Float64Array(this.shapeCoefficients.length));
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    const input = this.remainder.length > 0 ? Buffer.concat([this.remainder, chunk]) : chunk;
    const output = Buffer.from(input);
    const sampleBytes = 4;
    const completeSampleBytes = output.length - (output.length % sampleBytes);
    this.remainder = completeSampleBytes < output.length ? Buffer.from(output.subarray(completeSampleBytes)) : Buffer.alloc(0);
    const channels = this.previousDither.length;

    for (let offset = 0, sampleIndex = 0; offset < completeSampleBytes; offset += sampleBytes, sampleIndex += 1) {
      const channel = sampleIndex % channels;
      const sample = output.readFloatLE(offset);
      const shaped = this.applyNoiseShaping(sample, channel);
      const dithered = shaped + this.nextDither(channel);
      const quantized = Math.round(Math.max(-1, Math.min(1, dithered)) * this.maxInteger) / this.maxInteger;
      this.recordQuantizationError(channel, shaped - quantized);
      output.writeFloatLE(Math.max(-1, Math.min(1, quantized)), offset);
    }

    callback(null, output.subarray(0, completeSampleBytes));
  }

  override _flush(callback: (error?: Error | null, data?: Buffer) => void): void {
    const tail = this.remainder;
    this.remainder = Buffer.alloc(0);
    callback(null, tail);
  }

  private applyNoiseShaping(sample: number, channel: number): number {
    if (this.shapeCoefficients.length === 0) {
      return sample;
    }

    const history = this.errorHistory[channel];
    let shaped = sample;
    for (let index = 0; index < this.shapeCoefficients.length; index += 1) {
      shaped += history[index] * (this.shapeCoefficients[index] ?? 0);
    }
    return shaped;
  }

  private recordQuantizationError(channel: number, error: number): void {
    const history = this.errorHistory[channel];
    if (history.length === 0) {
      return;
    }

    for (let index = history.length - 1; index > 0; index -= 1) {
      history[index] = history[index - 1];
    }
    history[0] = Math.max(-this.lsb * 8, Math.min(this.lsb * 8, error));
  }

  private nextDither(channel: number): number {
    const tpdf = (this.nextRandomUnit() - this.nextRandomUnit()) * this.lsb;
    if (this.mode !== 'highpass-tpdf') {
      return tpdf;
    }

    const previous = this.previousDither[channel];
    this.previousDither[channel] = tpdf;
    return (tpdf - previous) * 0.5;
  }

  private nextRandomUnit(): number {
    let value = this.rngState >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.rngState = value >>> 0;
    return this.rngState / 0x100000000;
  }
}
