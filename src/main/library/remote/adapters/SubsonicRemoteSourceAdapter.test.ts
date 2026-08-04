import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoteStreamProxyService } from '../RemoteStreamProxyService';
import type { RemoteSourceSecret } from '../remoteTypes';
import { SubsonicRemoteSourceAdapter } from './SubsonicRemoteSourceAdapter';

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

const md5 = (value: string): string => createHash('md5').update(value).digest('hex');

const envelope = (body: Record<string, unknown>): string => JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...body } });

const source = (port: number): RemoteSourceSecret => ({
  id: 'source-subsonic',
  provider: 'subsonic',
  displayName: 'Navidrome',
  status: 'enabled',
  baseUrl: `http://127.0.0.1:${port}`,
  username: 'user',
  authType: 'basic',
  config: { apiVersion: '1.16.1', authMode: 'token' },
  syncMode: 'index',
  lastTestAt: null,
  lastSyncAt: null,
  lastError: null,
  indexedTrackCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  secret: 'password',
});

describe('SubsonicRemoteSourceAdapter', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await close(server);
    }
  });

  it('pings, scans album songs, and proxies streams without leaking credentials', async () => {
    const audio = Buffer.from('subsonic-audio');
    const assertAuth = (url: URL): void => {
      expect(url.searchParams.get('u')).toBe('user');
      const salt = url.searchParams.get('s') ?? '';
      expect(url.searchParams.get('t')).toBe(md5(`password${salt}`));
      expect(url.searchParams.get('p')).toBeNull();
    };
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      assertAuth(url);
      if (url.pathname === '/rest/ping.view') {
        response.setHeader('Content-Type', 'application/json');
        response.end(envelope({}));
        return;
      }
      if (url.pathname === '/rest/getAlbumList2.view') {
        response.setHeader('Content-Type', 'application/json');
        response.end(envelope({ albumList2: { album: [{ id: 'album-1', name: 'Echo Album' }] } }));
        return;
      }
      if (url.pathname === '/rest/getAlbum.view') {
        response.setHeader('Content-Type', 'application/json');
        response.end(envelope({
          album: {
            id: 'album-1',
            song: [{
              id: 'song-1',
              title: 'Echo Song',
              artist: 'Echo Artist',
              album: 'Echo Album',
              albumArtist: 'Echo Artist',
              duration: 188,
              suffix: 'flac',
              bitRate: 900,
              bitDepth: 24,
              samplingRate: 96000,
              size: 12345,
              coverArt: 'cover-1',
            }],
          },
        }));
        return;
      }
      if (url.pathname === '/rest/stream.view') {
        expect(url.searchParams.get('id')).toBe('song-1');
        response.writeHead(200, {
          'Content-Type': 'audio/flac',
          'Content-Length': String(audio.length),
        });
        response.end(audio);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    const port = await listen(server);
    const adapter = new SubsonicRemoteSourceAdapter();
    const proxy = new RemoteStreamProxyService(() => adapter);
    adapter.setStreamUrlResolver((input) => proxy.createStreamUrl(input.source, input.remotePath, input.stableKey, input.expiresInSeconds));

    const result = await adapter.testConnection({ source: source(port) });
    expect(result.ok).toBe(true);

    const scanned = [];
    for await (const item of adapter.scan({ source: source(port) })) {
      scanned.push(item);
    }
    expect(scanned).toHaveLength(1);
    expect(scanned[0]).toEqual(expect.objectContaining({
      path: 'subsonic:song:song-1',
      stableKey: 'song-1',
      metadata: expect.objectContaining({
        title: 'Echo Song',
        artist: 'Echo Artist',
        duration: 188,
        sampleRate: 96000,
        bitDepth: 24,
        bitrate: 900000,
        fieldSources: expect.objectContaining({
          sampleRate: 'subsonic',
          bitDepth: 'subsonic',
          bitrate: 'subsonic',
        }),
      }),
    }));

    const stream = await adapter.createStreamUrl({ source: source(port), remotePath: 'subsonic:song:song-1', stableKey: 'song-1' });
    expect(stream.url).not.toContain('password');
    const proxied = await fetch(stream.url);
    expect(proxied.status).toBe(200);
    expect(Buffer.from(await proxied.arrayBuffer()).equals(audio)).toBe(true);
    await proxy.close();
  });

  it('fetches album details with bounded concurrency and continues when one album fails', async () => {
    let activeAlbumRequests = 0;
    let maxActiveAlbumRequests = 0;
    const errors: Array<{ path: string; message: string }> = [];
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/rest/ping.view') {
        response.setHeader('Content-Type', 'application/json');
        response.end(envelope({}));
        return;
      }
      if (url.pathname === '/rest/getAlbumList2.view') {
        response.setHeader('Content-Type', 'application/json');
        response.end(envelope({
          albumList2: {
            album: [
              { id: 'album-1', name: 'One' },
              { id: 'album-2', name: 'Two' },
              { id: 'album-3', name: 'Three' },
              { id: 'album-4', name: 'Four' },
            ],
          },
        }));
        return;
      }
      if (url.pathname === '/rest/getAlbum.view') {
        const id = url.searchParams.get('id') ?? '';
        activeAlbumRequests += 1;
        maxActiveAlbumRequests = Math.max(maxActiveAlbumRequests, activeAlbumRequests);
        await new Promise((resolve) => setTimeout(resolve, 25));
        activeAlbumRequests -= 1;

        if (id === 'album-2') {
          response.writeHead(500, { 'Content-Type': 'text/plain' });
          response.end('failed album');
          return;
        }

        response.setHeader('Content-Type', 'application/json');
        response.end(envelope({
          album: {
            id,
            song: [{
              id: `song-${id}`,
              title: `Song ${id}`,
              artist: 'Echo Artist',
              album: `Album ${id}`,
              duration: 120,
            }],
          },
        }));
        return;
      }

      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    const port = await listen(server);
    const adapter = new SubsonicRemoteSourceAdapter();
    const scanSource = {
      ...source(port),
      config: { ...source(port).config, scanConcurrency: 8 },
    };

    const scanned = [];
    for await (const item of adapter.scan({
      source: scanSource,
      onError: (path, error) => errors.push({ path, message: error.message }),
    })) {
      scanned.push(item);
    }

    expect(scanned).toHaveLength(3);
    expect(scanned.map((item) => item.stableKey).sort()).toEqual(['song-album-1', 'song-album-3', 'song-album-4']);
    expect(errors).toEqual([expect.objectContaining({ path: 'subsonic:album:album-2' })]);
    expect(maxActiveAlbumRequests).toBeGreaterThan(1);
    expect(maxActiveAlbumRequests).toBeLessThanOrEqual(4);
  });

  it('requests compressed cover art from Subsonic servers', async () => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/rest/getCoverArt.view') {
        expect(url.searchParams.get('id')).toBe('cover-1');
        expect(url.searchParams.get('size')).toBe('512');
        response.writeHead(200, { 'Content-Type': 'image/jpeg' });
        response.end(Buffer.from([1, 2, 3]));
        return;
      }

      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    const port = await listen(server);
    const adapter = new SubsonicRemoteSourceAdapter();

    const result = await adapter.readCover({
      source: source(port),
      item: {
        sourceId: 'source-subsonic',
        provider: 'subsonic',
        path: 'subsonic:song:song-1',
        name: 'song-1',
        kind: 'file',
        sizeBytes: null,
        modifiedAt: null,
        etag: null,
        contentType: null,
        audio: true,
        remoteUrlHash: 'hash',
        stableKey: 'song-1',
        metadata: {
          status: 'ok',
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          albumArtist: 'Artist',
          trackNo: null,
          discNo: null,
          year: null,
          genre: null,
          duration: 120,
          codec: null,
          sampleRate: null,
          bitDepth: null,
          bitrate: null,
          fieldSources: { coverArt: 'cover-1' },
          warnings: [],
          errors: [],
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(Array.from(result.data ?? [])).toEqual([1, 2, 3]);
  });
});
