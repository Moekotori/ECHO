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

type AuditTrack = Omit<LyricsQuery, 'trackId'> & { language: 'zh' | 'ja' | 'en' | 'missing' };

const auditTracks: AuditTrack[] = [
  { language: 'zh', title: '晴天', artist: '周杰伦', album: '叶惠美', durationSeconds: 269 },
  { language: 'zh', title: '青花瓷', artist: '周杰伦', album: '我很忙', durationSeconds: 239 },
  { language: 'zh', title: '后来', artist: '刘若英', album: '我等你', durationSeconds: 341 },
  { language: 'zh', title: '红豆', artist: '王菲', album: '唱游', durationSeconds: 260 },
  { language: 'zh', title: '演员', artist: '薛之谦', album: '绅士', durationSeconds: 261 },
  { language: 'zh', title: '光年之外', artist: 'G.E.M.邓紫棋', album: '光年之外', durationSeconds: 235 },
  { language: 'zh', title: '平凡之路', artist: '朴树', album: '猎户星座', durationSeconds: 302 },
  { language: 'zh', title: '小幸运', artist: '田馥甄', album: '我的少女时代', durationSeconds: 276 },
  { language: 'ja', title: 'Lemon', artist: '米津玄師', album: 'Lemon', durationSeconds: 255 },
  { language: 'ja', title: 'Pretender', artist: 'Official髭男dism', album: 'Traveler', durationSeconds: 326 },
  { language: 'ja', title: '夜に駆ける', artist: 'YOASOBI', album: 'THE BOOK', durationSeconds: 261 },
  { language: 'ja', title: '紅蓮華', artist: 'LiSA', album: 'LEO-NiNE', durationSeconds: 237 },
  { language: 'ja', title: '残響散歌', artist: 'Aimer', album: 'Walpurgis', durationSeconds: 184 },
  { language: 'ja', title: 'アイドル', artist: 'YOASOBI', album: 'アイドル', durationSeconds: 213 },
  { language: 'ja', title: '怪物', artist: 'YOASOBI', album: 'THE BOOK 2', durationSeconds: 206 },
  { language: 'ja', title: '炎', artist: 'LiSA', album: 'LANDER', durationSeconds: 275 },
  { language: 'en', title: 'Hello', artist: 'Adele', album: '25', durationSeconds: 295 },
  { language: 'en', title: 'Shape of You', artist: 'Ed Sheeran', album: '÷', durationSeconds: 234 },
  { language: 'en', title: 'Someone Like You', artist: 'Adele', album: '21', durationSeconds: 285 },
  { language: 'en', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', durationSeconds: 200 },
  { language: 'en', title: 'bad guy', artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?', durationSeconds: 194 },
  { language: 'en', title: 'Viva La Vida', artist: 'Coldplay', album: 'Viva la Vida or Death and All His Friends', durationSeconds: 242 },
  { language: 'en', title: 'Counting Stars', artist: 'OneRepublic', album: 'Native', durationSeconds: 257 },
  { language: 'en', title: 'Numb', artist: 'Linkin Park', album: 'Meteora', durationSeconds: 185 },
  { language: 'missing', title: 'ECHO definitely nonexistent song 9f8b7c6d', artist: 'No Such Artist', album: null, durationSeconds: 197 },
];

const providers = (): LyricsProvider[] => [
  new LrclibProvider(),
  new NeteaseLyricsProvider(),
  new QQMusicLyricsProvider(),
  new KugouLyricsProvider(),
  new KuwoLyricsProvider(),
  new AmllTtmlLyricsProvider(),
];

const percentile = (values: number[], ratio: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? null;
};

const normalizeAuditText = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');

describe.runIf(process.env.ECHO_LIVE_LYRICS === '1')('lyrics match policy v2 live audit', () => {
  it('audits 24 multilingual songs and one cold miss without making network quality a CI gate', async () => {
    const rows: Array<Record<string, unknown>> = [];
    for (let offset = 0; offset < auditTracks.length; offset += 4) {
      const batch = auditTracks.slice(offset, offset + 4);
      const batchRows = await Promise.all(batch.map(async (track, index) => {
        const startedAt = performance.now();
        const result = await new LyricsMatchEngine(providers()).match(
          { ...track, trackId: `live-v2-${offset + index}` },
          {
            enabledProviders: ['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo', 'amll-ttml'],
            networkEnabled: true,
            deepSearchEnabled: true,
            preferPrimaryProvider: false,
            providerTimeoutMs: 3_800,
            totalMatchTimeoutMs: 4_000,
            autoAcceptScore: 0.78,
          },
        );
        const elapsedMs = Math.round(performance.now() - startedAt);
        const accepted = result.accepted;
        const acceptedIdentityMatches = Boolean(
          accepted &&
          normalizeAuditText(accepted.title) === normalizeAuditText(track.title) &&
          normalizeAuditText(accepted.artist) === normalizeAuditText(track.artist),
        );
        return {
          language: track.language,
          title: track.title,
          artist: track.artist,
          elapsedMs,
          accepted: Boolean(accepted),
          acceptedIdentityMatches,
          confidence: accepted?.confidence ?? null,
          acceptedProvider: accepted?.provider ?? null,
          acceptedTitle: accepted?.title ?? null,
          acceptedArtist: accepted?.artist ?? null,
          durationDeltaSeconds: accepted?.durationDeltaSeconds ?? null,
          candidateCount: result.candidates.length,
        };
      }));
      rows.push(...batchRows);
    }

    const normalRows = rows.filter((row) => row.language !== 'missing');
    const acceptedRows = normalRows.filter((row) => row.accepted === true);
    const correctAcceptedRows = acceptedRows.filter((row) => row.acceptedIdentityMatches === true);
    const severeMismatchRows = acceptedRows.filter((row) => row.acceptedIdentityMatches !== true);
    const highLatencies = acceptedRows
      .filter((row) => row.confidence === 'high')
      .map((row) => Number(row.elapsedMs));
    const foregroundLatencies = rows.map((row) => Number(row.elapsedMs));
    const missingRow = rows.find((row) => row.language === 'missing');
    const report = {
      generatedAt: new Date().toISOString(),
      totalKnownTracks: normalRows.length,
      autoAccepted: acceptedRows.length,
      autoAcceptCoverage: acceptedRows.length / normalRows.length,
      acceptedAccuracyByPolicy: acceptedRows.length === 0 ? null : correctAcceptedRows.length / acceptedRows.length,
      severeMismatchCount: severeMismatchRows.length,
      highConfidenceMedianMs: percentile(highLatencies, 0.5),
      foregroundP95Ms: percentile(foregroundLatencies, 0.95),
      coldMissMs: missingRow?.elapsedMs ?? null,
      coldMissAccepted: missingRow?.accepted ?? null,
      rows,
    };

    console.log(`LYRICS_POLICY_V2_AUDIT=${JSON.stringify(report)}`);
    expect(rows).toHaveLength(25);
  }, 60_000);
});
