import { describe, expect, it } from 'vitest';
import type { LyricsSearchCandidate } from '../../shared/types/lyrics';
import { sortLyricsCandidates } from './lyricsCandidateDedup';

const candidate = (overrides: Partial<LyricsSearchCandidate> = {}): LyricsSearchCandidate => ({
  id: 'candidate-1',
  provider: 'lrclib',
  providerLyricsId: 'provider-lyrics-1',
  title: 'Echo Song',
  artist: 'Echo Artist',
  album: 'Echo Album',
  durationSeconds: 120,
  instrumental: false,
  hasSynced: true,
  hasPlain: false,
  score: 0.9,
  sourceLabel: 'LRCLIB',
  risk: 'low',
  reasons: [],
  ...overrides,
});

describe('sortLyricsCandidates', () => {
  it('ranks higher scoring online candidates above lower scoring local auto-accept candidates', () => {
    const sorted = sortLyricsCandidates(120, [
      candidate({
        id: 'local-50',
        provider: 'local',
        providerLyricsId: 'local-50',
        score: 0.5,
        sourceLabel: 'Local LRC',
        reasons: ['local_sidecar_priority', 'auto_accept'],
      }),
      candidate({
        id: 'online-100',
        provider: 'qqmusic',
        providerLyricsId: 'online-100',
        score: 1,
        sourceLabel: 'QQ Music',
      }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['online-100', 'local-50']);
  });

  it('still prefers local candidates when scores are tied', () => {
    const sorted = sortLyricsCandidates(120, [
      candidate({ id: 'online-100', provider: 'qqmusic', providerLyricsId: 'online-100', score: 1 }),
      candidate({
        id: 'local-100',
        provider: 'local',
        providerLyricsId: 'local-100',
        score: 1,
        sourceLabel: 'Local LRC',
      }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['local-100', 'online-100']);
  });
});
