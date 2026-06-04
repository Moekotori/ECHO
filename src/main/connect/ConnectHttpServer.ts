import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { basename, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import type { ConnectHttpDebugEvent } from '../../shared/types/connect';
import { resolveFfmpegToolchain } from '../audio/FfmpegToolchain';
import { defaultCoverSvg } from '../library/workers/TsCoverExtractor';

type DirectAudioToken = {
  kind: 'audio';
  filePath: string;
  mimeType: string;
  expiresAtMs: number;
};

type RemoteAudioToken = {
  kind: 'remote-audio';
  remoteUrl: string;
  mimeType: string;
  expiresAtMs: number;
};

type TranscodeToken = {
  kind: 'transcode';
  filePath: string;
  expiresAtMs: number;
};

type CoverToken = {
  kind: 'cover';
  filePath: string | null;
  remoteUrl: string | null;
  mimeType: string;
  sourceMimeType: string | null;
  transcodeToJpeg: boolean;
  cachedBody?: Buffer;
  expiresAtMs: number;
};

type TokenRecord = DirectAudioToken | RemoteAudioToken | TranscodeToken | CoverToken;

type TokenUrlOptions = {
  host: string;
  ttlMs?: number;
  forceJpegCover?: boolean;
  mimeType?: string | null;
  audioMimeType?: string | null;
};

const defaultTokenTtlMs = 8 * 60 * 60 * 1000;

const safeHeader = (value: string | string[] | undefined): string | undefined => (typeof value === 'string' ? value : undefined);

const extensionSource = (filePath: string): string => {
  try {
    return new URL(filePath).pathname;
  } catch {
    return filePath;
  }
};

const extensionForMimeType = (mimeType: string): string => {
  switch (mimeType.toLowerCase()) {
    case 'audio/mpeg':
      return '.mp3';
    case 'audio/flac':
    case 'audio/x-flac':
    case 'application/flac':
      return '.flac';
    case 'audio/wav':
    case 'audio/x-wav':
      return '.wav';
    case 'audio/aac':
      return '.aac';
    case 'audio/mp4':
      return '.m4a';
    case 'audio/aiff':
    case 'audio/x-aiff':
      return '.aiff';
    case 'audio/ogg':
      return '.ogg';
    default:
      return '.bin';
  }
};

const safeUrlSegment = (value: string): string => {
  const cleaned = value
    .replace(/[\\/:*?"<>|#%]+/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim();
  return encodeURIComponent(cleaned || 'stream');
};

const dlnaFriendlyAudioName = (source: string, mimeType: string): string => {
  const pathname = extensionSource(source);
  let name = basename(pathname);
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the raw basename if it was not valid percent-encoding.
  }
  const extension = extname(name) || extensionForMimeType(mimeType);
  const stem = name.slice(0, name.length - extname(name).length).trim() || 'stream';
  return `${safeUrlSegment(stem)}${extension}`;
};

const dlnaContentFeaturesForMime = (mimeType: string): string => {
  switch (mimeType.toLowerCase()) {
    case 'audio/mpeg':
      return 'DLNA.ORG_PN=MP3;DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'DLNA.ORG_PN=WAV;DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    default:
      return 'DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000';
  }
};

const jpegCoverContentFeatures = 'DLNA.ORG_PN=JPEG_TN;DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=00D00000000000000000000000000000';

export const mimeTypeForAudioPath = (filePath: string): string => {
  switch (extname(extensionSource(filePath)).toLowerCase()) {
    case '.mp3':
    case '.mp2':
    case '.mp1':
      return 'audio/mpeg';
    case '.flac':
      return 'audio/flac';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
    case '.mp4':
    case '.alac':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.ogg':
    case '.opus':
      return 'audio/ogg';
    case '.aif':
    case '.aiff':
      return 'audio/aiff';
    default:
      return 'application/octet-stream';
  }
};

const mimeTypeForImagePath = (filePath: string): string => {
  switch (extname(filePath).toLowerCase()) {
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
};

const isPrivateIPv4 = (address: string): boolean =>
  /^10\./u.test(address) ||
  /^192\.168\./u.test(address) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./u.test(address) ||
  /^169\.254\./u.test(address);

const subnetScore = (candidate: string, target: string): number => {
  const candidateParts = candidate.split('.');
  const targetParts = target.split('.');
  if (candidateParts.length !== 4 || targetParts.length !== 4) {
    return 0;
  }

  let score = 0;
  for (let index = 0; index < 4; index += 1) {
    if (candidateParts[index] !== targetParts[index]) {
      break;
    }
    score += 1;
  }
  return score;
};

const endResponseSafely = (response: ServerResponse, statusCode: number, message = ''): void => {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  if (!response.headersSent) {
    response.writeHead(statusCode, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    });
  }

  response.end(message);
};

const pipeFileReadStream = (
  response: ServerResponse,
  filePath: string,
  options: { start?: number; end?: number } = {},
): void => {
  const stream = createReadStream(filePath, options);
  stream.once('error', (error) => {
    endResponseSafely(response, 500, error instanceof Error ? error.message : String(error));
  });
  stream.pipe(response);
};

export const chooseLocalAddressForRemote = (remoteAddress: string | null | undefined): string => {
  const candidates = Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === 'IPv4' && !item.internal)
    .map((item) => item.address);

  if (candidates.length === 0) {
    return '127.0.0.1';
  }

  if (!remoteAddress) {
    return candidates.find(isPrivateIPv4) ?? candidates[0];
  }

  return [...candidates].sort((left, right) => subnetScore(right, remoteAddress) - subnetScore(left, remoteAddress))[0] ?? candidates[0];
};

export class ConnectHttpServer {
  private server: Server | null = null;
  private port: number | null = null;
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly debugEvents: ConnectHttpDebugEvent[] = [];
  private readonly debugListeners = new Set<(event: ConnectHttpDebugEvent) => void>();

  onRequestEvent(listener: (event: ConnectHttpDebugEvent) => void): () => void {
    this.debugListeners.add(listener);
    return () => {
      this.debugListeners.delete(listener);
    };
  }

  getDebugEvents(): ConnectHttpDebugEvent[] {
    return [...this.debugEvents];
  }

  async close(): Promise<void> {
    this.tokens.clear();
    this.debugEvents.length = 0;
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = null;
    this.port = null;
  }

  async createAudioUrl(filePath: string, options: TokenUrlOptions): Promise<{ url: string; mimeType: string; sizeBytes: number }> {
    await this.ensureStarted();
    const mimeType = options.audioMimeType ?? mimeTypeForAudioPath(filePath);
    const token = this.createToken({
      kind: 'audio',
      filePath,
      mimeType,
      expiresAtMs: Date.now() + (options.ttlMs ?? defaultTokenTtlMs),
    });
    const fileStat = statSync(filePath);

    return {
      url: `http://${options.host}:${this.port}/connect/audio/${token}/${dlnaFriendlyAudioName(filePath, mimeType)}`,
      mimeType,
      sizeBytes: fileStat.size,
    };
  }

  async createRemoteAudioUrl(remoteUrl: string, options: TokenUrlOptions): Promise<{ url: string; mimeType: string; sizeBytes: null }> {
    await this.ensureStarted();
    const mimeType = options.audioMimeType ?? mimeTypeForAudioPath(remoteUrl);
    const token = this.createToken({
      kind: 'remote-audio',
      remoteUrl,
      mimeType,
      expiresAtMs: Date.now() + (options.ttlMs ?? defaultTokenTtlMs),
    });

    return {
      url: `http://${options.host}:${this.port}/connect/audio/${token}/${dlnaFriendlyAudioName(remoteUrl, mimeType)}`,
      mimeType,
      sizeBytes: null,
    };
  }

  async createTranscodeUrl(filePath: string, options: TokenUrlOptions): Promise<{ url: string; mimeType: string; sizeBytes: null }> {
    await this.ensureStarted();
    const toolchain = resolveFfmpegToolchain();
    if (!toolchain.healthy) {
      throw new Error(`设备不支持当前音频格式，且 FFmpeg 不可用：${toolchain.error ?? 'ffmpeg_missing'}`);
    }

    const token = this.createToken({
      kind: 'transcode',
      filePath,
      expiresAtMs: Date.now() + (options.ttlMs ?? defaultTokenTtlMs),
    });

    return {
      url: `http://${options.host}:${this.port}/connect/transcode/${token}/stream.mp3`,
      mimeType: 'audio/mpeg',
      sizeBytes: null,
    };
  }

  async createCoverUrl(filePath: string | null, options: TokenUrlOptions): Promise<string> {
    await this.ensureStarted();
    const sourceMimeType = options.mimeType ?? (filePath ? mimeTypeForImagePath(filePath) : 'image/svg+xml');
    const transcodeToJpeg = options.forceJpegCover === true;
    const mimeType = transcodeToJpeg ? 'image/jpeg' : sourceMimeType;
    const token = this.createToken({
      kind: 'cover',
      filePath,
      remoteUrl: null,
      mimeType,
      sourceMimeType,
      transcodeToJpeg,
      expiresAtMs: Date.now() + (options.ttlMs ?? defaultTokenTtlMs),
    });

    return `http://${options.host}:${this.port}/connect/cover/${token}/cover.jpg`;
  }

  async createRemoteCoverUrl(remoteUrl: string, options: TokenUrlOptions): Promise<string> {
    await this.ensureStarted();
    const token = this.createToken({
      kind: 'cover',
      filePath: null,
      remoteUrl,
      mimeType: 'image/jpeg',
      sourceMimeType: null,
      transcodeToJpeg: true,
      expiresAtMs: Date.now() + (options.ttlMs ?? defaultTokenTtlMs),
    });

    return `http://${options.host}:${this.port}/connect/cover/${token}/cover.jpg`;
  }

  clearExpiredTokens(now = Date.now()): void {
    for (const [token, record] of this.tokens) {
      if (record.expiresAtMs <= now) {
        this.tokens.delete(token);
      }
    }
  }

  private createToken(record: TokenRecord): string {
    this.clearExpiredTokens();
    const token = randomBytes(24).toString('base64url');
    this.tokens.set(token, record);
    return token;
  }

  private recordDebugEvent(
    request: IncomingMessage,
    event: Omit<ConnectHttpDebugEvent, 'id' | 'at' | 'remoteAddress' | 'method' | 'path' | 'range' | 'userAgent'> & {
      path?: string;
    },
  ): void {
    const next: ConnectHttpDebugEvent = {
      id: randomBytes(8).toString('hex'),
      at: new Date().toISOString(),
      remoteAddress: request.socket.remoteAddress?.replace(/^::ffff:/u, '') ?? null,
      method: request.method ?? 'UNKNOWN',
      path: event.path ?? request.url ?? '',
      range: safeHeader(request.headers.range) ?? null,
      userAgent: safeHeader(request.headers['user-agent']) ?? null,
      kind: event.kind,
      statusCode: event.statusCode,
      bytes: event.bytes,
      message: event.message,
    };
    this.debugEvents.unshift(next);
    this.debugEvents.splice(24);
    for (const listener of this.debugListeners) {
      listener(next);
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.server && this.port) {
      return;
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '0.0.0.0', () => {
        const address = this.server!.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Connect HTTP server did not bind to a TCP port'));
          return;
        }

        this.port = address.port;
        this.server!.off('error', reject);
        resolve();
      });
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        this.recordDebugEvent(request, { kind: 'unknown', statusCode: 405, bytes: 0, message: 'method_not_allowed' });
        response.writeHead(405, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }

      const match = request.url?.match(/^\/connect\/(audio|cover|transcode)\/([^/?#]+)/u);
      const kind = (match?.[1] ?? 'unknown') as ConnectHttpDebugEvent['kind'];
      const token = match?.[2] ?? null;
      const record = token ? this.tokens.get(token) : null;

      if (!record || record.expiresAtMs <= Date.now()) {
        if (token) {
          this.tokens.delete(token);
        }
        this.recordDebugEvent(request, { kind, statusCode: 401, bytes: 0, message: 'token_expired_or_missing' });
        response.writeHead(401, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }

      if (record.kind === 'audio') {
        await this.serveAudioFile(record, request, response);
        return;
      }

      if (record.kind === 'remote-audio') {
        await this.serveRemoteAudio(record, request, response);
        return;
      }

      if (record.kind === 'transcode') {
        this.serveTranscodedAudio(record, request, response);
        return;
      }

      await this.serveCover(record, request, response);
    } catch (error) {
      this.recordDebugEvent(request, {
        kind: 'unknown',
        statusCode: 500,
        bytes: 0,
        message: error instanceof Error ? error.message : String(error),
      });
      if (!response.headersSent) {
        response.writeHead(500, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
      }
      response.end(error instanceof Error ? error.message : String(error));
    }
  }

  private async serveAudioFile(record: DirectAudioToken, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const fileStat = statSync(record.filePath);
    if (!fileStat.isFile()) {
      this.recordDebugEvent(request, { kind: 'audio', statusCode: 404, bytes: 0, message: 'audio_file_missing' });
      response.writeHead(404, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }

    const total = fileStat.size;
    const baseHeaders: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=0, no-store',
      'Content-Type': record.mimeType,
      'ContentFeatures.DLNA.ORG': dlnaContentFeaturesForMime(record.mimeType),
      'Last-Modified': fileStat.mtime.toUTCString(),
      'transferMode.dlna.org': 'Streaming',
    };
    const range = safeHeader(request.headers.range);

    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/u);
      const rangeStart = match?.[1] ?? '';
      const rangeEnd = match?.[2] ?? '';
      let start = 0;
      let end = total - 1;

      if (match && rangeStart === '' && rangeEnd !== '') {
        start = Math.max(0, total - Number(rangeEnd));
      } else if (match) {
        start = rangeStart === '' ? 0 : Number(rangeStart);
        end = rangeEnd === '' ? total - 1 : Number(rangeEnd);
      }

      start = Math.max(0, start);
      end = Math.min(total - 1, end);

      if (!match || total <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        this.recordDebugEvent(request, { kind: 'audio', statusCode: 416, bytes: 0, message: 'invalid_range' });
        response.writeHead(416, {
          ...baseHeaders,
          'Content-Range': `bytes */${total}`,
          'Content-Length': '0',
        });
        response.end();
        return;
      }

      this.recordDebugEvent(request, { kind: 'audio', statusCode: 206, bytes: end - start + 1, message: record.mimeType });
      response.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(end - start + 1),
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      pipeFileReadStream(response, record.filePath, { start, end });
      return;
    }

    this.recordDebugEvent(request, { kind: 'audio', statusCode: 200, bytes: total, message: record.mimeType });
    response.writeHead(200, {
      ...baseHeaders,
      'Content-Length': String(total),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    pipeFileReadStream(response, record.filePath);
  }

  private async serveRemoteAudio(record: RemoteAudioToken, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const headers: Record<string, string> = {
      Accept: '*/*',
    };
    const range = safeHeader(request.headers.range);
    if (range) {
      headers.Range = range;
    }

    try {
      const upstream = await fetch(record.remoteUrl, {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers,
        signal: AbortSignal.timeout(15000),
      });
      const contentType = upstream.headers.get('content-type')?.split(';')[0]?.trim() || record.mimeType;
      const contentLength = upstream.headers.get('content-length');
      const contentRange = upstream.headers.get('content-range');
      const acceptRanges = upstream.headers.get('accept-ranges') || 'bytes';
      const statusCode = upstream.status === 206 ? 206 : upstream.ok ? 200 : upstream.status;
      const bytes = contentLength && /^\d+$/u.test(contentLength) ? Number(contentLength) : null;

      this.recordDebugEvent(request, {
        kind: 'audio',
        statusCode,
        bytes,
        message: `remote:${contentType}`,
      });

      const responseHeaders: Record<string, string> = {
        'Accept-Ranges': acceptRanges,
        'Cache-Control': 'private, max-age=0, no-store',
        'Content-Type': contentType,
        'ContentFeatures.DLNA.ORG': dlnaContentFeaturesForMime(record.mimeType),
        'transferMode.dlna.org': 'Streaming',
      };
      if (contentLength) {
        responseHeaders['Content-Length'] = contentLength;
      }
      if (contentRange) {
        responseHeaders['Content-Range'] = contentRange;
      }

      response.writeHead(statusCode, responseHeaders);
      if (request.method === 'HEAD' || !upstream.body) {
        response.end();
        return;
      }

      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).once('error', (error) => {
        if (!response.destroyed) {
          response.destroy(error);
        }
      }).pipe(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordDebugEvent(request, { kind: 'audio', statusCode: 502, bytes: 0, message: `remote_failed:${message}` });
      endResponseSafely(response, 502, message);
    }
  }

  private serveTranscodedAudio(record: TranscodeToken, request: IncomingMessage, response: ServerResponse): void {
    this.recordDebugEvent(request, { kind: 'transcode', statusCode: 200, bytes: null, message: 'audio/mpeg' });
    if (request.method === 'HEAD') {
      response.writeHead(200, {
        'Accept-Ranges': 'none',
        'Cache-Control': 'private, max-age=0, no-store',
        'Content-Type': 'audio/mpeg',
        'ContentFeatures.DLNA.ORG': dlnaContentFeaturesForMime('audio/mpeg'),
        'transferMode.dlna.org': 'Streaming',
      });
      response.end();
      return;
    }

    const toolchain = resolveFfmpegToolchain();
    const child = spawn(
      toolchain.path,
      ['-hide_banner', '-loglevel', 'error', '-i', record.filePath, '-vn', '-codec:a', 'libmp3lame', '-b:a', '320k', '-f', 'mp3', 'pipe:1'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );

    response.writeHead(200, {
      'Accept-Ranges': 'none',
      'Cache-Control': 'private, max-age=0, no-store',
      'Content-Type': 'audio/mpeg',
      'ContentFeatures.DLNA.ORG': dlnaContentFeaturesForMime('audio/mpeg'),
      'transferMode.dlna.org': 'Streaming',
    });
    child.once('error', (error) => {
      endResponseSafely(response, 502, error instanceof Error ? error.message : String(error));
    });
    child.stdout.once('error', (error) => {
      endResponseSafely(response, 502, error instanceof Error ? error.message : String(error));
    });
    child.stdout.pipe(response);
    response.on('close', () => {
      if (!child.killed) {
        child.kill();
      }
    });
  }

  private async coverBody(record: CoverToken): Promise<Buffer> {
    if (record.cachedBody) {
      return record.cachedBody;
    }

    let source: string | Buffer = Buffer.from(defaultCoverSvg, 'utf8');
    if (record.filePath && existsSync(record.filePath)) {
      source = record.filePath;
    } else if (record.remoteUrl) {
      const response = await fetch(record.remoteUrl, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        throw new Error(`remote cover HTTP ${response.status}`);
      }
      source = Buffer.from(await response.arrayBuffer());
    }
    const body = await sharp(source, { animated: false })
      .rotate()
      .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    record.cachedBody = body;
    return body;
  }

  private async serveCover(record: CoverToken, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (record.transcodeToJpeg) {
      const body = await this.coverBody(record);
      this.recordDebugEvent(request, {
        kind: 'cover',
        statusCode: 200,
        bytes: body.byteLength,
        message: record.filePath && existsSync(record.filePath)
          ? 'image/jpeg'
          : record.remoteUrl
            ? 'remote-cover:image/jpeg'
            : 'default-cover:image/jpeg',
      });
      response.writeHead(200, {
        'Cache-Control': 'private, max-age=86400',
        'Content-Length': String(body.byteLength),
        'Content-Type': 'image/jpeg',
        'ContentFeatures.DLNA.ORG': jpegCoverContentFeatures,
        'transferMode.dlna.org': 'Interactive',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }

    if (record.filePath && existsSync(record.filePath)) {
      const fileStat = statSync(record.filePath);
      this.recordDebugEvent(request, { kind: 'cover', statusCode: 200, bytes: fileStat.size, message: record.mimeType });
      response.writeHead(200, {
        'Cache-Control': 'private, max-age=86400',
        'Content-Length': String(fileStat.size),
        'Content-Type': record.mimeType,
        'ContentFeatures.DLNA.ORG': record.mimeType === 'image/jpeg' ? jpegCoverContentFeatures : 'DLNA.ORG_OP=00',
        'Last-Modified': fileStat.mtime.toUTCString(),
        'transferMode.dlna.org': 'Interactive',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      pipeFileReadStream(response, record.filePath);
      return;
    }

    const body = Buffer.from(defaultCoverSvg, 'utf8');
    this.recordDebugEvent(request, { kind: 'cover', statusCode: 200, bytes: body.byteLength, message: 'default-cover:image/svg+xml' });
    response.writeHead(200, {
      'Cache-Control': 'private, max-age=86400',
      'Content-Length': String(body.byteLength),
      'Content-Type': 'image/svg+xml',
      'transferMode.dlna.org': 'Interactive',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  }
}
