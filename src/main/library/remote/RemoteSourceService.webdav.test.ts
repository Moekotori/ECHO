import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type EchoDatabase } from '../../database/createDatabase';
import { LibraryStore } from '../LibraryStore';
import { RemoteSourceService } from './RemoteSourceService';

vi.mock('electron', () => ({
  default: {},
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

const audioBytes = Buffer.from('0123456789abcdef');
const rootPath = '/音乐 Space/';
const trackPath = `${rootPath}会魔法的老人.mp3`;
const username = 'echo-user';
const password = 'echo-secret';
const authHeader = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

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

const encodeHref = (path: string): string => `/dav${path.split('/').map((part) => encodeURIComponent(part)).join('/')}`;

const xmlResponse = (href: string, collection: boolean, size = audioBytes.length): string => `
  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        ${collection ? '<d:resourcetype><d:collection /></d:resourcetype>' : '<d:resourcetype />'}
        <d:getcontentlength>${size}</d:getcontentlength>
        <d:getlastmodified>Thu, 01 Jan 2026 00:00:00 GMT</d:getlastmodified>
        <d:getetag>"etag-${size}"</d:getetag>
        <d:getcontenttype>${collection ? 'httpd/unix-directory' : 'audio/mpeg'}</d:getcontenttype>
      </d:prop>
    </d:propstat>
  </d:response>`;

const xml = (responses: string[]): string => `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses.join('')}</d:multistatus>`;

const requestPath = (request: IncomingMessage): string => {
  const url = request.url ?? '/';
  return decodeURIComponent(url.split('?')[0].replace(/^\/dav/u, '') || '/');
};

const writeAudio = (request: IncomingMessage, response: ServerResponse): void => {
  if (request.headers.authorization !== authHeader) {
    response.writeHead(401);
    response.end();
    return;
  }

  response.setHeader('Content-Type', 'audio/mpeg');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('ETag', '"track"');

  const range = request.headers.range;
  if (typeof range === 'string') {
    const match = range.match(/^bytes=(\d+)-(\d+)$/u);
    const start = match ? Number(match[1]) : 0;
    const end = match ? Math.min(Number(match[2]), audioBytes.length - 1) : audioBytes.length - 1;
    const chunk = audioBytes.subarray(start, end + 1);
    response.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${audioBytes.length}`,
      'Content-Length': String(chunk.length),
    });
    response.end(request.method === 'HEAD' ? undefined : chunk);
    return;
  }

  response.writeHead(200, { 'Content-Length': String(audioBytes.length) });
  response.end(request.method === 'HEAD' ? undefined : audioBytes);
};

const makeWebDavServer = (state: { includeTrack: boolean }): Server =>
  createServer((request, response) => {
    if (request.headers.authorization !== authHeader) {
      response.writeHead(401);
      response.end();
      return;
    }

    if (request.method === 'PROPFIND') {
      const path = requestPath(request);
      if (path !== rootPath && path !== rootPath.replace(/\/$/u, '')) {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('missing');
        return;
      }

      response.writeHead(207, { 'Content-Type': 'application/xml' });
      response.end(xml([
        xmlResponse(encodeHref(rootPath), true),
        ...(state.includeTrack ? [xmlResponse(encodeHref(trackPath), false)] : []),
      ]));
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && requestPath(request) === trackPath) {
      writeAudio(request, response);
      return;
    }

    response.writeHead(404);
    response.end();
  });

const waitForSync = async (service: RemoteSourceService, sourceId: string): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    const status = service.getSyncStatus(sourceId);
    if (status.status === 'completed') {
      return;
    }
    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new Error(`sync ${status.status}: ${status.errors.join(', ')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for WebDAV sync');
};

const waitForJobAttempt = async (service: RemoteSourceService, sourceId: string, kind: 'metadata' | 'cover'): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    const status = service.getJobStatus(sourceId);
    if (
      status.pending[kind] > 0 ||
      status.running[kind] > 0 ||
      status.completed[kind] > 0 ||
      status.failed[kind] > 0 ||
      status.skipped[kind] > 0
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for ${kind} job`);
};

describe('RemoteSourceService WebDAV integration', () => {
  const servers: Server[] = [];
  let database: EchoDatabase | null = null;
  let service: RemoteSourceService | null = null;

  afterEach(async () => {
    service?.close();
    service = null;
    database = null;
    for (const server of servers.splice(0)) {
      await close(server);
    }
  });

  it('tests, syncs, exposes library tracks, proxies playback, and deletes a WebDAV source without real cloud credentials', async () => {
    const state = { includeTrack: true };
    const server = makeWebDavServer(state);
    servers.push(server);
    const port = await listen(server);
    database = createDatabase(':memory:');
    service = new RemoteSourceService(database, () => database?.close());
    const libraryStore = new LibraryStore(database);

    const source = service.createSource({
      provider: 'webdav',
      displayName: 'Mock AList',
      baseUrl: `http://127.0.0.1:${port}/dav`,
      username,
      secret: password,
      authType: 'basic',
      config: { rootPath, scanConcurrency: 2, metadataConcurrency: 1 },
      syncMode: 'index',
    });

    await expect(service.testSource(source.id)).resolves.toMatchObject({ ok: true, status: 'enabled' });
    await expect(service.browse(source.id)).resolves.toEqual([
      expect.objectContaining({ path: trackPath, kind: 'file', audio: true, name: '会魔法的老人.mp3' }),
    ]);

    service.syncSource(source.id);
    await waitForSync(service, source.id);
    await waitForJobAttempt(service, source.id, 'metadata');
    await waitForJobAttempt(service, source.id, 'cover');

    const tracks = libraryStore.getTracks({ search: 'mofa' });
    expect(tracks.total).toBe(1);
    expect(libraryStore.getTracks({ search: '魔法' }).total).toBe(1);
    expect(libraryStore.getTracks({ sourceProvider: 'remote', sourceId: source.id }).total).toBe(1);
    expect(service.listIndexedTracks(source.id, rootPath)).toEqual([
      expect.objectContaining({
        id: tracks.items[0].id,
        mediaType: 'remote',
        remotePath: trackPath,
      }),
    ]);
    expect(service.getIndexedFolderStats(source.id, rootPath)).toMatchObject({
      sourceId: source.id,
      rootPath,
      trackCount: 1,
      totalSizeBytes: audioBytes.length,
    });
    expect(service.listIndexedTracksPage(source.id, { rootPath, page: 1, pageSize: 1 })).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      hasMore: false,
      items: [expect.objectContaining({ id: tracks.items[0].id, mediaType: 'remote' })],
    });
    const restartedService = new RemoteSourceService(database, () => undefined);
    try {
      expect(restartedService.listIndexedTracksPage(source.id, { rootPath, page: 1, pageSize: 1 })).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ remotePath: trackPath })],
      });
      expect(restartedService.getIndexedFolderStats(source.id, rootPath)).toMatchObject({ trackCount: 1 });
    } finally {
      restartedService.close();
    }
    expect(tracks.items[0]).toEqual(expect.objectContaining({
      mediaType: 'remote',
      provider: 'webdav',
      sourceId: source.id,
      sourceDisplayName: 'Mock AList',
      remotePath: trackPath,
      title: '会魔法的老人',
    }));

    await expect(service.hydrateVisibleTracks(['local-track-id', tracks.items[0].id], { metadata: false, cover: false })).resolves.toEqual([
      expect.objectContaining({ id: tracks.items[0].id, mediaType: 'remote' }),
    ]);

    expect(service.lookupTracks(source.id, [trackPath, '/音乐 Space/missing.flac', trackPath])).toEqual([
      expect.objectContaining({
        trackId: tracks.items[0].id,
        sourceId: source.id,
        remotePath: trackPath,
        title: '会魔法的老人',
        metadataStatus: expect.any(String),
        availability: 'available',
      }),
    ]);
    expect(service.lookupTracks(source.id, [])).toEqual([]);

    const otherSource = service.createSource({
      provider: 'webdav',
      displayName: 'Other AList',
      baseUrl: `http://127.0.0.1:${port}/dav`,
      username,
      secret: password,
      authType: 'basic',
      config: { rootPath, scanConcurrency: 2, metadataConcurrency: 1 },
      syncMode: 'index',
    });
    expect(service.lookupTracks(otherSource.id, [trackPath])).toEqual([]);

    database.prepare("UPDATE remote_tracks SET metadata_status = 'error', cover_status = 'error', lyrics_status = 'not_found' WHERE source_id = ?").run(source.id);
    expect(service.getOverview(source.id)).toMatchObject({
      totalSources: 1,
      enabledSources: 1,
      trackCount: 1,
      totalSizeBytes: audioBytes.length,
      missingTrackCount: 0,
      sources: [
        expect.objectContaining({
          sourceId: source.id,
          trackCount: 1,
          totalSizeBytes: audioBytes.length,
          metadata: expect.objectContaining({ error: 1 }),
          cover: expect.objectContaining({ error: 1 }),
          lyrics: expect.objectContaining({ not_found: 1 }),
        }),
      ],
    });
    expect(service.listIssues(source.id, 'metadata', 10)).toEqual([
      expect.objectContaining({
        kind: 'metadata',
        status: 'error',
        remotePath: trackPath,
      }),
    ]);

    const stream = await service.createStreamUrl({ trackId: tracks.items[0].id });
    expect(stream.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/remote-stream\//u);
    expect(stream.url).not.toContain(username);
    expect(stream.url).not.toContain(password);

    const head = await fetch(stream.url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('accept-ranges')).toBe('bytes');

    const partial = await fetch(stream.url, { headers: { Range: 'bytes=2-5' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 2-5/${audioBytes.length}`);
    expect(Buffer.from(await partial.arrayBuffer()).toString('utf8')).toBe('2345');

    state.includeTrack = false;
    service.syncSource(source.id);
    await waitForSync(service, source.id);
    expect(libraryStore.getTracks({ search: 'mofa' }).total).toBe(0);
    expect(service.getOverview(source.id)).toMatchObject({ trackCount: 0, missingTrackCount: 1 });
    expect(service.listIssues(source.id, 'missing', 10)).toEqual([
      expect.objectContaining({ kind: 'missing', status: 'missing', remotePath: trackPath }),
    ]);

    service.deleteSource(source.id);
    expect(libraryStore.getTracks({ search: 'mofa' }).total).toBe(0);
    expect(service.listSources()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: source.id }),
    ]));
    expect(await fetch(stream.url)).toMatchObject({ status: 401 });
  });

  it('can sync only the browsed WebDAV directory without marking the rest of the source missing', async () => {
    const scopedDir = `${rootPath}Scoped/`;
    const otherDir = `${rootPath}Other/`;
    const scopedTrack = `${scopedDir}scoped.mp3`;
    const otherTrack = `${otherDir}other.mp3`;
    const state = { includeScoped: true, includeOther: true };
    const server = createServer((request, response) => {
      if (request.headers.authorization !== authHeader) {
        response.writeHead(401);
        response.end();
        return;
      }

      if (request.method === 'PROPFIND') {
        const path = requestPath(request);
        response.writeHead(207, { 'Content-Type': 'application/xml' });
        if (path === rootPath || path === rootPath.replace(/\/$/u, '')) {
          response.end(xml([
            xmlResponse(encodeHref(rootPath), true),
            xmlResponse(encodeHref(scopedDir), true),
            xmlResponse(encodeHref(otherDir), true),
          ]));
          return;
        }
        if (path === scopedDir || path === scopedDir.replace(/\/$/u, '')) {
          response.end(xml([
            xmlResponse(encodeHref(scopedDir), true),
            ...(state.includeScoped ? [xmlResponse(encodeHref(scopedTrack), false)] : []),
          ]));
          return;
        }
        if (path === otherDir || path === otherDir.replace(/\/$/u, '')) {
          response.end(xml([
            xmlResponse(encodeHref(otherDir), true),
            ...(state.includeOther ? [xmlResponse(encodeHref(otherTrack), false)] : []),
          ]));
          return;
        }

        response.writeHead(404);
        response.end('missing');
        return;
      }

      if ((request.method === 'GET' || request.method === 'HEAD') && [scopedTrack, otherTrack].includes(requestPath(request))) {
        writeAudio(request, response);
        return;
      }

      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    const port = await listen(server);
    database = createDatabase(':memory:');
    service = new RemoteSourceService(database, () => database?.close());
    const libraryStore = new LibraryStore(database);
    const source = service.createSource({
      provider: 'webdav',
      displayName: 'Scoped AList',
      baseUrl: `http://127.0.0.1:${port}/dav`,
      username,
      secret: password,
      authType: 'basic',
      config: { rootPath, scanConcurrency: 2, metadataConcurrency: 1 },
      syncMode: 'index',
    });

    service.syncSource(source.id, { includeCover: false });
    await waitForSync(service, source.id);
    expect(libraryStore.getTracks({ sourceProvider: 'remote', sourceId: source.id }).total).toBe(2);
    expect(service.listIndexedTracksPage(source.id, { rootPath, page: 1, pageSize: 1 })).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      hasMore: true,
    });

    state.includeScoped = false;
    service.syncSource(source.id, { rootPath: scopedDir, markMissing: false, includeCover: false });
    await waitForSync(service, source.id);

    const tracks = libraryStore.getTracks({ sourceProvider: 'remote', sourceId: source.id });
    expect(tracks.total).toBe(2);
    expect(service.listIndexedTracks(source.id, scopedDir)).toEqual([
      expect.objectContaining({ remotePath: scopedTrack }),
    ]);
    expect(service.getIndexedFolderStats(source.id, scopedDir)).toMatchObject({
      sourceId: source.id,
      rootPath: scopedDir,
      trackCount: 1,
      totalSizeBytes: audioBytes.length,
    });
    expect(service.listIndexedTracksPage(source.id, { rootPath: scopedDir, page: 1, pageSize: 1 })).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      hasMore: false,
      items: [expect.objectContaining({ remotePath: scopedTrack })],
    });
    expect(service.getOverview(source.id)).toMatchObject({ trackCount: 2, missingTrackCount: 0 });
  });
});
