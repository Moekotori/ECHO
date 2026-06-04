import { describe, expect, it } from 'vitest';
import { evaluateLyricsSmartAlignment, getLyricsSmartAlignmentRawOffset, suggestLyricsSmartAlignment } from './lyricsSmartAlignment';
import type { LyricsSmartAlignmentAnchor } from './lyricsSmartAlignment';

const anchor = (overrides: Partial<LyricsSmartAlignmentAnchor> = {}): LyricsSmartAlignmentAnchor => ({
  lyricLineTimeMs: 10000,
  playbackMs: 10200,
  globalOffsetMs: 0,
  outputMode: 'shared',
  ...overrides,
});

describe('lyrics smart alignment', () => {
  it('computes the same raw offset formula used by manual alignment', () => {
    expect(getLyricsSmartAlignmentRawOffset(anchor({ globalOffsetMs: 1000 }))).toBe(-1200);
  });

  it('keeps one anchor as a suggestion but does not auto apply it', () => {
    expect(suggestLyricsSmartAlignment([anchor()])).toMatchObject({
      offsetMs: -200,
      confidence: 'medium',
      reason: 'single_anchor',
      outputMode: 'shared',
      anchorCount: 1,
      canApply: true,
      canAutoApply: false,
      rejectedAnchors: [],
    });
  });

  it('auto-applies stable multiple anchors', () => {
    expect(
      evaluateLyricsSmartAlignment({
        anchors: [
          anchor({ playbackMs: 10200 }),
          anchor({ playbackMs: 10240 }),
          anchor({ playbackMs: 10180 }),
        ],
      }),
    ).toMatchObject({
      offsetMs: -200,
      confidence: 'high',
      reason: 'stable_anchors',
      anchorCount: 3,
      spreadMs: 40,
      action: 'auto_apply',
      canAutoApply: true,
      canApply: true,
    });
  });

  it('auto-applies a high-confidence offset from matched candidate timelines', () => {
    expect(
      evaluateLyricsSmartAlignment({
        currentLines: [
          { timeMs: 10000, text: 'First line' },
          { timeMs: 20000, text: 'Second line' },
          { timeMs: 30000, text: 'Third line' },
        ],
        candidates: [
          {
            id: 'candidate-1',
            lines: [
              { timeMs: 9800, text: 'First line' },
              { timeMs: 19800, text: 'Second line' },
              { timeMs: 29800, text: 'Third line' },
            ],
          },
        ],
      }),
    ).toMatchObject({
      offsetMs: 200,
      confidence: 'high',
      reason: 'stable_candidates',
      action: 'auto_apply',
      candidateCount: 1,
      matchedLineCount: 3,
      canAutoApply: true,
    });
  });

  it('rejects outlier anchors and lowers confidence', () => {
    const suggestion = evaluateLyricsSmartAlignment({
      anchors: [
        anchor({ playbackMs: 10200 }),
        anchor({ playbackMs: 10180 }),
        anchor({ playbackMs: 17000 }),
      ],
    });

    expect(suggestion).toMatchObject({
      offsetMs: -190,
      confidence: 'low',
      reason: 'outlier_rejected',
      anchorCount: 3,
      canApply: false,
      canAutoApply: false,
    });
    expect(suggestion?.rejectedAnchors).toHaveLength(1);
  });

  it('does not auto-apply when candidate text matches too few lines', () => {
    expect(
      evaluateLyricsSmartAlignment({
        currentLines: [
          { timeMs: 10000, text: 'First line' },
          { timeMs: 20000, text: 'Second line' },
          { timeMs: 30000, text: 'Third line' },
        ],
        candidates: [
          {
            id: 'candidate-1',
            lines: [
              { timeMs: 9800, text: 'First line' },
              { timeMs: 19800, text: 'Different line' },
              { timeMs: 29800, text: 'Another line' },
            ],
          },
        ],
      }),
    ).toMatchObject({
      reason: 'no_candidate_match',
      canAutoApply: false,
      evidenceCount: 0,
    });
  });

  it('blocks low-confidence suggestions when anchors are unstable', () => {
    expect(
      suggestLyricsSmartAlignment([
        anchor({ playbackMs: 10200 }),
        anchor({ playbackMs: 11400 }),
      ]),
    ).toMatchObject({
      offsetMs: -800,
      confidence: 'low',
      reason: 'unstable_evidence',
      spreadMs: 600,
      canApply: false,
    });
  });

  it('flags possible timeline drift without creating segmented corrections', () => {
    const suggestion = evaluateLyricsSmartAlignment({
      anchors: [
        anchor({ lyricLineTimeMs: 0, playbackMs: 100 }),
        anchor({ lyricLineTimeMs: 30000, playbackMs: 30300 }),
        anchor({ lyricLineTimeMs: 60000, playbackMs: 60850 }),
      ],
    });

    expect(suggestion).toMatchObject({
      offsetMs: -300,
      confidence: 'low',
      reason: 'possible_drift',
      driftDetected: true,
      driftMs: -750,
      action: 'needs_rematch',
      canAutoApply: false,
      canApply: false,
    });
  });

  it('blocks extreme automatic offset changes', () => {
    expect(evaluateLyricsSmartAlignment({
      anchors: [
        anchor({ lyricLineTimeMs: 60000, playbackMs: 0 }),
        anchor({ lyricLineTimeMs: 70000, playbackMs: 10000 }),
      ],
    })).toMatchObject({
      offsetMs: 10000,
      reason: 'offset_too_large',
      action: 'needs_rematch',
      canAutoApply: false,
    });
    expect(suggestLyricsSmartAlignment([anchor({ lyricLineTimeMs: 60000, playbackMs: 0 })])?.offsetMs).toBe(10000);
    expect(suggestLyricsSmartAlignment([anchor({ lyricLineTimeMs: 0, playbackMs: 60000 })])?.offsetMs).toBe(-10000);
  });

  it('keeps ASIO, exclusive, and system output modes on the suggestion', () => {
    expect(suggestLyricsSmartAlignment([anchor({ outputMode: 'asio' })])?.outputMode).toBe('asio');
    expect(suggestLyricsSmartAlignment([anchor({ outputMode: 'exclusive' })])?.outputMode).toBe('exclusive');
    expect(suggestLyricsSmartAlignment([anchor({ outputMode: 'system' })])?.outputMode).toBe('system');
  });
});
