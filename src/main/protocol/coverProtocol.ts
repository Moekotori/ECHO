import { createReadStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { readdir, stat, unlink } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { app, protocol } from 'electron';
import type { CoverVariant } from '../library/libraryTypes';
import { getAppSettings, getAppWallpaperDirectory, getLyricsWallpaperDirectory } from '../app/appSettings';
import { getLibraryService } from '../library/LibraryService';
import { defaultCoverSvg } from '../library/workers/TsCoverExtractor';
import { fetchWithNetworkProxy } from '../network/networkFetch';
import { getRemoteSourceService } from '../library/remote/RemoteSourceService';
import { beginCoverProtocolDiagnostic } from '../diagnostics/CoverProtocolDiagnostics';
import type { DiagnosticCoverProtocolOutcome, DiagnosticCoverProtocolScheme } from '../../shared/types/diagnostics';
import { readSubsonicCoverDiskCache, subsonicCoverDiskCacheKey, writeSubsonicCoverDiskCache } from '../library/remote/SubsonicCoverDiskCache';

const cacheControlHeader = 'public, max-age=31536000, immutable';
const wallpaperCacheControlHeader = 'no-store';
const remoteImageCacheControlHeader = 'public, max-age=86400';
const subsonicCoverCacheControlHeader = 'private, max-age=86400';
const subsonicCoverNegativeTtlMs = 2 * 60 * 1000;
const subsonicCoverNegativeCacheMaxEntries = 4096;
const subsonicCoverCacheMaxBytes = 512 * 1024 * 1024;
const subsonicCoverCacheMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
const subsonicCoverCachePruneIntervalMs = 10 * 60 * 1000;
const remoteImageMaxBytes = 16 * 1024 * 1024;
const allowedRemoteImageHosts = new Set([
  'i0.hdslb.com',
  'i1.hdslb.com',
  'i2.hdslb.com',
  'i0.sndcdn.com',
  'i1.sndcdn.com',
  'i2.sndcdn.com',
  'i3.sndcdn.com',
  'i.ytimg.com',
  'img.youtube.com',
  'archive.biliimg.com',
  'p.music.126.net',
  'p1.music.126.net',
  'p2.music.126.net',
  'p3.music.126.net',
  'p4.music.126.net',
  'y.gtimg.cn',
  'qpic.y.qq.com',
  'assets.ppy.sh',
]);

const isCoverVariant = (value: string): value is CoverVariant =>
  value === 'thumb' || value === 'album' || value === 'large' || value === 'original';

const isArtistImageVariant = (value: string): value is 'thumb' | 'medium' | 'large' =>
  value === 'thumb' || value === 'medium' || value === 'large';

const contentTypeForPath = (filePath: string, fallback: string | null): string => {
  switch (extname(filePath).toLocaleLowerCase()) {
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    default:
      return fallback ?? 'application/octet-stream';
  }
};

const parseRange = (rangeHeader: string | null, size: number): { start: number; end: number } | null => {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) {
    return null;
  }

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0 || size <= 0) {
      return null;
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return { start, end: Math.min(end, size - 1) };
};

const streamBody = (filePath: string, range: { start: number; end: number } | null): BodyInit =>
  Readable.toWeb(createReadStream(filePath, range ?? undefined)) as unknown as BodyInit;

const wallpaperResponse = (request: Request, wallpaperPath: string, size: number): Response => {
  const contentType = contentTypeForPath(wallpaperPath, null);
  if (!contentType.startsWith('video/')) {
    return new Response(request.method === 'HEAD' ? null : streamBody(wallpaperPath, null), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': wallpaperCacheControlHeader,
        'Content-Length': String(size),
      },
    });
  }

  const rangeHeader = request.headers.get('range');
  const range = parseRange(rangeHeader, size);
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': wallpaperCacheControlHeader,
    'Content-Type': contentType,
  });

  if (rangeHeader && !range) {
    headers.set('Content-Length', '0');
    headers.set('Content-Range', `bytes */${size}`);
    return new Response('', { status: 416, headers });
  }

  if (range) {
    headers.set('Content-Length', String(range.end - range.start + 1));
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    return new Response(request.method === 'HEAD' ? null : streamBody(wallpaperPath, range), { status: 206, headers });
  }

  headers.set('Content-Length', String(size));
  return new Response(request.method === 'HEAD' ? null : streamBody(wallpaperPath, null), { headers });
};

type SubsonicCoverData = {
  data: Buffer;
  mimeType: string;
  source: 'subsonic-cache' | 'subsonic-remote';
};

const subsonicCoverInFlight = new Map<string, Promise<SubsonicCoverData | null>>();
const subsonicCoverNegativeCache = new Map<string, number>();
let lastSubsonicCoverCachePruneAt = 0;

const rememberSubsonicCoverMiss = (requestKey: string): void => {
  const now = Date.now();
  if (subsonicCoverNegativeCache.size >= subsonicCoverNegativeCacheMaxEntries) {
    for (const [key, expiresAt] of subsonicCoverNegativeCache) {
      if (expiresAt <= now) {
        subsonicCoverNegativeCache.delete(key);
      }
    }
  }
  while (subsonicCoverNegativeCache.size >= subsonicCoverNegativeCacheMaxEntries) {
    const oldest = subsonicCoverNegativeCache.keys().next().value;
    if (typeof oldest !== 'string') {
      break;
    }
    subsonicCoverNegativeCache.delete(oldest);
  }
  subsonicCoverNegativeCache.set(requestKey, now + subsonicCoverNegativeTtlMs);
};

const getRemoteCoverCacheDirectory = (): string => {
  try {
    const service = getLibraryService() as { getCoverCacheDir?: () => string };
    const coverCacheDir = service.getCoverCacheDir?.();
    if (coverCacheDir) {
      return join(coverCacheDir, 'remote-direct', 'subsonic');
    }
  } catch {
    // Fall through to userData for early-start protocol tests or service unavailability.
  }

  return join(app.getPath('userData'), 'remote-cover-cache', 'subsonic');
};

type ProtocolResponseResult = {
  response: Response;
  source: string;
  outcome: DiagnosticCoverProtocolOutcome;
  knownBytes?: number;
};

const parseContentLength = (value: string | null): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
};

const defaultSvgBytes = (): number => Buffer.byteLength(defaultCoverSvg);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const safeProtocolUrl = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};

const safeDecodedProtocolPath = (url: URL): string => {
  const path = url.pathname.replace(/^\/+/, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const remoteImageTargetHost = (url: URL | null): string | undefined => {
  if (!url || url.hostname !== 'remote') {
    return undefined;
  }

  try {
    return new URL(safeDecodedProtocolPath(url)).hostname;
  } catch {
    return undefined;
  }
};

const beginProtocolRequestDiagnostic = (
  scheme: DiagnosticCoverProtocolScheme,
  request: Request,
): ReturnType<typeof beginCoverProtocolDiagnostic> => {
  const url = safeProtocolUrl(request.url);
  const routeKind = url?.hostname || 'invalid-url';
  return beginCoverProtocolDiagnostic({
    scheme,
    routeKind,
    variant: scheme === 'echo-cover' || scheme === 'echo-artist-image' ? routeKind : undefined,
    method: request.method,
    url: request.url,
    resourceIdentity: url ? safeDecodedProtocolPath(url) : null,
    targetHost: scheme === 'echo-image' ? remoteImageTargetHost(url) : undefined,
  });
};

const finishProtocolDiagnostic = (
  diagnostic: ReturnType<typeof beginCoverProtocolDiagnostic>,
  response: Response,
  options: {
    outcome: DiagnosticCoverProtocolOutcome;
    source: string;
    knownBytes?: number;
    error?: string;
  },
): Response => {
  diagnostic.finish({
    outcome: options.outcome,
    statusCode: response.status,
    source: options.source,
    knownBytes: options.knownBytes ?? parseContentLength(response.headers.get('Content-Length')),
    contentType: response.headers.get('Content-Type'),
    cacheControl: response.headers.get('Cache-Control'),
    error: options.error,
  });
  return response;
};

const missingProtocolResponse = (
  source: string,
  outcome: DiagnosticCoverProtocolOutcome = 'missing',
): ProtocolResponseResult => ({
  response: missingCoverResponse(),
  source,
  outcome,
  knownBytes: 0,
});

const readSubsonicCoverCache = async (identity: string, size: number): Promise<SubsonicCoverData | null> => {
  const cacheDir = getRemoteCoverCacheDirectory();
  const cached = await readSubsonicCoverDiskCache(cacheDir, identity, size);
  return cached ? { ...cached, source: 'subsonic-cache' } : null;
};

const pruneSubsonicCoverCache = async (): Promise<void> => {
  const now = Date.now();
  if (now - lastSubsonicCoverCachePruneAt < subsonicCoverCachePruneIntervalMs) {
    return;
  }
  lastSubsonicCoverCachePruneAt = now;

  const cacheDir = getRemoteCoverCacheDirectory();
  const names = await readdir(cacheDir).catch(() => [] as string[]);
  const entries = (await Promise.all(names.map(async (name) => {
    const filePath = join(cacheDir, name);
    const fileStat = await stat(filePath).catch(() => null);
    return fileStat?.isFile() ? { filePath, size: fileStat.size, mtimeMs: fileStat.mtimeMs } : null;
  }))).filter((entry): entry is { filePath: string; size: number; mtimeMs: number } => Boolean(entry));

  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of entries.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    const expired = now - entry.mtimeMs > subsonicCoverCacheMaxAgeMs;
    if (!expired && totalBytes <= subsonicCoverCacheMaxBytes) {
      break;
    }
    await unlink(entry.filePath).catch(() => undefined);
    totalBytes -= entry.size;
  }
};

const localFileResponse = async (filePath: string, mimeType: string | null, cacheControl: string): Promise<{ response: Response; knownBytes: number }> => {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error('Cover asset must be a regular file');
  }

  return {
    response: new Response(streamBody(filePath, null), {
      headers: {
        'Content-Type': contentTypeForPath(filePath, mimeType),
        'Cache-Control': cacheControl,
      },
    }),
    knownBytes: fileStat.size,
  };
};

const wallpaperProtocolResponse = async (
  request: Request,
  wallpaperPath: string,
): Promise<{ response: Response; knownBytes: number } | null> => {
  try {
    const fileStat = await stat(wallpaperPath);
    if (!fileStat.isFile()) {
      return null;
    }

    return {
      response: wallpaperResponse(request, wallpaperPath, fileStat.size),
      knownBytes: fileStat.size,
    };
  } catch {
    return null;
  }
};

const defaultProtocolSvgResponse = (): { response: Response; knownBytes: number } => ({
  response: defaultSvgResponse(),
  knownBytes: defaultSvgBytes(),
});

const writeSubsonicCoverCache = async (
  identity: string,
  size: number,
  mimeType: string,
  data: Buffer,
): Promise<void> => {
  const cacheDir = getRemoteCoverCacheDirectory();
  if (await writeSubsonicCoverDiskCache(cacheDir, identity, size, mimeType, data)) {
    void pruneSubsonicCoverCache().catch(() => undefined);
  }
};

const loadSubsonicCover = async (
  trackId: string,
  sourceId: string | null,
  coverArt: string | null,
  identity: string,
  size: number,
): Promise<SubsonicCoverData | null> => {
  const requestKey = subsonicCoverDiskCacheKey(identity, size);
  const negativeUntil = subsonicCoverNegativeCache.get(requestKey) ?? 0;
  if (negativeUntil > Date.now()) {
    return null;
  }
  subsonicCoverNegativeCache.delete(requestKey);

  const existing = subsonicCoverInFlight.get(requestKey);
  if (existing) {
    return existing;
  }

  const task = (async (): Promise<SubsonicCoverData | null> => {
    const cached = await readSubsonicCoverCache(identity, size);
    if (cached) {
      return cached;
    }

    const result = sourceId && coverArt
      ? await getRemoteSourceService().readSubsonicCoverByIdentity(sourceId, coverArt, size)
      : await getRemoteSourceService().readRemoteCover(trackId, size);
    const mimeType = result.mimeType?.split(';')[0]?.trim().toLocaleLowerCase();
    if (result.status !== 'ok' || !result.data?.byteLength || !mimeType?.startsWith('image/')) {
      rememberSubsonicCoverMiss(requestKey);
      return null;
    }
    if (result.data.byteLength > remoteImageMaxBytes) {
      rememberSubsonicCoverMiss(requestKey);
      return null;
    }

    const data = Buffer.from(result.data);
    await writeSubsonicCoverCache(identity, size, mimeType, data);
    return { data, mimeType, source: 'subsonic-remote' };
  })().finally(() => {
    subsonicCoverInFlight.delete(requestKey);
  });
  subsonicCoverInFlight.set(requestKey, task);
  return task;
};

const isPathInsideDirectory = (directory: string, filePath: string): boolean => {
  const relativePath = relative(resolve(directory), resolve(filePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

const defaultSvgResponse = (): Response =>
  new Response(defaultCoverSvg, {
    headers: {
      'Content-Type': 'image/svg+xml',
    },
  });

const missingCoverResponse = (): Response => new Response('', { status: 404 });

const passthroughImageHeaders = (response: Response): Headers => {
  const headers = new Headers({
    'Cache-Control': remoteImageCacheControlHeader,
  });
  const contentType = response.headers.get('content-type');
  if (contentType?.startsWith('image/')) {
    headers.set('Content-Type', contentType);
  }

  return headers;
};

const limitRemoteImageBody = (
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> => {
  const reader = body.getReader();
  let receivedBytes = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          return;
        }

        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > maxBytes) {
          await reader.cancel('remote image exceeds memory-safe limit').catch(() => undefined);
          controller.error(new Error('Remote image exceeds memory-safe limit'));
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
};

const clampRemoteCoverSize = (value: string | null): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(80, Math.min(1024, Math.round(parsed))) : 512;
};

const subsonicCoverResponse = async (url: URL): Promise<ProtocolResponseResult> => {
  const trackId = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!trackId) {
    return missingProtocolResponse('subsonic-invalid', 'invalid');
  }

  const size = clampRemoteCoverSize(url.searchParams.get('size'));
  const cacheIdentity = url.searchParams.get('cacheKey') || trackId;
  const sourceId = url.searchParams.get('sourceId');
  const coverArt = url.searchParams.get('coverArt');
  const cover = await loadSubsonicCover(trackId, sourceId, coverArt, cacheIdentity, size);
  if (!cover) {
    return missingProtocolResponse('subsonic-remote', 'missing');
  }

  return {
    response: new Response(new Uint8Array(cover.data), {
      headers: {
        'Content-Type': cover.mimeType,
        'Cache-Control': subsonicCoverCacheControlHeader,
      },
    }),
    source: cover.source,
    outcome: 'ok',
    knownBytes: cover.data.byteLength,
  };
};

const remoteImageProtocolResponse = async (url: URL): Promise<ProtocolResponseResult> => {
  if (url.hostname !== 'remote') {
    return missingProtocolResponse('echo-image-invalid', 'invalid');
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(safeDecodedProtocolPath(url));
  } catch {
    return missingProtocolResponse('remote-image-invalid', 'invalid');
  }
  if (targetUrl.protocol !== 'https:' || !allowedRemoteImageHosts.has(targetUrl.hostname)) {
    return missingProtocolResponse('remote-image-blocked', 'blocked');
  }

  const upstream = await fetchWithNetworkProxy(targetUrl.toString(), {
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      referer: url.searchParams.get('referer') ?? 'https://www.bilibili.com/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
  });
  if (!upstream.ok) {
    return missingProtocolResponse('remote-image-fetch', 'missing');
  }

  const upstreamKnownBytes = parseContentLength(upstream.headers.get('content-length'));
  if (upstreamKnownBytes !== undefined && upstreamKnownBytes > remoteImageMaxBytes) {
    void upstream.body?.cancel('remote image exceeds memory-safe limit').catch(() => undefined);
    return {
      response: new Response('', { status: 413 }),
      source: 'remote-image-too-large',
      outcome: 'blocked',
      knownBytes: 0,
    };
  }

  const body = upstream.body
    ? limitRemoteImageBody(upstream.body, remoteImageMaxBytes)
    : null;

  return {
    response: new Response(body, {
      status: upstream.status,
      headers: passthroughImageHeaders(upstream),
    }),
    source: 'remote-image-fetch',
    outcome: 'ok',
    knownBytes: upstreamKnownBytes,
  };
};

export const registerCoverProtocolScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'echo-cover',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
    {
      scheme: 'echo-audio',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
    {
      scheme: 'echo-video',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
    {
      scheme: 'echo-mv',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
    {
      scheme: 'echo-wallpaper',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
    {
      scheme: 'echo-image',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
    {
      scheme: 'echo-artist-image',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
};

export const registerCoverProtocolHandler = (): void => {
  protocol.handle('echo-cover', async (request) => {
    const diagnostic = beginProtocolRequestDiagnostic('echo-cover', request);
    try {
      const url = new URL(request.url);
      const variant = url.hostname;
      const coverId = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

      if (!isCoverVariant(variant) || !coverId) {
        const result = defaultProtocolSvgResponse();
        return finishProtocolDiagnostic(diagnostic, result.response, {
          outcome: 'invalid',
          source: 'default-svg',
          knownBytes: result.knownBytes,
        });
      }

      // Renderer-facing cover URLs must never decode the untrusted raw original.
      // Copy/save/export paths resolve the original directly through LibraryService.
      const displayVariant = variant === 'original' ? 'large' : variant;
      const asset = getLibraryService().resolveCoverAsset(coverId, displayVariant);

      if (!asset || !existsSync(asset.filePath)) {
        if (variant === 'large' || variant === 'original') {
          return finishProtocolDiagnostic(diagnostic, missingCoverResponse(), {
            outcome: 'missing',
            source: 'local-cover-cache',
            knownBytes: 0,
          });
        }

        const result = defaultProtocolSvgResponse();
        return finishProtocolDiagnostic(diagnostic, result.response, {
          outcome: 'default',
          source: 'default-svg',
          knownBytes: result.knownBytes,
        });
      }

      const result = await localFileResponse(asset.filePath, asset.mimeType, cacheControlHeader);
      return finishProtocolDiagnostic(diagnostic, result.response, {
        outcome: 'ok',
        source: 'local-cover-cache',
        knownBytes: result.knownBytes,
      });
    } catch (error) {
      const result = defaultProtocolSvgResponse();
      return finishProtocolDiagnostic(diagnostic, result.response, {
        outcome: 'error',
        source: 'default-svg',
        knownBytes: result.knownBytes,
        error: errorMessage(error),
      });
    }
  });
  protocol.handle('echo-wallpaper', async (request) => {
    const diagnostic = beginProtocolRequestDiagnostic('echo-wallpaper', request);
    try {
      const url = new URL(request.url);

      if (url.pathname.replace(/^\/+/, '') !== 'custom') {
        return finishProtocolDiagnostic(diagnostic, missingCoverResponse(), {
          outcome: 'invalid',
          source: 'custom-wallpaper',
          knownBytes: 0,
        });
      }

      const settings = getAppSettings();
      const wallpaperPath = url.hostname === 'lyrics'
        ? settings.lyricsCustomWallpaperPath
        : url.hostname === 'app'
          ? settings.appCustomWallpaperPath
          : url.hostname === 'app-portrait'
            ? settings.appPortraitWallpaperPath ?? null
          : null;
      const wallpaperDirectory = url.hostname === 'lyrics'
        ? getLyricsWallpaperDirectory()
        : url.hostname === 'app' || url.hostname === 'app-portrait'
          ? getAppWallpaperDirectory()
          : null;

      if (!wallpaperPath || !wallpaperDirectory || !isPathInsideDirectory(wallpaperDirectory, wallpaperPath)) {
        return finishProtocolDiagnostic(diagnostic, missingCoverResponse(), {
          outcome: 'missing',
          source: 'custom-wallpaper',
          knownBytes: 0,
        });
      }

      const result = await wallpaperProtocolResponse(request, wallpaperPath);
      if (!result) {
        return finishProtocolDiagnostic(diagnostic, missingCoverResponse(), {
          outcome: 'missing',
          source: 'custom-wallpaper',
          knownBytes: 0,
        });
      }
      return finishProtocolDiagnostic(diagnostic, result.response, {
        outcome: 'ok',
        source: 'custom-wallpaper',
        knownBytes: result.knownBytes,
      });
    } catch (error) {
      return finishProtocolDiagnostic(diagnostic, missingCoverResponse(), {
        outcome: 'error',
        source: 'custom-wallpaper',
        knownBytes: 0,
        error: errorMessage(error),
      });
    }
  });
  protocol.handle('echo-artist-image', async (request) => {
    const diagnostic = beginProtocolRequestDiagnostic('echo-artist-image', request);
    try {
      const url = new URL(request.url);
      const variant = url.hostname;
      const artistKey = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

      if (!isArtistImageVariant(variant) || !artistKey) {
        return finishProtocolDiagnostic(diagnostic, missingCoverResponse(), {
          outcome: 'invalid',
          source: 'artist-image-cache',
          knownBytes: 0,
        });
      }

      const asset = getLibraryService().resolveArtistImageAsset(artistKey, variant);

      if (!asset || !existsSync(asset.filePath)) {
        return finishProtocolDiagnostic(diagnostic, missingCoverResponse(), {
          outcome: 'missing',
          source: 'artist-image-cache',
          knownBytes: 0,
        });
      }

      const result = await localFileResponse(asset.filePath, asset.mimeType, cacheControlHeader);
      return finishProtocolDiagnostic(diagnostic, result.response, {
        outcome: 'ok',
        source: 'artist-image-cache',
        knownBytes: result.knownBytes,
      });
    } catch (error) {
      return finishProtocolDiagnostic(diagnostic, missingCoverResponse(), {
        outcome: 'error',
        source: 'artist-image-cache',
        knownBytes: 0,
        error: errorMessage(error),
      });
    }
  });
  protocol.handle('echo-image', async (request) => {
    const diagnostic = beginProtocolRequestDiagnostic('echo-image', request);
    try {
      const url = new URL(request.url);
      if (url.hostname === 'subsonic-cover') {
        const result = await subsonicCoverResponse(url);
        return finishProtocolDiagnostic(diagnostic, result.response, {
          outcome: result.outcome,
          source: result.source,
          knownBytes: result.knownBytes,
        });
      }

      const result = await remoteImageProtocolResponse(url);
      return finishProtocolDiagnostic(diagnostic, result.response, {
        outcome: result.outcome,
        source: result.source,
        knownBytes: result.knownBytes,
      });
    } catch (error) {
      return finishProtocolDiagnostic(diagnostic, missingCoverResponse(), {
        outcome: 'error',
        source: 'echo-image',
        knownBytes: 0,
        error: errorMessage(error),
      });
    }
  });
};
