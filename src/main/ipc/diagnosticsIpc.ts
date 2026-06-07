import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type {
  DiagnosticPerformanceStallPayload,
  LastCrashSummary,
  RendererErrorPayload,
} from '../../shared/types/diagnostics';
import { getCrashReportService } from '../diagnostics/CrashReportService';
import {
  clearDevConsole,
  getDevConsoleSnapshot,
  openDevConsoleDevTools,
  openDevConsoleWindow,
  recordPerformanceStall,
  recordRendererRuntimeError,
} from '../diagnostics/DevConsoleService';
import { getAudioSession } from '../audio/AudioSession';

const normalizeRendererError = (value: unknown): RendererErrorPayload => {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const source = input.source === 'unhandledrejection' ? 'unhandledrejection' : 'error';

  return {
    message: typeof input.message === 'string' && input.message.trim() ? input.message : 'Renderer error',
    stack: typeof input.stack === 'string' ? input.stack : undefined,
    filename: typeof input.filename === 'string' ? input.filename : undefined,
    lineno: typeof input.lineno === 'number' && Number.isFinite(input.lineno) ? input.lineno : undefined,
    colno: typeof input.colno === 'number' && Number.isFinite(input.colno) ? input.colno : undefined,
    source,
    timestamp: typeof input.timestamp === 'string' && input.timestamp.trim() ? input.timestamp : new Date().toISOString(),
  };
};

const normalizeFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const normalizePerformanceStall = (value: unknown): DiagnosticPerformanceStallPayload => {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const kind =
    input.kind === 'long_task' || input.kind === 'animation_frame' || input.kind === 'event_loop'
      ? input.kind
      : 'animation_frame';
  const windowKind =
    input.windowKind === 'main' ||
    input.windowKind === 'desktopLyrics' ||
    input.windowKind === 'miniPlayer' ||
    input.windowKind === 'unknown'
      ? input.windowKind
      : 'unknown';
  const details = input.details && typeof input.details === 'object' && !Array.isArray(input.details)
    ? (input.details as Record<string, unknown>)
    : undefined;

  return {
    source: 'renderer',
    kind,
    durationMs: normalizeFiniteNumber(input.durationMs, 0),
    thresholdMs: normalizeFiniteNumber(input.thresholdMs, 0),
    timestamp: typeof input.timestamp === 'string' && input.timestamp.trim() ? input.timestamp : new Date().toISOString(),
    windowKind,
    url: typeof input.url === 'string' && input.url.trim() ? input.url : undefined,
    details,
  };
};

const getSafeAudioDiagnosticsSnapshot = (): Record<string, unknown> | null => {
  try {
    return getAudioSession().getDiagnostics() as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const registerDiagnosticsIpc = (): void => {
  ipcMain.handle(IpcChannels.DiagnosticsGetLastCrashSummary, (): LastCrashSummary | null =>
    getCrashReportService().getLastCrashSummary(),
  );
  ipcMain.handle(IpcChannels.DiagnosticsClearLastCrashSummary, (): void => {
    getCrashReportService().clearLastCrashSummary();
  });
  ipcMain.handle(IpcChannels.DiagnosticsExport, (): Promise<string> => getCrashReportService().exportDiagnosticsMarkdown());
  ipcMain.handle(IpcChannels.DiagnosticsExportZip, (): Promise<string> => getCrashReportService().exportDiagnosticsZip());
  ipcMain.handle(IpcChannels.DiagnosticsOpenFolder, (): Promise<string> => getCrashReportService().openDiagnosticsFolder());
  ipcMain.handle(IpcChannels.DiagnosticsOpenCrashReport, (): Promise<string> =>
    getCrashReportService().openCrashReportFile({ preferLastAbnormal: true }),
  );
  ipcMain.handle(IpcChannels.DiagnosticsOpenAudioCrashReport, (): Promise<string> =>
    getCrashReportService().openAudioCrashReportFile(),
  );
  ipcMain.handle(IpcChannels.DiagnosticsRelaunchApp, (): void => {
    app.relaunch();
    app.quit();
  });
  ipcMain.handle(IpcChannels.DiagnosticsOpenDevConsole, (): void => {
    openDevConsoleWindow();
  });
  ipcMain.handle(IpcChannels.DiagnosticsDevConsoleSnapshot, () => getDevConsoleSnapshot());
  ipcMain.handle(IpcChannels.DiagnosticsDevConsoleClear, (): void => {
    clearDevConsole();
  });
  ipcMain.handle(IpcChannels.DiagnosticsDevConsoleOpenDevTools, (event): void => {
    openDevConsoleDevTools(event.sender);
  });
  ipcMain.handle(IpcChannels.DiagnosticsReportRendererError, (_event, payload: unknown): void => {
    const normalized = normalizeRendererError(payload);
    getCrashReportService().reportRendererError(normalized);
    recordRendererRuntimeError(normalized);
  });
  ipcMain.handle(IpcChannels.DiagnosticsReportPerformanceStall, (_event, payload: unknown): void => {
    const normalized = normalizePerformanceStall(payload);
    recordPerformanceStall(normalized, getSafeAudioDiagnosticsSnapshot());
  });
};
