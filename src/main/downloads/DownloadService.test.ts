import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { DownloadService } from './DownloadService';
import { createDownloadAuthorizationToken, protectedMusicDownloadBlockedMessage } from './DownloadAuthorization';

let playbackState: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' = 'idle';

vi.mock('../audio/AudioSession', () => ({
  getAudioSession: () => ({
    getStatus: () => ({
      state: playbackState,
      currentFilePath: null,
    }),
  }),
}));

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-download-service-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const makeToolPath = (): string => {
  const root = makeTempRoot();
  const toolPath = join(root, 'yt-dlp.exe');
  writeFileSync(toolPath, 'stub');
  return toolPath;
};

const makeDownloadAuthorizationToken = (
  provider: 'netease' | 'qqmusic' | 'kugou',
  providerTrackId: string,
  url: string,
): string =>
  createDownloadAuthorizationToken({
    provider,
    providerTrackId,
    url,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }) ?? '';

const osuCoverBytes = [255, 216, 255, 224, 1, 2, 3, 4];

const makeOsuArchive = (audioName = 'audio.mp3', audioBytes: number[] = [1, 2, 3, 4], coverName = 'bg.jpg', coverBytes: number[] = osuCoverBytes): Uint8Array =>
  zipSync({
    'artist - song.osu': new TextEncoder().encode(
      `[General]\nAudioFilename: ${audioName}\n\n[Metadata]\nTitle: Song\nArtist: Artist\nCreator: Mapper\nVersion: Hard\n\n[Events]\n0,0,"${coverName}",0,0\n`,
    ),
    [audioName]: new Uint8Array(audioBytes),
    [coverName]: new Uint8Array(coverBytes),
  });

const responseBody = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

const waitForJob = async (service: DownloadService, jobId: string): Promise<ReturnType<DownloadService['getJobs']>[number]> => {
  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const job = service.getJobs().find((item) => item.id === jobId);
    if (job && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')) {
      return job;
    }
  }

  const job = service.getJobs().find((item) => item.id === jobId);
  if (!job) {
    throw new Error(`Missing job ${jobId}`);
  }
  return job;
};

afterEach(() => {
  vi.useRealTimers();
  playbackState = 'idle';
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('DownloadService', () => {
  it('checks the bundled yt-dlp path with --version', async () => {
    const ytDlpPath = makeToolPath();
    const commandRunner = vi.fn((_command: string, _args: string[]) => ({
      promise: Promise.resolve({ stdout: '2026.05.01\n', stderr: '', exitCode: 0 }),
      kill: vi.fn(),
    }));
    const service = new DownloadService(commandRunner, () => ytDlpPath);

    const tools = await service.checkTools();

    expect(commandRunner).toHaveBeenCalledWith(ytDlpPath, ['--version']);
    expect(tools.ytDlpAvailable).toBe(true);
    expect(tools.ytDlpVersion).toBe('2026.05.01');
    expect(tools.ytDlpPath).toBe(ytDlpPath);
  });

  it('rejects real download jobs until an output directory is selected', () => {
    const service = new DownloadService();

    expect(() => service.createUrlJob('https://www.youtube.com/watch?v=probe')).toThrow('请选择下载文件夹');
  });

  it('rejects Spotify playback-only URLs before creating a download job', () => {
    const service = new DownloadService();

    expect(() => service.createUrlJob('https://open.spotify.com/track/spotify-track-id')).toThrow(
      'This streaming platform is playback-only in ECHO Next',
    );
    expect(() => service.createUrlJob('https://example.com/audio.mp3', { webpageUrl: 'spotify:track:spotify-track-id' })).toThrow(
      'This streaming platform is playback-only in ECHO Next',
    );
  });

  it('allows SoundCloud jobs and passes saved cookies to yt-dlp', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const outputPath = join(outputDirectory, 'SoundCloud Song [sc].m4a');
    const commandRunner = vi.fn(() => ({
      promise: Promise.resolve({
        stdout: JSON.stringify({
          title: 'SoundCloud Song',
          duration: 180,
          webpage_url: 'https://soundcloud.com/artist/track',
        }),
        stderr: '',
        exitCode: 0,
      }),
      kill: vi.fn(),
    }));
    const streamingCommandRunner = vi.fn((_command, _args, listeners) => {
      writeFileSync(outputPath, 'audio');
      listeners.onStdout?.(outputPath);
      return {
        promise: Promise.resolve({ stdout: outputPath, stderr: '', exitCode: 0 }),
        kill: vi.fn(),
      };
    });
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      getAccountCredentials: (provider) => ({
        provider,
        cookie: provider === 'soundcloud' ? 'oauth_token=sc-secret; sc_anonymous_id=test' : undefined,
      }),
      streamingCommandRunner,
    });
    service.setSettings({ outputDirectory, importToLibrary: false });

    const job = service.createUrlJob('https://soundcloud.com/artist/track', { importToLibrary: false });
    const completedJob = await waitForJob(service, job.id);

    expect(job.provider).toBe('soundcloud');
    expect(commandRunner).toHaveBeenCalledWith(
      ytDlpPath,
      expect.arrayContaining([
        '--add-header',
        'Referer: https://soundcloud.com/',
        '--add-header',
        'Cookie: oauth_token=sc-secret; sc_anonymous_id=test',
      ]),
    );
    expect(streamingCommandRunner).toHaveBeenCalledWith(
      ytDlpPath,
      expect.arrayContaining([
        '--add-header',
        'Referer: https://soundcloud.com/',
        '--add-header',
        'Cookie: oauth_token=sc-secret; sc_anonymous_id=test',
      ]),
      expect.any(Object),
    );
    expect(completedJob.status).toBe('completed');
    expect(completedJob.outputPath).toBe(outputPath);
  });

  it('downloads an osu beatmapset archive from the official endpoint and extracts the mapped audio file', async () => {
    const outputDirectory = makeTempRoot();
    const archiveBytes = makeOsuArchive('audio.mp3', [11, 22, 33]);
    const fetchRunner = vi.fn(async () => {
      return new Response(responseBody(archiveBytes), {
        status: 200,
        headers: {
          'content-type': 'application/x-osu-beatmap-archive',
          'content-length': String(archiveBytes.length),
        },
      });
    }) as unknown as typeof fetch;
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);
    const service = new DownloadService(undefined, undefined, {
      fetch: fetchRunner,
      getAccountCredentials: (provider) => ({
        provider,
        cookie: provider === 'osu' ? 'osu_session=secret' : undefined,
      }),
      writeEmbeddedTrackTags,
    });
    service.setSettings({ outputDirectory, importToLibrary: false, bindMvAfterImport: true });

    const job = service.createUrlJob('https://osu.ppy.sh/beatmapsets/2492872#fruits/5477400', { importToLibrary: false });
    const completedJob = await waitForJob(service, job.id);

    expect(job.provider).toBe('osu');
    expect(fetchRunner).toHaveBeenCalledWith(
      'https://osu.ppy.sh/beatmapsets/2492872/download?noVideo=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'osu_session=secret',
          Referer: 'https://osu.ppy.sh/',
        }),
      }),
    );
    expect(completedJob.status).toBe('completed');
    expect(completedJob.title).toBe('Artist - Song');
    expect(completedJob.outputPath).toMatch(/Artist - Song\.mp3$/u);
    expect([...readFileSync(completedJob.outputPath!)]).toEqual([11, 22, 33]);
    expect(writeEmbeddedTrackTags).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: completedJob.outputPath,
        coverData: {
          data: new Uint8Array(osuCoverBytes),
          mimeType: 'image/jpeg',
        },
        tags: expect.objectContaining({
          title: 'Song',
          artist: 'Artist',
          album: 'osu! beatmapset 2492872',
        }),
      }),
    );
  });

  it('never binds MV links for imported osu beatmap audio', async () => {
    const outputDirectory = makeTempRoot();
    const archiveBytes = makeOsuArchive('audio.mp3', [44, 55, 66]);
    const bindMvUrl = vi.fn(() => {
      throw new Error('Unsupported MV link. Paste a YouTube or Bilibili video URL.');
    });
    const importAudioFile = vi.fn(async () => ({ id: 'osu-track-1' }));
    const service = new DownloadService(undefined, undefined, {
      bindMvUrl,
      fetch: vi.fn(async () => {
        return new Response(responseBody(archiveBytes), {
          status: 200,
          headers: { 'content-type': 'application/x-osu-beatmap-archive' },
        });
      }) as unknown as typeof fetch,
      getAccountCredentials: (provider) => ({ provider }),
      importAudioFile,
      writeEmbeddedTrackTags: vi.fn(async () => undefined),
    });
    service.setSettings({ outputDirectory, importToLibrary: true, bindMvAfterImport: true });

    const job = service.createUrlJob('https://osu.ppy.sh/beatmapsets/2492872#fruits/5477400', {
      importToLibrary: true,
      bindMvAfterImport: true,
    });
    const completedJob = await waitForJob(service, job.id);

    expect(completedJob.status).toBe('completed');
    expect(completedJob.importedTrackId).toBe('osu-track-1');
    expect(importAudioFile).toHaveBeenCalledWith(
      completedJob.outputPath,
      expect.objectContaining({
        metadata: expect.objectContaining({
          title: 'Song',
          artist: 'Artist',
          album: 'osu! beatmapset 2492872',
        }),
      }),
    );
    expect(bindMvUrl).not.toHaveBeenCalled();
  });

  it('uses the largest image in an osu archive as cover art when the beatmap event is missing', async () => {
    const outputDirectory = makeTempRoot();
    const archiveBytes = zipSync({
      'artist - song.osu': new TextEncoder().encode(
        '[General]\nAudioFilename: audio.mp3\n\n[Metadata]\nTitle: Song\nArtist: Artist\n',
      ),
      'audio.mp3': new Uint8Array([1, 2, 3]),
      'small.png': new Uint8Array([1, 2]),
      'large.png': new Uint8Array([9, 8, 7, 6]),
    });
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);
    const service = new DownloadService(undefined, undefined, {
      fetch: vi.fn(async () => {
        return new Response(responseBody(archiveBytes), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        });
      }) as unknown as typeof fetch,
      getAccountCredentials: (provider) => ({ provider }),
      writeEmbeddedTrackTags,
    });
    service.setSettings({ outputDirectory, importToLibrary: false });

    const job = service.createUrlJob('https://osu.ppy.sh/beatmapsets/2492872#osu/5477400', { importToLibrary: false });
    const completedJob = await waitForJob(service, job.id);

    expect(completedJob.status).toBe('completed');
    expect(writeEmbeddedTrackTags).toHaveBeenCalledWith(
      expect.objectContaining({
        coverData: {
          data: new Uint8Array([9, 8, 7, 6]),
          mimeType: 'image/png',
        },
      }),
    );
  });

  it('falls through osu mirrors when official or Sayobot responses are unavailable', async () => {
    const outputDirectory = makeTempRoot();
    const archiveBytes = makeOsuArchive('fallback.mp3', [5, 6, 7, 8]);
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const rawUrl = String(url);
      if (rawUrl.includes('osu.ppy.sh')) {
        return new Response('<html>login required</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (rawUrl.includes('dl.sayobot.cn')) {
        return new Response('busy', { status: 503, headers: { 'content-type': 'text/plain' } });
      }
      if (rawUrl.includes('catboy.best')) {
        return new Response(responseBody(archiveBytes), { status: 200, headers: { 'content-type': 'application/zip' } });
      }
      return new Response('should not reach NeriNyan', { status: 500 });
    });
    const service = new DownloadService(undefined, undefined, {
      fetch: fetchMock as unknown as typeof fetch,
      getAccountCredentials: (provider) => ({ provider }),
      writeEmbeddedTrackTags: vi.fn(async () => undefined),
    });
    service.setSettings({ outputDirectory, importToLibrary: false });

    const job = service.createUrlJob('https://osu.ppy.sh/beatmapsets/2492872#osu/5477400', { importToLibrary: false });
    const completedJob = await waitForJob(service, job.id);
    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(calledUrls).toEqual([
      'https://osu.ppy.sh/beatmapsets/2492872/download?noVideo=1',
      'https://dl.sayobot.cn/beatmaps/download/novideo/2492872',
      'https://catboy.best/d/2492872',
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: 'https://sayobot.cn/',
          'User-Agent': expect.stringContaining('ECHO Next'),
        }),
      }),
    );
    expect(completedJob.status).toBe('completed');
    expect(completedJob.outputPath).toMatch(/Artist - Song\.mp3$/u);
    expect([...readFileSync(completedJob.outputPath!)]).toEqual([5, 6, 7, 8]);
  });

  it('loads and saves download settings through the settings store', () => {
    const outputDirectory = makeTempRoot();
    const saveSettings = vi.fn();
    const addLibraryFolder = vi.fn();
    const service = new DownloadService(undefined, undefined, {
      addLibraryFolder,
      loadSettings: () => ({ outputDirectory, importToLibrary: false, bindMvAfterImport: false }),
      saveSettings,
    });

    expect(service.getSettings()).toMatchObject({
      outputDirectory,
      importToLibrary: false,
      bindMvAfterImport: false,
    });

    const next = service.setSettings({ importToLibrary: true });

    expect(next.importToLibrary).toBe(true);
    expect(addLibraryFolder).toHaveBeenCalledWith(outputDirectory);
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ outputDirectory, importToLibrary: true }));
  });

  it('does not register the saved download directory while constructing the service', () => {
    const outputDirectory = makeTempRoot();
    const addLibraryFolder = vi.fn();
    const service = new DownloadService(undefined, undefined, {
      addLibraryFolder,
      loadSettings: () => ({ outputDirectory, importToLibrary: false, bindMvAfterImport: false }),
    });

    expect(service.getSettings().outputDirectory).toBe(outputDirectory);
    expect(addLibraryFolder).not.toHaveBeenCalled();
  });

  it('registers the selected download directory as a library folder', () => {
    const outputDirectory = makeTempRoot();
    const addLibraryFolder = vi.fn();
    const service = new DownloadService(undefined, undefined, {
      addLibraryFolder,
      loadSettings: () => ({ outputDirectory: null }),
      saveSettings: vi.fn(),
    });

    service.setSettings({ outputDirectory });

    expect(addLibraryFolder).toHaveBeenCalledWith(outputDirectory);
  });

  it('searches YouTube and Bilibili with yt-dlp and maps results', async () => {
    const ytDlpPath = makeToolPath();
    const commandRunner = vi.fn((_command: string, args: string[]) => {
      const searchUrl = args.at(-1);
      const providerEntry =
        typeof searchUrl === 'string' && searchUrl.startsWith('ytsearch')
          ? {
              id: 'yt-1',
              title: 'YouTube Song',
              url: 'https://www.youtube.com/watch?v=yt-1',
              uploader: 'YT Artist',
              duration: 123,
              thumbnails: [{ url: 'https://img.youtube/thumb-small.jpg' }, { url: 'https://img.youtube/thumb.jpg' }],
              view_count: 1000,
              upload_date: '20260514',
            }
          : {
              id: 'BV1ECHO',
              title: 'Bilibili Song',
              url: 'https://www.bilibili.com/video/BV1ECHO',
              uploader: 'Bili Artist',
              duration: 234,
              thumbnail: 'https://img.bilibili/thumb.jpg',
              view_count: 2000,
            };

      return {
        promise: Promise.resolve({ stdout: JSON.stringify({ entries: [providerEntry] }), stderr: '', exitCode: 0 }),
        kill: vi.fn(),
      };
    });
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      getAccountCredentials: (provider) => ({ provider }),
    });

    const response = await service.search({ query: 'echo', limitPerProvider: 1 });

    expect(commandRunner).toHaveBeenCalledWith(ytDlpPath, expect.arrayContaining(['--playlist-end', '1', 'ytsearch1:echo']));
    expect(commandRunner).toHaveBeenCalledWith(ytDlpPath, expect.arrayContaining(['--playlist-end', '1', 'bilisearch1:echo']));
    expect(response.errors).toEqual([]);
    expect(response.results).toEqual([
      expect.objectContaining({
        provider: 'youtube',
        id: 'yt-1',
        title: 'YouTube Song',
        uploader: 'YT Artist',
        webpageUrl: 'https://www.youtube.com/watch?v=yt-1',
        thumbnailUrl: 'https://img.youtube/thumb.jpg',
        publishedAt: '2026-05-14',
      }),
      expect.objectContaining({
        provider: 'bilibili',
        id: 'BV1ECHO',
        title: 'Bilibili Song',
        uploader: 'Bili Artist',
        webpageUrl: 'https://www.bilibili.com/video/BV1ECHO',
        thumbnailUrl: 'https://img.bilibili/thumb.jpg',
      }),
    ]);
  });

  it('searches only the selected provider when requested', async () => {
    const ytDlpPath = makeToolPath();
    const commandRunner = vi.fn((_command: string, args: string[]) => ({
      promise: Promise.resolve({
        stdout: JSON.stringify({
          entries: [{ id: 'BV1ECHO', title: 'Bilibili Song', url: 'https://www.bilibili.com/video/BV1ECHO' }],
        }),
        stderr: '',
        exitCode: 0,
      }),
      kill: vi.fn(),
    }));
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      getAccountCredentials: (provider) => ({ provider }),
    });

    const response = await service.search({ query: 'echo', limitPerProvider: 1, provider: 'bilibili' });

    expect(commandRunner).toHaveBeenCalledTimes(1);
    expect(commandRunner).toHaveBeenCalledWith(ytDlpPath, expect.arrayContaining(['bilisearch1:echo']));
    expect(commandRunner.mock.calls[0][1]).not.toContain('ytsearch1:echo');
    expect(response.results).toEqual([expect.objectContaining({ provider: 'bilibili', title: 'Bilibili Song' })]);
  });

  it('uses account cookies for search and removes temporary cookie files', async () => {
    const ytDlpPath = makeToolPath();
    const cookiePaths: string[] = [];
    const commandRunner = vi.fn((_command: string, args: string[]) => {
      const cookieIndex = args.indexOf('--cookies');
      if (cookieIndex >= 0) {
        cookiePaths.push(args[cookieIndex + 1]);
      }

      return {
        promise: Promise.resolve({ stdout: JSON.stringify({ entries: [] }), stderr: '', exitCode: 0 }),
        kill: vi.fn(),
      };
    });
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      getAccountCredentials: (provider) => ({
        provider,
        cookie: provider === 'youtube' ? 'SID=abc; HSID=def' : 'SESSDATA=bili',
      }),
    });

    await service.search('echo');

    expect(cookiePaths).toHaveLength(2);
    expect(cookiePaths.every((cookiePath) => !existsSync(cookiePath))).toBe(true);
  });

  it('uses YouTube browser cookies when no saved YouTube cookie exists', async () => {
    const ytDlpPath = makeToolPath();
    const commandRunner = vi.fn((_command: string, _args: string[]) => ({
      promise: Promise.resolve({ stdout: JSON.stringify({ entries: [] }), stderr: '', exitCode: 0 }),
      kill: vi.fn(),
    }));
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      getAccountCredentials: (provider) => ({
        provider,
        browser: provider === 'youtube' ? 'edge' : undefined,
      }),
    });

    await service.search({ query: 'echo', limitPerProvider: 1 });

    const youtubeCall = commandRunner.mock.calls.find((call) => call[1].includes('ytsearch1:echo'));
    expect(youtubeCall?.[1] ?? []).toEqual(expect.arrayContaining(['--cookies-from-browser', 'edge']));
  });

  it('retries search without account cookies when authenticated search fails', async () => {
    const ytDlpPath = makeToolPath();
    const commandRunner = vi.fn((_command: string, args: string[]) => {
      const searchUrl = args.at(-1);
      if (typeof searchUrl === 'string' && searchUrl.startsWith('ytsearch') && args.includes('--cookies-from-browser')) {
        return {
          promise: Promise.resolve({
            stdout: '',
            stderr: 'ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info',
            exitCode: 1,
          }),
          kill: vi.fn(),
        };
      }

      const entries =
        typeof searchUrl === 'string' && searchUrl.startsWith('ytsearch')
          ? [{ id: 'yt-fallback', title: 'Fallback Song', url: 'https://www.youtube.com/watch?v=yt-fallback' }]
          : [];
      return {
        promise: Promise.resolve({ stdout: JSON.stringify({ entries }), stderr: '', exitCode: 0 }),
        kill: vi.fn(),
      };
    });
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      fetch: vi.fn(async () => ({ ok: false })) as unknown as typeof fetch,
      getAccountCredentials: (provider) => ({
        provider,
        browser: provider === 'youtube' ? 'chrome' : undefined,
      }),
    });

    const response = await service.search({ query: 'echo', limitPerProvider: 1 });

    const youtubeCalls = commandRunner.mock.calls.filter((call) => call[1].includes('ytsearch1:echo'));
    expect(youtubeCalls).toHaveLength(2);
    expect(youtubeCalls[0][1]).toEqual(expect.arrayContaining(['--cookies-from-browser', 'chrome']));
    expect(youtubeCalls[1][1]).not.toContain('--cookies-from-browser');
    expect(response.errors).toEqual([]);
    expect(response.results).toEqual([
      expect.objectContaining({
        provider: 'youtube',
        id: 'yt-fallback',
        title: 'Fallback Song',
      }),
    ]);
  });

  it('falls back to the Bilibili web search API when yt-dlp bilisearch is blocked', async () => {
    const ytDlpPath = makeToolPath();
    const commandRunner = vi.fn((_command: string, args: string[]) => {
      const searchUrl = args.at(-1);
      return {
        promise: Promise.resolve({
          stdout: '',
          stderr:
            typeof searchUrl === 'string' && searchUrl.startsWith('bilisearch')
              ? 'ERROR: Unable to download JSON metadata: HTTP Error 412: Precondition Failed'
              : '',
          exitCode: 1,
        }),
        kill: vi.fn(),
      };
    });
    const fetchRunner = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          result: [
            {
              bvid: 'BV1ECHO',
              title: '<em class="keyword">籽岷</em> Bilibili Song',
              author: 'Bili Artist',
              duration: '18:01',
              pic: '//i0.hdslb.com/bfs/archive/cover.jpg',
              arcurl: 'https://www.bilibili.com/video/BV1ECHO',
              play: 33000,
              pubdate: 1778729958,
            },
          ],
        },
      }),
    })) as unknown as typeof fetch;
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      fetch: fetchRunner,
      getAccountCredentials: (provider) => ({ provider, cookie: provider === 'bilibili' ? 'SESSDATA=bili' : undefined }),
    });

    const response = await service.search({ query: '籽岷', limitPerProvider: 1, provider: 'bilibili' });

    expect(fetchRunner).toHaveBeenCalledWith(
      expect.stringContaining('api.bilibili.com/x/web-interface/search/type'),
      expect.objectContaining({
        headers: expect.objectContaining({
          cookie: 'SESSDATA=bili',
          referer: 'https://www.bilibili.com/',
        }),
      }),
    );
    expect(response.errors).toEqual([]);
    expect(response.results).toEqual([
      expect.objectContaining({
        provider: 'bilibili',
        id: 'BV1ECHO',
        title: '籽岷 Bilibili Song',
        durationSeconds: 1081,
        thumbnailUrl: 'echo-image://remote/https%3A%2F%2Fi0.hdslb.com%2Fbfs%2Farchive%2Fcover.jpg?referer=https%3A%2F%2Fwww.bilibili.com%2F',
        webpageUrl: 'https://www.bilibili.com/video/BV1ECHO',
      }),
    ]);
  });

  it('falls back to the Bilibili web search API when yt-dlp bilisearch returns no entries', async () => {
    const ytDlpPath = makeToolPath();
    const commandRunner = vi.fn((_command: string, _args: string[]) => ({
      promise: Promise.resolve({ stdout: JSON.stringify({ entries: [] }), stderr: '', exitCode: 0 }),
      kill: vi.fn(),
    }));
    const fetchRunner = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          result: [
            {
              bvid: 'BVEMPTY',
              title: 'API Fallback Song',
              author: 'Bili Artist',
              duration: '03:54',
              pic: '//i1.hdslb.com/bfs/archive/fallback.jpg',
              arcurl: 'http://www.bilibili.com/video/av98648582',
              play: 12570563,
            },
          ],
        },
      }),
    })) as unknown as typeof fetch;
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      fetch: fetchRunner,
      getAccountCredentials: (provider) => ({ provider }),
      writeEmbeddedTrackTags: vi.fn(async () => undefined),
    });

    const response = await service.search({ query: '籽岷', limitPerProvider: 1, provider: 'bilibili' });

    expect(commandRunner).toHaveBeenCalledWith(ytDlpPath, expect.arrayContaining(['bilisearch1:籽岷']));
    expect(fetchRunner).toHaveBeenCalled();
    expect(response.errors).toEqual([]);
    expect(response.results).toEqual([
      expect.objectContaining({
        provider: 'bilibili',
        id: 'BVEMPTY',
        title: 'API Fallback Song',
        durationSeconds: 234,
        webpageUrl: 'http://www.bilibili.com/video/av98648582',
      }),
    ]);
  });

  it('keeps successful provider search results when another provider fails', async () => {
    const ytDlpPath = makeToolPath();
    const commandRunner = vi.fn((_command: string, args: string[]) => {
      const searchUrl = args.at(-1);
      if (typeof searchUrl === 'string' && searchUrl.startsWith('bilisearch')) {
        return {
          promise: Promise.resolve({ stdout: '', stderr: 'HTTP Error 412', exitCode: 1 }),
          kill: vi.fn(),
        };
      }

      return {
        promise: Promise.resolve({
          stdout: JSON.stringify({ entries: [{ id: 'yt-1', title: 'YouTube Song', url: 'https://www.youtube.com/watch?v=yt-1' }] }),
          stderr: '',
          exitCode: 0,
        }),
        kill: vi.fn(),
      };
    });
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      fetch: vi.fn(async () => ({ ok: false })) as unknown as typeof fetch,
      getAccountCredentials: (provider) => ({ provider }),
    });

    const response = await service.search('echo');

    expect(response.results).toHaveLength(1);
    expect(response.results[0].provider).toBe('youtube');
    expect(response.errors).toEqual([{ provider: 'bilibili', error: 'HTTP Error 412' }]);
  });

  it('rejects empty search queries', async () => {
    const service = new DownloadService();

    await expect(service.search('   ')).rejects.toThrow('search query must be a non-empty string');
  });

  it('probes URL metadata, downloads, and completes without importing when disabled', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const outputPath = join(outputDirectory, 'Probe Song [probe].m4a');
    const coverBytes = new Uint8Array([255, 216, 255, 224]);
    const fetchRunner = vi.fn(async () => {
      return new Response(coverBytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }) as unknown as typeof fetch;
    const writeEmbeddedCoverArt = vi.fn(async () => undefined);
    const commandRunner = vi.fn(() => ({
      promise: Promise.resolve({
        stdout: JSON.stringify({
          title: 'Probe Song',
          duration: 245,
          thumbnail: 'https://img.example/cover.jpg',
          webpage_url: 'https://www.youtube.com/watch?v=probe',
        }),
        stderr: '',
        exitCode: 0,
      }),
      kill: vi.fn(),
    }));
    const streamingCommandRunner = vi.fn((_command, _args, listeners) => {
      listeners.onStdout?.('[download]  50.0% of 10.00MiB at 1.00MiB/s ETA 00:05');
      writeFileSync(outputPath, 'audio');
      listeners.onStdout?.(outputPath);
      return {
        promise: Promise.resolve({ stdout: outputPath, stderr: '', exitCode: 0 }),
        kill: vi.fn(),
      };
    });
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      streamingCommandRunner,
      fetch: fetchRunner,
      writeEmbeddedCoverArt,
      writeEmbeddedTrackTags: vi.fn(async () => undefined),
    });
    service.setSettings({ outputDirectory, importToLibrary: false });

    const job = service.createUrlJob('https://www.youtube.com/watch?v=probe', { importToLibrary: false });
    const completedJob = await waitForJob(service, job.id);
    expect(commandRunner).toHaveBeenCalledWith(ytDlpPath, ['--dump-json', '--no-playlist', 'https://www.youtube.com/watch?v=probe']);
    expect(streamingCommandRunner).toHaveBeenCalled();
    const downloadArgs = streamingCommandRunner.mock.calls[0]?.[1] ?? [];
    expect(downloadArgs).toEqual(expect.arrayContaining(['-o', '%(title).180B.%(ext)s']));
    expect(downloadArgs).not.toContain('--restrict-filenames');
    expect(completedJob.title).toBe('Probe Song');
    expect(completedJob.durationSeconds).toBe(245);
    expect(completedJob.thumbnailUrl).toBe('https://img.example/cover.jpg');
    expect(completedJob.status).toBe('completed');
    expect(completedJob.outputPath).toBe(outputPath);
    expect(writeEmbeddedCoverArt).toHaveBeenCalledWith({
      filePath: outputPath,
      coverData: { data: coverBytes, mimeType: 'image/jpeg' },
    });
  });

  it('uses the probed Bilibili thumbnail as the downloaded audio cover', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const outputPath = join(outputDirectory, 'Bilibili Song [bili].m4a');
    const coverBytes = new Uint8Array([255, 216, 255, 224, 1, 2]);
    const importAudioFile = vi.fn(async () => ({ id: 'track-bili' }));
    const writeEmbeddedCoverArt = vi.fn(async () => undefined);
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);
    const fetchRunner = vi.fn(async () => {
      return new Response(coverBytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }) as unknown as typeof fetch;
    const commandRunner = vi.fn(() => ({
      promise: Promise.resolve({
        stdout: JSON.stringify({
          title: 'Bilibili Song',
          duration: 188,
          thumbnail: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
          webpage_url: 'https://www.bilibili.com/video/BV1ECHO',
        }),
        stderr: '',
        exitCode: 0,
      }),
      kill: vi.fn(),
    }));
    const streamingCommandRunner = vi.fn((_command, _args, listeners) => {
      writeFileSync(outputPath, 'audio');
      listeners.onStdout?.(outputPath);
      return {
        promise: Promise.resolve({ stdout: outputPath, stderr: '', exitCode: 0 }),
        kill: vi.fn(),
      };
    });
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      fetch: fetchRunner,
      importAudioFile,
      streamingCommandRunner,
      writeEmbeddedCoverArt,
      writeEmbeddedTrackTags,
    });
    service.setSettings({ outputDirectory, importToLibrary: true, bindMvAfterImport: false });

    const job = service.createUrlJob('https://www.bilibili.com/video/BV1ECHO');
    const completedJob = await waitForJob(service, job.id);
    const expectedCoverUrl =
      'echo-image://remote/https%3A%2F%2Fi0.hdslb.com%2Fbfs%2Farchive%2Fcover.jpg?referer=https%3A%2F%2Fwww.bilibili.com%2F';

    expect(completedJob.status).toBe('completed');
    expect(completedJob.thumbnailUrl).toBe(expectedCoverUrl);
    expect(writeEmbeddedCoverArt).toHaveBeenCalledWith({
      filePath: outputPath,
      coverData: { data: coverBytes, mimeType: 'image/jpeg' },
    });
    expect(writeEmbeddedTrackTags).not.toHaveBeenCalled();
    expect(fetchRunner).toHaveBeenCalledWith(
      'https://i0.hdslb.com/bfs/archive/cover.jpg',
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: 'https://www.bilibili.com/',
        }),
      }),
    );
    expect(importAudioFile).toHaveBeenCalledWith(
      outputPath,
      expect.objectContaining({
        folderPath: outputDirectory,
        coverUrl: expectedCoverUrl,
      }),
    );
  });

  it('passes direct streaming headers to yt-dlp and keeps the suggested source metadata', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const outputPath = join(outputDirectory, 'Streaming Song [direct].m4a');
    const commandRunner = vi.fn(() => ({
      promise: Promise.resolve({
        stdout: JSON.stringify({
          duration: 180,
          webpage_url: 'https://cdn.example/audio.m4a',
        }),
        stderr: '',
        exitCode: 0,
      }),
      kill: vi.fn(),
    }));
    const streamingCommandRunner = vi.fn((_command, _args, listeners) => {
      writeFileSync(outputPath, 'audio');
      listeners.onStdout?.(outputPath);
      return {
        promise: Promise.resolve({ stdout: outputPath, stderr: '', exitCode: 0 }),
        kill: vi.fn(),
      };
    });
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      streamingCommandRunner,
      writeEmbeddedTrackTags: vi.fn(async () => undefined),
    });
    service.setSettings({ outputDirectory, importToLibrary: false });

    const job = service.createUrlJob('https://cdn.example/audio.m4a?token=abc', {
      importToLibrary: false,
      title: 'Streaming Song - Artist',
      webpageUrl: 'https://music.163.com/#/song?id=123',
      requestHeaders: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'ECHO Test',
      },
      streamingProvider: 'netease',
      streamingProviderTrackId: '123',
      downloadAuthorizationToken: makeDownloadAuthorizationToken('netease', '123', 'https://cdn.example/audio.m4a?token=abc'),
    });
    const completedJob = await waitForJob(service, job.id);
    expect(commandRunner).toHaveBeenCalledWith(ytDlpPath, [
      '--add-header',
      'Referer: https://music.163.com/',
      '--add-header',
      'User-Agent: ECHO Test',
      '--dump-json',
      '--no-playlist',
      'https://cdn.example/audio.m4a?token=abc',
    ]);
    expect(streamingCommandRunner).toHaveBeenCalledWith(
      ytDlpPath,
      expect.arrayContaining(['--add-header', 'Referer: https://music.163.com/', '--add-header', 'User-Agent: ECHO Test']),
      expect.any(Object),
    );
    expect(completedJob.title).toBe('Streaming Song - Artist');
    expect(completedJob.webpageUrl).toBe('https://music.163.com/#/song?id=123');
    expect(completedJob.status).toBe('completed');
  });

  it('downloads direct streaming audio without probing through yt-dlp', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const commandRunner = vi.fn(() => ({
      promise: Promise.resolve({ stdout: '', stderr: 'should not run', exitCode: 1 }),
      kill: vi.fn(),
    }));
    const fetchRunner = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'content-length': '4',
          'content-type': 'audio/flac',
        },
      });
    });
    const service = new DownloadService(commandRunner, () => ytDlpPath, {
      fetch: fetchRunner,
      getAccountCredentials: (provider) => ({ provider }),
      writeEmbeddedTrackTags: vi.fn(async () => undefined),
    });
    service.setSettings({ outputDirectory, importToLibrary: false });

    const job = service.createUrlJob('https://cdn.example/audio?token=abc', {
      importToLibrary: false,
      title: 'Streaming Song - Artist',
      webpageUrl: 'https://music.163.com/#/song?id=123',
      requestHeaders: {
        Referer: 'https://music.163.com/',
      },
      directAudio: true,
      directAudioMimeType: 'audio/flac',
      directAudioExtension: 'flac',
      streamingProvider: 'netease',
      streamingProviderTrackId: '123',
      downloadAuthorizationToken: makeDownloadAuthorizationToken('netease', '123', 'https://cdn.example/audio?token=abc'),
    });
    const completedJob = await waitForJob(service, job.id);
    expect(commandRunner).not.toHaveBeenCalled();
    expect(fetchRunner).toHaveBeenCalledWith(
      'https://cdn.example/audio?token=abc',
      expect.objectContaining({
        headers: expect.objectContaining({
          Origin: 'https://music.163.com',
          Referer: 'https://music.163.com/',
          'User-Agent': expect.stringContaining('Mozilla/5.0'),
        }),
      }),
    );
    expect(completedJob.status).toBe('completed');
    expect(completedJob.outputPath).toContain('Streaming Song - Artist');
    expect(completedJob.outputPath).toMatch(/\.flac$/u);
    expect(completedJob.downloadedBytes).toBe(4);
    expect(existsSync(completedJob.outputPath!)).toBe(true);
  });

  it('downloads direct streaming audio into a playlist subfolder', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const importAudioFile = vi.fn(async () => ({ id: 'track-playlist' }));
    const fetchRunner = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'content-length': '4',
          'content-type': 'audio/mpeg',
        },
      });
    });
    const service = new DownloadService(
      vi.fn(() => ({
        promise: Promise.resolve({ stdout: '', stderr: 'should not run', exitCode: 1 }),
        kill: vi.fn(),
      })),
      () => ytDlpPath,
      {
        fetch: fetchRunner,
        importAudioFile,
        linkDownloadedStreamingTrack: vi.fn(),
        getAccountCredentials: (provider) => ({ provider }),
        writeEmbeddedTrackTags: vi.fn(async () => undefined),
      },
    );
    service.setSettings({ outputDirectory, importToLibrary: true, bindMvAfterImport: false });

    const job = service.createUrlJob('https://m801.music.126.net/audio.mp3', {
      title: 'Playlist Song',
      artist: 'Playlist Artist',
      outputSubdirectory: 'Daily Mix: 01',
      directAudio: true,
      directAudioMimeType: 'audio/mpeg',
      directAudioExtension: 'mp3',
      streamingProvider: 'netease',
      streamingProviderTrackId: 'playlist-track',
      downloadAuthorizationToken: makeDownloadAuthorizationToken('netease', 'playlist-track', 'https://m801.music.126.net/audio.mp3'),
    });
    const completedJob = await waitForJob(service, job.id);
    const playlistFolder = join(outputDirectory, 'Daily Mix 01');

    expect(completedJob.status).toBe('completed');
    expect(existsSync(playlistFolder)).toBe(true);
    expect(completedJob.outputPath).toContain(playlistFolder);
    expect(importAudioFile).toHaveBeenCalledWith(
      completedJob.outputPath,
      expect.objectContaining({
        folderPath: playlistFolder,
      }),
    );
  });

  it('restores unfinished direct audio jobs and resumes from the partial file', async () => {
    const outputDirectory = makeTempRoot();
    const outputPath = join(outputDirectory, 'Artist - Resume Song.mp3');
    writeFileSync(outputPath, Buffer.from([1, 2]));
    const saveJobs = vi.fn();
    const fetchRunner = vi.fn(async () => {
      return new Response(new Uint8Array([3, 4]), {
        status: 206,
        headers: {
          'content-range': 'bytes 2-3/4',
          'content-length': '2',
          'content-type': 'audio/mpeg',
        },
      });
    });
    const service = new DownloadService(
      vi.fn(() => ({
        promise: Promise.resolve({ stdout: '', stderr: 'should not run', exitCode: 1 }),
        kill: vi.fn(),
      })),
      () => null,
      {
        fetch: fetchRunner,
        loadJobs: () => ({
          version: 1,
          jobs: [
            {
              id: 'job-resume',
              sourceUrl: 'https://cdn.example/resume.mp3',
              provider: 'unknown',
              audioStrategy: 'best_available',
              status: 'downloading',
              title: 'Resume Song',
              durationSeconds: null,
              thumbnailUrl: null,
              webpageUrl: null,
              outputPath,
              downloadedBytes: 2,
              totalBytes: 4,
              speedBytesPerSecond: null,
              etaSeconds: null,
              importedTrackId: null,
              progress: 50,
              error: null,
              createdAt: '2026-05-19T00:00:00.000Z',
              updatedAt: '2026-05-19T00:00:01.000Z',
              completedAt: null,
            },
          ],
          jobOptions: {
            'job-resume': {
              outputDirectory,
              importToLibrary: false,
              bindMvAfterImport: false,
              requestHeaders: {},
              suggestedTitle: 'Resume Song',
              suggestedArtist: 'Artist',
              suggestedAlbum: null,
              suggestedAlbumArtist: null,
              suggestedCoverUrl: null,
              suggestedCoverData: null,
              webpageUrl: null,
              directAudio: true,
              directAudioMimeType: 'audio/mpeg',
              directAudioExtension: 'mp3',
              streamingProvider: null,
              streamingProviderTrackId: null,
              streamingStableKey: null,
              downloadAuthorizationToken: null,
            },
          },
        }),
        saveJobs,
        writeEmbeddedTrackTags: vi.fn(async () => undefined),
      },
    );

    const completedJob = await waitForJob(service, 'job-resume');

    expect(fetchRunner).toHaveBeenCalledWith(
      'https://cdn.example/resume.mp3',
      expect.objectContaining({
        headers: expect.objectContaining({ Range: 'bytes=2-' }),
      }),
    );
    expect([...readFileSync(outputPath)]).toEqual([1, 2, 3, 4]);
    expect(completedJob.status).toBe('completed');
    expect(saveJobs).toHaveBeenCalled();
  });

  it('fails restored unfinished jobs that no longer have enough data to resume', async () => {
    const commandRunner = vi.fn(() => ({
      promise: Promise.resolve({ stdout: '', stderr: 'should not run', exitCode: 1 }),
      kill: vi.fn(),
    }));
    const saveJobs = vi.fn();
    const service = new DownloadService(commandRunner, () => null, {
      loadJobs: () => ({
        version: 1,
        jobs: [
          {
            id: 'job-stale',
            sourceUrl: 'https://cdn.example/stale.mp3',
            provider: 'unknown',
            audioStrategy: 'best_available',
            status: 'downloading',
            title: 'Stale Song',
            durationSeconds: null,
            thumbnailUrl: null,
            webpageUrl: null,
            outputPath: null,
            downloadedBytes: null,
            totalBytes: null,
            speedBytesPerSecond: null,
            etaSeconds: null,
            importedTrackId: null,
            progress: 42,
            error: null,
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:01.000Z',
            completedAt: null,
          },
        ],
        jobOptions: {},
      }),
      saveJobs,
    });

    await flushMicrotasks();

    const [job] = service.getJobs();
    expect(commandRunner).not.toHaveBeenCalled();
    expect(job).toMatchObject({
      id: 'job-stale',
      status: 'failed',
      progress: 100,
      error: 'Download resume data is incomplete. Add the track to downloads again.',
    });
    expect(saveJobs).toHaveBeenCalled();
  });

  it('rejects protected music direct downloads without matching playback authorization', () => {
    const outputDirectory = makeTempRoot();
    const service = new DownloadService();
    service.setSettings({ outputDirectory, importToLibrary: false });

    expect(() =>
      service.createUrlJob('https://m801.music.126.net/audio.mp3', {
        directAudio: true,
        directAudioMimeType: 'audio/mpeg',
        streamingProvider: 'netease',
        streamingProviderTrackId: '123',
      }),
    ).toThrow(protectedMusicDownloadBlockedMessage);

    expect(service.getJobs()).toEqual([]);
  });

  it('allows protected music direct downloads without playback authorization after the development unlock', () => {
    const outputDirectory = makeTempRoot();
    const service = new DownloadService(undefined, undefined, {
      loadAppSettings: () => ({ downloadsFeatureUnlocked: true }),
    });
    service.setSettings({ outputDirectory, importToLibrary: false });

    const job = service.createUrlJob('https://m801.music.126.net/audio.mp3', {
      directAudio: true,
      directAudioMimeType: 'audio/mpeg',
      streamingProvider: 'netease',
      streamingProviderTrackId: '123',
    });

    expect(job).toMatchObject({
      sourceUrl: 'https://m801.music.126.net/audio.mp3',
      status: 'queued',
    });
  });

  it('rejects protected music direct downloads when the authorization belongs to another URL', () => {
    const outputDirectory = makeTempRoot();
    const service = new DownloadService();
    service.setSettings({ outputDirectory, importToLibrary: false });

    expect(() =>
      service.createUrlJob('https://m801.music.126.net/other.mp3', {
        directAudio: true,
        directAudioMimeType: 'audio/mpeg',
        streamingProvider: 'netease',
        streamingProviderTrackId: '123',
        downloadAuthorizationToken: makeDownloadAuthorizationToken('netease', '123', 'https://m801.music.126.net/audio.mp3'),
      }),
    ).toThrow(protectedMusicDownloadBlockedMessage);

    expect(service.getJobs()).toEqual([]);
  });

  it('adds provider auth headers to direct NetEase audio downloads in the main process', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const fetchRunner = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'content-length': '4',
          'content-type': 'audio/mpeg',
        },
      });
    });
    const service = new DownloadService(
      vi.fn(() => ({
        promise: Promise.resolve({ stdout: '', stderr: 'should not run', exitCode: 1 }),
        kill: vi.fn(),
      })),
      () => ytDlpPath,
      {
        fetch: fetchRunner,
        getAccountCredentials: (provider) => (provider === 'netease' ? { provider, cookie: 'MUSIC_U=secret' } : { provider }),
        writeEmbeddedTrackTags: vi.fn(async () => undefined),
      },
    );
    service.setSettings({ outputDirectory, importToLibrary: false });

    const job = service.createUrlJob('https://m801.music.126.net/audio.mp3', {
      importToLibrary: false,
      title: 'Streaming Song - Artist',
      webpageUrl: 'https://music.163.com/#/song?id=123',
      directAudio: true,
      directAudioMimeType: 'audio/mpeg',
      directAudioExtension: 'mp3',
      streamingProvider: 'netease',
      streamingProviderTrackId: '123',
      downloadAuthorizationToken: makeDownloadAuthorizationToken('netease', '123', 'https://m801.music.126.net/audio.mp3'),
    });
    const completedJob = await waitForJob(service, job.id);

    expect(fetchRunner).toHaveBeenCalledWith(
      'https://m801.music.126.net/audio.mp3',
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'MUSIC_U=secret',
          Origin: 'https://music.163.com',
          Referer: 'https://music.163.com/',
          'User-Agent': expect.stringContaining('Mozilla/5.0'),
        }),
      }),
    );
    expect(completedJob.status).toBe('completed');
  });

  it('allows protected QQ Music direct downloads when playback authorization matches', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const sourceUrl = 'https://isure.stream.qqmusic.qq.com/song.flac';
    const fetchRunner = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'content-length': '4',
          'content-type': 'audio/flac',
        },
      });
    });
    const service = new DownloadService(
      vi.fn(() => ({
        promise: Promise.resolve({ stdout: '', stderr: 'should not run', exitCode: 1 }),
        kill: vi.fn(),
      })),
      () => ytDlpPath,
      {
        fetch: fetchRunner,
        getAccountCredentials: (provider) => ({ provider }),
        writeEmbeddedTrackTags: vi.fn(async () => undefined),
      },
    );
    service.setSettings({ outputDirectory, importToLibrary: false });

    const job = service.createUrlJob(sourceUrl, {
      importToLibrary: false,
      title: 'VIP QQ Song',
      directAudio: true,
      directAudioMimeType: 'audio/flac',
      directAudioExtension: 'flac',
      streamingProvider: 'qqmusic',
      streamingProviderTrackId: 'song-mid',
      streamingStableKey: 'streaming:qqmusic:song-mid',
      downloadAuthorizationToken: makeDownloadAuthorizationToken('qqmusic', 'song-mid', sourceUrl),
    });
    const completedJob = await waitForJob(service, job.id);

    expect(fetchRunner).toHaveBeenCalledWith(sourceUrl, expect.any(Object));
    expect(completedJob.status).toBe('completed');
    expect(completedJob.outputPath).toMatch(/VIP QQ Song\.flac$/u);
  });

  it('requires KuGou playback authorization and passes KuGou account headers to direct audio downloads', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const sourceUrl = 'https://fs.open.kugou.com/song.mp3';
    const fetchRunner = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'content-length': '4',
          'content-type': 'audio/mpeg',
        },
      });
    });
    const service = new DownloadService(
      vi.fn(() => ({
        promise: Promise.resolve({ stdout: '', stderr: 'should not run', exitCode: 1 }),
        kill: vi.fn(),
      })),
      () => ytDlpPath,
      {
        fetch: fetchRunner,
        getAccountCredentials: (provider) => (provider === 'kugou' ? { provider, cookie: 'dfid=DFID123; kg_mid=123' } : { provider }),
        writeEmbeddedTrackTags: vi.fn(async () => undefined),
      },
    );
    service.setSettings({ outputDirectory, importToLibrary: false });

    expect(() =>
      service.createUrlJob(sourceUrl, {
        directAudio: true,
        directAudioMimeType: 'audio/mpeg',
        streamingProvider: 'kugou',
        streamingProviderTrackId: 'abcdef1234567890abcdef1234567890.1.2',
      }),
    ).toThrow(protectedMusicDownloadBlockedMessage);

    const job = service.createUrlJob(sourceUrl, {
      importToLibrary: false,
      title: 'KuGou Song',
      directAudio: true,
      directAudioMimeType: 'audio/mpeg',
      directAudioExtension: 'mp3',
      streamingProvider: 'kugou',
      streamingProviderTrackId: 'abcdef1234567890abcdef1234567890.1.2',
      streamingStableKey: 'streaming:kugou:abcdef1234567890abcdef1234567890.1.2',
      downloadAuthorizationToken: makeDownloadAuthorizationToken('kugou', 'abcdef1234567890abcdef1234567890.1.2', sourceUrl),
    });
    const completedJob = await waitForJob(service, job.id);

    expect(fetchRunner).toHaveBeenCalledWith(
      sourceUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'dfid=DFID123; kg_mid=123',
          Origin: 'https://www.kugou.com',
          Referer: 'https://www.kugou.com/',
        }),
      }),
    );
    expect(completedJob.status).toBe('completed');
  });

  it('does not bind MV links for imported direct streaming audio', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const bindMvUrl = vi.fn(() => {
      throw new Error('Unsupported MV link. Paste a YouTube or Bilibili video URL.');
    });
    const importAudioFile = vi.fn(async () => ({ id: 'track-1' }));
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);
    const coverBytes = new Uint8Array([137, 80, 78, 71]);
    const service = new DownloadService(
      vi.fn(() => ({
        promise: Promise.resolve({ stdout: '', stderr: 'should not run', exitCode: 1 }),
        kill: vi.fn(),
      })),
      () => ytDlpPath,
      {
        bindMvUrl,
        fetch: vi.fn(async (url: string | URL | Request) => {
          const rawUrl = String(url);
          return new Response(rawUrl.includes('cover.jpg') ? coverBytes : new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { 'content-type': rawUrl.includes('cover.jpg') ? 'image/png' : 'audio/mpeg' },
          });
        }) as unknown as typeof fetch,
        importAudioFile,
        linkDownloadedStreamingTrack: vi.fn(),
        getAccountCredentials: (provider) => ({ provider }),
        writeEmbeddedTrackTags,
      },
    );
    service.setSettings({ outputDirectory, importToLibrary: true, bindMvAfterImport: true });

    const job = service.createUrlJob('https://m801.music.126.net/audio.mp3', {
      title: 'Streaming Song',
      artist: 'Artist',
      album: 'Streaming Album',
      albumArtist: 'Artist',
      coverUrl: 'echo-image://remote/https%3A%2F%2Fp.music.126.net%2Fcover.jpg?referer=https%3A%2F%2Fmusic.163.com%2F',
      webpageUrl: 'https://music.163.com/#/song?id=123',
      bindMvAfterImport: false,
      directAudio: true,
      directAudioMimeType: 'audio/mpeg',
      directAudioExtension: 'mp3',
      streamingProvider: 'netease',
      streamingProviderTrackId: '123',
      downloadAuthorizationToken: makeDownloadAuthorizationToken('netease', '123', 'https://m801.music.126.net/audio.mp3'),
    });
    const completedJob = await waitForJob(service, job.id);

    expect(completedJob.status).toBe('completed');
    expect(completedJob.importedTrackId).toBe('track-1');
    expect(completedJob.outputPath).toContain('Artist - Streaming Song');
    expect(service.getJobs()[0].thumbnailUrl).toBe('echo-image://remote/https%3A%2F%2Fp.music.126.net%2Fcover.jpg?referer=https%3A%2F%2Fmusic.163.com%2F');
    expect(service.getJobs()[0].title).toBe('Streaming Song');
    expect(service.getJobs()[0].outputPath).not.toContain(completedJob.id);
    expect(writeEmbeddedTrackTags).toHaveBeenCalledWith({
      filePath: completedJob.outputPath,
      coverData: { data: coverBytes, mimeType: 'image/png' },
      tags: {
        title: 'Streaming Song',
        artist: 'Artist',
        album: 'Streaming Album',
        albumArtist: 'Artist',
        trackNo: null,
        discNo: null,
        year: null,
        genre: null,
      },
    });
    expect(importAudioFile).toHaveBeenCalledWith(
      completedJob.outputPath,
      expect.objectContaining({
        folderPath: outputDirectory,
        metadata: {
          title: 'Streaming Song',
          artist: 'Artist',
          album: 'Streaming Album',
          albumArtist: 'Artist',
        },
        coverUrl: 'echo-image://remote/https%3A%2F%2Fp.music.126.net%2Fcover.jpg?referer=https%3A%2F%2Fmusic.163.com%2F',
      }),
    );
    expect(bindMvUrl).not.toHaveBeenCalled();
  });

  it('defers library import for album download jobs until the background import queue runs', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const importAudioFile = vi.fn(async () => ({ id: 'track-deferred' }));
    const service = new DownloadService(
      vi.fn(() => ({
        promise: Promise.resolve({ stdout: '', stderr: 'should not run', exitCode: 1 }),
        kill: vi.fn(),
      })),
      () => ytDlpPath,
      {
        fetch: vi.fn(async () => {
          return new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { 'content-type': 'audio/mpeg' },
          });
        }) as unknown as typeof fetch,
        importAudioFile,
        getAccountCredentials: (provider) => ({ provider }),
        writeEmbeddedTrackTags: vi.fn(async () => undefined),
      },
    );
    service.setSettings({ outputDirectory, importToLibrary: true, bindMvAfterImport: false });

    const job = service.createUrlJob('https://m801.music.126.net/audio.mp3', {
      title: 'Streaming Song',
      artist: 'Artist',
      album: 'Streaming Album',
      albumArtist: 'Artist',
      webpageUrl: 'https://music.163.com/#/song?id=123',
      directAudio: true,
      directAudioMimeType: 'audio/mpeg',
      directAudioExtension: 'mp3',
      streamingProvider: 'netease',
      streamingProviderTrackId: '123',
      downloadAuthorizationToken: makeDownloadAuthorizationToken('netease', '123', 'https://m801.music.126.net/audio.mp3'),
      deferImportToLibrary: true,
    });

    const completedJob = await waitForJob(service, job.id);
    expect(completedJob?.status).toBe('completed');
    expect(completedJob?.importedTrackId).toBeNull();
    expect(importAudioFile).not.toHaveBeenCalled();

    const internals = service as unknown as {
      deferredImportTimer: NodeJS.Timeout | null;
      runDeferredImportQueue: () => Promise<void>;
    };
    if (internals.deferredImportTimer) {
      clearTimeout(internals.deferredImportTimer);
      internals.deferredImportTimer = null;
    }
    await internals.runDeferredImportQueue();

    expect(importAudioFile).toHaveBeenCalledWith(
      completedJob?.outputPath,
      expect.objectContaining({
        folderPath: outputDirectory,
        metadata: {
          title: 'Streaming Song',
          artist: 'Artist',
          album: 'Streaming Album',
          albumArtist: 'Artist',
        },
      }),
    );
    expect(service.getJobs().find((item) => item.id === job.id)?.importedTrackId).toBe('track-deferred');
  });

  it('links imported direct streaming audio back to matching playlist entries', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const importAudioFile = vi.fn(async () => ({ id: 'track-local' }));
    const linkDownloadedStreamingTrack = vi.fn();
    const service = new DownloadService(
      vi.fn(() => ({
        promise: Promise.resolve({ stdout: '', stderr: 'should not run', exitCode: 1 }),
        kill: vi.fn(),
      })),
      () => ytDlpPath,
      {
        fetch: vi.fn(async () => {
          return new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { 'content-type': 'audio/mpeg' },
          });
        }) as unknown as typeof fetch,
        importAudioFile,
        linkDownloadedStreamingTrack,
        getAccountCredentials: (provider) => ({ provider }),
        writeEmbeddedTrackTags: vi.fn(async () => undefined),
      },
    );
    service.setSettings({ outputDirectory, importToLibrary: true, bindMvAfterImport: false });

    const job = service.createUrlJob('https://m801.music.126.net/audio.mp3', {
      title: 'Streaming Song',
      artist: 'Artist',
      webpageUrl: 'https://music.163.com/#/song?id=123',
      directAudio: true,
      directAudioMimeType: 'audio/mpeg',
      directAudioExtension: 'mp3',
      streamingProvider: 'netease',
      streamingProviderTrackId: '123',
      streamingStableKey: 'streaming:netease:123',
      downloadAuthorizationToken: makeDownloadAuthorizationToken('netease', '123', 'https://m801.music.126.net/audio.mp3'),
    });
    const completedJob = await waitForJob(service, job.id);

    expect(completedJob.status).toBe('completed');
    expect(completedJob.importedTrackId).toBe('track-local');
    expect(linkDownloadedStreamingTrack).toHaveBeenCalledWith({
      provider: 'netease',
      providerTrackId: '123',
      stableKey: 'streaming:netease:123',
      trackId: 'track-local',
    });
  });

  it('marks the job failed when yt-dlp probe fails', async () => {
    const ytDlpPath = makeToolPath();
    const service = new DownloadService(
      () => ({
        promise: Promise.resolve({ stdout: '', stderr: 'Unsupported URL', exitCode: 1 }),
        kill: vi.fn(),
      }),
      () => ytDlpPath,
    );
    service.setSettings({ outputDirectory: makeTempRoot() });

    const job = service.createUrlJob('https://example.com/video');
    await flushMicrotasks();

    const failedJob = service.getJobs().find((item) => item.id === job.id)!;
    expect(failedJob.status).toBe('failed');
    expect(failedJob.error).toBe('Unsupported URL');
  });

  it('kills an active probe process when the job is cancelled', async () => {
    const ytDlpPath = makeToolPath();
    const kill = vi.fn();
    const service = new DownloadService(
      () => ({
        promise: new Promise(() => {}),
        kill,
      }),
      () => ytDlpPath,
    );
    service.setSettings({ outputDirectory: makeTempRoot() });

    const job = service.createUrlJob('https://www.bilibili.com/video/BV1ECHO');
    const cancelledJob = service.cancelJob(job.id);

    expect(kill).toHaveBeenCalledTimes(1);
    expect(cancelledJob?.status).toBe('cancelled');
  });

  it('imports the downloaded file and binds the source URL after import', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const outputPath = join(outputDirectory, 'Bound Song [bound].m4a');
    const importAudioFile = vi.fn(async () => ({ id: 'track-1' }));
    const bindMvUrl = vi.fn();
    const addLibraryFolder = vi.fn();
    const service = new DownloadService(
      () => ({
        promise: Promise.resolve({
          stdout: JSON.stringify({
            title: 'Bound Song',
            webpage_url: 'https://www.bilibili.com/video/BV1ECHO',
          }),
          stderr: '',
          exitCode: 0,
        }),
        kill: vi.fn(),
      }),
      () => ytDlpPath,
      {
        addLibraryFolder,
        importAudioFile,
        bindMvUrl,
        streamingCommandRunner: (_command, _args, listeners) => {
          writeFileSync(outputPath, 'audio');
          listeners.onStdout?.(outputPath);
          return {
            promise: Promise.resolve({ stdout: outputPath, stderr: '', exitCode: 0 }),
            kill: vi.fn(),
          };
        },
      },
    );
    service.setSettings({ outputDirectory, importToLibrary: true, bindMvAfterImport: true });

    const job = service.createUrlJob('https://www.bilibili.com/video/BV1ECHO');
    await flushMicrotasks();

    const completedJob = service.getJobs().find((item) => item.id === job.id)!;
    expect(completedJob.status).toBe('completed');
    expect(completedJob.importedTrackId).toBe('track-1');
    expect(addLibraryFolder).toHaveBeenCalledWith(outputDirectory);
    expect(importAudioFile).toHaveBeenCalledWith(outputPath, { folderPath: outputDirectory });
    expect(bindMvUrl).toHaveBeenCalledWith('track-1', 'https://www.bilibili.com/video/BV1ECHO');
  });

  it('falls back to the real downloaded file when yt-dlp prints a mojibake path', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const outputPath = join(outputDirectory, '鏡音リン - ねぇねぇねぇ.m4a');
    const mojibakePath = join(outputDirectory, '鏡音リン - ������������.m4a');
    const importAudioFile = vi.fn(async () => ({ id: 'track-unicode' }));
    const service = new DownloadService(
      () => ({
        promise: Promise.resolve({
          stdout: JSON.stringify({
            title: '鏡音リン - ねぇねぇねぇ',
            webpage_url: 'https://www.bilibili.com/video/BV1UNICODE',
          }),
          stderr: '',
          exitCode: 0,
        }),
        kill: vi.fn(),
      }),
      () => ytDlpPath,
      {
        importAudioFile,
        streamingCommandRunner: (_command, _args, listeners) => {
          writeFileSync(outputPath, 'audio');
          listeners.onStdout?.(mojibakePath);
          return {
            promise: Promise.resolve({ stdout: mojibakePath, stderr: '', exitCode: 0 }),
            kill: vi.fn(),
          };
        },
      },
    );
    service.setSettings({ outputDirectory, importToLibrary: true, bindMvAfterImport: false });

    const job = service.createUrlJob('https://www.bilibili.com/video/BV1UNICODE');
    const completedJob = await waitForJob(service, job.id);

    expect(completedJob.status).toBe('completed');
    expect(completedJob.outputPath).toBe(outputPath);
    expect(completedJob.importedTrackId).toBe('track-unicode');
    expect(importAudioFile).toHaveBeenCalledWith(outputPath, { folderPath: outputDirectory });
  });

  it('keeps the downloaded audio imported when MV binding rejects the source URL', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const outputPath = join(outputDirectory, 'Plain Audio [plain].m4a');
    const importAudioFile = vi.fn(async () => ({ id: 'track-imported' }));
    const bindMvUrl = vi.fn(() => {
      throw new Error('Unsupported MV link. Paste a YouTube or Bilibili video URL.');
    });
    const service = new DownloadService(
      () => ({
        promise: Promise.resolve({
          stdout: JSON.stringify({
            title: 'Plain Audio',
            webpage_url: 'https://example.com/audio-page',
          }),
          stderr: '',
          exitCode: 0,
        }),
        kill: vi.fn(),
      }),
      () => ytDlpPath,
      {
        importAudioFile,
        bindMvUrl,
        streamingCommandRunner: (_command, _args, listeners) => {
          writeFileSync(outputPath, 'audio');
          listeners.onStdout?.(outputPath);
          return {
            promise: Promise.resolve({ stdout: outputPath, stderr: '', exitCode: 0 }),
            kill: vi.fn(),
          };
        },
      },
    );
    service.setSettings({ outputDirectory, importToLibrary: true, bindMvAfterImport: true });

    const job = service.createUrlJob('https://example.com/audio-page');
    const completedJob = await waitForJob(service, job.id);

    expect(completedJob.status).toBe('completed');
    expect(completedJob.error).toBeNull();
    expect(completedJob.importedTrackId).toBe('track-imported');
    expect(existsSync(outputPath)).toBe(true);
    expect(importAudioFile).toHaveBeenCalledWith(outputPath, { folderPath: outputDirectory });
    expect(bindMvUrl).toHaveBeenCalledWith('track-imported', 'https://example.com/audio-page');
  });

  it('imports the downloaded file immediately while audio playback is active', async () => {
    const ytDlpPath = makeToolPath();
    const outputDirectory = makeTempRoot();
    const outputPath = join(outputDirectory, 'Immediate Song [immediate].m4a');
    const importAudioFile = vi.fn(async () => ({ id: 'track-immediate' }));
    const bindMvUrl = vi.fn();
    const service = new DownloadService(
      () => ({
        promise: Promise.resolve({
          stdout: JSON.stringify({
            title: 'Immediate Song',
            webpage_url: 'https://www.youtube.com/watch?v=immediate',
          }),
          stderr: '',
          exitCode: 0,
        }),
        kill: vi.fn(),
      }),
      () => ytDlpPath,
      {
        importAudioFile,
        bindMvUrl,
        streamingCommandRunner: (_command, _args, listeners) => {
          writeFileSync(outputPath, 'audio');
          listeners.onStdout?.(outputPath);
          return {
            promise: Promise.resolve({ stdout: outputPath, stderr: '', exitCode: 0 }),
            kill: vi.fn(),
          };
        },
      },
    );
    service.setSettings({ outputDirectory, importToLibrary: true, bindMvAfterImport: true });

    const job = service.createUrlJob('https://www.youtube.com/watch?v=immediate');
    const completedJob = await waitForJob(service, job.id);

    expect(completedJob.status).toBe('completed');
    expect(completedJob.importedTrackId).toBe('track-immediate');
    expect(importAudioFile).toHaveBeenCalledWith(outputPath, { folderPath: outputDirectory });
    expect(bindMvUrl).toHaveBeenCalledWith('track-immediate', 'https://www.youtube.com/watch?v=immediate');
  });
});
