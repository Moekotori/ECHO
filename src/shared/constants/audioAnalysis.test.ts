import { describe, expect, it } from 'vitest';
import { BPM_ANALYSIS_VERSION, BPM_ANALYSIS_VERSION_FIELD, shouldAnalyzeBpm } from './audioAnalysis';

describe('BPM analysis source precedence', () => {
  it('keeps BPM read from an osu timing point or embedded tag', () => {
    expect(shouldAnalyzeBpm({
      bpm: 210,
      bpmConfidence: 1,
      analysisStatus: 'complete',
      fieldSources: { bpm: 'osu', osu: 'osu' },
    })).toBe(false);
    expect(shouldAnalyzeBpm({
      bpm: 126,
      bpmConfidence: 1,
      analysisStatus: 'complete',
      fieldSources: { bpm: 'embedded' },
    })).toBe(false);
  });

  it('reanalyzes legacy estimates once and leaves current estimates alone', () => {
    expect(shouldAnalyzeBpm({
      bpm: 105,
      bpmConfidence: 0.72,
      analysisStatus: 'complete',
      fieldSources: { bpm: 'audio_analysis', osu: 'osu' },
    })).toBe(true);
    expect(shouldAnalyzeBpm({
      bpm: 210,
      bpmConfidence: 0.72,
      analysisStatus: 'complete',
      fieldSources: {
        bpm: 'audio_analysis',
        [BPM_ANALYSIS_VERSION_FIELD]: String(BPM_ANALYSIS_VERSION),
      },
    })).toBe(false);
  });

  it('does not retry a current failed analysis on every playback', () => {
    expect(shouldAnalyzeBpm({
      bpm: null,
      bpmConfidence: 0,
      analysisStatus: 'error',
      fieldSources: {
        [BPM_ANALYSIS_VERSION_FIELD]: String(BPM_ANALYSIS_VERSION),
      },
    })).toBe(false);
  });
});
