import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname } from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

type MediaServerRecord = {
  url: string;
  headers: Record<string, string>;
  mimeType: string | null;
  expiresAtMs: number;
};

export type HqPlayerMediaServerOptions = {
  port: number | null;
  remoteAccess: boolean;
  preferredRemoteHost?: string | null;
  ttlMs?: number;
};

export type HqPlayerMediaServerInput = {
  url: string;
  headers?: Record<string, string>;
  mimeType?: string | null;
};

export type HqPlayerMediaServerUrl = {
  url: string;
  expiresAt: string;
  port: number;
  bindHost: string | null;
  publicHost: string | null;
  remoteAccess: boolean;
  publicHostCandidates: string[];
};

export type HqPlayerMediaServerBridge = Pick<HqPlayerMediaServer, 'createUrl'>;

const defaultTokenTtlMs = 6 * 60 * 60 * 1000;
const defaultLoopbackHost = '127.0.0.1';
const remoteBindHost = '0.0.0.0';

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
]);

const safeHeader = (value: string | string[] | undefined): string | undefined => (typeof value === 'string' ? value : undefined);

const contentTypeFor = (url: string, fallback: string | null): string => {
  if (fallback) {
    return fallback;
  }

  try {
    return audioMimeTypes.get(extname(new URL(url).pathname).toLowerCase()) ?? 'application/octet-stream';
  } catch {
    return audioMimeTypes.get(extname(url).toLowerCase()) ?? 'application/octet-stream';
  }
};

const normalizePort = (port: number | null): number =>
  typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;

const listPublicHosts = (): string[] => {
  const hosts: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        hosts.push(entry.address);
      }
    }
  }

  return hosts;
};

const selectRoutedPublicHost = async (remoteHost: string | null | undefined): Promise<string | null> => {
  const target = remoteHost?.trim();
  if (!target) {
    return null;
  }

  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    let settled = false;
    const timer = setTimeout(() => finish(null), 1000);
    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    socket.once('error', () => finish(null));
    socket.connect(9, target, () => {
      const address = socket.address();
      finish(typeof address === 'string' ? null : address.address);
    });
  });
};

const selectPublicHost = async (preferredRemoteHost: string | null | undefined): Promise<{ host: string; candidates: string[] }> => {
  const candidates = listPublicHosts();
  const routed = await selectRoutedPublicHost(preferredRemoteHost);
  if (routed && routed !== defaultLoopbackHost) {
    return {
      host: routed,
      candidates: candidates.includes(routed) ? candidates : [routed, ...candidates],
    };
  }

  return {
    host: candidates[0] ?? defaultLoopbackHost,
    candidates,
  };
};

const parseRange = (range: string | undefined, size: number): { start: number; end: number } | null => {
  if (!range) {
    return null;
  }

  const match = range.match(/^bytes=(\d*)-(\d*)$/u);
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
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
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

export class HqPlayerMediaServer {
  private server: Server | null = null;
  private port: number | null = null;
  private bindHost: string | null = null;
  private publicHost: string | null = null;
  private readonly tokens = new Map<string, MediaServerRecord>();

  async createUrl(input: HqPlayerMediaServerInput, options: HqPlayerMediaServerOptions): Promise<HqPlayerMediaServerUrl> {
    const publicHost = await this.ensureStarted(options);

    if (!this.port || !this.publicHost) {
      throw new Error('hqplayer_media_server_not_ready');
    }

    const token = randomBytes(32).toString('base64url');
    const ttlMs = Math.max(1, Math.round(options.ttlMs ?? defaultTokenTtlMs));
    const expiresAtMs = Date.now() + ttlMs;
    this.tokens.set(token, {
      url: input.url,
      headers: input.headers ?? {},
      mimeType: input.mimeType ?? null,
      expiresAtMs,
    });

    return {
      url: `http://${this.publicHost}:${this.port}/hqplayer-media/${token}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
      port: this.port,
      bindHost: this.bindHost,
      publicHost: this.publicHost,
      remoteAccess: options.remoteAccess,
      publicHostCandidates: publicHost.candidates,
    };
  }

  getStatus(): { running: boolean; port: number | null; bindHost: string | null; publicHost: string | null; activeTokens: number } {
    this.cleanupExpiredTokens();
    return {
      running: Boolean(this.server && this.port),
      port: this.port,
      bindHost: this.bindHost,
      publicHost: this.publicHost,
      activeTokens: this.tokens.size,
    };
  }

  async close(): Promise<void> {
    this.tokens.clear();
    if (!this.server) {
      this.port = null;
      this.bindHost = null;
      this.publicHost = null;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = null;
    this.port = null;
    this.bindHost = null;
    this.publicHost = null;
  }

  private async ensureStarted(options: HqPlayerMediaServerOptions): Promise<{ host: string; candidates: string[] }> {
    const bindHost = options.remoteAccess ? remoteBindHost : defaultLoopbackHost;
    const requestedPort = normalizePort(options.port);
    const publicHost = options.remoteAccess
      ? await selectPublicHost(options.preferredRemoteHost)
      : { host: defaultLoopbackHost, candidates: [defaultLoopbackHost] };

    if (this.server && this.port && this.bindHost === bindHost && (requestedPort === 0 || requestedPort === this.port)) {
      this.publicHost = publicHost.host;
      return publicHost;
    }

    await this.close();

    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, bindHost, () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('hqplayer_media_server_bind_failed'));
          return;
        }

        server.off('error', reject);
        this.port = address.port;
        this.bindHost = bindHost;
        this.publicHost = publicHost.host;
        resolve();
      });
    });
    return publicHost;
  }

  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [token, record] of this.tokens) {
      if (record.expiresAtMs <= now) {
        this.tokens.delete(token);
      }
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }

      const token = request.url?.match(/^\/hqplayer-media\/([^/?#]+)/u)?.[1] ?? null;
      const record = token ? this.tokens.get(token) : null;
      if (!token || !record || record.expiresAtMs <= Date.now()) {
        if (token) {
          this.tokens.delete(token);
        }
        response.writeHead(401, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }

      if (/^https?:\/\//iu.test(record.url)) {
        await this.forwardHttp(record, request, response);
        return;
      }

      await this.forwardFile(record, request, response);
    } catch {
      if (!response.headersSent) {
        response.writeHead(502, { 'Cache-Control': 'no-store' });
      }
      response.end();
    }
  }

  private async forwardHttp(record: MediaServerRecord, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const headers: Record<string, string> = {
      ...record.headers,
      Accept: '*/*',
    };
    const range = safeHeader(request.headers.range);
    if (range) {
      headers.Range = range;
    }

    const upstream = await fetch(record.url, {
      method: request.method,
      headers,
      redirect: 'follow',
    });

    const responseHeaders: Record<string, string> = {
      'Cache-Control': 'private, max-age=0, no-store',
      'Content-Type': upstream.headers.get('content-type') ?? contentTypeFor(record.url, record.mimeType),
    };

    for (const [source, target] of [
      ['accept-ranges', 'Accept-Ranges'],
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

    response.writeHead(upstream.status, responseHeaders);
    if (request.method === 'HEAD' || !upstream.body) {
      response.end();
      return;
    }

    Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(response);
  }

  private async forwardFile(record: MediaServerRecord, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const fileStat = await stat(record.url);
    if (!fileStat.isFile()) {
      response.writeHead(404, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }

    const size = fileStat.size;
    const rangeHeader = safeHeader(request.headers.range);
    const range = parseRange(rangeHeader, size);
    const baseHeaders: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=0, no-store',
      'Content-Type': contentTypeFor(record.url, record.mimeType),
      'Last-Modified': fileStat.mtime.toUTCString(),
    };

    if (rangeHeader && !range) {
      response.writeHead(416, {
        ...baseHeaders,
        'Content-Length': '0',
        'Content-Range': `bytes */${size}`,
      });
      response.end();
      return;
    }

    if (range) {
      response.writeHead(206, {
        ...baseHeaders,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(record.url, range).pipe(response);
      return;
    }

    response.writeHead(200, {
      ...baseHeaders,
      'Content-Length': String(size),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(record.url).pipe(response);
  }
}

let hqPlayerMediaServer: HqPlayerMediaServer | null = null;

export const getHqPlayerMediaServer = (): HqPlayerMediaServer => {
  hqPlayerMediaServer ??= new HqPlayerMediaServer();
  return hqPlayerMediaServer;
};
