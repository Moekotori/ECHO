// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  LibraryQualityIssuePage,
  LibraryQualityOverviewItem,
  LibraryTrack,
  NetworkMetadataScanJobStatus,
} from '../../../shared/types/library';
import { LibraryQualityPanel } from './LibraryQualityPanel';

let libraryBridge: Record<string, unknown> | null = null;

vi.mock('../../utils/echoBridge', () => ({
  getLibraryBridge: () => libraryBridge,
}));

const overview: LibraryQualityOverviewItem[] = [
  {
    kind: 'missing_cover',
    label: '缺封面',
    count: 2,
    severity: 'warning',
    description: '没有可用封面的本地歌曲。',
    actionAvailable: true,
    lastError: null,
  },
  {
    kind: 'embedded_read_failed',
    label: '内嵌读取失败',
    count: 1,
    severity: 'danger',
    description: '内嵌标签或封面读取失败。',
    actionAvailable: false,
    lastError: null,
  },
];

const track = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\Song.flac',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
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
  metadataStatus: 'ok',
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

const issuePage = (overrides: Partial<LibraryQualityIssuePage> = {}): LibraryQualityIssuePage => ({
  kind: 'missing_cover',
  page: 1,
  pageSize: 20,
  total: 1,
  hasMore: false,
  items: [
    {
      track: track(),
      reasons: ['missing_cover'],
      candidateCount: 0,
    },
  ],
  ...overrides,
});

const completedJob = (): NetworkMetadataScanJobStatus => ({
  id: 'quality-job-123456',
  status: 'queued',
  fields: ['cover'],
  totalTracks: 0,
  processedTracks: 0,
  scannedCount: 0,
  candidateCount: 0,
  items: [],
  errors: [],
  diagnostics: {
    targetCount: 0,
    providerErrors: 0,
    noCandidateCount: 0,
    protectedCount: 0,
    appliedCount: 0,
  },
  startedAt: '2026-05-20T00:00:00.000Z',
  finishedAt: null,
  currentTrackTitle: null,
});

afterEach(() => {
  cleanup();
  libraryBridge = null;
  vi.restoreAllMocks();
});

describe('LibraryQualityPanel', () => {
  it('can skip mount-time overview refresh until the panel is opened', async () => {
    const getLibraryQualityOverview = vi.fn().mockResolvedValue(overview);
    const getLibraryQualityIssues = vi.fn().mockResolvedValue(issuePage());
    libraryBridge = {
      getLibraryQualityOverview,
      getLibraryQualityIssues,
      onLibraryChanged: vi.fn(),
    };

    render(<LibraryQualityPanel autoRefresh={false} networkMetadataEnabled={false} />);

    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(getLibraryQualityOverview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /资料质量整理/ }));
    await waitFor(() => expect(getLibraryQualityOverview).toHaveBeenCalledTimes(1));
  });

  it('shows overview totals and loads issue rows by category', async () => {
    const getLibraryQualityOverview = vi.fn().mockResolvedValue(overview);
    const getLibraryQualityIssues = vi.fn().mockResolvedValue(issuePage());
    libraryBridge = {
      getLibraryQualityOverview,
      getLibraryQualityIssues,
      onLibraryChanged: vi.fn(),
    };

    render(<LibraryQualityPanel networkMetadataEnabled={false} />);

    expect(await screen.findByText(/3 个本地资料问题/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /资料质量整理/ }));
    fireEvent.click(await screen.findByRole('button', { name: /缺封面/ }));

    await waitFor(() =>
      expect(getLibraryQualityIssues).toHaveBeenCalledWith({
        kind: 'missing_cover',
        page: 1,
        pageSize: 20,
        sourceProvider: 'local',
        search: '',
      }),
    );
    expect(await screen.findByText('Song')).toBeTruthy();
    expect(screen.getByRole('button', { name: /补全此曲/ })).toHaveProperty('disabled', true);
  });

  it('opens files and starts bounded network scans when enabled', async () => {
    const getLibraryQualityOverview = vi.fn().mockResolvedValue(overview);
    const getLibraryQualityIssues = vi.fn().mockResolvedValue(issuePage());
    const openTrackInFolder = vi.fn().mockResolvedValue(undefined);
    const startMissingMetadataScan = vi.fn().mockResolvedValue(completedJob());
    libraryBridge = {
      getLibraryQualityOverview,
      getLibraryQualityIssues,
      onLibraryChanged: vi.fn(),
      openTrackInFolder,
      startMissingMetadataScan,
    };

    render(<LibraryQualityPanel networkMetadataEnabled />);

    fireEvent.click(await screen.findByRole('button', { name: /资料质量整理/ }));
    fireEvent.click(await screen.findByRole('button', { name: /缺封面/ }));
    await screen.findByText('Song');

    fireEvent.click(screen.getByRole('button', { name: /定位文件/ }));
    await waitFor(() => expect(openTrackInFolder).toHaveBeenCalledWith('track-1'));

    fireEvent.click(screen.getByRole('button', { name: /扫描当前分类/ }));
    await waitFor(() => expect(startMissingMetadataScan).toHaveBeenCalledWith({ limit: 100, fields: ['cover'] }));
  });
});
