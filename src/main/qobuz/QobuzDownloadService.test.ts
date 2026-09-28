import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QobuzFormatId } from '../../shared/types/qobuz';
import { QobuzDownloadService } from './QobuzDownloadService';

const mocks = vi.hoisted(() => ({
  downloadsEnabled: true,
  ensureValid: vi.fn(),
  getAlbum: vi.fn(),
  getTrackFileUrl: vi.fn(),
}));

vi.mock('../../shared/constants/downloadAvailability', () => ({
  assertMusicDownloadsEnabled: () => {
    if (!mocks.downloadsEnabled) throw new Error('歌曲下载功能已关闭');
  },
}));

vi.mock('./QobuzAuthService', () => ({
  QobuzAuthService: {
    getInstance: () => ({
      ensureValid: mocks.ensureValid,
      getApiClient: () => ({
        getAlbum: mocks.getAlbum,
        getTrackFileUrl: mocks.getTrackFileUrl,
      }),
    }),
  },
}));

describe('QobuzDownloadService', () => {
  beforeEach(() => {
    mocks.downloadsEnabled = true;
    vi.clearAllMocks();
    mocks.ensureValid.mockResolvedValue(undefined);
    mocks.getAlbum.mockResolvedValue({
      streamable: true,
      title: 'Album',
      artist: { name: 'Artist' },
      tracks: {
        items: [{ id: 42, title: 'Track', performer: { name: 'Artist' } }],
      },
    });
    mocks.getTrackFileUrl.mockImplementation(async (trackId: string, formatId: QobuzFormatId) => ({
      url: `https://cdn.example/${trackId}-${formatId}`,
      trackId: Number(trackId),
      duration: 180,
      formatId,
      mimeType: formatId === 5 ? 'audio/mpeg' : 'audio/flac',
      bitDepth: formatId === 5 ? null : 24,
      sampleRate: formatId === 27 ? 192_000 : 44_100,
      restrictions: null,
    }));
  });

  it('blocks album downloads before authentication, URL resolution or job creation', async () => {
    mocks.downloadsEnabled = false;
    const createUrlJob = vi.fn();
    const service = new QobuzDownloadService({ createUrlJob } as never);

    await expect(service.downloadAlbum('album-1', 5)).rejects.toThrow('歌曲下载功能已关闭');
    expect(mocks.ensureValid).not.toHaveBeenCalled();
    expect(mocks.getAlbum).not.toHaveBeenCalled();
    expect(mocks.getTrackFileUrl).not.toHaveBeenCalled();
    expect(createUrlJob).not.toHaveBeenCalled();
  });

  it('caches signed URLs per track and requested format', async () => {
    const createUrlJob = vi.fn((url: string) => ({ id: `job-${url}` }));
    const service = new QobuzDownloadService({
      createUrlJob,
      getSettings: () => ({ outputDirectory: 'D:\\Music' }),
    } as never);

    await service.downloadAlbum('album-1', 5, { outputDir: 'D:\\Music' });
    await service.downloadAlbum('album-1', 5, { outputDir: 'D:\\Music' });
    await service.downloadAlbum('album-1', 27, { outputDir: 'D:\\Music' });

    expect(mocks.getTrackFileUrl).toHaveBeenCalledTimes(2);
    expect(mocks.getTrackFileUrl).toHaveBeenNthCalledWith(1, '42', 5);
    expect(mocks.getTrackFileUrl).toHaveBeenNthCalledWith(2, '42', 27);
    expect(createUrlJob).toHaveBeenNthCalledWith(
      3,
      'https://cdn.example/42-27',
      expect.objectContaining({
        directAudioExtension: 'flac',
        directAudioMimeType: 'audio/flac',
      }),
    );
  });
});
