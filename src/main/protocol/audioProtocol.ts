import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { extname } from 'node:path';
import { protocol } from 'electron';

type SystemAudioStreamSource = {
  url: string;
  headers?: Record<string, string>;
  mimeType?: string | null;
  expiresAt: number;
};

const streamTtlMs = 10 * 60 * 1000;
const systemAudioStreams = new Map<string, SystemAudioStreamSource>();

const audioMimeTypes = new Map<string, string>([
  ['.aac', 'audio/aac'],
  ['.aiff', 'audio/aiff'],
  ['.aif', 'audio/aiff'],
  ['.alac', 'audio/mp4'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.wav', 'audio/wav'],
  ['.webm', 'audio/webm'],
]);

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

const normalizeStreamUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^file:/iu.test(trimmed)) {
    return fileURLToPath(trimmed);
  }

  return trimmed;
};

const guessAudioMimeType = (url: string, fallback?: string | null): string => {
  if (fallback) {
    return fallback;
  }

  try {
    const parsed = new URL(url);
    return audioMimeTypes.get(extname(parsed.pathname).toLowerCase()) ?? 'application/octet-stream';
  } catch {
    return audioMimeTypes.get(extname(url).toLowerCase()) ?? 'application/octet-stream';
  }
};

const passthroughHeaders = (response: Response, fallbackMimeType: string): Headers => {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = response.headers.get(key);
    if (value) {
      headers.set(key, value);
    }
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', fallbackMimeType);
  }
  return headers;
};

const cleanupExpiredStreams = (): void => {
  const now = Date.now();
  for (const [token, source] of systemAudioStreams) {
    if (source.expiresAt <= now) {
      systemAudioStreams.delete(token);
    }
  }
};

export const createSystemAudioStreamUrl = (input: {
  url: string;
  headers?: Record<string, string>;
  mimeType?: string | null;
}): string => {
  cleanupExpiredStreams();
  const url = normalizeStreamUrl(input.url);
  if (!url) {
    throw new Error('system_audio_source_empty');
  }

  const token = randomUUID();
  systemAudioStreams.set(token, {
    url,
    headers: input.headers,
    mimeType: input.mimeType,
    expiresAt: Date.now() + streamTtlMs,
  });
  return `echo-audio://system/${encodeURIComponent(token)}`;
};

export const registerAudioProtocolHandler = (): void => {
  protocol.handle('echo-audio', async (request) => {
    try {
      const url = new URL(request.url);
      const token = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (url.hostname !== 'system' || !token || token.includes('/') || token.includes('\\')) {
        return new Response('', { status: 404 });
      }

      const source = systemAudioStreams.get(token);
      if (!source || source.expiresAt <= Date.now()) {
        systemAudioStreams.delete(token);
        return new Response('', { status: 404 });
      }
      source.expiresAt = Date.now() + streamTtlMs;

      if (/^https?:\/\//iu.test(source.url)) {
        const headers = new Headers(source.headers);
        const range = request.headers.get('range');
        if (range) {
          headers.set('Range', range);
        }
        const upstream = await fetch(source.url, { headers, redirect: 'follow' });
        if (upstream.status === 416) {
          return new Response('', {
            status: 416,
            headers: passthroughHeaders(upstream, guessAudioMimeType(source.url, source.mimeType)),
          });
        }
        if (!upstream.ok && upstream.status !== 206) {
          return new Response('', { status: 502 });
        }
        return new Response(upstream.body, {
          status: upstream.status,
          headers: passthroughHeaders(upstream, guessAudioMimeType(source.url, source.mimeType)),
        });
      }

      if (!existsSync(source.url)) {
        return new Response('', { status: 404 });
      }
      const fileStat = statSync(source.url);
      if (!fileStat.isFile()) {
        return new Response('', { status: 404 });
      }

      const rangeHeader = request.headers.get('range');
      const range = parseRange(rangeHeader, fileStat.size);
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Type': guessAudioMimeType(source.url, source.mimeType),
      });
      if (rangeHeader && !range) {
        headers.set('Content-Length', '0');
        headers.set('Content-Range', `bytes */${fileStat.size}`);
        return new Response('', { status: 416, headers });
      }
      if (range) {
        headers.set('Content-Length', String(range.end - range.start + 1));
        headers.set('Content-Range', `bytes ${range.start}-${range.end}/${fileStat.size}`);
        return new Response(streamBody(source.url, range), { status: 206, headers });
      }

      headers.set('Content-Length', String(fileStat.size));
      return new Response(streamBody(source.url, null), { headers });
    } catch {
      return new Response('', { status: 404 });
    }
  });
};
