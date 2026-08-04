import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handleMock = vi.fn();
const getVideoFileForProtocolMock = vi.fn();
const getStreamVariantForProtocolMock = vi.fn();
const refreshStreamVariantForProtocolMock = vi.fn();
const getTemporaryStreamVariantForProtocolMock = vi.fn();
const tempRoots: string[] = [];

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: handleMock,
  },
}));

vi.mock('../mv/MvService', () => ({
  getMvService: () => ({
    getVideoFileForProtocol: getVideoFileForProtocolMock,
    getStreamVariantForProtocol: getStreamVariantForProtocolMock,
    refreshStreamVariantForProtocol: refreshStreamVariantForProtocolMock,
    getTemporaryStreamVariantForProtocol: getTemporaryStreamVariantForProtocolMock,
  }),
}));

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-video-protocol-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

describe('echo-video protocol', () => {
  beforeEach(async () => {
    vi.resetModules();
    handleMock.mockClear();
    getVideoFileForProtocolMock.mockReset();
    getStreamVariantForProtocolMock.mockReset();
    refreshStreamVariantForProtocolMock.mockReset();
    getTemporaryStreamVariantForProtocolMock.mockReset();
    const module = await import('./videoProtocol');
    module.registerVideoProtocolHandler();
  });

  it('serves only registered video ids', async () => {
    const root = makeTempRoot();
    const videoPath = join(root, 'Echo Song.mp4');
    writeFileSync(videoPath, 'video');
    getVideoFileForProtocolMock.mockReturnValue({
      id: 'video-1',
      provider: 'local',
      filePath: videoPath,
      url: null,
      mimeType: 'video/mp4',
      playableInApp: true,
    });
    const handler = handleMock.mock.calls[0][1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request('echo-video://mv/video-1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(getVideoFileForProtocolMock).toHaveBeenCalledWith('video-1');
  });

  it('does not allow arbitrary path-shaped urls', async () => {
    const handler = handleMock.mock.calls[0][1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request('echo-video://mv/C:/Users/Moe/video.mp4'));

    expect(response.status).toBe(404);
    expect(getVideoFileForProtocolMock).not.toHaveBeenCalled();
  });

  it('returns a safe 404 for missing videos', async () => {
    getVideoFileForProtocolMock.mockReturnValue(null);
    const handler = handleMock.mock.calls[0][1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request('echo-video://mv/missing-id'));

    expect(response.status).toBe(404);
  });

  it('proxies only registered network stream variants', async () => {
    getStreamVariantForProtocolMock.mockResolvedValue({
      videoId: 'video-1',
      variantId: 'variant-1',
      url: 'https://cdn.example/video.mp4',
      headers: { Referer: 'https://www.bilibili.com/video/BV1echo' },
      mimeType: 'video/mp4',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('stream', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '6',
        },
      }),
    );
    const handler = handleMock.mock.calls.find(([scheme]) => scheme === 'echo-mv')?.[1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request('echo-mv://stream/video-1/variant-1', { headers: { Range: 'bytes=0-3' } }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(await response.text()).toBe('stream');
    expect(getStreamVariantForProtocolMock).toHaveBeenCalledWith('video-1', 'variant-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.example/video.mp4',
      expect.objectContaining({
        redirect: 'follow',
      }),
    );
  });

  it('uses the resolved MV mime type when the upstream stream is octet-stream', async () => {
    getStreamVariantForProtocolMock.mockResolvedValue({
      videoId: 'video-1',
      variantId: 'variant-1',
      url: 'https://cdn.example/video.m4s',
      headers: { Referer: 'https://www.bilibili.com/video/BV1echo' },
      mimeType: 'video/mp4',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('stream', {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '6',
        },
      }),
    );
    const handler = handleMock.mock.calls.find(([scheme]) => scheme === 'echo-mv')?.[1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request('echo-mv://stream/video-1/variant-1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
  });

  it('refreshes and retries registered network streams when an upstream URL expires early', async () => {
    getStreamVariantForProtocolMock.mockResolvedValue({
      videoId: 'video-1',
      variantId: 'variant-1',
      url: 'https://cdn.example/stale.m4s',
      headers: { Referer: 'https://www.bilibili.com/video/BV1echo' },
      mimeType: 'video/mp4',
    });
    refreshStreamVariantForProtocolMock.mockResolvedValue({
      videoId: 'video-1',
      variantId: 'variant-1',
      url: 'https://cdn.example/fresh.m4s',
      headers: { Referer: 'https://www.bilibili.com/video/BV1echo' },
      mimeType: 'video/mp4',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(
        new Response('fresh', {
          status: 206,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': '5',
            'Content-Range': 'bytes 0-4/5',
            'Accept-Ranges': 'bytes',
          },
        }),
      );
    const handler = handleMock.mock.calls.find(([scheme]) => scheme === 'echo-mv')?.[1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request('echo-mv://stream/video-1/variant-1', { headers: { Range: 'bytes=0-4' } }));

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(response.headers.get('Content-Range')).toBe('bytes 0-4/5');
    expect(await response.text()).toBe('fresh');
    expect(refreshStreamVariantForProtocolMock).toHaveBeenCalledWith('video-1', 'variant-1');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://cdn.example/fresh.m4s',
      expect.objectContaining({ redirect: 'follow' }),
    );
  });

  it('refreshes and retries registered network streams when the upstream fetch throws', async () => {
    getStreamVariantForProtocolMock.mockResolvedValue({
      videoId: 'video-1',
      variantId: 'variant-1',
      url: 'https://cdn.example/stale.mp4',
      headers: { Referer: 'https://www.bilibili.com/video/BV1echo' },
      mimeType: 'video/mp4',
    });
    refreshStreamVariantForProtocolMock.mockResolvedValue({
      videoId: 'video-1',
      variantId: 'variant-1',
      url: 'https://cdn.example/fresh.mp4',
      headers: { Referer: 'https://www.bilibili.com/video/BV1echo' },
      mimeType: 'video/mp4',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('network failed'))
      .mockResolvedValueOnce(
        new Response('fresh', {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': '5',
          },
        }),
      );
    const handler = handleMock.mock.calls.find(([scheme]) => scheme === 'echo-mv')?.[1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request('echo-mv://stream/video-1/variant-1'));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('fresh');
    expect(refreshStreamVariantForProtocolMock).toHaveBeenCalledWith('video-1', 'variant-1');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://cdn.example/fresh.mp4',
      expect.objectContaining({ redirect: 'follow' }),
    );
  });

  it('does not proxy arbitrary network stream paths', async () => {
    const handler = handleMock.mock.calls.find(([scheme]) => scheme === 'echo-mv')?.[1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request('echo-mv://stream/video-1/C:/Users/Moe/video.mp4'));

    expect(response.status).toBe(404);
    expect(getStreamVariantForProtocolMock).not.toHaveBeenCalled();
  });

  it('proxies temporary MV streams without a database video id', async () => {
    getTemporaryStreamVariantForProtocolMock.mockReturnValue({
      videoId: 'ephemeral',
      variantId: 'token-1',
      url: 'https://cdn.example/temporary.mp4',
      headers: { Referer: 'https://www.bilibili.com/video/BV1echo' },
      mimeType: 'video/mp4',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('temp', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '4',
        },
      }),
    );
    const handler = handleMock.mock.calls.find(([scheme]) => scheme === 'echo-mv')?.[1] as (request: Request) => Promise<Response>;

    const response = await handler(new Request('echo-mv://ephemeral/token-1'));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('temp');
    expect(getTemporaryStreamVariantForProtocolMock).toHaveBeenCalledWith('token-1');
    expect(getStreamVariantForProtocolMock).not.toHaveBeenCalled();
  });
});
