import { createHash } from 'node:crypto';
import type { AccountCredentials } from '../../shared/types/accounts';
import type { LibraryTrack } from '../../shared/types/library';
import type {
  MvMatchCandidate,
  MvQualityTier,
  MvQualityVariant,
  MvSettings,
  NetworkMvProviderId,
  TrackVideo,
} from '../../shared/types/mv';
import { getAccountService } from '../accounts/AccountService';
import { fetchWithNetworkProxy } from '../network/networkFetch';

export type ResolvedMvStreamVariant = MvQualityVariant & {
  url: string | null;
  headers: Record<string, string>;
  rawProviderJson: unknown | null;
};

export type MainMvOnlineProvider = {
  id: NetworkMvProviderId;
  search: (track: LibraryTrack, settings: MvSettings, queryOverride?: string) => Promise<MvMatchCandidate[]>;
  resolve: (video: TrackVideo, settings: MvSettings) => Promise<ResolvedMvStreamVariant[]>;
};

type FetchLike = typeof fetch;

type ProviderDependencies = {
  fetchImpl?: FetchLike;
  getCredentials?: (provider: NetworkMvProviderId) => AccountCredentials;
};

type BilibiliPlayEndpoint = 'playurl' | 'wbi-playurl';

type BilibiliPlayAttempt = {
  endpoint: BilibiliPlayEndpoint;
  fnval: string;
  qn: number;
  status: number | null;
  code: number | null;
  message: string | null;
  quality: number | null;
  hasDurl: boolean;
  hasDashVideo: boolean;
  error: string | null;
};

const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ECHO-Next/1.0 Safari/537.36';
const bilibiliAcceptLanguage = 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7';
const defaultExpiresMs = 45 * 60 * 1000;
const bilibiliPlayurlBanBackoffMs = 2 * 60 * 1000;

const qualityHeight: Record<Exclude<MvQualityTier, 'auto'>, number> = {
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '2160p': 2160,
  '4320p': 4320,
};

const maxQualityHeight = (quality: MvSettings['maxQuality']): number => (quality === 'max' ? Number.POSITIVE_INFINITY : qualityHeight[quality]);

const bilibiliQualityMap: Record<number, { tier: Exclude<MvQualityTier, 'auto'>; label: string }> = {
  16: { tier: '720p', label: '360p' },
  32: { tier: '720p', label: '480p' },
  64: { tier: '720p', label: '720p' },
  80: { tier: '1080p', label: '1080p' },
  112: { tier: '1080p', label: '1080p+' },
  116: { tier: '1080p', label: '1080p 60fps' },
  120: { tier: '2160p', label: '4K' },
  125: { tier: '2160p', label: 'HDR' },
  126: { tier: '2160p', label: 'Dolby Vision' },
  127: { tier: '4320p', label: '8K' },
};

const bilibiliDashFnval = '4048';
const bilibiliQualityOrder = [127, 126, 125, 120, 116, 112, 80, 64];
const bilibiliQualityHeight: Record<number, number> = {
  16: 360,
  32: 480,
  64: 720,
  80: 1080,
  112: 1080,
  116: 1080,
  120: 2160,
  125: 2160,
  126: 2160,
  127: 4320,
};
const bilibiliQualityRank = (qn: number): number => {
  const index = bilibiliQualityOrder.indexOf(qn);
  return index >= 0 ? bilibiliQualityOrder.length - index : 0;
};
const isBilibiliPlayurlBlockedAttempt = (attempt: BilibiliPlayAttempt): boolean =>
  attempt.status === 412 ||
  attempt.code === -412 ||
  attempt.error === 'request_failed:412' ||
  attempt.message?.toLowerCase().includes('request was banned') === true;

const isBrowserPlayableBilibiliCodec = (codec: string | null): boolean => {
  if (!codec) {
    return true;
  }

  const codecs = codec
    .toLowerCase()
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return !codecs.some(
    (entry) => entry.startsWith('hev1') || entry.startsWith('hvc1') || entry.startsWith('dvhe') || entry.startsWith('dvh1'),
  );
};
const bilibiliMixinKeyEncTable = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16,
  24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const nullableNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const metricNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  const raw = text(value);
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/,/g, '').replace(/\s+/g, '');
  const match = normalized.match(/^([\d.]+)(\u4e07|\u5104|\u4ebf|k|K|m|M)?$/);
  if (!match) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }

  const unit = match[2];
  const multiplier = unit === '\u4e07' ? 10_000 : unit === '\u4ebf' || unit === '\u5104' ? 100_000_000 : unit === 'k' || unit === 'K' ? 1_000 : unit === 'm' || unit === 'M' ? 1_000_000 : 1;
  return Math.round(amount * multiplier);
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const normalizeSearchText = (value: string): string =>
  decodeHtmlEntities(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/&+/g, ' ')
    .replace(/[[\]【】「」『』()（）"'“”‘’]/g, ' ')
    .replace(/[_\-~|/\\:：·・.,，。!?！？]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const meaningfulTokens = (value: string): string[] =>
  normalizeSearchText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .filter((token) => !['mv', 'pv', 'official', 'music', 'video', 'full', 'ver', 'version'].includes(token));

const scoreSearchTitle = (query: string, title: string): number => {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(title);
  if (!normalizedQuery || !normalizedTitle) {
    return 0.45;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 0.96;
  }

  const tokens = meaningfulTokens(query);
  if (tokens.length === 0) {
    return 0.45;
  }

  const weightedTokens = tokens.map((token) => ({
    token,
    weight: token === 'cover' || token === 'remix' || token === 'live' ? 0.55 : 1,
  }));
  const totalWeight = weightedTokens.reduce((total, item) => total + item.weight, 0);
  const matchedWeight = weightedTokens.reduce((total, item) => total + (normalizedTitle.includes(item.token) ? item.weight : 0), 0);
  const coverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;

  return Number(Math.max(0.45, Math.min(0.94, 0.45 + coverage * 0.42)).toFixed(4));
};

const stripHtml = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  return decodeHtmlEntities(raw.replace(/<[^>]*>/g, '')).trim();
};

const normalizeUrl = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }

  return raw;
};

const wbiKeyPart = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  return raw.split('/').pop()?.split('.')[0] ?? null;
};

const mixinWbiKey = (rawKey: string): string => bilibiliMixinKeyEncTable.map((index) => rawKey[index]).join('').slice(0, 32);

const sanitizeWbiValue = (value: unknown): string => String(value).replace(/[!'()*]/g, '');

const appendWbiSignature = (url: URL, mixinKey: string): void => {
  url.searchParams.set('wts', String(Math.round(Date.now() / 1000)));
  const query = Array.from(url.searchParams.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(sanitizeWbiValue(value))}`)
    .join('&');
  url.searchParams.set('w_rid', createHash('md5').update(`${query}${mixinKey}`).digest('hex'));
};

const firstUrl = (...values: unknown[]): string | null => {
  for (const value of values) {
    const direct = normalizeUrl(value);
    if (direct) {
      return direct;
    }

    const backup = asArray(value).map(normalizeUrl).find(Boolean);
    if (backup) {
      return backup;
    }
  }

  return null;
};

const numericArray = (value: unknown): number[] =>
  asArray(value)
    .map((entry) => number(entry))
    .filter((entry): entry is number => entry !== null);

const fpsFromDashStream = (stream: Record<string, unknown>, label: string): number | null => {
  const frameRate = text(stream.frameRate ?? stream.frame_rate);
  if (frameRate) {
    const normalizedRate = frameRate.replace(/fps$/i, '').trim();
    const ratioMatch = normalizedRate.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    const numericRate = ratioMatch
      ? Number(ratioMatch[1]) / Number(ratioMatch[2])
      : Number(normalizedRate);
    if (Number.isFinite(numericRate) && numericRate > 0) {
      return Math.round(numericRate);
    }
  }

  const labelFrameRate = label.match(/\b(\d{2,3})\s*fps\b/i);
  return labelFrameRate ? Number(labelFrameRate[1]) : null;
};

const frameRateLabel = (fps: number): string => `${Math.round(fps)}fps`;

const labelWithFrameRate = (label: string, fps: number | null): string => {
  if (!fps || fps < 55) {
    return label;
  }

  const suffix = frameRateLabel(fps);
  return new RegExp(`\\b${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(label) ? label : `${label} ${suffix}`;
};

const bilibiliCodecVariantSuffix = (codec: string | null): string => {
  const normalized = codec?.toLowerCase().trim() ?? '';
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('av01')) {
    return '-av1';
  }
  if (normalized.startsWith('avc1')) {
    return '-avc';
  }
  if (normalized.startsWith('hev1') || normalized.startsWith('hvc1')) {
    return '-hevc';
  }
  if (normalized.startsWith('dvhe') || normalized.startsWith('dvh1')) {
    return '-dolby';
  }

  return `-${normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16)}`;
};

const bilibiliStreamVariantId = (streamQn: number, fps: number | null, source: 'dash-video' | 'durl' = 'dash-video', codec: string | null = null): string => {
  const highFrameRate = fps && fps >= 100 ? `-${frameRateLabel(fps).toLowerCase()}` : '';
  const codecSuffix = source === 'dash-video' ? bilibiliCodecVariantSuffix(codec) : '';
  return `bilibili-${source === 'dash-video' ? 'dash-' : ''}qn-${streamQn}${highFrameRate}${codecSuffix}`;
};

const qualityFromHeight = (
  height: number | null,
  fallback: { tier: Exclude<MvQualityTier, 'auto'>; label: string },
): { tier: Exclude<MvQualityTier, 'auto'>; label: string } => {
  if (!height) {
    return fallback;
  }

  if (height >= 4320) {
    return bilibiliQualityMap[127];
  }
  if (height >= 2160) {
    return bilibiliQualityMap[120];
  }
  if (height >= 1440) {
    return { tier: '1440p', label: '1440p' };
  }
  if (height >= 1080) {
    return bilibiliQualityMap[80];
  }

  return bilibiliQualityMap[64];
};

const bilibiliQualitiesForSettings = (settings: MvSettings): number[] =>
  bilibiliQualityOrder.filter((qn) => {
    const quality = bilibiliQualityMap[qn];
    if (!quality) {
      return false;
    }

    if (qn === 116 && settings.allow60fps === false) {
      return false;
    }

    if (settings.maxQuality === 'max') {
      return true;
    }
    if (settings.maxQuality === '2160p') {
      return qn <= 120;
    }
    if (settings.maxQuality === '1440p') {
      return qn <= 112;
    }
    if (settings.maxQuality === '1080p') {
      return qn <= (settings.allow60fps === false ? 112 : 116);
    }

    return qn <= 64 && qualityHeight[quality.tier] <= maxQualityHeight(settings.maxQuality);
  });

const bilibiliRequestedQualitiesForSettings = (settings: MvSettings): number[] => {
  const qualities = bilibiliQualitiesForSettings(settings);
  const primary = qualities[0];
  if (!primary) {
    return [];
  }

  const fallback = qualities.find((qn) => qn < primary && qn <= 80) ?? qualities.find((qn) => qn < primary);
  return fallback ? [primary, fallback] : [primary];
};

const makeQualityVariant = (
  id: string,
  label: string,
  qualityTier: MvQualityTier,
  overrides: Partial<MvQualityVariant> = {},
): MvQualityVariant => ({
  id,
  label,
  qualityTier,
  width: overrides.width ?? null,
  height: overrides.height ?? (qualityTier !== 'auto' ? qualityHeight[qualityTier] : null),
  fps: overrides.fps ?? null,
  codec: overrides.codec ?? null,
  container: overrides.container ?? null,
  mimeType: overrides.mimeType ?? null,
  protocol: overrides.protocol ?? 'direct',
  playableInApp: overrides.playableInApp ?? false,
  requiresAccount: overrides.requiresAccount ?? false,
  expiresAt: overrides.expiresAt ?? null,
});

const externalVariant = (
  provider: NetworkMvProviderId,
  providerUrl: string | null,
  label = 'External player',
  rawProviderJson: unknown | null = null,
): ResolvedMvStreamVariant => ({
  ...makeQualityVariant(`${provider}:external`, label, 'auto', {
    protocol: 'external',
    playableInApp: false,
  }),
  url: providerUrl,
  headers: {},
  rawProviderJson,
});

const fetchJsonWithTimeout = async (fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<{ status: number; ok: boolean; payload: unknown }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': userAgent,
        ...headers,
      },
      signal: controller.signal,
    });

    const body = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      payload: JSON.parse(body.trim().replace(/^[^(]*\((.*)\);?$/s, '$1')) as unknown,
    };
  } finally {
    clearTimeout(timer);
  }
};

const withTimeout = async (fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<unknown> => {
  const response = await fetchJsonWithTimeout(fetchImpl, url, headers);
  if (!response.ok) {
    throw new Error(`request_failed:${response.status}`);
  }

  return response.payload;
};

const bilibiliSearchReferer = (query: string): string =>
  `https://search.bilibili.com/video?keyword=${encodeURIComponent(query)}`;

const bilibiliAllSearchReferer = (query: string): string =>
  `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`;

const bilibiliSearchHeaders = (query: string, credentials: Record<string, string>): Record<string, string> => ({
  ...credentials,
  Referer: bilibiliSearchReferer(query),
  Origin: 'https://search.bilibili.com',
  'Accept-Language': bilibiliAcceptLanguage,
});

const bilibiliVideoHeaders = (bvid: string, credentials: Record<string, string>): Record<string, string> => ({
  ...credentials,
  Referer: `https://www.bilibili.com/video/${bvid}`,
  Origin: 'https://www.bilibili.com',
  'Accept-Language': bilibiliAcceptLanguage,
});

class ProviderBase {
  protected readonly fetchImpl: FetchLike;
  private readonly credentialsReader: (provider: NetworkMvProviderId) => AccountCredentials;

  constructor(dependencies: ProviderDependencies = {}) {
    this.fetchImpl = dependencies.fetchImpl ?? fetchWithNetworkProxy;
    this.credentialsReader = dependencies.getCredentials ?? ((provider) => getAccountService().getCredentials(provider));
  }

  protected credentials(provider: NetworkMvProviderId): AccountCredentials {
    return this.credentialsReader(provider);
  }

  protected cookieHeaders(provider: NetworkMvProviderId): Record<string, string> {
    const cookie = this.credentials(provider).cookie;
    return cookie ? { Cookie: cookie } : {};
  }

  protected async bilibiliWbiMixinKey(headers: Record<string, string>): Promise<string | null> {
    try {
      const payload = await withTimeout(this.fetchImpl, 'https://api.bilibili.com/x/web-interface/nav', headers);
      const data = isRecord(payload) ? payload.data : null;
      const wbiImg = isRecord(data) ? data.wbi_img : null;
      const imgKey = wbiKeyPart(isRecord(wbiImg) ? wbiImg.img_url : null);
      const subKey = wbiKeyPart(isRecord(wbiImg) ? wbiImg.sub_url : null);
      return imgKey && subKey ? mixinWbiKey(`${imgKey}${subKey}`) : null;
    } catch {
      return null;
    }
  }
}

export class BilibiliMvProvider extends ProviderBase implements MainMvOnlineProvider {
  readonly id = 'bilibili' as const;
  private readonly playurlBanUntilByBvid = new Map<string, number>();

  private isPlayurlTemporarilyBlocked(bvid: string): boolean {
    const blockedUntil = this.playurlBanUntilByBvid.get(bvid) ?? 0;
    if (blockedUntil <= Date.now()) {
      this.playurlBanUntilByBvid.delete(bvid);
      return false;
    }

    return true;
  }

  private rememberPlayurlBlocked(bvid: string): void {
    this.playurlBanUntilByBvid.set(bvid, Date.now() + bilibiliPlayurlBanBackoffMs);
  }

  async search(track: LibraryTrack, settings: MvSettings, queryOverride?: string): Promise<MvMatchCandidate[]> {
    const query = queryOverride?.trim() || [track.title, track.artist || track.albumArtist, 'MV'].filter(Boolean).join(' ');
    const headers = bilibiliSearchHeaders(query, this.cookieHeaders(this.id));
    const wbiMixinKey = await this.bilibiliWbiMixinKey(headers);
    const typeSearchUrl = new URL(
      wbiMixinKey
        ? 'https://api.bilibili.com/x/web-interface/wbi/search/type'
        : 'https://api.bilibili.com/x/web-interface/search/type',
    );
    typeSearchUrl.searchParams.set('search_type', 'video');
    typeSearchUrl.searchParams.set('keyword', query);
    typeSearchUrl.searchParams.set('page', '1');
    typeSearchUrl.searchParams.set('order', 'click');
    typeSearchUrl.searchParams.set('page_size', '8');
    if (wbiMixinKey) {
      appendWbiSignature(typeSearchUrl, wbiMixinKey);
    }

    let typeResults: unknown[] = [];
    try {
      const typePayload = await withTimeout(this.fetchImpl, typeSearchUrl.toString(), headers);
      const typeData = isRecord(typePayload) ? typePayload.data : null;
      typeResults = isRecord(typeData) ? asArray(typeData.result) : [];
    } catch {
      typeResults = [];
    }
    const results = typeResults.length > 0 ? typeResults : await this.searchAllVideos(query, headers);

    return results
      .flatMap((item): (MvMatchCandidate & { viewCount: number | null })[] => {
      if (!isRecord(item)) {
        return [];
      }

      const bvid = text(item.bvid);
      const title = stripHtml(item.title);
      const viewCount = metricNumber(item.play);
      if (!bvid || !title) {
        return [];
      }
      const score = scoreSearchTitle(query, title);

      const providerUrl = `https://www.bilibili.com/video/${bvid}`;
      return [
        {
          id: `bilibili:${bvid}`,
          provider: this.id,
          sourceType: 'search_candidate',
          title,
          artist: track.artist || track.albumArtist || null,
          filePath: null,
          url: providerUrl,
          providerUrl,
          thumbnailUrl: normalizeUrl(item.pic),
          uploader: stripHtml(item.author) ?? null,
          viewCount,
          availableQualities: [],
          durationSeconds: null,
          score,
          playableInApp: true,
          reasons: ['Bilibili search', viewCount !== null ? `播放 ${viewCount}` : '播放量未知'],
        },
      ];
    })
      .sort((left, right) => {
        if (settings.preferHighestViewCount) {
          const viewDelta = (right.viewCount ?? -1) - (left.viewCount ?? -1);
          if (viewDelta !== 0) {
            return viewDelta;
          }
        }

        const scoreDelta = right.score - left.score;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return (right.viewCount ?? -1) - (left.viewCount ?? -1);
      })
      .slice(0, 8)
      .map((candidate) => candidate);
  }

  private async searchAllVideos(query: string, headers: Record<string, string>): Promise<unknown[]> {
    try {
      const url = new URL('https://api.bilibili.com/x/web-interface/search/all/v2');
      url.searchParams.set('keyword', query);
      url.searchParams.set('page', '1');

      const payload = await withTimeout(this.fetchImpl, url.toString(), {
        ...headers,
        Referer: bilibiliAllSearchReferer(query),
      });
      const data = isRecord(payload) ? payload.data : null;
      const groups = isRecord(data) ? asArray(data.result) : [];
      const videoGroup = groups.find(
        (group) => isRecord(group) && group.result_type === 'video',
      );

      return isRecord(videoGroup) ? asArray(videoGroup.data) : [];
    } catch {
      return [];
    }
  }

  async resolve(video: TrackVideo, settings: MvSettings): Promise<ResolvedMvStreamVariant[]> {
    const bvid = video.sourceId ?? (video.id.startsWith('bilibili:') ? video.id.slice('bilibili:'.length) : null);
    if (!bvid) {
      return [externalVariant(this.id, video.providerUrl ?? video.url, 'Bilibili')];
    }

    if (this.isPlayurlTemporarilyBlocked(bvid)) {
      return [externalVariant(this.id, video.providerUrl ?? video.url, 'Bilibili')];
    }

    const headers = bilibiliVideoHeaders(bvid, this.cookieHeaders(this.id));
    const viewPayload = await withTimeout(this.fetchImpl, `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, headers);
    const viewData = isRecord(viewPayload) ? viewPayload.data : null;
    const cid = number(isRecord(viewData) ? viewData.cid : null);
    if (!cid) {
      console.warn('[mv] Bilibili MV view did not return a playable cid.', {
        bvid,
        title: video.title,
      });
      return [externalVariant(this.id, video.providerUrl ?? video.url, 'Bilibili')];
    }

    const requestedQualities = bilibiliRequestedQualitiesForSettings(settings);
    const variants: ResolvedMvStreamVariant[] = [];
    const playAttempts: BilibiliPlayAttempt[] = [];
    const expiresAt = new Date(Date.now() + defaultExpiresMs).toISOString();
    const wbiMixinKey = await this.bilibiliWbiMixinKey(headers);
    const makePlayUrl = (qn: number, fnval: string, endpoint: BilibiliPlayEndpoint): URL => {
      const playUrl = new URL(endpoint === 'wbi-playurl' ? 'https://api.bilibili.com/x/player/wbi/playurl' : 'https://api.bilibili.com/x/player/playurl');
      playUrl.searchParams.set('bvid', bvid);
      playUrl.searchParams.set('cid', String(cid));
      playUrl.searchParams.set('qn', String(qn));
      playUrl.searchParams.set('fnval', fnval);
      playUrl.searchParams.set('fnver', '0');
      playUrl.searchParams.set('fourk', '1');
      if (endpoint === 'wbi-playurl' && wbiMixinKey) {
        appendWbiSignature(playUrl, wbiMixinKey);
      }

      return playUrl;
    };
    const playEndpoints: BilibiliPlayEndpoint[] = wbiMixinKey ? ['wbi-playurl', 'playurl'] : ['playurl'];
    let playurlBlocked = false;
    const fetchPlayData = async (qn: number, fnval: string): Promise<{ data: Record<string, unknown>; endpoint: BilibiliPlayEndpoint } | null> => {
      if (playurlBlocked) {
        return null;
      }

      for (const endpoint of playEndpoints) {
        try {
          const response = await fetchJsonWithTimeout(this.fetchImpl, makePlayUrl(qn, fnval, endpoint).toString(), headers);
          const payload = response.payload;
          const code = nullableNumber(isRecord(payload) ? payload.code : null);
          const message = text(isRecord(payload) ? payload.message : null);
          const data = isRecord(payload) ? payload.data : null;
          const dash = isRecord(data) && isRecord(data.dash) ? data.dash : null;
          const hasDashVideo = asArray(dash?.video).some(isRecord);
          const hasDurl = isRecord(data) && asArray(data.durl).some(isRecord);
          const attempt: BilibiliPlayAttempt = {
            endpoint,
            fnval,
            qn,
            status: response.status,
            code,
            message,
            quality: number(isRecord(data) ? data.quality : null),
            hasDurl,
            hasDashVideo,
            error: response.ok ? null : `request_failed:${response.status}`,
          };
          playAttempts.push(attempt);

          if (isBilibiliPlayurlBlockedAttempt(attempt)) {
            playurlBlocked = true;
            this.rememberPlayurlBlocked(bvid);
            return null;
          }

          if (!response.ok || !isRecord(data)) {
            continue;
          }

          if (hasDashVideo || hasDurl) {
            return { data, endpoint };
          }
        } catch (error) {
          const attempt: BilibiliPlayAttempt = {
            endpoint,
            fnval,
            qn,
            status: null,
            code: null,
            message: null,
            quality: null,
            hasDurl: false,
            hasDashVideo: false,
            error: error instanceof Error ? error.message : String(error),
          };
          playAttempts.push(attempt);
          if (isBilibiliPlayurlBlockedAttempt(attempt)) {
            playurlBlocked = true;
            this.rememberPlayurlBlocked(bvid);
            return null;
          }
          // Try the plain playurl endpoint if WBI playurl is rejected or returns an unusable payload.
        }
      }

      return null;
    };
    const pushStreamVariant = ({
      actualQn,
      actualQuality,
      availableQn,
      endpoint,
      requestedQn,
      source,
      stream,
    }: {
      actualQn: number | null;
      actualQuality: { tier: Exclude<MvQualityTier, 'auto'>; label: string };
      availableQn: number[];
      endpoint: 'playurl' | 'wbi-playurl';
      requestedQn: number;
      source: 'dash-video' | 'durl';
      stream: Record<string, unknown>;
    }): void => {
      const streamHeight = nullableNumber(stream.height);
      const inferredQuality = qualityFromHeight(streamHeight, actualQuality);
      const streamQn = number(stream.id) ?? actualQn ?? (source === 'durl' && requestedQn > 120 ? 120 : requestedQn);
      const streamQuality = bilibiliQualityMap[streamQn] ?? inferredQuality;
      const streamUrl = firstUrl(stream.baseUrl, stream.base_url, stream.url, stream.backupUrl, stream.backup_url);
      const variantFps = source === 'dash-video' ? fpsFromDashStream(stream, streamQuality.label) : streamQn === 116 ? 60 : null;
      const codec = text(stream.codecs);
      const streamId = bilibiliStreamVariantId(streamQn, variantFps, source, codec);

      if (!streamUrl || variants.some((variant) => variant.id === streamId || variant.url === streamUrl)) {
        return;
      }

      const variantHeight = streamHeight ?? bilibiliQualityHeight[streamQn] ?? qualityHeight[streamQuality.tier];
      const streamWidth = nullableNumber(stream.width);
      if (variantFps && variantFps >= 55 && settings.allow60fps === false) {
        return;
      }

      const label = labelWithFrameRate(streamQuality.label, variantFps);
      const browserPlayable = isBrowserPlayableBilibiliCodec(codec);
      const mutedVideoOnly = source === 'dash-video' && browserPlayable;

      variants.push({
        ...makeQualityVariant(streamId, label, streamQuality.tier, {
          width: streamWidth,
          height: variantHeight,
          fps: variantFps,
          codec,
          container: 'mp4',
          mimeType: 'video/mp4',
          protocol: mutedVideoOnly || source === 'durl' ? 'direct' : 'dash',
          playableInApp: mutedVideoOnly || (source === 'durl' && browserPlayable),
          requiresAccount: streamQn >= 112 && !this.credentials(this.id).cookie,
          expiresAt,
        }),
        url: streamUrl,
        headers: {
          ...this.cookieHeaders(this.id),
          Referer: video.providerUrl ?? `https://www.bilibili.com/video/${bvid}`,
          'User-Agent': userAgent,
        },
        rawProviderJson: {
          provider: this.id,
          resolver: source === 'dash-video' ? 'bilibili-dash-video-v4' : 'bilibili-progressive-mp4-v1',
          source,
          endpoint,
          requestedQn,
          qn: streamQn,
          qualityRank: bilibiliQualityRank(streamQn),
          availableQn,
          qualityLimited: streamQn < requestedQn,
          mutedVideoOnly,
          cid,
        },
      });
    };

    const hasPlayableDirectVariant = (): boolean =>
      variants.some((variant) => variant.protocol === 'direct' && variant.playableInApp && variant.url);
    for (const qn of requestedQualities) {
      const quality = bilibiliQualityMap[qn];
      if (!quality) {
        continue;
      }

      if (qualityHeight[quality.tier] > maxQualityHeight(settings.maxQuality)) {
        continue;
      }

      try {
        const playResult = await fetchPlayData(qn, bilibiliDashFnval);
        const playData = playResult?.data ?? null;
        const actualQn = number(isRecord(playData) ? playData.quality : null);
        const actualQuality = actualQn ? bilibiliQualityMap[actualQn] ?? quality : quality;
        const availableQn = isRecord(playData)
          ? Array.from(new Set([...numericArray(playData.accept_quality), ...numericArray(playData.acceptQuality)]))
          : [];
        const dash = isRecord(playData) && isRecord(playData.dash) ? playData.dash : null;
        const dashStreams = asArray(dash?.video)
          .filter(isRecord)
          .filter((stream) => {
            const streamHeight = nullableNumber(stream.height);
            return !streamHeight || streamHeight <= maxQualityHeight(settings.maxQuality);
          })
          .map((stream) => ({ stream, source: 'dash-video' as const }));
        const durl = asArray(isRecord(playData) ? playData.durl : null).find(isRecord);
        const streamCandidates = dashStreams.length > 0 ? dashStreams : durl ? [{ stream: durl, source: 'durl' as const }] : [];

        for (const { stream, source } of streamCandidates) {
          pushStreamVariant({
            actualQn,
            actualQuality,
            availableQn,
            endpoint: playResult?.endpoint ?? 'playurl',
            requestedQn: qn,
            source,
            stream,
          });
        }
      } catch {
        // Progressive MP4 may still resolve when DASH is unavailable.
      }

      if (playurlBlocked || hasPlayableDirectVariant()) {
        break;
      }

      try {
        const progressiveResult = await fetchPlayData(qn, '1');
        const progressiveData = progressiveResult?.data ?? null;
        const actualQn = number(isRecord(progressiveData) ? progressiveData.quality : null);
        const actualQuality = actualQn ? bilibiliQualityMap[actualQn] ?? quality : quality;
        const availableQn = isRecord(progressiveData)
          ? Array.from(new Set([...numericArray(progressiveData.accept_quality), ...numericArray(progressiveData.acceptQuality)]))
          : [];
        const durlStreams = asArray(isRecord(progressiveData) ? progressiveData.durl : null).filter(isRecord);
        for (const stream of durlStreams) {
          pushStreamVariant({
            actualQn,
            actualQuality,
            availableQn,
            endpoint: progressiveResult?.endpoint ?? 'playurl',
            requestedQn: qn,
            source: 'durl',
            stream,
          });
        }
      } catch {
        // DASH metadata is still useful for external/manual playback if progressive MP4 is unavailable.
      }

      if (playurlBlocked || hasPlayableDirectVariant()) {
        break;
      }
    }

    const blockedAttempt = playAttempts.find(isBilibiliPlayurlBlockedAttempt) ?? null;
    const blockedRawProviderJson = blockedAttempt
      ? {
          provider: this.id,
          resolver: 'bilibili-playurl',
          unavailableReason: 'bilibili-playurl-blocked',
          status: blockedAttempt.status,
          code: blockedAttempt.code,
          message: blockedAttempt.message,
          error: blockedAttempt.error,
          attemptedCount: playAttempts.length,
        }
      : null;

    if (!variants.some((variant) => variant.protocol === 'direct' && variant.playableInApp && variant.url)) {
      console.warn('[mv] Bilibili MV resolved without an in-app MP4 stream.', {
        bvid,
        cid,
        maxQuality: settings.maxQuality,
        allow60fps: settings.allow60fps,
        attempts: playAttempts,
      });
    }

    if (blockedRawProviderJson && !hasPlayableDirectVariant()) {
      return [...variants, externalVariant(this.id, video.providerUrl ?? video.url, 'Bilibili', blockedRawProviderJson)];
    }

    return variants.length > 0 ? variants : [externalVariant(this.id, video.providerUrl ?? video.url, 'Bilibili')];
  }
}

export class YouTubeMvProvider extends ProviderBase implements MainMvOnlineProvider {
  readonly id = 'youtube' as const;

  async search(track: LibraryTrack, _settings: MvSettings, queryOverride?: string): Promise<MvMatchCandidate[]> {
    const apiKey = process.env.ECHO_YOUTUBE_API_KEY || process.env.YOUTUBE_DATA_API_KEY;
    if (!apiKey) {
      return [];
    }

    const query = queryOverride?.trim() || [track.title, track.artist || track.albumArtist, 'MV'].filter(Boolean).join(' ');
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('maxResults', '8');
    url.searchParams.set('order', 'viewCount');
    url.searchParams.set('q', query);
    url.searchParams.set('key', apiKey);

    const payload = await withTimeout(this.fetchImpl, url.toString(), {});
    const items = asArray(isRecord(payload) ? payload.items : null);

    return items.slice(0, 8).flatMap((item): MvMatchCandidate[] => {
      if (!isRecord(item) || !isRecord(item.id) || !isRecord(item.snippet)) {
        return [];
      }

      const videoId = text(item.id.videoId);
      const title = text(item.snippet.title);
      if (!videoId || !title) {
        return [];
      }

      const thumbnails = isRecord(item.snippet.thumbnails) ? item.snippet.thumbnails : {};
      const thumbnail = isRecord(thumbnails.high) ? normalizeUrl(thumbnails.high.url) : null;
      const providerUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const score = scoreSearchTitle(query, title);

      return [
        {
          id: `youtube:${videoId}`,
          provider: this.id,
          sourceType: 'search_candidate',
          title,
          artist: track.artist || track.albumArtist || null,
          filePath: null,
          url: providerUrl,
          providerUrl,
          thumbnailUrl: thumbnail,
          uploader: text(item.snippet.channelTitle),
          availableQualities: [],
          durationSeconds: null,
          score,
          playableInApp: false,
          reasons: ['YouTube Data API'],
        },
      ];
    });
  }

  async resolve(video: TrackVideo): Promise<ResolvedMvStreamVariant[]> {
    return [externalVariant(this.id, video.providerUrl ?? video.url, 'YouTube')];
  }
}

export const createOnlineMvProviders = (dependencies: ProviderDependencies = {}): MainMvOnlineProvider[] => [
  new BilibiliMvProvider(dependencies),
  new YouTubeMvProvider(dependencies),
];
