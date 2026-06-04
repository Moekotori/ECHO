// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DownloadsPage } from './DownloadsPage';
import type {
  CreateDownloadUrlJobOptions,
  DownloadJob,
  DownloadJobStatus,
  DownloadSearchRequest,
  DownloadSearchResponse,
  DownloadSettings,
  DownloadToolsStatus,
} from '../../shared/types/downloads';

const listeners = new Set<(jobs: DownloadJob[]) => void>();

const defaultSettings: DownloadSettings = {
  audioStrategy: 'best_available',
  importToLibrary: true,
  bindMvAfterImport: true,
  outputDirectory: 'D:\\Downloads',
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

const makeJob = (sourceUrl: string): DownloadJob => {
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
    title: null,
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
    window.setTimeout(() => {
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
  });
};

const downloadsBridge = {
  getJobs: vi.fn(async () => jobs),
  createUrlJob: vi.fn(async (sourceUrl: string, _options?: CreateDownloadUrlJobOptions) => {
    const job = makeJob(sourceUrl);
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
  clearCompleted: vi.fn(async () => {
    jobs = jobs.filter((job) => !['completed', 'failed', 'cancelled'].includes(job.status));
    emitJobs();
    return jobs;
  }),
  getSettings: vi.fn(async () => settings),
  setSettings: vi.fn(async (patch: Partial<DownloadSettings>) => {
    settings = { ...settings, ...patch };
    return settings;
  }),
  chooseOutputDirectory: vi.fn(async () => {
    settings = { ...settings, outputDirectory: 'D:\\Downloads' };
    return settings;
  }),
  search: vi.fn(async (_request: string | DownloadSearchRequest) => nextSearchResponse),
  checkTools: vi.fn(async () => toolsStatus),
  onJobsUpdated: vi.fn((handler: (nextJobs: DownloadJob[]) => void) => {
    listeners.add(handler);
    return () => listeners.delete(handler);
  }),
};

vi.mock('../utils/echoBridge', () => ({
  getDownloadsBridge: () => downloadsBridge,
}));

const createJobFromUi = async (): Promise<void> => {
  render(<DownloadsPage />);
  await act(async () => {});
  fireEvent.change(screen.getByPlaceholderText('粘贴 YouTube / Bilibili / SoundCloud / osu! 链接'), {
    target: { value: 'https://www.youtube.com/watch?v=echo' },
  });
  fireEvent.click(screen.getByRole('button', { name: /加入队列/ }));
  await act(async () => {});
  expect(screen.getByText('Untitled download')).toBeTruthy();
};

beforeEach(() => {
  listeners.clear();
  jobs = [];
  settings = { ...defaultSettings };
  nextSearchResponse = searchResponse;
  jobCounter = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DownloadsPage', () => {
  it('renders an empty queue', async () => {
    render(<DownloadsPage />);
    await act(async () => {});

    expect(screen.getByText('队列为空')).toBeTruthy();
    expect(screen.getByText('粘贴链接下载')).toBeTruthy();
  });

  it('shows a job after creating a URL download', async () => {
    await createJobFromUi();

    expect(downloadsBridge.createUrlJob).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=echo',
      expect.objectContaining({ importToLibrary: true, bindMvAfterImport: true }),
    );
    expect(screen.getByText('https://www.youtube.com/watch?v=echo')).toBeTruthy();
  });

  it('searches and renders merged YouTube and Bilibili results', async () => {
    render(<DownloadsPage />);
    await act(async () => {});

    fireEvent.change(screen.getByPlaceholderText('搜索歌曲、艺人或视频标题'), { target: { value: 'echo' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    await screen.findByText('YouTube Echo Song');
    expect(downloadsBridge.search).toHaveBeenCalledWith({ query: 'echo', limitPerProvider: 10, provider: 'all' });
    expect(screen.getByText('Bilibili Echo Song')).toBeTruthy();
    expect(screen.getByText('1.2 万次播放 · 2026-05-14')).toBeTruthy();
  });

  it('searches with the selected provider scope', async () => {
    render(<DownloadsPage />);
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'Bilibili' }));
    fireEvent.change(screen.getByPlaceholderText('搜索歌曲、艺人或视频标题'), { target: { value: 'echo' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    await screen.findByText('Bilibili Echo Song');
    expect(downloadsBridge.search).toHaveBeenCalledWith({ query: 'echo', limitPerProvider: 10, provider: 'bilibili' });
    expect(screen.queryByText('YouTube Echo Song')).toBeNull();
  });

  it('downloads a single search result into the queue', async () => {
    render(<DownloadsPage />);
    await act(async () => {});

    fireEvent.change(screen.getByPlaceholderText('搜索歌曲、艺人或视频标题'), { target: { value: 'echo' } });
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

    fireEvent.change(screen.getByPlaceholderText('搜索歌曲、艺人或视频标题'), { target: { value: 'echo' } });
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

    fireEvent.change(screen.getByPlaceholderText('搜索歌曲、艺人或视频标题'), { target: { value: 'echo' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    expect(await screen.findByText('部分平台搜索失败：YouTube：无法读取浏览器 Cookie，已自动尝试不使用登录状态搜索。')).toBeTruthy();
    expect(screen.queryByText(/github\.com\/yt-dlp/u)).toBeNull();
  });

  it('blocks search-result downloads until a download folder is selected', async () => {
    settings = { ...settings, outputDirectory: null };
    render(<DownloadsPage />);
    await act(async () => {});

    fireEvent.change(screen.getByPlaceholderText('搜索歌曲、艺人或视频标题'), { target: { value: 'echo' } });
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

    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('cancels queued and downloading jobs', async () => {
    vi.useFakeTimers();
    await createJobFromUi();
    fireEvent.click(screen.getByLabelText('取消任务'));
    await act(async () => {});
    expect(screen.getByText('已取消')).toBeTruthy();

    cleanup();
    listeners.clear();
    jobs = [];
    await createJobFromUi();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getByText('下载中')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('取消任务'));
    await act(async () => {});

    expect(screen.getByText('已取消')).toBeTruthy();
  });

  it('clears completed jobs', async () => {
    vi.useFakeTimers();
    await createJobFromUi();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByText('已完成')).toBeTruthy();
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
