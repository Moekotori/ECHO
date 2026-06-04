import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { app, protocol } from 'electron';
import type { CoverVariant } from '../library/libraryTypes';
import { getAppSettings, getAppWallpaperDirectory, getLyricsWallpaperDirectory } from '../app/appSettings';
import { getLibraryService } from '../library/LibraryService';
import { defaultCoverSvg } from '../library/workers/TsCoverExtractor';
import { fetchWithNetworkProxy } from '../network/networkFetch';
import { getRemoteSourceService } from '../library/remote/RemoteSourceService';

const cacheControlHeader = 'public, max-age=31536000, immutable';
const wallpaperCacheControlHeader = 'no-store';
const remoteImageCacheControlHeader = 'public, max-age=86400';
const subsonicCoverCacheControlHeader = 'public, max-age=31536000, immutable';
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

const wallpaperResponse = (request: Request, wallpaperPath: string): Response => {
  const contentType = contentTypeForPath(wallpaperPath, null);
  if (!contentType.startsWith('video/')) {
    return new Response(readFileSync(wallpaperPath), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': wallpaperCacheControlHeader,
      },
    });
  }

  const fileStat = statSync(wallpaperPath);
  if (!fileStat.isFile()) {
    return missingCoverResponse();
  }

  const rangeHeader = request.headers.get('range');
  const range = parseRange(rangeHeader, fileStat.size);
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': wallpaperCacheControlHeader,
    'Content-Type': contentType,
  });

  if (rangeHeader && !range) {
    headers.set('Content-Length', '0');
    headers.set('Content-Range', `bytes */${fileStat.size}`);
    return new Response('', { status: 416, headers });
  }

  if (range) {
    headers.set('Content-Length', String(range.end - range.start + 1));
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${fileStat.size}`);
    return new Response(request.method === 'HEAD' ? null : streamBody(wallpaperPath, range), { status: 206, headers });
  }

  headers.set('Content-Length', String(fileStat.size));
  return new Response(request.method === 'HEAD' ? null : streamBody(wallpaperPath, null), { headers });
};

const cachedRemoteCoverExtensions = ['avif', 'webp', 'png', 'jpg', 'jpeg', 'gif'] as const;

const extensionForImageMimeType = (mimeType: string): string | null => {
  switch (mimeType) {
    case 'image/avif':
      return 'avif';
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    default:
      return null;
  }
};

const subsonicCoverCacheKey = (identity: string, size: number): string =>
  createHash('sha256').update('subsonic-cover').update('\0').update(identity).update('\0').update(String(size)).digest('hex');

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

const readSubsonicCoverCache = async (identity: string, size: number): Promise<Response | null> => {
  const cacheKey = subsonicCoverCacheKey(identity, size);
  const cacheDir = getRemoteCoverCacheDirectory();
  for (const extension of cachedRemoteCoverExtensions) {
    const filePath = join(cacheDir, `${cacheKey}.${extension}`);
    try {
      return new Response(await readFile(filePath), {
        headers: {
          'Content-Type': contentTypeForPath(filePath, null),
          'Cache-Control': subsonicCoverCacheControlHeader,
        },
      });
    } catch {
      // Try the next possible extension.
    }
  }

  return null;
};

const writeSubsonicCoverCache = async (
  identity: string,
  size: number,
  mimeType: string,
  data: Buffer,
): Promise<void> => {
  const extension = extensionForImageMimeType(mimeType);
  if (!extension) {
    return;
  }

  const cacheDir = getRemoteCoverCacheDirectory();
  const cacheKey = subsonicCoverCacheKey(identity, size);
  const targetPath = join(cacheDir, `${cacheKey}.${extension}`);
  const tempPath = join(cacheDir, `${cacheKey}.${randomUUID()}.tmp`);
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(tempPath, data);
    await rename(tempPath, targetPath);
  } catch {
    await unlink(tempPath).catch(() => undefined);
  }
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

const clampRemoteCoverSize = (value: string | null): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(80, Math.min(1024, Math.round(parsed))) : 512;
};

const subsonicCoverResponse = async (url: URL): Promise<Response> => {
  const trackId = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!trackId) {
    return missingCoverResponse();
  }

  const size = clampRemoteCoverSize(url.searchParams.get('size'));
  const cacheIdentity = url.searchParams.get('cacheKey') || trackId;
  const cached = await readSubsonicCoverCache(cacheIdentity, size);
  if (cached) {
    return cached;
  }

  const result = await getRemoteSourceService().readRemoteCover(trackId, size);
  const mimeType = result.mimeType?.split(';')[0]?.trim().toLocaleLowerCase();
  if (result.status !== 'ok' || !result.data?.byteLength || !mimeType?.startsWith('image/')) {
    return missingCoverResponse();
  }
  const data = Buffer.from(result.data);
  await writeSubsonicCoverCache(cacheIdentity, size, mimeType, data);

  return new Response(data, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': subsonicCoverCacheControlHeader,
    },
  });
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
    try {
      const url = new URL(request.url);
      const variant = url.hostname;
      const coverId = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

      if (!isCoverVariant(variant) || !coverId) {
        return defaultSvgResponse();
      }

      const asset = getLibraryService().resolveCoverAsset(coverId, variant);

      if (!asset || !existsSync(asset.filePath)) {
        return variant === 'large' || variant === 'original' ? missingCoverResponse() : defaultSvgResponse();
      }

      return new Response(readFileSync(asset.filePath), {
        headers: {
          'Content-Type': contentTypeForPath(asset.filePath, asset.mimeType),
          'Cache-Control': cacheControlHeader,
        },
      });
    } catch {
      return defaultSvgResponse();
    }
  });
  protocol.handle('echo-wallpaper', async (request) => {
    try {
      const url = new URL(request.url);

      if (url.pathname.replace(/^\/+/, '') !== 'custom') {
        return missingCoverResponse();
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

      if (!wallpaperPath || !wallpaperDirectory || !isPathInsideDirectory(wallpaperDirectory, wallpaperPath) || !existsSync(wallpaperPath)) {
        return missingCoverResponse();
      }

      return wallpaperResponse(request, wallpaperPath);
    } catch {
      return missingCoverResponse();
    }
  });
  protocol.handle('echo-artist-image', async (request) => {
    try {
      const url = new URL(request.url);
      const variant = url.hostname;
      const artistKey = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

      if (!isArtistImageVariant(variant) || !artistKey) {
        return missingCoverResponse();
      }

      const asset = getLibraryService().resolveArtistImageAsset(artistKey, variant);

      if (!asset || !existsSync(asset.filePath)) {
        return missingCoverResponse();
      }

      return new Response(readFileSync(asset.filePath), {
        headers: {
          'Content-Type': contentTypeForPath(asset.filePath, asset.mimeType),
          'Cache-Control': cacheControlHeader,
        },
      });
    } catch {
      return missingCoverResponse();
    }
  });
  protocol.handle('echo-image', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname === 'subsonic-cover') {
        return subsonicCoverResponse(url);
      }

      if (url.hostname !== 'remote') {
        return missingCoverResponse();
      }

      const targetUrl = new URL(decodeURIComponent(url.pathname.replace(/^\/+/, '')));
      if (targetUrl.protocol !== 'https:' || !allowedRemoteImageHosts.has(targetUrl.hostname)) {
        return missingCoverResponse();
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
        return missingCoverResponse();
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers: passthroughImageHeaders(upstream),
      });
    } catch {
      return missingCoverResponse();
    }
  });
};
