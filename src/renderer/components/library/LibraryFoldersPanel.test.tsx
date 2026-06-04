// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __resetLibraryFolderScanSessionForTests, LibraryFoldersPanel } from './LibraryFoldersPanel';
import { resetLibraryScanSessionForTests } from '../../stores/libraryScanSession';
import type { AudioDeviceInfo, AudioOutputSettings, AudioStatus } from '../../../shared/types/audio';
import type { EqPreset, EqSavePresetRequest, EqSetBandGainRequest, EqState } from '../../../shared/types/eq';
import type { PlaybackStatus } from '../../../shared/types/playback';
import type { LibraryFolder, LibraryScanStatus, LibrarySummary } from '../../../shared/types/library';

type EchoMock = {
  app: {
    getVersion: () => Promise<string>;
  };
  library: {
    chooseFolder: ReturnType<typeof vi.fn>;
    addFolder: ReturnType<typeof vi.fn>;
    getFolders: ReturnType<typeof vi.fn>;
    removeFolder: ReturnType<typeof vi.fn>;
    scanFolder: ReturnType<typeof vi.fn>;
    getScanStatus: ReturnType<typeof vi.fn>;
    cancelScan: ReturnType<typeof vi.fn>;
    getTracks: ReturnType<typeof vi.fn>;
    getAlbums: ReturnType<typeof vi.fn>;
    getAlbumTracks: ReturnType<typeof vi.fn>;
    getSummary: ReturnType<typeof vi.fn>;
  };
  playback: {
    getStatus: () => Promise<PlaybackStatus>;
    playLocalFile: (request: unknown) => Promise<PlaybackStatus>;
    play: () => Promise<PlaybackStatus>;
    pause: () => Promise<PlaybackStatus>;
    stop: () => Promise<PlaybackStatus>;
    seek: (positionSeconds: number) => Promise<PlaybackStatus>;
    openLocalAudioFile: () => Promise<string | null>;
  };
  audio: {
    getStatus: () => Promise<AudioStatus>;
    listDevices: () => Promise<AudioDeviceInfo[]>;
    setOutput: (settings: AudioOutputSettings) => Promise<AudioStatus>;
  };
  eq: {
    getState: () => Promise<EqState>;
    setEnabled: (enabled: boolean) => Promise<EqState>;
    setBandGain: (request: EqSetBandGainRequest) => Promise<EqState>;
    setPreamp: (preampDb: number) => Promise<EqState>;
    setPreset: (presetId: string) => Promise<EqState>;
    reset: () => Promise<EqState>;
    listPresets: () => Promise<EqPreset[]>;
    savePreset: (request: EqSavePresetRequest) => Promise<EqPreset>;
    deletePreset: (presetId: string) => Promise<EqPreset[]>;
  };
};

const baseFolder = (overrides: Partial<LibraryFolder> = {}): LibraryFolder => ({
  id: 'folder-1',
  path: 'D:\\Music',
  name: 'Music',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const runningScan = (overrides: Partial<LibraryScanStatus> = {}): LibraryScanStatus => ({
  id: 'job-1',
  folderId: 'folder-1',
  status: 'running',
  phase: 'reading_metadata',
  totalFiles: 1,
  processedFiles: 0,
  skippedFiles: 0,
  addedTracks: 0,
  updatedTracks: 0,
  removedTracks: 0,
  coverCount: 0,
  errorCount: 0,
  errors: [],
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
  ...overrides,
});

const completedScan = (overrides: Partial<LibraryScanStatus> = {}): LibraryScanStatus => ({
  ...runningScan({
    status: 'completed',
    phase: 'finished',
    processedFiles: 1,
    finishedAt: '2026-01-01T00:05:00.000Z',
  }),
  ...overrides,
});

const summary = (overrides: Partial<LibrarySummary> = {}): LibrarySummary => ({
  songCount: 0,
  albumCount: 0,
  artistCount: 0,
  folderCount: 0,
  totalDuration: 0,
  lastScanAt: null,
  ...overrides,
});

const playbackStatus = (overrides: Partial<PlaybackStatus> = {}): PlaybackStatus => ({
  state: 'idle',
  currentTrackId: null,
  positionMs: 0,
  durationMs: 0,
  filePath: null,
  ...overrides,
});

const audioStatus = (overrides: Partial<AudioStatus> = {}): AudioStatus => ({
  host: 'ready',
  state: 'idle',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: null,
  outputMode: 'shared',
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: null,
  currentTrackId: null,
  durationSeconds: 0,
  positionSeconds: 0,
  channels: null,
  codec: null,
  bitDepth: null,
  bitrate: null,
  fileSampleRate: null,
  decoderOutputSampleRate: null,
  requestedOutputSampleRate: null,
  actualDeviceSampleRate: null,
  sharedDeviceSampleRate: null,
  resampling: false,
  bitPerfectCandidate: false,
  sampleRateMismatch: false,
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: 'Flat',
  clippingRisk: false,
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
  ...overrides,
  activeOutputBackendImpl: overrides.activeOutputBackendImpl ?? null,
  useJuceOutputRequested: overrides.useJuceOutputRequested ?? false,
  activeDecodeBackendImpl: overrides.activeDecodeBackendImpl ?? null,
  useJuceDecodeRequested: overrides.useJuceDecodeRequested ?? false,
});

const eqState = (): EqState => ({
  enabled: false,
  preampDb: 0,
  presetId: 'flat',
  presetName: 'Flat',
  clippingRisk: false,
  bands: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((frequencyHz) => ({
    frequencyHz,
    gainDb: 0,
    q: 1,
  })),
});

let libraryMock: EchoMock['library'];

beforeEach(() => {
  resetLibraryScanSessionForTests();
  __resetLibraryFolderScanSessionForTests();
  libraryMock = {
    chooseFolder: vi.fn(),
    addFolder: vi.fn(),
    getFolders: vi.fn(),
    removeFolder: vi.fn(),
    scanFolder: vi.fn(),
    getScanStatus: vi.fn(),
    cancelScan: vi.fn(),
    getTracks: vi.fn(),
    getAlbums: vi.fn(),
    getAlbumTracks: vi.fn(),
    getSummary: vi.fn(),
  };

  const echo = {
    app: {
      getVersion: vi.fn().mockResolvedValue('0.0.0'),
    },
    library: libraryMock,
    playback: {
      getStatus: vi.fn().mockResolvedValue(playbackStatus()),
      playLocalFile: vi.fn().mockResolvedValue(playbackStatus({ state: 'playing' })),
      play: vi.fn().mockResolvedValue(playbackStatus({ state: 'playing' })),
      pause: vi.fn().mockResolvedValue(playbackStatus({ state: 'paused' })),
      stop: vi.fn().mockResolvedValue(playbackStatus({ state: 'stopped' })),
      seek: vi.fn().mockResolvedValue(playbackStatus({ positionMs: 0 })),
      openLocalAudioFile: vi.fn().mockResolvedValue(null),
    },
    audio: {
      getStatus: vi.fn().mockResolvedValue(audioStatus()),
      listDevices: vi.fn().mockResolvedValue([]),
      setOutput: vi.fn().mockResolvedValue(audioStatus()),
    },
    eq: {
      getState: vi.fn().mockResolvedValue(eqState()),
      setEnabled: vi.fn().mockResolvedValue(eqState()),
      setBandGain: vi.fn().mockResolvedValue(eqState()),
      setPreamp: vi.fn().mockResolvedValue(eqState()),
      setPreset: vi.fn().mockResolvedValue(eqState()),
      reset: vi.fn().mockResolvedValue(eqState()),
      listPresets: vi.fn().mockResolvedValue([]),
      savePreset: vi.fn().mockResolvedValue({ id: 'custom', name: 'Custom', preampDb: 0, bands: eqState().bands, createdAt: '', updatedAt: '', readonly: false }),
      deletePreset: vi.fn().mockResolvedValue([]),
    },
  } satisfies EchoMock;

  Object.defineProperty(window, 'echo', {
    configurable: true,
    value: echo,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LibraryFoldersPanel', () => {
  it('can defer mount-time folder loading until auto refresh is enabled', async () => {
    libraryMock.getFolders.mockResolvedValue([baseFolder()]);

    const { rerender } = render(<LibraryFoldersPanel autoRefresh={false} />);

    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(libraryMock.getFolders).not.toHaveBeenCalled();

    rerender(<LibraryFoldersPanel autoRefresh />);

    await waitFor(() => expect(libraryMock.getFolders).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Music')).toBeTruthy();
  });

  it('calls chooseFolder, addFolder, and scanFolder when choosing a folder', async () => {
    libraryMock.getFolders.mockResolvedValue([]);
    libraryMock.chooseFolder.mockResolvedValue('D:\\Music');
    libraryMock.addFolder.mockResolvedValue(baseFolder());
    libraryMock.scanFolder.mockResolvedValue(runningScan());
    libraryMock.getSummary.mockResolvedValue(summary());

    render(<LibraryFoldersPanel />);

    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));

    await waitFor(() => expect(libraryMock.chooseFolder).toHaveBeenCalledTimes(1));
    expect(libraryMock.addFolder).toHaveBeenCalledWith('D:\\Music');
    expect(libraryMock.scanFolder).toHaveBeenCalledWith('folder-1');
    expect(screen.getByDisplayValue('D:\\Music')).toBeTruthy();
  });

  it('shows the disaster recovery hint when folder loading hits a corrupt database', async () => {
    libraryMock.getFolders.mockRejectedValue(new Error('database disk image is malformed'));
    libraryMock.getSummary.mockResolvedValue(summary());

    render(<LibraryFoldersPanel />);

    expect(await screen.findByText(/归档坏库并重建空库/)).toBeTruthy();
  });

  it('supports manual path input and add-and-scan', async () => {
    libraryMock.getFolders.mockResolvedValue([]);
    libraryMock.addFolder.mockResolvedValue(baseFolder());
    libraryMock.scanFolder.mockResolvedValue(runningScan());
    libraryMock.getSummary.mockResolvedValue(summary());

    render(<LibraryFoldersPanel />);

    fireEvent.change(screen.getByLabelText('文件夹路径'), { target: { value: 'D:\\Library' } });
    fireEvent.click(screen.getByRole('button', { name: '添加并扫描' }));

    await waitFor(() => expect(libraryMock.addFolder).toHaveBeenCalledWith('D:\\Library'));
    expect(libraryMock.scanFolder).toHaveBeenCalledWith('folder-1');
  });

  it('removes a folder and emits a library changed event', async () => {
    libraryMock.getFolders.mockResolvedValue([baseFolder()]);
    libraryMock.removeFolder.mockResolvedValue(undefined);
    libraryMock.getSummary.mockResolvedValue(summary());
    const changedHandler = vi.fn();
    window.addEventListener('library:changed', changedHandler);

    render(<LibraryFoldersPanel />);

    await screen.findByText('Music');
    fireEvent.click(screen.getByRole('button', { name: '移除文件夹' }));

    await waitFor(() => expect(libraryMock.removeFolder).toHaveBeenCalledWith('folder-1'));
    await waitFor(() => expect(changedHandler).toHaveBeenCalled());
    window.removeEventListener('library:changed', changedHandler);
  });

  it('updates scan status after canceling a scan', async () => {
    libraryMock.getFolders.mockResolvedValue([baseFolder()]);
    libraryMock.addFolder.mockResolvedValue(baseFolder());
    libraryMock.scanFolder.mockResolvedValue(runningScan());
    libraryMock.cancelScan.mockResolvedValue(completedScan({ status: 'cancelled', phase: 'cancelled' }));
    libraryMock.getSummary.mockResolvedValue(summary());
    const changedHandler = vi.fn();
    window.addEventListener('library:changed', changedHandler);

    render(<LibraryFoldersPanel />);

    fireEvent.change(screen.getByLabelText('文件夹路径'), { target: { value: 'D:\\Music' } });
    fireEvent.click(screen.getByRole('button', { name: '添加并扫描' }));
    await waitFor(() => expect(screen.getByText(/扫描中 \/ 读取元数据/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '取消扫描' }));

    await waitFor(() => expect(libraryMock.cancelScan).toHaveBeenCalledWith('job-1'));
    await waitFor(() => expect(screen.getByText('扫描已取消', { selector: 'p.audio-file-path' })).toBeTruthy());
    await waitFor(() => expect(changedHandler).toHaveBeenCalled());
    window.removeEventListener('library:changed', changedHandler);
  });

  it('keeps polling a background scan after leaving and returning to the folder page', async () => {
    libraryMock.getFolders.mockResolvedValue([baseFolder()]);
    libraryMock.addFolder.mockResolvedValue(baseFolder());
    libraryMock.scanFolder.mockResolvedValue(runningScan());
    libraryMock.getScanStatus.mockResolvedValue(completedScan());
    libraryMock.getSummary.mockResolvedValue(summary());

    const firstRender = render(<LibraryFoldersPanel />);

    fireEvent.change(await screen.findByLabelText('文件夹路径'), { target: { value: 'D:\\Music' } });
    fireEvent.click(screen.getByRole('button', { name: '添加并扫描' }));
    await waitFor(() => expect(libraryMock.scanFolder).toHaveBeenCalledWith('folder-1'));
    firstRender.unmount();

    render(<LibraryFoldersPanel />);

    await waitFor(() => expect(libraryMock.getScanStatus).toHaveBeenCalledWith('job-1'), { timeout: 2500 });
    await waitFor(() => expect(screen.getByText(/已完成 \/ 完成/)).toBeTruthy(), { timeout: 2500 });
    expect(libraryMock.scanFolder).toHaveBeenCalledTimes(1);
  });
});
