import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type EchoDatabase } from '../../database/createDatabase';
import { LibraryStore } from '../LibraryStore';
import { RemoteSourceService } from './RemoteSourceService';
import { remoteTrackIdFor } from './remoteIdentity';

const serviceMocks = vi.hoisted(() => ({
  getLyricsForTrack: vi.fn(),
  searchNetworkCandidates: vi.fn(),
}));

vi.mock('electron', () => ({
  default: {},
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

vi.mock('../../lyrics/LyricsService', () => ({
  getLyricsService: () => ({
    getLyricsForTrack: serviceMocks.getLyricsForTrack,
  }),
}));

vi.mock('../../mv/MvService', () => ({
  getMvService: () => ({
    searchNetworkCandidates: serviceMocks.searchNetworkCandidates,
  }),
}));

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
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

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

  throw new Error('Timed out waiting for Subsonic sync');
};

const waitForMatchJobs = async (service: RemoteSourceService, sourceId: string): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    const status = service.getJobStatus(sourceId);
    if (status.completed.lyrics === 1) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for Subsonic match jobs');
};

describe('RemoteSourceService Subsonic integration', () => {
  const servers: Server[] = [];
  const tempDirs: string[] = [];
  let database: EchoDatabase | null = null;
  let service: RemoteSourceService | null = null;

  afterEach(async () => {
    service?.close();
    service = null;
    database = null;
    serviceMocks.getLyricsForTrack.mockReset();
    serviceMocks.searchNetworkCandidates.mockReset();
    for (const server of servers.splice(0)) {
      await close(server);
    }
    for (const tempDir of tempDirs.splice(0)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('indexes Subsonic tracks, exposes remote albums/artists, and keeps MV out of remote background matching', async () => {
    serviceMocks.getLyricsForTrack.mockResolvedValue({ id: 'lyrics-1' });
    serviceMocks.searchNetworkCandidates.mockResolvedValue([{ id: 'mv-1' }]);
    let coverRequests = 0;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const salt = url.searchParams.get('s') ?? '';
      expect(url.searchParams.get('u')).toBe('user');
      expect(url.searchParams.get('t')).toBe(md5(`password${salt}`));
      expect(url.searchParams.get('p')).toBeNull();

      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/rest/ping.view') {
        response.end(envelope({}));
        return;
      }
      if (url.pathname === '/rest/getAlbumList2.view') {
        response.end(envelope({ albumList2: { album: [{ id: 'album-1', name: 'Echo Album' }] } }));
        return;
      }
      if (url.pathname === '/rest/getAlbum.view') {
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
              coverArt: 'cover-1',
            }],
          },
        }));
        return;
      }
      if (url.pathname === '/rest/getCoverArt.view') {
        coverRequests += 1;
        expect(url.searchParams.get('id')).toBe('cover-1');
        expect(url.searchParams.get('size')).toBe('512');
        response.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': String(tinyPng.length),
        });
        response.end(tinyPng);
        return;
      }

      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    const port = await listen(server);
    const coverCacheDir = await mkdtemp(join(tmpdir(), 'echo-remote-cover-'));
    tempDirs.push(coverCacheDir);
    database = createDatabase(':memory:');
    service = new RemoteSourceService(database, () => database?.close(), coverCacheDir);
    const libraryStore = new LibraryStore(database);

    const source = service.createSource({
      provider: 'subsonic',
      displayName: 'Navidrome',
      baseUrl: `http://127.0.0.1:${port}`,
      username: 'user',
      secret: 'password',
      authType: 'basic',
      config: { apiVersion: '1.16.1', authMode: 'token' },
      syncMode: 'index',
    });

    service.syncSource(source.id);
    await waitForSync(service, source.id);

    const trackId = remoteTrackIdFor(source.id, 'song-1');
    expect(service.getJobStatus(source.id).completed.cover).toBe(0);

    const hydrated = await service.hydrateVisibleTracks([trackId], { metadata: false, cover: true, immediateCover: true });
    expect(hydrated[0]).toEqual(expect.objectContaining({
      coverThumb: `echo-image://subsonic-cover/${encodeURIComponent(trackId)}?size=512`,
      metadataStatus: 'ok',
    }));
    expect(coverRequests).toBe(0);

    const track = service.getTrackAsLibraryTrack(trackId);
    expect(track).toEqual(expect.objectContaining({
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      albumArtist: 'Echo Artist',
      sampleRate: 96000,
      bitDepth: 24,
      bitrate: 900000,
      coverThumb: `echo-image://subsonic-cover/${encodeURIComponent(trackId)}?size=512`,
      metadataStatus: 'ok',
    }));
    expect(libraryStore.getTracks({ sourceProvider: 'remote', sourceId: source.id }).items[0]).toEqual(expect.objectContaining({
      coverThumb: `echo-image://subsonic-cover/${encodeURIComponent(trackId)}?size=512`,
    }));
    const remoteCover = await service.readRemoteCover(trackId);
    expect(remoteCover.status).toBe('ok');
    expect(Array.from(remoteCover.data ?? [])).toEqual(Array.from(tinyPng));
    expect(remoteCover.mimeType).toBe('image/png');
    expect(coverRequests).toBe(1);
    const albums = libraryStore.getAlbums({ search: 'Echo Album' });
    expect(albums.items).toHaveLength(1);
    expect(albums.items[0]).toEqual(expect.objectContaining({
      mediaType: 'remote',
      sourceId: source.id,
      provider: 'subsonic',
      title: 'Echo Album',
      albumArtist: 'Echo Artist',
      trackCount: 1,
    }));
    expect(libraryStore.getAlbumTracks(albums.items[0].id).items.map((item) => item.id)).toEqual([trackId]);

    const artists = libraryStore.getArtists({ search: 'Echo Artist' });
    expect(artists.items).toHaveLength(1);
    expect(artists.items[0]).toEqual(expect.objectContaining({
      mediaType: 'remote',
      sourceId: source.id,
      provider: 'subsonic',
      name: 'Echo Artist',
      trackCount: 1,
      albumCount: 1,
    }));
    expect(libraryStore.getArtistTracks(artists.items[0].id).items.map((item) => item.id)).toEqual([trackId]);
    expect(libraryStore.getArtistAlbums(artists.items[0].id).items.map((item) => item.id)).toEqual([albums.items[0].id]);

    const jobStatusAfterVisibleHydration = service.getJobStatus(source.id);
    expect(jobStatusAfterVisibleHydration.completed.cover).toBe(0);
    expect(jobStatusAfterVisibleHydration.completed.lyrics).toBe(0);
    expect(jobStatusAfterVisibleHydration.completed.mv).toBe(0);
    expect(serviceMocks.getLyricsForTrack).not.toHaveBeenCalled();
    expect(serviceMocks.searchNetworkCandidates).not.toHaveBeenCalled();

    service.startBackgroundJobs(source.id, ['lyrics', 'mv']);
    await waitForMatchJobs(service, source.id);
    expect(serviceMocks.getLyricsForTrack).toHaveBeenCalledWith(trackId);
    expect(serviceMocks.searchNetworkCandidates).not.toHaveBeenCalled();
    expect(service.getJobStatus(source.id).completed.mv).toBe(0);
  });
});
