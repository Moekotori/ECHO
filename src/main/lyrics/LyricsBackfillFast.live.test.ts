import { describe, expect, it } from 'vitest';
import type { LyricsProvider } from './LyricsProvider';
import { AmllTtmlLyricsProvider } from './AmllTtmlLyricsProvider';
import { KugouLyricsProvider } from './KugouLyricsProvider';
import { KuwoLyricsProvider } from './KuwoLyricsProvider';
import { LrclibProvider } from './LrclibProvider';
import { LyricsMatchEngine } from './LyricsMatchEngine';
import { NeteaseLyricsProvider } from './NeteaseLyricsProvider';
import { QQMusicLyricsProvider } from './QQMusicLyricsProvider';
import type { LyricsQuery } from '../../shared/types/lyrics';

const providers = (): LyricsProvider[] => [
  new NeteaseLyricsProvider(),
  new QQMusicLyricsProvider(),
  new KugouLyricsProvider(),
  new KuwoLyricsProvider(),
  new LrclibProvider(),
  new AmllTtmlLyricsProvider(),
];

const quickBackfillMatch = (query: LyricsQuery) =>
  new LyricsMatchEngine(providers()).match(query, {
    enabledProviders: ['netease', 'qqmusic', 'kugou', 'kuwo', 'lrclib', 'amll-ttml'],
    networkEnabled: true,
    deepSearchEnabled: true,
    preferPrimaryProvider: false,
    providerTimeoutMs: 1600,
    totalMatchTimeoutMs: 2400,
    autoAcceptScore: 0.45,
  });

describe.runIf(process.env.ECHO_LIVE_LYRICS === '1')('fast lyrics backfill live network', () => {
  it('finds a high-confidence Chinese lyrics match quickly', async () => {
    const startedAt = Date.now();
    const matched = await quickBackfillMatch({
      trackId: 'live-fast-cn',
      title: '\u6674\u5929',
      artist: '\u5468\u6770\u4f26',
      album: '\u53f6\u60e0\u7f8e',
      durationSeconds: 269,
    });

    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(matched.accepted).not.toBeNull();
    expect(matched.candidates.length).toBeGreaterThan(0);
  }, 8000);

  it('finds a high-confidence Japanese lyrics match quickly', async () => {
    const startedAt = Date.now();
    const matched = await quickBackfillMatch({
      trackId: 'live-fast-jp',
      title: 'Lemon',
      artist: '\u7c73\u6d25\u7384\u5e2b',
      album: 'Lemon',
      durationSeconds: 255,
    });

    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(matched.accepted).not.toBeNull();
    expect(matched.candidates.length).toBeGreaterThan(0);
  }, 8000);
});
