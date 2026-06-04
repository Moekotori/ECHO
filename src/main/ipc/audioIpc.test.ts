import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const AUDIO_COMMAND_TIMEOUT_MS = 15_000;

describe('audio IPC command timeout fallback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the current audio status instead of surfacing a timed-out command error', async () => {
    vi.useFakeTimers();

    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reportAudioError = vi.fn();
    const status = {
      host: 'ready',
      state: 'playing',
      outputDeviceId: 'device-1',
      outputDeviceName: 'Speakers',
      outputDeviceType: 'wasapi',
      outputBackend: 'wasapi-shared',
      activeOutputBackendImpl: 'wasapi-shared',
      outputMode: 'shared',
      sharedBackend: 'windows',
      useJuceOutputRequested: false,
      useJuceDecodeRequested: false,
      activeDecodeBackendImpl: 'juce',
      volume: 1,
      playbackRate: 1,
      playbackSpeedMode: 'speed',
      currentFilePath: 'D:\\Music\\stable.flac',
      currentTrackId: 'track-1',
      durationSeconds: 180,
      positionSeconds: 42,
      channels: 2,
      codec: 'flac',
      bitDepth: 16,
      bitrate: 900000,
      fileSampleRate: 44100,
      decoderOutputSampleRate: 44100,
      requestedOutputSampleRate: null,
      actualDeviceSampleRate: 44100,
      sharedDeviceSampleRate: 44100,
      resampling: false,
      bitPerfectCandidate: true,
      sampleRateMismatch: false,
      eqEnabled: false,
      channelBalanceEnabled: false,
      dspActive: false,
      preampDb: 0,
      eqPresetName: null,
      clippingRisk: false,
      bitPerfectDisabledReason: null,
      warnings: [],
      error: null,
    };
    const setOutput = vi.fn(() => new Promise(() => undefined));
    const audioSession = {
      getStatus: () => status,
      getDiagnostics: vi.fn(),
      listDevicesAsync: vi.fn(),
      on: vi.fn(),
      setOutput,
      forceRestart: vi.fn(),
      openAsioControlPanel: vi.fn(),
      stopForWindowsAudioServiceRestart: vi.fn(),
    };

    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: vi.fn(() => []) },
      dialog: { showSaveDialog: vi.fn() },
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        }),
      },
    }));
    vi.doMock('../audio/AudioSession', () => ({
      getAudioSession: () => audioSession,
    }));
    vi.doMock('../audio/EqBridge', () => ({
      getEqBridge: () => ({
        getState: vi.fn(),
        setEnabled: vi.fn(),
        setBandGain: vi.fn(),
        setBandFrequency: vi.fn(),
        setPreamp: vi.fn(),
        setPreset: vi.fn(),
        reset: vi.fn(),
        savePreset: vi.fn(),
        exportPreset: vi.fn(),
        deletePreset: vi.fn(),
      }),
    }));
    vi.doMock('../audio/WindowsAudioServiceManager', () => ({
      restartWindowsAudioService: vi.fn(),
    }));
    vi.doMock('../diagnostics/CrashReportService', () => ({
      getCrashReportService: () => ({ reportAudioError }),
    }));

    const { IpcChannels } = await import('../../shared/constants/ipcChannels');
    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    const result = handlers.get(IpcChannels.AudioSetOutput)?.({}, { outputMode: 'shared' }) as Promise<unknown>;
    await vi.advanceTimersByTimeAsync(AUDIO_COMMAND_TIMEOUT_MS + 100);

    await expect(result).resolves.toBe(status);
    expect(setOutput).toHaveBeenCalledWith(expect.objectContaining({ outputMode: 'shared' }));
    expect(reportAudioError).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[audioIpc] audio command timed out; returning current status');
  });
});

describe('audio IPC EQ preset import', () => {
  let tempDir: string | null = null;
  let previousIncludeDir: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    previousIncludeDir = process.env.ECHO_APO_INCLUDE_DIR;
  });

  afterEach(() => {
    if (previousIncludeDir === undefined) {
      delete process.env.ECHO_APO_INCLUDE_DIR;
    } else {
      process.env.ECHO_APO_INCLUDE_DIR = previousIncludeDir;
    }
    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
      tempDir = null;
    }
    vi.restoreAllMocks();
  });

  it('imports Equalizer APO configs and expands Windows environment variables in Include paths', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'echo-apo-import-'));
    process.env.ECHO_APO_INCLUDE_DIR = tempDir;
    const rootPath = join(tempDir, 'desk.txt');
    const includePath = join(tempDir, 'child.txt');
    writeFileSync(rootPath, [
      'Preamp: -6 dB',
      'Include: %ECHO_APO_INCLUDE_DIR%\\child.txt',
    ].join('\n'), 'utf8');
    writeFileSync(includePath, 'Filter 1: ON PK Fc 1000 Hz Gain -3 dB Q 1.4\n', 'utf8');

    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: [rootPath] });
    const savePreset = vi.fn((request) => ({
      ...request,
      createdAt: 'now',
      updatedAt: 'now',
      readonly: false,
    }));
    const eqBridge = {
      getState: vi.fn(),
      setEnabled: vi.fn(),
      setBandGain: vi.fn(),
      setBandFrequency: vi.fn(),
      setBandQ: vi.fn(),
      setBandFilterType: vi.fn(),
      setBandEnabled: vi.fn(),
      setPreamp: vi.fn(),
      setDspHeadroom: vi.fn(),
      setPreset: vi.fn(),
      reset: vi.fn(),
      listPresets: vi.fn(() => []),
      savePreset,
      deletePreset: vi.fn(),
      listProfiles: vi.fn(),
      saveProfile: vi.fn(),
      applyProfile: vi.fn(),
      deleteProfile: vi.fn(),
      bindProfileToOutput: vi.fn(),
      getProfileBinding: vi.fn(),
      getChannelBalanceState: vi.fn(),
      setChannelBalanceState: vi.fn(),
      resetChannelBalance: vi.fn(),
      getRoomCorrectionState: vi.fn(),
      importRoomCorrectionIr: vi.fn(),
      setRoomCorrectionEnabled: vi.fn(),
      setRoomCorrectionTrim: vi.fn(),
      clearRoomCorrection: vi.fn(),
    };
    const audioSession = {
      getStatus: vi.fn(),
      getDiagnostics: vi.fn(),
      listDevicesAsync: vi.fn(),
      on: vi.fn(),
      setOutput: vi.fn(),
      forceRestart: vi.fn(),
      openAsioControlPanel: vi.fn(),
      stopForWindowsAudioServiceRestart: vi.fn(),
    };

    vi.doMock('electron', () => ({
      BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn(() => []) },
      dialog: { showOpenDialog, showSaveDialog: vi.fn() },
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        }),
      },
    }));
    vi.doMock('../audio/AudioSession', () => ({
      getAudioSession: () => audioSession,
    }));
    vi.doMock('../audio/EqBridge', () => ({
      getEqBridge: () => eqBridge,
    }));
    vi.doMock('../audio/WindowsAudioServiceManager', () => ({
      restartWindowsAudioService: vi.fn(),
    }));
    vi.doMock('../diagnostics/CrashReportService', () => ({
      getCrashReportService: () => ({ reportAudioError: vi.fn() }),
    }));

    const { IpcChannels } = await import('../../shared/constants/ipcChannels');
    const { registerAudioIpc } = await import('./audioIpc');
    registerAudioIpc();

    const result = await handlers.get(IpcChannels.EqImportPreset)?.({});

    expect(showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.arrayContaining([
        expect.objectContaining({ name: 'Equalizer APO' }),
      ]),
    }));
    expect(savePreset).toHaveBeenCalledWith(expect.objectContaining({
      id: 'desk',
      name: 'desk',
      preampDb: -6,
      bands: expect.arrayContaining([
        expect.objectContaining({
          frequencyHz: 1000,
          gainDb: -3,
          q: 1.4,
          filterType: 'peaking',
        }),
      ]),
    }));
    expect(result).toMatchObject({
      preset: { id: 'desk', name: 'desk', preampDb: -6 },
      metadata: {
        source: 'equalizer-apo',
        importedFilterCount: 1,
        includedFileCount: 1,
      },
    });
  });
});
