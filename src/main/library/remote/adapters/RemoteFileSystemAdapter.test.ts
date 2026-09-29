import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoteStreamProxyService } from '../RemoteStreamProxyService';
import type { RemoteSourceSecret } from '../remoteTypes';
import { RemoteFileSystemAdapter } from './RemoteFileSystemAdapter';

const tempRoots: string[] = [];

const makeRoot = async (): Promise<string> => {
  const root = join(tmpdir(), `echo-next-remote-fs-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const source = (root: string): RemoteSourceSecret => ({
  id: 'source-smb',
  provider: 'smb',
  displayName: 'NAS',
  status: 'enabled',
  baseUrl: root,
  username: null,
  authType: 'none',
  config: { rootPath: '/', accessMode: 'mounted' },
  syncMode: 'index',
  lastTestAt: null,
  lastSyncAt: null,
  lastError: null,
  indexedTrackCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  secret: null,
});

describe('RemoteFileSystemAdapter', () => {
  afterEach(async () => {
    for (const root of tempRoots.splice(0)) {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('scans mounted folders, skips non-audio, and creates stable keys from fingerprints', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'Album'), { recursive: true });
    const songPath = join(root, 'Album', 'Echo Song.flac');
    await writeFile(songPath, Buffer.from('fake flac data'));
    await writeFile(join(root, 'Album', 'Odd Track.wv'), Buffer.from('fake wavpack data'));
    await writeFile(join(root, 'Album', 'notes.txt'), 'not music');
    const adapter = new RemoteFileSystemAdapter('smb');

    const test = await adapter.testConnection({ source: source(root) });
    expect(test.ok).toBe(true);

    const browsed = await adapter.browse({ source: source(root), path: '/' });
    expect(browsed).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/Album/', kind: 'directory' })]));

    const scanned = [];
    for await (const item of adapter.scan({ source: source(root) })) {
      scanned.push(item);
    }

    expect(scanned.map((item) => item.path).sort()).toEqual(['/Album/Echo Song.flac', '/Album/Odd Track.wv']);
    const song = scanned.find((item) => item.path === '/Album/Echo Song.flac');
    expect(song).toEqual(expect.objectContaining({
      path: '/Album/Echo Song.flac',
      audio: true,
      stableKey: expect.any(String),
    }));
    const firstStableKey = song!.stableKey;

    const rescanned = [];
    for await (const item of adapter.scan({ source: source(root) })) {
      rescanned.push(item);
    }
    expect(rescanned.find((item) => item.path === '/Album/Echo Song.flac')?.stableKey).toBe(firstStableKey);

    await writeFile(songPath, Buffer.from('fake flac data changed'));
    const changed = [];
    for await (const item of adapter.scan({ source: source(root) })) {
      changed.push(item);
    }
    expect(changed.find((item) => item.path === '/Album/Echo Song.flac')?.stableKey).not.toBe(firstStableKey);

    const metadata = await adapter.readMetadata({ source: source(root), item: song! });
    expect(metadata.status).toBe('partial');
    expect(metadata.title).toBe('Echo Song');
  });

  it('proxies mounted files with HEAD, GET, Range, and 416 without leaking paths', async () => {
    const root = await makeRoot();
    const audio = Buffer.from('0123456789abcdef');
    await writeFile(join(root, 'song.mp3'), audio);
    const adapter = new RemoteFileSystemAdapter('smb');
    const proxy = new RemoteStreamProxyService(() => adapter);
    adapter.setStreamUrlResolver((input) => proxy.createStreamUrl(input.source, input.remotePath, input.stableKey, input.expiresInSeconds));

    const stream = await adapter.createStreamUrl({ source: source(root), remotePath: '/song.mp3', stableKey: 'stable-1' });
    expect(stream.url).not.toContain(root);
    expect(stream.url).not.toContain('song.mp3');

    const head = await fetch(stream.url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(audio.length));
    expect(head.headers.get('accept-ranges')).toBe('bytes');

    const full = await fetch(stream.url);
    expect(full.status).toBe(200);
    expect(Buffer.from(await full.arrayBuffer()).equals(audio)).toBe(true);

    const partial = await fetch(stream.url, { headers: { Range: 'bytes=2-5' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 2-5/${audio.length}`);
    expect(Buffer.from(await partial.arrayBuffer()).toString('utf8')).toBe('2345');

    const suffix = await fetch(stream.url, { headers: { Range: 'bytes=-4' } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('content-range')).toBe(`bytes 12-15/${audio.length}`);
    expect(Buffer.from(await suffix.arrayBuffer()).toString('utf8')).toBe('cdef');

    const unsatisfied = await fetch(stream.url, { headers: { Range: 'bytes=999-1000' } });
    expect(unsatisfied.status).toBe(416);
    expect(unsatisfied.headers.get('content-range')).toBe(`bytes */${audio.length}`);

    await proxy.close();

    const fileStat = await stat(join(root, 'song.mp3'));
    expect(fileStat.isFile()).toBe(true);
  });
});
