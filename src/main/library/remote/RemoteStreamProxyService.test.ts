import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebDavRemoteSourceAdapter } from './adapters/WebDavRemoteSourceAdapter';
import { RemoteStreamProxyService } from './RemoteStreamProxyService';
import type { RemoteSourceAdapter, RemoteSourceSecret } from './remoteTypes';

const audioBytes = Buffer.from('0123456789abcdef');

const listen = async (server: Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('server did not bind'));
        return;
      }
      resolve(address.port);
    });
  });

const close = async (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const writeAudio = (request: IncomingMessage, response: ServerResponse): void => {
  expect(request.headers.authorization).toBe('Basic dXNlcjpzZWNyZXQ=');
  response.setHeader('Content-Type', 'audio/mpeg');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('ETag', '"track"');

  const range = request.headers.range;
  if (range === 'bytes=999-1000') {
    response.writeHead(416, {
      'Content-Range': `bytes */${audioBytes.length}`,
      'Content-Length': '0',
    });
    response.end();
    return;
  }

  if (typeof range === 'string') {
    const match = range.match(/^bytes=(\d+)-(\d+)$/u);
    const start = match ? Number(match[1]) : 0;
    const end = match ? Number(match[2]) : audioBytes.length - 1;
    const chunk = audioBytes.subarray(start, end + 1);
    response.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${audioBytes.length}`,
      'Content-Length': String(chunk.length),
    });
    if (request.method !== 'HEAD') {
      response.end(chunk);
    } else {
      response.end();
    }
    return;
  }

  response.writeHead(200, {
    'Content-Length': String(audioBytes.length),
  });
  if (request.method !== 'HEAD') {
    response.end(audioBytes);
  } else {
    response.end();
  }
};

describe('RemoteStreamProxyService', () => {
  let backend: Server;
  let backendPort = 0;
  let proxy: RemoteStreamProxyService;

  beforeEach(async () => {
    backend = createServer((request, response) => {
      if (request.url !== '/dav/song.mp3') {
        response.writeHead(404);
        response.end();
        return;
      }
      writeAudio(request, response);
    });
    backendPort = await listen(backend);
    const adapter = new WebDavRemoteSourceAdapter();
    proxy = new RemoteStreamProxyService(() => adapter);
  });

  afterEach(async () => {
    await proxy.close();
    await close(backend);
  });

  const source = (): RemoteSourceSecret => ({
    id: 'source-1',
    provider: 'webdav',
    displayName: 'WebDAV',
    status: 'enabled',
    baseUrl: `http://127.0.0.1:${backendPort}/dav`,
    username: 'user',
    authType: 'basic',
    config: {},
    syncMode: 'index',
    lastTestAt: null,
    lastSyncAt: null,
    lastError: null,
    indexedTrackCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    secret: 'secret',
  });

  it('proxies HEAD, GET, Range, and 416 without leaking credentials in the URL', async () => {
    const stream = await proxy.createStreamUrl(source(), '/song.mp3', 'stable-1');

    expect(stream.url).not.toContain('user');
    expect(stream.url).not.toContain('secret');

    const head = await fetch(stream.url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(audioBytes.length));
    expect(head.headers.get('accept-ranges')).toBe('bytes');

    const complete = await fetch(stream.url);
    expect(complete.status).toBe(200);
    expect(Buffer.from(await complete.arrayBuffer()).equals(audioBytes)).toBe(true);

    const partial = await fetch(stream.url, { headers: { Range: 'bytes=2-5' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 2-5/${audioBytes.length}`);
    expect(partial.headers.get('content-length')).toBe('4');
    expect(Buffer.from(await partial.arrayBuffer()).toString('utf8')).toBe('2345');

    const unsatisfied = await fetch(stream.url, { headers: { Range: 'bytes=999-1000' } });
    expect(unsatisfied.status).toBe(416);
    expect(unsatisfied.headers.get('content-range')).toBe(`bytes */${audioBytes.length}`);
  });

  it('expires short-lived tokens', async () => {
    const stream = await proxy.createStreamUrl(source(), '/song.mp3', 'stable-1', 0.001);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const response = await fetch(stream.url);
    expect(response.status).toBe(401);
  });

  it('uses the configured upstream fetch for remote stream requests', async () => {
    await proxy.close();
    const upstreamFetch = vi.fn(async () =>
      new Response(audioBytes, {
        status: 200,
        headers: {
          'Content-Length': String(audioBytes.length),
          'Content-Type': 'audio/mpeg',
        },
      }),
    );
    const adapter = {
      provider: 'webdav',
      createProxyRequest: () => ({
        url: 'https://remote.example/song.mp3',
        headers: { Authorization: 'Bearer secret' },
      }),
    } as unknown as RemoteSourceAdapter;
    proxy = new RemoteStreamProxyService(() => adapter, { fetch: upstreamFetch as typeof fetch });

    const stream = await proxy.createStreamUrl(source(), '/song.mp3', 'stable-1');
    const response = await fetch(stream.url, { headers: { Range: 'bytes=0-3' } });

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(audioBytes)).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledWith(
      'https://remote.example/song.mp3',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
          Range: 'bytes=0-3',
        }),
      }),
    );
  });

  it('times out stalled upstream streams instead of leaving playback waiting forever', async () => {
    await proxy.close();
    await close(backend);

    backend = createServer(() => {
      // Keep the socket open without sending headers to simulate a wedged Subsonic stream.
    });
    backendPort = await listen(backend);
    const adapter = {
      provider: 'webdav',
      createProxyRequest: () => ({ url: `http://127.0.0.1:${backendPort}/dav/song.mp3` }),
    } as unknown as RemoteSourceAdapter;
    proxy = new RemoteStreamProxyService(() => adapter, { upstreamResponseTimeoutMs: 20 });

    const stream = await proxy.createStreamUrl(source(), '/song.mp3', 'stable-1');
    const response = await fetch(stream.url);

    expect(response.status).toBe(502);
  });
});
