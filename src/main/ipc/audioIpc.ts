import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { normalizeAudioOutputModeForPlatform, normalizeAudioSharedBackendForPlatform } from '../../shared/utils/audioPlatformCapabilities';
import { expandEqualizerApoIncludes, formatEqualizerApoGraphicEqPreset, formatEqualizerApoPreset, parseEqualizerApoPreset } from '../../shared/utils/equalizerApoPreset';
import type {
  AudioDiagnostics,
  AudioDeviceInfo,
  AudioExportRequest,
  AudioExportResult,
  AudioLatencyProfile,
  AudioOutputMode,
  AudioOutputSettings,
  AudioSharedBackend,
  AudioStatus,
  ChannelBalanceState,
  PlaybackSpeedMode,
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
  EqProfileBindingTarget,
  EqSavePresetRequest,
  EqSaveProfileRequest,
  EqSetBandEnabledRequest,
  EqSetBandFilterTypeRequest,
  EqSetBandFrequencyRequest,
  EqSetBandGainRequest,
  EqSetBandQRequest,
  EqState,
  RoomCorrectionState,
} from '../../shared/types/eq';
import { getAudioSession } from '../audio/AudioSession';
import { exportAudioFile } from '../audio/AudioExportService';
import { getEqBridge } from '../audio/EqBridge';
import { getOpraService } from '../audio/OpraService';
import { restartWindowsAudioService } from '../audio/WindowsAudioServiceManager';
import { getCrashReportService } from '../diagnostics/CrashReportService';
import { createSystemAudioStreamUrl } from '../protocol/audioProtocol';
import { enqueueAudioCommand, isAudioCommandTimeoutError } from './audioCommandQueue';

const outputModes = new Set<AudioOutputMode>(['shared', 'exclusive', 'asio', 'system']);
const sharedBackends = new Set<AudioSharedBackend>(['auto', 'windows', 'directsound', 'alsa']);
const latencyProfiles = new Set<AudioLatencyProfile>(['stable', 'balanced', 'lowLatency']);
const playbackSpeedModes = new Set<PlaybackSpeedMode>(['nightcore', 'daycore', 'speed']);
const echoSrcModes = new Set(['off', 'family2x', 'family4x', 'family8x']);
const echoSrcQualityProfiles = new Set(['transparent', 'balanced', 'lowLatency']);
const systemAudioOutputBackend = 'system-audio';
const systemAudioBackendImpl = 'electron-html-audio';

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
    const expandedIncludePath = expandWindowsEnvironmentVariables(includePath);
    const includeFilePath = normalize(isAbsolute(expandedIncludePath) ? expandedIncludePath : join(dirname(parentPath), expandedIncludePath));
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
  const eqBridge = getEqBridge();
  return {
    request: {
      id: uniqueImportedPresetId(candidate.name, new Set(eqBridge.listPresets().map((preset) => preset.id))),
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
      { name: 'EQ Preset / Equalizer APO', extensions: ['json', 'txt', 'cfg', 'apo'] },
      { name: 'ECHO Next EQ Preset', extensions: ['json'] },
      { name: 'Equalizer APO', extensions: ['txt', 'cfg', 'apo'] },
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
  const eqBridge = getEqBridge();

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

  return getEqBridge().importRoomCorrectionIr(result.filePaths[0]);
};

const normalizeOutputSettings = (value: unknown): AudioOutputSettings => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('audio output settings must be an object');
  }

  const input = value as Record<string, unknown>;
  const output: AudioOutputSettings = {};

  if (typeof input.outputMode === 'string' && outputModes.has(input.outputMode as AudioOutputMode)) {
    output.outputMode = normalizeAudioOutputModeForPlatform(input.outputMode as AudioOutputMode, process.platform);
  }

  if (typeof input.sharedBackend === 'string' && sharedBackends.has(input.sharedBackend as AudioSharedBackend)) {
    output.sharedBackend = normalizeAudioSharedBackendForPlatform(input.sharedBackend as AudioSharedBackend, process.platform);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'deviceIndex') && input.deviceIndex == null) {
    output.deviceIndex = undefined;
  } else if (typeof input.deviceIndex === 'number' && Number.isInteger(input.deviceIndex)) {
    output.deviceIndex = input.deviceIndex;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'deviceName') && input.deviceName == null) {
    output.deviceName = undefined;
  } else if (typeof input.deviceName === 'string' && input.deviceName.trim()) {
    output.deviceName = input.deviceName;
  }

  if (
    typeof input.asioOutputChannelStart === 'number' &&
    Number.isInteger(input.asioOutputChannelStart) &&
    input.asioOutputChannelStart >= 0
  ) {
    output.asioOutputChannelStart = input.asioOutputChannelStart;
  }

  if (
    typeof input.requestedOutputSampleRate === 'number' &&
    Number.isFinite(input.requestedOutputSampleRate) &&
    input.requestedOutputSampleRate > 0
  ) {
    output.requestedOutputSampleRate = Math.round(input.requestedOutputSampleRate);
  }

  if (typeof input.latencyProfile === 'string' && latencyProfiles.has(input.latencyProfile as AudioLatencyProfile)) {
    output.latencyProfile = input.latencyProfile as AudioLatencyProfile;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'bufferSizeFrames')) {
    output.bufferSizeFrames =
      typeof input.bufferSizeFrames === 'number' && Number.isFinite(input.bufferSizeFrames) && input.bufferSizeFrames > 0
        ? Math.round(input.bufferSizeFrames)
        : null;
  }

  if (typeof input.useJuceOutput === 'boolean') {
    output.useJuceOutput = input.useJuceOutput;
  }

  if (typeof input.useJuceDecode === 'boolean') {
    output.useJuceDecode = input.useJuceDecode;
  }

  if (input.dsdOutputMode === 'dop' || input.dsdOutputMode === 'pcm') {
    output.dsdOutputMode = input.dsdOutputMode;
  }

  if (typeof input.asioNativeDsdExperimentalEnabled === 'boolean') {
    output.asioNativeDsdExperimentalEnabled = input.asioNativeDsdExperimentalEnabled;
  }

  if (typeof input.asioUnavailableFallbackEnabled === 'boolean') {
    output.asioUnavailableFallbackEnabled = input.asioUnavailableFallbackEnabled;
  }

  if (typeof input.exclusiveInstabilityFallbackEnabled === 'boolean') {
    output.exclusiveInstabilityFallbackEnabled = input.exclusiveInstabilityFallbackEnabled;
  }

  if (typeof input.defaultDeviceFallbackEnabled === 'boolean') {
    output.defaultDeviceFallbackEnabled = input.defaultDeviceFallbackEnabled;
  }

  if (typeof input.soxrFallbackEnabled === 'boolean') {
    output.soxrFallbackEnabled = input.soxrFallbackEnabled;
  }

  if (typeof input.echoSrcMode === 'string' && echoSrcModes.has(input.echoSrcMode)) {
    output.echoSrcMode = input.echoSrcMode as AudioOutputSettings['echoSrcMode'];
  }

  if (typeof input.echoSrcQualityProfile === 'string' && echoSrcQualityProfiles.has(input.echoSrcQualityProfile)) {
    output.echoSrcQualityProfile = input.echoSrcQualityProfile as AudioOutputSettings['echoSrcQualityProfile'];
  }

  if (typeof input.releaseExclusiveOnPauseExperimentalEnabled === 'boolean') {
    output.releaseExclusiveOnPauseExperimentalEnabled = input.releaseExclusiveOnPauseExperimentalEnabled;
  }

  if (typeof input.volume === 'number' && Number.isFinite(input.volume)) {
    output.volume = Math.max(0, Math.min(1, input.volume));
  }

  if (typeof input.playbackRate === 'number' && Number.isFinite(input.playbackRate)) {
    output.playbackRate = Math.max(0.5, Math.min(2, input.playbackRate));
  }

  if (typeof input.playbackSpeedMode === 'string' && playbackSpeedModes.has(input.playbackSpeedMode as PlaybackSpeedMode)) {
    output.playbackSpeedMode = input.playbackSpeedMode as PlaybackSpeedMode;
  }

  return output;
};

const reportAudioIpcError = (error: unknown, phase: string, details?: unknown): void => {
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
      return await getAudioSession().setOutput(normalized);
    } catch (error) {
      reportAudioIpcError(error, 'set-output-ipc', { settings });
      throw error;
    }
  }));
  ipcMain.handle(IpcChannels.AudioExportFile, async (event, request: AudioExportRequest): Promise<AudioExportResult | null> =>
    exportAudioFile(request, BrowserWindow.fromWebContents(event.sender)),
  );
  ipcMain.handle(IpcChannels.AudioOpenAsioControlPanel, async (_event, settings: unknown): Promise<void> => {
    try {
      const normalized = normalizeOutputSettings({ ...(typeof settings === 'object' && settings ? settings : {}), outputMode: 'asio' });
      await getAudioSession().openAsioControlPanel(normalized);
    } catch (error) {
      reportAudioIpcError(error, 'open-asio-control-panel-ipc', { settings });
      throw error;
    }
  });
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
  ipcMain.handle(IpcChannels.EqGetState, (): EqState => getEqBridge().getState());
  ipcMain.handle(IpcChannels.EqSetEnabled, async (_event, enabled: unknown): Promise<EqState> =>
    getEqBridge().setEnabled(Boolean(enabled)),
  );
  ipcMain.handle(IpcChannels.EqSetBandGain, async (_event, request: EqSetBandGainRequest): Promise<EqState> =>
    getEqBridge().setBandGain(request),
  );
  ipcMain.handle(IpcChannels.EqSetBandFrequency, async (_event, request: EqSetBandFrequencyRequest): Promise<EqState> =>
    getEqBridge().setBandFrequency(request),
  );
  ipcMain.handle(IpcChannels.EqSetBandQ, async (_event, request: EqSetBandQRequest): Promise<EqState> =>
    getEqBridge().setBandQ(request),
  );
  ipcMain.handle(IpcChannels.EqSetBandFilterType, async (_event, request: EqSetBandFilterTypeRequest): Promise<EqState> =>
    getEqBridge().setBandFilterType(request),
  );
  ipcMain.handle(IpcChannels.EqSetBandEnabled, async (_event, request: EqSetBandEnabledRequest): Promise<EqState> =>
    getEqBridge().setBandEnabled(request),
  );
  ipcMain.handle(IpcChannels.EqSetPreamp, async (_event, preampDb: unknown): Promise<EqState> =>
    getEqBridge().setPreamp(Number(preampDb)),
  );
  ipcMain.handle(IpcChannels.EqSetDspHeadroom, async (_event, headroomDb: unknown): Promise<EqState> =>
    getEqBridge().setDspHeadroom(Number(headroomDb)),
  );
  ipcMain.handle(IpcChannels.EqSetDspSafetyLimiterEnabled, async (_event, enabled: unknown): Promise<EqState> =>
    getEqBridge().setDspSafetyLimiterEnabled(enabled !== false),
  );
  ipcMain.handle(IpcChannels.EqSetPreset, async (_event, presetId: unknown): Promise<EqState> =>
    getEqBridge().setPreset(String(presetId)),
  );
  ipcMain.handle(IpcChannels.EqReset, async (): Promise<EqState> => getEqBridge().reset());
  ipcMain.handle(IpcChannels.EqListPresets, () => getEqBridge().listPresets());
  ipcMain.handle(IpcChannels.EqSavePreset, (_event, request: EqSavePresetRequest) => getEqBridge().savePreset(request));
  ipcMain.handle(IpcChannels.EqExportPreset, (_event, request: EqSavePresetRequest) => exportEqPreset(request));
  ipcMain.handle(IpcChannels.EqExportApoPreset, (_event, request: EqSavePresetRequest) => exportEqualizerApoPreset(request));
  ipcMain.handle(IpcChannels.EqExportApoGraphicEqPreset, (_event, request: EqSavePresetRequest) => exportEqualizerApoGraphicEqPreset(request));
  ipcMain.handle(IpcChannels.EqPreviewImportPreset, () => previewImportEqPreset());
  ipcMain.handle(IpcChannels.EqImportPreset, () => importEqPreset());
  ipcMain.handle(IpcChannels.EqDeletePreset, (_event, presetId: unknown) => getEqBridge().deletePreset(String(presetId)));
  ipcMain.handle(IpcChannels.EqBrowseHeadphoneCorrections, (_event, request: OpraHeadphoneCorrectionBrowseRequest): Promise<OpraHeadphoneCorrectionBrowseResult> =>
    getOpraService().browse(request),
  );
  ipcMain.handle(IpcChannels.EqSearchHeadphoneCorrections, (_event, request: OpraHeadphoneCorrectionSearchRequest): Promise<OpraHeadphoneCorrectionSearchResult> =>
    getOpraService().search(request),
  );
  ipcMain.handle(IpcChannels.EqApplyHeadphoneCorrection, (_event, request: OpraHeadphoneCorrectionApplyRequest): Promise<OpraHeadphoneCorrectionApplyResult> =>
    getOpraService().apply(request),
  );
  ipcMain.handle(IpcChannels.EqListProfiles, () => getEqBridge().listProfiles());
  ipcMain.handle(IpcChannels.EqSaveProfile, (_event, request: EqSaveProfileRequest) => getEqBridge().saveProfile(request));
  ipcMain.handle(IpcChannels.EqApplyProfile, (_event, profileId: unknown) => getEqBridge().applyProfile(String(profileId)));
  ipcMain.handle(IpcChannels.EqDeleteProfile, (_event, profileId: unknown) => getEqBridge().deleteProfile(String(profileId)));
  ipcMain.handle(IpcChannels.EqBindProfileToOutput, (_event, request: EqBindProfileRequest) => getEqBridge().bindProfileToOutput(request));
  ipcMain.handle(IpcChannels.EqGetProfileBinding, (_event, target: EqProfileBindingTarget) => getEqBridge().getProfileBinding(target));
  ipcMain.handle(IpcChannels.ChannelBalanceGetState, (): ChannelBalanceState => getEqBridge().getChannelBalanceState());
  ipcMain.handle(IpcChannels.ChannelBalanceSetState, async (_event, patch: Partial<ChannelBalanceState>): Promise<ChannelBalanceState> =>
    getEqBridge().setChannelBalanceState(patch),
  );
  ipcMain.handle(IpcChannels.ChannelBalanceReset, async (): Promise<ChannelBalanceState> => getEqBridge().resetChannelBalance());
  ipcMain.handle(IpcChannels.RoomCorrectionGetState, (): RoomCorrectionState => getEqBridge().getRoomCorrectionState());
  ipcMain.handle(IpcChannels.RoomCorrectionImportIr, (event): Promise<RoomCorrectionState | null> =>
    importRoomCorrectionIr(BrowserWindow.fromWebContents(event.sender)),
  );
  ipcMain.handle(IpcChannels.RoomCorrectionSetEnabled, async (_event, enabled: unknown): Promise<RoomCorrectionState> =>
    getEqBridge().setRoomCorrectionEnabled(Boolean(enabled)),
  );
  ipcMain.handle(IpcChannels.RoomCorrectionSetTrim, async (_event, trimDb: unknown): Promise<RoomCorrectionState> =>
    getEqBridge().setRoomCorrectionTrim(Number(trimDb)),
  );
  ipcMain.handle(IpcChannels.RoomCorrectionClear, async (): Promise<RoomCorrectionState> => getEqBridge().clearRoomCorrection());
};
