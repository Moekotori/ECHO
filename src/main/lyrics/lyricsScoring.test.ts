import { describe, expect, it } from 'vitest';
import type { LyricsQuery, LyricsSearchCandidate } from '../../shared/types/lyrics';
import { buildNormalizedLyricsQuery } from './lyricsQueryBuilder';
import { canAutoAcceptLyricsCandidate, evaluateLyricsCandidate, normalizeText, scoreLyricsCandidate } from './lyricsScoring';
import { extractLyricsVersionFlags } from './lyricsVersionFlags';

const query = (overrides: Partial<LyricsQuery> = {}): LyricsQuery => ({
  trackId: 'track-1',
  title: 'Echo Song',
  artist: 'Echo Artist',
  album: 'Echo Album',
  durationSeconds: 120,
  ...overrides,
});

const candidate = (overrides: Partial<LyricsSearchCandidate> = {}): LyricsSearchCandidate => ({
  id: 'candidate-1',
  provider: 'lrclib',
  providerLyricsId: 'lrclib-1',
  title: 'Echo Song',
  artist: 'Echo Artist',
  album: 'Echo Album',
  durationSeconds: 120,
  instrumental: false,
  hasSynced: true,
  hasPlain: true,
  score: 1,
  sourceLabel: 'LRCLIB',
  ...overrides,
});

describe('lyrics version flags', () => {
  it('extracts cover descriptors across languages', () => {
    expect(extractLyricsVersionFlags('Song cover').cover).toBe(true);
    expect(extractLyricsVersionFlags('Song カバー').cover).toBe(true);
    expect(extractLyricsVersionFlags('Song 翻唱').cover).toBe(true);
    expect(extractLyricsVersionFlags('Song 歌ってみた').cover).toBe(true);
  });

  it('extracts live descriptors across languages', () => {
    expect(extractLyricsVersionFlags('Song Live').live).toBe(true);
    expect(extractLyricsVersionFlags('Song 现场').live).toBe(true);
    expect(extractLyricsVersionFlags('Song ライブ').live).toBe(true);
  });

  it('extracts instrumental, off vocal, karaoke, and accompaniment descriptors', () => {
    const flags = extractLyricsVersionFlags('Song Instrumental Off Vocal Karaoke 伴奏');
    expect(flags.instrumental).toBe(true);
    expect(flags.offVocal).toBe(true);
    expect(flags.karaoke).toBe(true);
  });

  it('extracts tv, short, full, remix, and remaster descriptors', () => {
    const flags = extractLyricsVersionFlags('Song TV Size short ver full ver remix remastered');
    expect(flags.tvSize).toBe(true);
    expect(flags.shortVersion).toBe(true);
    expect(flags.longVersion).toBe(true);
    expect(flags.remix).toBe(true);
    expect(flags.remaster).toBe(true);
  });
});

describe('lyrics query builder', () => {
  it('adds conservative featured-artist and title-only search variants', () => {
    const normalized = buildNormalizedLyricsQuery(query({
      title: 'Echo Song (feat. Guest Vocal)',
      artist: 'Echo Artist feat. Guest Vocal',
    }));
    const reasons = normalized.searchVariants.map((variant) => variant.reason);

    expect(reasons).toEqual(expect.arrayContaining([
      'raw_identity',
      'title_without_feature',
      'primary_featured_artist',
      'title_only_fallback',
    ]));
    expect(normalized.searchVariants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Echo Song',
        artist: 'Echo Artist feat. Guest Vocal',
        reason: 'title_without_feature',
      }),
      expect.objectContaining({
        title: 'Echo Song',
        artist: 'Echo Artist',
        reason: 'primary_featured_artist',
      }),
      expect.objectContaining({
        title: 'Echo Song',
        artist: '',
        reason: 'title_only_fallback',
      }),
    ]));
  });

  it('adds bracket and slash title aliases without requiring title-only fallback', () => {
    const normalized = buildNormalizedLyricsQuery(query({
      title: 'Hikari / Light',
      durationSeconds: null,
    }));
    const reasons = normalized.searchVariants.map((variant) => variant.reason);

    expect(normalized.searchVariants).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Hikari', reason: 'title_alias' }),
      expect.objectContaining({ title: 'Light', reason: 'title_alias' }),
    ]));
    expect(reasons).not.toContain('title_only_fallback');
  });

  it('does not treat version descriptors as title aliases', () => {
    const normalized = buildNormalizedLyricsQuery(query({ title: 'Echo Song (Live)' }));

    expect(normalized.searchVariants.some((variant) => variant.reason === 'title_alias')).toBe(false);
  });
});

describe('lyricsScoring', () => {
  it('normalizes descriptors for search but preserves them in version flags', () => {
    expect(normalizeText('Echo Song (TV Size)')).toBe('echo song');
    expect(buildNormalizedLyricsQuery(query({ title: 'Echo Song (TV Size)' })).versionFlags.tvSize).toBe(true);
  });

  it('auto accepts exact synced matches with duration within two seconds', () => {
    const decision = evaluateLyricsCandidate(query(), candidate({ durationSeconds: 121 }));

    expect(decision.score).toBeGreaterThan(0.9);
    expect(decision.autoAccept).toBe(true);
  });

  it('still auto accepts synced lyrics with moderate duration drift when identity is strong', () => {
    const decision = evaluateLyricsCandidate(query(), candidate({ durationSeconds: 126 }));

    expect(decision.score).toBeGreaterThan(0.7);
    expect(decision.autoAccept).toBe(true);
    expect(decision.risk).toBe('low');
  });

  it('marks synced lyrics with more than ten seconds duration drift as high risk', () => {
    const decision = evaluateLyricsCandidate(query(), candidate({ durationSeconds: 132 }));

    expect(decision.score).toBeGreaterThan(0.7);
    expect(decision.autoAccept).toBe(false);
    expect(decision.risk).toBe('high');
    expect(decision.reasons).toContain('duration_mismatch');
  });

  it('strongly reduces score when duration differs by more than twenty seconds', () => {
    expect(scoreLyricsCandidate(query(), candidate({ durationSeconds: 300 }))).toBeLessThan(0.75);
  });

  it('auto accepts version-labeled results when title and duration are otherwise exact', () => {
    expect(evaluateLyricsCandidate(query(), candidate({ title: 'Echo Song Live' })).autoAccept).toBe(true);
    expect(evaluateLyricsCandidate(query(), candidate({ title: 'Echo Song Remix' })).autoAccept).toBe(true);
    expect(evaluateLyricsCandidate(query(), candidate({ title: 'Echo Song TV Size' })).autoAccept).toBe(true);
  });

  it('keeps instrumental mismatches as manual candidates when the query is not instrumental', () => {
    expect(evaluateLyricsCandidate(query(), candidate({ title: 'Echo Song Instrumental', instrumental: true })).autoAccept).toBe(false);
  });

  it('keeps loose cover-intent matches as manual candidates unless they clear the stricter cover threshold', () => {
    const decision = evaluateLyricsCandidate(query({ title: 'Echo Song Cover' }), candidate());

    expect(decision.score).toBeGreaterThan(0.7);
    expect(decision.autoAccept).toBe(false);
    expect(decision.reasons).toContain('cover_intent');
  });

  it('allows cover auto accept only when version and duration are extremely close', () => {
    const decision = evaluateLyricsCandidate(
      query({ title: 'Echo Song Cover', durationSeconds: 120 }),
      candidate({ title: 'Echo Song Cover', durationSeconds: 121 }),
    );

    expect(decision.autoAccept).toBe(true);
    expect(decision.risk).toBe('low');
  });

  it('allows exact cover matches to use the visible auto accept threshold with a conservative floor', () => {
    const decision = evaluateLyricsCandidate(
      query({ title: 'Echo Song Cover', durationSeconds: 120 }),
      candidate({ title: 'Echo Song Cover', durationSeconds: 121, album: null }),
      { autoAcceptScore: 0.82, coverAutoAcceptScore: 0.97 },
    );

    expect(decision.score).toBeLessThan(0.97);
    expect(decision.score).toBeGreaterThanOrEqual(0.9);
    expect(decision.autoAccept).toBe(true);
  });

  it('keeps different artists as manual candidates even when title and duration are close', () => {
    const decision = evaluateLyricsCandidate(query(), candidate({ artist: 'Other Artist' }));

    expect(decision.score).toBeGreaterThan(0.7);
    expect(decision.autoAccept).toBe(false);
    expect(decision.risk).toBe('high');
    expect(decision.reasons).toContain('artist_mismatch');
  });

  it('blocks different artists when the title is only a loose match', () => {
    const decision = evaluateLyricsCandidate(query(), candidate({ title: 'Echo Song Extended', artist: 'Other Artist' }));

    expect(decision.autoAccept).toBe(false);
    expect(decision.risk).toBe('high');
  });

  it('keeps different-artist cover-intent results as manual candidates above the threshold', () => {
    const decision = evaluateLyricsCandidate(query({ title: 'Echo Song Cover' }), candidate({ artist: 'Other Artist' }));

    expect(decision.score).toBeGreaterThan(0.7);
    expect(decision.autoAccept).toBe(false);
    expect(decision.risk).toBe('high');
  });

  it('accepts provider-confirmed instrumental results for instrumental queries', () => {
    const decision = evaluateLyricsCandidate(
      query({ title: 'Echo Song Instrumental' }),
      candidate({ title: 'Echo Song Instrumental', instrumental: true, hasPlain: false, hasSynced: false }),
    );

    expect(decision.versionScore).toBe(1);
    expect(decision.autoAccept).toBe(true);
  });

  it('does not auto accept when title or artist is missing', () => {
    expect(canAutoAcceptLyricsCandidate(query({ artist: '' }), candidate({ score: 0.99 }), 0.9)).toBe(false);
    expect(canAutoAcceptLyricsCandidate(query({ title: '' }), candidate({ score: 0.99 }), 0.9)).toBe(false);
  });
});
