import { describe, expect, it, vi } from 'vitest';
import type { LibraryStore } from '../LibraryStore';
import type { LibraryTrack } from '../libraryTypes';
import { BpmAnalysisJobQueue } from './BpmAnalysisJobQueue';
import { ReplayGainAnalysisJobQueue } from './ReplayGainAnalysisJobQueue';
import type { BpmAnalyzer } from './BpmAnalyzer';
import type { ReplayGainAnalyzer } from './ReplayGainAnalyzer';

vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(), existsSync: () => true,
}));
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const result = { bpm: 120, confidence: 1, beatOffsetMs: 0, trackGainDb: -1, trackPeak: 0.8, integratedLufs: -15 };
function fixture(kind: 'bpm' | 'gain', analyze = vi.fn().mockResolvedValue(result)) {
  const track = { id: 'one', path: '/fixture.flac', title: 'Song', duration: 180, fieldSources: {} } as LibraryTrack;
  const select = vi.fn(() => [track]);
  const store = { findBpmAnalysisTargets: select, findReplayGainAnalysisTargets: select,
    markTrackAnalyzing: vi.fn(), updateTrackBpmAnalysis: vi.fn(),
    markTrackReplayGainAnalyzing: vi.fn(), updateTrackReplayGainAnalysis: vi.fn() } as unknown as LibraryStore;
  const queue = kind === 'bpm'
    ? new BpmAnalysisJobQueue(store, { analyzer: { analyze } as unknown as BpmAnalyzer })
    : new ReplayGainAnalysisJobQueue(store, { analyzer: { analyze } as unknown as ReplayGainAnalyzer });
  return { queue, select };
}

describe.each(['bpm', 'gain'] as const)('%s analysis queue bounds', kind => {
  it('keeps a later request behind an already running second job', async () => {
    const gates: Array<() => void> = [];
    const analyze = vi.fn(() => new Promise(resolve => gates.push(() => resolve(result))));
    const { queue } = fixture(kind, analyze);
    queue.start();
    const second = queue.start();
    await flush();
    gates.shift()!();
    await flush();
    const third = queue.start();
    await flush();
    expect(analyze).toHaveBeenCalledTimes(2);
    gates.shift()!();
    await flush();
    expect(analyze).toHaveBeenCalledTimes(3);
    gates.shift()!();
    await flush();
    expect(queue.getStatus(second.id).status).toBe('completed');
    expect(queue.getStatus(third.id).status).toBe('completed');
  });

  it('rejects excess requests before retaining more targets', async () => {
    const { queue, select } = fixture(kind);
    for (let index = 0; index < 8; index += 1) queue.start();
    expect(() => queue.start()).toThrow('Too many queued analysis jobs');
    expect(select).toHaveBeenCalledTimes(8);
    await flush();
    expect(() => queue.start()).not.toThrow();
    await flush();
  });

  it('retains only the latest twenty completed statuses', async () => {
    const { queue } = fixture(kind);
    const ids: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      ids.push(queue.start().id);
      await flush();
    }
    expect(() => queue.getStatus(ids[0]!)).toThrow('Unknown');
    expect(queue.getStatus(ids[5]!).status).toBe('completed');
    expect(queue.getStatus(ids[24]!).status).toBe('completed');
  });
});
