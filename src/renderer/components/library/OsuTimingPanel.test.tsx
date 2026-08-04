// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryTrack } from '../../../shared/types/library';
import { OsuTimingPanel } from './OsuTimingPanel';

const makeTrack = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\Song.flac',
  title: 'Song One',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
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

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'echo', {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
});

describe('OsuTimingPanel', () => {
  it('copies the formatted timing line for a track with BPM and offset', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<OsuTimingPanel track={makeTrack({ bpm: 128, bpmConfidence: 0.9, beatOffsetMs: 12, analysisStatus: 'complete' })} isOpen onClose={vi.fn()} />);

    expect(screen.getByText('12,468.75,4,1,0,100,1,0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制 timing 行' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('12,468.75,4,1,0,100,1,0'));
  });

  it('copies a full TimingPoints block when requested', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<OsuTimingPanel track={makeTrack({ bpm: 150, bpmConfidence: 0.9, beatOffsetMs: 25, analysisStatus: 'complete' })} isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '复制完整块' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('[TimingPoints]\n25,400,4,1,0,100,1,0'));
  });

  it('starts forced BPM analysis for a track missing BPM or offset', async () => {
    const updatedTrack = makeTrack({ bpm: 140, bpmConfidence: 0.91, beatOffsetMs: 33, analysisStatus: 'complete' });
    const onTrackUpdated = vi.fn();
    const startBpmAnalysis = vi.fn().mockResolvedValue({
      id: 'job-1',
      status: 'completed',
      totalTracks: 1,
      processedTracks: 1,
      updatedTracks: 1,
      errorCount: 0,
      currentTrackTitle: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      errors: [],
    });
    Object.defineProperty(window, 'echo', {
      configurable: true,
      value: {
        library: {
          startBpmAnalysis,
          getBpmAnalysisStatus: vi.fn(),
          getTrack: vi.fn().mockResolvedValue(updatedTrack),
        },
      },
    });

    render(<OsuTimingPanel track={makeTrack({ bpm: null, beatOffsetMs: null })} isOpen onClose={vi.fn()} onTrackUpdated={onTrackUpdated} />);

    fireEvent.click(screen.getByRole('button', { name: '重新分析此曲' }));

    await waitFor(() => expect(startBpmAnalysis).toHaveBeenCalledWith({ trackIds: ['track-1'], force: true }));
    await waitFor(() => expect(onTrackUpdated).toHaveBeenCalledWith(updatedTrack));
    expect(await screen.findByText('33,428.571429,4,1,0,100,1,0')).toBeTruthy();
  });

  it('shows a low-confidence warning without blocking copy', () => {
    render(<OsuTimingPanel track={makeTrack({ bpm: 92, bpmConfidence: 0.2, beatOffsetMs: 0, analysisStatus: 'low_confidence' })} isOpen onClose={vi.fn()} />);

    expect(screen.getByText('BPM 置信度偏低。可复制，但建议在 osu! editor 里再听一遍确认。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制 timing 行' })).toHaveProperty('disabled', false);
  });

  it('refreshes the latest track when opened so detected BPM is not stale', async () => {
    const updatedTrack = makeTrack({ bpm: 117.45, bpmConfidence: 0.3, beatOffsetMs: 46, analysisStatus: 'low_confidence' });
    const onTrackUpdated = vi.fn();
    Object.defineProperty(window, 'echo', {
      configurable: true,
      value: {
        library: {
          getTrack: vi.fn().mockResolvedValue(updatedTrack),
        },
      },
    });

    render(<OsuTimingPanel track={makeTrack({ bpm: null, beatOffsetMs: null })} isOpen onClose={vi.fn()} onTrackUpdated={onTrackUpdated} />);

    expect(screen.getAllByText('未知').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByText('117.45 BPM').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText('46,510.855683,4,1,0,100,1,0')).toBeTruthy();
    expect(onTrackUpdated).toHaveBeenCalledWith(updatedTrack);
  });

  it('uses a 0ms offset when BPM exists but detected offset is missing', () => {
    render(<OsuTimingPanel track={makeTrack({ bpm: 128, bpmConfidence: 0.8, beatOffsetMs: null, analysisStatus: 'complete' })} isOpen onClose={vi.fn()} />);

    expect(screen.getByText('已有 BPM，但没有检测到 offset。当前先按 0ms 生成 timing，请用节拍器手动校准。')).toBeTruthy();
    expect(screen.getByText('0,468.75,4,1,0,100,1,0')).toBeTruthy();
  });

  it('lets users correct half-time or double-time BPM before copying', () => {
    render(<OsuTimingPanel track={makeTrack({ bpm: 64, bpmConfidence: 0.88, beatOffsetMs: 12, analysisStatus: 'complete' })} isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '倍速' }));

    expect(screen.getByText('128 BPM')).toBeTruthy();
    expect(screen.getByText('12,468.75,4,1,0,100,1,0')).toBeTruthy();
  });

  it('lets users override BPM, offset, and meter before copying editor bookmarks', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<OsuTimingPanel track={makeTrack({ bpm: 120, bpmConfidence: 0.9, beatOffsetMs: 250, analysisStatus: 'complete' })} isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('手动 BPM'), { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText('手动 offset'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: '3/4' }));

    expect(screen.getByText('500,333.333333,3,1,0,100,1,0')).toBeTruthy();
    expect(screen.getAllByText('333.333 ms').length).toBeGreaterThan(0);
    expect(screen.getByText('1000 ms')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '复制书签行' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('Bookmarks: 500,1500,2500,3500,4500,5500,6500,7500,8500,9500,10500,11500,12500,13500,14500,15500'),
    );
  });

  it('blocks generated timing when manual BPM is invalid', () => {
    render(<OsuTimingPanel track={makeTrack({ bpm: 128, bpmConfidence: 0.9, beatOffsetMs: 0, analysisStatus: 'complete' })} isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('手动 BPM'), { target: { value: '0' } });

    expect(screen.getByText('手动 BPM 需要是大于 0 的数字。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制 timing 行' })).toHaveProperty('disabled', true);
  });
});
