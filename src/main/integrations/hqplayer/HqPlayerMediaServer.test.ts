import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HqPlayerMediaServer } from './HqPlayerMediaServer';

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

const close = async (server: Server | null): Promise<void> => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
};

describe('HqPlayerMediaServer', () => {
  let server: HqPlayerMediaServer;
  let root: string;
  let backend: Server | null;

  beforeEach(async () => {
    server = new HqPlayerMediaServer();
    root = await mkdtemp(join(tmpdir(), 'echo-next-hqplayer-media-'));
    backend = null;
  });

  afterEach(async () => {
    await server.close();
    await close(backend);
    await rm(root, { force: true, recursive: true });
  });

  it('serves a tokenized local file with HEAD, GET, and Range support', async () => {
    const filePath = join(root, 'song.flac');
    await writeFile(filePath, audioBytes);

    const served = await server.createUrl(
      { url: filePath, mimeType: 'audio/flac' },
      { port: null, remoteAccess: false },
    );

    expect(served.url).toContain('/hqplayer-media/');
    expect(served.url).not.toContain('song.flac');
    expect(served).toMatchObject({
      port: expect.any(Number),
      bindHost: '127.0.0.1',
      publicHost: '127.0.0.1',
      remoteAccess: false,
      publicHostCandidates: ['127.0.0.1'],
    });

    const head = await fetch(served.url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('audio/flac');
    expect(head.headers.get('accept-ranges')).toBe('bytes');
    expect(head.headers.get('content-length')).toBe(String(audioBytes.length));

    const partial = await fetch(served.url, { headers: { Range: 'bytes=2-5' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 2-5/${audioBytes.length}`);
    expect(Buffer.from(await partial.arrayBuffer()).toString('utf8')).toBe('2345');
  });

  it('forwards HTTP sources with private headers hidden behind the token URL', async () => {
    let receivedAuthorization: string | undefined;
    backend = createServer((request: IncomingMessage, response: ServerResponse) => {
      receivedAuthorization = request.headers.authorization;
      response.writeHead(200, {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(audioBytes.length),
        'Content-Type': 'audio/mpeg',
      });
      if (request.method !== 'HEAD') {
        response.end(audioBytes);
      } else {
        response.end();
      }
    });
    const port = await listen(backend);

    const served = await server.createUrl(
      {
        url: `http://127.0.0.1:${port}/song.mp3`,
        headers: { Authorization: 'Bearer secret-token' },
        mimeType: 'audio/mpeg',
      },
      { port: null, remoteAccess: false },
    );

    expect(served.url).not.toContain('secret-token');

    const response = await fetch(served.url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(audioBytes)).toBe(true);
    expect(receivedAuthorization).toBe('Bearer secret-token');
  });

  it('reports the public host selected for remote HQPlayer media URLs', async () => {
    const filePath = join(root, 'remote-song.flac');
    await writeFile(filePath, audioBytes);

    const served = await server.createUrl(
      { url: filePath, mimeType: 'audio/flac' },
      { port: null, remoteAccess: true, preferredRemoteHost: '127.0.0.1' },
    );

    expect(served.url).toContain(`:${served.port}/hqplayer-media/`);
    expect(served).toMatchObject({
      port: expect.any(Number),
      bindHost: '0.0.0.0',
      publicHost: expect.any(String),
      remoteAccess: true,
      publicHostCandidates: expect.any(Array),
    });
  });
});
