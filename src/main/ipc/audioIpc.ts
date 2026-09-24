import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize, sep } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { startLyricsProgressTracking } from '../lyrics/LyricsProgressTracker';
import { expandEqualizerApoIncludes, formatEqualizerApoGraphicEqPreset, formatEqualizerApoPreset, parseEqualizerApoPreset } from '../../shared/utils/equalizerApoPreset';
import type {
  AudioDiagnostics,
  AudioDeviceInfo,
  AudioExportRequest,
  AudioExportResult,
  AudioStatus,
  ChannelBalanceState,
} from '../../shared/types/audio';
import type {
  OpraHeadphoneCorrectionApplyRequest,
  OpraHeadphoneCorrectionApplyResult,
  OpraHeadphoneCorrectionBrowseRequest,
  OpraHeadphoneCorrectionBrowseResult,
  OpraHeadphoneCorrectionSearchRequest,
  OpraHeadphoneCorrectionSearchResult,
} from '../../shared/types/opra';
import type {
  EqBindProfileRequest,
  EqPreset,
  EqPresetImportMetadata,
  EqPresetImportPreviewResult,
  EqPresetImportResult,
  EqProfile,
  EqProfileBindingInfo,
  EqProfileBindingTarget,
  EqSavePresetRequest,
  EqSaveProfileRequest,
  EqSetBandEnabledRequest,
  EqSetBandFilterTypeRequest,
  EqSetBandFrequencyRequest,
  EqSetBandGainRequest,
  EqSetBandQRequest,
  EqBand,
  EqState,
  RoomCorrectionState,
} from '../../shared/types/eq';
import { getAudioSession } from '../audio/AudioSession';
import { exportAudioFile } from '../audio/AudioExportService';
import { EqStateStore } from '../audio/EqStateStore';
import { syncPersistedDspStateToNative } from '../audio/DspStateSync';
import type { JsonRpcBridge } from '../audio/JsonRpcBridge';
import type { AudioBackendQueueItem } from '../audio/AudioBackend';
import { activeJsonRpcBridge } from '../audio/HostBridgeRegistry';
import { getOpraService } from '../audio/OpraService';
import { requireLocalPro } from '../plugins/LocalProEntitlements';
import { restartWindowsAudioService } from '../audio/WindowsAudioServiceManager';
import { getCrashReportService } from '../diagnostics/CrashReportService';
import { createSystemAudioStreamUrl } from '../protocol/audioProtocol';
import { enqueueAudioCommand, isAudioCommandTimeoutError } from './audioCommandQueue';
import { requireEchoProForAudioDspPatch } from './audioProFeatureGate';
import { requireAudioOutputSettings } from './normalizeAudioOutputSettings';
import { isAuthorizationFailure } from '../../shared/ipcAuthorizationFailure';
import {
  normalizeDspRackState,
  type ChannelMatrixState,
  type CompressorState,
  type CrossfeedState,
  type DspRackState,
  type StereoFieldState,
} from '../../shared/types/dspRack';

const systemAudioOutputBackend = 'system-audio';
const systemAudioBackendImpl = 'electron-html-audio';

const withDspPro = <Result>(action: () => Result): Result => {
  requireLocalPro('dsp');
  return action();
};

const safeExportFileName = (value: string): string => {
  // eslint-disable-next-line no-control-regex -- Control chars are illegal in Windows file names.
  const trimmed = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed.slice(0, 96) : 'ECHO Next EQ Preset';
};

const safePresetId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || `preset-${Date.now()}`;

const uniqueImportedPresetId = (name: string, existingIds: Set<string>): string => {
  const baseId = safePresetId(name);
  let candidate = baseId;
  let suffix = 2;

  while (existingIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidate;
};

const defaultImportedPresetName = (filePath: string): string => {
  const extension = extname(filePath);
  const fileName = basename(filePath, extension).trim();
  return fileName || 'Imported EQ Preset';
};

const expandWindowsEnvironmentVariables = (input: string): string =>
  input.replace(/%([^%]+)%/g, (match, name: string) => {
    const value = process.env[name] ?? process.env[name.toUpperCase()] ?? process.env[name.toLowerCase()];
    return value && value.trim() ? value : match;
  });

const normalizeEqualizerApoIncludePath = (input: string): string =>
  normalize(input.replace(/\\/g, sep));

type ParsedEqPresetImport = EqSavePresetRequest & {
  metadata: EqPresetImportMetadata;
};

const parseEchoEqPresetImport = (rawContent: string): ParsedEqPresetImport | null => {
  const parsed = JSON.parse(rawContent) as unknown;
  const payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as { preset?: Partial<EqSavePresetRequest>; name?: unknown; preampDb?: unknown; bands?: unknown }
    : null;
  const candidate = payload?.preset && typeof payload.preset === 'object' ? payload.preset : payload;

  if (!candidate || typeof candidate.name !== 'string') {
    return null;
  }

  return {
    name: candidate.name,
    preampDb: Number(candidate.preampDb ?? 0),
    bands: candidate.bands as EqSavePresetRequest['bands'],
    metadata: {
      source: 'echo-json',
      importedFilterCount: Array.isArray(candidate.bands) ? candidate.bands.length : 0,
      skippedFilterCount: 0,
      graphicEqPointCount: 0,
      includedFileCount: 0,
      skippedIncludeCount: 0,
      unsupportedDirectiveCount: 0,
      unsupportedDirectiveSummary: {},
      channelScopedFilterCount: 0,
      bandwidthFilterCount: 0,
      warnings: [],
    },
  };
};

const parseImportedEqPreset = (rawContent: string, filePath: string): ParsedEqPresetImport => {
  const trimmed = rawContent.trimStart();

  if (trimmed.startsWith('{')) {
    const echoPreset = parseEchoEqPresetImport(rawContent);
    if (!echoPreset) {
      throw new Error('invalid_eq_preset_import');
    }

    return echoPreset;
  }

  const sourcePath = normalize(filePath);
  const expandedApoPreset = expandEqualizerApoIncludes(rawContent, (includePath, context) => {
    const parentPath = context.sourcePath ?? sourcePath;
    const expandedIncludePath = normalizeEqualizerApoIncludePath(expandWindowsEnvironmentVariables(includePath));
    const includeFilePath = isAbsolute(expandedIncludePath) ? expandedIncludePath : normalize(join(dirname(parentPath), expandedIncludePath));
    return {
      content: readFileSync(includeFilePath, 'utf8'),
      sourcePath: includeFilePath,
    };
  }, { sourcePath });
  const equalizerApoPreset = parseEqualizerApoPreset(expandedApoPreset.content, { name: defaultImportedPresetName(filePath) });
  return {
    name: equalizerApoPreset.name,
    preampDb: equalizerApoPreset.preampDb,
    bands: equalizerApoPreset.bands,
    metadata: {
      source: 'equalizer-apo',
      importedFilterCount: equalizerApoPreset.importedFilterCount,
      skippedFilterCount: equalizerApoPreset.skippedFilterCount,
      graphicEqPointCount: equalizerApoPreset.graphicEqPointCount,
      includedFileCount: expandedApoPreset.includedFileCount,
      skippedIncludeCount: expandedApoPreset.skippedIncludeCount,
      unsupportedDirectiveCount: equalizerApoPreset.unsupportedDirectiveCount,
      unsupportedDirectiveSummary: equalizerApoPreset.unsupportedDirectiveSummary,
      channelScopedFilterCount: equalizerApoPreset.channelScopedFilterCount,
      bandwidthFilterCount: equalizerApoPreset.bandwidthFilterCount,
      warnings: [...expandedApoPreset.warnings, ...equalizerApoPreset.warnings],
    },
  };
};

const createEqPresetImportPreview = (filePath: string): EqPresetImportPreviewResult => {
  const candidate = parseImportedEqPreset(readFileSync(filePath, 'utf8'), filePath);
  const eqBridge = getDspBridge();
  return {
    request: {
      id: uniqueImportedPresetId(candidate.name, new Set(eqBridge.listPresets().map((preset: EqPreset) => preset.id))),
      name: candidate.name,
      preampDb: Number(candidate.preampDb ?? 0),
      bands: candidate.bands,
    },
    metadata: candidate.metadata,
    fileName: basename(filePath),
  };
};

const exportEqPreset = async (request: EqSavePresetRequest): Promise<string | null> => {
  const savedName = typeof request.name === 'string' && request.name.trim() ? request.name.trim() : 'ECHO Next EQ Preset';
  const result = await dialog.showSaveDialog({
    title: 'Export EQ Preset',
    defaultPath: `${safeExportFileName(savedName)}.json`,
    filters: [{ name: 'ECHO Next EQ Preset', extensions: ['json'] }],
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  writeFileSync(
    result.filePath,
    `${JSON.stringify(
      {
        type: 'echo-next-eq-preset',
        version: 1,
        exportedAt: new Date().toISOString(),
        preset: {
          name: savedName,
          preampDb: request.preampDb,
          bands: request.bands,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return result.filePath;
};

const exportEqualizerApoPreset = async (request: EqSavePresetRequest): Promise<string | null> => {
  const savedName = typeof request.name === 'string' && request.name.trim() ? request.name.trim() : 'ECHO Next EQ Preset';
  const result = await dialog.showSaveDialog({
    title: 'Export Equalizer APO Preset',
    defaultPath: `${safeExportFileName(savedName)}.txt`,
    filters: [{ name: 'Equalizer APO config', extensions: ['txt', 'cfg'] }],
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  writeFileSync(result.filePath, formatEqualizerApoPreset(request), 'utf8');
  return result.filePath;
};

const exportEqualizerApoGraphicEqPreset = async (request: EqSavePresetRequest): Promise<string | null> => {
  const savedName = typeof request.name === 'string' && request.name.trim() ? request.name.trim() : 'ECHO Next EQ Preset';
  const result = await dialog.showSaveDialog({
    title: 'Export Equalizer APO GraphicEQ',
    defaultPath: `${safeExportFileName(savedName)} GraphicEQ.txt`,
    filters: [{ name: 'Equalizer APO GraphicEQ', extensions: ['txt', 'cfg'] }],
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  writeFileSync(result.filePath, formatEqualizerApoGraphicEqPreset(request), 'utf8');
  return result.filePath;
};

const previewImportEqPreset = async (): Promise<EqPresetImportPreviewResult | null> => {
  const result = await dialog.showOpenDialog({
    title: 'Import EQ Preset',
    filters: [
      { name: 'EQ Preset / REW / Equalizer APO / AutoEq', extensions: ['json', 'txt', 'cfg', 'apo'] },
      { name: 'ECHO Next EQ Preset', extensions: ['json'] },
      { name: 'REW / Equalizer APO / AutoEq', extensions: ['txt', 'cfg', 'apo'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return createEqPresetImportPreview(result.filePaths[0]);
};

const importEqPreset = async (): Promise<EqPresetImportResult | null> => {
  const preview = await previewImportEqPreset();
  if (!preview) {
    return null;
  }
  const eqBridge = getDspBridge();

  const preset = eqBridge.savePreset(preview.request);

  return {
    preset,
    metadata: preview.metadata,
  };
};

const importRoomCorrectionIr = async (window: BrowserWindow | null): Promise<RoomCorrectionState | null> => {
  const options: OpenDialogOptions = {
    title: 'Import Room Correction IR',
    filters: [{ name: 'WAV impulse response', extensions: ['wav'] }],
    properties: ['openFile'],
  };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return getDspBridge().importRoomCorrectionIr(result.filePaths[0]);
};

const normalizeOutputSettings = requireAudioOutputSettings;

const reportAudioIpcError = (error: unknown, phase: string, details?: unknown): void => {
  if (isAuthorizationFailure(error)) {
    return;
  }

  const normalized = error instanceof Error ? error : new Error(String(error));
  const status = getAudioSession().getStatus();

  if (status.error === normalized.message) {
    return;
  }

  getCrashReportService().reportAudioError({
    message: normalized.message,
    stack: normalized.stack,
    phase,
    severity: 'fatal',
    details,
    audioStatus: status,
  });
};

const enqueueAudioStatusCommand = async (fn: () => Promise<AudioStatus> | AudioStatus): Promise<AudioStatus> => {
  try {
    return await enqueueAudioCommand(fn);
  } catch (error) {
    if (isAudioCommandTimeoutError(error)) {
      console.warn('[audioIpc] audio command timed out; returning current status');
      return getAudioSession().getStatus();
    }

    throw error;
  }
};

const normalizeSystemStreamRequest = (value: unknown): { url: string; headers?: Record<string, string>; mimeType?: string | null } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('system audio stream request must be an object');
  }

  const input = value as Record<string, unknown>;
  if (typeof input.url !== 'string' || !input.url.trim()) {
    throw new Error('system audio stream url is required');
  }

  const headers: Record<string, string> = {};
  if (input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers)) {
    Object.entries(input.headers as Record<string, unknown>).forEach(([key, headerValue]) => {
      if (typeof headerValue === 'string' && key.trim()) {
        headers[key] = headerValue;
      }
    });
  }

  return {
    url: input.url,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    mimeType: typeof input.mimeType === 'string' && input.mimeType.trim() ? input.mimeType : null,
  };
};

const safeText = (value: unknown, maxLength = 240): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
};

const normalizeHtmlAudioDiagnostics = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  const srcType = safeText(input.srcType, 32);
  return {
    networkState: typeof input.networkState === 'number' && Number.isFinite(input.networkState) ? input.networkState : null,
    readyState: typeof input.readyState === 'number' && Number.isFinite(input.readyState) ? input.readyState : null,
    errorCode: typeof input.errorCode === 'number' && Number.isFinite(input.errorCode) ? input.errorCode : null,
    errorMessage: safeText(input.errorMessage, 160),
    srcType,
  };
};

const normalizeSafePathDiagnostics = (value: unknown): { basename: string; pathHash: string } | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  const basename = safeText(input.basename, 180);
  const pathHash = safeText(input.pathHash, 64);
  return basename && pathHash ? { basename, pathHash } : null;
};

const normalizeNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const normalizeFirstFfprobeResult = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  return {
    codec: safeText(input.codec, 80),
    container: safeText(input.container, 40),
    duration: normalizeNumberOrNull(input.duration),
    fileSampleRate: normalizeNumberOrNull(input.fileSampleRate),
    bitDepth: normalizeNumberOrNull(input.bitDepth),
    bitrate: normalizeNumberOrNull(input.bitrate),
    channels: normalizeNumberOrNull(input.channels),
  };
};

const normalizeSystemPlaybackErrorReport = (value: unknown): {
  message: string;
  phase: string;
  severity: 'recoverable' | 'fatal';
  recovered: boolean;
  details: Record<string, unknown>;
} => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('system audio error report must be an object');
  }

  const input = value as Record<string, unknown>;
  const phase = safeText(input.phase, 80) ?? 'system-audio-htmlaudio-error';
  const message = safeText(input.message) ?? phase;
  const recovered = input.recovered === true;
  const mediaType = input.mediaType === 'streaming' || input.mediaType === 'remote' || input.mediaType === 'local'
    ? input.mediaType
    : null;
  const htmlAudio = normalizeHtmlAudioDiagnostics(input.htmlAudio);

  return {
    message,
    phase,
    severity: recovered ? 'recoverable' : 'fatal',
    recovered,
    details: {
      outputMode: 'system',
      currentFilePath: normalizeSafePathDiagnostics(input.currentFilePath),
      mediaType,
      provider: safeText(input.provider, 64),
      trackId: safeText(input.trackId, 128),
      sourceKind: input.sourceKind === 'remote' || input.sourceKind === 'local' || input.sourceKind === 'renderer'
        ? input.sourceKind
        : null,
      sourceHost: safeText(input.sourceHost, 128),
      mimeType: safeText(input.mimeType, 96),
      codec: safeText(input.codec, 80),
      container: safeText(input.container, 40),
      duration: normalizeNumberOrNull(input.duration),
      fileSampleRate: normalizeNumberOrNull(input.fileSampleRate),
      bitDepth: normalizeNumberOrNull(input.bitDepth),
      firstFfprobeResult: normalizeFirstFfprobeResult(input.firstFfprobeResult),
      recoveryAttempt: typeof input.recoveryAttempt === 'number' && Number.isFinite(input.recoveryAttempt)
        ? Math.max(0, Math.round(input.recoveryAttempt))
        : null,
      maxRecoveryAttempts: typeof input.maxRecoveryAttempts === 'number' && Number.isFinite(input.maxRecoveryAttempts)
        ? Math.max(0, Math.round(input.maxRecoveryAttempts))
        : null,
      htmlAudio,
    },
  };
};

const reportSystemPlaybackError = (rawReport: unknown): void => {
  const report = normalizeSystemPlaybackErrorReport(rawReport);
  const status = getAudioSession().getStatus();
  const audioStatus: AudioStatus = {
    ...status,
    outputMode: 'system',
    outputBackend: systemAudioOutputBackend,
    activeOutputBackendImpl: systemAudioBackendImpl,
    error: report.recovered ? null : report.message,
  };

  getCrashReportService().reportAudioError({
    message: report.message,
    phase: report.phase,
    severity: report.severity,
    recovered: report.recovered,
    details: report.details,
    audioStatus,
  });
};

type DaemonDspNativeBridge = Pick<JsonRpcBridge,
  | 'getCompressorState'
  | 'getCrossfeedState'
  | 'getStereoFieldState'
  | 'getChannelMatrixState'
  | 'setEnabled'
  | 'setBandGain'
  | 'setBandFrequency'
  | 'setBandQ'
  | 'setBandFilterType'
  | 'setBandEnabled'
  | 'setPreamp'
  | 'setDspHeadroom'
  | 'setDspSafetyLimiterEnabled'
  | 'setDspRackState'
  | 'setCompressorState'
  | 'setCrossfeedState'
  | 'setStereoFieldState'
  | 'setChannelMatrixState'
  | 'setPreset'
  | 'setState'
  | 'reset'
  | 'setChannelBalanceState'
  | 'resetChannelBalance'
  | 'importRoomCorrectionIr'
  | 'setRoomCorrectionEnabled'
  | 'setRoomCorrectionTrim'
  | 'clearRoomCorrection'
> & { readonly isClosed?: boolean };

type DaemonDspBridge = {
  getState: () => EqState;
  getEqState: () => Promise<EqState>;
  getChannelBalanceState: () => ChannelBalanceState;
  getRoomCorrectionState: () => RoomCorrectionState;
  getDspRackState: () => DspRackState;
  getCompressorState: () => Promise<CompressorState>;
  getCrossfeedState: () => Promise<CrossfeedState>;
  getStereoFieldState: () => Promise<StereoFieldState>;
  getChannelMatrixState: () => Promise<ChannelMatrixState>;
  setEnabled: (enabled: boolean) => Promise<EqState>;
  setBandGain: (request: EqSetBandGainRequest) => Promise<EqState>;
  setBandFrequency: (request: EqSetBandFrequencyRequest) => Promise<EqState>;
  setBandQ: (request: EqSetBandQRequest) => Promise<EqState>;
  setBandFilterType: (request: EqSetBandFilterTypeRequest) => Promise<EqState>;
  setBandEnabled: (request: EqSetBandEnabledRequest) => Promise<EqState>;
  setPreamp: (preampDb: number) => Promise<EqState>;
  setDspHeadroom: (headroomDb: number) => Promise<EqState>;
  setDspSafetyLimiterEnabled: (enabled: boolean) => Promise<EqState>;
  setDspRackState: (state: Pick<DspRackState, 'order'>) => Promise<DspRackState>;
  setCompressorState: (state: Partial<CompressorState>) => Promise<CompressorState>;
  setCrossfeedState: (state: Partial<CrossfeedState>) => Promise<CrossfeedState>;
  setStereoFieldState: (state: Partial<StereoFieldState>) => Promise<StereoFieldState>;
  setChannelMatrixState: (state: Partial<ChannelMatrixState>) => Promise<ChannelMatrixState>;
  setPreset: (presetId: string) => Promise<EqState>;
  reset: () => Promise<EqState>;
  listPresets: () => EqPreset[];
  savePreset: (request: EqSavePresetRequest) => EqPreset;
  deletePreset: (presetId: string) => EqPreset[];
  listProfiles: () => EqProfile[];
  saveProfile: (request: EqSaveProfileRequest) => EqProfile;
  applyProfile: (profileId: string) => Promise<EqState>;
  deleteProfile: (profileId: string) => EqProfile[];
  bindProfileToOutput: (request: EqBindProfileRequest) => EqProfileBindingInfo;
  getProfileBinding: (target: EqProfileBindingTarget) => EqProfileBindingInfo;
  setChannelBalanceState: (patch: Partial<ChannelBalanceState>) => Promise<ChannelBalanceState>;
  resetChannelBalance: () => Promise<ChannelBalanceState>;
  importRoomCorrectionIr: (sourcePath: string) => Promise<RoomCorrectionState>;
  setRoomCorrectionEnabled: (enabled: boolean) => Promise<RoomCorrectionState>;
  setRoomCorrectionTrim: (trimDb: number) => Promise<RoomCorrectionState>;
  clearRoomCorrection: () => Promise<RoomCorrectionState>;
};

const noopDspBridge: DaemonDspBridge = {
  getState: (): EqState => EqStateStore.loadEqState(),
  getEqState: async (): Promise<EqState> => EqStateStore.loadEqState(),
  getChannelBalanceState: (): ChannelBalanceState => EqStateStore.loadChannelBalanceState(),
  getRoomCorrectionState: (): RoomCorrectionState => EqStateStore.loadRoomCorrectionState(),
  getDspRackState: (): DspRackState => EqStateStore.loadDspRackState(),
  getCompressorState: async (): Promise<CompressorState> => EqStateStore.loadDspRackState().compressor,
  getCrossfeedState: async (): Promise<CrossfeedState> => EqStateStore.loadDspRackState().crossfeed,
  getStereoFieldState: async (): Promise<StereoFieldState> => EqStateStore.loadDspRackState().stereoField,
  getChannelMatrixState: async (): Promise<ChannelMatrixState> => EqStateStore.loadDspRackState().channelMatrix,
  setEnabled: async (enabled: boolean): Promise<EqState> => {
    const state = EqStateStore.loadEqState();
    state.enabled = enabled;
    EqStateStore.saveEqState(state);
    return state;
  },
  setBandGain: async (): Promise<EqState> => EqStateStore.loadEqState(),
  setBandFrequency: async (): Promise<EqState> => EqStateStore.loadEqState(),
  setBandQ: async (): Promise<EqState> => EqStateStore.loadEqState(),
  setBandFilterType: async (): Promise<EqState> => EqStateStore.loadEqState(),
  setBandEnabled: async (): Promise<EqState> => EqStateStore.loadEqState(),
  setPreamp: async (preampDb: number): Promise<EqState> => {
    const state = EqStateStore.loadEqState();
    state.preampDb = preampDb;
    EqStateStore.saveEqState(state);
    return state;
  },
  setDspHeadroom: async (headroomDb: number): Promise<EqState> => {
    const state = EqStateStore.loadEqState();
    state.dspHeadroomDb = headroomDb;
    EqStateStore.saveEqState(state);
    return state;
  },
  setDspSafetyLimiterEnabled: async (enabled: boolean): Promise<EqState> => {
    const state = EqStateStore.loadEqState();
    state.dspSafetyLimiterEnabled = enabled;
    EqStateStore.saveEqState(state);
    return state;
  },
  setDspRackState: async (state: Pick<DspRackState, 'order'>): Promise<DspRackState> => {
    const normalized = normalizeDspRackState({ ...EqStateStore.loadDspRackState(), ...state });
    EqStateStore.saveDspRackState(normalized);
    return normalized;
  },
  setCompressorState: async (patch: Partial<CompressorState>): Promise<CompressorState> => {
    const current = EqStateStore.loadDspRackState();
    const normalized = normalizeDspRackState({ ...current, compressor: { ...current.compressor, ...patch } });
    EqStateStore.saveDspRackState(normalized);
    return normalized.compressor;
  },
  setCrossfeedState: async (patch: Partial<CrossfeedState>): Promise<CrossfeedState> => {
    const current = EqStateStore.loadDspRackState();
    const normalized = normalizeDspRackState({ ...current, crossfeed: { ...current.crossfeed, ...patch } });
    EqStateStore.saveDspRackState(normalized);
    return normalized.crossfeed;
  },
  setStereoFieldState: async (patch: Partial<StereoFieldState>): Promise<StereoFieldState> => {
    const current = EqStateStore.loadDspRackState();
    const normalized = normalizeDspRackState({ ...current, stereoField: { ...current.stereoField, ...patch } });
    EqStateStore.saveDspRackState(normalized);
    return normalized.stereoField;
  },
  setChannelMatrixState: async (patch: Partial<ChannelMatrixState>): Promise<ChannelMatrixState> => {
    const current = EqStateStore.loadDspRackState();
    const normalized = normalizeDspRackState({ ...current, channelMatrix: { ...current.channelMatrix, ...patch } });
    EqStateStore.saveDspRackState(normalized);
    return normalized.channelMatrix;
  },
  setPreset: async (_presetId: string): Promise<EqState> => EqStateStore.loadEqState(),
  reset: async (): Promise<EqState> => EqStateStore.loadEqState(),
  listPresets: (): EqPreset[] => EqStateStore.listPresets(),
  savePreset: (request: EqSavePresetRequest): EqPreset => EqStateStore.savePreset(request),
  deletePreset: (presetId: string): EqPreset[] => {
    EqStateStore.deletePreset(presetId);
    return EqStateStore.listPresets();
  },
  listProfiles: (): EqProfile[] => EqStateStore.listProfiles(),
  saveProfile: (request: EqSaveProfileRequest): EqProfile => EqStateStore.saveProfile(request),
  applyProfile: async (): Promise<EqState> => EqStateStore.loadEqState(),
  deleteProfile: (profileId: string): EqProfile[] => {
    EqStateStore.deleteProfile(profileId);
    return EqStateStore.listProfiles();
  },
  bindProfileToOutput: (request: EqBindProfileRequest): EqProfileBindingInfo =>
    EqStateStore.bindProfileToOutput(request),
  getProfileBinding: (target: EqProfileBindingTarget): EqProfileBindingInfo =>
    EqStateStore.getProfileBinding(target),
  setChannelBalanceState: async (patch: Partial<ChannelBalanceState>): Promise<ChannelBalanceState> => {
    const current = EqStateStore.loadChannelBalanceState();
    const merged = { ...current, ...patch };
    EqStateStore.saveChannelBalanceState(merged);
    return merged;
  },
  resetChannelBalance: async (): Promise<ChannelBalanceState> => {
    const defaultState: ChannelBalanceState = {
      enabled: false, balance: 0, leftGainDb: 0, rightGainDb: 0,
      bandGains: {
        low: { leftGainDb: 0, rightGainDb: 0 },
        mid: { leftGainDb: 0, rightGainDb: 0 },
        high: { leftGainDb: 0, rightGainDb: 0 },
      },
      leftDelayMs: 0, rightDelayMs: 0,
      swapLeftRight: false, monoMode: 'off',
      invertLeft: false, invertRight: false,
      constantPower: true, clippingRisk: false,
    };
    EqStateStore.saveChannelBalanceState(defaultState);
    return defaultState;
  },
  importRoomCorrectionIr: async (sourcePath: string): Promise<RoomCorrectionState> => {
    EqStateStore.importRoomCorrectionIr(sourcePath);
    return EqStateStore.loadRoomCorrectionState();
  },
  setRoomCorrectionEnabled: async (enabled: boolean): Promise<RoomCorrectionState> => {
    const state = EqStateStore.loadRoomCorrectionState();
    state.enabled = enabled;
    EqStateStore.saveRoomCorrectionState(state);
    return state;
  },
  setRoomCorrectionTrim: async (trimDb: number): Promise<RoomCorrectionState> => {
    const state = EqStateStore.loadRoomCorrectionState();
    state.trimDb = trimDb;
    EqStateStore.saveRoomCorrectionState(state);
    return state;
  },
  clearRoomCorrection: async (): Promise<RoomCorrectionState> => {
    const state = EqStateStore.loadRoomCorrectionState();
    EqStateStore.saveRoomCorrectionState({
      ...state, enabled: false, status: 'empty', irId: null, irName: null,
    });
    return EqStateStore.loadRoomCorrectionState();
  },
};

/**
 * Create a DSP bridge wrapper that persists EQ/DSP/balance/room-correction
 * mutations to EqStateStore before forwarding to the native JsonRpcBridge.
 * The persisted copy remains the desired state for a later host rehydrate, but
 * a live daemon mutation resolves only after the native host acknowledges it.
 */
function createDaemonDspBridge(jrpc: DaemonDspNativeBridge): DaemonDspBridge {
  const logNativeFailure = (tag: string, error: unknown): void => {
    console.warn(`[dsp-bridge] nativeApplyFailed:${tag}`, error instanceof Error ? error.message : String(error));
  };

  const forwardNative = async (tag: string, apply: () => Promise<unknown>): Promise<void> => {
    if (jrpc.isClosed === true) {
      const error = new Error('rpc_bridge_not_open');
      logNativeFailure(tag, error);
      throw error;
    }
    try {
      await apply();
    } catch (error) {
      logNativeFailure(tag, error);
      throw error;
    }
  };

  // ── EQ state helpers ──

  const mutateEqState = (mutator: (state: EqState) => void): EqState => {
    const state = EqStateStore.loadEqState();
    mutator(state);
    EqStateStore.saveEqState(state);
    return state;
  };

  const mutateBand = (bandIndex: number, mutator: (band: EqBand) => void): EqState => {
    return mutateEqState((state) => {
      if (bandIndex >= 0 && bandIndex < state.bands.length) {
        mutator(state.bands[bandIndex]);
      }
    });
  };

  // ── Channel balance helpers ──

  const mutateChannelBalance = (mutator: (state: ChannelBalanceState) => ChannelBalanceState): ChannelBalanceState => {
    const current = EqStateStore.loadChannelBalanceState();
    const merged = mutator(current);
    EqStateStore.saveChannelBalanceState(merged);
    return merged;
  };

  // ── Room correction helpers ──

  const mutateRoomCorrection = (mutator: (state: RoomCorrectionState) => RoomCorrectionState): RoomCorrectionState => {
    const current = EqStateStore.loadRoomCorrectionState();
    const merged = mutator(current);
    EqStateStore.saveRoomCorrectionState(merged);
    return merged;
  };

  return {
    // ── Sync getters (read from store) ──

    getState: (): EqState => EqStateStore.loadEqState(),
    getEqState: async (): Promise<EqState> => EqStateStore.loadEqState(),
    getChannelBalanceState: (): ChannelBalanceState => EqStateStore.loadChannelBalanceState(),
    getRoomCorrectionState: (): RoomCorrectionState => EqStateStore.loadRoomCorrectionState(),
    getDspRackState: (): DspRackState => EqStateStore.loadDspRackState(),
    getCompressorState: async (): Promise<CompressorState> => {
      const current = EqStateStore.loadDspRackState();
      const applied = await jrpc.getCompressorState();
      return normalizeDspRackState({ ...current, compressor: applied }).compressor;
    },
    getCrossfeedState: async (): Promise<CrossfeedState> => {
      const current = EqStateStore.loadDspRackState();
      return normalizeDspRackState({ ...current, crossfeed: await jrpc.getCrossfeedState() }).crossfeed;
    },
    getStereoFieldState: async (): Promise<StereoFieldState> => {
      const current = EqStateStore.loadDspRackState();
      return normalizeDspRackState({ ...current, stereoField: await jrpc.getStereoFieldState() }).stereoField;
    },
    getChannelMatrixState: async (): Promise<ChannelMatrixState> => {
      const current = EqStateStore.loadDspRackState();
      return normalizeDspRackState({ ...current, channelMatrix: await jrpc.getChannelMatrixState() }).channelMatrix;
    },

    // ── EQ enabled ──

    setEnabled: async (enabled: boolean): Promise<EqState> => {
      const state = mutateEqState((s) => { s.enabled = enabled; });
      await forwardNative('setEnabled', () => jrpc.setEnabled(enabled));
      return state;
    },

    // ── Band mutations (persist to EqStateStore, forward to native) ──

    setBandGain: async (request: EqSetBandGainRequest): Promise<EqState> => {
      const state = mutateBand(request.band, (band) => { band.gainDb = request.gainDb; });
      await forwardNative('setBandGain', () => jrpc.setBandGain(request));
      return state;
    },

    setBandFrequency: async (request: EqSetBandFrequencyRequest): Promise<EqState> => {
      const state = mutateBand(request.band, (band) => { band.frequencyHz = request.frequencyHz; });
      await forwardNative('setBandFrequency', () => jrpc.setBandFrequency(request));
      return state;
    },

    setBandQ: async (request: EqSetBandQRequest): Promise<EqState> => {
      const state = mutateBand(request.band, (band) => { band.q = request.q; });
      await forwardNative('setBandQ', () => jrpc.setBandQ(request));
      return state;
    },

    setBandFilterType: async (request: EqSetBandFilterTypeRequest): Promise<EqState> => {
      const state = mutateBand(request.band, (band) => { band.filterType = request.filterType; });
      await forwardNative('setBandFilterType', () => jrpc.setBandFilterType(request));
      return state;
    },

    setBandEnabled: async (request: EqSetBandEnabledRequest): Promise<EqState> => {
      const state = mutateBand(request.band, (band) => { band.enabled = request.enabled; });
      await forwardNative('setBandEnabled', () => jrpc.setBandEnabled(request));
      return state;
    },

    // ── Preamp ──

    setPreamp: async (preampDb: number): Promise<EqState> => {
      const state = mutateEqState((s) => { s.preampDb = preampDb; });
      await forwardNative('setPreamp', () => jrpc.setPreamp(preampDb));
      return state;
    },

    // ── DSP headroom / safety limiter ──

    setDspHeadroom: async (headroomDb: number): Promise<EqState> => {
      const state = mutateEqState((s) => { s.dspHeadroomDb = headroomDb; });
      await forwardNative('setDspHeadroom', () => jrpc.setDspHeadroom(headroomDb));
      return state;
    },

    setDspSafetyLimiterEnabled: async (enabled: boolean): Promise<EqState> => {
      const state = mutateEqState((s) => { s.dspSafetyLimiterEnabled = enabled; });
      await forwardNative('setDspSafetyLimiter', () => jrpc.setDspSafetyLimiterEnabled(enabled));
      return state;
    },

    setDspRackState: async (state: Pick<DspRackState, 'order'>): Promise<DspRackState> => {
      const normalized = normalizeDspRackState({ ...EqStateStore.loadDspRackState(), ...state });
      const applied = await jrpc.setDspRackState(normalized);
      const persisted = normalizeDspRackState({ ...applied, compressor: normalized.compressor });
      EqStateStore.saveDspRackState(persisted);
      return persisted;
    },

    setCompressorState: async (patch: Partial<CompressorState>): Promise<CompressorState> => {
      const current = EqStateStore.loadDspRackState();
      const normalized = normalizeDspRackState({ ...current, compressor: { ...current.compressor, ...patch } });
      EqStateStore.saveDspRackState(normalized);
      const applied = await jrpc.setCompressorState(normalized.compressor);
      const persisted = normalizeDspRackState({ ...normalized, compressor: applied });
      EqStateStore.saveDspRackState(persisted);
      return persisted.compressor;
    },
    setCrossfeedState: async (patch: Partial<CrossfeedState>): Promise<CrossfeedState> => {
      const current = EqStateStore.loadDspRackState();
      const normalized = normalizeDspRackState({ ...current, crossfeed: { ...current.crossfeed, ...patch } });
      EqStateStore.saveDspRackState(normalized);
      const applied = await jrpc.setCrossfeedState(normalized.crossfeed);
      const persisted = normalizeDspRackState({ ...normalized, crossfeed: applied });
      EqStateStore.saveDspRackState(persisted);
      return persisted.crossfeed;
    },
    setStereoFieldState: async (patch: Partial<StereoFieldState>): Promise<StereoFieldState> => {
      const current = EqStateStore.loadDspRackState();
      const normalized = normalizeDspRackState({ ...current, stereoField: { ...current.stereoField, ...patch } });
      EqStateStore.saveDspRackState(normalized);
      const applied = await jrpc.setStereoFieldState(normalized.stereoField);
      const persisted = normalizeDspRackState({ ...normalized, stereoField: applied });
      EqStateStore.saveDspRackState(persisted);
      return persisted.stereoField;
    },
    setChannelMatrixState: async (patch: Partial<ChannelMatrixState>): Promise<ChannelMatrixState> => {
      const current = EqStateStore.loadDspRackState();
      const normalized = normalizeDspRackState({ ...current, channelMatrix: { ...current.channelMatrix, ...patch } });
      EqStateStore.saveDspRackState(normalized);
      const applied = await jrpc.setChannelMatrixState(normalized.channelMatrix);
      const persisted = normalizeDspRackState({ ...normalized, channelMatrix: applied });
      EqStateStore.saveDspRackState(persisted);
      return persisted.channelMatrix;
    },

    // ── Preset apply ──

    setPreset: async (presetId: string): Promise<EqState> => {
      const presets = EqStateStore.listPresets();
      const preset = presets.find((p: EqPreset) => p.id === presetId);
      if (preset) {
        const state = mutateEqState((s) => {
          s.preampDb = preset.preampDb;
          s.bands = preset.bands.map((b: EqBand) => ({ ...b }));
          s.presetId = preset.id;
          s.presetName = preset.name;
        });
        await forwardNative('setPreset', () => jrpc.setState(state));
        return state;
      }
      return EqStateStore.loadEqState();
    },

    // ── EQ reset ──

    reset: async (): Promise<EqState> => {
      // Rebuild flat bands using EqStateStore's internal default
      const fresh = EqStateStore.loadEqState(); // reloads default if corrupt
      EqStateStore.saveEqState({ ...fresh, enabled: false, preampDb: 0 });
      const state = EqStateStore.loadEqState();
      await forwardNative('reset', () => jrpc.reset());
      return state;
    },

    // ── Channel balance ──

    setChannelBalanceState: async (patch: Partial<ChannelBalanceState>): Promise<ChannelBalanceState> => {
      const merged = mutateChannelBalance((current) => ({ ...current, ...patch }));
      await forwardNative('channelBalance', () => jrpc.setChannelBalanceState(patch));
      return merged;
    },

    resetChannelBalance: async (): Promise<ChannelBalanceState> => {
      const defaultState: ChannelBalanceState = {
        enabled: false, balance: 0, leftGainDb: 0, rightGainDb: 0,
        bandGains: {
          low: { leftGainDb: 0, rightGainDb: 0 },
          mid: { leftGainDb: 0, rightGainDb: 0 },
          high: { leftGainDb: 0, rightGainDb: 0 },
        },
        leftDelayMs: 0, rightDelayMs: 0,
        swapLeftRight: false, monoMode: 'off',
        invertLeft: false, invertRight: false,
        constantPower: true, clippingRisk: false,
      };
      EqStateStore.saveChannelBalanceState(defaultState);
      await forwardNative('resetChannelBalance', () => jrpc.resetChannelBalance());
      return defaultState;
    },

    // ── Room correction ──

    importRoomCorrectionIr: async (sourcePath: string): Promise<RoomCorrectionState> => {
      EqStateStore.importRoomCorrectionIr(sourcePath);
      const state = EqStateStore.loadRoomCorrectionState();
      await forwardNative('roomCorrection:importIr', () => jrpc.importRoomCorrectionIr(sourcePath));
      return state;
    },

    setRoomCorrectionEnabled: async (enabled: boolean): Promise<RoomCorrectionState> => {
      const state = mutateRoomCorrection((s) => ({ ...s, enabled }));
      await forwardNative('roomCorrection', () => jrpc.setRoomCorrectionEnabled(enabled));
      return state;
    },

    setRoomCorrectionTrim: async (trimDb: number): Promise<RoomCorrectionState> => {
      const state = mutateRoomCorrection((s) => ({ ...s, trimDb }));
      await forwardNative('roomCorrection:trim', () => jrpc.setRoomCorrectionTrim(trimDb));
      return state;
    },

    clearRoomCorrection: async (): Promise<RoomCorrectionState> => {
      const current = EqStateStore.loadRoomCorrectionState();
      const cleared: RoomCorrectionState = { ...current, enabled: false, status: 'empty', irId: null, irName: null };
      EqStateStore.saveRoomCorrectionState(cleared);
      await forwardNative('roomCorrection:clear', () => jrpc.clearRoomCorrection());
      return EqStateStore.loadRoomCorrectionState();
    },

    // ── Profile / preset CRUD (EqStateStore is authoritative; native stubs) ──

    listPresets: (): EqPreset[] => EqStateStore.listPresets(),
    savePreset: (request: EqSavePresetRequest): EqPreset => EqStateStore.savePreset(request),
    deletePreset: (presetId: string): EqPreset[] => {
      EqStateStore.deletePreset(presetId);
      return EqStateStore.listPresets();
    },
    listProfiles: (): EqProfile[] => EqStateStore.listProfiles(),
    saveProfile: (request: EqSaveProfileRequest): EqProfile => EqStateStore.saveProfile(request),
    applyProfile: async (profileId: string): Promise<EqState> => {
      const profiles = EqStateStore.listProfiles();
      const profile = profiles.find((p: EqProfile) => p.id === profileId);
      if (profile) {
        EqStateStore.saveEqState(profile.state);
        await forwardNative('applyProfile', () => jrpc.setState(profile.state));
        return profile.state;
      }
      return EqStateStore.loadEqState();
    },
    deleteProfile: (profileId: string): EqProfile[] => {
      EqStateStore.deleteProfile(profileId);
      return EqStateStore.listProfiles();
    },
    bindProfileToOutput: (request: EqBindProfileRequest): EqProfileBindingInfo =>
      EqStateStore.bindProfileToOutput(request),
    getProfileBinding: (target: EqProfileBindingTarget): EqProfileBindingInfo =>
      EqStateStore.getProfileBinding(target),
  };
}

function getDspBridge(): DaemonDspBridge {
  try {
    const jrpc = activeJsonRpcBridge;
    if (jrpc) return createDaemonDspBridge(jrpc);
  } catch {
    // Bridge not yet initialized; fall through to no-op stub.
  }
  return noopDspBridge;
}

export const registerAudioIpc = (): void => {
  getAudioSession().on('status', (status: AudioStatus) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.AudioStatus, status);
    }
  });
  getAudioSession().on('session-reset', (event: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.AudioSessionReset, event);
    }
  });
  getAudioSession().on('automix-advance', (event: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.PlaybackAutomixAdvance, event);
    }
  });
  ipcMain.handle(IpcChannels.AudioGetStatus, (): AudioStatus => getAudioSession().getStatus());
  ipcMain.handle(IpcChannels.AudioGetDiagnostics, (): AudioDiagnostics => getAudioSession().getDiagnostics());
  ipcMain.handle(IpcChannels.AudioListDevices, async (): Promise<AudioDeviceInfo[]> => getAudioSession().listDevicesAsync());
  ipcMain.handle(IpcChannels.AudioCreateSystemStreamUrl, (_event, request: unknown): string =>
    createSystemAudioStreamUrl(normalizeSystemStreamRequest(request)),
  );
  ipcMain.handle(IpcChannels.AudioReportSystemPlaybackError, (_event, report: unknown): void => {
    reportSystemPlaybackError(report);
  });
  ipcMain.handle(IpcChannels.AudioSetOutput, async (_event, settings: unknown): Promise<AudioStatus> => enqueueAudioStatusCommand(async () => {
    try {
      const normalized = normalizeOutputSettings(settings);
      await requireEchoProForAudioDspPatch(normalized);
      return await getAudioSession().setOutput(normalized);
    } catch (error) {
      reportAudioIpcError(error, 'set-output-ipc', { settings });
      throw error;
    }
  }));
  ipcMain.handle(IpcChannels.AudioExportFile, async (event, request: AudioExportRequest): Promise<AudioExportResult | null> =>
    exportAudioFile(request, BrowserWindow.fromWebContents(event.sender)),
  );
  ipcMain.handle(IpcChannels.AudioResetEngine, async (): Promise<AudioStatus> => enqueueAudioStatusCommand(async () => {
    try {
      return await getAudioSession().forceRestart('reset-audio-engine');
    } catch (error) {
      reportAudioIpcError(error, 'reset-engine-ipc');
      throw error;
    }
  }));
  ipcMain.handle(IpcChannels.AudioForceRestart, async (_event, reason: unknown): Promise<AudioStatus> => enqueueAudioStatusCommand(async () => {
    try {
      const resetReason = typeof reason === 'string' && reason.trim() ? reason : 'force-restart';
      return await getAudioSession().forceRestart(resetReason);
    } catch (error) {
      reportAudioIpcError(error, 'force-restart-ipc', { reason });
      throw error;
    }
  }));
  ipcMain.handle(IpcChannels.AudioRestartWindowsAudioService, async (): Promise<AudioStatus> => enqueueAudioStatusCommand(async () => {
    try {
      const session = getAudioSession();
      await session.stopForWindowsAudioServiceRestart();
      await restartWindowsAudioService();
      return await session.forceRestart('windows-audio-service-restart');
    } catch (error) {
      reportAudioIpcError(error, 'restart-windows-audio-service-ipc');
      throw error;
    }
  }));
  ipcMain.handle(IpcChannels.EqGetState, (): EqState => withDspPro(() => getDspBridge().getState()));
  ipcMain.handle(IpcChannels.EqSetEnabled, async (_event, enabled: unknown): Promise<EqState> =>
    withDspPro(() => getDspBridge().setEnabled(Boolean(enabled))),
  );
  ipcMain.handle(IpcChannels.EqSetBandGain, async (_event, request: EqSetBandGainRequest): Promise<EqState> =>
    withDspPro(() => getDspBridge().setBandGain(request)),
  );
  ipcMain.handle(IpcChannels.EqSetBandFrequency, async (_event, request: EqSetBandFrequencyRequest): Promise<EqState> =>
    withDspPro(() => getDspBridge().setBandFrequency(request)),
  );
  ipcMain.handle(IpcChannels.EqSetBandQ, async (_event, request: EqSetBandQRequest): Promise<EqState> =>
    withDspPro(() => getDspBridge().setBandQ(request)),
  );
  ipcMain.handle(IpcChannels.EqSetBandFilterType, async (_event, request: EqSetBandFilterTypeRequest): Promise<EqState> =>
    withDspPro(() => getDspBridge().setBandFilterType(request)),
  );
  ipcMain.handle(IpcChannels.EqSetBandEnabled, async (_event, request: EqSetBandEnabledRequest): Promise<EqState> =>
    withDspPro(() => getDspBridge().setBandEnabled(request)),
  );
  ipcMain.handle(IpcChannels.EqSetPreamp, async (_event, preampDb: unknown): Promise<EqState> =>
    withDspPro(() => getDspBridge().setPreamp(Number(preampDb))),
  );
  ipcMain.handle(IpcChannels.EqSetDspHeadroom, async (_event, headroomDb: unknown): Promise<EqState> =>
    withDspPro(() => getDspBridge().setDspHeadroom(Number(headroomDb))),
  );
  ipcMain.handle(IpcChannels.EqSetDspSafetyLimiterEnabled, async (_event, enabled: unknown): Promise<EqState> =>
    withDspPro(() => getDspBridge().setDspSafetyLimiterEnabled(enabled !== false)),
  );
  ipcMain.handle(IpcChannels.EqGetDspRackState, (): DspRackState =>
    withDspPro(() => getDspBridge().getDspRackState()),
  );
  ipcMain.handle(IpcChannels.EqSetDspRackState, async (_event, state: Pick<DspRackState, 'order'>): Promise<DspRackState> =>
    withDspPro(() => getDspBridge().setDspRackState(state)),
  );
  ipcMain.handle(IpcChannels.EqGetCompressorState, async (): Promise<CompressorState> =>
    withDspPro(() => getDspBridge().getCompressorState()),
  );
  ipcMain.handle(IpcChannels.EqSetCompressorState, async (_event, state: Partial<CompressorState>): Promise<CompressorState> =>
    withDspPro(() => getDspBridge().setCompressorState(state)),
  );
  ipcMain.handle(IpcChannels.EqGetCrossfeedState, async (): Promise<CrossfeedState> =>
    withDspPro(() => getDspBridge().getCrossfeedState()),
  );
  ipcMain.handle(IpcChannels.EqSetCrossfeedState, async (_event, state: Partial<CrossfeedState>): Promise<CrossfeedState> =>
    withDspPro(() => getDspBridge().setCrossfeedState(state)),
  );
  ipcMain.handle(IpcChannels.EqGetStereoFieldState, async (): Promise<StereoFieldState> =>
    withDspPro(() => getDspBridge().getStereoFieldState()),
  );
  ipcMain.handle(IpcChannels.EqSetStereoFieldState, async (_event, state: Partial<StereoFieldState>): Promise<StereoFieldState> =>
    withDspPro(() => getDspBridge().setStereoFieldState(state)),
  );
  ipcMain.handle(IpcChannels.EqGetChannelMatrixState, async (): Promise<ChannelMatrixState> =>
    withDspPro(() => getDspBridge().getChannelMatrixState()),
  );
  ipcMain.handle(IpcChannels.EqSetChannelMatrixState, async (_event, state: Partial<ChannelMatrixState>): Promise<ChannelMatrixState> =>
    withDspPro(() => getDspBridge().setChannelMatrixState(state)),
  );
  ipcMain.handle(IpcChannels.EqSetPreset, async (_event, presetId: unknown): Promise<EqState> =>
    withDspPro(() => getDspBridge().setPreset(String(presetId))),
  );
  ipcMain.handle(IpcChannels.EqReset, async (): Promise<EqState> => withDspPro(() => getDspBridge().reset()));
  ipcMain.handle(IpcChannels.EqListPresets, () => withDspPro(() => getDspBridge().listPresets()));
  ipcMain.handle(IpcChannels.EqSavePreset, (_event, request: EqSavePresetRequest) => withDspPro(() => getDspBridge().savePreset(request)));
  ipcMain.handle(IpcChannels.EqExportPreset, (_event, request: EqSavePresetRequest) => withDspPro(() => exportEqPreset(request)));
  ipcMain.handle(IpcChannels.EqExportApoPreset, (_event, request: EqSavePresetRequest) => withDspPro(() => exportEqualizerApoPreset(request)));
  ipcMain.handle(IpcChannels.EqExportApoGraphicEqPreset, (_event, request: EqSavePresetRequest) => withDspPro(() => exportEqualizerApoGraphicEqPreset(request)));
  ipcMain.handle(IpcChannels.EqPreviewImportPreset, () => withDspPro(() => previewImportEqPreset()));
  ipcMain.handle(IpcChannels.EqImportPreset, () => withDspPro(() => importEqPreset()));
  ipcMain.handle(IpcChannels.EqDeletePreset, (_event, presetId: unknown) => withDspPro(() => getDspBridge().deletePreset(String(presetId))));
  ipcMain.handle(IpcChannels.EqBrowseHeadphoneCorrections, (_event, request: OpraHeadphoneCorrectionBrowseRequest): Promise<OpraHeadphoneCorrectionBrowseResult> =>
    withDspPro(() => getOpraService().browse(request)),
  );
  ipcMain.handle(IpcChannels.EqSearchHeadphoneCorrections, (_event, request: OpraHeadphoneCorrectionSearchRequest): Promise<OpraHeadphoneCorrectionSearchResult> =>
    withDspPro(() => getOpraService().search(request)),
  );
  ipcMain.handle(IpcChannels.EqApplyHeadphoneCorrection, async (_event, request: OpraHeadphoneCorrectionApplyRequest): Promise<OpraHeadphoneCorrectionApplyResult> => withDspPro(async () => {
    const result = await getOpraService().apply(request);
    const bridge = activeJsonRpcBridge;
    if (bridge && !bridge.isClosed) {
      await syncPersistedDspStateToNative(bridge);
    }
    return result;
  }));
  ipcMain.handle(IpcChannels.EqListProfiles, () => withDspPro(() => getDspBridge().listProfiles()));
  ipcMain.handle(IpcChannels.EqSaveProfile, (_event, request: EqSaveProfileRequest) => withDspPro(() => getDspBridge().saveProfile(request)));
  ipcMain.handle(IpcChannels.EqApplyProfile, (_event, profileId: unknown) => withDspPro(() => getDspBridge().applyProfile(String(profileId))));
  ipcMain.handle(IpcChannels.EqDeleteProfile, (_event, profileId: unknown) => withDspPro(() => getDspBridge().deleteProfile(String(profileId))));
  ipcMain.handle(IpcChannels.EqBindProfileToOutput, (_event, request: EqBindProfileRequest) => withDspPro(() => getDspBridge().bindProfileToOutput(request)));
  ipcMain.handle(IpcChannels.EqGetProfileBinding, (_event, target: EqProfileBindingTarget) => withDspPro(() => getDspBridge().getProfileBinding(target)));
  ipcMain.handle(IpcChannels.ChannelBalanceGetState, (): ChannelBalanceState => withDspPro(() => getDspBridge().getChannelBalanceState()));
  ipcMain.handle(IpcChannels.ChannelBalanceSetState, async (_event, patch: Partial<ChannelBalanceState>): Promise<ChannelBalanceState> =>
    withDspPro(() => getDspBridge().setChannelBalanceState(patch)),
  );
  ipcMain.handle(IpcChannels.ChannelBalanceReset, async (): Promise<ChannelBalanceState> => withDspPro(() => getDspBridge().resetChannelBalance()));
  ipcMain.handle(IpcChannels.RoomCorrectionGetState, (): RoomCorrectionState => withDspPro(() => getDspBridge().getRoomCorrectionState()));
  ipcMain.handle(IpcChannels.RoomCorrectionImportIr, (event): Promise<RoomCorrectionState | null> =>
    withDspPro(() => importRoomCorrectionIr(BrowserWindow.fromWebContents(event.sender))),
  );
  ipcMain.handle(IpcChannels.RoomCorrectionSetEnabled, async (_event, enabled: unknown): Promise<RoomCorrectionState> =>
    withDspPro(() => getDspBridge().setRoomCorrectionEnabled(Boolean(enabled))),
  );
  ipcMain.handle(IpcChannels.RoomCorrectionSetTrim, async (_event, trimDb: unknown): Promise<RoomCorrectionState> =>
    withDspPro(() => getDspBridge().setRoomCorrectionTrim(Number(trimDb))),
  );
  ipcMain.handle(IpcChannels.RoomCorrectionClear, async (): Promise<RoomCorrectionState> => withDspPro(() => getDspBridge().clearRoomCorrection()));
  ipcMain.handle(IpcChannels.PlaybackSetRepeatMode, (_event, mode: unknown): void => {
    if (mode === 'off' || mode === 'one' || mode === 'all') {
      getAudioSession().setRepeatMode(mode);
    }
  });
  ipcMain.handle(IpcChannels.PlaybackSyncQueueToBackend, async (_event, items: unknown, repeatMode: unknown, currentItemId: unknown): Promise<void> => {
    if (Array.isArray(items) && (repeatMode === 'off' || repeatMode === 'one' || repeatMode === 'all')) {
      const normalizedItems = items.flatMap((item): AudioBackendQueueItem[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const candidate = item as Record<string, unknown>;
        if (
          typeof candidate.itemId !== 'string' || !candidate.itemId ||
          typeof candidate.trackId !== 'string' || !candidate.trackId ||
          typeof candidate.filePath !== 'string' || !candidate.filePath
        ) {
          return [];
        }
        return [{
          itemId: candidate.itemId,
          trackId: candidate.trackId,
          filePath: candidate.filePath,
          sampleRate: typeof candidate.sampleRate === 'number' && Number.isFinite(candidate.sampleRate)
            ? candidate.sampleRate
            : undefined,
          startSeconds: typeof candidate.startSeconds === 'number' && Number.isFinite(candidate.startSeconds)
            ? Math.max(0, candidate.startSeconds)
            : undefined,
          metadata: candidate.metadata && typeof candidate.metadata === 'object' && !Array.isArray(candidate.metadata)
            ? Object.fromEntries(
              Object.entries(candidate.metadata as Record<string, unknown>)
                .filter(([key, value]) =>
                  ['title', 'artist', 'album', 'albumArtist', 'coverUrl'].includes(key) &&
                  (typeof value === 'string' || value === null),
                ),
            )
            : undefined,
        }];
      });
      await getAudioSession().syncQueueToBackend(
        normalizedItems,
        repeatMode,
        typeof currentItemId === 'string' && currentItemId ? currentItemId : null,
      );
    }
  });

  // Start background lyrics progress tracking for the taskbar mini player.
  // This runs independently of any renderer page, so lyrics are always available.
  startLyricsProgressTracking();
};

export { createDaemonDspBridge };
