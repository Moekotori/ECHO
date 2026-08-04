import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handleMock = vi.fn();
const tempRoots: string[] = [];

vi.mock('electron', () => ({
  protocol: {
    handle: handleMock,
  },
}));

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-audio-protocol-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('echo-audio protocol', () => {
  beforeEach(async () => {
    vi.resetModules();
    handleMock.mockClear();
    const module = await import('./audioProtocol');
    module.registerAudioProtocolHandler();
  });

  it('serves registered local audio files with byte ranges', async () => {
    const root = makeTempRoot();
    const audioPath = join(root, 'song.mp3');
    writeFileSync(audioPath, 'abcdef');
    const module = await import('./audioProtocol');
    const url = module.createSystemAudioStreamUrl({ url: audioPath, mimeType: 'audio/mpeg' });
    const handler = handleMock.mock.calls[0][1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request(url, { headers: { Range: 'bytes=1-3' } }));

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Content-Range')).toBe('bytes 1-3/6');
    expect(await response.text()).toBe('bcd');
  });

  it('returns 416 for unsatisfiable local audio byte ranges', async () => {
    const root = makeTempRoot();
    const audioPath = join(root, 'song.mp3');
    writeFileSync(audioPath, 'abcdef');
    const module = await import('./audioProtocol');
    const url = module.createSystemAudioStreamUrl({ url: audioPath, mimeType: 'audio/mpeg' });
    const handler = handleMock.mock.calls[0][1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request(url, { headers: { Range: 'bytes=99-120' } }));

    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */6');
  });

  it('serves suffix ranges for local system audio streams', async () => {
    const root = makeTempRoot();
    const audioPath = join(root, 'song.mp3');
    writeFileSync(audioPath, 'abcdef');
    const module = await import('./audioProtocol');
    const url = module.createSystemAudioStreamUrl({ url: audioPath, mimeType: 'audio/mpeg' });
    const handler = handleMock.mock.calls[0][1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request(url, { headers: { Range: 'bytes=-2' } }));

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 4-5/6');
    expect(await response.text()).toBe('ef');
  });

  it('proxies registered remote audio streams with headers and range', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('stream', {
        headers: {
          'Content-Type': 'audio/flac',
          'Content-Length': '6',
        },
      }),
    );
    const module = await import('./audioProtocol');
    const url = module.createSystemAudioStreamUrl({
      url: 'https://cdn.example/song.flac',
      headers: { Authorization: 'Bearer token' },
      mimeType: 'audio/flac',
    });
    const handler = handleMock.mock.calls[0][1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request(url, { headers: { Range: 'bytes=0-4' } }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/flac');
    expect(await response.text()).toBe('stream');
    const fetchOptions = fetchMock.mock.calls[0][1] as { headers: Headers };
    expect(fetchMock.mock.calls[0][0]).toBe('https://cdn.example/song.flac');
    expect(fetchOptions.headers.get('Authorization')).toBe('Bearer token');
    expect(fetchOptions.headers.get('Range')).toBe('bytes=0-4');
  });

  it('drops invalid remote stream header values instead of crashing playback proxy setup', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('stream', {
        headers: {
          'Content-Type': 'audio/mp4',
          'Content-Length': '6',
        },
      }),
    );
    const module = await import('./audioProtocol');
    const url = module.createSystemAudioStreamUrl({
      url: 'https://upos-sz-mirrorcos.bilivideo.com/audio.m4s',
      headers: {
        Authorization: 'Bearer token',
        'X-Bili-Trace': 'edge-存',
      },
      mimeType: 'audio/mp4',
    });
    const handler = handleMock.mock.calls[0][1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request(url, { headers: { Range: 'bytes=0-4' } }));

    expect(response.status).toBe(200);
    const fetchOptions = fetchMock.mock.calls[0][1] as { headers: Headers };
    expect(fetchOptions.headers.get('Authorization')).toBe('Bearer token');
    expect(fetchOptions.headers.get('Range')).toBe('bytes=0-4');
    expect(fetchOptions.headers.get('X-Bili-Trace')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[network] Dropped invalid request header(s) before fetch.',
      expect.objectContaining({
        context: 'audioProtocol:system-stream',
        targetHost: 'upos-sz-mirrorcos.bilivideo.com',
        droppedHeaders: [
          expect.objectContaining({
            headerName: 'X-Bili-Trace',
            reason: 'non_byte_string_header_value',
            sensitive: false,
            codePoint: 23384,
          }),
        ],
      }),
    );
  });
});
