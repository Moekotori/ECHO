import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handleMock = vi.fn();
const registerSchemesAsPrivilegedMock = vi.fn();
const getAppSettingsMock = vi.fn();
const readRemoteCoverMock = vi.fn();
let wallpaperDirectory = '';
let coverCacheDirectory = '';
let userDataPath = '';
const tempRoots: string[] = [];

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
  },
  protocol: {
    registerSchemesAsPrivileged: registerSchemesAsPrivilegedMock,
    handle: handleMock,
  },
}));

vi.mock('../app/appSettings', () => ({
  getAppSettings: getAppSettingsMock,
  getAppWallpaperDirectory: () => wallpaperDirectory,
  getLyricsWallpaperDirectory: () => wallpaperDirectory,
}));

vi.mock('../library/LibraryService', () => ({
  getLibraryService: () => ({
    getCoverCacheDir: () => coverCacheDirectory,
    resolveCoverAsset: vi.fn(),
  }),
}));

vi.mock('../library/remote/RemoteSourceService', () => ({
  getRemoteSourceService: () => ({
    readRemoteCover: readRemoteCoverMock,
  }),
}));

vi.mock('../library/workers/TsCoverExtractor', () => ({
  defaultCoverSvg: '<svg />',
}));

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-wallpaper-protocol-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const getWallpaperHandler = (): ((request: Request) => Promise<Response>) => {
  const call = handleMock.mock.calls.find(([scheme]) => scheme === 'echo-wallpaper');
  return call?.[1] as (request: Request) => Promise<Response>;
};

const getImageHandler = (): ((request: Request) => Promise<Response>) => {
  const call = handleMock.mock.calls.find(([scheme]) => scheme === 'echo-image');
  return call?.[1] as (request: Request) => Promise<Response>;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('echo protocol schemes', () => {
  beforeEach(async () => {
    vi.resetModules();
    registerSchemesAsPrivilegedMock.mockClear();
  });

  it('registers echo-audio as a streaming-capable privileged scheme', async () => {
    const module = await import('./coverProtocol');

    module.registerCoverProtocolScheme();

    expect(registerSchemesAsPrivilegedMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          scheme: 'echo-audio',
          privileges: expect.objectContaining({
            standard: true,
            secure: true,
            supportFetchAPI: true,
            stream: true,
          }),
        }),
      ]),
    );
  });
});

describe('echo-wallpaper protocol', () => {
  beforeEach(async () => {
    vi.resetModules();
    handleMock.mockClear();
    getAppSettingsMock.mockReset();
    readRemoteCoverMock.mockReset();
    wallpaperDirectory = makeTempRoot();
    coverCacheDirectory = join(wallpaperDirectory, 'cover-cache');
    userDataPath = join(wallpaperDirectory, 'user-data');
    const module = await import('./coverProtocol');
    module.registerCoverProtocolHandler();
  });

  it('serves the configured lyrics wallpaper from the app wallpaper directory', async () => {
    const wallpaperPath = join(wallpaperDirectory, 'custom.png');
    writeFileSync(wallpaperPath, 'wallpaper');
    getAppSettingsMock.mockReturnValue({ lyricsCustomWallpaperPath: wallpaperPath });

    const response = await getWallpaperHandler()(new Request('echo-wallpaper://lyrics/custom'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(await response.text()).toBe('wallpaper');
  });

  it('serves the configured app wallpaper from the app wallpaper directory', async () => {
    const wallpaperPath = join(wallpaperDirectory, 'app-wallpaper.webp');
    writeFileSync(wallpaperPath, 'app-wallpaper');
    getAppSettingsMock.mockReturnValue({ appCustomWallpaperPath: wallpaperPath });

    const response = await getWallpaperHandler()(new Request('echo-wallpaper://app/custom'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(await response.text()).toBe('app-wallpaper');
  });

  it('serves the configured portrait app wallpaper separately', async () => {
    const wallpaperPath = join(wallpaperDirectory, 'portrait-wallpaper.webp');
    writeFileSync(wallpaperPath, 'portrait-wallpaper');
    getAppSettingsMock.mockReturnValue({ appCustomWallpaperPath: null, appPortraitWallpaperPath: wallpaperPath });

    const response = await getWallpaperHandler()(new Request('echo-wallpaper://app-portrait/custom'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(await response.text()).toBe('portrait-wallpaper');
  });

  it('serves the configured app video wallpaper with a video content type', async () => {
    const wallpaperPath = join(wallpaperDirectory, 'motion.mp4');
    writeFileSync(wallpaperPath, 'video-wallpaper');
    getAppSettingsMock.mockReturnValue({ appCustomWallpaperPath: wallpaperPath });

    const response = await getWallpaperHandler()(new Request('echo-wallpaper://app/custom'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(await response.text()).toBe('video-wallpaper');
  });

  it('serves portrait app video wallpaper byte ranges for stable looping playback', async () => {
    const wallpaperPath = join(wallpaperDirectory, 'portrait-motion.webm');
    writeFileSync(wallpaperPath, 'portrait-video-wallpaper');
    getAppSettingsMock.mockReturnValue({ appPortraitWallpaperPath: wallpaperPath });

    const response = await getWallpaperHandler()(new Request('echo-wallpaper://app-portrait/custom', { headers: { Range: 'bytes=0-7' } }));

    expect(response.status).toBe(206);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Range')).toBe('bytes 0-7/24');
    expect(response.headers.get('Content-Length')).toBe('8');
    expect(response.headers.get('Content-Type')).toBe('video/webm');
    expect(await response.text()).toBe('portrait');
  });

  it('serves app video wallpaper byte ranges for stable looping playback', async () => {
    const wallpaperPath = join(wallpaperDirectory, 'motion.mp4');
    writeFileSync(wallpaperPath, 'video-wallpaper');
    getAppSettingsMock.mockReturnValue({ appCustomWallpaperPath: wallpaperPath });

    const response = await getWallpaperHandler()(new Request('echo-wallpaper://app/custom', { headers: { Range: 'bytes=0-4' } }));

    expect(response.status).toBe(206);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Range')).toBe('bytes 0-4/15');
    expect(response.headers.get('Content-Length')).toBe('5');
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(await response.text()).toBe('video');
  });

  it('rejects invalid app video wallpaper byte ranges', async () => {
    const wallpaperPath = join(wallpaperDirectory, 'motion.mp4');
    writeFileSync(wallpaperPath, 'video-wallpaper');
    getAppSettingsMock.mockReturnValue({ appCustomWallpaperPath: wallpaperPath });

    const response = await getWallpaperHandler()(new Request('echo-wallpaper://app/custom', { headers: { Range: 'bytes=99-120' } }));

    expect(response.status).toBe(416);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Range')).toBe('bytes */15');
    expect(await response.text()).toBe('');
  });

  it('does not serve wallpaper paths outside the app wallpaper directory', async () => {
    const outsideRoot = makeTempRoot();
    const wallpaperPath = join(outsideRoot, 'outside.png');
    writeFileSync(wallpaperPath, 'outside');
    getAppSettingsMock.mockReturnValue({ lyricsCustomWallpaperPath: wallpaperPath });

    const response = await getWallpaperHandler()(new Request('echo-wallpaper://lyrics/custom'));

    expect(response.status).toBe(404);
  });

  it('proxies allowed Bilibili images with a referer header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('image', {
        headers: {
          'Content-Type': 'image/jpeg',
        },
      }),
    );
    const imageUrl = 'https://i0.hdslb.com/bfs/archive/cover.jpg';

    const response = await getImageHandler()(new Request(`echo-image://remote/${encodeURIComponent(imageUrl)}?referer=${encodeURIComponent('https://www.bilibili.com/')}`));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await response.text()).toBe('image');
    expect(fetchMock).toHaveBeenCalledWith(
      imageUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          referer: 'https://www.bilibili.com/',
        }),
        redirect: 'follow',
      }),
    );
  });

  it('proxies Subsonic covers by track id without exposing source credentials', async () => {
    readRemoteCoverMock.mockResolvedValue({
      status: 'ok',
      data: new Uint8Array(Buffer.from('cover')),
      mimeType: 'image/png',
      fieldSources: { cover: 'subsonic' },
      warnings: [],
      errors: [],
    });

    const response = await getImageHandler()(new Request(`echo-image://subsonic-cover/${encodeURIComponent('track 1')}?size=9999`));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(await response.text()).toBe('cover');
    expect(readRemoteCoverMock).toHaveBeenCalledWith('track 1', 1024);
  });

  it('serves Subsonic covers from the persistent local cache after the first load', async () => {
    readRemoteCoverMock.mockResolvedValueOnce({
      status: 'ok',
      data: new Uint8Array(Buffer.from('cached-cover')),
      mimeType: 'image/jpeg',
      fieldSources: { cover: 'subsonic' },
      warnings: [],
      errors: [],
    });
    const request = new Request(`echo-image://subsonic-cover/${encodeURIComponent('remote-track-1')}?size=512`);

    const first = await getImageHandler()(request);
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('cached-cover');

    readRemoteCoverMock.mockReset();
    readRemoteCoverMock.mockRejectedValue(new Error('network should not be used'));
    const second = await getImageHandler()(request);

    expect(second.status).toBe(200);
    expect(second.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await second.text()).toBe('cached-cover');
    expect(readRemoteCoverMock).not.toHaveBeenCalled();
  });
});
