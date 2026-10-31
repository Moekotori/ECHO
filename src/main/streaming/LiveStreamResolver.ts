import type { StreamingLiveResolveResult } from '../../shared/types/streaming';
import { asRecord, integer, jsonFetch, streamingImageProxyUrl, text } from './providers/chinaStreamingUtils';

const bilibiliLiveReferer = 'https://live.bilibili.com/';
const bilibiliLiveUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const bilibiliLiveHeaders = (): Record<string, string> => ({
  Accept: 'application/json,text/plain,*/*',
  Referer: bilibiliLiveReferer,
  Origin: 'https://live.bilibili.com',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
  'User-Agent': bilibiliLiveUserAgent,
});

const playbackHeaders = (): Record<string, string> => ({
  Referer: bilibiliLiveReferer,
  'User-Agent': bilibiliLiveUserAgent,
});

const normalizeHttpUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

const inferMimeType = (url: string): string | null => {
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();

  if (pathname.endsWith('.m3u8')) {
    return 'application/vnd.apple.mpegurl';
  }
  if (pathname.endsWith('.flv')) {
    return 'video/x-flv';
  }
  if (pathname.endsWith('.mp4') || pathname.endsWith('.m4v')) {
    return 'video/mp4';
  }
  if (pathname.endsWith('.mp3')) {
    return 'audio/mpeg';
  }
  if (pathname.endsWith('.aac')) {
    return 'audio/aac';
  }
  if (pathname.endsWith('.ogg') || pathname.endsWith('.oga')) {
    return 'audio/ogg';
  }
  if (pathname.endsWith('.webm')) {
    return 'video/webm';
  }
  return null;
};

const directTitleFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '').replace(/\.[^.]+$/u, '');
    return name || parsed.hostname.replace(/^www\./iu, '') || 'Live Stream';
  } catch {
    return 'Live Stream';
  }
};

const roomIdFromBilibiliLiveUrl = (url: URL): string | null => {
  if (!/(^|\.)live\.bilibili\.com$/iu.test(url.hostname)) {
    return null;
  }

  return url.pathname.split('/').find((part) => /^\d+$/u.test(part)) ?? null;
};

const responseData = (value: unknown): Record<string, unknown> => asRecord(asRecord(value).data);

const arrayOfRecords = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];

const urlInfoParts = (value: Record<string, unknown>): { host: string; extra: string } | null => {
  const host = text(value.host);
  const extra = text(value.extra) ?? '';
  if (!host) {
    return null;
  }
  return { host, extra };
};

type BilibiliLiveCandidate = {
  url: string;
  mimeType: string | null;
  protocolName: string;
  formatName: string;
  qn: number;
};

const collectBilibiliLiveCandidates = (playInfo: unknown): BilibiliLiveCandidate[] => {
  const playurl = asRecord(asRecord(responseData(playInfo).playurl_info).playurl);
  const streams = arrayOfRecords(playurl.stream);
  const candidates: BilibiliLiveCandidate[] = [];

  for (const stream of streams) {
    const protocolName = text(stream.protocol_name) ?? '';
    for (const format of arrayOfRecords(stream.format)) {
      const formatName = text(format.format_name) ?? '';
      for (const codec of arrayOfRecords(format.codec)) {
        const baseUrl = text(codec.base_url);
        if (!baseUrl) {
          continue;
        }

        const qn = integer(codec.current_qn) ?? 0;
        for (const urlInfo of arrayOfRecords(codec.url_info)) {
          const parts = urlInfoParts(urlInfo);
          if (!parts) {
            continue;
          }

          const url = `${parts.host}${baseUrl}${parts.extra}`;
          candidates.push({
            url,
            mimeType: inferMimeType(url),
            protocolName,
            formatName,
            qn,
          });
        }
      }
    }
  }

  return candidates;
};

const candidateScore = (candidate: BilibiliLiveCandidate): number => {
  const isHls = candidate.protocolName === 'http_hls' || candidate.mimeType?.includes('mpegurl');
  const isFmp4 = candidate.formatName === 'fmp4';
  const isTs = candidate.formatName === 'ts';
  const isFlv = candidate.formatName === 'flv';
  return (isHls ? 10_000 : 0) + (isFmp4 ? 2_000 : isTs ? 1_000 : isFlv ? 100 : 0) + candidate.qn;
};

const bestBilibiliLiveCandidate = (playInfo: unknown): BilibiliLiveCandidate | null =>
  collectBilibiliLiveCandidates(playInfo).sort((left, right) => candidateScore(right) - candidateScore(left))[0] ?? null;

const resolveBilibiliLive = async (sourceUrl: string, parsedUrl: URL): Promise<StreamingLiveResolveResult> => {
  const inputRoomId = roomIdFromBilibiliLiveUrl(parsedUrl);
  if (!inputRoomId) {
    throw new Error('Bilibili live room id was not found.');
  }

  const init = await jsonFetch(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(inputRoomId)}`, {
    headers: bilibiliLiveHeaders(),
    timeoutMs: 10_000,
  });
  const initData = responseData(init);
  const roomId = String(integer(initData.room_id) ?? inputRoomId);
  const liveStatus = integer(initData.live_status);
  if (initData.is_hidden === true || initData.is_locked === true) {
    throw new Error('Bilibili live room is hidden or locked.');
  }
  if (liveStatus !== 1) {
    throw new Error('Bilibili live room is not live right now.');
  }

  const [info, playInfo] = await Promise.all([
    jsonFetch(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(roomId)}`, {
      headers: bilibiliLiveHeaders(),
      timeoutMs: 10_000,
    }),
    jsonFetch(`https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${encodeURIComponent(roomId)}&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=8`, {
      headers: bilibiliLiveHeaders(),
      timeoutMs: 10_000,
    }),
  ]);

  const infoData = responseData(info);
  const candidate = bestBilibiliLiveCandidate(playInfo);
  if (!candidate) {
    throw new Error('Bilibili live playback URL was not found.');
  }

  const cover = text(infoData.user_cover) ?? text(infoData.keyframe) ?? text(infoData.background);
  const pageUrl = `https://live.bilibili.com/${roomId}`;
  return {
    provider: 'bilibili',
    sourceUrl,
    pageUrl,
    playbackUrl: candidate.url,
    videoUrl: candidate.mimeType?.includes('mpegurl') ? candidate.url : null,
    title: text(infoData.title) ?? `Bilibili Live ${roomId}`,
    artist: 'Bilibili Live',
    coverUrl: streamingImageProxyUrl(cover, bilibiliLiveReferer),
    roomId,
    liveStatus: 'live',
    mimeType: candidate.mimeType,
    headers: playbackHeaders(),
  };
};

const resolveDirectLive = (sourceUrl: string): StreamingLiveResolveResult => ({
  provider: 'direct',
  sourceUrl,
  pageUrl: sourceUrl,
  playbackUrl: sourceUrl,
  videoUrl: inferMimeType(sourceUrl)?.startsWith('video/') || inferMimeType(sourceUrl)?.includes('mpegurl') ? sourceUrl : null,
  title: directTitleFromUrl(sourceUrl),
  artist: null,
  coverUrl: null,
  roomId: null,
  liveStatus: 'unknown',
  mimeType: inferMimeType(sourceUrl),
  headers: {},
});

export const resolveLiveStream = async (inputUrl: string): Promise<StreamingLiveResolveResult> => {
  const sourceUrl = normalizeHttpUrl(inputUrl);
  if (!sourceUrl) {
    throw new Error('Live URL must be a valid HTTP or HTTPS URL.');
  }

  const parsedUrl = new URL(sourceUrl);
  if (roomIdFromBilibiliLiveUrl(parsedUrl)) {
    return resolveBilibiliLive(sourceUrl, parsedUrl);
  }

  return resolveDirectLive(sourceUrl);
};
