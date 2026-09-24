import { describe, expect, it } from 'vitest';
import type { LyricsQuery, LyricsSearchCandidate } from '../../shared/types/lyrics';
import { buildNormalizedLyricsQuery } from './lyricsQueryBuilder';
import {
  canAutoAcceptLyricsCandidate,
  evaluateLyricsCandidate,
  getLyricsDurationTolerance,
  normalizeText,
  scoreLyricsCandidate,
} from './lyricsScoring';
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

  it('classifies exact identity with six seconds duration drift as balanced', () => {
    const decision = evaluateLyricsCandidate(query(), candidate({ durationSeconds: 126 }));

    expect(decision.score).toBeGreaterThan(0.7);
    expect(decision.autoAccept).toBe(true);
    expect(decision.risk).toBe('medium');
    expect(decision.confidence).toBe('balanced');
  });

  it('allows a twelve-second duration drift for an exact two-minute track match', () => {
    const decision = evaluateLyricsCandidate(query(), candidate({ durationSeconds: 132 }));

    expect(decision.score).toBeGreaterThan(0.8);
    expect(decision.autoAccept).toBe(true);
    expect(decision.risk).toBe('medium');
    expect(decision.confidence).toBe('balanced');
    expect(decision.reasons).toContain('duration_tolerated');
  });

  it('uses a larger duration tolerance for longer tracks with a twenty-second ceiling', () => {
    expect(getLyricsDurationTolerance(120)).toBe(12);
    expect(getLyricsDurationTolerance(180)).toBe(14.4);
    expect(getLyricsDurationTolerance(240)).toBe(19.2);
    expect(getLyricsDurationTolerance(600)).toBe(20);

    const decision = evaluateLyricsCandidate(
      query({ durationSeconds: 240 }),
      candidate({ durationSeconds: 259 }),
    );

    expect(decision.autoAccept).toBe(true);
    expect(decision.confidence).toBe('balanced');
    expect(decision.reasons).toContain('duration_tolerated');
  });

  it('still blocks duration drift outside the adaptive tolerance', () => {
    const decision = evaluateLyricsCandidate(query(), candidate({ durationSeconds: 133 }));

    expect(decision.autoAccept).toBe(false);
    expect(decision.risk).toBe('medium');
    expect(decision.confidence).toBe('blocked');
    expect(decision.reasons).toContain('duration_mismatch');
  });

  it('strongly reduces score when duration differs by more than twenty seconds', () => {
    expect(scoreLyricsCandidate(query(), candidate({ durationSeconds: 300 }))).toBeLessThan(0.75);
  });

  it('blocks version conflicts even when duration is exact', () => {
    expect(evaluateLyricsCandidate(query(), candidate({ title: 'Echo Song Live' })).autoAccept).toBe(false);
    expect(evaluateLyricsCandidate(query(), candidate({ title: 'Echo Song Remix' })).autoAccept).toBe(false);
    expect(evaluateLyricsCandidate(query(), candidate({ title: 'Echo Song TV Size' })).autoAccept).toBe(false);
  });

  it('does not treat an appended artist as an exact artist match', () => {
    const decision = evaluateLyricsCandidate(
      query({ title: '晴天', artist: '周杰伦', durationSeconds: 269 }),
      candidate({ title: '晴天', artist: '周杰伦 / A-LNK', durationSeconds: 269 }),
    );

    expect(decision.artistScore).toBeLessThan(0.98);
    expect(decision.autoAccept).toBe(false);
    expect(decision.confidence).toBe('blocked');
  });

  it('blocks the known short adaptation regressions for 晴天 and 青花瓷', () => {
    const qingTian = evaluateLyricsCandidate(
      query({ title: '晴天', artist: '周杰伦', durationSeconds: 269 }),
      candidate({ title: '晴天', artist: '周杰伦 / A-LNK', durationSeconds: 183, hasSynced: false, hasPlain: true }),
    );
    const qingHuaCi = evaluateLyricsCandidate(
      query({ title: '青花瓷', artist: '周杰伦', durationSeconds: 239 }),
      candidate({ title: '青花瓷', artist: '周杰伦 / INKK', durationSeconds: 92, hasSynced: false, hasPlain: true }),
    );

    expect(qingTian.autoAccept).toBe(false);
    expect(qingHuaCi.autoAccept).toBe(false);
    expect(qingTian.risk).toBe('high');
    expect(qingHuaCi.risk).toBe('high');
  });

  it('applies the same duration safety rule to plain lyrics', () => {
    const decision = evaluateLyricsCandidate(
      query(),
      candidate({ durationSeconds: 143, hasSynced: false, hasPlain: true }),
    );

    expect(decision.autoAccept).toBe(false);
    expect(decision.risk).toBe('high');
    expect(decision.durationDeltaSeconds).toBe(23);
  });

  it('keeps instrumental mismatches as manual candidates when the query is not instrumental', () => {
    expect(evaluateLyricsCandidate(query(), candidate({ title: 'Echo Song Instrumental', instrumental: true })).autoAccept).toBe(false);
  });

  it('blocks provider-confirmed instrumental results even when metadata lacks an instrumental label', () => {
    const decision = evaluateLyricsCandidate(
      query(),
      candidate({ instrumental: true, hasSynced: false, hasPlain: false }),
    );

    expect(decision.versionScore).toBe(0.1);
    expect(decision.autoAccept).toBe(false);
    expect(decision.risk).toBe('high');
    expect(decision.reasons).toContain('version_conflict');
  });

  it('keeps exact candidates without a reliable duration for manual selection', () => {
    const decision = evaluateLyricsCandidate(query(), candidate({ durationSeconds: null }));

    expect(decision.score).toBeGreaterThan(0.8);
    expect(decision.autoAccept).toBe(false);
    expect(decision.confidence).toBe('blocked');
    expect(decision.risk).toBe('medium');
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
