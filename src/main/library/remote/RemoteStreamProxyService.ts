import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { RemoteStreamUrlResult } from '../../../shared/types/remoteSources';
import { fetchWithNetworkProxy } from '../../network/networkFetch';
import type { RemoteSourceAdapter, RemoteSourceSecret } from './remoteTypes';
import { normalizeRemotePath } from './remoteIdentity';

type TokenRecord = {
  source: RemoteSourceSecret;
  remotePath: string;
  stableKey: string | null;
  expiresAtMs: number;
};

const defaultTokenTtlMs = 6 * 60 * 60 * 1000;
const playbackTokenTtlMs = 24 * 60 * 60 * 1000;
const upstreamResponseTimeoutMs = 15_000;

const safeHeader = (value: string | string[] | undefined): string | undefined => (typeof value === 'string' ? value : undefined);
const abortError = (): Error => {
  const error = new Error('Remote stream upstream request timed out');
  error.name = 'AbortError';
  return error;
};

const timeoutSignal = (timeoutMs: number): { signal: AbortSignal; abort: () => void; clear: () => void } => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(abortError()), timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    clear: () => clearTimeout(timer),
  };
};

const contentTypeFor = (filePath: string): string => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a') || lower.endsWith('.m4p') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.aiff') || lower.endsWith('.aif')) return 'audio/aiff';
  return 'application/octet-stream';
};

export class RemoteStreamProxyService {
  private server: Server | null = null;
  private port: number | null = null;
  private readonly tokens = new Map<string, TokenRecord>();

  constructor(
    private readonly getAdapter: (provider: string) => RemoteSourceAdapter,
    private readonly options: { upstreamResponseTimeoutMs?: number; fetch?: typeof fetch } = {},
  ) {}

  async createStreamUrl(source: RemoteSourceSecret, remotePath: string, stableKey?: string | null, expiresInSeconds?: number): Promise<RemoteStreamUrlResult> {
    await this.ensureStarted();
    const token = randomBytes(24).toString('base64url');
    const ttlMs = expiresInSeconds === undefined ? playbackTokenTtlMs : Math.max(1, Math.round(expiresInSeconds * 1000));
    const expiresAtMs = Date.now() + ttlMs;

    this.tokens.set(token, {
      source,
      remotePath: normalizeRemotePath(remotePath),
      stableKey: stableKey ?? null,
      expiresAtMs,
    });

    return {
      url: `http://127.0.0.1:${this.port}/remote-stream/${token}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  clearSourceTokens(sourceId: string): void {
    for (const [token, record] of this.tokens) {
      if (record.source.id === sourceId) {
        this.tokens.delete(token);
      }
    }
  }

  async close(): Promise<void> {
    this.tokens.clear();
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = null;
    this.port = null;
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
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Remote stream proxy did not bind to a TCP port'));
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
        response.writeHead(405);
        response.end();
        return;
      }

      const token = request.url?.match(/^\/remote-stream\/([^/?#]+)/u)?.[1] ?? null;
      const record = token ? this.tokens.get(token) : null;

      if (!token || !record || record.expiresAtMs <= Date.now()) {
        if (token) {
          this.tokens.delete(token);
        }
        response.writeHead(401);
        response.end();
        return;
      }

      record.expiresAtMs = Math.max(record.expiresAtMs, Date.now() + defaultTokenTtlMs);
      await this.forward(record, request, response);
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(502, {
          'Cache-Control': 'no-store',
        });
      }
      response.end(error instanceof Error ? error.message : 'remote stream failed');
    }
  }

  private async forward(record: TokenRecord, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const adapter = this.getAdapter(record.source.provider);
    if (!adapter.createProxyRequest) {
      response.writeHead(501);
      response.end();
      return;
    }

    const proxyRequest = await adapter.createProxyRequest({
      source: record.source,
      remotePath: record.remotePath,
      stableKey: record.stableKey,
    });
    if (proxyRequest.filePath) {
      await this.forwardFile(proxyRequest.filePath, request, response);
      return;
    }
    if (!proxyRequest.url) {
      response.writeHead(502);
      response.end();
      return;
    }

    const headers: Record<string, string> = {
      ...(proxyRequest.headers ?? {}),
      Accept: '*/*',
    };
    const range = safeHeader(request.headers.range);
    if (range) {
      headers.Range = range;
    }

    const timeout = timeoutSignal(this.options.upstreamResponseTimeoutMs ?? upstreamResponseTimeoutMs);
    let responseClosed = false;
    const abortOnClose = (): void => {
      responseClosed = true;
      if (!response.writableEnded) {
        timeout.clear();
        timeout.abort();
      }
    };
    response.once('close', abortOnClose);

    let upstream: Response;
    try {
      upstream = await (this.options.fetch ?? fetchWithNetworkProxy)(proxyRequest.url, {
        method: request.method,
        headers,
        signal: timeout.signal,
      }).finally(timeout.clear);
    } catch (error) {
      response.off('close', abortOnClose);
      throw error;
    }
    if (responseClosed || response.destroyed) {
      upstream.body?.cancel().catch(() => undefined);
      response.off('close', abortOnClose);
      return;
    }

    const status = upstream.status === 416 ? 416 : upstream.status === 206 ? 206 : upstream.ok ? 200 : upstream.status;
    const acceptRanges = upstream.headers.get('accept-ranges') ?? (upstream.status === 206 || upstream.headers.has('content-range') ? 'bytes' : 'none');
    const responseHeaders: Record<string, string> = {
      'Accept-Ranges': acceptRanges,
      'Cache-Control': 'private, max-age=0, no-store',
    };

    for (const [source, target] of [
      ['content-type', 'Content-Type'],
      ['content-length', 'Content-Length'],
      ['content-range', 'Content-Range'],
      ['last-modified', 'Last-Modified'],
      ['etag', 'ETag'],
    ] as const) {
      const value = upstream.headers.get(source);
      if (value) {
        responseHeaders[target] = value;
      }
    }

    response.writeHead(status, responseHeaders);
    if (request.method === 'HEAD' || !upstream.body) {
      response.end();
      response.off('close', abortOnClose);
      return;
    }

    try {
      await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), response);
    } finally {
      response.off('close', abortOnClose);
    }
  }

  private async forwardFile(filePath: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      response.writeHead(404, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }

    const total = fileStat.size;
    const baseHeaders: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=0, no-store',
      'Content-Type': contentTypeFor(filePath),
      'Last-Modified': fileStat.mtime.toUTCString(),
    };
    const range = safeHeader(request.headers.range);

    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/u);
      const rangeStart = match?.[1] ?? '';
      const rangeEnd = match?.[2] ?? '';
      let start = 0;
      let end = total - 1;

      if (match && rangeStart === '' && rangeEnd !== '') {
        const suffixLength = Number(rangeEnd);
        start = Math.max(0, total - suffixLength);
      } else if (match) {
        start = rangeStart === '' ? 0 : Number(rangeStart);
        end = rangeEnd === '' ? total - 1 : Number(rangeEnd);
      }

      start = Math.max(0, start);
      end = Math.min(total - 1, end);

      if (!match || total <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        response.writeHead(416, {
          ...baseHeaders,
          'Content-Range': `bytes */${total}`,
          'Content-Length': '0',
        });
        response.end();
        return;
      }

      response.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(end - start + 1),
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(filePath, { start, end }).pipe(response);
      return;
    }

    response.writeHead(200, {
      ...baseHeaders,
      'Content-Length': String(total),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  }
}
