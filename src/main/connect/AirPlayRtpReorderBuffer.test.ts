import { afterEach, describe, expect, it, vi } from 'vitest';
import { AirPlayRtpReorderBuffer } from './AirPlayRtpReorderBuffer';

describe('AirPlayRtpReorderBuffer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('releases out-of-order packets in sequence', () => {
    const packets: string[] = [];
    const gaps: number[] = [];
    const buffer = new AirPlayRtpReorderBuffer<string>({
      onPacket: (packet) => packets.push(packet),
      onGap: (gap) => gaps.push(gap),
    });

    buffer.push(100, '100');
    buffer.push(102, '102');
    buffer.push(101, '101');

    expect(packets).toEqual(['100', '101', '102']);
    expect(gaps).toEqual([]);
  });

  it('bounds a missing packet and advances after the reorder deadline', () => {
    vi.useFakeTimers();
    const packets: string[] = [];
    const gaps: number[] = [];
    const buffer = new AirPlayRtpReorderBuffer<string>({
      maxWaitMs: 25,
      onPacket: (packet) => packets.push(packet),
      onGap: (gap) => gaps.push(gap),
    });

    buffer.push(200, '200');
    buffer.push(202, '202');
    vi.advanceTimersByTime(25);

    expect(gaps).toEqual([1]);
    expect(packets).toEqual(['200', '202']);
  });

  it('handles sequence wraparound and drops late duplicates', () => {
    const packets: string[] = [];
    const buffer = new AirPlayRtpReorderBuffer<string>({
      onPacket: (packet) => packets.push(packet),
      onGap: () => undefined,
    });

    buffer.push(0xffff, 'last');
    buffer.push(0, 'first');
    buffer.push(0xffff, 'duplicate');

    expect(packets).toEqual(['last', 'first']);
  });
});
