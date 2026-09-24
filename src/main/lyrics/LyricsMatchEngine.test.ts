import { describe, expect, it, vi } from 'vitest';
import type { LyricsProvider, LyricsProviderResult, LyricsProviderSearchRequest } from './LyricsProvider';
import { LyricsMatchEngine } from './LyricsMatchEngine';

const provider = (
  id: 'local' | 'lrclib' | 'netease' | 'qqmusic' | 'kugou' | 'kuwo',
  results: LyricsProviderResult[],
  delayMs = 0,
  capabilities: Partial<LyricsProvider['capabilities']> = {},
): LyricsProvider => ({
  id,
  label: id === 'local' ? 'Local' : id === 'lrclib' ? 'LRCLIB' : id === 'netease' ? 'NetEase Lyrics' : id === 'qqmusic' ? 'QQ Music' : id === 'kugou' ? 'KuGou' : 'Kuwo',
  priority: id === 'local' ? 1000 : id === 'lrclib' ? 700 : id === 'netease' ? 600 : id === 'qqmusic' ? 590 : id === 'kugou' ? 570 : 560,
  capabilities: {
    synced: true,
    plain: true,
    translation: false,
    romanization: false,
    byDuration: true,
    byIsrc: false,
    byMusicBrainzId: false,
    needsAccount: false,
    ...capabilities,
  },
  search: vi.fn(async (request: LyricsProviderSearchRequest) => {
    if (delayMs) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        request.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }

    return request.signal?.aborted ? [] : results;
  }),
});

const hangingProvider = (
  id: 'lrclib' | 'netease' | 'qqmusic' | 'kugou' | 'kuwo',
): LyricsProvider => ({
  id,
  label: id,
  priority: 600,
  capabilities: {
    synced: true,
    plain: true,
    translation: false,
    romanization: false,
    byDuration: true,
    byIsrc: false,
    byMusicBrainzId: false,
    needsAccount: false,
  },
  search: vi.fn(() => new Promise<LyricsProviderResult[]>(() => {})),
});

const result = (overrides: Partial<LyricsProviderResult> = {}): LyricsProviderResult => ({
  provider: 'lrclib',
  providerLyricsId: 'same-id',
  title: 'Echo Song',
  artist: 'Echo Artist',
  album: 'Echo Album',
  durationSeconds: 120,
  instrumental: false,
  plainLyrics: 'Line',
  syncedLyrics: '[00:01.00]Line',
  raw: { id: 'same-id', syncedLyrics: '[00:01.00]Line' },
  ...overrides,
});

const query = {
  trackId: 'track-1',
  title: 'Echo Song',
  artist: 'Echo Artist',
  album: 'Echo Album',
  durationSeconds: 120,
};

describe('LyricsMatchEngine', () => {
  it('deduplicates candidates returned by multiple providers', async () => {
    const engine = new LyricsMatchEngine([
      provider('lrclib', [result()]),
      provider('netease', [result({ provider: 'netease', providerLyricsId: null })]),
    ]);

    const matched = await engine.match(query, { enabledProviders: ['lrclib', 'netease'] });

    expect(matched.candidates).toHaveLength(1);
  });

  it('returns and marks a high-confidence auto accept result', async () => {
    const engine = new LyricsMatchEngine([provider('lrclib', [result()])]);

    const matched = await engine.match(query, { enabledProviders: ['lrclib'] });

    expect(matched.accepted?.decision.autoAccept).toBe(true);
  });

  it('keeps duration-mismatched local sidecars manual and continues to network providers', async () => {
    const engine = new LyricsMatchEngine([
      provider('local', [
        result({
          provider: 'local',
          providerLyricsId: 'local-long',
          matchReasons: ['local_sidecar_priority', 'duration_mismatch', 'candidate_only_duration'],
          plainLyrics: 'Different local line',
          syncedLyrics: '[00:01.00]Different local line',
          raw: { filePath: 'Echo Song.lrc' },
        }),
      ]),
      provider('lrclib', [result({ providerLyricsId: 'network-hit', raw: { id: 'network-hit' } })]),
    ]);

    const matched = await engine.match(query, { enabledProviders: ['local', 'lrclib'] });
    const localCandidate = matched.candidates.find((candidate) => candidate.provider === 'local');

    expect(matched.accepted?.providerLyricsId).toBe('network-hit');
    expect(localCandidate?.decision.autoAccept).toBe(false);
    expect(localCandidate?.risk).toBe('medium');
    expect(localCandidate?.score).toBe(0.42);
  });

  it('treats karaoke-only provider results as synced candidates', async () => {
    const engine = new LyricsMatchEngine([
      provider('netease', [
        result({
          provider: 'netease',
          syncedLyrics: null,
          plainLyrics: null,
          karaokeLyrics: '[00:01.00]<00:01.00>Hello <00:01.50>world',
        }),
      ]),
    ]);

    const matched = await engine.match(query, { enabledProviders: ['netease'] });

    expect(matched.candidates[0].hasSynced).toBe(true);
    expect(matched.candidates[0].hasWordTiming).toBe(true);
    expect(matched.candidates[0].reasons).toContain('word_timed');
  });

  it('accepts exact cover matches instead of leaving them as candidates only', async () => {
    const engine = new LyricsMatchEngine([
      provider('lrclib', [result({ title: 'Echo Song Cover', album: null, durationSeconds: 121 })]),
    ]);

    const matched = await engine.match(
      { ...query, title: 'Echo Song Cover' },
      { enabledProviders: ['lrclib'], autoAcceptScore: 0.82, coverAutoAcceptScore: 0.97 },
    );

    expect(matched.accepted?.decision.autoAccept).toBe(true);
    expect(matched.accepted?.risk).toBe('low');
  });

  it('keeps rejected results as candidates only', async () => {
    const engine = new LyricsMatchEngine([provider('lrclib', [result({ durationSeconds: 180 })])]);

    const matched = await engine.match(query, { enabledProviders: ['lrclib'] });

    expect(matched.accepted).toBeNull();
    expect(matched.candidates[0].risk).toBe('high');
  });

  it('does not let relaxed backfill bypass blocked identity rules', async () => {
    const engine = new LyricsMatchEngine([provider('lrclib', [result({ durationSeconds: 121 })])]);
    const coverQuery = { ...query, title: 'Echo Song Cover', durationSeconds: 120 };

    const normal = await engine.match(coverQuery, { enabledProviders: ['lrclib'], autoAcceptScore: 0.45 });
    const relaxed = await engine.match(coverQuery, {
      enabledProviders: ['lrclib'],
      autoAcceptScore: 0.45,
      relaxedAutoAccept: true,
    });

    expect(normal.accepted).toBeNull();
    expect(normal.candidates[0].risk).toBe('medium');
    expect(relaxed.accepted).toBeNull();
  });

  it('does not auto accept a user-rejected provider lyrics id', async () => {
    const engine = new LyricsMatchEngine([provider('lrclib', [result()])]);

    const matched = await engine.match(query, {
      enabledProviders: ['lrclib'],
      isRejected: () => true,
    });

    expect(matched.accepted).toBeNull();
    expect(matched.candidates[0].reasons).toContain('rejected_by_user');
  });

  it('provider timeout does not block other providers', async () => {
    const slow = provider('netease', [result({ provider: 'netease', providerLyricsId: 'slow' })], 80);
    const fast = provider('lrclib', [result({ providerLyricsId: 'fast' })], 0);
    const engine = new LyricsMatchEngine([slow, fast]);

    const matched = await engine.match(query, {
      enabledProviders: ['netease', 'lrclib'],
      providerTimeoutMs: 20,
      totalMatchTimeoutMs: 80,
    });

    expect(matched.accepted?.providerLyricsId).toBe('fast');
  });

  it('returns a lower-priority match when a higher-priority provider hangs', async () => {
    const hanging = hangingProvider('netease');
    const fast = provider('kugou', [result({ provider: 'kugou', providerLyricsId: 'kugou-fast' })], 0);
    const engine = new LyricsMatchEngine([hanging, fast]);
    const startedAt = Date.now();

    const matched = await engine.match(query, {
      enabledProviders: ['netease', 'kugou'],
      providerTimeoutMs: 20,
      totalMatchTimeoutMs: 60,
    });

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(matched.accepted?.provider).toBe('kugou');
    expect(matched.accepted?.providerLyricsId).toBe('kugou-fast');
  });


  it('uses provider order as priority when deep search is disabled', async () => {
    const first = provider('netease', [result({ provider: 'netease', providerLyricsId: 'first' })], 10);
    const second = provider('lrclib', [result({ providerLyricsId: 'second' })], 0);
    const engine = new LyricsMatchEngine([second, first]);

    const matched = await engine.match(query, {
      enabledProviders: ['netease', 'lrclib'],
      deepSearchEnabled: false,
      providerTimeoutMs: 100,
    });

    expect(matched.accepted?.provider).toBe('netease');
    expect(matched.accepted?.providerLyricsId).toBe('first');
    expect(second.search).not.toHaveBeenCalled();
  });

  it('searches NetEase and LRCLIB concurrently during deep automatic search', async () => {
    const first = provider('netease', [result({ provider: 'netease', providerLyricsId: 'first' })], 20);
    const second = provider('lrclib', [result({ providerLyricsId: 'second', durationSeconds: 135 })], 0);
    const engine = new LyricsMatchEngine([second, first]);

    const matched = await engine.match(query, {
      enabledProviders: ['netease', 'lrclib'],
      deepSearchEnabled: true,
      providerTimeoutMs: 100,
      totalMatchTimeoutMs: 200,
    });

    expect(matched.accepted?.provider).toBe('netease');
    expect(matched.accepted?.providerLyricsId).toBe('first');
    expect(second.search).toHaveBeenCalled();
  });

  it('searches the native provider and fallbacks concurrently for streaming snapshots', async () => {
    const qq = provider('qqmusic', [result({ provider: 'qqmusic', providerLyricsId: 'qq-direct' })], 20);
    const lrclib = provider('lrclib', [result({ providerLyricsId: 'lrclib-fallback', durationSeconds: 135 })], 0);
    const engine = new LyricsMatchEngine([lrclib, qq]);

    const matched = await engine.match(
      {
        ...query,
        trackId: 'streaming:qqmusic:004Drt082CV5gf',
        mediaType: 'streaming',
        sourceId: '004Drt082CV5gf',
        stableKey: 'streaming:qqmusic:004Drt082CV5gf',
      },
      {
        enabledProviders: ['lrclib', 'netease', 'qqmusic'],
        deepSearchEnabled: true,
        providerTimeoutMs: 100,
        totalMatchTimeoutMs: 200,
      },
    );

    expect(matched.accepted?.provider).toBe('qqmusic');
    expect(matched.accepted?.providerLyricsId).toBe('qq-direct');
    expect(lrclib.search).toHaveBeenCalled();
  });

  it('races providers for remote tracks without a provider-native lyrics source', async () => {
    const slow = provider('netease', [result({ provider: 'netease', providerLyricsId: 'slow-priority-hit' })], 120);
    const fast = provider('lrclib', [result({ providerLyricsId: 'fast-remote-hit' })], 0);
    const engine = new LyricsMatchEngine([fast, slow]);
    const startedAt = Date.now();

    const matched = await engine.match(
      {
        ...query,
        trackId: 'remote-browser:webdav:/music/Echo Song.flac',
        mediaType: 'remote',
        sourceId: 'webdav',
        stableKey: 'remote-browser:webdav:/music/Echo Song.flac',
      },
      {
        enabledProviders: ['netease', 'lrclib'],
        deepSearchEnabled: true,
        providerTimeoutMs: 500,
        totalMatchTimeoutMs: 800,
      },
    );

    expect(Date.now() - startedAt).toBeLessThan(350);
    expect(matched.accepted).not.toBeNull();
    expect(matched.accepted?.matchedSources?.map((source) => source.provider)).toEqual(
      expect.arrayContaining(['lrclib', 'netease']),
    );
    expect(fast.search).toHaveBeenCalled();
    expect(slow.search).toHaveBeenCalled();
  });

  it('can race providers in parallel for high-throughput backfill', async () => {
    const slow = provider('netease', [result({ provider: 'netease', providerLyricsId: 'slow-priority-hit' })], 120);
    const fast = provider('lrclib', [result({ providerLyricsId: 'fast-accepted-hit' })], 0);
    const engine = new LyricsMatchEngine([fast, slow]);
    const startedAt = Date.now();

    const matched = await engine.match(query, {
      enabledProviders: ['netease', 'lrclib'],
      deepSearchEnabled: true,
      preferPrimaryProvider: false,
      providerTimeoutMs: 500,
      totalMatchTimeoutMs: 800,
    });

    expect(Date.now() - startedAt).toBeLessThan(350);
    expect(matched.accepted).not.toBeNull();
    expect(matched.accepted?.matchedSources?.map((source) => source.provider)).toEqual(
      expect.arrayContaining(['lrclib', 'netease']),
    );
    expect(fast.search).toHaveBeenCalled();
    expect(slow.search).toHaveBeenCalled();
  });

  it('waits for a high-confidence result when an earlier result is only balanced', async () => {
    const slow = provider('netease', [result({ provider: 'netease', providerLyricsId: 'slow-priority-hit' })], 120);
    const fast = provider('lrclib', [result({ providerLyricsId: 'fast-accepted-hit', durationSeconds: 112 })], 0);
    const engine = new LyricsMatchEngine([fast, slow]);

    const matched = await engine.match(query, {
      enabledProviders: ['netease', 'lrclib'],
      deepSearchEnabled: true,
      providerTimeoutMs: 500,
      totalMatchTimeoutMs: 800,
    });

    expect(matched.accepted?.provider).toBe('netease');
    expect(matched.accepted?.providerLyricsId).toBe('slow-priority-hit');
    expect(fast.search).toHaveBeenCalled();
    expect(slow.search).toHaveBeenCalled();
  });

  it('uses a short grace window to collect matching translations from another provider', async () => {
    const lrclib = provider('lrclib', [result({ providerLyricsId: 'plain-hit' })], 0);
    const netease = provider(
      'netease',
      [
        result({
          provider: 'netease',
          providerLyricsId: 'translated-hit',
          translationLyrics: '[00:01.00]Translated line',
          raw: { id: 'translated-hit' },
        }),
      ],
      20,
      { translation: true },
    );
    const engine = new LyricsMatchEngine([lrclib, netease]);

    const matched = await engine.match(query, {
      enabledProviders: ['lrclib', 'netease'],
      deepSearchEnabled: true,
      preferredSecondaryFields: ['translation'],
      providerTimeoutMs: 100,
      totalMatchTimeoutMs: 200,
    });

    expect(matched.accepted?.provider).toBe('netease');
    expect(matched.accepted?.matchedSources?.map((source) => source.provider)).toEqual(
      expect.arrayContaining(['lrclib', 'netease']),
    );
    expect(lrclib.search).toHaveBeenCalled();
    expect(netease.search).toHaveBeenCalled();
  });

  it('blocks automatic selection when equally credible providers return different lyric bodies', async () => {
    const lrclib = provider('lrclib', [
      result({
        providerLyricsId: 'body-a',
        plainLyrics: 'First body',
        syncedLyrics: '[00:01.00]First body',
        raw: { id: 'body-a' },
      }),
    ]);
    const netease = provider('netease', [
      result({
        provider: 'netease',
        providerLyricsId: 'body-b',
        plainLyrics: 'Second body',
        syncedLyrics: '[00:01.00]Second body',
        raw: { id: 'body-b' },
      }),
    ], 20);
    const engine = new LyricsMatchEngine([lrclib, netease]);

    const matched = await engine.match(query, {
      enabledProviders: ['lrclib', 'netease'],
      ambiguityGraceMs: 80,
      providerTimeoutMs: 100,
      totalMatchTimeoutMs: 200,
    });

    expect(matched.accepted).toBeNull();
    expect(matched.candidates).toHaveLength(2);
    expect(matched.candidates[0].reasons).toContain('lyrics_content_conflict');
    expect(matched.candidates[0].autoAcceptEligible).toBe(false);
  });

  it('treats normalized lyric-body agreement across providers as corroboration', async () => {
    const lrclib = provider('lrclib', [
      result({
        providerLyricsId: 'same-a',
        syncedLyrics: '[00:01.00]Same line\n[00:02.00]Repeated line\n[00:03.00]Repeated line',
        raw: { id: 'same-a' },
      }),
    ]);
    const netease = provider('netease', [
      result({
        provider: 'netease',
        providerLyricsId: 'same-b',
        syncedLyrics: '[00:02.00]Repeated line\n[00:01.00]Same line\n[ar:Echo Artist]',
        raw: { id: 'same-b' },
      }),
    ], 20);
    const engine = new LyricsMatchEngine([lrclib, netease]);

    const matched = await engine.match(query, {
      enabledProviders: ['lrclib', 'netease'],
      ambiguityGraceMs: 80,
      providerTimeoutMs: 100,
      totalMatchTimeoutMs: 200,
    });

    expect(matched.accepted).not.toBeNull();
    expect(matched.candidates).toHaveLength(1);
    expect(matched.candidates[0].reasons).toContain('multi_source_agreement');
    expect(matched.candidates[0].matchedSources?.map((source) => source.provider)).toEqual(
      expect.arrayContaining(['lrclib', 'netease']),
    );
  });

  it('blocks a tied Top-2 result when lyric bodies are unavailable for comparison', async () => {
    const instrumentalQuery = { ...query, title: 'Echo Song Instrumental' };
    const instrumentalResult = {
      title: 'Echo Song Instrumental',
      instrumental: true,
      plainLyrics: null,
      syncedLyrics: null,
    };
    const lrclib = provider('lrclib', [
      result({ ...instrumentalResult, providerLyricsId: 'instrumental-a', raw: { id: 'instrumental-a' } }),
    ]);
    const netease = provider('netease', [
      result({
        ...instrumentalResult,
        provider: 'netease',
        providerLyricsId: 'instrumental-b',
        raw: { id: 'instrumental-b' },
      }),
    ], 20);
    const engine = new LyricsMatchEngine([lrclib, netease]);

    const matched = await engine.match(instrumentalQuery, {
      enabledProviders: ['lrclib', 'netease'],
      ambiguityGraceMs: 80,
      providerTimeoutMs: 100,
      totalMatchTimeoutMs: 200,
    });

    expect(matched.accepted).toBeNull();
    expect(matched.candidates[0].reasons).toContain('ambiguous_score_margin');
  });

  it('does not wait beyond the ambiguity grace window for a much slower provider', async () => {
    const fast = provider('lrclib', [result({ providerLyricsId: 'fast-hit' })]);
    const slow = provider(
      'netease',
      [result({ provider: 'netease', providerLyricsId: 'slow-hit', syncedLyrics: '[00:01.00]Different body' })],
      300,
    );
    const engine = new LyricsMatchEngine([fast, slow]);
    const startedAt = Date.now();

    const matched = await engine.match(query, {
      enabledProviders: ['lrclib', 'netease'],
      ambiguityGraceMs: 40,
      providerTimeoutMs: 500,
      totalMatchTimeoutMs: 600,
    });

    expect(Date.now() - startedAt).toBeLessThan(180);
    expect(matched.accepted?.providerLyricsId).toBe('fast-hit');
  });

  it('returns a balanced duration-tolerated candidate without waiting for every slow provider', async () => {
    const fast = provider('lrclib', [
      result({ providerLyricsId: 'balanced-fast', durationSeconds: 132 }),
    ]);
    const slow = provider(
      'netease',
      [result({ provider: 'netease', providerLyricsId: 'balanced-slow', durationSeconds: 132 })],
      1200,
    );
    const engine = new LyricsMatchEngine([fast, slow]);
    const startedAt = Date.now();

    const matched = await engine.match(query, {
      enabledProviders: ['lrclib', 'netease'],
      providerTimeoutMs: 1400,
      totalMatchTimeoutMs: 1500,
    });

    expect(Date.now() - startedAt).toBeLessThan(900);
    expect(matched.accepted?.providerLyricsId).toBe('balanced-fast');
    expect(matched.accepted?.decision.confidence).toBe('balanced');
  });

  it('keeps slow providers running in the background after a fast foreground match', async () => {
    const fast = provider('lrclib', [result({ providerLyricsId: 'foreground-fast' })]);
    const slow = provider(
      'netease',
      [result({
        provider: 'netease',
        providerLyricsId: 'background-slow',
        plainLyrics: 'Different late body',
        syncedLyrics: '[00:01.00]Different late body',
      })],
      80,
    );
    const onBackgroundCandidates = vi.fn();
    const onBackgroundMatch = vi.fn();
    const engine = new LyricsMatchEngine([fast, slow]);

    const matched = await engine.match(query, {
      enabledProviders: ['lrclib', 'netease'],
      ambiguityGraceMs: 20,
      providerTimeoutMs: 200,
      totalMatchTimeoutMs: 300,
      onBackgroundCandidates,
      onBackgroundMatch,
    });

    expect(matched.accepted?.providerLyricsId).toBe('foreground-fast');
    await vi.waitFor(() => expect(onBackgroundMatch).toHaveBeenCalled());
    const backgroundResult = onBackgroundMatch.mock.calls.at(-1)?.[0] as {
      accepted: unknown;
      candidates: Array<{ providerLyricsId: string }>;
    };
    expect(backgroundResult.accepted).toBeNull();
    expect(backgroundResult.candidates.map((candidate) => candidate.providerLyricsId)).toEqual(
      expect.arrayContaining(['foreground-fast', 'background-slow']),
    );
  });

  it('caps an automatic foreground lookup at 2.5 seconds and accepts a safe late result in the background', async () => {
    vi.useFakeTimers();
    try {
      const slow = provider('lrclib', [result({ providerLyricsId: 'late-after-cap' })], 3000);
      const onBackgroundCandidates = vi.fn();
      const onBackgroundMatch = vi.fn();
      const engine = new LyricsMatchEngine([slow]);
      let foregroundSettled = false;

      const matchPromise = engine.match(query, {
        enabledProviders: ['lrclib'],
        providerTimeoutMs: 4500,
        totalMatchTimeoutMs: 4000,
        onBackgroundCandidates,
        onBackgroundMatch,
      }).finally(() => {
        foregroundSettled = true;
      });

      await vi.advanceTimersByTimeAsync(2499);
      expect(foregroundSettled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(matchPromise).resolves.toMatchObject({ accepted: null });

      await vi.advanceTimersByTimeAsync(500);
      expect(onBackgroundMatch).toHaveBeenCalledWith(expect.objectContaining({
        accepted: expect.objectContaining({ providerLyricsId: 'late-after-cap' }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('collects all provider candidates when requested', async () => {
    const netease = provider('netease', [result({ provider: 'netease', providerLyricsId: 'netease-hit', raw: { id: 'netease-hit' } })], 0);
    const lrclib = provider('lrclib', [result({ providerLyricsId: 'lrclib-hit', raw: { id: 'lrclib-hit' } })], 30);
    const qqmusic = provider('qqmusic', [result({ provider: 'qqmusic', providerLyricsId: 'qq-hit', raw: { id: 'qq-hit' } })], 40);
    const engine = new LyricsMatchEngine([lrclib, netease, qqmusic]);

    const matched = await engine.match(query, {
      enabledProviders: ['netease', 'lrclib', 'qqmusic'],
      collectAllCandidates: true,
      providerTimeoutMs: 100,
      totalMatchTimeoutMs: 200,
    });

    expect(matched.candidates).toHaveLength(1);
    expect(matched.candidates[0].matchedSources?.map((source) => source.provider)).toEqual(
      expect.arrayContaining(['netease', 'lrclib', 'qqmusic']),
    );
  });

  it('uses other providers when the prioritized NetEase search times out', async () => {
    const slow = provider('netease', [result({ provider: 'netease', providerLyricsId: 'slow' })], 80);
    const fast = provider('lrclib', [result({ providerLyricsId: 'fast' })], 5);
    const engine = new LyricsMatchEngine([slow, fast]);

    const matched = await engine.match(query, {
      enabledProviders: ['netease', 'lrclib'],
      providerTimeoutMs: 20,
      totalMatchTimeoutMs: 100,
    });

    expect(matched.accepted?.providerLyricsId).toBe('fast');
  });

  it('returns at the foreground deadline and caches late candidates in the background', async () => {
    const foreground = provider('lrclib', [result({ providerLyricsId: 'blocked-fast', durationSeconds: 135 })], 0);
    const late = provider('netease', [result({ provider: 'netease', providerLyricsId: 'late-exact' })], 60);
    const onBackgroundCandidates = vi.fn();
    const onBackgroundMatch = vi.fn();
    const engine = new LyricsMatchEngine([foreground, late]);
    const startedAt = Date.now();

    const matched = await engine.match(query, {
      enabledProviders: ['lrclib', 'netease'],
      providerTimeoutMs: 200,
      totalMatchTimeoutMs: 20,
      onBackgroundCandidates,
      onBackgroundMatch,
    });

    expect(Date.now() - startedAt).toBeLessThan(100);
    expect(matched.accepted).toBeNull();
    await vi.waitFor(() => expect(onBackgroundCandidates).toHaveBeenCalled());
    const lastCandidates = onBackgroundCandidates.mock.calls.at(-1)?.[0] as Array<{ providerLyricsId: string }>;
    expect(lastCandidates.map((candidate) => candidate.providerLyricsId)).toContain('late-exact');
    await vi.waitFor(() => expect(onBackgroundMatch).toHaveBeenCalled());
    expect(onBackgroundMatch.mock.calls.at(-1)?.[0]).toMatchObject({
      accepted: { providerLyricsId: 'late-exact' },
    });
  });
});
