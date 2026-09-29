import { Transform } from 'node:stream';

export class PcmLinearResamplerTransform extends Transform {
  private readonly channels: number;
  private readonly frameBytes: number;
  private readonly step: number;
  private remainder: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private previousFrame: Float32Array | null = null;
  private sourceCursor = 0;

  constructor(channels: number, sourceSampleRate: number, targetSampleRate: number) {
    super();
    this.channels = Math.max(1, Math.min(8, Math.round(channels)));
    this.frameBytes = this.channels * 4;
    this.step = sourceSampleRate / targetSampleRate;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    const input = this.remainder.length > 0 ? Buffer.concat([this.remainder, chunk]) : chunk;
    const completeBytes = input.length - (input.length % this.frameBytes);
    this.remainder = completeBytes < input.length ? Buffer.from(input.subarray(completeBytes)) : Buffer.alloc(0);

    if (completeBytes <= 0) {
      callback();
      return;
    }

    const inputFrames = completeBytes / this.frameBytes;
    const historyFrames = inputFrames + (this.previousFrame ? 1 : 0);
    if (historyFrames < 2) {
      this.previousFrame = this.readFrame(input, 0);
      callback();
      return;
    }

    const estimatedOutputFrames = Math.max(1, Math.ceil(historyFrames / this.step) + 2);
    const output = Buffer.allocUnsafe(estimatedOutputFrames * this.frameBytes);
    let outputFrames = 0;

    while (this.sourceCursor + 1 < historyFrames) {
      const leftFrame = Math.floor(this.sourceCursor);
      const rightFrame = leftFrame + 1;
      const fraction = this.sourceCursor - leftFrame;
      for (let channel = 0; channel < this.channels; channel += 1) {
        const left = this.readHistorySample(input, leftFrame, channel);
        const right = this.readHistorySample(input, rightFrame, channel);
        output.writeFloatLE(left + (right - left) * fraction, (outputFrames * this.channels + channel) * 4);
      }
      outputFrames += 1;
      this.sourceCursor += this.step;
    }

    this.sourceCursor -= historyFrames - 1;
    this.previousFrame = this.readFrame(input, inputFrames - 1);
    callback(null, output.subarray(0, outputFrames * this.frameBytes));
  }

  override _flush(callback: (error?: Error | null, data?: Buffer) => void): void {
    this.remainder = Buffer.alloc(0);
    this.previousFrame = null;
    this.sourceCursor = 0;
    callback();
  }

  private readHistorySample(input: Buffer, frameIndex: number, channel: number): number {
    if (this.previousFrame) {
      if (frameIndex === 0) {
        return this.previousFrame[channel] ?? 0;
      }
      return input.readFloatLE(((frameIndex - 1) * this.channels + channel) * 4);
    }

    return input.readFloatLE((frameIndex * this.channels + channel) * 4);
  }

  private readFrame(input: Buffer, frameIndex: number): Float32Array {
    const frame = new Float32Array(this.channels);
    for (let channel = 0; channel < this.channels; channel += 1) {
      frame[channel] = input.readFloatLE((frameIndex * this.channels + channel) * 4);
    }
    return frame;
  }
}
