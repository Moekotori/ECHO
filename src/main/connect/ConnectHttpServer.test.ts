import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectHttpServer, mimeTypeForAudioPath } from './ConnectHttpServer';

let tempRoot: string;
let server: ConnectHttpServer;

const listen = async (httpServer: Server): Promise<number> => new Promise((resolve, reject) => {
  httpServer.once('error', reject);
  httpServer.listen(0, '127.0.0.1', () => {
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      reject(new Error('server did not bind to a TCP port'));
      return;
    }
    resolve(address.port);
  });
});

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'echo-connect-http-'));
  server = new ConnectHttpServer();
});

afterEach(async () => {
  await server.close();
  rmSync(tempRoot, { force: true, recursive: true });
});

describe('Connect HTTP server', () => {
  it('infers MIME type from URL pathnames with query strings', () => {
    expect(mimeTypeForAudioPath('https://media.example.test/stream/song.flac?token=abc')).toBe('audio/flac');
  });

  it('serves direct audio with byte range support', async () => {
    const audioPath = join(tempRoot, 'range-test.mp3');
    writeFileSync(audioPath, Buffer.from('abcdef', 'utf8'));

    const audio = await server.createAudioUrl(audioPath, { host: '127.0.0.1', audioMimeType: 'audio/x-test' });
    const response = await fetch(audio.url, { headers: { Range: 'bytes=2-4' } });
    const body = Buffer.from(await response.arrayBuffer()).toString('utf8');

    expect(audio.mimeType).toBe('audio/x-test');
    expect(audio.sizeBytes).toBe(6);
    expect(audio.url).toMatch(/\/connect\/audio\/[^/]+\/range-test\.mp3$/u);
    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toContain('audio/x-test');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-range')).toBe('bytes 2-4/6');
    expect(body).toBe('cde');
    expect(server.getDebugEvents()[0]).toMatchObject({
      kind: 'audio',
      statusCode: 206,
      bytes: 3,
      range: 'bytes=2-4',
      message: 'audio/x-test',
    });
  });

  it('serves DLNA-compatible JPEG covers when requested', async () => {
    const coverPath = join(tempRoot, 'cover.svg');
    writeFileSync(coverPath, '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');

    const url = await server.createCoverUrl(coverPath, { host: '127.0.0.1', forceJpegCover: true, mimeType: 'image/svg+xml' });
    const response = await fetch(url);
    const body = Buffer.from(await response.arrayBuffer());

    expect(url).toMatch(/\/connect\/cover\/[^/]+\/cover\.jpg$/u);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/jpeg');
    expect(response.headers.get('contentfeatures.dlna.org')).toContain('JPEG_TN');
    expect(body.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(server.getDebugEvents()[0]).toMatchObject({
      kind: 'cover',
      statusCode: 200,
      message: 'image/jpeg',
    });
  });

  it('returns a cacheable default cover when no local cover exists', async () => {
    const url = await server.createCoverUrl(null, { host: '127.0.0.1' });
    const response = await fetch(url);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    expect(response.headers.get('cache-control')).toContain('max-age=86400');
    expect(body).toContain('<svg');
  });

  it('proxies remote audio through the local DLNA URL with range forwarding', async () => {
    const upstream = createServer((request, response) => {
      expect(request.headers.range).toBe('bytes=1-3');
      response.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Content-Length': '3',
        'Content-Range': 'bytes 1-3/6',
        'Content-Type': 'audio/flac',
      });
      response.end('bcd');
    });
    const upstreamPort = await listen(upstream);

    try {
      const audio = await server.createRemoteAudioUrl(`http://127.0.0.1:${upstreamPort}/remote/song.flac?token=abc`, {
        host: '127.0.0.1',
        audioMimeType: 'application/flac',
      });
      const response = await fetch(audio.url, { headers: { Range: 'bytes=1-3' } });
      const body = await response.text();

      expect(audio.url).toMatch(/\/connect\/audio\/[^/]+\/song\.flac$/u);
      expect(audio.mimeType).toBe('application/flac');
      expect(audio.sizeBytes).toBeNull();
      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe('bytes 1-3/6');
      expect(body).toBe('bcd');
      expect(server.getDebugEvents()[0]).toMatchObject({
        kind: 'audio',
        statusCode: 206,
        range: 'bytes=1-3',
        message: 'remote:audio/flac',
      });
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
