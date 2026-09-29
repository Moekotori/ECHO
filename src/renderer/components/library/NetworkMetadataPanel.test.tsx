// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  LibraryTrack,
  NetworkMetadataCandidate,
  NetworkMetadataScanJobStatus,
} from '../../../shared/types/library';
import { NetworkMetadataPanel } from './NetworkMetadataPanel';

let libraryBridge: unknown = null;

vi.mock('../../i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'settings.library.networkPanel.appliedCount': '已应用',
        'settings.library.networkPanel.applyMissingOnly': '仅补缺失项',
        'settings.library.networkPanel.applySelected': '应用所选候选',
        'settings.library.networkPanel.artistField': '歌手',
        'settings.library.networkPanel.artistSource': '歌手来源',
        'settings.library.networkPanel.candidates': '候选',
        'settings.library.networkPanel.cover': '封面',
        'settings.library.networkPanel.embeddedCover': '内嵌封面',
        'settings.library.networkPanel.embeddedMetadata': '内嵌标签',
        'settings.library.networkPanel.kicker': '网络元数据',
        'settings.library.networkPanel.localCover': '本地封面',
        'settings.library.networkPanel.missingCover': '缺封面',
        'settings.library.networkPanel.noCandidates': '暂无候选',
        'settings.library.networkPanel.providerErrors': '来源错误',
        'settings.library.networkPanel.reject': '拒绝',
        'settings.library.networkPanel.repairMissing': '补全当前歌曲',
        'settings.library.networkPanel.repairThisTrack': '补全此曲',
        'settings.library.networkPanel.scanComplete': '扫描完成',
        'settings.library.networkPanel.scanDone': '扫描完成',
        'settings.library.networkPanel.scanMissing': '扫描缺失信息',
        'settings.library.networkPanel.scanPreparing': '准备扫描',
        'settings.library.networkPanel.scanProgress': '扫描进度',
        'settings.library.networkPanel.scanRunning': '正在扫描',
        'settings.library.networkPanel.showCandidates': '显示候选',
        'settings.library.networkPanel.title': '缺失元数据修复',
        'settings.library.networkPanel.titleField': '标题',
        'settings.library.networkPanel.trackId': '曲目 ID',
        'settings.library.networkPanel.trackNotFound': '未找到曲目',
        'settings.library.networkPanel.unknownArtist': '未知歌手',
        'settings.library.networkPanel.untitled': '未命名',
      })[key] ?? key,
  }),
}));

vi.mock('../../utils/echoBridge', () => ({
  getAudioBridge: () => null,
  getLibraryBridge: () => libraryBridge,
  getPlaybackBridge: () => null,
}));

const track = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\Song.flac',
  title: 'Song',
  artist: 'Unknown Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

const candidate = (overrides: Partial<NetworkMetadataCandidate> = {}): NetworkMetadataCandidate => ({
  id: 'candidate-1',
  trackId: 'track-1',
  albumId: null,
  provider: 'qq-music',
  providerItemId: 'qq-1',
  title: 'Song',
  artist: 'Network Artist',
  album: 'Album',
  albumArtist: 'Network Artist',
  year: 2026,
  genre: 'Pop',
  duration: 180,
  trackNo: 1,
  discNo: 1,
  coverUrl: 'https://example.test/cover.jpg',
  score: 0.96,
  createdAt: '2026-05-16T00:00:00.000Z',
  ...overrides,
});

const completedScan = (status: Partial<NetworkMetadataScanJobStatus> = {}): NetworkMetadataScanJobStatus => ({
  id: 'scan-1',
  status: 'completed',
  fields: [],
  totalTracks: 1,
  processedTracks: 1,
  scannedCount: 1,
  candidateCount: 0,
  items: [
    {
      track: track(),
      reasons: ['missing_cover'],
      candidates: { metadata: [], covers: [] },
    },
  ],
  errors: [],
  diagnostics: {
    targetCount: 1,
    providerErrors: 0,
    noCandidateCount: 1,
    protectedCount: 0,
    appliedCount: 0,
  },
  startedAt: '2026-05-16T00:00:00.000Z',
  finishedAt: '2026-05-16T00:00:01.000Z',
  currentTrackTitle: null,
  ...status,
});

afterEach(() => {
  cleanup();
  libraryBridge = null;
  vi.restoreAllMocks();
});

describe('NetworkMetadataPanel', () => {
  it('scans all missing fields by default and shows Chinese diagnostics', async () => {
    const startMissingMetadataScan = vi.fn().mockResolvedValue(
      completedScan({
        errors: ['qq-music: timeout'],
        diagnostics: { targetCount: 1, providerErrors: 1, noCandidateCount: 1, protectedCount: 0, appliedCount: 0 },
      }),
    );
    libraryBridge = { startMissingMetadataScan };

    render(<NetworkMetadataPanel />);

    expect(screen.getByRole('button', { name: '全部' }).className).toContain('active');
    fireEvent.click(screen.getByRole('button', { name: /扫描缺失信息/ }));

    await waitFor(() => expect(startMissingMetadataScan).toHaveBeenCalledWith({ limit: 500, fields: [] }));
    expect(await screen.findByText(/来源错误 1/)).toBeTruthy();
    expect(screen.getAllByText('缺封面').length).toBeGreaterThan(0);
    expect(screen.getByText('未知')).toBeTruthy();
    expect(screen.getByText('已读取')).toBeTruthy();
  });

  it('enables bulk apply for a cover candidate and localizes skip reasons', async () => {
    const scanTrack = track({ fieldSources: { artist: 'filename_fallback' } });
    const scanCandidate = candidate();
    const startMissingMetadataScan = vi.fn().mockResolvedValue(
      completedScan({
        candidateCount: 1,
        diagnostics: { targetCount: 1, providerErrors: 0, noCandidateCount: 0, protectedCount: 0, appliedCount: 0 },
        items: [
          {
            track: scanTrack,
            reasons: ['missing_cover'],
            candidates: { metadata: [scanCandidate], covers: [] },
          },
        ],
      }),
    );
    const applyNetworkSelected = vi.fn().mockResolvedValue({
      status: 'candidate_found',
      appliedFields: {},
      reason: 'cover_source_folder_protected',
    });
    libraryBridge = {
      applyNetworkSelected,
      getTracks: vi.fn().mockResolvedValue({ items: [scanTrack], page: 1, pageSize: 500, total: 1, hasMore: false }),
      showNetworkCandidates: vi.fn().mockResolvedValue({ metadata: [scanCandidate], covers: [] }),
      startMissingMetadataScan,
    };

    render(<NetworkMetadataPanel />);

    fireEvent.click(screen.getByRole('button', { name: /扫描缺失信息/ }));
    const bulkButton = await screen.findByRole('button', { name: /应用全部候选/ });
    await waitFor(() => expect(bulkButton).toHaveProperty('disabled', false));
    fireEvent.click(bulkButton);

    await waitFor(() => expect(applyNetworkSelected).toHaveBeenCalledWith('candidate-1', { fields: [] }));
    expect(await screen.findByText('已有文件夹封面，网络封面不会覆盖。')).toBeTruthy();
  });
});
