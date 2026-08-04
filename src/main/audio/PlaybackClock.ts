export class PlaybackClock {
  private sampleRate: number | null = null;
  private frameOffset = 0;
  private framesConsumed = 0;
  private startSeconds = 0;

  reset(startSeconds: number, sampleRate: number | null): void {
    this.startSeconds = Math.max(0, startSeconds);
    this.sampleRate = sampleRate && sampleRate > 0 ? sampleRate : null;
    this.framesConsumed = 0;
    this.frameOffset = 0;
  }

  setSampleRate(sampleRate: number | null): void {
    if (sampleRate && sampleRate > 0) {
      this.sampleRate = sampleRate;
    }
  }

  updateFrames(framesConsumed: number): void {
    this.framesConsumed = Math.max(0, framesConsumed);
  }

  rebase(startSeconds: number): void {
    this.startSeconds = Math.max(0, startSeconds);
    this.frameOffset = this.framesConsumed;
  }

  getPositionSeconds(): number {
    if (!this.sampleRate || this.sampleRate <= 0) {
      return this.startSeconds;
    }

    return this.startSeconds + Math.max(0, this.framesConsumed - this.frameOffset) / this.sampleRate;
  }
}
