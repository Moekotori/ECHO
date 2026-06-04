import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, Clipboard, Download, FileArchive, FolderOpen, Headphones, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AudioDeviceInfo, AudioDiagnostics, AudioStatus } from '../../../shared/types/audio';
import type { LastCrashSummary } from '../../../shared/types/diagnostics';
import type { SmtcCommand, SmtcDiagnostics } from '../../../shared/types/smtc';
import { getAudioBridge, getDiagnosticsBridge, getSmtcBridge } from '../../utils/echoBridge';

type AudioDiagnosticSnapshot = Partial<AudioDiagnostics> & Partial<AudioStatus>;
type SmtcDiagnosticSnapshot = SmtcDiagnostics;

type AssistantFinding = {
  severity: 'ok' | 'info' | 'warn' | 'error';
  title: string;
  detail: string;
};

type PipelineStage = {
  key: string;
  title: string;
  status: 'ok' | 'info' | 'warn' | 'error';
  detail: string;
};

const unknownValue = 'N/A';

const formatValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : unknownValue;
  }

  if (value === null || value === undefined || value === '') {
    return unknownValue;
  }

  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }

  return String(value);
};

const formatSmtcCommand = (command: SmtcCommand | null): string => {
  if (!command) {
    return unknownValue;
  }

  return typeof command === 'string' ? command : `seek ${Math.round(command.positionSeconds * 1000) / 1000}s`;
};

const basenameFromPath = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    return unknownValue;
  }

  const normalized = value.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).at(-1) ?? unknownValue;
};

const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const hasUnderrun = (diagnostics: AudioDiagnosticSnapshot): boolean =>
  (asNumber(diagnostics.nativeUnderrunCallbacks) ?? 0) > 0 || (asNumber(diagnostics.nativeUnderrunFrames) ?? 0) > 0;

const hasLowBuffer = (diagnostics: AudioDiagnosticSnapshot): boolean => {
  const bufferedMs = asNumber(diagnostics.nativeBufferedMs);
  return (diagnostics.state === 'playing' || diagnostics.state === 'loading') && bufferedMs !== null && bufferedMs < 80;
};

const snapshotFromStatus = (status: AudioStatus): AudioDiagnosticSnapshot => ({
  state: status.state,
  host: status.host,
  outputMode: status.outputMode,
  sharedBackend: status.sharedBackend,
  outputBackend: status.outputBackend,
  activeOutputBackendImpl: status.activeOutputBackendImpl,
  nativeOutputFormat: status.nativeOutputFormat,
  useJuceOutputRequested: status.useJuceOutputRequested,
  useJuceDecodeRequested: status.useJuceDecodeRequested,
  activeDecodeBackendImpl: status.activeDecodeBackendImpl,
  outputDeviceName: status.outputDeviceName,
  currentFilePath: status.currentFilePath,
  currentTrackId: status.currentTrackId,
  durationSeconds: status.durationSeconds,
  positionSeconds: status.positionSeconds,
  playbackRate: status.playbackRate,
  fileSampleRate: status.fileSampleRate,
  decoderOutputSampleRate: status.decoderOutputSampleRate,
  requestedOutputSampleRate: status.requestedOutputSampleRate,
  actualDeviceSampleRate: status.actualDeviceSampleRate,
  sharedDeviceSampleRate: status.sharedDeviceSampleRate,
  resampling: status.resampling,
  ffmpegPath: status.ffmpegPath,
  ffmpegSource: status.ffmpegSource,
  ffmpegVersion: status.ffmpegVersion,
  ffmpegHealthy: status.ffmpegHealthy,
  soxrAvailable: status.soxrAvailable,
  resamplerEngine: status.resamplerEngine,
  resamplerFallbackActive: status.resamplerFallbackActive,
  bitPerfectCandidate: status.bitPerfectCandidate,
  sampleRateMismatch: status.sampleRateMismatch,
  latencyProfile: status.latencyProfile,
  sharedStabilityTier: status.sharedStabilityTier,
  nativeDeviceBufferFrames: status.nativeDeviceBufferFrames,
  nativeRequestedBufferFrames: status.nativeRequestedBufferFrames,
  nativeActualBufferFrames: status.nativeActualBufferFrames,
  nativeOutputLatencyMs: status.nativeOutputLatencyMs,
  nativePositionStalenessMs: status.nativePositionStalenessMs,
  nativeFifoCapacityFrames: status.nativeFifoCapacityFrames,
  nativeStartupPrebufferFrames: status.nativeStartupPrebufferFrames,
  nativeBufferedFrames: status.nativeBufferedFrames,
  nativeBufferedMs: status.nativeBufferedMs,
  nativeUnderrunCallbacks: status.nativeUnderrunCallbacks,
  nativeUnderrunFrames: status.nativeUnderrunFrames,
  lastSharedStabilityRecoveryAt: status.lastSharedStabilityRecoveryAt,
  warnings: status.warnings,
  error: status.error,
});

const fallbackSnapshot = (): AudioDiagnosticSnapshot => ({
  state: 'idle',
  host: 'not-initialized',
  outputMode: 'shared',
  outputDeviceName: null,
  warnings: [],
  error: null,
});

const fallbackSmtcDiagnostics = (): SmtcDiagnosticSnapshot => ({
  enabled: false,
  platform: 'browser',
  hostState: 'not-initialized',
  initialized: false,
  hostPath: null,
  lastMetadataAt: null,
  lastMetadataTrackId: null,
  lastMetadataTitle: null,
  lastMetadataArtist: null,
  lastPlaybackState: null,
  lastPlaybackStateAt: null,
  lastTimelineAt: null,
  lastTimelinePositionSeconds: null,
  lastTimelineDurationSeconds: null,
  enabledActions: null,
  lastCommand: null,
  lastCommandAt: null,
  lastError: null,
  recentErrors: [],
  recoveryInFlight: false,
  recoveryAttemptsInWindow: 0,
  canRecover: false,
  lastRecoveryAt: null,
  lyricsEnabled: false,
});

const smtcHostStateLabel: Record<SmtcDiagnostics['hostState'], string> = {
  disabled: '已关闭',
  unsupported: '不支持',
  'not-initialized': '未初始化',
  missing: '宿主缺失',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  stopped: '已停止',
  unavailable: '不可用',
  error: '错误',
};

const smtcHostStateSeverity: Record<SmtcDiagnostics['hostState'], PipelineStage['status']> = {
  disabled: 'info',
  unsupported: 'info',
  'not-initialized': 'info',
  missing: 'warn',
  starting: 'info',
  running: 'ok',
  stopping: 'info',
  stopped: 'info',
  unavailable: 'warn',
  error: 'error',
};

const formatSmtcState = (diagnostics: SmtcDiagnosticSnapshot): string =>
  `${smtcHostStateLabel[diagnostics.hostState]}${diagnostics.enabled ? '' : ' / disabled'}`;

const buildSmtcPipelineStage = (diagnostics: SmtcDiagnosticSnapshot): PipelineStage => ({
  key: 'smtc',
  title: 'Windows 媒体控件',
  status: smtcHostStateSeverity[diagnostics.hostState],
  detail: `state=${diagnostics.hostState}；platform=${diagnostics.platform}；metadata=${formatValue(diagnostics.lastMetadataTitle)} / ${formatValue(diagnostics.lastMetadataArtist)}；timeline=${formatValue(diagnostics.lastTimelinePositionSeconds)}/${formatValue(diagnostics.lastTimelineDurationSeconds)}s；lastCommand=${formatSmtcCommand(diagnostics.lastCommand)}`,
});

export const buildAudioDiagnosticFindings = (diagnostics: AudioDiagnosticSnapshot): AssistantFinding[] => {
  const findings: AssistantFinding[] = [];
  const warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [];
  const underrunCallbacks = asNumber(diagnostics.nativeUnderrunCallbacks) ?? 0;
  const underrunFrames = asNumber(diagnostics.nativeUnderrunFrames) ?? 0;
  const bufferedMs = asNumber(diagnostics.nativeBufferedMs);
  const state = diagnostics.state ?? 'idle';

  if (diagnostics.error) {
    findings.push({
      severity: 'error',
      title: '当前音频错误',
      detail: String(diagnostics.error),
    });
  }

  if (diagnostics.host === 'error' || diagnostics.host === 'unavailable') {
    findings.push({
      severity: 'error',
      title: '音频主机不可用',
      detail: `host=${diagnostics.host}；优先打开音频报告查看 echo-audio-host 退出码、stderrTail 和设备模式。`,
    });
  } else if (diagnostics.host === 'starting' || state === 'loading') {
    findings.push({
      severity: 'warn',
      title: '音频还在启动',
      detail: '如果长期停在 loading/starting，重点检查设备占用、ASIO 控制面板、采样率和 ready timeout。',
    });
  }

  if (warnings.length > 0) {
    findings.push({
      severity: 'warn',
      title: '音频警告已记录',
      detail: warnings.slice(0, 4).join('；'),
    });
  }

  if (hasUnderrun(diagnostics)) {
    findings.push({
      severity: 'warn',
      title: '检测到 underrun',
      detail: `callbacks=${underrunCallbacks}；frames=${underrunFrames}。这通常和缓冲过小、设备驱动卡顿或后台负载有关。`,
    });
  }

  if (hasLowBuffer(diagnostics)) {
    findings.push({
      severity: 'warn',
      title: 'Native 缓冲偏低',
      detail: `当前 bufferedMs=${bufferedMs}，播放中低于 80ms 时更容易出现爆音或短暂停顿。`,
    });
  }

  if (diagnostics.ffmpegHealthy === false) {
    findings.push({
      severity: 'error',
      title: 'FFmpeg 工具链异常',
      detail: '解码工具链不可用或健康检查失败，本地/远程部分格式可能无法播放。',
    });
  }

  if (diagnostics.sampleRateMismatch) {
    findings.push({
      severity: 'info',
      title: '采样率不一致',
      detail: `文件=${formatValue(diagnostics.fileSampleRate)}；请求=${formatValue(diagnostics.requestedOutputSampleRate)}；设备=${formatValue(diagnostics.actualDeviceSampleRate)}。`,
    });
  } else if (diagnostics.resampling) {
    findings.push({
      severity: 'info',
      title: '正在重采样',
      detail: `decoder=${formatValue(diagnostics.decoderOutputSampleRate)}；device=${formatValue(diagnostics.actualDeviceSampleRate)}；engine=${formatValue(diagnostics.resamplerEngine)}。`,
    });
  }

  if (diagnostics.sharedBackend === 'directsound') {
    findings.push({
      severity: 'info',
      title: 'DirectSound 兼容模式',
      detail: '这是手动兼容路径，适合排查 WASAPI/驱动问题；不要把它当成默认高保真路径。',
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'ok',
      title: '未发现明显音频风险',
      detail: '当前快照没有错误、警告、underrun 或工具链异常；如果仍有卡顿，建议导出安全诊断包保留日志上下文。',
    });
  }

  return findings;
};

export const buildAudioPipelineStages = (diagnostics: AudioDiagnosticSnapshot): PipelineStage[] => {
  const warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [];
  const sourceName = basenameFromPath(diagnostics.currentFilePath);
  const hasAudioError = Boolean(diagnostics.error) || diagnostics.host === 'error' || diagnostics.host === 'unavailable';

  return [
    {
      key: 'source',
      title: '来源',
      status: diagnostics.currentTrackId || sourceName !== unknownValue ? 'ok' : 'info',
      detail: `track=${formatValue(diagnostics.currentTrackId)}；file=${sourceName}；position=${formatValue(diagnostics.positionSeconds)}/${formatValue(diagnostics.durationSeconds)}s`,
    },
    {
      key: 'decode',
      title: '解码',
      status: diagnostics.ffmpegHealthy === false ? 'error' : 'ok',
      detail: `backend=${formatValue(diagnostics.activeDecodeBackendImpl)}；ffmpeg=${formatValue(diagnostics.ffmpegSource)} ${formatValue(diagnostics.ffmpegVersion)}；healthy=${formatValue(diagnostics.ffmpegHealthy)}`,
    },
    {
      key: 'format',
      title: '格式/重采样',
      status: diagnostics.sampleRateMismatch ? 'warn' : diagnostics.resampling ? 'info' : 'ok',
      detail: `file=${formatValue(diagnostics.fileSampleRate)}；decoder=${formatValue(diagnostics.decoderOutputSampleRate)}；requested=${formatValue(diagnostics.requestedOutputSampleRate)}；device=${formatValue(diagnostics.actualDeviceSampleRate)}；engine=${formatValue(diagnostics.resamplerEngine)}`,
    },
    {
      key: 'output',
      title: '输出',
      status: hasAudioError ? 'error' : diagnostics.host === 'starting' ? 'warn' : 'ok',
      detail: `mode=${formatValue(diagnostics.outputMode)}；shared=${formatValue(diagnostics.sharedBackend)}；backend=${formatValue(diagnostics.outputBackend)}；impl=${formatValue(diagnostics.activeOutputBackendImpl)}；format=${formatValue(diagnostics.nativeOutputFormat)}；latency=${formatValue(diagnostics.latencyProfile)}`,
    },
    {
      key: 'device',
      title: '设备/缓冲',
      status: hasUnderrun(diagnostics) || hasLowBuffer(diagnostics) ? 'warn' : 'ok',
      detail: `device=${formatValue(diagnostics.outputDeviceName)}；latency=${formatValue(diagnostics.nativeOutputLatencyMs)}ms；buffer=${formatValue(diagnostics.nativeBufferedMs)}ms；underrun=${formatValue(diagnostics.nativeUnderrunCallbacks)}/${formatValue(diagnostics.nativeUnderrunFrames)}`,
    },
    {
      key: 'stability',
      title: '稳定性',
      status: warnings.length > 0 || diagnostics.sharedStabilityTier === 'emergency' ? 'warn' : 'ok',
      detail: `watchdog=${formatValue(diagnostics.watchdogStatus)}；recoveries=${formatValue(diagnostics.recentWatchdogRecoveryCount)}；tier=${formatValue(diagnostics.sharedStabilityTier)}；warnings=${warnings.length}`,
    },
  ];
};

export const buildAudioRecommendations = (diagnostics: AudioDiagnosticSnapshot): string[] => {
  const recommendations: string[] = [];
  const warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [];

  if (diagnostics.error || diagnostics.host === 'error' || diagnostics.host === 'unavailable') {
    recommendations.push('先打开音频报告，确认 phase、echo-audio-host 退出码、stderrTail、输出模式和设备名，再导出安全诊断包保留完整日志上下文。');
  }

  if (diagnostics.host === 'starting' || diagnostics.state === 'loading') {
    recommendations.push('如果一直停在 starting/loading，优先检查设备是否被独占、ASIO 控制面板是否能看到设备、采样率/缓冲是否被驱动拒绝。');
  }

  if (hasUnderrun(diagnostics) || hasLowBuffer(diagnostics)) {
    recommendations.push('出现 underrun 或缓冲偏低时，优先切到稳定延迟档、增大 ASIO/native buffer、关闭重负载后台任务，再观察是否还卡顿。');
  }

  if (diagnostics.sampleRateMismatch || diagnostics.resampling) {
    recommendations.push('采样率不一致时，检查 Windows 混音器默认格式、外置 DAC 时钟锁定、独占/共享模式选择；重采样本身不一定是错误。');
  }

  if (diagnostics.ffmpegHealthy === false) {
    recommendations.push('FFmpeg 异常时优先修复安装包或 bundled tools，不要先改播放器核心。');
  }

  if (diagnostics.outputMode === 'asio') {
    recommendations.push('ASIO 问题优先确认驱动控制面板、硬件在线状态和通道起点；如果设备临时不可用，可先切 Shared 保持播放不中断。');
  }

  if (diagnostics.sharedBackend === 'directsound') {
    recommendations.push('DirectSound 只适合作为手动兼容模式；排查完成后建议回到 WASAPI/自动 shared 路线。');
  }

  if (warnings.some((warning) => /fallback|recovered|safe_mode/iu.test(warning))) {
    recommendations.push('已出现 fallback/recovery 信号，说明 ECHO 试图自救；需要结合时间线判断是驱动抖动、设备切换还是单曲触发。');
  }

  if (recommendations.length === 0) {
    recommendations.push('当前快照没有明显风险；若用户仍感觉卡顿，导出安全诊断包并对比卡顿发生前后的 audio.log/main.log。');
  }

  return recommendations;
};

export const formatDiagnosticAssistantText = (
  diagnostics: AudioDiagnosticSnapshot,
  lastCrashSummary: LastCrashSummary | null,
  devices: AudioDeviceInfo[] = [],
  deviceListError: string | null = null,
  smtcDiagnostics: SmtcDiagnosticSnapshot = fallbackSmtcDiagnostics(),
): string => {
  const rows: Array<[string, unknown]> = [
    ['generatedAt', new Date().toISOString()],
    ['lastAbnormalExit', lastCrashSummary ? 'detected' : 'none'],
    ['lastAbnormalSessionId', lastCrashSummary?.sessionId ?? null],
    ['state', diagnostics.state],
    ['host', diagnostics.host],
    ['outputMode', diagnostics.outputMode],
    ['sharedBackend', diagnostics.sharedBackend],
    ['outputBackend', diagnostics.outputBackend],
    ['activeOutputBackendImpl', diagnostics.activeOutputBackendImpl],
    ['nativeOutputFormat', diagnostics.nativeOutputFormat],
    ['activeDecodeBackendImpl', diagnostics.activeDecodeBackendImpl],
    ['useJuceOutputRequested', diagnostics.useJuceOutputRequested],
    ['useJuceDecodeRequested', diagnostics.useJuceDecodeRequested],
    ['outputDeviceName', diagnostics.outputDeviceName],
    ['currentFileBasename', basenameFromPath(diagnostics.currentFilePath)],
    ['currentTrackId', diagnostics.currentTrackId],
    ['positionSeconds', diagnostics.positionSeconds],
    ['durationSeconds', diagnostics.durationSeconds],
    ['fileSampleRate', diagnostics.fileSampleRate],
    ['decoderOutputSampleRate', diagnostics.decoderOutputSampleRate],
    ['requestedOutputSampleRate', diagnostics.requestedOutputSampleRate],
    ['actualDeviceSampleRate', diagnostics.actualDeviceSampleRate],
    ['sharedDeviceSampleRate', diagnostics.sharedDeviceSampleRate],
    ['resampling', diagnostics.resampling],
    ['sampleRateMismatch', diagnostics.sampleRateMismatch],
    ['bitPerfectCandidate', diagnostics.bitPerfectCandidate],
    ['ffmpegSource', diagnostics.ffmpegSource],
    ['ffmpegVersion', diagnostics.ffmpegVersion],
    ['ffmpegHealthy', diagnostics.ffmpegHealthy],
    ['soxrAvailable', diagnostics.soxrAvailable],
    ['resamplerEngine', diagnostics.resamplerEngine],
    ['resamplerFallbackActive', diagnostics.resamplerFallbackActive],
    ['latencyProfile', diagnostics.latencyProfile],
    ['sharedStabilityTier', diagnostics.sharedStabilityTier],
    ['nativeDeviceBufferFrames', diagnostics.nativeDeviceBufferFrames],
    ['nativeRequestedBufferFrames', diagnostics.nativeRequestedBufferFrames],
    ['nativeActualBufferFrames', diagnostics.nativeActualBufferFrames],
    ['nativeOutputLatencyMs', diagnostics.nativeOutputLatencyMs],
    ['nativePositionStalenessMs', diagnostics.nativePositionStalenessMs],
    ['nativeFifoCapacityFrames', diagnostics.nativeFifoCapacityFrames],
    ['nativeStartupPrebufferFrames', diagnostics.nativeStartupPrebufferFrames],
    ['nativeBufferedFrames', diagnostics.nativeBufferedFrames],
    ['nativeBufferedMs', diagnostics.nativeBufferedMs],
    ['nativeUnderrunCallbacks', diagnostics.nativeUnderrunCallbacks],
    ['nativeUnderrunFrames', diagnostics.nativeUnderrunFrames],
    ['lastSharedStabilityRecoveryAt', diagnostics.lastSharedStabilityRecoveryAt],
    ['watchdogStatus', diagnostics.watchdogStatus],
    ['recentWatchdogRecoveryCount', diagnostics.recentWatchdogRecoveryCount],
    ['lastWatchdogRecoveryTime', diagnostics.lastWatchdogRecoveryTime],
    ['warnings', diagnostics.warnings],
    ['error', diagnostics.error],
  ];
  const smtcRows: Array<[string, unknown]> = [
    ['enabled', smtcDiagnostics.enabled],
    ['platform', smtcDiagnostics.platform],
    ['hostState', smtcDiagnostics.hostState],
    ['initialized', smtcDiagnostics.initialized],
    ['hostBinary', basenameFromPath(smtcDiagnostics.hostPath)],
    ['lastMetadataAt', smtcDiagnostics.lastMetadataAt],
    ['lastMetadataTrackId', smtcDiagnostics.lastMetadataTrackId],
    ['lastMetadataTitle', smtcDiagnostics.lastMetadataTitle],
    ['lastMetadataArtist', smtcDiagnostics.lastMetadataArtist],
    ['lastPlaybackState', smtcDiagnostics.lastPlaybackState],
    ['lastPlaybackStateAt', smtcDiagnostics.lastPlaybackStateAt],
    ['lastTimelineAt', smtcDiagnostics.lastTimelineAt],
    ['lastTimelinePositionSeconds', smtcDiagnostics.lastTimelinePositionSeconds],
    ['lastTimelineDurationSeconds', smtcDiagnostics.lastTimelineDurationSeconds],
    ['enabledActions', smtcDiagnostics.enabledActions ? JSON.stringify(smtcDiagnostics.enabledActions) : null],
    ['lastCommand', formatSmtcCommand(smtcDiagnostics.lastCommand)],
    ['lastCommandAt', smtcDiagnostics.lastCommandAt],
    ['lastError', smtcDiagnostics.lastError?.message ?? null],
    ['recoveryInFlight', smtcDiagnostics.recoveryInFlight],
    ['recoveryAttemptsInWindow', smtcDiagnostics.recoveryAttemptsInWindow],
    ['canRecover', smtcDiagnostics.canRecover],
    ['lastRecoveryAt', smtcDiagnostics.lastRecoveryAt],
    ['lyricsEnabled', smtcDiagnostics.lyricsEnabled],
  ];
  const findings = buildAudioDiagnosticFindings(diagnostics).map((finding) =>
    `- [${finding.severity}] ${finding.title}: ${finding.detail}`,
  );
  const pipeline = [...buildAudioPipelineStages(diagnostics), buildSmtcPipelineStage(smtcDiagnostics)].map((stage) =>
    `- [${stage.status}] ${stage.title}: ${stage.detail}`,
  );
  const recommendations = buildAudioRecommendations(diagnostics).map((item) => `- ${item}`);
  const deviceRows = devices.map((device) =>
    `- ${device.outputMode}#${device.index}: ${device.name}; default=${formatValue(device.isDefault)}; sampleRate=${formatValue(device.sampleRate)}; sharedRate=${formatValue(device.sharedDeviceSampleRate)}; channels=${formatValue(device.asioOutputChannels)}`,
  );

  return [
    'ECHO Next Diagnostics Assistant',
    '',
    'Audio Findings',
    ...findings,
    '',
    'Audio Pipeline',
    ...pipeline,
    '',
    'Recommendations',
    ...recommendations,
    '',
    'Output Devices',
    `deviceListError: ${formatValue(deviceListError)}`,
    ...(deviceRows.length > 0 ? deviceRows : ['- no device list captured']),
    '',
    'SMTC',
    ...smtcRows.map(([label, value]) => `${label}: ${formatValue(value)}`),
    '',
    'Safe Audio Snapshot',
    ...rows.map(([label, value]) => `${label}: ${formatValue(value)}`),
    '',
    'Privacy',
    'Full local media paths are not included in this copied text; only the current file basename and SMTC host binary basename are shown.',
  ].join('\n');
};

type DiagnosticsAssistantPanelProps = {
  lastCrashSummary: LastCrashSummary | null;
};

export const DiagnosticsAssistantPanel = ({ lastCrashSummary }: DiagnosticsAssistantPanelProps): JSX.Element => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<AudioDiagnosticSnapshot>(() => fallbackSnapshot());
  const [smtcDiagnostics, setSmtcDiagnostics] = useState<SmtcDiagnosticSnapshot>(() => fallbackSmtcDiagnostics());
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [deviceListError, setDeviceListError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'refresh' | 'copy' | 'markdown' | 'zip' | 'audio-report' | 'folder' | 'smtc-restart' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const findings = useMemo(() => buildAudioDiagnosticFindings(diagnostics), [diagnostics]);
  const pipelineStages = useMemo(() => buildAudioPipelineStages(diagnostics), [diagnostics]);
  const smtcPipelineStage = useMemo(() => buildSmtcPipelineStage(smtcDiagnostics), [smtcDiagnostics]);
  const combinedPipelineStages = useMemo(() => [...pipelineStages, smtcPipelineStage], [pipelineStages, smtcPipelineStage]);
  const recommendations = useMemo(() => buildAudioRecommendations(diagnostics), [diagnostics]);
  const issueCount =
    findings.filter((finding) => finding.severity === 'warn' || finding.severity === 'error').length +
    (smtcPipelineStage.status === 'warn' || smtcPipelineStage.status === 'error' ? 1 : 0);
  const isBusy = busyAction !== null;

  const refreshDiagnostics = useCallback(async (): Promise<void> => {
    setBusyAction('refresh');
    setError(null);
    try {
      const audio = getAudioBridge();
      if (!audio) {
        setDiagnostics(fallbackSnapshot());
        setError('桌面桥接不可用，请在 ECHO Next 客户端里打开诊断助手。');
        return;
      }

      const nextDiagnostics = typeof audio.getDiagnostics === 'function'
        ? await audio.getDiagnostics()
        : snapshotFromStatus(await audio.getStatus());
      setDiagnostics(nextDiagnostics);

      const smtc = getSmtcBridge();
      setSmtcDiagnostics(typeof smtc?.getDiagnostics === 'function' ? await smtc.getDiagnostics() : fallbackSmtcDiagnostics());

      if (typeof audio.listDevices === 'function') {
        try {
          setDevices(await audio.listDevices());
          setDeviceListError(null);
        } catch (listError) {
          setDevices([]);
          setDeviceListError(listError instanceof Error ? listError.message : String(listError));
        }
      } else {
        setDevices([]);
        setDeviceListError('audio.listDevices is unavailable');
      }
      setLastRefreshAt(new Date().toLocaleString());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setBusyAction(null);
    }
  }, []);

  const toggleExpanded = useCallback((): void => {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);
    if (nextExpanded) {
      void refreshDiagnostics();
    }
  }, [isExpanded, refreshDiagnostics]);

  const restartSmtc = useCallback(async (): Promise<void> => {
    setBusyAction('smtc-restart');
    setMessage(null);
    setError(null);
    try {
      const smtc = getSmtcBridge();
      if (typeof smtc?.restart !== 'function') {
        throw new Error('SMTC restart bridge is unavailable');
      }
      setSmtcDiagnostics(await smtc.restart());
      setMessage('SMTC support restarted');
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : String(restartError));
    } finally {
      setBusyAction(null);
    }
  }, []);

  const runDiagnosticsAction = useCallback(async (
    action: Exclude<typeof busyAction, null>,
    task: () => Promise<string | void>,
    successPrefix: string,
  ): Promise<void> => {
    setBusyAction(action);
    setMessage(null);
    setError(null);
    try {
      const result = await task();
      setMessage(result ? `${successPrefix}：${result}` : successPrefix);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyAction(null);
    }
  }, []);

  const copySnapshot = useCallback(async (): Promise<void> => {
    await runDiagnosticsAction(
      'copy',
      async () => {
        await window.navigator.clipboard.writeText(formatDiagnosticAssistantText(diagnostics, lastCrashSummary, devices, deviceListError, smtcDiagnostics));
      },
      '已复制安全诊断摘要',
    );
  }, [deviceListError, devices, diagnostics, lastCrashSummary, runDiagnosticsAction, smtcDiagnostics]);

  const exportMarkdown = useCallback(async (): Promise<void> => {
    await runDiagnosticsAction(
      'markdown',
      async () => {
        const bridge = getDiagnosticsBridge();
        if (!bridge) {
          throw new Error('桌面桥接不可用，无法导出 Markdown。');
        }
        return bridge.exportDiagnostics();
      },
      '已导出 Markdown 诊断报告',
    );
  }, [runDiagnosticsAction]);

  const exportZip = useCallback(async (): Promise<void> => {
    await runDiagnosticsAction(
      'zip',
      async () => {
        const bridge = getDiagnosticsBridge();
        if (!bridge?.exportDiagnosticsZip) {
          throw new Error('当前桌面桥接不支持安全诊断包导出，请重启 ECHO Next 后再试。');
        }
        return bridge.exportDiagnosticsZip();
      },
      '已导出安全诊断包',
    );
  }, [runDiagnosticsAction]);

  const openAudioReport = useCallback(async (): Promise<void> => {
    await runDiagnosticsAction(
      'audio-report',
      async () => {
        const bridge = getDiagnosticsBridge();
        if (!bridge) {
          throw new Error('桌面桥接不可用，无法打开音频报告。');
        }
        return bridge.openAudioCrashReport();
      },
      '已打开音频诊断报告',
    );
  }, [runDiagnosticsAction]);

  const openFolder = useCallback(async (): Promise<void> => {
    await runDiagnosticsAction(
      'folder',
      async () => {
        const bridge = getDiagnosticsBridge();
        if (!bridge) {
          throw new Error('桌面桥接不可用，无法打开日志目录。');
        }
        return bridge.openDiagnosticsFolder();
      },
      '已打开本地诊断目录',
    );
  }, [runDiagnosticsAction]);

  const statusCards: Array<[string, unknown]> = [
    ['音频状态', diagnostics.state],
    ['音频主机', diagnostics.host],
    ['输出模式', diagnostics.outputMode],
    ['输出后端', diagnostics.outputBackend],
    ['设备', diagnostics.outputDeviceName],
    ['SMTC', formatSmtcState(smtcDiagnostics)],
    ['SMTC 命令', formatSmtcCommand(smtcDiagnostics.lastCommand)],
    ['文件采样率', diagnostics.fileSampleRate],
    ['设备采样率', diagnostics.actualDeviceSampleRate],
    ['Native 缓冲', diagnostics.nativeBufferedMs === null || diagnostics.nativeBufferedMs === undefined ? null : `${diagnostics.nativeBufferedMs} ms`],
    ['Underrun', diagnostics.nativeUnderrunCallbacks ?? diagnostics.nativeUnderrunFrames ?? 0],
    ['FFmpeg', diagnostics.ffmpegHealthy === undefined ? unknownValue : diagnostics.ffmpegHealthy ? '正常' : '异常'],
    ['上次异常退出', lastCrashSummary ? '检测到' : '未检测到'],
  ];
  const activeDeviceName = typeof diagnostics.outputDeviceName === 'string' ? diagnostics.outputDeviceName : null;

  return (
    <section className="diagnostics-assistant-panel" data-expanded={isExpanded} aria-label="诊断助手">
      <button className="diagnostics-assistant-summary" type="button" aria-expanded={isExpanded} onClick={toggleExpanded}>
        <span className="diagnostics-assistant-summary-main">
          <span className="diagnostics-assistant-icon"><ShieldCheck size={18} /></span>
          <span>
            <strong>诊断助手</strong>
            <small>安全收集本机状态、音频链路和日志线索；不会上传，也不会读取音乐内容。</small>
          </span>
        </span>
        <span className="diagnostics-assistant-summary-state" data-issues={issueCount > 0}>
          {issueCount > 0 ? `${issueCount} 个诊断风险` : '快照正常'}
        </span>
        <ChevronDown size={17} />
      </button>

      {isExpanded ? (
        <div className="diagnostics-assistant-body">
          <div className="settings-status-grid diagnostics-assistant-grid">
            {statusCards.map(([label, value]) => (
              <span key={label}>
                <em>{label}</em>
                <strong title={formatValue(value)}>{formatValue(value)}</strong>
              </span>
            ))}
          </div>

          <div className="diagnostics-assistant-findings">
            {findings.map((finding) => (
              <article key={`${finding.severity}-${finding.title}`} data-severity={finding.severity}>
                <strong>{finding.title}</strong>
                <p>{finding.detail}</p>
              </article>
            ))}
          </div>

          <div className="diagnostics-assistant-pipeline" aria-label="音频链路">
            {combinedPipelineStages.map((stage) => (
              <article key={stage.key} data-severity={stage.status}>
                <span>{stage.title}</span>
                <strong>{stage.status}</strong>
                <p>{stage.detail}</p>
              </article>
            ))}
          </div>

          <div className="diagnostics-assistant-devices" aria-label="系统媒体控件">
            <div className="diagnostics-assistant-devices-header">
              <strong>系统媒体控件</strong>
              <span>{formatSmtcState(smtcDiagnostics)}</span>
            </div>
            <div className="settings-chip-row">
              <span data-tone={smtcDiagnostics.hostState === 'running' ? 'ready' : smtcDiagnostics.canRecover ? 'warning' : 'paused'}>
                {smtcDiagnostics.recoveryInFlight ? 'recovering' : smtcDiagnostics.hostState}
              </span>
              <button
                className="settings-action-button"
                type="button"
                disabled={isBusy || !smtcDiagnostics.enabled || smtcDiagnostics.platform !== 'win32'}
                onClick={() => void restartSmtc()}
              >
                <RefreshCw size={15} />
                {busyAction === 'smtc-restart' ? 'Restarting SMTC...' : 'Restart SMTC'}
              </button>
            </div>
            <div className="diagnostics-assistant-device-list">
              <article data-active={smtcDiagnostics.hostState === 'running'}>
                <span>
                  <strong>{formatValue(smtcDiagnostics.lastMetadataTitle)}</strong>
                  <small>{formatValue(smtcDiagnostics.lastMetadataArtist)} / {formatValue(smtcDiagnostics.lastPlaybackState)}</small>
                </span>
                <em>{formatValue(smtcDiagnostics.lastTimelinePositionSeconds)}s</em>
              </article>
              <article data-active={Boolean(smtcDiagnostics.lastCommandAt)}>
                <span>
                  <strong>{formatSmtcCommand(smtcDiagnostics.lastCommand)}</strong>
                  <small>{formatValue(smtcDiagnostics.lastCommandAt)}</small>
                </span>
                <em>{smtcDiagnostics.recoveryInFlight ? 'recovering' : `${smtcDiagnostics.recoveryAttemptsInWindow} recovery`}</em>
              </article>
              <article data-active={smtcDiagnostics.lyricsEnabled}>
                <span>
                  <strong>Lyrics in SMTC</strong>
                  <small>{formatValue(smtcDiagnostics.lastRecoveryAt)}</small>
                </span>
                <em>{smtcDiagnostics.lyricsEnabled ? 'on' : 'off'}</em>
              </article>
              {smtcDiagnostics.lastError ? (
                <article data-active={false}>
                  <span>
                    <strong>{smtcDiagnostics.lastError.source}</strong>
                    <small>{smtcDiagnostics.lastError.message}</small>
                  </span>
                  <em>{formatValue(smtcDiagnostics.lastError.at)}</em>
                </article>
              ) : null}
            </div>
          </div>

          <div className="diagnostics-assistant-recommendations">
            <strong>建议步骤</strong>
            <ol>
              {recommendations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>

          <div className="diagnostics-assistant-devices" aria-label="输出设备">
            <div className="diagnostics-assistant-devices-header">
              <strong>输出设备</strong>
              <span>{deviceListError ? '设备列表读取失败' : `${devices.length} 个设备`}</span>
            </div>
            {deviceListError ? <p className="settings-inline-error">{deviceListError}</p> : null}
            <div className="diagnostics-assistant-device-list">
              {devices.length > 0 ? devices.map((device) => {
                const isActive = Boolean(activeDeviceName && device.name === activeDeviceName);
                return (
                  <article key={device.id} data-active={isActive}>
                    <span>
                      <strong>{device.name}</strong>
                      <small>{device.outputMode} #{device.index}{device.isDefault ? ' / 默认' : ''}{isActive ? ' / 当前' : ''}</small>
                    </span>
                    <em>{formatValue(device.sampleRate ?? device.sharedDeviceSampleRate)} Hz</em>
                  </article>
                );
              }) : (
                <p className="settings-inline-note">展开后会读取一次设备列表；如果桥接不可用，这里只保留音频快照。</p>
              )}
            </div>
          </div>

          <div className="settings-chip-row settings-chip-row--left diagnostics-assistant-actions">
            <button className="settings-action-button" type="button" disabled={isBusy} onClick={() => void refreshDiagnostics()}>
              <RefreshCw size={15} />
              {busyAction === 'refresh' ? '刷新中...' : '刷新音频快照'}
            </button>
            <button className="settings-action-button" type="button" disabled={isBusy} onClick={() => void copySnapshot()}>
              <Clipboard size={15} />
              {busyAction === 'copy' ? '复制中...' : '复制安全摘要'}
            </button>
            <button className="settings-action-button" type="button" disabled={isBusy} onClick={() => void exportMarkdown()}>
              <Download size={15} />
              {busyAction === 'markdown' ? '导出中...' : '导出 Markdown'}
            </button>
            <button className="settings-action-button" type="button" disabled={isBusy} onClick={() => void exportZip()}>
              <FileArchive size={15} />
              {busyAction === 'zip' ? '打包中...' : '导出安全诊断包'}
            </button>
            <button className="settings-action-button" type="button" disabled={isBusy} onClick={() => void openAudioReport()}>
              <Headphones size={15} />
              打开音频报告
            </button>
            <button className="settings-action-button" type="button" disabled={isBusy} onClick={() => void openFolder()}>
              <FolderOpen size={15} />
              打开日志目录
            </button>
          </div>

          <p className="settings-inline-note">
            当前文件只显示文件名：{basenameFromPath(diagnostics.currentFilePath)}；完整路径、账号令牌、Cookie、歌词正文和媒体文件不会进入复制摘要。
            {lastRefreshAt ? ` 上次刷新：${lastRefreshAt}` : ''}
          </p>
          <p className="settings-inline-note">
            安全诊断包只包含日志、状态快照和脱敏 JSON；不会包含音乐文件、封面二进制、歌词正文、账号令牌或 Cookie。
          </p>
          {message ? <p className="settings-inline-note">{message}</p> : null}
          {error ? <p className="settings-inline-error">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
};
