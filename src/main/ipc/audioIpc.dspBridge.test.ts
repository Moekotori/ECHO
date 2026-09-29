import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const eqState = {
    enabled: false,
    preampDb: 0,
    dspHeadroomDb: 0,
    dspSafetyLimiterEnabled: true,
    bands: [],
    presetId: 'flat',
    presetName: 'Flat',
    clippingRisk: false,
  };
  const roomCorrectionState = {
    enabled: false,
    status: 'empty',
    irId: null,
    irName: null,
    channelMode: 'none',
    sampleRate: null,
    tapCount: 0,
    trimDb: 0,
    latencySamples: 0,
    clippingRisk: false,
    error: null,
  };
  const dspRackState = {
    schemaVersion: 2 as const,
    order: ['equalizer', 'convolution', 'replayGain', 'compressor', 'channelBalance'],
    reorderableModules: ['equalizer', 'convolution', 'replayGain', 'compressor', 'channelBalance'],
    fixedPostStages: ['headroom', 'truePeakLimiter', 'playbackRate', 'levelMeter'],
    compressor: {
      enabled: false,
      thresholdDb: -18,
      ratio: 4,
      attackMs: 10,
      releaseMs: 120,
      kneeDb: 6,
      makeupDb: 0,
      mix: 1,
      gainReductionDb: 0,
      clippingRisk: false,
    },
  };
  const eqStateStore = {
    loadEqState: vi.fn(() => eqState),
    saveEqState: vi.fn(),
    loadChannelBalanceState: vi.fn(() => ({
      enabled: false,
      balance: 0,
      leftGainDb: 0,
      rightGainDb: 0,
      bandGains: {},
      leftDelayMs: 0,
      rightDelayMs: 0,
      swapLeftRight: false,
      monoMode: 'off',
      invertLeft: false,
      invertRight: false,
      constantPower: true,
      clippingRisk: false,
    })),
    saveChannelBalanceState: vi.fn(),
    loadRoomCorrectionState: vi.fn(() => roomCorrectionState),
    saveRoomCorrectionState: vi.fn(),
    loadDspRackState: vi.fn(() => dspRackState),
    saveDspRackState: vi.fn(),
    listPresets: vi.fn(() => []),
    savePreset: vi.fn(),
    deletePreset: vi.fn(),
    listProfiles: vi.fn(() => []),
    saveProfile: vi.fn(),
    deleteProfile: vi.fn(),
    bindProfileToOutput: vi.fn(),
    getProfileBinding: vi.fn(() => null),
    importRoomCorrectionIr: vi.fn(),
  };

  return { eqState, roomCorrectionState, dspRackState, eqStateStore };
});

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []), fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../audio/AudioSession', () => ({ getAudioSession: vi.fn() }));
vi.mock('../audio/AudioExportService', () => ({ exportAudioFile: vi.fn() }));
vi.mock('../audio/DspStateSync', () => ({ syncPersistedDspStateToNative: vi.fn() }));
vi.mock('../audio/EqStateStore', () => ({ EqStateStore: state.eqStateStore }));
vi.mock('../audio/HostBridgeRegistry', () => ({ activeJsonRpcBridge: null }));
vi.mock('../audio/OpraService', () => ({ getOpraService: vi.fn() }));
vi.mock('../audio/WindowsAudioServiceManager', () => ({ restartWindowsAudioService: vi.fn() }));
vi.mock('../diagnostics/CrashReportService', () => ({
  getCrashReportService: () => ({ reportAudioError: vi.fn() }),
}));
vi.mock('../lyrics/LyricsProgressTracker', () => ({ startLyricsProgressTracking: vi.fn() }));
vi.mock('../protocol/audioProtocol', () => ({ createSystemAudioStreamUrl: vi.fn() }));
vi.mock('./audioCommandQueue', () => ({
  enqueueAudioCommand: async <T>(command: () => Promise<T>): Promise<T> => command(),
  isAudioCommandTimeoutError: () => false,
}));

import { createDaemonDspBridge } from './audioIpc';

describe('daemon DSP bridge host acknowledgement', () => {
  beforeEach(() => {
    Object.assign(state.eqState, {
      enabled: false,
      preampDb: 0,
      dspHeadroomDb: 0,
      dspSafetyLimiterEnabled: true,
      bands: [],
      presetId: 'flat',
      presetName: 'Flat',
      clippingRisk: false,
    });
    Object.assign(state.roomCorrectionState, {
      enabled: false,
      status: 'empty',
      irId: null,
      irName: null,
      channelMode: 'none',
      sampleRate: null,
      tapCount: 0,
      trimDb: 0,
      latencySamples: 0,
      clippingRisk: false,
      error: null,
    });
    Object.assign(state.dspRackState.compressor, {
      enabled: false,
      thresholdDb: -18,
      ratio: 4,
      attackMs: 10,
      releaseMs: 120,
      kneeDb: 6,
      makeupDb: 0,
      mix: 1,
      gainReductionDb: 0,
      clippingRisk: false,
    });
    Object.values(state.eqStateStore).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
    });
    vi.restoreAllMocks();
  });

  it('propagates rejected live EQ and DSP mutations instead of reporting success', async () => {
    const nativeError = new Error('native_dsp_rejected');
    const nativeBridge = {
      isClosed: false,
      setPreamp: vi.fn().mockRejectedValue(nativeError),
      setDspHeadroom: vi.fn().mockRejectedValue(nativeError),
    };
    const bridge = createDaemonDspBridge(nativeBridge as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(bridge.setPreamp(-3)).rejects.toBe(nativeError);
    await expect(bridge.setDspHeadroom(-4)).rejects.toBe(nativeError);

    expect(nativeBridge.setPreamp).toHaveBeenCalledWith(-3);
    expect(nativeBridge.setDspHeadroom).toHaveBeenCalledWith(-4);
    expect(state.eqStateStore.saveEqState).toHaveBeenCalledWith(expect.objectContaining({ preampDb: -3 }));
    expect(state.eqStateStore.saveEqState).toHaveBeenCalledWith(expect.objectContaining({ dspHeadroomDb: -4 }));
    expect(warnSpy).toHaveBeenCalledWith('[dsp-bridge] nativeApplyFailed:setPreamp', nativeError.message);
    expect(warnSpy).toHaveBeenCalledWith('[dsp-bridge] nativeApplyFailed:setDspHeadroom', nativeError.message);
  });

  it('propagates a rejected live room-correction update while retaining desired state for rehydrate', async () => {
    const nativeError = new Error('native_room_correction_rejected');
    const nativeBridge = {
      isClosed: false,
      setRoomCorrectionEnabled: vi.fn().mockRejectedValue(nativeError),
    };
    const bridge = createDaemonDspBridge(nativeBridge as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(bridge.setRoomCorrectionEnabled(true)).rejects.toBe(nativeError);

    expect(nativeBridge.setRoomCorrectionEnabled).toHaveBeenCalledWith(true);
    expect(state.eqStateStore.saveRoomCorrectionState).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    expect(warnSpy).toHaveBeenCalledWith('[dsp-bridge] nativeApplyFailed:roomCorrection', nativeError.message);
  });

  it('awaits native compressor acknowledgement and retains the desired state for rehydrate', async () => {
    const nativeError = new Error('native_compressor_rejected');
    const nativeBridge = {
      isClosed: false,
      setCompressorState: vi.fn().mockRejectedValue(nativeError),
    };
    const bridge = createDaemonDspBridge(nativeBridge as never);

    await expect(bridge.setCompressorState({ enabled: true, thresholdDb: -24 })).rejects.toBe(nativeError);

    expect(nativeBridge.setCompressorState).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, thresholdDb: -24 }));
    expect(state.eqStateStore.saveDspRackState).toHaveBeenCalledWith(expect.objectContaining({
      compressor: expect.objectContaining({ enabled: true, thresholdDb: -24 }),
    }));
  });
});
