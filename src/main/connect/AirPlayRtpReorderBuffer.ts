export type AirPlayRtpReorderBufferOptions<T> = {
  maxPendingPackets?: number;
  maxWaitMs?: number;
  onPacket: (packet: T) => void;
  onGap: (missingPackets: number) => void;
};

const sequenceModulus = 0x1_0000;
const sequenceHalfRange = sequenceModulus / 2;

const sequenceDistance = (from: number, to: number): number =>
  (to - from + sequenceModulus) % sequenceModulus;

/**
 * Keeps a small, bounded RTP reorder window. Missing packets are released as a
 * gap after a short deadline so a sender cannot grow main-process memory.
 */
export class AirPlayRtpReorderBuffer<T> {
  private readonly maxPendingPackets: number;
  private readonly maxWaitMs: number;
  private readonly onPacket: (packet: T) => void;
  private readonly onGap: (missingPackets: number) => void;
  private readonly pending = new Map<number, T>();
  private expectedSequence: number | null = null;
  private gapTimer: NodeJS.Timeout | null = null;

  constructor(options: AirPlayRtpReorderBufferOptions<T>) {
    this.maxPendingPackets = Math.max(1, Math.round(options.maxPendingPackets ?? 32));
    this.maxWaitMs = Math.max(1, Math.round(options.maxWaitMs ?? 30));
    this.onPacket = options.onPacket;
    this.onGap = options.onGap;
  }

  push(sequenceNumber: number, packet: T): void {
    const sequence = sequenceNumber & 0xffff;
    if (this.expectedSequence === null) {
      this.expectedSequence = sequence;
    }

    const distance = sequenceDistance(this.expectedSequence, sequence);
    if (distance >= sequenceHalfRange) {
      return;
    }
    if (!this.pending.has(sequence)) {
      this.pending.set(sequence, packet);
    }

    this.releaseContiguous();
    if (this.pending.size >= this.maxPendingPackets) {
      this.releaseGap();
    } else {
      this.scheduleGapDeadline();
    }
  }

  reset(): void {
    this.clearGapTimer();
    this.pending.clear();
    this.expectedSequence = null;
  }

  private releaseContiguous(): void {
    while (this.expectedSequence !== null) {
      const packet = this.pending.get(this.expectedSequence);
      if (packet === undefined) {
        break;
      }
      this.pending.delete(this.expectedSequence);
      this.onPacket(packet);
      this.expectedSequence = (this.expectedSequence + 1) & 0xffff;
    }

    if (this.pending.size === 0) {
      this.clearGapTimer();
    }
  }

  private releaseGap(): void {
    this.clearGapTimer();
    if (this.expectedSequence === null || this.pending.size === 0) {
      return;
    }

    let nearestSequence: number | null = null;
    let nearestDistance = sequenceModulus;
    for (const sequence of this.pending.keys()) {
      const distance = sequenceDistance(this.expectedSequence, sequence);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestSequence = sequence;
      }
    }
    if (nearestSequence === null || nearestDistance >= sequenceHalfRange) {
      this.reset();
      return;
    }

    if (nearestDistance > 0) {
      this.onGap(nearestDistance);
      this.expectedSequence = nearestSequence;
    }
    this.releaseContiguous();
    this.scheduleGapDeadline();
  }

  private scheduleGapDeadline(): void {
    if (this.gapTimer || this.pending.size === 0) {
      return;
    }
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      this.releaseGap();
    }, this.maxWaitMs);
    this.gapTimer.unref?.();
  }

  private clearGapTimer(): void {
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
  }
}
