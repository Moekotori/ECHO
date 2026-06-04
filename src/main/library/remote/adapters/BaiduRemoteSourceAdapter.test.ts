import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaiduRemoteSourceAdapter } from './BaiduRemoteSourceAdapter';
import type { RemoteSourceSecret } from '../remoteTypes';
import { encodeBaiduOAuthTokenSecret } from '../BaiduOAuth';

const readRequestBody = (request: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });

describe('BaiduRemoteSourceAdapter', () => {
  let server: Server;
  let baseUrl = '';
  let rejectToken1OnFileOnce = false;
  const requests: Array<{ path: string; token: string | null; userAgent: string | undefined; range: string | undefined }> = [];

  beforeEach(async () => {
    requests.length = 0;
    rejectToken1OnFileOnce = false;
    server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
      await readRequestBody(request);
      const url = new URL(request.url ?? '/', baseUrl || 'http://127.0.0.1');
      requests.push({
        path: url.pathname,
        token: url.searchParams.get('access_token'),
        userAgent: request.headers['user-agent'],
        range: typeof request.headers.range === 'string' ? request.headers.range : undefined,
      });

      if (url.pathname === '/file') {
        expect(['token-1', 'token-2']).toContain(url.searchParams.get('access_token'));
        if (rejectToken1OnFileOnce && url.searchParams.get('access_token') === 'token-1') {
          rejectToken1OnFileOnce = false;
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ errno: 111, errmsg: 'Access token invalid or expired' }));
          return;
        }
        if (url.searchParams.get('method') !== 'list') {
          response.writeHead(400);
          response.end();
          return;
        }
        const dir = url.searchParams.get('dir');
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          errno: 0,
          list: dir === '/Music/'
            ? [
                {
                  fs_id: 101,
                  path: '/Music/Album',
                  server_filename: 'Album',
                  isdir: 1,
                  server_mtime: 1779940000,
                },
                {
                  fs_id: 102,
                  path: '/Music/song.mp3',
                  server_filename: 'song.mp3',
                  isdir: 0,
                  size: 1234,
                  server_mtime: 1779940001,
                },
              ]
            : [],
        }));
        return;
      }

      if (url.pathname === '/multimedia') {
        expect(['token-1', 'token-2']).toContain(url.searchParams.get('access_token'));
        expect(url.searchParams.get('method')).toBe('filemetas');
        expect(url.searchParams.get('fsids')).toBe('[102]');
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ errno: 0, list: [{ fs_id: 102, dlink: `${baseUrl}/download/song.mp3` }] }));
        return;
      }

      if (url.pathname === '/download/song.mp3') {
        expect(request.headers['user-agent']).toBe('pan.baidu.com');
        response.writeHead(request.headers.range ? 206 : 200, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': '4',
          'Accept-Ranges': 'bytes',
        });
        response.end(Buffer.from([0, 1, 2, 3]));
        return;
      }

      response.writeHead(404);
      response.end();
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('test server did not bind'));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        server.off('error', reject);
        resolve();
      });
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const source = (): RemoteSourceSecret => ({
    id: 'baidu-1',
    provider: 'baidu',
    displayName: 'Baidu',
    status: 'enabled',
    baseUrl: null,
    username: null,
    authType: 'token',
    config: { rootPath: '/Music' },
    syncMode: 'index',
    lastTestAt: null,
    lastSyncAt: null,
    lastError: null,
    indexedTrackCount: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    secret: 'token-1',
  });

  it('browses Baidu directories and exposes audio files with fs ids', async () => {
    const adapter = new BaiduRemoteSourceAdapter({
      fileApiUrl: `${baseUrl}/file`,
      multimediaApiUrl: `${baseUrl}/multimedia`,
    });

    const result = await adapter.testConnection({ source: source() });
    expect(result.ok).toBe(true);

    const items = await adapter.browse({ source: source(), path: '/Music' });
    expect(items).toEqual([
      expect.objectContaining({
        provider: 'baidu',
        kind: 'directory',
        path: '/Music/Album/',
        etag: 'fsid:101',
        audio: false,
      }),
      expect.objectContaining({
        provider: 'baidu',
        kind: 'file',
        path: '/Music/song.mp3',
        etag: 'fsid:102',
        audio: true,
        sizeBytes: 1234,
      }),
    ]);
  });

  it('uses filemetas dlink and pan.baidu.com UA for proxy playback', async () => {
    const adapter = new BaiduRemoteSourceAdapter({
      fileApiUrl: `${baseUrl}/file`,
      multimediaApiUrl: `${baseUrl}/multimedia`,
    });

    const request = await adapter.createProxyRequest({
      source: source(),
      remotePath: '/Music/song.mp3',
      stableKey: 'baidu|baidu-1|102|/music/song.mp3|1234|2026-05-28T00:00:00.000Z',
    });

    expect(request.headers?.['User-Agent']).toBe('pan.baidu.com');
    expect(request.url).toContain('/download/song.mp3');
    expect(request.url).toContain('access_token=token-1');
  });

  it('refreshes an expiring OAuth token before creating a proxy request', async () => {
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const url = new URL(String(input));
      if (url.origin === 'https://openapi.baidu.com' && url.pathname === '/oauth/2.0/token') {
        expect(url.searchParams.get('grant_type')).toBe('refresh_token');
        expect(url.searchParams.get('refresh_token')).toBe('refresh-token');
        return new Response(JSON.stringify({
          access_token: 'token-2',
          refresh_token: 'refresh-token-2',
          expires_in: 2592000,
          scope: 'basic netdisk',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    }) as typeof fetch);

    const adapter = new BaiduRemoteSourceAdapter({
      fileApiUrl: `${baseUrl}/file`,
      multimediaApiUrl: `${baseUrl}/multimedia`,
    });
    const refreshedSecrets: string[] = [];
    adapter.setTokenRefreshHandler((_sourceId, tokenSecret) => {
      refreshedSecrets.push(tokenSecret);
    });
    const oauthSource = source();
    oauthSource.secret = encodeBaiduOAuthTokenSecret({
      accessToken: 'token-1',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'oob',
    });

    const request = await adapter.createProxyRequest({
      source: oauthSource,
      remotePath: '/Music/song.mp3',
      stableKey: 'baidu|baidu-1|102|/music/song.mp3|1234|2026-05-28T00:00:00.000Z',
    });

    expect(request.url).toContain('access_token=token-2');
    expect(refreshedSecrets).toHaveLength(1);
    expect(refreshedSecrets[0]).toContain('refresh-token-2');
  });

  it('refreshes and retries once when Baidu reports an expired token', async () => {
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const url = new URL(String(input));
      if (url.origin === 'https://openapi.baidu.com' && url.pathname === '/oauth/2.0/token') {
        return new Response(JSON.stringify({
          access_token: 'token-2',
          refresh_token: 'refresh-token-2',
          expires_in: 2592000,
          scope: 'basic netdisk',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    }) as typeof fetch);

    rejectToken1OnFileOnce = true;
    const adapter = new BaiduRemoteSourceAdapter({
      fileApiUrl: `${baseUrl}/file`,
      multimediaApiUrl: `${baseUrl}/multimedia`,
    });
    const oauthSource = source();
    oauthSource.secret = encodeBaiduOAuthTokenSecret({
      accessToken: 'token-1',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'oob',
    });

    const items = await adapter.browse({ source: oauthSource, path: '/Music' });

    expect(items.some((item) => item.path === '/Music/song.mp3')).toBe(true);
    expect(requests.filter((request) => request.path === '/file').map((request) => request.token)).toEqual(['token-1', 'token-2']);
  });
});
