// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from 'vitest';
import type { LyricsSearchCandidate } from '../../../shared/types/lyrics';
import {
  readLyricsSourceQualitySummaries,
  recordLyricsSourceQualityCandidates,
  recordLyricsSourceQualityOutcome,
} from './lyricsSourceQualityMemory';

const makeCandidate = (
  overrides: Partial<LyricsSearchCandidate> = {},
): LyricsSearchCandidate => ({
  id: 'candidate-1',
  provider: 'lrclib',
  providerLyricsId: 'provider-lyrics-1',
  title: 'Test Song',
  artist: 'Test Artist',
  album: 'Test Album',
  durationSeconds: 180,
  instrumental: false,
  hasSynced: true,
  hasPlain: true,
  score: 0.86,
  sourceLabel: 'LRCLIB',
  risk: 'low',
  reasons: ['title_exact', 'artist_exact'],
  ...overrides,
});

describe('lyricsSourceQualityMemory', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores lean provider quality summaries without track metadata', () => {
    const candidate = makeCandidate();

    expect(recordLyricsSourceQualityCandidates([candidate], 1000)).toBe(true);
    expect(recordLyricsSourceQualityOutcome(candidate, 'applied', 2000)).toBe(true);

    const summaries = readLyricsSourceQualitySummaries();
    expect(summaries).toMatchObject([
      {
        provider: 'lrclib',
        candidateCount: 1,
        appliedCount: 1,
        averageScore: 0.86,
        bestScore: 0.86,
        lowRiskCount: 1,
        syncedCount: 1,
      },
    ]);

    const raw = window.localStorage.getItem('echo-next.lyrics.source-quality.v1') ?? '';
    expect(raw).not.toContain('Test Song');
    expect(raw).not.toContain('Test Artist');
  });

  it('caps stored events to a small rolling window', () => {
    for (let index = 0; index < 390; index += 1) {
      recordLyricsSourceQualityCandidates([
        makeCandidate({
          id: `candidate-${index}`,
          score: index % 2 === 0 ? 0.8 : 0.6,
        }),
      ], index);
    }

    const raw = JSON.parse(window.localStorage.getItem('echo-next.lyrics.source-quality.v1') ?? '{}') as {
      events?: unknown[];
    };
    expect(raw.events?.length).toBe(360);
  });
});
