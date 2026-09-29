import { describe, expect, it } from 'vitest';
import type { LyricsSearchCandidate } from '../../shared/types/lyrics';
import { dedupeLyricsCandidates, sortLyricsCandidates } from './lyricsCandidateDedup';

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

  it('prefers word-timed lyrics when otherwise equivalent candidates have near-equal scores', () => {
    const sorted = sortLyricsCandidates(120, [
      candidate({ id: 'line-timed', score: 0.91, hasWordTiming: false }),
      candidate({ id: 'word-timed', provider: 'netease', score: 0.9, hasWordTiming: true }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['word-timed', 'line-timed']);
  });
});

describe('dedupeLyricsCandidates', () => {
  it('does not merge identical lyric text across different title identities', () => {
    const deduped = dedupeLyricsCandidates([
      candidate({
        id: 'song-a',
        providerLyricsId: 'song-a',
        contentFingerprint: 'same-body',
        title: 'Echo Song',
        artist: 'Echo Artist',
      }),
      candidate({
        id: 'song-b',
        provider: 'netease',
        providerLyricsId: 'song-b',
        contentFingerprint: 'same-body',
        title: 'Another Song',
        artist: 'Echo Artist',
      }),
    ]);

    expect(deduped).toHaveLength(2);
  });

  it('keeps the word-timed source when equivalent lyric content is deduplicated', () => {
    const deduped = dedupeLyricsCandidates([
      candidate({
        id: 'line-timed',
        providerLyricsId: 'line-timed',
        contentFingerprint: 'same-body',
        score: 0.91,
      }),
      candidate({
        id: 'word-timed',
        provider: 'netease',
        providerLyricsId: 'word-timed',
        contentFingerprint: 'same-body',
        hasWordTiming: true,
        score: 0.9,
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe('word-timed');
  });
});
