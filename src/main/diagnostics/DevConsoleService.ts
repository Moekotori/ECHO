import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, app } from 'electron';
import type { WebContents } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type {
  DiagnosticConsoleEntry,
  DiagnosticConsoleLevel,
  DiagnosticConsoleSnapshot,
  DiagnosticConsoleSource,
  DiagnosticPerformanceStallPayload,
  RendererErrorPayload,
} from '../../shared/types/diagnostics';
import { recordDiagnosticConsoleProblem } from './ExceptionRecorder';
import { getPlaybackPerformanceSnapshot } from './PlaybackPerformanceDiagnostics';
import { getActiveLibraryScanPerfContext, isLibraryScanPerfDiagnosticsEnabled } from './LibraryScanPerfDiagnostics';
import { recordRuntimePerformanceStall } from './RuntimePerformanceDiagnostics';
import { areDeveloperToolsAllowed } from '../app/securityPolicy';
import { resolveAppIconPath } from '../app/appIcon';

const mainOutputDir = import.meta.dirname;
const maxEntries = 2500;
const maxLineLength = 4000;
const mainStallCheckIntervalMs = 500;
const mainStallThresholdMs = 1_000;
const performanceStallLogCooldownMs = 10_000;

const pendingChunks = new Map<DiagnosticConsoleSource, string>();
let consoleWindow: BrowserWindow | null = null;
let captureInitialized = false;
let performanceStallMonitorInitialized = false;
const lastPerformanceStallLogAtByKey = new Map<string, number>();
let nextEntryId = 1;
let entries: DiagnosticConsoleEntry[] = [];
const ansiSequencePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

const truncateLine = (line: string): string =>
  line.length > maxLineLength ? `${line.slice(0, maxLineLength)}...` : line;

const normalizeLine = (line: string): string => line.replace(ansiSequencePattern, '');

const isMutedDiagnosticLine = (
  source: DiagnosticConsoleSource,
  level: DiagnosticConsoleLevel,
  message: string,
): boolean => {
  const plainMessage = normalizeLine(message).trim();
  const hostPayload = plainMessage.startsWith('[echo-audio-host] ')
    ? plainMessage.slice('[echo-audio-host] '.length).trim()
    : plainMessage;

  if (/^\{"pos":\d+,/u.test(hostPayload)) {
    return true;
  }

  if (/"event":"local_prepare_(?:started|completed)"/u.test(hostPayload)) {
    return true;
  }

  if (
    plainMessage.startsWith('[AudioSession] playback diagnostic ') &&
    plainMessage.includes('"severity":"info"')
  ) {
    return true;
  }

  if (source === 'renderer' && (level === 'warn' || level === 'error')) {
    return (
      plainMessage.startsWith('MediaImage src can only be of http/https/data/blob scheme:') ||
      plainMessage.startsWith('Unable to preventDefault inside passive event listener invocation.')
    );
  }

  if (source === 'stderr') {
    return (
      plainMessage.startsWith('[BpmAnalyzer] file=') ||
      plainMessage.startsWith('[DecoderPipeline] ffmpeg:')
    );
  }

  return false;
};

const pushEntry = (
  source: DiagnosticConsoleSource,
  level: DiagnosticConsoleLevel,
  message: string,
  details?: DiagnosticConsoleEntry['details'],
): DiagnosticConsoleEntry => {
  if (isMutedDiagnosticLine(source, level, message)) {
    return {
      id: nextEntryId,
      timestamp: new Date().toISOString(),
      source,
      level,
      message,
      details,
    };
  }

  const rawMessage = truncateLine(message);
  const plainMessage = truncateLine(normalizeLine(message));
  const entry: DiagnosticConsoleEntry = {
    id: nextEntryId,
    timestamp: new Date().toISOString(),
    source,
    level,
    message: plainMessage,
    rawMessage: rawMessage === plainMessage ? undefined : rawMessage,
    details,
  };

  nextEntryId += 1;
  entries.push(entry);
  if (entries.length > maxEntries) {
    entries.splice(0, entries.length - maxEntries);
  }
  recordDiagnosticConsoleProblem(entry);

  const windows = typeof BrowserWindow?.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : [];
  for (const window of windows) {
    if (window.isDestroyed()) {
      continue;
    }

    const isConsoleWindow = consoleWindow !== null && !consoleWindow.isDestroyed() && window.id === consoleWindow.id;
    if (!isConsoleWindow) {
      continue;
    }

    const send = (): void => {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannels.DiagnosticsDevConsoleEntry, entry);
      }
    };

    if (!window.webContents.isLoading()) {
      send();
    }
  }

  return entry;
};

export const recordDevConsoleSystemEntry = (message: string): DiagnosticConsoleEntry =>
  pushEntry('system', 'info', message);

export const recordDevConsoleSystemWarning = (message: string): DiagnosticConsoleEntry =>
  pushEntry('system', 'warn', message);

const textFromChunk = (chunk: unknown, encoding?: BufferEncoding): string => {
  if (typeof chunk === 'string') {
    return chunk;
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk.toString(encoding ?? 'utf8');
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk).toString(encoding ?? 'utf8');
  }

  return '';
};

const appendStreamChunk = (
  source: DiagnosticConsoleSource,
  level: DiagnosticConsoleLevel,
  chunk: unknown,
  encoding?: BufferEncoding,
): void => {
  const text = textFromChunk(chunk, encoding);
  if (!text) {
    return;
  }

  const previous = pendingChunks.get(source) ?? '';
  const lines = `${previous}${text}`.split(/\r?\n|\r/g);
  const tail = lines.pop() ?? '';
  pendingChunks.set(source, tail);

  for (const line of lines) {
    if (line.trim()) {
      pushEntry(source, level, line);
    }
  }

  if (tail.length >= maxLineLength) {
    pendingChunks.set(source, '');
    pushEntry(source, level, tail);
  }
};

const patchWriteStream = (
  stream: NodeJS.WriteStream | undefined,
  source: DiagnosticConsoleSource,
  level: DiagnosticConsoleLevel,
): void => {
  if (!stream?.write) {
    return;
  }

  const originalWrite = stream.write.bind(stream);
  const patchedWrite = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    let result: boolean;
    if (typeof encodingOrCallback === 'function') {
      result = originalWrite(chunk, encodingOrCallback);
    } else if (typeof encodingOrCallback === 'string') {
      result = originalWrite(chunk, encodingOrCallback, callback);
    } else {
      result = originalWrite(chunk);
    }

    appendStreamChunk(source, level, chunk, typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined);
    return result;
  }) as NodeJS.WriteStream['write'];

  stream.write = patchedWrite;
};

export const initializeDevConsoleCapture = (): void => {
  if (captureInitialized) {
    return;
  }

  captureInitialized = true;
  pushEntry('system', 'info', 'ECHO Next debug console capture started.');
  patchWriteStream(process.stdout, 'stdout', 'info');
  patchWriteStream(process.stderr, 'stderr', 'error');
};

const rendererLevelFromConsoleMessage = (level: unknown): DiagnosticConsoleLevel => {
  if (typeof level === 'string') {
    if (level === 'error' || level === 'warning' || level === 'warn' || level === 'info' || level === 'debug' || level === 'log') {
      return level === 'warning' ? 'warn' : level;
    }
    return 'log';
  }

  if (level === 3) {
    return 'error';
  }

  if (level === 2) {
    return 'warn';
  }

  if (level === 1) {
    return 'info';
  }

  return 'log';
};

export const recordRendererConsoleMessage = (details: {
  level?: unknown;
  message?: string;
  lineNumber?: number;
  sourceId?: string;
}): void => {
  const message = typeof details.message === 'string' ? details.message : '';
  if (!message.trim()) {
    return;
  }

  pushEntry('renderer', rendererLevelFromConsoleMessage(details.level), message, {
    line: details.lineNumber,
    sourceId: details.sourceId,
  });
};

const appendOptionalLine = (lines: string[], label: string, value: unknown): void => {
  if (typeof value === 'string' && value.trim()) {
    lines.push(`${label}: ${value.trim()}`);
  }
};

export const recordRendererRuntimeError = (payload: RendererErrorPayload): DiagnosticConsoleEntry => {
  const lines = [`[renderer:${payload.source}] ${payload.message}`];
  appendOptionalLine(lines, 'file', payload.filename);
  if (typeof payload.lineno === 'number') {
    lines.push(`line: ${payload.lineno}${typeof payload.colno === 'number' ? `:${payload.colno}` : ''}`);
  }
  appendOptionalLine(lines, 'stack', payload.stack);

  return pushEntry('renderer', 'error', lines.join('\n'), {
    line: payload.lineno,
    sourceId: payload.filename,
  });
};

const formatNumber = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(value >= 100 ? 0 : 1) : null;

const appendOptionalValueLine = (lines: string[], label: string, value: unknown): void => {
  const numberText = formatNumber(value);
  if (numberText !== null) {
    lines.push(`${label}: ${numberText}`);
    return;
  }

  if (typeof value === 'boolean') {
    lines.push(`${label}: ${value ? 'true' : 'false'}`);
    return;
  }

  if (typeof value === 'string' && value.trim()) {
    lines.push(`${label}: ${value.trim()}`);
  }
};

const appendOptionalJsonLine = (lines: string[], label: string, value: unknown): void => {
  if (value === undefined || value === null) {
    return;
  }

  try {
    const text = JSON.stringify(value);
    if (text && text !== 'null') {
      lines.push(`${label}: ${truncateLine(text)}`);
    }
  } catch {
    lines.push(`${label}: [unserializable]`);
  }
};

const appendPlaybackBreadcrumbs = (
  lines: string[],
  breadcrumbs: ReturnType<typeof getPlaybackPerformanceSnapshot>['breadcrumbs'],
): void => {
  if (breadcrumbs.length === 0) {
    return;
  }

  lines.push('playbackBreadcrumbs:');
  for (const breadcrumb of breadcrumbs.slice(-12)) {
    const parts = [
      `-${Math.round(breadcrumb.ageMs)}ms`,
      breadcrumb.label,
      breadcrumb.trackId ? `track=${breadcrumb.trackId}` : null,
      breadcrumb.outputMode ? `mode=${breadcrumb.outputMode}` : null,
    ].filter(Boolean);
    lines.push(`  ${parts.join(' ')}`);
  }
};

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const trimmedString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

type InferredPerformanceStallCause = {
  probableCause: string;
  confidence: 'high' | 'medium' | 'low';
  why: string;
  actionHint: string;
};

const inferPerformanceStallCause = (
  payload: DiagnosticPerformanceStallPayload,
  audioSnapshot: Record<string, unknown> | null | undefined,
  playbackSnapshot: ReturnType<typeof getPlaybackPerformanceSnapshot>,
): InferredPerformanceStallCause => {
  const underrunCallbacks = finiteNumber(audioSnapshot?.nativeUnderrunCallbacks);
  const bufferedMs = finiteNumber(audioSnapshot?.nativeBufferedMs);
  const audioState = trimmedString(audioSnapshot?.state);
  const pendingBackgroundTask = trimmedString(playbackSnapshot.pendingBackgroundTask);
  const lastBackgroundTask = trimmedString(playbackSnapshot.lastBackgroundTask);
  const lastBackgroundTaskDurationMs = finiteNumber(playbackSnapshot.lastBackgroundTaskDurationMs);
  const lastBackgroundTaskAgeMs = finiteNumber(playbackSnapshot.lastBackgroundTaskAgeMs);
  const lastSlowIpcChannel = trimmedString(playbackSnapshot.lastSlowIpcChannel);
  const lastSlowIpcDurationMs = finiteNumber(playbackSnapshot.lastSlowIpcDurationMs);
  const lastSlowIpcAgeMs = finiteNumber(playbackSnapshot.lastSlowIpcAgeMs);
  const activePlaybackElapsedMs = finiteNumber(playbackSnapshot.elapsedMs);
  const lastPlaybackPhaseMs = finiteNumber(playbackSnapshot.lastCompletedDurationMs);
  const lastInputType = trimmedString(payload.details?.lastInputType);
  const lastInputAgeMs = finiteNumber(payload.details?.lastInputAgeMs);
  const longTaskName = trimmedString(payload.details?.name);

  if (audioState === 'playing' && underrunCallbacks !== null && underrunCallbacks > 0) {
    return {
      probableCause: 'audio_output_underrun',
      confidence: 'high',
      why: `audio was playing and native underrun callbacks reached ${underrunCallbacks.toFixed(0)}`,
      actionHint: 'Inspect audio backend, buffer size, sample-rate matching, and recent playbackBreadcrumbs.',
    };
  }

  if (audioState === 'playing' && bufferedMs !== null && bufferedMs < 80) {
    return {
      probableCause: 'audio_buffer_near_empty',
      confidence: 'medium',
      why: `audio was playing with only ${bufferedMs.toFixed(0)}ms buffered`,
      actionHint: 'Check decoder/proxy throughput and whether background work is competing with playback.',
    };
  }

  if (payload.source === 'main' && pendingBackgroundTask) {
    return {
      probableCause: 'main_background_task',
      confidence: 'high',
      why: `main event loop stalled while ${pendingBackgroundTask} was active`,
      actionHint: 'Move or slice this background task if it appears next to playback glitches.',
    };
  }

  if (
    payload.source === 'main' &&
    lastBackgroundTask &&
    lastBackgroundTaskDurationMs !== null &&
    lastBackgroundTaskDurationMs >= Math.max(500, payload.thresholdMs) &&
    (lastBackgroundTaskAgeMs === null || lastBackgroundTaskAgeMs <= Math.max(2_000, payload.durationMs + mainStallCheckIntervalMs))
  ) {
    return {
      probableCause: 'recent_main_background_task',
      confidence: 'medium',
      why: `${lastBackgroundTask} recently took ${lastBackgroundTaskDurationMs.toFixed(0)}ms`,
      actionHint: 'Inspect this startup or IPC step first; defer it or move heavy work off the main thread.',
    };
  }

  if (payload.source === 'main' && lastSlowIpcChannel && lastSlowIpcDurationMs !== null && lastSlowIpcAgeMs !== null && lastSlowIpcAgeMs <= 5_000) {
    return {
      probableCause: 'slow_ipc_handler',
      confidence: 'high',
      why: `IPC "${lastSlowIpcChannel}" recently took ${lastSlowIpcDurationMs.toFixed(0)}ms`,
      actionHint: 'Inspect this IPC handler first; split synchronous work, cache the result, or defer non-critical work during playback.',
    };
  }

  if (activePlaybackElapsedMs !== null && activePlaybackElapsedMs >= Math.max(500, payload.thresholdMs)) {
    return {
      probableCause: 'active_playback_phase',
      confidence: 'medium',
      why: `${playbackSnapshot.operation ?? 'playback'}:${playbackSnapshot.phase ?? 'unknown'} was still running after ${activePlaybackElapsedMs.toFixed(0)}ms`,
      actionHint: 'Inspect the active playback phase and surrounding breadcrumbs before changing audio output.',
    };
  }

  if (lastPlaybackPhaseMs !== null && lastPlaybackPhaseMs >= Math.max(500, payload.thresholdMs)) {
    return {
      probableCause: 'recent_slow_playback_phase',
      confidence: 'medium',
      why: `${playbackSnapshot.lastCompletedOperation ?? 'playback'}:${playbackSnapshot.lastCompletedPhase ?? 'unknown'} recently took ${lastPlaybackPhaseMs.toFixed(0)}ms`,
      actionHint: 'Compare the slow phase with the current route, track, and output mode.',
    };
  }

  if (payload.source === 'renderer' && payload.kind === 'long_task') {
    if (lastInputType && lastInputAgeMs !== null && lastInputAgeMs <= 1_500) {
      return {
        probableCause: 'renderer_work_after_user_input',
        confidence: 'medium',
        why: `renderer long task followed ${lastInputType} by ${lastInputAgeMs.toFixed(0)}ms`,
        actionHint: 'Check lastInputTarget, activeElement, and longTaskAttribution for the UI surface that triggered work.',
      };
    }

    return {
      probableCause: 'renderer_long_task',
      confidence: longTaskName ? 'medium' : 'low',
      why: longTaskName ? `Chromium reported long task "${longTaskName}"` : 'Chromium reported a long renderer task',
      actionHint: 'Inspect route, activeElement, and attribution; split synchronous renderer work first.',
    };
  }

  if (payload.source === 'renderer' && payload.kind === 'animation_frame') {
    return {
      probableCause: 'renderer_frame_gap',
      confidence: 'low',
      why: 'requestAnimationFrame gap exceeded the visible-frame threshold',
      actionHint: 'Look for nearby renderer warnings, image/layout work, or a matching long_task entry.',
    };
  }

  return {
    probableCause: payload.source === 'main' ? 'main_event_loop_blocked' : 'renderer_stall',
    confidence: 'low',
    why: 'no active playback phase, underrun, or known background task was attached to this stall',
    actionHint: 'Use the route, breadcrumbs, and nearby console entries to narrow the blocking work.',
  };
};

export const recordPerformanceStall = (
  payload: DiagnosticPerformanceStallPayload,
  audioSnapshot?: Record<string, unknown> | null,
): DiagnosticConsoleEntry | null => {
  const now = Date.now();
  const cooldownKey = `${payload.source}:${payload.kind}`;
  const lastLoggedAt = lastPerformanceStallLogAtByKey.get(cooldownKey) ?? 0;
  if (now - lastLoggedAt < performanceStallLogCooldownMs) {
    return null;
  }

  lastPerformanceStallLogAtByKey.set(cooldownKey, now);
  const playbackSnapshot = getPlaybackPerformanceSnapshot();
  const cause = inferPerformanceStallCause(payload, audioSnapshot, playbackSnapshot);
  recordRuntimePerformanceStall(payload, cause);
  const lines = [
    `[performance:${payload.source}] ${payload.kind} stalled for ${payload.durationMs.toFixed(0)}ms`,
    `thresholdMs: ${payload.thresholdMs.toFixed(0)}`,
    `probableCause: ${cause.probableCause}`,
    `confidence: ${cause.confidence}`,
    `why: ${cause.why}`,
    `actionHint: ${cause.actionHint}`,
  ];
  appendOptionalLine(lines, 'window', payload.windowKind);
  appendOptionalLine(lines, 'url', payload.url);
  appendOptionalLine(lines, 'route', payload.details?.route);
  appendOptionalLine(lines, 'visibilityState', payload.details?.visibilityState);
  appendOptionalValueLine(lines, 'documentFocused', payload.details?.documentFocused);
  appendOptionalLine(lines, 'activeElement', payload.details?.activeElement);
  appendOptionalLine(lines, 'lastInputType', payload.details?.lastInputType);
  appendOptionalLine(lines, 'lastInputTarget', payload.details?.lastInputTarget);
  appendOptionalValueLine(lines, 'lastInputAgeMs', payload.details?.lastInputAgeMs);
  appendOptionalValueLine(lines, 'expectedIntervalMs', payload.details?.expectedIntervalMs);
  appendOptionalValueLine(lines, 'lastFrameGapMs', payload.details?.lastFrameGapMs);
  appendOptionalLine(lines, 'longTaskName', payload.details?.name);
  appendOptionalLine(lines, 'longTaskEntryType', payload.details?.entryType);
  appendOptionalValueLine(lines, 'longTaskStartMs', payload.details?.startTime);
  appendOptionalJsonLine(lines, 'longTaskAttribution', payload.details?.attribution);

  if (audioSnapshot) {
    appendOptionalLine(lines, 'audioState', audioSnapshot.state);
    appendOptionalLine(lines, 'audioMode', audioSnapshot.outputMode);
    appendOptionalLine(lines, 'audioTrackId', audioSnapshot.currentTrackId);
    appendOptionalLine(lines, 'audioBackend', audioSnapshot.activeOutputBackendImpl ?? audioSnapshot.outputBackend);
    appendOptionalValueLine(lines, 'audioPositionSeconds', audioSnapshot.positionSeconds);
    appendOptionalValueLine(lines, 'audioBufferedMs', audioSnapshot.nativeBufferedMs);
    appendOptionalValueLine(lines, 'audioUnderrunCallbacks', audioSnapshot.nativeUnderrunCallbacks);
  }

  appendOptionalLine(lines, 'playbackOperation', playbackSnapshot.operation);
  appendOptionalLine(lines, 'playbackPhase', playbackSnapshot.phase);
  appendOptionalValueLine(lines, 'playbackPhaseElapsedMs', playbackSnapshot.elapsedMs);
  appendOptionalLine(lines, 'playbackTrackId', playbackSnapshot.trackId);
  appendOptionalLine(lines, 'playbackOutputMode', playbackSnapshot.outputMode);
  appendOptionalLine(lines, 'pendingBackgroundTask', playbackSnapshot.pendingBackgroundTask);
  appendOptionalValueLine(lines, 'pendingBackgroundTaskElapsedMs', playbackSnapshot.pendingBackgroundTaskElapsedMs);
  appendOptionalLine(lines, 'lastBackgroundTask', playbackSnapshot.lastBackgroundTask);
  appendOptionalValueLine(lines, 'lastBackgroundTaskMs', playbackSnapshot.lastBackgroundTaskDurationMs);
  appendOptionalValueLine(lines, 'lastBackgroundTaskAgeMs', playbackSnapshot.lastBackgroundTaskAgeMs);
  appendOptionalLine(lines, 'lastSlowIpcChannel', playbackSnapshot.lastSlowIpcChannel);
  appendOptionalValueLine(lines, 'lastSlowIpcMs', playbackSnapshot.lastSlowIpcDurationMs);
  appendOptionalValueLine(lines, 'lastSlowIpcAgeMs', playbackSnapshot.lastSlowIpcAgeMs);
  appendOptionalValueLine(lines, 'lastSlowIpcFailed', playbackSnapshot.lastSlowIpcFailed);
  appendOptionalLine(lines, 'lastPlaybackOperation', playbackSnapshot.lastCompletedOperation);
  appendOptionalLine(lines, 'lastPlaybackPhase', playbackSnapshot.lastCompletedPhase);
  appendOptionalValueLine(lines, 'lastPlaybackPhaseMs', playbackSnapshot.lastCompletedDurationMs);
  appendPlaybackBreadcrumbs(lines, playbackSnapshot.breadcrumbs);

  return pushEntry(payload.source === 'renderer' ? 'renderer' : 'system', 'warn', lines.join('\n'), {
    sourceId: payload.kind,
  });
};

export const initializePerformanceStallMonitor = (
  getAudioSnapshot?: () => Record<string, unknown> | null | Promise<Record<string, unknown> | null>,
): void => {
  if (performanceStallMonitorInitialized) {
    return;
  }

  performanceStallMonitorInitialized = true;
  let expectedAt = Date.now() + mainStallCheckIntervalMs;
  const timer = setInterval(() => {
    const now = Date.now();
    const driftMs = now - expectedAt;
    expectedAt = now + mainStallCheckIntervalMs;
    if (driftMs < mainStallThresholdMs) {
      return;
    }

    const scanContext = getActiveLibraryScanPerfContext();
    const payload: DiagnosticPerformanceStallPayload = {
      source: 'main',
      kind: 'event_loop',
      durationMs: driftMs,
      thresholdMs: mainStallThresholdMs,
      timestamp: new Date().toISOString(),
      details: {
        expectedIntervalMs: mainStallCheckIntervalMs,
        libraryScan: scanContext ?? undefined,
      },
    };
    if (isLibraryScanPerfDiagnosticsEnabled()) {
      console.warn(
        `[library-scan-perf] main_heartbeat durationMs=${Math.round(driftMs)} thresholdMs=${mainStallThresholdMs} jobId=${scanContext?.jobId ?? 'unknown'} phase=${scanContext?.phase ?? 'unknown'}`,
      );
    }

    Promise.resolve(getAudioSnapshot?.() ?? null)
      .then((audioSnapshot) => {
        recordPerformanceStall(payload, audioSnapshot);
      })
      .catch(() => {
        recordPerformanceStall(payload, null);
      });
  }, mainStallCheckIntervalMs);
  timer.unref?.();
};

export const recordMainRuntimeIssue = (
  type: string,
  message: string,
  details?: DiagnosticConsoleEntry['details'] & { stack?: string; reason?: string; exitCode?: number },
): DiagnosticConsoleEntry => {
  const lines = [`[main:${type}] ${message}`];
  appendOptionalLine(lines, 'reason', details?.reason);
  if (typeof details?.exitCode === 'number') {
    lines.push(`exitCode: ${details.exitCode}`);
  }
  appendOptionalLine(lines, 'stack', details?.stack);

  return pushEntry('system', 'error', lines.join('\n'), {
    line: details?.line,
    sourceId: details?.sourceId,
  });
};

const resolveDevConsolePreloadPath = (baseDir = mainOutputDir): string => {
  const mjsPreload = join(baseDir, '../preload/devConsole.mjs');

  if (existsSync(mjsPreload)) {
    return mjsPreload;
  }

  return join(baseDir, '../preload/devConsole.js');
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const devConsoleText = {
  'zh-CN': {
    htmlLang: 'zh-Hans',
    title: 'ECHO 调试控制台',
    note: '实时显示主进程 stdout/stderr 与渲染器 console，方便像 npm run dev 一样排查问题。',
    filterPlaceholder: '搜索日志 / Ctrl+F',
    filterAria: '筛选日志',
    sourceAria: '日志来源',
    levelAria: '日志级别',
    allSources: '全部来源',
    allLevels: '全部级别',
    problems: '错误/警告',
    performance: '性能',
    autoScroll: '自动滚动',
    manualScroll: '手动滚动',
    wrap: '换行',
    noWrap: '不换行',
    bottom: '到底部',
    pause: '暂停',
    resume: '继续',
    clear: '清空',
    copyVisible: '复制可见',
    saveLog: '保存 .log',
    devTools: '开发工具',
    visible: '可见',
    total: '总数',
    unread: '未读',
    waiting: '等待日志...',
    separator: ' · ',
    shortcuts: 'Ctrl+F 搜索 · Ctrl+L 清空 · End 到底部',
    problemTitle: '问题一览',
    problemTitleEmpty: '问题一览：暂无异常',
    problemHint: '最近 stderr/error/warn 会自动浮到这里；点击条目可定位同类日志。',
    problemHintEmpty: '安全模式会持续捕获主进程、渲染器和启动异常。',
    problemEmpty: '当前没有捕获到高风险日志。',
    performanceTitle: '性能时间线',
    performanceLatest: '最新',
    performanceNoStalls: '还没有捕获到卡顿。',
    noRouteAudioFields: '没有路由/音频字段',
    recentEntry: '最近一条',
    noMatches: '没有匹配的日志。',
    noLogs: '还没有日志。',
    copied: '已复制',
    copyFailed: '复制失败',
    saved: '已保存',
  },
  'zh-TW': {
    htmlLang: 'zh-Hant',
    title: 'ECHO 除錯控制台',
    note: '即時顯示主程序 stdout/stderr 與渲染器 console，方便像 npm run dev 一樣排查問題。',
    filterPlaceholder: '搜尋日誌 / Ctrl+F',
    filterAria: '篩選日誌',
    sourceAria: '日誌來源',
    levelAria: '日誌級別',
    allSources: '全部來源',
    allLevels: '全部級別',
    problems: '錯誤/警告',
    performance: 'Performance',
    autoScroll: '自動捲動',
    manualScroll: '手動捲動',
    wrap: '換行',
    noWrap: '不換行',
    bottom: '到底部',
    pause: '暫停',
    resume: '繼續',
    clear: '清空',
    copyVisible: '複製可見',
    saveLog: '儲存 .log',
    devTools: 'DevTools',
    visible: '可見',
    total: '總數',
    unread: '未讀',
    waiting: '等待日誌...',
    separator: ' · ',
    shortcuts: 'Ctrl+F 搜尋 · Ctrl+L 清空 · End 到底部',
    problemTitle: '問題一覽',
    problemTitleEmpty: '問題一覽：暫無異常',
    problemHint: '最近 stderr/error/warn 會自動浮到這裡；點擊項目可定位同類日誌。',
    problemHintEmpty: '安全模式會持續捕獲主程序、渲染器和啟動異常。',
    problemEmpty: '目前沒有捕獲到高風險日誌。',
    performanceTitle: 'Performance timeline',
    performanceLatest: 'Latest',
    performanceNoStalls: 'No stalls captured.',
    noRouteAudioFields: 'no route/audio fields',
    recentEntry: '最近一條',
    noMatches: '沒有匹配的日誌。',
    noLogs: '還沒有日誌。',
    copied: '已複製',
    copyFailed: '複製失敗',
    saved: '已儲存',
  },
  'ja-JP': {
    htmlLang: 'ja',
    title: 'ECHO デバッグコンソール',
    note: 'メインプロセスの stdout/stderr とレンダラー console をリアルタイム表示し、npm run dev のように問題を調査できます。',
    filterPlaceholder: 'ログを検索 / Ctrl+F',
    filterAria: 'ログを絞り込み',
    sourceAria: 'ログソース',
    levelAria: 'ログレベル',
    allSources: 'すべてのソース',
    allLevels: 'すべてのレベル',
    problems: 'エラー/警告',
    performance: 'Performance',
    autoScroll: '自動スクロール',
    manualScroll: '手動スクロール',
    wrap: '折り返し',
    noWrap: '折り返さない',
    bottom: '末尾へ',
    pause: '一時停止',
    resume: '再開',
    clear: 'クリア',
    copyVisible: '表示分をコピー',
    saveLog: '.log を保存',
    devTools: 'DevTools',
    visible: '表示',
    total: '合計',
    unread: '未読',
    waiting: 'ログ待機中...',
    separator: ' · ',
    shortcuts: 'Ctrl+F 検索 · Ctrl+L クリア · End 末尾へ',
    problemTitle: '問題一覧',
    problemTitleEmpty: '問題一覧: 異常なし',
    problemHint: '最近の stderr/error/warn がここに表示されます。項目をクリックすると同種ログへ絞り込めます。',
    problemHintEmpty: 'セーフモードではメインプロセス、レンダラー、起動時の異常を継続的に捕捉します。',
    problemEmpty: '高リスクログはまだ捕捉されていません。',
    performanceTitle: 'Performance timeline',
    performanceLatest: 'Latest',
    performanceNoStalls: 'No stalls captured.',
    noRouteAudioFields: 'no route/audio fields',
    recentEntry: '最新',
    noMatches: '一致するログはありません。',
    noLogs: 'ログはまだありません。',
    copied: 'コピーしました',
    copyFailed: 'コピー失敗',
    saved: '保存しました',
  },
  'en-US': {
    htmlLang: 'en',
    title: 'ECHO Debug Console',
    note: 'Shows main-process stdout/stderr and renderer console in real time, like npm run dev for troubleshooting.',
    filterPlaceholder: 'Search logs / Ctrl+F',
    filterAria: 'Filter logs',
    sourceAria: 'Log source',
    levelAria: 'Log level',
    allSources: 'All sources',
    allLevels: 'All levels',
    problems: 'Errors/Warnings',
    performance: 'Performance',
    autoScroll: 'Auto scroll',
    manualScroll: 'Manual scroll',
    wrap: 'Wrap',
    noWrap: 'No wrap',
    bottom: 'Bottom',
    pause: 'Pause',
    resume: 'Resume',
    clear: 'Clear',
    copyVisible: 'Copy visible',
    saveLog: 'Save .log',
    devTools: 'DevTools',
    visible: 'Visible',
    total: 'Total',
    unread: 'Unread',
    waiting: 'Waiting for logs...',
    separator: ' · ',
    shortcuts: 'Ctrl+F search · Ctrl+L clear · End bottom',
    problemTitle: 'Problem Overview',
    problemTitleEmpty: 'Problem Overview: no issues',
    problemHint: 'Recent stderr/error/warn entries appear here automatically. Click an item to focus related logs.',
    problemHintEmpty: 'Safe mode continuously captures main-process, renderer, and startup exceptions.',
    problemEmpty: 'No high-risk logs captured yet.',
    performanceTitle: 'Performance timeline',
    performanceLatest: 'Latest',
    performanceNoStalls: 'No stalls captured.',
    noRouteAudioFields: 'no route/audio fields',
    recentEntry: 'Latest entry',
    noMatches: 'No matching logs.',
    noLogs: 'No logs yet.',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    saved: 'Saved',
  },
} as const;

const resolveDevConsoleText = (): typeof devConsoleText[keyof typeof devConsoleText] => {
  return devConsoleText['en-US'];
};

export const createDevConsoleHtml = (): string => {
  const text = resolveDevConsoleText();
  const title = text.title;
  const note = text.note;

  return `<!doctype html>
<html lang="${escapeHtml(text.htmlLang)}">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080c11;
      --panel: #0f151d;
      --border: #263446;
      --text: #dce5f2;
      --muted: #8390a3;
      --soft: #a9b5c6;
      --accent: #6ee7b7;
      --warn: #facc15;
      --error: #fb7185;
      font-family: Consolas, "Cascadia Mono", "JetBrains Mono", monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; height: 100vh; overflow: hidden; display: flex; flex-direction: column; background: var(--bg); color: var(--text); }
    .toolbar { display: grid; grid-template-columns: minmax(260px, 1fr) auto; gap: 10px; padding: 10px 12px 8px; background: rgba(10, 15, 22, 0.98); border-bottom: 1px solid var(--border); }
    .title { display: flex; flex-direction: column; min-width: 0; }
    h1 { margin: 0; font: 600 14px/1.3 system-ui, sans-serif; letter-spacing: 0; color: #f4f7fb; }
    small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px/1.35 system-ui, sans-serif; color: var(--muted); }
    .controls { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
    button, select, input { border: 1px solid #334257; border-radius: 6px; background: #101821; color: var(--text); height: 30px; }
    button { padding: 0 10px; cursor: pointer; font: 12px system-ui, sans-serif; white-space: nowrap; }
    button:hover { background: #182434; border-color: #4d6683; }
    button[data-active="true"] { border-color: #6ee7b7; color: #e9fff7; background: #12302d; }
    select { padding: 0 8px; }
    input { width: min(360px, 28vw); min-width: 160px; padding: 0 10px; }
    .summary { display: flex; align-items: center; gap: 6px; padding: 0 12px; height: 34px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); background: var(--panel); font: 12px system-ui, sans-serif; color: var(--soft); overflow-x: auto; }
    .chip { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; min-height: 22px; padding: 2px 8px; border: 1px solid #2c3a4d; border-radius: 999px; background: #0c1219; }
    .chip strong { color: #f4f7fb; font-weight: 600; }
    .chip[data-tone="warn"] strong { color: var(--warn); }
    .chip[data-tone="error"] strong { color: var(--error); }
    .chip[data-tone="ok"] strong { color: var(--accent); }
    .problem-board { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 10px; padding: 10px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.07); background: #0b1118; color: var(--soft); font: 12px system-ui, sans-serif; }
    .problem-board[data-empty="true"] { grid-template-columns: 1fr; }
    .problem-head { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .problem-head strong { color: #f4f7fb; font-size: 13px; }
    .problem-head span { color: var(--muted); line-height: 1.35; }
    .problem-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 6px; min-width: 0; max-height: 136px; overflow: auto; }
    .problem-item { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; align-items: start; min-width: 0; border: 1px solid #2c3a4d; border-radius: 6px; padding: 7px 8px; background: #0f1721; text-align: left; height: auto; color: var(--text); }
    .problem-item:hover { background: #142030; border-color: #506985; }
    .problem-item[data-severity="error"] { border-color: rgba(251, 113, 133, 0.5); }
    .problem-item[data-severity="warn"] { border-color: rgba(250, 204, 21, 0.45); }
    .problem-badge { min-width: 46px; padding-top: 1px; color: var(--accent); font-weight: 700; text-transform: uppercase; }
    .problem-item[data-severity="error"] .problem-badge { color: var(--error); }
    .problem-item[data-severity="warn"] .problem-badge { color: var(--warn); }
    .problem-copy { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
    .problem-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #f4f7fb; }
    .problem-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9aa8bb; }
    .problem-empty { color: var(--accent); }
    .performance-board { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 10px; padding: 10px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.07); background: #0a1317; color: var(--soft); font: 12px system-ui, sans-serif; }
    .performance-board[data-empty="true"] { display: none; }
    .performance-head { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .performance-head strong { color: #f4f7fb; font-size: 13px; }
    .performance-head span { color: var(--muted); line-height: 1.35; }
    .performance-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 6px; min-width: 0; max-height: 168px; overflow: auto; }
    .performance-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; min-width: 0; border: 1px solid rgba(110, 231, 183, 0.28); border-radius: 6px; padding: 7px 8px; background: #0d1820; text-align: left; height: auto; color: var(--text); }
    .performance-item:hover { background: #132330; border-color: rgba(110, 231, 183, 0.55); }
    .performance-item[data-source="main"] { border-color: rgba(250, 204, 21, 0.42); }
    .performance-copy { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
    .performance-copy strong, .performance-copy span, .performance-copy em { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .performance-copy strong { color: #f4f7fb; font-size: 12px; }
    .performance-copy span { color: #9aa8bb; }
    .performance-copy em { color: #728096; font-style: normal; }
    .performance-duration { color: var(--warn); font-weight: 700; white-space: nowrap; }
    .console { flex: 1; overflow: auto; padding: 8px 12px 22px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.5; background: linear-gradient(#080c11, #090d13); }
    .console[data-wrap="false"] { white-space: pre; overflow-wrap: normal; }
    .line { display: grid; grid-template-columns: 58px 96px 72px 74px minmax(0, 1fr); gap: 8px; align-items: start; min-height: 20px; padding: 1px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.025); }
    .line:hover { background: rgba(255, 255, 255, 0.035); }
    .id { color: #4f5f73; text-align: right; user-select: none; }
    .time { color: #718096; }
    .source { color: #93c5fd; }
    .level { color: #a7f3d0; }
    .msg { color: #d7dde7; }
    .explain { display: block; margin-bottom: 2px; color: #a7f3d0; font-family: system-ui, sans-serif; }
    .localized-detail { display: block; color: #d7dde7; }
    .localized-detail[data-muted="true"] { color: #8fa0b7; }
    .raw-entry { margin-top: 4px; color: #8fa0b7; font-family: system-ui, sans-serif; }
    .raw-entry summary { cursor: pointer; user-select: none; }
    .raw-entry pre { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: #b8c3d3; font: 12px/1.45 Consolas, "Cascadia Mono", "JetBrains Mono", monospace; }
    .line[data-level="debug"] .level { color: #94a3b8; }
    .line[data-level="warn"] .level, .line[data-level="warning"] .level { color: var(--warn); }
    .line[data-level="error"] .level, .line[data-source="stderr"] .level { color: var(--error); }
    .line[data-source="stderr"] .msg { color: #fecdd3; }
    .line[data-source="renderer"] .source { color: #c4b5fd; }
    .line[data-source="system"] .source { color: #f9a8d4; }
    .details { color: #66758a; }
    .empty { padding: 30px 12px; color: #738096; font: 13px system-ui, sans-serif; }
    .ansi-bold { font-weight: 700; }
    .ansi-dim { opacity: 0.7; }
    .ansi-underline { text-decoration: underline; }
    .ansi-fg-30 { color: #111827; } .ansi-fg-31 { color: #ef4444; } .ansi-fg-32 { color: #22c55e; } .ansi-fg-33 { color: #eab308; }
    .ansi-fg-34 { color: #60a5fa; } .ansi-fg-35 { color: #c084fc; } .ansi-fg-36 { color: #22d3ee; } .ansi-fg-37 { color: #e5e7eb; }
    .ansi-fg-90 { color: #64748b; } .ansi-fg-91 { color: #fb7185; } .ansi-fg-92 { color: #4ade80; } .ansi-fg-93 { color: #fde047; }
    .ansi-fg-94 { color: #93c5fd; } .ansi-fg-95 { color: #d8b4fe; } .ansi-fg-96 { color: #67e8f9; } .ansi-fg-97 { color: #ffffff; }
    .ansi-bg-40 { background: #111827; } .ansi-bg-41 { background: #7f1d1d; } .ansi-bg-42 { background: #14532d; } .ansi-bg-43 { background: #713f12; }
    .ansi-bg-44 { background: #1e3a8a; } .ansi-bg-45 { background: #581c87; } .ansi-bg-46 { background: #164e63; } .ansi-bg-47 { background: #e5e7eb; color: #111827; }
    .footer { height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 12px; border-top: 1px solid rgba(255, 255, 255, 0.06); background: var(--panel); color: var(--muted); font: 12px system-ui, sans-serif; }
    @media (max-width: 860px) {
      .toolbar { grid-template-columns: 1fr; }
      .controls { justify-content: flex-start; }
      input { width: 100%; }
      .problem-board { grid-template-columns: 1fr; }
      .performance-board { grid-template-columns: 1fr; }
      .line { grid-template-columns: 48px 84px 64px minmax(0, 1fr); }
      .source { display: none; }
    }
  </style>
</head>
<body>
  <header class="toolbar">
    <div class="title">
      <h1 id="consoleTitle">${escapeHtml(title)}</h1>
      <small id="consoleNote">${escapeHtml(note)}</small>
    </div>
    <div class="controls">
      <select id="language" aria-label="Console language">
        <option value="en-US">English</option>
        <option value="zh-CN">中文</option>
      </select>
      <input id="filter" aria-label="${escapeHtml(text.filterAria)}" placeholder="${escapeHtml(text.filterPlaceholder)}" />
      <select id="source" aria-label="${escapeHtml(text.sourceAria)}">
        <option id="sourceAllOption" value="">${escapeHtml(text.allSources)}</option>
        <option value="stdout">stdout</option>
        <option value="stderr">stderr</option>
        <option value="renderer">renderer</option>
        <option value="system">system</option>
      </select>
      <select id="level" aria-label="${escapeHtml(text.levelAria)}">
        <option id="levelAllOption" value="">${escapeHtml(text.allLevels)}</option>
        <option id="levelErrorOption" value="error">error</option>
        <option id="levelWarnOption" value="warn">warn</option>
        <option id="levelInfoOption" value="info">info</option>
        <option id="levelDebugOption" value="debug">debug</option>
        <option id="levelLogOption" value="log">log</option>
      </select>
      <button id="problems" type="button">${escapeHtml(text.problems)}</button>
      <button id="performance" type="button">${escapeHtml(text.performance)}</button>
      <button id="autoscroll" type="button" data-active="true">${escapeHtml(text.autoScroll)}</button>
      <button id="wrap" type="button" data-active="true">${escapeHtml(text.wrap)}</button>
      <button id="bottom" type="button">${escapeHtml(text.bottom)}</button>
      <button id="pause" type="button">${escapeHtml(text.pause)}</button>
      <button id="resetFilters" type="button">Reset filters</button>
      <button id="clear" type="button">${escapeHtml(text.clear)}</button>
      <button id="copy" type="button">${escapeHtml(text.copyVisible)}</button>
      <button id="copyTriage" type="button">Copy triage</button>
      <button id="save" type="button">${escapeHtml(text.saveLog)}</button>
      <button id="devtools" type="button">${escapeHtml(text.devTools)}</button>
    </div>
  </header>
  <section class="summary" aria-live="polite">
    <span class="chip"><span id="visibleLabel">${escapeHtml(text.visible)}</span> <strong id="visibleCount">0</strong></span>
    <span class="chip"><span id="totalLabel">${escapeHtml(text.total)}</span> <strong id="totalCount">0</strong></span>
    <span class="chip" data-tone="error"><span id="errorLabel">error</span> <strong id="errorCount">0</strong></span>
    <span class="chip" data-tone="warn"><span id="warnLabel">warn</span> <strong id="warnCount">0</strong></span>
    <span class="chip" data-tone="warn"><span id="perfLabel">perf</span> <strong id="performanceCount">0</strong></span>
    <span class="chip" data-tone="error"><span id="stderrLabel">stderr</span> <strong id="stderrCount">0</strong></span>
    <span class="chip" data-tone="ok"><span id="rendererLabel">renderer</span> <strong id="rendererCount">0</strong></span>
    <span class="chip"><span id="unreadLabel">${escapeHtml(text.unread)}</span> <strong id="unreadCount">0</strong></span>
  </section>
  <section id="problemBoard" class="problem-board" data-empty="true" aria-live="polite"></section>
  <section id="performanceBoard" class="performance-board" data-empty="true" aria-live="polite"></section>
  <main id="console" class="console" data-wrap="true" aria-live="polite"></main>
  <footer class="footer">
    <span id="status">${escapeHtml(text.waiting)}</span>
    <span id="shortcuts">${escapeHtml(text.shortcuts)}</span>
  </footer>
  <script>
    const api = window.echoDevConsole;
    const textBundle = ${JSON.stringify({
      'en-US': devConsoleText['en-US'],
      'zh-CN': devConsoleText['zh-CN'],
    })};
    const extraText = {
      'en-US': {
        languageAria: 'Console language',
        resetFilters: 'Reset filters',
        copyTriage: 'Copy triage',
        triageCopied: 'Triage copied',
        whatHappened: 'What happened',
        nextStep: 'Next step',
        recentProblems: 'Recent problems',
        recentStalls: 'Recent performance stalls',
        none: 'None',
        triageTitle: 'ECHO Debug Console triage pack',
        triageCounts: 'Counts',
        visibleFilters: 'Visible filters',
        rawLog: 'Raw log',
      },
      'zh-CN': {
        languageAria: '控制台语言',
        resetFilters: '重置筛选',
        copyTriage: '复制排错包',
        triageCopied: '排错包已复制',
        whatHappened: '发生了什么',
        nextStep: '下一步看哪里',
        recentProblems: '最近问题',
        recentStalls: '最近卡顿',
        none: '无',
        triageTitle: 'ECHO 调试控制台排错包',
        triageCounts: '统计',
        visibleFilters: '当前筛选',
        rawLog: '原始日志',
      },
    };
    const readLanguage = () => {
      try {
        return window.localStorage.getItem('echo.devConsole.language') === 'zh-CN' ? 'zh-CN' : 'en-US';
      } catch {
        return 'en-US';
      }
    };
    const storeLanguage = (language) => {
      try {
        window.localStorage.setItem('echo.devConsole.language', language);
      } catch {
        // data: debug-console pages may not have persistent storage; the in-window switch still works.
      }
    };
    const mergedText = (language) => Object.assign({}, textBundle['en-US'], textBundle[language] || {}, extraText['en-US'], extraText[language] || {});
    let currentLanguage = readLanguage();
    let text = mergedText(currentLanguage);
    const consoleEl = document.getElementById('console');
    const titleEl = document.getElementById('consoleTitle');
    const noteEl = document.getElementById('consoleNote');
    const languageEl = document.getElementById('language');
    const filterEl = document.getElementById('filter');
    const sourceEl = document.getElementById('source');
    const levelEl = document.getElementById('level');
    const sourceAllOption = document.getElementById('sourceAllOption');
    const levelAllOption = document.getElementById('levelAllOption');
    const levelErrorOption = document.getElementById('levelErrorOption');
    const levelWarnOption = document.getElementById('levelWarnOption');
    const levelInfoOption = document.getElementById('levelInfoOption');
    const levelDebugOption = document.getElementById('levelDebugOption');
    const levelLogOption = document.getElementById('levelLogOption');
    const problemsButton = document.getElementById('problems');
    const performanceButton = document.getElementById('performance');
    const autoScrollButton = document.getElementById('autoscroll');
    const wrapButton = document.getElementById('wrap');
    const bottomButton = document.getElementById('bottom');
    const pauseButton = document.getElementById('pause');
    const resetFiltersButton = document.getElementById('resetFilters');
    const clearButton = document.getElementById('clear');
    const copyButton = document.getElementById('copy');
    const copyTriageButton = document.getElementById('copyTriage');
    const saveButton = document.getElementById('save');
    const devtoolsButton = document.getElementById('devtools');
    const problemBoardEl = document.getElementById('problemBoard');
    const performanceBoardEl = document.getElementById('performanceBoard');
    const statusEl = document.getElementById('status');
    const shortcutsEl = document.getElementById('shortcuts');
    const visibleLabelEl = document.getElementById('visibleLabel');
    const totalLabelEl = document.getElementById('totalLabel');
    const unreadLabelEl = document.getElementById('unreadLabel');
    const errorLabelEl = document.getElementById('errorLabel');
    const warnLabelEl = document.getElementById('warnLabel');
    const perfLabelEl = document.getElementById('perfLabel');
    const stderrLabelEl = document.getElementById('stderrLabel');
    const rendererLabelEl = document.getElementById('rendererLabel');
    const visibleCountEl = document.getElementById('visibleCount');
    const totalCountEl = document.getElementById('totalCount');
    const errorCountEl = document.getElementById('errorCount');
    const warnCountEl = document.getElementById('warnCount');
    const performanceCountEl = document.getElementById('performanceCount');
    const stderrCountEl = document.getElementById('stderrCount');
    const rendererCountEl = document.getElementById('rendererCount');
    const unreadCountEl = document.getElementById('unreadCount');
    let entries = [];
    let paused = false;
    let onlyProblems = false;
    let onlyPerformance = false;
    let autoScroll = true;
    let wrapLines = true;
    let unread = 0;
    let pendingEntries = [];
    let entryFlushTimer = null;
    const ansiCodePattern = /\\u001b\\[([0-9;?]*)m/g;
    const ansiStripPattern = /\\u001b\\[[0-9;?]*[ -/]*[@-~]/g;
    const fgCodes = new Set(['30', '31', '32', '33', '34', '35', '36', '37', '90', '91', '92', '93', '94', '95', '96', '97']);
    const bgCodes = new Set(['40', '41', '42', '43', '44', '45', '46', '47']);
    const zhCauseLabels = {
      audio_output_underrun: '音频输出发生 underrun',
      audio_buffer_near_empty: '音频缓冲快空了',
      main_background_task: '主进程后台任务堵住事件循环',
      recent_main_background_task: '刚结束的主进程后台任务很慢',
      slow_ipc_handler: 'IPC 处理太慢',
      active_playback_phase: '播放切换阶段仍在运行',
      recent_slow_playback_phase: '刚结束的播放阶段很慢',
      renderer_work_after_user_input: '用户操作后渲染器同步工作太重',
      renderer_long_task: '渲染器长任务',
      renderer_frame_gap: '渲染帧间隔过大',
      main_event_loop_blocked: '主进程事件循环被阻塞',
      renderer_stall: '渲染器卡顿',
      unknown: '原因未知',
    };
    const zhConfidenceLabels = {
      high: '高置信',
      medium: '中等置信',
      low: '低置信',
    };
    const zhSourceLabels = {
      stdout: '主进程输出',
      stderr: '错误输出',
      renderer: '渲染器',
      system: '系统',
    };
    const zhLevelLabels = {
      error: '错误',
      warn: '警告',
      info: '信息',
      debug: '调试',
      log: '日志',
    };
    const zhKindLabels = {
      event_loop: '事件循环',
      animation_frame: '渲染帧',
      long_task: '长任务',
    };

    const causeLabel = (cause) => currentLanguage === 'zh-CN' ? (zhCauseLabels[cause] || cause || zhCauseLabels.unknown) : (cause || 'unknown');
    const confidenceLabel = (confidence) => currentLanguage === 'zh-CN' ? (zhConfidenceLabels[confidence] || confidence) : confidence;
    const sourceLabel = (source) => currentLanguage === 'zh-CN' ? (zhSourceLabels[source] || source) : source;
    const levelLabel = (level) => currentLanguage === 'zh-CN' ? (zhLevelLabels[level] || level) : level;
    const kindLabel = (kind) => currentLanguage === 'zh-CN' ? (zhKindLabels[kind] || kind) : kind;
    const localizedPerformanceSummary = (stall) => {
      const cause = causeLabel(stall.cause);
      const confidence = confidenceLabel(stall.confidence);
      const duration = stall.durationMs === null ? '?' : Math.round(stall.durationMs) + 'ms';
      if (currentLanguage !== 'zh-CN') {
        return text.whatHappened + ': ' + stall.source + '/' + stall.kind + ' stalled ' + duration + ' · ' + cause + (confidence ? ' · ' + confidence : '');
      }

      const details = [];
      if (stall.route) {
        details.push('路由 ' + stall.route);
      }
      if (stall.audioState || stall.audioMode) {
        details.push('音频 ' + [stall.audioState, stall.audioMode].filter(Boolean).join('/'));
      }
      if (stall.pendingTask) {
        details.push('正在跑 ' + stall.pendingTask);
      } else if (stall.lastTask) {
        details.push('刚跑过 ' + stall.lastTask + (stall.lastTaskMs ? ' ' + stall.lastTaskMs + 'ms' : ''));
      } else if (stall.playbackPhase) {
        details.push('播放阶段 ' + stall.playbackPhase);
      } else if (stall.inputTarget) {
        details.push('操作目标 ' + stall.inputTarget);
      }
      return text.whatHappened + ': ' + sourceLabel(stall.source) + '/' + kindLabel(stall.kind) + ' 卡了 ' + duration + '，' + cause + (confidence ? '，' + confidence : '') + (details.length ? '；' + details.join('；') : '');
    };
    const localizedActionHint = (stall) => {
      if (currentLanguage !== 'zh-CN') {
        return stall.actionHint || '';
      }

      if (stall.cause === 'audio_output_underrun') {
        return '先看音频后端、缓冲大小、采样率是否匹配，再对照 playbackBreadcrumbs。';
      }
      if (stall.cause === 'audio_buffer_near_empty') {
        return '先查解码/代理吞吐，以及是否有后台任务和播放抢资源。';
      }
      if (stall.cause === 'main_background_task' || stall.cause === 'recent_main_background_task') {
        return '优先拆这个后台任务：切片、延后，或移出主线程。';
      }
      if (stall.cause === 'slow_ipc_handler') {
        return '优先查最近的慢 IPC，把同步重活拆开、缓存或播放中延后。';
      }
      if (stall.cause === 'renderer_work_after_user_input' || stall.cause === 'renderer_long_task') {
        return '看 route、activeElement、lastInputTarget 和 longTaskAttribution，先拆渲染同步工作。';
      }
      if (stall.cause === 'renderer_frame_gap') {
        return '查看附近的渲染器警告、图片/布局工作，或相邻 long_task 记录。';
      }
      if (stall.cause === 'active_playback_phase' || stall.cause === 'recent_slow_playback_phase') {
        return '先对照播放阶段和附近 breadcrumbs，再改输出链路。';
      }
      return '结合路由、附近日志和面板里的来源继续缩小范围。';
    };
    const localizedPerformanceDetails = (stall) => {
      if (currentLanguage !== 'zh-CN') {
        return [];
      }

      const details = [
        '原因：' + causeLabel(stall.cause),
        stall.confidence ? '置信度：' + confidenceLabel(stall.confidence) : null,
        stall.route ? '路由：' + stall.route : null,
        stall.audioState || stall.audioMode ? '音频：' + [stall.audioState, stall.audioMode].filter(Boolean).join('/') : null,
        stall.audioBufferedMs ? '音频缓冲：' + stall.audioBufferedMs + 'ms' : null,
        stall.underruns ? '音频 underrun 次数：' + stall.underruns : null,
        stall.pendingTask ? '正在执行的后台任务：' + stall.pendingTask : null,
        stall.lastTask ? '最近完成的后台任务：' + stall.lastTask + (stall.lastTaskMs ? '，耗时 ' + stall.lastTaskMs + 'ms' : '') : null,
        stall.playbackPhase ? '播放阶段：' + stall.playbackPhase : null,
        stall.inputTarget ? '最近操作目标：' + stall.inputTarget : null,
        '下一步：' + localizedActionHint(stall),
      ].filter(Boolean);
      return details;
    };
    const localizedEntryHeadline = (entry) => {
      const stall = parsePerformanceEntry(entry);
      if (stall) {
        return localizedPerformanceSummary(stall);
      }
      if (currentLanguage !== 'zh-CN') {
        return compactProblemText(entry.message, 120);
      }

      const message = String(entry.message || '');
      if (message.includes('Electron Security Warning')) {
        return 'Electron 安全警告：当前渲染器安全策略未完全启用，仅用于开发排错参考。';
      }
      if (message.startsWith('[Startup]')) {
        return '启动阶段提示：' + compactProblemText(message.replace(/^\\[Startup\\]\\s*/u, ''), 100);
      }
      if (message.startsWith('[startup:persistent-state]')) {
        return '启动状态已记录：用于排查上次启动/恢复路径。';
      }
      if (message.startsWith('[playback-perf]')) {
        return '播放性能记录：' + compactProblemText(message.replace(/^\\[playback-perf\\]\\s*/u, ''), 100);
      }
      return compactProblemText(message, 120);
    };

    const timePart = (timestamp) => {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) {
        return timestamp;
      }
      const pad = (value, size) => String(value).padStart(size, '0');
      return pad(date.getHours(), 2) + ':' + pad(date.getMinutes(), 2) + ':' + pad(date.getSeconds(), 2) + '.' + pad(date.getMilliseconds(), 3);
    };
    const applyText = () => {
      document.documentElement.lang = text.htmlLang;
      document.title = text.title;
      titleEl.textContent = text.title;
      noteEl.textContent = text.note;
      languageEl.setAttribute('aria-label', text.languageAria);
      languageEl.value = currentLanguage;
      filterEl.placeholder = text.filterPlaceholder;
      filterEl.setAttribute('aria-label', text.filterAria);
      sourceEl.setAttribute('aria-label', text.sourceAria);
      levelEl.setAttribute('aria-label', text.levelAria);
      sourceAllOption.textContent = text.allSources;
      levelAllOption.textContent = text.allLevels;
      levelErrorOption.textContent = levelLabel('error');
      levelWarnOption.textContent = levelLabel('warn');
      levelInfoOption.textContent = levelLabel('info');
      levelDebugOption.textContent = levelLabel('debug');
      levelLogOption.textContent = levelLabel('log');
      problemsButton.textContent = text.problems;
      performanceButton.textContent = text.performance;
      bottomButton.textContent = text.bottom;
      resetFiltersButton.textContent = text.resetFilters;
      clearButton.textContent = text.clear;
      copyButton.textContent = text.copyVisible;
      copyTriageButton.textContent = text.copyTriage;
      saveButton.textContent = text.saveLog;
      devtoolsButton.textContent = text.devTools;
      visibleLabelEl.textContent = text.visible;
      totalLabelEl.textContent = text.total;
      unreadLabelEl.textContent = text.unread;
      errorLabelEl.textContent = levelLabel('error');
      warnLabelEl.textContent = levelLabel('warn');
      perfLabelEl.textContent = currentLanguage === 'zh-CN' ? '性能' : 'perf';
      stderrLabelEl.textContent = sourceLabel('stderr');
      rendererLabelEl.textContent = sourceLabel('renderer');
      shortcutsEl.textContent = text.shortcuts;
    };

    const isNearBottom = () => consoleEl.scrollTop + consoleEl.clientHeight >= consoleEl.scrollHeight - 48;
    const isProblemEntry = (entry) => entry.source === 'stderr' || entry.level === 'error' || entry.level === 'warn';
    const isPerformanceEntry = (entry) => /^\\[performance:(main|renderer)\\]/.test(entry.message);
    const problemSeverity = (entry) => entry.level === 'error' || entry.source === 'stderr' ? 'error' : 'warn';
    const fieldFromLines = (message, name) => {
      const prefix = name + ':';
      const line = String(message || '').split('\\n').find((item) => item.startsWith(prefix));
      return line ? line.slice(prefix.length).trim() : '';
    };
    const parsePerformanceEntry = (entry) => {
      if (!isPerformanceEntry(entry)) {
        return null;
      }

      const header = entry.message.match(/^\\[performance:([^\\]]+)\\]\\s+([^\\s]+)\\s+stalled for\\s+([0-9.]+)ms/);
      const durationMs = header ? Number(header[3]) : Number.NaN;
      const source = header?.[1] || entry.source;
      const kind = header?.[2] || entry.details?.sourceId || 'stall';
      const cause = fieldFromLines(entry.message, 'probableCause') || 'unknown';
      const confidence = fieldFromLines(entry.message, 'confidence');
      const why = fieldFromLines(entry.message, 'why');
      const actionHint = fieldFromLines(entry.message, 'actionHint');
      const route = fieldFromLines(entry.message, 'route');
      const audioState = fieldFromLines(entry.message, 'audioState');
      const audioMode = fieldFromLines(entry.message, 'audioMode');
      const audioBufferedMs = fieldFromLines(entry.message, 'audioBufferedMs');
      const underruns = fieldFromLines(entry.message, 'audioUnderrunCallbacks');
      const pendingTask = fieldFromLines(entry.message, 'pendingBackgroundTask');
      const lastTask = fieldFromLines(entry.message, 'lastBackgroundTask');
      const lastTaskMs = fieldFromLines(entry.message, 'lastBackgroundTaskMs');
      const playbackPhase = fieldFromLines(entry.message, 'playbackPhase') || fieldFromLines(entry.message, 'lastPlaybackPhase');
      const inputTarget = fieldFromLines(entry.message, 'lastInputTarget');
      return {
        entry,
        source,
        kind,
        durationMs: Number.isFinite(durationMs) ? durationMs : null,
        cause,
        confidence,
        why,
        actionHint,
        route,
        audioState,
        audioMode,
        audioBufferedMs,
        underruns,
        pendingTask,
        lastTask,
        lastTaskMs,
        playbackPhase,
        inputTarget,
      };
    };
    const passesFilters = (entry) => {
      const query = filterEl.value.trim().toLowerCase();
      const source = sourceEl.value;
      const level = levelEl.value;
      if (source && entry.source !== source) {
        return false;
      }
      if (level && entry.level !== level) {
        return false;
      }
      if (onlyProblems && !isProblemEntry(entry)) {
        return false;
      }
      if (onlyPerformance && !isPerformanceEntry(entry)) {
        return false;
      }
      if (!query) {
        return true;
      }
      const detailText = entry.details ? String(entry.details.sourceId || '') + ':' + String(entry.details.line || '') : '';
      const stall = parsePerformanceEntry(entry);
      const localizedText = currentLanguage === 'zh-CN'
        ? [localizedEntryHeadline(entry), stall ? localizedPerformanceDetails(stall).join(' ') : ''].join(' ')
        : (stall ? (localizedPerformanceSummary(stall) + ' ' + localizedActionHint(stall)) : '');
      return entry.message.toLowerCase().includes(query) ||
        localizedText.toLowerCase().includes(query) ||
        entry.source.toLowerCase().includes(query) ||
        sourceLabel(entry.source).toLowerCase().includes(query) ||
        entry.level.toLowerCase().includes(query) ||
        levelLabel(entry.level).toLowerCase().includes(query) ||
        detailText.toLowerCase().includes(query);
    };

    const clearAnsiClass = (classSet, prefix) => {
      for (const className of Array.from(classSet)) {
        if (className.startsWith(prefix)) {
          classSet.delete(className);
        }
      }
    };
    const applyAnsiCodes = (codes, classSet) => {
      const parts = codes ? codes.split(';').filter(Boolean) : ['0'];
      for (const code of parts.length ? parts : ['0']) {
        if (code === '0') {
          classSet.clear();
        } else if (code === '1') {
          classSet.add('ansi-bold');
        } else if (code === '2') {
          classSet.add('ansi-dim');
        } else if (code === '4') {
          classSet.add('ansi-underline');
        } else if (code === '22') {
          classSet.delete('ansi-bold');
          classSet.delete('ansi-dim');
        } else if (code === '24') {
          classSet.delete('ansi-underline');
        } else if (code === '39') {
          clearAnsiClass(classSet, 'ansi-fg-');
        } else if (code === '49') {
          clearAnsiClass(classSet, 'ansi-bg-');
        } else if (fgCodes.has(code)) {
          clearAnsiClass(classSet, 'ansi-fg-');
          classSet.add('ansi-fg-' + code);
        } else if (bgCodes.has(code)) {
          clearAnsiClass(classSet, 'ansi-bg-');
          classSet.add('ansi-bg-' + code);
        }
      }
    };
    const appendAnsiText = (container, value) => {
      const classSet = new Set();
      let cursor = 0;
      let match;
      const append = (text) => {
        const clean = text.replace(ansiStripPattern, '');
        if (!clean) {
          return;
        }
        const span = document.createElement('span');
        span.textContent = clean;
        if (classSet.size) {
          span.className = Array.from(classSet).join(' ');
        }
        container.append(span);
      };
      ansiCodePattern.lastIndex = 0;
      while ((match = ansiCodePattern.exec(value)) !== null) {
        append(value.slice(cursor, match.index));
        applyAnsiCodes(match[1], classSet);
        cursor = ansiCodePattern.lastIndex;
      }
      append(value.slice(cursor));
    };
    const formatEntryLine = (entry) => {
      const details = entry.details && entry.details.sourceId ? ' (' + entry.details.sourceId + (entry.details.line ? ':' + entry.details.line : '') + ')' : '';
      return '[' + entry.timestamp + '] [' + entry.source + '] [' + entry.level + '] ' + entry.message + details;
    };
    const formatTriageReport = () => {
      const visible = entries.filter(passesFilters);
      const problems = entries.filter(isProblemEntry).slice(-20);
      const stalls = entries.map(parsePerformanceEntry).filter(Boolean).slice(-12);
      const counts = {
        total: entries.length,
        visible: visible.length,
        error: entries.filter((entry) => entry.level === 'error').length,
        warn: entries.filter((entry) => entry.level === 'warn').length,
        stderr: entries.filter((entry) => entry.source === 'stderr').length,
        performance: entries.filter(isPerformanceEntry).length,
      };
      const filters = [
        filterEl.value.trim() ? 'query=' + filterEl.value.trim() : null,
        sourceEl.value ? 'source=' + sourceEl.value : null,
        levelEl.value ? 'level=' + levelEl.value : null,
        onlyProblems ? 'onlyProblems=true' : null,
        onlyPerformance ? 'onlyPerformance=true' : null,
      ].filter(Boolean);
      const lines = [
        text.triageTitle,
        'generatedAt: ' + new Date().toISOString(),
        'language: ' + currentLanguage,
        text.triageCounts + ': total=' + counts.total + ' visible=' + counts.visible + ' error=' + counts.error + ' warn=' + counts.warn + ' stderr=' + counts.stderr + ' perf=' + counts.performance,
        text.visibleFilters + ': ' + (filters.length ? filters.join(' ') : text.none),
        '',
        text.recentStalls + ':',
      ];
      if (stalls.length) {
        for (const stall of stalls) {
          lines.push('- ' + localizedPerformanceSummary(stall));
          const hint = localizedActionHint(stall);
          if (hint) {
            lines.push('  ' + text.nextStep + ': ' + hint);
          }
          lines.push('  raw: ' + formatEntryLine(stall.entry));
        }
      } else {
        lines.push('- ' + text.none);
      }
      lines.push('', text.recentProblems + ':');
      if (problems.length) {
        for (const entry of problems) {
          lines.push('- ' + formatEntryLine(entry));
        }
      } else {
        lines.push('- ' + text.none);
      }
      return lines.join('\\n');
    };
    const compactProblemText = (value, maxLength) => {
      const text = String(value || '').replace(/\\s+/g, ' ').trim();
      return text.length > maxLength ? text.slice(0, maxLength - 1) + '...' : text;
    };
    const renderProblemBoard = () => {
      const problems = entries.filter(isProblemEntry).slice(-12).reverse();
      problemBoardEl.replaceChildren();
      problemBoardEl.dataset.empty = String(problems.length === 0);

      const head = document.createElement('div');
      head.className = 'problem-head';
      const title = document.createElement('strong');
      title.textContent = problems.length ? text.problemTitle : text.problemTitleEmpty;
      const hint = document.createElement('span');
      hint.textContent = problems.length
        ? text.problemHint
        : text.problemHintEmpty;
      head.append(title, hint);
      problemBoardEl.append(head);

      if (problems.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'problem-empty';
        empty.textContent = text.problemEmpty;
        problemBoardEl.append(empty);
        return;
      }

      const list = document.createElement('div');
      list.className = 'problem-list';
      for (const entry of problems) {
        const item = document.createElement('button');
        item.className = 'problem-item';
        item.type = 'button';
        item.dataset.severity = problemSeverity(entry);
        item.title = formatEntryLine(entry);
        item.addEventListener('click', () => {
          onlyProblems = true;
          onlyPerformance = false;
          sourceEl.value = entry.source;
          levelEl.value = entry.level;
          render();
        });
        const badge = document.createElement('span');
        badge.className = 'problem-badge';
        badge.textContent = levelLabel(problemSeverity(entry));
        const copy = document.createElement('span');
        copy.className = 'problem-copy';
        const main = document.createElement('strong');
        main.textContent = localizedEntryHeadline(entry);
        const meta = document.createElement('span');
        meta.textContent = '#' + entry.id + text.separator + timePart(entry.timestamp) + text.separator + sourceLabel(entry.source) + '/' + levelLabel(entry.level);
        copy.append(main, meta);
        item.append(badge, copy);
        list.append(item);
      }
      problemBoardEl.append(list);
    };
    const renderPerformanceBoard = () => {
      const stalls = entries.map(parsePerformanceEntry).filter(Boolean).slice(-10).reverse();
      performanceBoardEl.replaceChildren();
      performanceBoardEl.dataset.empty = String(stalls.length === 0);
      if (stalls.length === 0) {
        return;
      }

      const head = document.createElement('div');
      head.className = 'performance-head';
      const title = document.createElement('strong');
      title.textContent = text.performanceTitle;
      const hint = document.createElement('span');
      const latest = stalls[0];
      hint.textContent = latest
        ? text.performanceLatest + ': ' + causeLabel(latest.cause) + ' · ' + (latest.durationMs === null ? '?' : Math.round(latest.durationMs) + 'ms')
        : text.performanceNoStalls;
      head.append(title, hint);
      performanceBoardEl.append(head);

      const list = document.createElement('div');
      list.className = 'performance-list';
      for (const stall of stalls) {
        const item = document.createElement('button');
        item.className = 'performance-item';
        item.type = 'button';
        item.dataset.source = stall.source;
        item.title = formatEntryLine(stall.entry);
        item.addEventListener('click', () => {
          onlyPerformance = true;
          onlyProblems = false;
          sourceEl.value = '';
          levelEl.value = '';
          filterEl.value = stall.cause && stall.cause !== 'unknown' ? stall.cause : '';
          render();
        });

        const copy = document.createElement('span');
        copy.className = 'performance-copy';
        const main = document.createElement('strong');
        main.textContent = localizedPerformanceSummary(stall);
        const routeParts = [
          stall.route ? (currentLanguage === 'zh-CN' ? '路由=' : 'route=') + stall.route : null,
          stall.audioMode ? (currentLanguage === 'zh-CN' ? '音频模式=' : 'audio=') + stall.audioMode : null,
          stall.audioState ? (currentLanguage === 'zh-CN' ? '音频状态=' : 'state=') + stall.audioState : null,
          stall.underruns ? (currentLanguage === 'zh-CN' ? 'underrun=' : 'underruns=') + stall.underruns : null,
        ].filter(Boolean);
        const route = document.createElement('span');
        route.textContent = routeParts.length ? routeParts.join(text.separator) : text.noRouteAudioFields;
        const taskParts = [
          stall.pendingTask ? (currentLanguage === 'zh-CN' ? '正在执行=' : 'pending=') + stall.pendingTask : null,
          stall.lastTask ? (currentLanguage === 'zh-CN' ? '最近任务=' : 'last=') + stall.lastTask + (stall.lastTaskMs ? ' ' + stall.lastTaskMs + 'ms' : '') : null,
          stall.playbackPhase ? (currentLanguage === 'zh-CN' ? '播放阶段=' : 'playback=') + stall.playbackPhase : null,
          stall.inputTarget ? (currentLanguage === 'zh-CN' ? '操作目标=' : 'input=') + stall.inputTarget : null,
        ].filter(Boolean);
        const task = document.createElement('em');
        task.textContent = localizedActionHint(stall) || (taskParts.length ? taskParts.join(text.separator) : '#' + stall.entry.id + text.separator + timePart(stall.entry.timestamp));
        copy.append(main, route, task);

        const duration = document.createElement('span');
        duration.className = 'performance-duration';
        duration.textContent = stall.durationMs === null ? '?' : Math.round(stall.durationMs) + 'ms';
        item.append(copy, duration);
        list.append(item);
      }
      performanceBoardEl.append(list);
    };
    const setTemporaryButtonText = (button, text) => {
      const original = button.textContent;
      button.textContent = text;
      window.setTimeout(() => {
        button.textContent = original;
      }, 1200);
    };
    const renderStats = (visible) => {
      const total = entries.length;
      const errors = entries.filter((entry) => entry.level === 'error').length;
      const warns = entries.filter((entry) => entry.level === 'warn').length;
      const performance = entries.filter(isPerformanceEntry).length;
      const stderrs = entries.filter((entry) => entry.source === 'stderr').length;
      const renderers = entries.filter((entry) => entry.source === 'renderer').length;
      visibleCountEl.textContent = String(visible.length);
      totalCountEl.textContent = String(total);
      errorCountEl.textContent = String(errors);
      warnCountEl.textContent = String(warns);
      performanceCountEl.textContent = String(performance);
      stderrCountEl.textContent = String(stderrs);
      rendererCountEl.textContent = String(renderers);
      unreadCountEl.textContent = String(unread);
      problemsButton.dataset.active = String(onlyProblems);
      performanceButton.dataset.active = String(onlyPerformance);
      autoScrollButton.dataset.active = String(autoScroll);
      wrapButton.dataset.active = String(wrapLines);
      autoScrollButton.textContent = autoScroll ? text.autoScroll : text.manualScroll;
      wrapButton.textContent = wrapLines ? text.wrap : text.noWrap;
      pauseButton.textContent = paused ? text.resume + (unread ? ' +' + unread : '') : text.pause;
      statusEl.textContent = total ? text.recentEntry + ' #' + entries[entries.length - 1].id + text.separator + timePart(entries[entries.length - 1].timestamp) : text.waiting;
    };
    const scrollToBottom = () => {
      consoleEl.scrollTop = consoleEl.scrollHeight;
      unread = 0;
      renderStats(entries.filter(passesFilters));
    };
    const render = (stickOverride) => {
      const stick = typeof stickOverride === 'boolean' ? stickOverride : autoScroll && isNearBottom();
      const visible = entries.filter(passesFilters);
      consoleEl.replaceChildren();
      if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = entries.length ? text.noMatches : text.noLogs;
        consoleEl.append(empty);
      } else {
        const fragment = document.createDocumentFragment();
        for (const entry of visible) {
          const row = document.createElement('div');
          row.className = 'line';
          row.dataset.level = entry.level;
          row.dataset.source = entry.source;
          const details = entry.details && entry.details.sourceId ? entry.details.sourceId + (entry.details.line ? ':' + entry.details.line : '') : '';
          if (details) {
            row.title = details;
          }
          const id = document.createElement('span');
          id.className = 'id';
          id.textContent = '#' + entry.id;
          const time = document.createElement('span');
          time.className = 'time';
          time.textContent = timePart(entry.timestamp);
          const source = document.createElement('span');
          source.className = 'source';
          source.textContent = sourceLabel(entry.source);
          const level = document.createElement('span');
          level.className = 'level';
          level.textContent = levelLabel(entry.level);
          const msg = document.createElement('span');
          msg.className = 'msg';
          const stall = currentLanguage === 'zh-CN' ? parsePerformanceEntry(entry) : null;
          if (stall) {
            const explain = document.createElement('span');
            explain.className = 'explain';
            explain.textContent = localizedPerformanceSummary(stall);
            msg.append(explain);
            for (const detail of localizedPerformanceDetails(stall)) {
              const line = document.createElement('span');
              line.className = 'localized-detail';
              line.textContent = detail;
              msg.append(line);
            }
            const raw = document.createElement('details');
            raw.className = 'raw-entry';
            const summary = document.createElement('summary');
            summary.textContent = text.rawLog;
            const pre = document.createElement('pre');
            pre.textContent = entry.rawMessage || entry.message;
            raw.append(summary, pre);
            msg.append(raw);
          } else if (currentLanguage === 'zh-CN' && isProblemEntry(entry)) {
            const explain = document.createElement('span');
            explain.className = 'explain';
            explain.textContent = localizedEntryHeadline(entry);
            msg.append(explain);
            appendAnsiText(msg, entry.rawMessage || entry.message);
          } else {
            appendAnsiText(msg, entry.rawMessage || entry.message);
          }
          if (details) {
            const detailsSpan = document.createElement('span');
            detailsSpan.className = 'details';
            detailsSpan.textContent = '  ' + details;
            msg.append(detailsSpan);
          }
          row.append(id, time, source, level, msg);
          fragment.append(row);
        }
        consoleEl.append(fragment);
      }
      renderStats(visible);
      renderProblemBoard();
      renderPerformanceBoard();
      consoleEl.dataset.wrap = String(wrapLines);
      if (stick && !paused) {
        scrollToBottom();
      }
    };
    const appendEntries = (nextEntries) => {
      if (!nextEntries.length) {
        return;
      }
      const stick = autoScroll && isNearBottom();
      entries = entries.concat(nextEntries).slice(-2500);
      if (paused) {
        unread += nextEntries.length;
        renderStats(entries.filter(passesFilters));
        return;
      }
      if (!autoScroll || !stick) {
        unread += nextEntries.length;
      }
      render(stick);
    };
    const flushPendingEntries = () => {
      entryFlushTimer = null;
      const nextEntries = pendingEntries;
      pendingEntries = [];
      appendEntries(nextEntries);
    };
    const scheduleEntryFlush = () => {
      if (entryFlushTimer !== null) {
        return;
      }
      entryFlushTimer = window.setTimeout(flushPendingEntries, 80);
    };
    const flushPendingEntriesNow = () => {
      if (entryFlushTimer !== null) {
        window.clearTimeout(entryFlushTimer);
        entryFlushTimer = null;
      }
      flushPendingEntries();
    };
    const discardPendingEntries = () => {
      pendingEntries = [];
      if (entryFlushTimer !== null) {
        window.clearTimeout(entryFlushTimer);
        entryFlushTimer = null;
      }
    };

    applyText();

    api.getSnapshot().then((snapshot) => {
      entries = snapshot.entries;
      render();
      scrollToBottom();
    }).catch((error) => {
      entries = [{ id: 0, timestamp: new Date().toISOString(), source: 'system', level: 'error', message: String(error) }];
      render();
    });

    api.onEntry((entry) => {
      pendingEntries.push(entry);
      scheduleEntryFlush();
    });

    languageEl.addEventListener('change', () => {
      currentLanguage = languageEl.value === 'zh-CN' ? 'zh-CN' : 'en-US';
      storeLanguage(currentLanguage);
      text = mergedText(currentLanguage);
      applyText();
      render();
    });
    filterEl.addEventListener('input', () => {
      flushPendingEntriesNow();
      render();
    });
    sourceEl.addEventListener('change', () => {
      flushPendingEntriesNow();
      render();
    });
    levelEl.addEventListener('change', () => {
      flushPendingEntriesNow();
      render();
    });
    problemsButton.addEventListener('click', () => {
      flushPendingEntriesNow();
      onlyProblems = !onlyProblems;
      if (onlyProblems) {
        onlyPerformance = false;
      }
      render();
    });
    performanceButton.addEventListener('click', () => {
      flushPendingEntriesNow();
      onlyPerformance = !onlyPerformance;
      if (onlyPerformance) {
        onlyProblems = false;
        sourceEl.value = '';
        levelEl.value = '';
      }
      render();
    });
    autoScrollButton.addEventListener('click', () => {
      autoScroll = !autoScroll;
      if (autoScroll) {
        scrollToBottom();
      }
      render();
    });
    wrapButton.addEventListener('click', () => {
      wrapLines = !wrapLines;
      render();
    });
    bottomButton.addEventListener('click', () => {
      flushPendingEntriesNow();
      scrollToBottom();
    });
    pauseButton.addEventListener('click', () => {
      flushPendingEntriesNow();
      paused = !paused;
      if (!paused) {
        unread = 0;
        render();
        if (autoScroll) {
          scrollToBottom();
        }
      } else {
        renderStats(entries.filter(passesFilters));
      }
    });
    resetFiltersButton.addEventListener('click', () => {
      flushPendingEntriesNow();
      filterEl.value = '';
      sourceEl.value = '';
      levelEl.value = '';
      onlyProblems = false;
      onlyPerformance = false;
      render();
    });
    clearButton.addEventListener('click', () => {
      discardPendingEntries();
      entries = [];
      unread = 0;
      api.clear().finally(render);
    });
    copyButton.addEventListener('click', () => {
      flushPendingEntriesNow();
      const logText = entries.filter(passesFilters).map(formatEntryLine).join('\\n');
      navigator.clipboard.writeText(logText).then(() => setTemporaryButtonText(copyButton, text.copied)).catch(() => setTemporaryButtonText(copyButton, text.copyFailed));
    });
    copyTriageButton.addEventListener('click', () => {
      flushPendingEntriesNow();
      navigator.clipboard.writeText(formatTriageReport()).then(() => setTemporaryButtonText(copyTriageButton, text.triageCopied)).catch(() => setTemporaryButtonText(copyTriageButton, text.copyFailed));
    });
    saveButton.addEventListener('click', () => {
      flushPendingEntriesNow();
      const logText = entries.filter(passesFilters).map(formatEntryLine).join('\\n');
      const blob = new Blob([logText + '\\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      anchor.href = url;
      anchor.download = 'echo-debug-console-' + stamp + '.log';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTemporaryButtonText(saveButton, text.saved);
    });
    devtoolsButton.addEventListener('click', () => {
      api.openDevTools().catch(() => undefined);
    });
    document.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (mod && key === 'f') {
        event.preventDefault();
        filterEl.focus();
        filterEl.select();
      } else if (mod && key === 'l') {
        event.preventDefault();
        discardPendingEntries();
        entries = [];
        unread = 0;
        api.clear().finally(render);
      } else if (event.key === 'Escape' && document.activeElement === filterEl && filterEl.value) {
        filterEl.value = '';
        render();
      } else if (event.key === 'End') {
        scrollToBottom();
      }
    });
  </script>
</body>
</html>`;
};

export const getDevConsoleSnapshot = (): DiagnosticConsoleSnapshot => ({
  entries,
  maxEntries,
});

export const clearDevConsole = (): void => {
  entries = [];
  pendingChunks.clear();
  pushEntry('system', 'info', 'Debug console cleared.');
};

export const openDevConsoleDevTools = (sender: WebContents): void => {
  if (!areDeveloperToolsAllowed()) {
    pushEntry('system', 'warn', 'DevTools blocked in packaged build. Set ECHO_ENABLE_DEVTOOLS=1 before launch to allow field diagnostics.');
    return;
  }

  const owner = BrowserWindow.fromWebContents(sender);
  owner?.webContents.openDevTools({ mode: 'detach' });
};

export const closeDevConsoleWindow = (): void => {
  if (!consoleWindow || consoleWindow.isDestroyed()) {
    consoleWindow = null;
    return;
  }

  consoleWindow.close();
};

export const openDevConsoleWindow = (): void => {
  initializeDevConsoleCapture();

  if (consoleWindow && !consoleWindow.isDestroyed()) {
    if (consoleWindow.isMinimized()) {
      consoleWindow.restore();
    }
    consoleWindow.show();
    consoleWindow.focus();
    return;
  }

  const text = resolveDevConsoleText();
  const appIconPath = resolveAppIconPath();
  consoleWindow = new BrowserWindow({
    width: 1240,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: text.title,
    icon: appIconPath ?? undefined,
    backgroundColor: '#080c11',
    show: false,
    webPreferences: {
      preload: resolveDevConsolePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  consoleWindow.once('ready-to-show', () => {
    consoleWindow?.show();
  });
  consoleWindow.on('closed', () => {
    consoleWindow = null;
  });
  consoleWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  consoleWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('data:text/html')) {
      event.preventDefault();
    }
  });

  void consoleWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createDevConsoleHtml())}`);
  pushEntry('system', 'info', `Debug console opened. userData=${app.getPath('userData')}`);
};
