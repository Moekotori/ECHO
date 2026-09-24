// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DownloadsPage } from './DownloadsPage';
import type { AccountStatus } from '../../shared/types/accounts';
import type {
  CreateDownloadUrlJobOptions,
  DownloadJob,
  DownloadJobStatus,
  DownloadSearchRequest,
  DownloadSearchResponse,
  DownloadSettings,
  DownloadToolsStatus,
  OsuAccountCollectionRequest,
} from '../../shared/types/downloads';

const listeners = new Set<(jobs: DownloadJob[]) => void>();
const simulationTimers = new Set<number>();

const defaultSettings: DownloadSettings = {
  audioStrategy: 'best_available',
  importToLibrary: true,
  bindMvAfterImport: true,
  outputDirectory: 'D:\\Downloads',
  osuOutputDirectory: 'D:\\osu',
  osuDownloadMirror: 'auto',
};

const toolsStatus: DownloadToolsStatus = {
  ytDlpAvailable: false,
  ffmpegAvailable: true,
  ytDlpVersion: null,
  ytDlpPath: null,
  ffmpegPath: 'D:\\Project\\ECHONext\\resources\\tools\\ffmpeg.exe',
};

const searchResponse: DownloadSearchResponse = {
  results: [
    {
      id: 'yt-1',
      provider: 'youtube',
      title: 'YouTube Echo Song',
      uploader: 'YT Artist',
      durationSeconds: 123,
      thumbnailUrl: 'https://img.example/youtube.jpg',
      webpageUrl: 'https://www.youtube.com/watch?v=yt-1',
      viewCount: 12000,
      publishedAt: '2026-05-14',
    },
    {
      id: 'BV1ECHO',
      provider: 'bilibili',
      title: 'Bilibili Echo Song',
      uploader: 'Bili Artist',
      durationSeconds: 234,
      thumbnailUrl: null,
      webpageUrl: 'https://www.bilibili.com/video/BV1ECHO',
      viewCount: null,
      publishedAt: null,
    },
    {
      id: '2492872',
      provider: 'osu',
      title: "t+pazolite - intrO - Don't be Foolish",
      uploader: 'SspoksS',
      durationSeconds: 79,
      thumbnailUrl:
        'echo-image://remote/https%3A%2F%2Fassets.ppy.sh%2Fbeatmaps%2F2492872%2Fcovers%2Fcard.jpg?referer=https%3A%2F%2Fosu.ppy.sh%2F',
      webpageUrl: 'https://osu.ppy.sh/beatmapsets/2492872',
      viewCount: 6400,
      publishedAt: '2026-05-17T13:23:21Z',
    },
  ],
  errors: [],
};

let jobs: DownloadJob[] = [];
let settings: DownloadSettings = { ...defaultSettings };
let jobCounter = 0;
let nextSearchResponse: DownloadSearchResponse = searchResponse;

const emitJobs = (): void => {
  for (const listener of listeners) {
    listener(jobs.map((job) => ({ ...job })));
  }
};

const updateJob = (jobId: string, patch: Partial<DownloadJob>): void => {
  jobs = jobs.map((job) =>
    job.id === jobId
      ? {
          ...job,
          ...patch,
          updatedAt: new Date().toISOString(),
        }
      : job,
  );
  emitJobs();
};

const makeJob = (sourceUrl: string, options: CreateDownloadUrlJobOptions = {}): DownloadJob => {
  const now = new Date().toISOString();
  const provider = sourceUrl.includes('osu.ppy.sh')
    ? 'osu'
    : sourceUrl.includes('soundcloud.com')
      ? 'soundcloud'
      : sourceUrl.includes('bilibili')
        ? 'bilibili'
        : 'youtube';
  return {
    id: `job-${++jobCounter}`,
    sourceUrl,
    provider,
    audioStrategy: settings.audioStrategy,
    status: 'queued',
    title: options.title ?? null,
    artist: options.artist ?? null,
    durationSeconds: null,
    thumbnailUrl: null,
    webpageUrl: null,
    outputPath: null,
    downloadedBytes: null,
    totalBytes: null,
    speedBytesPerSecond: null,
    etaSeconds: null,
    importedTrackId: null,
    progress: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
};

const scheduleSimulation = (jobId: string): void => {
  const steps: Array<{ status: DownloadJobStatus; progress: number }> = [
    { status: 'probing', progress: 0 },
    { status: 'downloading', progress: 45 },
    { status: 'extracting_audio', progress: 86 },
    { status: 'importing', progress: 98 },
    { status: 'completed', progress: 100 },
  ];

  steps.forEach((step, index) => {
    const timerId = window.setTimeout(() => {
      simulationTimers.delete(timerId);
      const job = jobs.find((item) => item.id === jobId);
      if (!job || job.status === 'cancelled') {
        return;
      }

      updateJob(jobId, {
        ...step,
        title: job.title ?? 'Untitled download',
        outputPath: step.status === 'completed' ? 'D:\\Downloads\\Song [echo].m4a' : job.outputPath,
        completedAt: step.status === 'completed' ? new Date().toISOString() : null,
      });
    }, (index + 1) * 350);
    simulationTimers.add(timerId);
  });
};

const downloadsBridge = {
  getJobs: vi.fn(async () => jobs),
  createUrlJob: vi.fn(async (sourceUrl: string, options?: CreateDownloadUrlJobOptions) => {
    const job = makeJob(sourceUrl, options);
    jobs = [job, ...jobs];
    emitJobs();
    scheduleSimulation(job.id);
    return job;
  }),
  cancelJob: vi.fn(async (jobId: string) => {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) {
      return null;
    }

    updateJob(jobId, { status: 'cancelled', completedAt: new Date().toISOString() });
    return jobs.find((item) => item.id === jobId) ?? null;
  }),
  clearJobs: vi.fn(async (provider?: DownloadJob['provider']) => {
    jobs = provider ? jobs.filter((job) => job.provider !== provider) : [];
    emitJobs();
    return jobs;
  }),
  clearCompleted: vi.fn(async (provider?: DownloadJob['provider']) => {
    jobs = jobs.filter((job) =>
      !['completed', 'failed', 'cancelled'].includes(job.status) || (provider !== undefined && job.provider !== provider),
    );
    emitJobs();
    return jobs;
  }),
  getSettings: vi.fn(async () => settings),
  setSettings: vi.fn(async (patch: Partial<DownloadSettings>) => {
    settings = { ...settings, ...patch };
    return settings;
  }),
  chooseOutputDirectory: vi.fn(async (target?: 'default' | 'osu') => {
    settings = target === 'osu' ? { ...settings, osuOutputDirectory: 'D:\\osu' } : { ...settings, outputDirectory: 'D:\\Downloads' };
    return settings;
  }),
  search: vi.fn(async (_request: string | DownloadSearchRequest) => nextSearchResponse),
  getOsuAccountProfile: vi.fn(async () => ({
    userId: 12345,
    username: 'EchoPlayer',
    avatarUrl: 'https://a.ppy.sh/12345',
    countryCode: 'CN',
    isOnline: true,
    isSupporter: true,
    defaultRuleset: 'osu' as const,
    globalRank: 8246,
    countryRank: 312,
    performancePoints: 9842.4,
    hitAccuracy: 98.67,
    level: 101,
    playCount: 42918,
    maximumCombo: 3214,
    playTimeSeconds: 3153600,
    bestScoreCount: 100,
    favouriteBeatmapsetCount: 2,
    mostPlayedBeatmapCount: 2048,
  })),
  getOsuAccountCollection: vi.fn(async (request: OsuAccountCollectionRequest) => ({
    profile: {
      userId: 12345,
      username: 'EchoPlayer',
      avatarUrl: 'https://a.ppy.sh/12345',
      countryCode: 'CN',
      isOnline: true,
      isSupporter: true,
      defaultRuleset: 'osu' as const,
      globalRank: 8246,
      countryRank: 312,
      performancePoints: 9842.4,
      hitAccuracy: 98.67,
      level: 101,
      playCount: 42918,
      maximumCombo: 3214,
      playTimeSeconds: 3153600,
      bestScoreCount: 100,
      favouriteBeatmapsetCount: 2,
      mostPlayedBeatmapCount: 2048,
    },
    kind: request.kind,
    total: request.kind === 'best' ? 100 : request.kind === 'most_played' ? 2048 : 2,
    items: [
      {
        key: `${request.kind}:2492872:1`,
        beatmapsetId: '2492872',
        beatmapId: request.kind === 'best' ? '5477400' : null,
        title: "intrO - Don't be Foolish",
        artist: 't+pazolite',
        creator: 'SspoksS',
        coverUrl: searchResponse.results[2].thumbnailUrl,
        webpageUrl: 'https://osu.ppy.sh/beatmapsets/2492872#osu/5477400',
        durationSeconds: 79,
        position: 1,
        pp: request.kind === 'best' ? 321.5 : null,
        accuracy: request.kind === 'best' ? 0.9876 : null,
        scoreRank: request.kind === 'best' ? 'S' : null,
        mods: request.kind === 'best' ? ['HD', 'DT'] : [],
        difficultyName: request.kind === 'best' ? 'Insane' : null,
        starRating: request.kind === 'best' ? 6.25 : null,
        playCount: request.kind === 'most_played' ? 68 : null,
      },
      {
        key: `${request.kind}:1062527:2`,
        beatmapsetId: '1062527',
        beatmapId: null,
        title: 'Second Song',
        artist: 'Second Artist',
        creator: 'Second Mapper',
        coverUrl: null,
        webpageUrl: 'https://osu.ppy.sh/beatmapsets/1062527',
        durationSeconds: 100,
        position: 2,
        pp: null,
        accuracy: null,
        scoreRank: null,
        mods: [],
        difficultyName: null,
        starRating: null,
        playCount: request.kind === 'most_played' ? 61 : null,
      },
    ],
  })),
  checkTools: vi.fn(async () => toolsStatus),
  onJobsUpdated: vi.fn((handler: (nextJobs: DownloadJob[]) => void) => {
    listeners.add(handler);
    return () => listeners.delete(handler);
  }),
};

const accountsBridge = {
  getStatus: vi.fn(async (): Promise<AccountStatus> => ({
    provider: 'osu' as const,
    connected: false,
    username: null,
    displayName: null,
    avatarUrl: null,
    lastLoginAt: null,
    lastCheckedAt: null,
    expiresAt: null,
    error: null,
  })),
  startLogin: vi.fn(async () => ({
    status: {
      provider: 'osu' as const,
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: 'https://a.ppy.sh/12345',
      lastLoginAt: '2026-07-19T00:00:00.000Z',
      lastCheckedAt: '2026-07-19T00:00:00.000Z',
      expiresAt: null,
      error: null,
    },
    saved: true,
    message: 'saved',
  })),
  onStatusesChanged: vi.fn(() => () => undefined),
};

vi.mock('../utils/echoBridge', () => ({
  getDownloadsBridge: () => downloadsBridge,
  getAccountsBridge: () => accountsBridge,
}));

const createJobFromUi = async (): Promise<void> => {
  render(<DownloadsPage />);
  await act(async () => {});
  fireEvent.change(screen.getByPlaceholderText('粘贴 YouTube / Bilibili / SoundCloud / osu! 链接'), {
    target: { value: 'https://www.youtube.com/watch?v=echo' },
  });
  fireEvent.click(screen.getByRole('button', { name: /加入队列/ }));
  await act(async () => {});
  expect(screen.getAllByText('Untitled download').length).toBeGreaterThan(0);
};

beforeEach(() => {
  window.sessionStorage.clear();
  listeners.clear();
  jobs = [];
  settings = { ...defaultSettings };
  nextSearchResponse = searchResponse;
  jobCounter = 0;
  accountsBridge.getStatus.mockResolvedValue({
    provider: 'osu',
    connected: false,
    username: null,
    displayName: null,
    avatarUrl: null,
    lastLoginAt: null,
    lastCheckedAt: null,
    expiresAt: null,
    error: null,
  });
  vi.clearAllMocks();
});

afterEach(() => {
  for (const timerId of simulationTimers) {
    window.clearTimeout(timerId);
  }
  simulationTimers.clear();
  cleanup();
  vi.useRealTimers();
});

describe('DownloadsPage', () => {
  it('renders an empty queue', async () => {
    render(<DownloadsPage />);
    await act(async () => {});

    expect(screen.getByText('队列为空')).toBeTruthy();
    expect(screen.getAllByText('粘贴链接下载').length).toBeGreaterThan(0);
  });

  it('restores the active download name and progress notice when opening the queue', async () => {
    jobs = [{
      ...makeJob('https://www.youtube.com/watch?v=active', { title: 'Active Song', artist: 'Active Artist' }),
      status: 'downloading',
      progress: 42,
    }];

    render(<DownloadsPage />);

    expect(await screen.findByText('Active Song')).toBeTruthy();
    expect(screen.getAllByText('Active Artist - Active Song').length).toBeGreaterThan(0);
    expect(screen.getAllByText('42%').length).toBeGreaterThan(0);
  });

  it('shows a job after creating a URL download', async () => {
    await createJobFromUi();

    expect(downloadsBridge.createUrlJob).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=echo',
      expect.objectContaining({ importToLibrary: true, bindMvAfterImport: true }),
    );
    expect(screen.getAllByText('https://www.youtube.com/watch?v=echo').length).toBeGreaterThan(0);
  });

  it('searches and renders merged YouTube, Bilibili, and osu results', async () => {
    render(<DownloadsPage />);
    await act(async () => {});

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'echo' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    await screen.findByText('YouTube Echo Song');
    expect(downloadsBridge.search).toHaveBeenCalledWith({ query: 'echo', limitPerProvider: 10, provider: 'all' });
    expect(screen.getByText('Bilibili Echo Song')).toBeTruthy();
    expect(screen.getByText("t+pazolite - intrO - Don't be Foolish")).toBeTruthy();
    expect(screen.getByText('SspoksS')).toBeTruthy();
    expect(screen.getByText('1.2 万次播放 · 2026-05-14')).toBeTruthy();
  });

  it('does not show no-results state until a search is submitted', async () => {
    nextSearchResponse = { results: [], errors: [] };
    render(<DownloadsPage variant="osu" />);
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: '搜索谱面' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ukigumo Hige Driver' } });
    expect(screen.queryByText('暂无搜索结果')).toBeNull();
    expect(downloadsBridge.search).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('暂无搜索结果')).toBeTruthy();
  });

  it('searches with the selected provider scope', async () => {
    render(<DownloadsPage />);
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'Bilibili' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'echo' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    await screen.findByText('Bilibili Echo Song');
    expect(downloadsBridge.search).toHaveBeenCalledWith({ query: 'echo', limitPerProvider: 10, provider: 'bilibili' });
    expect(screen.queryByText('YouTube Echo Song')).toBeNull();
  });

  it('searches and queues osu beatmap results from the osu scope', async () => {
    render(<DownloadsPage />);
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'osu!' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '2492872' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    await screen.findByText("t+pazolite - intrO - Don't be Foolish");
    expect(downloadsBridge.search).toHaveBeenCalledWith({ query: '2492872', limitPerProvider: 10, provider: 'osu' });
    expect(screen.queryByText('YouTube Echo Song')).toBeNull();
    expect(screen.getByText('SspoksS')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /下载音频/ })[0]);

    await waitFor(() =>
      expect(downloadsBridge.createUrlJob).toHaveBeenCalledWith(
        'https://osu.ppy.sh/beatmapsets/2492872',
        expect.objectContaining({
          title: "t+pazolite - intrO - Don't be Foolish",
          coverUrl: searchResponse.results[2].thumbnailUrl,
          webpageUrl: 'https://osu.ppy.sh/beatmapsets/2492872',
          importToLibrary: true,
          bindMvAfterImport: true,
        }),
      ),
    );
  });

  it('locks the standalone osu downloader page to osu searches and osu URL jobs', async () => {
    render(<DownloadsPage variant="osu" />);
    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'osu!' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'YouTube' })).toBeNull();
    expect(screen.getAllByText('D:\\osu').length).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: 'Catboy / Mino' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'NeriNyan' })).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'osu 镜像站' }), { target: { value: 'sayobot' } });
    await waitFor(() => expect(downloadsBridge.setSettings).toHaveBeenCalledWith({ osuDownloadMirror: 'sayobot' }));

    fireEvent.change(screen.getByPlaceholderText('Paste an osu! beatmapset link'), {
      target: { value: 'https://www.youtube.com/watch?v=probe' },
    });
    fireEvent.click(screen.getByRole('button', { name: /加入队列|鍔犲叆闃熷垪/ }));

    expect(screen.getAllByText('osu! 只能下载 beatmapset 链接。').length).toBeGreaterThan(0);
    expect(downloadsBridge.createUrlJob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '搜索谱面' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a hisa' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    await screen.findByText("t+pazolite - intrO - Don't be Foolish");
    expect(downloadsBridge.search).toHaveBeenCalledWith({
      query: 'a hisa',
      limitPerProvider: 10,
      provider: 'osu',
      providerLock: 'osu',
    });
    expect(document.querySelector('.download-search-thumb img')?.getAttribute('src')).toBe(
      'echo-image://remote/https%3A%2F%2Fassets.ppy.sh%2Fbeatmaps%2F2492872%2Fcovers%2Fcard.jpg?referer=https%3A%2F%2Fosu.ppy.sh%2F',
    );

    fireEvent.click(screen.getAllByRole('button', { name: /下载音频/ })[0]);

    await waitFor(() =>
      expect(downloadsBridge.createUrlJob).toHaveBeenCalledWith(
        'https://osu.ppy.sh/beatmapsets/2492872',
        expect.objectContaining({
          importToLibrary: true,
          bindMvAfterImport: false,
          providerLock: 'osu',
          osuDownloadMirror: 'sayobot',
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: /鏇存崲鏂囦欢澶|更换文件夹/ }));
    await waitFor(() => expect(downloadsBridge.chooseOutputDirectory).toHaveBeenCalledWith('osu'));
  });

  it('shows osu download progress in the side queue without the floating toast', async () => {
    jobs = [{
      ...makeJob('https://osu.ppy.sh/beatmapsets/2492872#osu/5477400', {
        title: 't+pazolite - Active Map',
        artist: 't+pazolite',
      }),
      status: 'downloading',
      progress: 42,
      durationSeconds: 79,
      thumbnailUrl: 'https://assets.ppy.sh/beatmaps/2492872/covers/card.jpg',
      downloadedBytes: 1024,
      totalBytes: 4096,
      speedBytesPerSecond: 512,
      etaSeconds: 8,
    }];

    render(<DownloadsPage variant="osu" />);
    await act(async () => {});

    expect(screen.getByText('Active Map')).toBeTruthy();
    expect(screen.getByText('下载中')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('1.0 KB / 4.0 KB')).toBeTruthy();
    expect(screen.getByText('512 B/s · ETA 0:08')).toBeTruthy();
    expect(screen.getByText('osu! #2492872 · 1:19')).toBeTruthy();
    expect(screen.getAllByText('1 个进行中 / 共 1 个').length).toBeGreaterThan(0);
    expect(document.querySelector('.download-job-artwork img')?.getAttribute('src')).toBe(
      'https://assets.ppy.sh/beatmaps/2492872/covers/card.jpg',
    );
    expect(screen.getByLabelText('取消任务')).toBeTruthy();
    expect(document.querySelector('.download-progress-track')?.getAttribute('data-indeterminate')).toBeNull();
    expect((document.querySelector('.download-progress-track span') as HTMLElement | null)?.style.width).toBe('42%');
    expect(document.querySelector('.downloads-toast')).toBeNull();
  });

  it('restores osu search input and results after reopening the page', async () => {
    render(<DownloadsPage variant="osu" />);
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: '搜索谱面' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a hisa' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText("t+pazolite - intrO - Don't be Foolish")).toBeTruthy();

    cleanup();
    downloadsBridge.search.mockClear();
    render(<DownloadsPage variant="osu" />);

    expect(await screen.findByDisplayValue('a hisa')).toBeTruthy();
    expect(screen.getByText("t+pazolite - intrO - Don't be Foolish")).toBeTruthy();
    expect(downloadsBridge.search).not.toHaveBeenCalled();
  });

  it('collapses long osu queue history while keeping every active job visible', async () => {
    jobs = [
      {
        ...makeJob('https://osu.ppy.sh/beatmapsets/999999', { title: 'Active Map' }),
        status: 'downloading',
      },
      ...Array.from({ length: 35 }, (_, index) => ({
        ...makeJob(`https://osu.ppy.sh/beatmapsets/${index + 1}`, { title: `History ${index + 1}` }),
        status: 'completed' as const,
        progress: 100,
      })),
    ];

    render(<DownloadsPage variant="osu" />);
    await act(async () => {});

    expect(screen.getByText('Active Map')).toBeTruthy();
    expect(screen.getByText('History 30')).toBeTruthy();
    expect(screen.queryByText('History 31')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '展开其余 5 条历史任务' }));

    expect(screen.getByText('History 35')).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起历史任务' })).toBeTruthy();
  });

  it('clears only completed jobs from the osu queue and preserves active jobs', async () => {
    jobs = [
      {
        ...makeJob('https://osu.ppy.sh/beatmapsets/2492872', { title: 'Active Map' }),
        status: 'downloading',
        progress: 35,
      },
      {
        ...makeJob('https://osu.ppy.sh/beatmapsets/1062527', { title: 'Completed Map' }),
        status: 'completed',
        progress: 100,
      },
      {
        ...makeJob('https://www.youtube.com/watch?v=keep', { title: 'Keep Other Download' }),
        status: 'completed',
        progress: 100,
      },
    ];

    render(<DownloadsPage variant="osu" />);
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: '清除已完成' }));

    await waitFor(() => expect(downloadsBridge.clearCompleted).toHaveBeenCalledWith('osu'));
    expect(screen.getByText('Active Map')).toBeTruthy();
    expect(screen.queryByText('Completed Map')).toBeNull();
    expect(jobs.map((job) => job.title)).toEqual(['Active Map', 'Keep Other Download']);
  });

  it('uses a newly selected osu mirror for the very next download', async () => {
    render(<DownloadsPage variant="osu" />);
    await act(async () => {});

    fireEvent.change(screen.getByRole('combobox', { name: 'osu 镜像站' }), { target: { value: 'sayobot' } });
    fireEvent.change(screen.getByPlaceholderText('Paste an osu! beatmapset link'), {
      target: { value: 'https://osu.ppy.sh/beatmapsets/2492872' },
    });
    fireEvent.click(screen.getByRole('button', { name: /加入队列|鍔犲叆闃熷垪/ }));

    await waitFor(() =>
      expect(downloadsBridge.createUrlJob).toHaveBeenCalledWith(
        'https://osu.ppy.sh/beatmapsets/2492872',
        expect.objectContaining({ osuDownloadMirror: 'sayobot', providerLock: 'osu' }),
      ),
    );
  });

  it('shows live indeterminate progress when a mirror omits the total size', async () => {
    jobs = [{
      ...makeJob('https://osu.ppy.sh/beatmapsets/2492872', { title: 'Chunked Map' }),
      status: 'downloading',
      progress: 1,
      downloadedBytes: 2048,
      totalBytes: null,
      speedBytesPerSecond: 1024,
    }];

    render(<DownloadsPage variant="osu" />);
    await act(async () => {});

    expect(screen.getByText('实时接收中')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(document.querySelector('.download-progress-track')?.getAttribute('data-indeterminate')).toBe('true');
    expect((document.querySelector('.download-progress-track span') as HTMLElement | null)?.style.width).toBe('');
  });

  it('continues showing an osu job after leaving and reopening the downloader page', async () => {
    vi.useFakeTimers();
    render(<DownloadsPage variant="osu" />);
    await act(async () => {});

    fireEvent.change(screen.getByPlaceholderText('Paste an osu! beatmapset link'), {
      target: { value: 'https://osu.ppy.sh/beatmapsets/2492872#osu/5477400' },
    });
    fireEvent.click(screen.getByRole('button', { name: /加入队列|鍔犲叆闃熷垪/ }));
    await act(async () => {});
    expect(downloadsBridge.createUrlJob).toHaveBeenCalled();

    cleanup();
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    render(<DownloadsPage variant="osu" />);
    await act(async () => {});

    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(document.querySelector('.downloads-toast')).toBeNull();
  });

  it('prompts for osu login and reveals the connected account after login', async () => {
    render(<DownloadsPage variant="osu" />);

    expect(await screen.findByText('登录 osu! 账号，加载你的个人谱面')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '登录 osu!' }));

    expect(await screen.findByText('EchoPlayer')).toBeTruthy();
    expect(screen.getByText('#8,246')).toBeTruthy();
    expect(screen.getByText('#312')).toBeTruthy();
    expect(screen.getByText('9,842.4 pp')).toBeTruthy();
    expect(screen.getByText('98.67%')).toBeTruthy();
    expect(screen.getByText('42,918')).toBeTruthy();
    expect(screen.getByText('3,214x')).toBeTruthy();
    expect(screen.getByText('36天 12小时')).toBeTruthy();
    expect(accountsBridge.startLogin).toHaveBeenCalledWith('osu');
    expect(downloadsBridge.getOsuAccountProfile).toHaveBeenCalled();
  });

  it('loads a selected BP range, supports select-all, and queues the selected beatmapsets', async () => {
    accountsBridge.getStatus.mockResolvedValue({
      provider: 'osu',
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: 'https://a.ppy.sh/12345',
      lastLoginAt: '2026-07-19T00:00:00.000Z',
      lastCheckedAt: '2026-07-19T00:00:00.000Z',
      expiresAt: null,
      error: null,
    });
    render(<DownloadsPage variant="osu" />);

    expect(await screen.findByText('EchoPlayer')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('BP 起始排名'), { target: { value: '21' } });
    fireEvent.change(screen.getByLabelText('BP 结束排名'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: '加载 BP' }));

    expect(await screen.findByText("intrO - Don't be Foolish")).toBeTruthy();
    expect(downloadsBridge.getOsuAccountCollection).toHaveBeenCalledWith({
      kind: 'best',
      ruleset: 'osu',
      start: 21,
      end: 40,
    });
    expect(screen.getByText('321.5pp · 98.76% · S · +HDDT')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    fireEvent.click(screen.getByRole('button', { name: '下载已选 (2)' }));

    await waitFor(() => expect(downloadsBridge.createUrlJob).toHaveBeenCalledTimes(2));
    expect(downloadsBridge.createUrlJob).toHaveBeenCalledWith(
      'https://osu.ppy.sh/beatmapsets/2492872#osu/5477400',
      expect.objectContaining({
        title: "intrO - Don't be Foolish",
        artist: 't+pazolite',
        providerLock: 'osu',
        bindMvAfterImport: false,
      }),
    );
  });

  it('queues one account beatmap directly from its row', async () => {
    accountsBridge.getStatus.mockResolvedValue({
      provider: 'osu',
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: null,
      lastLoginAt: null,
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    });
    render(<DownloadsPage variant="osu" />);

    await screen.findByText('EchoPlayer');
    fireEvent.click(screen.getByRole('button', { name: '加载 BP' }));
    await screen.findByText("intrO - Don't be Foolish");
    fireEvent.click(screen.getByRole('button', { name: "下载 intrO - Don't be Foolish" }));

    await waitFor(() => expect(downloadsBridge.createUrlJob).toHaveBeenCalledTimes(1));
    expect(downloadsBridge.createUrlJob).toHaveBeenCalledWith(
      'https://osu.ppy.sh/beatmapsets/2492872#osu/5477400',
      expect.objectContaining({ providerLock: 'osu', bindMvAfterImport: false }),
    );
    expect(await screen.findByText('已在队列')).toBeTruthy();
  });

  it('filters the loaded account list without discarding its records', async () => {
    accountsBridge.getStatus.mockResolvedValue({
      provider: 'osu',
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: null,
      lastLoginAt: null,
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    });
    render(<DownloadsPage variant="osu" />);

    await screen.findByText('EchoPlayer');
    fireEvent.click(screen.getByRole('button', { name: '加载 BP' }));
    await screen.findByText('Second Song');

    fireEvent.change(screen.getByRole('searchbox', { name: '筛选当前谱面列表' }), {
      target: { value: 'SspoksS' },
    });

    expect(screen.getByText("intrO - Don't be Foolish")).toBeTruthy();
    expect(screen.queryByText('Second Song')).toBeNull();
    expect(screen.getByText(/匹配 1 个/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '清除谱面筛选' }));
    expect(screen.getByText('Second Song')).toBeTruthy();
  });

  it('marks completed osu beatmapsets as downloaded and prevents duplicate selection', async () => {
    jobs = [{
      ...makeJob('https://osu.ppy.sh/beatmapsets/2492872#osu/5477400', { title: 'Downloaded Map' }),
      status: 'completed',
      progress: 100,
    }];
    accountsBridge.getStatus.mockResolvedValue({
      provider: 'osu',
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: null,
      lastLoginAt: null,
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    });
    render(<DownloadsPage variant="osu" />);

    await screen.findByText('EchoPlayer');
    fireEvent.click(screen.getByRole('button', { name: '加载 BP' }));
    await screen.findByText("intrO - Don't be Foolish");

    expect(screen.getByText('已下载')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: "intrO - Don't be Foolish 已下载" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: "下载 intrO - Don't be Foolish" })).toBeNull();
  });

  it('loads all osu favourites through the account collection bridge', async () => {
    accountsBridge.getStatus.mockResolvedValue({
      provider: 'osu',
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: null,
      lastLoginAt: null,
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    });
    render(<DownloadsPage variant="osu" />);

    await screen.findByText('EchoPlayer');
    fireEvent.click(screen.getByRole('button', { name: '全部收藏' }));
    fireEvent.click(screen.getByRole('button', { name: '加载全部收藏' }));

    expect(await screen.findByText('已加载全部 2 个收藏谱面。')).toBeTruthy();
    expect(downloadsBridge.getOsuAccountCollection).toHaveBeenCalledWith({ kind: 'favourites' });
  });

  it('loads the most-played beatmaps and displays each difficulty play count', async () => {
    accountsBridge.getStatus.mockResolvedValue({
      provider: 'osu',
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: null,
      lastLoginAt: null,
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    });
    render(<DownloadsPage variant="osu" />);

    await screen.findByText('EchoPlayer');
    fireEvent.click(screen.getByRole('button', { name: '玩得最多 (2,048)' }));
    fireEvent.click(screen.getByRole('button', { name: '加载玩得最多' }));

    expect(await screen.findByText('已加载玩得最多的 2 个谱面。')).toBeTruthy();
    expect(downloadsBridge.getOsuAccountCollection).toHaveBeenCalledWith({ kind: 'most_played' });
    expect(screen.getByText('68 次')).toBeTruthy();
    expect(screen.getByText('61 次')).toBeTruthy();
    expect(screen.getByText('游玩 #1')).toBeTruthy();
    expect(screen.getByText(/已显示 2 \/ 共 2,048/u)).toBeTruthy();
  });

  it('loads more most-played records without replacing the first page', async () => {
    accountsBridge.getStatus.mockResolvedValue({
      provider: 'osu',
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: null,
      lastLoginAt: null,
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    });
    render(<DownloadsPage variant="osu" />);

    await screen.findByText('EchoPlayer');
    fireEvent.click(screen.getByRole('button', { name: '玩得最多 (2,048)' }));
    fireEvent.click(screen.getByRole('button', { name: '加载玩得最多' }));
    await screen.findByText('68 次');

    downloadsBridge.getOsuAccountCollection.mockResolvedValueOnce({
      profile: await downloadsBridge.getOsuAccountProfile(),
      kind: 'most_played',
      total: 2048,
      items: [{
        key: 'most_played:999999',
        beatmapsetId: '888888',
        beatmapId: '999999',
        title: 'Later Favourite',
        artist: 'Later Artist',
        creator: 'Later Mapper',
        coverUrl: null,
        webpageUrl: 'https://osu.ppy.sh/beatmapsets/888888#mania/999999',
        durationSeconds: 120,
        position: 3,
        pp: null,
        accuracy: null,
        scoreRank: null,
        mods: [],
        difficultyName: '[4K] Later',
        starRating: 5.1,
        playCount: 42,
      }],
    });
    fireEvent.click(screen.getByRole('button', { name: /继续加载（已显示 2/u }));

    expect(await screen.findByText('Later Favourite')).toBeTruthy();
    expect(screen.getByText("intrO - Don't be Foolish")).toBeTruthy();
    expect(downloadsBridge.getOsuAccountCollection).toHaveBeenLastCalledWith({
      kind: 'most_played',
      offset: 2,
      limit: 100,
    });
    expect(screen.getByText(/已显示 3 \/ 共 2,048/u)).toBeTruthy();
  });

  it('keeps each loaded account collection when switching between osu tabs', async () => {
    accountsBridge.getStatus.mockResolvedValue({
      provider: 'osu',
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: null,
      lastLoginAt: null,
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    });
    render(<DownloadsPage variant="osu" />);

    await screen.findByText('EchoPlayer');
    fireEvent.click(screen.getByRole('button', { name: '玩得最多 (2,048)' }));
    fireEvent.click(screen.getByRole('button', { name: '加载玩得最多' }));
    await screen.findByText('68 次');
    fireEvent.click(screen.getByRole('checkbox', { name: "选择 intrO - Don't be Foolish" }));

    fireEvent.click(screen.getByRole('button', { name: 'BP 成绩' }));
    fireEvent.click(screen.getByRole('button', { name: '加载 BP' }));
    await screen.findByText('321.5pp · 98.76% · S · +HDDT');

    downloadsBridge.getOsuAccountCollection.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '玩得最多 (2,048)' }));

    expect(screen.getByText('68 次')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: "选择 intrO - Don't be Foolish" }) as HTMLInputElement).checked).toBe(true);
    expect(downloadsBridge.getOsuAccountCollection).not.toHaveBeenCalled();
  });

  it('restores the loaded osu collection after leaving and reopening the page', async () => {
    accountsBridge.getStatus.mockResolvedValue({
      provider: 'osu',
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: null,
      lastLoginAt: null,
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    });
    render(<DownloadsPage variant="osu" />);

    await screen.findByText('EchoPlayer');
    fireEvent.click(screen.getByRole('button', { name: '玩得最多 (2,048)' }));
    fireEvent.click(screen.getByRole('button', { name: '加载玩得最多' }));
    expect(await screen.findByText('68 次')).toBeTruthy();
    expect(downloadsBridge.getOsuAccountCollection).toHaveBeenCalledTimes(1);

    cleanup();
    downloadsBridge.getOsuAccountProfile.mockClear();
    downloadsBridge.getOsuAccountCollection.mockClear();

    render(<DownloadsPage variant="osu" />);

    expect(await screen.findByText('68 次')).toBeTruthy();
    expect(downloadsBridge.getOsuAccountProfile).not.toHaveBeenCalled();
    expect(downloadsBridge.getOsuAccountCollection).not.toHaveBeenCalled();
  });

  it('refreshes the connected osu profile and the currently loaded collection', async () => {
    accountsBridge.getStatus.mockResolvedValue({
      provider: 'osu',
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: null,
      lastLoginAt: null,
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    });
    render(<DownloadsPage variant="osu" />);

    await screen.findByText('EchoPlayer');
    fireEvent.click(screen.getByRole('button', { name: '全部收藏' }));
    fireEvent.click(screen.getByRole('button', { name: '加载全部收藏' }));
    await screen.findByText('已加载全部 2 个收藏谱面。');

    downloadsBridge.getOsuAccountProfile.mockClear();
    downloadsBridge.getOsuAccountCollection.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));

    await waitFor(() => expect(downloadsBridge.getOsuAccountProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(downloadsBridge.getOsuAccountCollection).toHaveBeenCalledWith({ kind: 'favourites' }));
    expect(await screen.findByText('已刷新 EchoPlayer 和当前收藏列表。')).toBeTruthy();
  });

  it('makes a missing osu download folder visible from the batch action', async () => {
    settings = { ...settings, osuOutputDirectory: null };
    accountsBridge.getStatus.mockResolvedValue({
      provider: 'osu',
      connected: true,
      username: '12345',
      displayName: 'EchoPlayer',
      avatarUrl: null,
      lastLoginAt: null,
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    });
    render(<DownloadsPage variant="osu" />);

    await screen.findByText('EchoPlayer');
    fireEvent.click(screen.getByRole('button', { name: '加载 BP' }));
    await screen.findByText("intrO - Don't be Foolish");
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    fireEvent.click(screen.getByRole('button', { name: '下载已选 (2)' }));

    expect(downloadsBridge.createUrlJob).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('请先选择 osu! 下载文件夹');
    expect(screen.getByText(/右侧“下载设置”已为你标出/u)).toBeTruthy();
  });

  it('downloads a single search result into the queue', async () => {
    render(<DownloadsPage />);
    await act(async () => {});

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'echo' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await screen.findByText('YouTube Echo Song');
    fireEvent.click(screen.getAllByRole('button', { name: '下载音频' })[0]);

    await waitFor(() =>
      expect(downloadsBridge.createUrlJob).toHaveBeenCalledWith(
        'https://www.youtube.com/watch?v=yt-1',
        expect.objectContaining({ importToLibrary: true, bindMvAfterImport: true }),
      ),
    );
    expect(await screen.findByText('已加入队列')).toBeTruthy();
  });

  it('shows provider search errors while keeping successful results', async () => {
    nextSearchResponse = {
      results: [searchResponse.results[0]],
      errors: [{ provider: 'bilibili', error: 'HTTP Error 412' }],
    };
    render(<DownloadsPage />);
    await act(async () => {});

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'echo' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    expect(await screen.findByText('YouTube Echo Song')).toBeTruthy();
    expect(screen.getByText('部分平台搜索失败：Bilibili：HTTP Error 412')).toBeTruthy();
  });

  it('summarizes browser cookie search errors instead of showing raw yt-dlp output', async () => {
    nextSearchResponse = {
      results: [],
      errors: [
        {
          provider: 'youtube',
          error:
            'ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info ERROR: Could not copy Chrome cookie database.',
        },
      ],
    };
    render(<DownloadsPage />);
    await act(async () => {});

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'echo' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    expect(await screen.findByText('部分平台搜索失败：YouTube：无法读取浏览器 Cookie，已自动尝试不使用登录状态搜索。')).toBeTruthy();
    expect(screen.queryByText(/github\.com\/yt-dlp/u)).toBeNull();
  });

  it('blocks search-result downloads until a download folder is selected', async () => {
    settings = { ...settings, outputDirectory: null };
    render(<DownloadsPage />);
    await act(async () => {});

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'echo' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await screen.findByText('YouTube Echo Song');
    fireEvent.click(screen.getAllByRole('button', { name: '下载音频' })[0]);
    await act(async () => {});

    expect(downloadsBridge.createUrlJob).not.toHaveBeenCalled();
    expect(screen.getAllByText('请选择下载文件夹').length).toBeGreaterThan(0);
  });

  it('blocks URL creation until a download folder is selected', async () => {
    settings = { ...settings, outputDirectory: null };
    render(<DownloadsPage />);
    await act(async () => {});
    fireEvent.change(screen.getByPlaceholderText('粘贴 YouTube / Bilibili / SoundCloud / osu! 链接'), {
      target: { value: 'https://www.youtube.com/watch?v=echo' },
    });
    fireEvent.click(screen.getByRole('button', { name: /加入队列/ }));
    await act(async () => {});

    expect(downloadsBridge.createUrlJob).not.toHaveBeenCalled();
    expect(screen.getAllByText('请选择下载文件夹').length).toBeGreaterThan(0);
  });

  it('lets a job reach completed', async () => {
    vi.useFakeTimers();
    await createJobFromUi();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
  });

  it('cancels queued and downloading jobs', async () => {
    vi.useFakeTimers();
    await createJobFromUi();
    fireEvent.click(screen.getByLabelText('取消任务'));
    await act(async () => {});
    expect(screen.getAllByText('已取消').length).toBeGreaterThan(0);

    cleanup();
    listeners.clear();
    jobs = [];
    await createJobFromUi();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getAllByText('下载中').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText('取消任务'));
    await act(async () => {});

    expect(screen.getAllByText('已取消').length).toBeGreaterThan(0);
  });

  it('clears completed jobs', async () => {
    vi.useFakeTimers();
    await createJobFromUi();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '清除已完成' }));
    await act(async () => {});

    expect(screen.getByText('队列为空')).toBeTruthy();
  });

  it('does not crash when yt-dlp is missing from tool checks', async () => {
    render(<DownloadsPage />);
    await act(async () => {});

    expect(screen.getByText('yt-dlp')).toBeTruthy();
    expect(screen.getByText('未随应用安装')).toBeTruthy();
    expect(screen.getByText('ffmpeg')).toBeTruthy();
  });
});
