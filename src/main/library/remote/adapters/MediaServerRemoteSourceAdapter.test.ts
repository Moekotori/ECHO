import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { JellyfinRemoteSourceAdapter } from './MediaServerRemoteSourceAdapter';
import { RemoteStreamProxyService } from '../RemoteStreamProxyService';
import type { RemoteSourceSecret } from '../remoteTypes';

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

const parseRequests = (requests: Array<{ parentId: string | null; recursive: string | null; includeItemTypes: string | null }>): string[][] =>
  requests.map((request) => [request.parentId ?? '', request.recursive ?? '', request.includeItemTypes ?? '']);

const source = (port: number, overrides: Partial<RemoteSourceSecret> = {}): RemoteSourceSecret => ({
  id: 'source-jellyfin',
  provider: 'jellyfin',
  displayName: 'Jellyfin',
  status: 'enabled',
  baseUrl: `http://127.0.0.1:${port}`,
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
  secret: 'password',
  ...overrides,
});

describe('MediaServerRemoteSourceAdapter', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await close(server);
    }
  });

  it('authenticates, scans server metadata, and proxies streams without leaking credentials', async () => {
    const audio = Buffer.from('jellyfin-audio');
    let authRequests = 0;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'POST' && url.pathname === '/Users/AuthenticateByName') {
        authRequests += 1;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ AccessToken: 'server-token', User: { Id: 'user-1' } }));
        return;
      }
      if (url.pathname === '/System/Info') {
        expect(request.headers['x-emby-token']).toBe('server-token');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ ServerName: 'Mock Jellyfin' }));
        return;
      }
      if (url.pathname === '/Users/user-1/Views') {
        expect(request.headers['x-emby-token']).toBe('server-token');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ Items: [{ Id: 'library-1', Name: 'Music', CollectionType: 'music' }] }));
        return;
      }
      if (url.pathname === '/Users/user-1/Items') {
        expect(url.searchParams.get('ParentId')).toBe('library-1');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          TotalRecordCount: 1,
          Items: [{
            Id: 'song-1',
            Name: 'Echo Song',
            Album: 'Echo Album',
            AlbumArtist: 'Echo Artist',
            Artists: ['Echo Artist'],
            RunTimeTicks: 1880000000,
            IndexNumber: 3,
            ProductionYear: 2026,
            Genres: ['Pop'],
            Etag: 'etag-song',
            MediaSources: [{ Size: 12345, MediaStreams: [{ Type: 'Audio', Codec: 'flac', SampleRate: 48000, BitDepth: 24, BitRate: 900000 }] }],
          }],
        }));
        return;
      }
      if (url.pathname === '/Audio/song-1/stream') {
        expect(request.headers['x-emby-token']).toBe('server-token');
        response.writeHead(200, {
          'Content-Type': 'audio/flac',
          'Content-Length': String(audio.length),
          'Accept-Ranges': 'bytes',
        });
        response.end(audio);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    const port = await listen(server);
    const adapter = new JellyfinRemoteSourceAdapter();
    const proxy = new RemoteStreamProxyService(() => adapter);
    adapter.setStreamUrlResolver((input) => proxy.createStreamUrl(input.source, input.remotePath, input.stableKey, input.expiresInSeconds));

    const test = await adapter.testConnection({ source: source(port) });
    expect(test.ok).toBe(true);

    const scanned = [];
    for await (const item of adapter.scan({ source: source(port) })) {
      scanned.push(item);
    }
    expect(scanned).toHaveLength(1);
    expect(scanned[0]).toEqual(expect.objectContaining({
      path: 'jellyfin:item:song-1',
      stableKey: 'song-1',
      metadata: expect.objectContaining({ title: 'Echo Song', artist: 'Echo Artist', duration: 188 }),
    }));

    const stream = await adapter.createStreamUrl({ source: source(port), remotePath: 'jellyfin:item:song-1', stableKey: 'song-1' });
    expect(stream.url).not.toContain('server-token');
    expect(stream.url).not.toContain('password');
    const proxied = await fetch(stream.url);
    expect(proxied.status).toBe(200);
    expect(Buffer.from(await proxied.arrayBuffer()).equals(audio)).toBe(true);
    expect(authRequests).toBe(1);
    await proxy.close();
  });

  it('browses media server libraries as nested folders with stable unique paths', async () => {
    const requests: Array<{ parentId: string | null; recursive: string | null; includeItemTypes: string | null }> = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'POST' && url.pathname === '/Users/AuthenticateByName') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ AccessToken: 'server-token', User: { Id: 'user-1' } }));
        return;
      }
      if (url.pathname === '/Users/user-1/Views') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          Items: [
            { Id: 'music-library', Name: '音乐', CollectionType: 'music', Etag: 'music-etag' },
            { Id: 'movies-library', Name: '电影', CollectionType: 'movies' },
          ],
        }));
        return;
      }
      if (url.pathname === '/Users/user-1/Items') {
        const parentId = url.searchParams.get('ParentId');
        requests.push({
          parentId,
          recursive: url.searchParams.get('Recursive'),
          includeItemTypes: url.searchParams.get('IncludeItemTypes'),
        });
        response.setHeader('Content-Type', 'application/json');
        if (parentId === 'music-library') {
          response.end(JSON.stringify({
            TotalRecordCount: 2,
            Items: [
              { Id: 'single-folder', Name: '单曲', Type: 'Folder', Etag: 'single-etag' },
              { Id: 'album-folder', Name: '专辑', Type: 'Folder', Etag: 'album-etag' },
            ],
          }));
          return;
        }
        if (parentId === 'single-folder') {
          response.end(JSON.stringify({
            TotalRecordCount: 2,
            Items: [
              { Id: 'chinese-folder', Name: '中文', Type: 'Folder', Etag: 'chinese-etag' },
              { Id: 'anime-nested-folder', Name: '动漫', Type: 'Folder', Etag: 'anime-nested-etag' },
            ],
          }));
          return;
        }
        if (parentId === 'anime-nested-folder') {
          response.end(JSON.stringify({
            TotalRecordCount: 1,
            Items: [
              {
                Id: 'song-1',
                Name: 'Echo Song',
                Type: 'Audio',
                RunTimeTicks: 1880000000,
                MediaSources: [{ Size: 12345 }],
              },
            ],
          }));
          return;
        }
        response.end(JSON.stringify({ TotalRecordCount: 0, Items: [] }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    const port = await listen(server);
    const adapter = new JellyfinRemoteSourceAdapter();
    const remoteSource = source(port);

    const rootItems = await adapter.browse({ source: remoteSource });
    expect(rootItems).toEqual([
      expect.objectContaining({
        path: 'jellyfin:library:music-library',
        name: '音乐',
        kind: 'directory',
      }),
    ]);

    const musicItems = await adapter.browse({ source: remoteSource, path: rootItems[0]!.path });
    expect(musicItems.map((item) => [item.name, item.path])).toEqual([
      ['单曲', 'jellyfin:library:music-library/jellyfin:folder:single-folder'],
      ['专辑', 'jellyfin:library:music-library/jellyfin:folder:album-folder'],
    ]);

    const singleItems = await adapter.browse({ source: remoteSource, path: musicItems[0]!.path });
    expect(singleItems.map((item) => [item.name, item.path])).toEqual([
      ['中文', 'jellyfin:library:music-library/jellyfin:folder:single-folder/jellyfin:folder:chinese-folder'],
      ['动漫', 'jellyfin:library:music-library/jellyfin:folder:single-folder/jellyfin:folder:anime-nested-folder'],
    ]);

    const animeItems = await adapter.browse({ source: remoteSource, path: singleItems[1]!.path });
    expect(animeItems).toEqual([
      expect.objectContaining({
        path: 'jellyfin:library:music-library/jellyfin:folder:single-folder/jellyfin:folder:anime-nested-folder/jellyfin:item:song-1',
        name: 'Echo Song',
        kind: 'file',
        audio: true,
      }),
    ]);
    expect(parseRequests(requests)).toEqual([
      ['music-library', 'false', 'Audio,Folder,CollectionFolder'],
      ['single-folder', 'false', 'Audio,Folder,CollectionFolder'],
      ['anime-nested-folder', 'false', 'Audio,Folder,CollectionFolder'],
    ]);
  });

  it('coalesces login and caps concurrent cover requests for media servers', async () => {
    let authRequests = 0;
    let activeCoverRequests = 0;
    let maxActiveCoverRequests = 0;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'POST' && url.pathname === '/Users/AuthenticateByName') {
        authRequests += 1;
        setTimeout(() => {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ AccessToken: 'server-token', User: { Id: 'user-1' } }));
        }, 5);
        return;
      }
      if (url.pathname.startsWith('/Items/song-') && url.pathname.endsWith('/Images/Primary')) {
        activeCoverRequests += 1;
        maxActiveCoverRequests = Math.max(maxActiveCoverRequests, activeCoverRequests);
        setTimeout(() => {
          activeCoverRequests -= 1;
          response.writeHead(200, { 'Content-Type': 'image/jpeg' });
          response.end(Buffer.from([1, 2, 3]));
        }, 10);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    const port = await listen(server);
    const adapter = new JellyfinRemoteSourceAdapter();
    const remoteSource = source(port);

    await Promise.all(Array.from({ length: 12 }, (_value, index) =>
      adapter.readCover({
        source: remoteSource,
        item: {
          sourceId: remoteSource.id,
          provider: 'jellyfin',
          path: `jellyfin:item:song-${index}`,
          name: `song-${index}`,
          kind: 'file',
          sizeBytes: null,
          modifiedAt: null,
          etag: null,
          contentType: null,
          audio: true,
          remoteUrlHash: '',
          stableKey: `song-${index}`,
        },
      }),
    ));

    expect(authRequests).toBe(1);
    expect(maxActiveCoverRequests).toBeLessThanOrEqual(32);
  });

  it('supports API key authentication without username/password login', async () => {
    const server = createServer((request, response) => {
      expect(request.headers['x-emby-token']).toBe('api-key');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ServerName: 'Mock Jellyfin' }));
    });
    servers.push(server);
    const port = await listen(server);
    const adapter = new JellyfinRemoteSourceAdapter();

    const result = await adapter.testConnection({
      source: source(port, { username: null, authType: 'apiKey', secret: 'api-key' }),
    });

    expect(result.ok).toBe(true);
  });
});
