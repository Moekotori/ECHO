import { describe, expect, it, vi } from 'vitest';
import type { LibraryTrack } from '../../shared/types/library';
import type { MvMatchCandidate, MvSettings } from '../../shared/types/mv';
import type { MainMvOnlineProvider } from './OnlineMvProviders';
import { MvSearchCoordinator } from './MvSearchCoordinator';
import { MV_MATCH_ALGORITHM_VERSION } from './MvScoring';

const track = {
  id: 'track', path: '', title: 'Echo Song', artist: 'Singer', album: '', albumArtist: 'Singer', duration: 120,
  trackNo: null, discNo: null, year: null, genre: null, codec: null, sampleRate: null, bitDepth: null,
  bitrate: null, coverId: null, coverThumb: null, fieldSources: {},
} satisfies LibraryTrack;
const settings: MvSettings = {
  autoSearch: true, autoPreload: true, restartAudioOnLoad: false, enabledProviders: ['bilibili'],
  providerOrder: ['bilibili'], maxQuality: 'max', allow60fps: true,
};
const candidate: MvMatchCandidate = {
  id: 'bilibili:one', provider: 'bilibili', title: 'Echo Song', artist: 'Singer', sourceType: 'search_candidate',
  filePath: null, url: null, providerUrl: null, thumbnailUrl: null, uploader: 'Singer', availableQualities: [],
  durationSeconds: 120, score: 0.95, autoEligible: true, matchVersion: MV_MATCH_ALGORITHM_VERSION,
  playableInApp: true, reasons: [],
};
const harness = (search: MainMvOnlineProvider['search']) => {
  const provider: MainMvOnlineProvider = { id: 'bilibili', search: vi.fn(search), resolve: vi.fn(async () => []) };
  return { provider, coordinator: new MvSearchCoordinator(new Map([['bilibili', provider]])) };
};

describe('MV search scheduling', () => {
  it('shares concurrent identical requests and skips fallback after a safe match', async () => {
    let finish!: (value: MvMatchCandidate[]) => void;
    const { coordinator, provider } = harness(() => new Promise((resolve) => { finish = resolve; }));
    const first = coordinator.search(track, settings);
    const second = coordinator.search(track, settings);
    expect(provider.search).toHaveBeenCalledTimes(1);
    finish([candidate]);
    expect(await first).toEqual([candidate]);
    expect(await second).toEqual([candidate]);
    expect(provider.search).toHaveBeenCalledTimes(1);
  });

  it('uses a clean song and performer query for covers without requiring MV', async () => {
    const { coordinator, provider } = harness(async () => [candidate]);
    await coordinator.search({ ...track, title: 'Echo Song (Cover. Original)' }, settings);
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(provider.search).toHaveBeenCalledWith(expect.anything(), settings, 'Echo Song Singer');
  });

  it('preserves explicit queries without fallback', async () => {
    const { coordinator, provider } = harness(async () => []);
    await coordinator.search(track, settings, 'My specific search');
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(provider.search).toHaveBeenCalledWith(track, settings, 'My specific search');
  });

  it('keeps primary manual candidates when a fallback fails', async () => {
    const manual = { ...candidate, score: 0.4, autoEligible: false };
    const { coordinator } = harness(async (_track, _settings, query) => {
      if (query?.endsWith(' MV')) return [manual];
      throw new Error('temporary network error');
    });
    expect(await coordinator.search(track, settings)).toEqual([manual]);
  });

  it('clears failed lookups so the next attempt can recover', async () => {
    const { coordinator, provider } = harness(async () => { throw new Error('offline'); });
    expect(await coordinator.search(track, settings)).toEqual([]);
    vi.mocked(provider.search).mockResolvedValue([candidate]);
    expect(await coordinator.search(track, settings)).toEqual([candidate]);
    expect(provider.search).toHaveBeenCalledTimes(3);
  });

  it('does not share lookup results across different recording durations', async () => {
    const { coordinator, provider } = harness(async () => [candidate]);
    await Promise.all([
      coordinator.search(track, settings),
      coordinator.search({ ...track, duration: 200 }, settings),
    ]);
    expect(provider.search).toHaveBeenCalledTimes(2);
  });
});
