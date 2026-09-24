import { describe, expect, it } from 'vitest';
import type { LibraryTrack } from '../../shared/types/library';
import { MV_MATCH_ALGORITHM_VERSION, parseMvDurationSeconds, scoreNetworkMvCandidate } from './MvScoring';

const track = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\Echo Song.flac',
  title: 'Echo Song',
  artist: 'Echo Artist',
  album: 'Echo Album',
  albumArtist: 'Echo Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 120,
  codec: 'flac',
  sampleRate: 48_000,
  bitDepth: 24,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
  ...overrides,
});

describe('network MV scoring', () => {
  it('requires corroborating artist or duration evidence for automatic selection', () => {
    const result = scoreNetworkMvCandidate(track(), {
      title: 'Echo Artist - Echo Song (Official MV)',
      uploader: 'Echo Artist Official',
      durationSeconds: 121,
    });

    expect(result).toMatchObject({
      autoEligible: true,
      matchVersion: MV_MATCH_ALGORITHM_VERSION,
    });
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.reasons).toContain('uploader matches artist');
    expect(result.reasons).toContain('duration within 5%');
  });

  it('rejects a popular video that only contains a short numeric title', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: '17', artist: '椎名林檎', albumArtist: '椎名林檎', duration: 272 }),
      {
        title: '17张牌你能秒我？今天把电脑屏幕吃掉！',
        uploader: '热门游戏剪辑',
        durationSeconds: 90,
      },
    );

    expect(result.autoEligible).toBe(false);
    expect(result.score).toBeLessThan(0.7);
  });

  it('does not confuse token prefixes such as uni/birth with unit/birthday', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: 'uni-birth', artist: '湊あくあ', albumArtist: '湊あくあ', duration: 225 }),
      {
        title: '人教版初中英语 Unit 8 When is your birthday？英语网课',
        uploader: '课程频道',
        durationSeconds: 1_800,
      },
    );

    expect(result.autoEligible).toBe(false);
    expect(result.score).toBeLessThan(0.3);
    expect(result.reasons).toContain('title mismatch');
  });

  it('rejects an unrelated same-name video without a second source of evidence', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: 'Palette', artist: '花たん', albumArtist: '花たん', duration: 230 }),
      {
        title: '看多少次都会被惊艳的秀场 Xi Palette',
        uploader: '婚纱秀场',
        durationSeconds: null,
      },
    );

    expect(result.autoEligible).toBe(false);
    expect(result.score).toBeLessThan(0.7);
    expect(result.reasons).toContain('auto blocked: no artist or duration evidence');
  });

  it('accepts an exact CJK title when duration independently corroborates it', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: '恋愛ストラテジック', artist: '湊あくあ', albumArtist: '湊あくあ', duration: 229 }),
      {
        title: '【原创曲】恋愛ストラテジック【特效中字】',
        uploader: '字幕组',
        durationSeconds: 230,
      },
    );

    expect(result.autoEligible).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it('accepts a substantially matching title only when artist and duration both corroborate it', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: 'Echo Song Extended Mix', duration: 180 }),
      {
        title: 'Echo Artist - Echo Song Extended Official MV',
        uploader: 'Echo Artist Official',
        durationSeconds: 181,
      },
    );

    expect(result.autoEligible).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.reasons).toContain('title tokens 75%');
  });

  it('keeps a substantially matching title manual when only one corroborating signal is present', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: 'Echo Song Extended Mix', duration: 180 }),
      {
        title: 'Echo Song Extended Official MV',
        uploader: 'Unrelated Channel',
        durationSeconds: 181,
      },
    );

    expect(result.autoEligible).toBe(false);
    expect(result.score).toBeLessThan(0.7);
  });

  it('blocks an unrequested cover even when title, artist, and duration otherwise match', () => {
    const result = scoreNetworkMvCandidate(track(), {
      title: 'Echo Artist - Echo Song cover',
      uploader: 'Echo Artist',
      durationSeconds: 120,
    });

    expect(result.autoEligible).toBe(false);
    expect(result.score).toBeLessThan(0.7);
    expect(result.reasons).toContain('variant conflict: cover');
  });

  it.each([
    'ギターと孤独と蒼い惑星【結束バンド】动态鼓谱',
    '【bass TAB谱】青春コンプレックス - 結束バンド',
    '【口琴奏】DECO*27 - モニタリング feat. 初音ミク',
    '【MMD/4K】神っぽいな feat. 初音ミク',
    '【原创振付】ビビデバ - 星街すいせい',
    '【舞台背景】ビビデバ - 星街すいせい',
    '【4K60FPS】KICK BACK/米津玄師 动画纯享',
    'ロキ PJD PV 鏡音リン',
    '【爬台自用背景】ビビデバ - 星街すいせい（宅舞xWOTA艺）',
    '【简谱】アスノヨゾラ哨戒班 Orangestar',
    "4k120原PV [mega39's+]《ロキ》 feat. 鏡音リン・レン",
    '【Lanota X wowaka】ローリンガール Master Lv.13+ Perfect Purified',
    '【世界计划 多彩舞台】神っぽいな 2DMV',
    'コネクト - ClariS - Cubase',
    '黑胶试听 supercell 君の知らない物語',
    'モニタリング DECO*27 可不 Cevio翻调',
    'roblox音乐id モニタリング-DECO*27',
    'LiSA《紅蓮華》录音棚大声听',
    'LiSA - 紅蓮華（四弦贝斯版）',
    '[自制自用壁纸] DECO*27 - モニタリング feat. 初音ミク',
    '【三厨狂喜】廻廻奇譚 Roselia x My First Story x Eve',
  ])('keeps derivative Japanese and Vocaloid content manual: %s', (title) => {
    const result = scoreNetworkMvCandidate(
      track({
        title: title.includes('青春コンプレックス')
          ? '青春コンプレックス'
          : title.includes('ギターと孤独と蒼い惑星')
            ? 'ギターと孤独と蒼い惑星'
            : title.includes('モニタリング')
              ? 'モニタリング'
              : title.includes('神っぽいな')
                ? '神っぽいな'
                : title.includes('KICK BACK')
                  ? 'KICK BACK'
                  : title.includes('ロキ')
                    ? 'ロキ'
                    : title.includes('アスノヨゾラ')
                      ? 'アスノヨゾラ哨戒班'
                      : title.includes('神っぽいな')
                        ? '神っぽいな'
                        : title.includes('コネクト')
                          ? 'コネクト'
                          : title.includes('君の知らない物語')
                            ? '君の知らない物語'
                      : title.includes('ローリンガール')
                        ? 'ローリンガール'
                        : 'ビビデバ',
        artist: title.includes('結束バンド')
          ? '結束バンド'
          : title.includes('DECO*27')
            ? 'DECO*27 feat. 初音ミク'
            : title.includes('神っぽいな')
              ? 'ピノキオピー feat. 初音ミク'
              : title.includes('KICK BACK')
                ? '米津玄師'
                : title.includes('ロキ')
                  ? 'みきとP feat. 鏡音リン'
                  : title.includes('アスノヨゾラ')
                    ? 'Orangestar feat. IA'
                    : title.includes('コネクト')
                      ? 'ClariS'
                      : title.includes('君の知らない物語')
                        ? 'supercell'
                    : title.includes('ローリンガール')
                      ? 'wowaka feat. 初音ミク'
                      : '星街すいせい',
        albumArtist: '',
        duration: 180,
      }),
      { title, uploader: 'fan channel', durationSeconds: 180 },
    );

    expect(result.autoEligible).toBe(false);
    expect(result.score).toBeLessThan(0.7);
    expect(result.reasons).toContain('non-MV content');
  });

  it('keeps an unrequested re-recorded anime song version manual', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: 'コネクト', artist: 'ClariS', albumArtist: 'ClariS', duration: 268 }),
      { title: 'ClariS「コネクト -reformare-」', uploader: 'official music channel', durationSeconds: 268 },
    );

    expect(result.autoEligible).toBe(false);
    expect(result.decision.risk).toBe('high');
    expect(result.reasons).toContain('variant conflict: re-recorded version');
  });

  it('keeps an unrequested extended MV version manual', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: '紅蓮華', artist: 'LiSA', albumArtist: 'LiSA', duration: 236 }),
      { title: 'LiSA - 紅蓮華 MV 加长版', uploader: 'fan channel', durationSeconds: 236 },
    );

    expect(result.autoEligible).toBe(false);
    expect(result.reasons).toContain('variant conflict: extended version');
  });

  it.each([
    ['唱', 'Ado', '【Ado】唱 Another Story'],
    ['廻廻奇譚', 'Eve', '廻廻奇譚 - Eve MV (Adam by Eve ver.)'],
    ['アイドル', 'YOASOBI', 'アイドル YOASOBI VIUTV播出版'],
  ])('keeps an unrequested alternate version manual: %s', (title, artist, candidateTitle) => {
    const result = scoreNetworkMvCandidate(
      track({ title, artist, albumArtist: artist, duration: 200 }),
      { title: candidateTitle, uploader: `${artist} Official`, durationSeconds: 200 },
    );

    expect(result.autoEligible).toBe(false);
    expect(result.reasons).toContain('variant conflict: alternate version');
  });

  it('matches compact official uploader names used by Vocaloid producers', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: 'モニタリング', artist: 'DECO*27 feat. 初音ミク', albumArtist: '', duration: 182 }),
      {
        title: 'モニタリング Official MV',
        uploader: 'DECO27_Official',
        durationSeconds: null,
      },
    );

    expect(result.autoEligible).toBe(true);
    expect(result.reasons).toContain('uploader matches artist');
  });

  it.each([
    ['千本桜', '初音ミク', '千本樱 Official MV', '初音未来官方', 241],
    ['後來', '劉若英', '后来 Official Music Video', '刘若英官方频道', 241],
    ['KICK BACK', '米津玄師', '米津玄师 - KICK BACK Official MV', '米津玄师', 193],
  ])('matches safe writing-system aliases: %s', (title, artist, candidateTitle, uploader, durationSeconds) => {
    const result = scoreNetworkMvCandidate(
      track({ title, artist, albumArtist: artist, duration: durationSeconds }),
      { title: candidateTitle, uploader, durationSeconds },
    );

    expect(result.autoEligible).toBe(true);
    expect(result.decision).toMatchObject({
      autoAccept: true,
      candidateOnly: false,
      risk: 'low',
      algorithmVersion: MV_MATCH_ALGORITHM_VERSION,
    });
    expect(result.decision.evidence.writingSystemAlias).toBe(true);
    expect(result.reasons).toContain('writing-system alias');
  });

  it('does not infer semantic kana/kanji or romaji aliases without explicit evidence', () => {
    const kanaKanji = scoreNetworkMvCandidate(
      track({ title: 'ビビデバ', artist: '星街すいせい', albumArtist: '', duration: 165 }),
      { title: '彗星 Official MV', uploader: 'unrelated channel', durationSeconds: 165 },
    );
    const romaji = scoreNetworkMvCandidate(
      track({ title: '夜に駆ける', artist: 'YOASOBI', albumArtist: '', duration: 261 }),
      { title: 'Yoru ni Kakeru Official MV', uploader: 'unrelated channel', durationSeconds: 261 },
    );

    expect(kanaKanji.autoEligible).toBe(false);
    expect(kanaKanji.decision.risk).not.toBe('low');
    expect(romaji.autoEligible).toBe(false);
  });

  it('exposes conflicts through the structured v5 decision', () => {
    const result = scoreNetworkMvCandidate(track(), {
      title: 'Echo Artist - Echo Song piano cover',
      uploader: 'fan channel',
      durationSeconds: 120,
    });

    expect(result.decision).toMatchObject({
      autoAccept: false,
      candidateOnly: true,
      risk: 'high',
    });
    expect(result.decision.evidence.conflicts).toContain('variant conflict: cover');
  });

  it('blocks an unverified original PV but allows the artist channel to publish one', () => {
    const unverified = scoreNetworkMvCandidate(
      track({ title: 'ロキ', artist: 'みきとP feat. 鏡音リン', albumArtist: '', duration: 230 }),
      { title: 'ロキ 原创PV', uploader: 'fan channel', durationSeconds: 231 },
    );
    const official = scoreNetworkMvCandidate(
      track({ title: '神っぽいな', artist: 'ピノキオピー feat. 初音ミク', albumArtist: '', duration: 205 }),
      { title: '神っぽいな オリジナルPV', uploader: 'ピノキオピー_official', durationSeconds: 205 },
    );

    expect(unverified.autoEligible).toBe(false);
    expect(unverified.reasons).toContain('unverified derivative video');
    expect(official.autoEligible).toBe(true);
  });

  it('blocks an AI voice replacement even when producer, title, and duration match', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: 'モニタリング', artist: 'DECO*27 feat. 初音ミク', albumArtist: '', duration: 182 }),
      { title: 'DECO*27 - モニタリング feat. AI王馬小吉', uploader: 'fan channel', durationSeconds: 182 },
    );

    expect(result.autoEligible).toBe(false);
    expect(result.reasons).toContain('AI voice replacement');
  });

  it('blocks an unrelated game edit even when song title, artist, and duration match', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: '花の塔', artist: 'さユり', albumArtist: '', duration: 276 }),
      { title: '【原神】花の塔 / 花之塔 - さユり《莉可丽丝》ED', uploader: 'fan channel', durationSeconds: 271 },
    );

    expect(result.autoEligible).toBe(false);
    expect(result.reasons).toContain('unrelated game edit');
  });

  it.each([
    ['アイドル', 'YOASOBI', 214, 'YOASOBI「アイドル」Official Music Video', 'YOASOBI', 214],
    ['KICK BACK', '米津玄師', 193, '米津玄師 Kenshi Yonezu - KICK BACK', 'Kenshi Yonezu 米津玄師', 193],
    ['青春コンプレックス', '結束バンド', 203, '青春コンプレックス', 'アニプレックス チャンネル', 203],
    ['花の塔', 'さユり', 276, '花の塔 Music Video', 'music channel', 276],
    ['モニタリング', 'DECO*27 feat. 初音ミク', 182, 'DECO*27 - モニタリング feat. 初音ミク', 'DECO27_Official', 182],
    ['ロキ', 'みきとP feat. 鏡音リン', 230, 'みきとP「ロキ」MV', 'みきとP', 230],
    ['神っぽいな', 'ピノキオピー feat. 初音ミク', 205, '神っぽいな feat. 初音ミク', 'ピノキオピー_official', 205],
    ['ビビデバ', '星街すいせい', 165, 'ビビデバ / 星街彗星（官方视频）', '星街彗星Official', 172],
    ['only my railgun', 'fripSide', 257, 'fripSide / only my railgun MV', 'fripSide Official YouTube Channel', 257],
    ['God knows...', '涼宮ハルヒ（CV.平野綾）', 279, 'God knows... Music Video', 'anime channel', 279],
    ['secret base ～君がくれたもの～', 'ZONE', 297, 'ZONE「secret base ～君がくれたもの～」MUSIC VIDEO', 'ZONE', 297],
    ['Bling-Bang-Bang-Born', 'Creepy Nuts', 168, 'Creepy Nuts「Bling-Bang-Bang-Born」MV', 'Creepy Nuts', 168],
  ])('accepts representative Japanese/anime MV: %s', (title, artist, duration, candidateTitle, uploader, candidateDuration) => {
    const result = scoreNetworkMvCandidate(
      track({ title, artist, albumArtist: artist, duration }),
      { title: candidateTitle, uploader, durationSeconds: candidateDuration },
    );

    expect(result.autoEligible).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it.each([
    ['アイドル', 'YOASOBI', 214, 'アイドル / YOASOBI 歌ってみた', 'cover channel', 214],
    ['KICK BACK', '米津玄師', 193, 'KICK BACK 米津玄師 动态鼓谱', 'drum channel', 193],
    ['青春コンプレックス', '結束バンド', 203, '【bass TAB谱】青春コンプレックス - 結束バンド', 'bass channel', 203],
    ['花の塔', 'さユり', 276, '花の塔 さユり ピアノ演奏', 'piano channel', 276],
    ['モニタリング', 'DECO*27 feat. 初音ミク', 182, 'DECO*27 - モニタリング feat. AI王馬小吉', 'AI channel', 182],
    ['ヴァンパイア', 'DECO*27 feat. 初音ミク', 181, 'ヴァンパイア DECO*27 MMD 4K', 'MMD channel', 181],
    ['ロキ', 'みきとP feat. 鏡音リン', 230, 'ロキ 原创PV', 'fan channel', 230],
    ['神っぽいな', 'ピノキオピー feat. 初音ミク', 205, '神っぽいな 初音ミク nightcore', 'speed channel', 205],
    ['ビビデバ', '星街すいせい', 165, '【原创振付】ビビデバ - 星街すいせい', 'dance channel', 165],
    ['only my railgun', 'fripSide', 257, 'only my railgun fripSide LIVE', 'live channel', 257],
    ['God knows...', '涼宮ハルヒ（CV.平野綾）', 279, 'God knows... instrumental karaoke', 'karaoke channel', 279],
    ['Palette', '花たん', 230, 'Palette Official MV', 'unrelated artist', null],
  ])('rejects representative derivative or ambiguous candidate: %s', (title, artist, duration, candidateTitle, uploader, candidateDuration) => {
    const result = scoreNetworkMvCandidate(
      track({ title, artist, albumArtist: artist, duration }),
      { title: candidateTitle, uploader, durationSeconds: candidateDuration },
    );

    expect(result.autoEligible).toBe(false);
  });

  it('does not treat a time fragment from an anime unit name as artist evidence', () => {
    const result = scoreNetworkMvCandidate(
      track({ title: 'アイドル', artist: '25時、ナイトコードで。', albumArtist: '', duration: 214 }),
      { title: '25時から配信 アイドル Official MV', uploader: 'unrelated channel', durationSeconds: null },
    );

    expect(result.autoEligible).toBe(false);
    expect(result.reasons).not.toContain('artist in title');
  });
});

describe('MV duration parsing', () => {
  it.each([
    ['03:49', 229],
    ['1:02:03', 3_723],
    ['PT4M5S', 245],
    [180, 180],
  ])('parses %s', (value, expected) => {
    expect(parseMvDurationSeconds(value)).toBe(expected);
  });
});
