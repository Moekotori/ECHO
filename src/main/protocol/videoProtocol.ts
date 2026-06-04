import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { getMvService } from '../mv/MvService';

const parseRange = (rangeHeader: string | null, size: number): { start: number; end: number } | null => {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const startText = match[1];
  const endText = match[2];
  const start = startText ? Number(startText) : 0;
  const end = endText ? Number(endText) : size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
};

const streamBody = (filePath: string, range: { start: number; end: number } | null): BodyInit =>
  Readable.toWeb(createReadStream(filePath, range ?? undefined)) as unknown as BodyInit;

const passthroughHeaders = (response: Response, fallbackMimeType: string | null): Headers => {
  const headers = new Headers({
    'Cache-Control': 'no-store',
  });
  const upstreamContentType = response.headers.get('content-type');
  const contentType =
    !upstreamContentType || upstreamContentType.toLowerCase().startsWith('application/octet-stream')
      ? fallbackMimeType ?? upstreamContentType
      : upstreamContentType;
  const contentLength = response.headers.get('content-length');
  const contentRange = response.headers.get('content-range');
  const acceptRanges = response.headers.get('accept-ranges');

  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  if (contentLength) {
    headers.set('Content-Length', contentLength);
  }
  if (contentRange) {
    headers.set('Content-Range', contentRange);
  }
  if (acceptRanges) {
    headers.set('Accept-Ranges', acceptRanges);
  }

  return headers;
};

const fetchUpstreamVariant = async (
  variant: { url: string; headers: Record<string, string>; mimeType: string | null },
  request: Request,
): Promise<Response | null> => {
  const headers = new Headers(variant.headers);
  const range = request.headers.get('range');
  if (range) {
    headers.set('Range', range);
  }

  let upstream: Response;
  try {
    upstream = await fetch(variant.url, {
      headers,
      redirect: 'follow',
    });
  } catch {
    return null;
  }

  if (upstream.status === 416) {
    return new Response('', {
      status: 416,
      headers: passthroughHeaders(upstream, variant.mimeType),
    });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return null;
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: passthroughHeaders(upstream, variant.mimeType),
  });
};

export const registerVideoProtocolHandler = (): void => {
  protocol.handle('echo-video', async (request) => {
    try {
      const url = new URL(request.url);
      const videoId = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

      if (url.hostname !== 'mv' || !videoId || videoId.includes('/') || videoId.includes('\\')) {
        return new Response('', { status: 404 });
      }

      const video = getMvService().getVideoFileForProtocol(videoId);
      if (!video?.filePath || !video.playableInApp || !existsSync(video.filePath)) {
        return new Response('', { status: 404 });
      }

      const fileStat = statSync(video.filePath);
      if (!fileStat.isFile()) {
        return new Response('', { status: 404 });
      }

      const range = parseRange(request.headers.get('range'), fileStat.size);
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Content-Type': video.mimeType ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });

      if (range) {
        headers.set('Content-Length', String(range.end - range.start + 1));
        headers.set('Content-Range', `bytes ${range.start}-${range.end}/${fileStat.size}`);
        return new Response(streamBody(video.filePath, range), { status: 206, headers });
      }

      headers.set('Content-Length', String(fileStat.size));
      return new Response(streamBody(video.filePath, null), { headers });
    } catch {
      return new Response('', { status: 404 });
    }
  });

  protocol.handle('echo-mv', async (request) => {
    try {
      const url = new URL(request.url);
      const [videoIdPart, variantIdPart, extraPart] = url.pathname.replace(/^\/+/, '').split('/');
      const videoId = decodeURIComponent(videoIdPart ?? '');
      const variantId = decodeURIComponent(variantIdPart ?? '');

      if (url.hostname === 'ephemeral') {
        const token = videoId;
        if (!token || variantIdPart || token.includes('/') || token.includes('\\')) {
          return new Response('', { status: 404 });
        }

        const variant = getMvService().getTemporaryStreamVariantForProtocol(token);
        if (!variant) {
          return new Response('', { status: 404 });
        }

        return (await fetchUpstreamVariant(variant, request)) ?? new Response('', { status: 502 });
      }

      if (
        url.hostname !== 'stream' ||
        !videoId ||
        !variantId ||
        extraPart ||
        videoId.includes('/') ||
        videoId.includes('\\') ||
        variantId.includes('/') ||
        variantId.includes('\\')
      ) {
        return new Response('', { status: 404 });
      }

      const mvService = getMvService();
      const variant = await mvService.getStreamVariantForProtocol(videoId, variantId);
      if (!variant) {
        return new Response('', { status: 404 });
      }

      const response = await fetchUpstreamVariant(variant, request);
      if (response) {
        return response;
      }

      const refreshedVariant = await mvService.refreshStreamVariantForProtocol(videoId, variantId);
      if (!refreshedVariant) {
        return new Response('', { status: 502 });
      }

      return (await fetchUpstreamVariant(refreshedVariant, request)) ?? new Response('', { status: 502 });
    } catch {
      return new Response('', { status: 404 });
    }
  });
};
