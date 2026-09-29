import { describe, expect, it, vi } from 'vitest';
import type { LibraryPage, PlaybackHistoryEntry, PlaybackHistoryQuery, PlaybackHistorySummary } from '../../shared/types/library';
import { LibraryService } from './LibraryService';

vi.mock('electron', () => ({
  default: { BrowserWindow: { getAllWindows: () => [] } },
}));
vi.mock('./KgmConverter', () => ({ getKgmConverter: vi.fn() }));

const playback = vi.hoisted(() => ({ state: 'playing' }));
vi.mock('../audio/AudioSession', () => ({
  getAudioSession: () => ({ getStatus: () => ({ state: playback.state }) }),
}));

describe('LibraryService playback history reads', () => {
  it.each(['loading', 'playing'])('reads persisted history and totals while %s', async (state) => {
    playback.state = state;
    const persistedPage: LibraryPage<PlaybackHistoryEntry> = {
      items: [], page: 1, pageSize: 10, total: 31, hasMore: true,
    };
    const persistedSummary: PlaybackHistorySummary = {
      todayCount: 3, todayPlayedSeconds: 540, totalCount: 31,
      latestPlayedAt: '2026-09-26T09:00:00.000Z',
      rangeCount: 31, rangePlayedSeconds: 5580, rangeLatestPlayedAt: '2026-09-26T09:00:00.000Z',
    };
    const store = {
      getPlaybackHistory: vi.fn(() => persistedPage),
      getPlaybackHistorySummary: vi.fn(() => persistedSummary),
    };
    const service: LibraryService = Object.assign(Object.create(LibraryService.prototype), { store });
    const query: PlaybackHistoryQuery = { page: 1, pageSize: 10, sort: 'recent', mediaType: 'local' };

    expect(await service.getPlaybackHistoryPlaybackSafe(query)).toEqual(persistedPage);
    expect(await service.getPlaybackHistorySummaryPlaybackSafe(query)).toEqual(persistedSummary);
    expect(store.getPlaybackHistory).toHaveBeenCalledWith(query);
    expect(store.getPlaybackHistorySummary).toHaveBeenCalledWith(query);

    // A new write must be visible even after an earlier read during playback.
    persistedPage.total += 1;
    persistedSummary.totalCount += 1;
    expect((await service.getPlaybackHistoryPlaybackSafe(query)).total).toBe(32);
    expect((await service.getPlaybackHistorySummaryPlaybackSafe(query)).totalCount).toBe(32);
    expect(store.getPlaybackHistory).toHaveBeenCalledTimes(2);
    expect(store.getPlaybackHistorySummary).toHaveBeenCalledTimes(2);
  });
});
