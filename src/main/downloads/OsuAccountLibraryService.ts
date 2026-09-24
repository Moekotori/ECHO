import {
  osuRulesetValues,
  type OsuAccountBeatmapItem,
  type OsuAccountCollectionRequest,
  type OsuAccountCollectionResponse,
  type OsuAccountProfile,
  type OsuRuleset,
} from '../../shared/types/downloads';
import { fetchWithNetworkProxy } from '../network/networkFetch';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type JsonRecord = Record<string, unknown>;

const browserUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const osuOrigin = 'https://osu.ppy.sh';
const pageSize = 100;
const maxFavouritePages = 100;
const mostPlayedLimit = 100;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cleanText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const cleanNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const cleanPositiveInteger = (value: unknown): number | null => {
  const parsed = cleanNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const cleanNonNegativeInteger = (value: unknown): number | null => {
  const parsed = cleanNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const cleanBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const normalizeRuleset = (value: unknown): OsuRuleset =>
  osuRulesetValues.includes(value as OsuRuleset) ? (value as OsuRuleset) : 'osu';

const jsonScript = (html: string, id: string): unknown => {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = html.match(new RegExp(`<script\\b[^>]*\\bid=(?:"${escapedId}"|'${escapedId}')[^>]*>([\\s\\S]*?)<\\/script>`, 'iu'));
  if (!match?.[1]) {
    return null;
  }

  try {
    return JSON.parse(match[1].trim()) as unknown;
  } catch {
    return null;
  }
};

const osuHeaders = (cookie: string, accept: string, referer = `${osuOrigin}/`): Record<string, string> => ({
  Accept: accept,
  Cookie: cookie,
  Referer: referer,
  'User-Agent': browserUserAgent,
});

const coversFrom = (beatmapset: JsonRecord): JsonRecord =>
  isRecord(beatmapset.covers) ? beatmapset.covers : {};

const coverUrlFrom = (beatmapset: JsonRecord): string | null => {
  const covers = coversFrom(beatmapset);
  const rawUrl =
    cleanText(covers['card@2x']) ??
    cleanText(covers.card) ??
    cleanText(covers['cover@2x']) ??
    cleanText(covers.cover) ??
    cleanText(covers['list@2x']) ??
    cleanText(covers.list);
  if (!rawUrl) {
    return null;
  }

  const url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
    }
    if (parsed.protocol === 'https:' && parsed.hostname === 'assets.ppy.sh') {
      return `echo-image://remote/${encodeURIComponent(parsed.toString())}?referer=${encodeURIComponent(`${osuOrigin}/`)}`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
};

const titleFrom = (beatmapset: JsonRecord): string =>
  cleanText(beatmapset.title_unicode) ?? cleanText(beatmapset.title) ?? 'Untitled beatmap';

const modsFrom = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((mod) => (typeof mod === 'string' ? mod : isRecord(mod) ? cleanText(mod.acronym) : null))
    .filter((mod): mod is string => Boolean(mod));
};

const maxDurationFromBeatmaps = (value: unknown): number | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const durations = value
    .map((beatmap) => {
      if (!isRecord(beatmap)) {
        return null;
      }
      return cleanNumber(beatmap.total_length) ?? cleanNumber(beatmap.hit_length);
    })
    .filter((duration): duration is number => duration !== null && duration > 0);

  return durations.length > 0 ? Math.max(...durations) : null;
};

const mapBestScore = (value: unknown, position: number, ruleset: OsuRuleset): OsuAccountBeatmapItem | null => {
  if (!isRecord(value) || !isRecord(value.beatmapset)) {
    return null;
  }

  const beatmapset = value.beatmapset;
  const beatmap = isRecord(value.beatmap) ? value.beatmap : {};
  const beatmapsetId = cleanPositiveInteger(beatmapset.id);
  if (!beatmapsetId) {
    return null;
  }

  const beatmapId = cleanPositiveInteger(beatmap.id);
  const scoreId =
    cleanText(value.id) ??
    (cleanPositiveInteger(value.id) ? String(cleanPositiveInteger(value.id)) : null) ??
    cleanText(value.best_id) ??
    (cleanPositiveInteger(value.best_id) ? String(cleanPositiveInteger(value.best_id)) : null) ??
    String(position);
  const fragment = beatmapId ? `#${encodeURIComponent(ruleset)}/${encodeURIComponent(String(beatmapId))}` : '';

  return {
    key: `best:${scoreId}:${position}`,
    beatmapsetId: String(beatmapsetId),
    beatmapId: beatmapId ? String(beatmapId) : null,
    title: titleFrom(beatmapset),
    artist: cleanText(beatmapset.artist_unicode) ?? cleanText(beatmapset.artist),
    creator: cleanText(beatmapset.creator),
    coverUrl: coverUrlFrom(beatmapset),
    webpageUrl: `${osuOrigin}/beatmapsets/${encodeURIComponent(String(beatmapsetId))}${fragment}`,
    durationSeconds: cleanNumber(beatmap.total_length) ?? cleanNumber(beatmap.hit_length),
    position,
    pp: cleanNumber(value.pp),
    accuracy: cleanNumber(value.accuracy),
    scoreRank: cleanText(value.rank),
    mods: modsFrom(value.mods),
    difficultyName: cleanText(beatmap.version),
    starRating: cleanNumber(beatmap.difficulty_rating),
    playCount: null,
  };
};

const mapFavourite = (value: unknown, position: number): OsuAccountBeatmapItem | null => {
  if (!isRecord(value)) {
    return null;
  }

  const beatmapsetId = cleanPositiveInteger(value.id);
  if (!beatmapsetId) {
    return null;
  }

  return {
    key: `favourite:${beatmapsetId}`,
    beatmapsetId: String(beatmapsetId),
    beatmapId: null,
    title: titleFrom(value),
    artist: cleanText(value.artist_unicode) ?? cleanText(value.artist),
    creator: cleanText(value.creator),
    coverUrl: coverUrlFrom(value),
    webpageUrl: `${osuOrigin}/beatmapsets/${encodeURIComponent(String(beatmapsetId))}`,
    durationSeconds: maxDurationFromBeatmaps(value.beatmaps),
    position,
    pp: null,
    accuracy: null,
    scoreRank: null,
    mods: [],
    difficultyName: null,
    starRating: null,
    playCount: null,
  };
};

const mapMostPlayed = (value: unknown, position: number): OsuAccountBeatmapItem | null => {
  if (!isRecord(value) || !isRecord(value.beatmap) || !isRecord(value.beatmapset)) {
    return null;
  }

  const beatmap = value.beatmap;
  const beatmapset = value.beatmapset;
  const beatmapId = cleanPositiveInteger(value.beatmap_id) ?? cleanPositiveInteger(beatmap.id);
  const beatmapsetId = cleanPositiveInteger(beatmapset.id) ?? cleanPositiveInteger(beatmap.beatmapset_id);
  if (!beatmapId || !beatmapsetId) {
    return null;
  }

  const ruleset = normalizeRuleset(beatmap.mode);
  return {
    key: `most_played:${beatmapId}`,
    beatmapsetId: String(beatmapsetId),
    beatmapId: String(beatmapId),
    title: titleFrom(beatmapset),
    artist: cleanText(beatmapset.artist_unicode) ?? cleanText(beatmapset.artist),
    creator: cleanText(beatmapset.creator),
    coverUrl: coverUrlFrom(beatmapset),
    webpageUrl: `${osuOrigin}/beatmapsets/${encodeURIComponent(String(beatmapsetId))}#${encodeURIComponent(ruleset)}/${encodeURIComponent(String(beatmapId))}`,
    durationSeconds: cleanNumber(beatmap.total_length) ?? cleanNumber(beatmap.hit_length),
    position,
    pp: null,
    accuracy: null,
    scoreRank: null,
    mods: [],
    difficultyName: cleanText(beatmap.version),
    starRating: cleanNumber(beatmap.difficulty_rating),
    playCount: cleanNonNegativeInteger(value.count),
  };
};

const requireCookie = (cookie: string): string => {
  const trimmed = cookie.trim();
  if (!trimmed) {
    throw new Error('osu_account_login_required');
  }
  return trimmed;
};

const requireJsonArray = async (response: Response, label: string): Promise<unknown[]> => {
  if (response.status === 401 || response.status === 403) {
    throw new Error('osu_account_login_expired');
  }
  if (!response.ok) {
    throw new Error(`${label} HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error(`${label} returned an unexpected response`);
  }
  return payload;
};

const profileFromUser = (user: JsonRecord): OsuAccountProfile | null => {
  const userId = cleanPositiveInteger(user.id);
  const username = cleanText(user.username);
  if (!userId || !username) {
    return null;
  }

  const defaultRuleset = normalizeRuleset(user.playmode);
  const statisticsRulesets = isRecord(user.statistics_rulesets) ? user.statistics_rulesets : {};
  const rulesetStatistics = isRecord(statisticsRulesets[defaultRuleset]) ? statisticsRulesets[defaultRuleset] : null;
  const statistics = rulesetStatistics ?? (isRecord(user.statistics) ? user.statistics : {});
  const level = isRecord(statistics.level) ? statistics.level : {};
  const country = isRecord(user.country) ? user.country : {};

  return {
    userId,
    username,
    avatarUrl: cleanText(user.avatar_url),
    countryCode: cleanText(user.country_code) ?? cleanText(country.code),
    isOnline: cleanBoolean(user.is_online),
    isSupporter: cleanBoolean(user.is_supporter) ?? false,
    defaultRuleset,
    globalRank: cleanPositiveInteger(statistics.global_rank),
    countryRank: cleanPositiveInteger(statistics.country_rank),
    performancePoints: cleanNumber(statistics.pp),
    hitAccuracy: cleanNumber(statistics.hit_accuracy),
    level: cleanNumber(level.current),
    playCount: cleanNonNegativeInteger(statistics.play_count),
    maximumCombo: cleanNonNegativeInteger(statistics.maximum_combo),
    playTimeSeconds: cleanNonNegativeInteger(statistics.play_time),
    bestScoreCount: cleanNonNegativeInteger(user.scores_best_count),
    favouriteBeatmapsetCount: cleanNonNegativeInteger(user.favourite_beatmapset_count),
    mostPlayedBeatmapCount: cleanNonNegativeInteger(user.beatmap_playcounts_count),
  };
};

const hasProfileStatistics = (profile: OsuAccountProfile): boolean =>
  profile.globalRank !== null ||
  profile.performancePoints !== null ||
  profile.playCount !== null ||
  profile.playTimeSeconds !== null;

export const fetchOsuAccountProfile = async (
  cookie: string,
  fetcher: FetchLike = fetchWithNetworkProxy,
): Promise<OsuAccountProfile> => {
  const validCookie = requireCookie(cookie);
  const response = await fetcher(`${osuOrigin}/`, {
    headers: osuHeaders(validCookie, 'text/html,application/xhtml+xml'),
  });
  if (!response.ok) {
    throw new Error(`osu! account check failed with HTTP ${response.status}`);
  }

  const currentUser = jsonScript(await response.text(), 'json-current-user');
  if (!isRecord(currentUser)) {
    throw new Error('osu_account_login_expired');
  }

  const summaryProfile = profileFromUser(currentUser);
  if (!summaryProfile) {
    throw new Error('osu_account_login_expired');
  }

  if (hasProfileStatistics(summaryProfile)) {
    return summaryProfile;
  }

  try {
    const profileUrl = `${osuOrigin}/users/${encodeURIComponent(String(summaryProfile.userId))}/${encodeURIComponent(summaryProfile.defaultRuleset)}`;
    const detailResponse = await fetcher(profileUrl, {
      headers: osuHeaders(validCookie, 'text/html,application/xhtml+xml', `${osuOrigin}/`),
    });
    if (!detailResponse.ok) {
      return summaryProfile;
    }

    const detailUser = jsonScript(await detailResponse.text(), 'json-user');
    if (!isRecord(detailUser)) {
      return summaryProfile;
    }

    const detailedProfile = profileFromUser({
      ...currentUser,
      ...detailUser,
      statistics_rulesets: detailUser.statistics_rulesets ?? currentUser.statistics_rulesets,
      statistics: detailUser.statistics ?? currentUser.statistics,
    });
    return detailedProfile?.userId === summaryProfile.userId ? detailedProfile : summaryProfile;
  } catch {
    return summaryProfile;
  }
};

export const fetchOsuAccountCollection = async (
  cookie: string,
  request: OsuAccountCollectionRequest,
  fetcher: FetchLike = fetchWithNetworkProxy,
): Promise<OsuAccountCollectionResponse> => {
  const validCookie = requireCookie(cookie);
  const profile = await fetchOsuAccountProfile(validCookie, fetcher);
  const profileUrl = `${osuOrigin}/users/${encodeURIComponent(String(profile.userId))}`;

  if (request.kind === 'best') {
    const start = Math.max(1, Math.min(100, Math.trunc(request.start)));
    const end = Math.max(start, Math.min(100, Math.trunc(request.end)));
    const ruleset = normalizeRuleset(request.ruleset);
    const url = new URL(`${profileUrl}/scores/best`);
    url.searchParams.set('mode', ruleset);
    url.searchParams.set('limit', String(end - start + 1));
    url.searchParams.set('offset', String(start - 1));
    const response = await fetcher(url, {
      headers: osuHeaders(validCookie, 'application/json', `${profileUrl}/${ruleset}`),
    });
    const payload = await requireJsonArray(response, 'osu! BP request');
    const items = payload
      .map((entry, index) => mapBestScore(entry, start + index, ruleset))
      .filter((item): item is OsuAccountBeatmapItem => Boolean(item));
    const resolvedProfile =
      start === 1 && end === 100
        ? { ...profile, bestScoreCount: payload.length }
        : profile;
    return {
      profile: resolvedProfile,
      kind: 'best',
      items,
      total: resolvedProfile.bestScoreCount,
    };
  }

  if (request.kind === 'most_played') {
    const offset = Math.max(0, Math.trunc(request.offset ?? 0));
    const limit = Math.max(1, Math.min(mostPlayedLimit, Math.trunc(request.limit ?? mostPlayedLimit)));
    const url = new URL(`${profileUrl}/beatmapsets/most_played`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    const response = await fetcher(url, {
      headers: osuHeaders(validCookie, 'application/json', `${profileUrl}/historical`),
    });
    const payload = await requireJsonArray(response, 'osu! most played request');
    const items = payload
      .map((entry, index) => mapMostPlayed(entry, offset + index + 1))
      .filter((item): item is OsuAccountBeatmapItem => Boolean(item));
    return {
      profile,
      kind: 'most_played',
      items,
      total: profile.mostPlayedBeatmapCount,
    };
  }

  const items: OsuAccountBeatmapItem[] = [];
  for (let page = 0; page < maxFavouritePages; page += 1) {
    const offset = page * pageSize;
    const url = new URL(`${profileUrl}/beatmapsets/favourite`);
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));
    const response = await fetcher(url, {
      headers: osuHeaders(validCookie, 'application/json', profileUrl),
    });
    const payload = await requireJsonArray(response, 'osu! favourites request');
    items.push(
      ...payload
        .map((entry, index) => mapFavourite(entry, offset + index + 1))
        .filter((item): item is OsuAccountBeatmapItem => Boolean(item)),
    );
    if (payload.length < pageSize) {
      break;
    }
    if (page === maxFavouritePages - 1) {
      throw new Error('osu_favourites_limit_exceeded');
    }
  }

  const resolvedProfile = {
    ...profile,
    favouriteBeatmapsetCount: items.length,
  };
  return {
    profile: resolvedProfile,
    kind: 'favourites',
    items,
    total: items.length,
  };
};
