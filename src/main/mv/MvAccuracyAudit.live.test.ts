import { describe, expect, it } from 'vitest';
import type { LibraryTrack } from '../../shared/types/library';
import type { MvSettings } from '../../shared/types/mv';
import { BilibiliMvProvider } from './OnlineMvProviders';

const settings: MvSettings = {
  autoSearch: true,
  autoPreload: true,
  autoApplyThreshold: 0.7,
  preferHighestViewCount: true,
  restartAudioOnLoad: false,
  replayAudioOnChange: false,
  enabledProviders: ['bilibili'],
  providerOrder: ['bilibili'],
  maxQuality: '1080p',
  allow60fps: true,
};

const auditTracks = [
  ['アイドル', 'YOASOBI', 214],
  ['KICK BACK', '米津玄師', 193],
  ['青春コンプレックス', '結束バンド', 203],
  ['花の塔', 'さユり', 276],
  ['モニタリング', 'DECO*27 feat. 初音ミク', 182],
  ['ロキ', 'みきとP feat. 鏡音リン', 230],
  ['神っぽいな', 'ピノキオピー feat. 初音ミク', 205],
  ['ビビデバ', '星街すいせい', 165],
  ['唱', 'Ado', 189],
  ['廻廻奇譚', 'Eve', 221],
  ['紅蓮華', 'LiSA', 236],
  ['only my railgun', 'fripSide', 257],
  ['コネクト', 'ClariS', 268],
  ['君の知らない物語', 'supercell', 339],
  ['ローリンガール', 'wowaka feat. 初音ミク', 189],
  ['メルト', 'ryo feat. 初音ミク', 256],
  ['アスノヨゾラ哨戒班', 'Orangestar feat. IA', 176],
  ['KING', 'Kanaria feat. GUMI', 134],
  ['ラグトレイン', '稲葉曇 feat. 歌愛ユキ', 251],
  ['愛して愛して愛して', 'きくお feat. 初音ミク', 248],
] as const;

// Manually reviewed Bilibili uploads. Keep this intentionally small: unknown is
// reported as unverified instead of being optimistically counted as correct.
const knownGoodIds = new Set([
  'bilibili:BV1tM411V7Je',
  'bilibili:BV1qDUPYKEzf',
  'bilibili:BV1AW411t7Dx',
  'bilibili:BV1iP4y1Y7NE',
  'bilibili:BV1Cw4m1y7gu',
  'bilibili:BV1EGQ7YJEwS',
  'bilibili:BV1Qt4y1e74s',
  'bilibili:BV1Hf4y1W7yE',
  'bilibili:BV1oLiTeaEJL',
  'bilibili:BV1ev411b7PX',
  'bilibili:BV13ywxedEaU',
  'bilibili:BV1xx411c75e',
  'bilibili:BV1Ya4y1E7pk',
  'bilibili:BV1fK4y1s7Qf',
  'bilibili:BV1ng7pzdE28',
]);

const toTrack = ([title, artist, duration]: typeof auditTracks[number], index: number): LibraryTrack => ({
  id: `mv-live-audit-${index + 1}`,
  path: `D:\\Music\\${title}.flac`,
  title,
  artist,
  album: '',
  albumArtist: artist,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration,
  codec: 'flac',
  sampleRate: 48_000,
  bitDepth: 24,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

describe.runIf(process.env.ECHO_RUN_MV_LIVE_AUDIT === '1')('Bilibili ACG MV live accuracy audit', () => {
  it('prints ranked evidence for manual precision review', async () => {
    const provider = new BilibiliMvProvider({
      getCredentials: () => ({ provider: 'bilibili' }),
    });
    const report = [];

    for (const [index, fixture] of auditTracks.entries()) {
      const track = toTrack(fixture, index);
      const startedAt = performance.now();
      const candidates = await provider.search(track, settings);
      const elapsedMs = Math.round(performance.now() - startedAt);
      const top = candidates[0] ?? null;
      const autoCandidates = candidates.filter((candidate) => candidate.decision?.autoAccept && candidate.score >= 0.7);
      report.push({
        title: track.title,
        artist: track.artist,
        elapsedMs,
        candidateCount: candidates.length,
        autoCount: autoCandidates.length,
        autoCandidates: autoCandidates.slice(0, 3).map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          uploader: candidate.uploader,
          score: candidate.score,
        })),
        top: top ? {
          id: top.id,
          title: top.title,
          uploader: top.uploader,
          uploaderId: top.uploaderId,
          durationSeconds: top.durationSeconds,
          score: top.score,
          autoAccept: top.decision?.autoAccept ?? false,
          risk: top.decision?.risk ?? null,
          reasons: top.reasons,
          knownGood: knownGoodIds.has(top.id),
        } : null,
      });
    }

    const autoSelected = report.filter((entry) => entry.top?.autoAccept && entry.top.score >= 0.7);
    const knownGoodAuto = autoSelected.filter((entry) => entry.top?.knownGood);
    const timings = report.map((entry) => entry.elapsedMs).sort((left, right) => left - right);
    const summary = {
      tracks: report.length,
      autoSelected: autoSelected.length,
      knownGoodAuto: knownGoodAuto.length,
      unverifiedAuto: autoSelected.length - knownGoodAuto.length,
      conservativePrecision: autoSelected.length > 0 ? Number((knownGoodAuto.length / autoSelected.length).toFixed(4)) : 1,
      knownGoodCoverage: Number((knownGoodAuto.length / report.length).toFixed(4)),
      averageMs: Math.round(timings.reduce((total, value) => total + value, 0) / timings.length),
      p50Ms: timings[Math.floor(timings.length * 0.5)] ?? null,
      p95Ms: timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))] ?? null,
    };
    console.info(`MV_LIVE_AUDIT=${JSON.stringify({ summary, report })}`);
    expect(report).toHaveLength(auditTracks.length);
  }, 120_000);
});
