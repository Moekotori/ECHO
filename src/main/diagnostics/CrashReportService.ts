import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { app, dialog, shell } from 'electron';
import type { SaveDialogReturnValue } from 'electron';
import type { AudioStatus } from '../../shared/types/audio';
import type { LastCrashSummary, RendererErrorPayload, CrashSessionInfo } from '../../shared/types/diagnostics';
import { getAppSettings } from '../app/appSettings';
import { getLastDataProtectionResult, getLibraryDatabaseMaintenanceReport } from '../app/dataProtection';
import { getAudioSession } from '../audio/AudioSession';
import { getLibraryService } from '../library/LibraryService';
import { hashText, Logger, sanitizeLogPayload } from './Logger';
import { getAccountService } from '../accounts/AccountService';
import { getStartupTimelineSnapshot } from './StartupDiagnostics';
import {
  getExceptionRecordsSnapshot,
  getExceptionSummarySnapshot,
  readExceptionLogFile,
  recordDiagnosticException,
} from './ExceptionRecorder';

type CrashRecord = {
  type: string;
  message?: string;
  stack?: string;
  reason?: string;
  exitCode?: number;
  timestamp: string;
  sessionId: string;
  details?: unknown;
};

export type AudioCrashReportPayload = {
  message: string;
  stack?: string;
  phase: string;
  severity?: 'recoverable' | 'fatal';
  recovered?: boolean;
  details?: unknown;
  audioStatus?: AudioStatus | null;
};

type AudioCrashRecord = Omit<AudioCrashReportPayload, 'audioStatus'> & {
  type: 'audio';
  timestamp: string;
  sessionId: string;
  audioStatus?: unknown;
};

const nowIso = (): string => new Date().toISOString();

const createSessionId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const safeFileSegment = (value: string): string => value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);

const readJson = <T>(filePath: string): T | null => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

const writeJson = (filePath: string, value: unknown): void => {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (date = new Date()): { date: number; time: number } => ({
  date: (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
});

const createZip = (entries: Array<{ name: string; content: Buffer }>): Buffer => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const { date, time } = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'));
    const compressed = deflateRawSync(entry.content);
    const crc = crc32(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
};

const safePathValue = (value: string | null): unknown => (value ? { basename: basename(value), pathHash: hashText(value) } : null);

const safeAudioStatus = (status: AudioStatus): unknown => ({
  ...status,
  currentFilePath: safePathValue(status.currentFilePath),
});

const formatJsonBlock = (value: unknown): string => `\`\`\`json\n${JSON.stringify(sanitizeLogPayload(value), null, 2)}\n\`\`\``;

const formatTextBlock = (value: string): string => `\`\`\`text\n${value.trim() || 'n/a'}\n\`\`\``;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const detailValue = (details: unknown, key: string): unknown => asRecord(details)[key];

const compactText = (value: unknown, fallback = 'n/a'): string => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim() || fallback;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return fallback;
};

const truncateText = (value: string, maxLength = 90): string =>
  value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}...` : value;

const compactDeviceName = (record: AudioCrashRecord): string => {
  const status = asRecord(record.audioStatus);
  const details = asRecord(record.details);
  const candidate = asRecord(details.candidate);

  return compactText(
    status.outputDeviceName ??
      candidate.name ??
      details.deviceName ??
      details.outputDeviceName,
  );
};

const compactOutputMode = (record: AudioCrashRecord): string => {
  const status = asRecord(record.audioStatus);
  const details = asRecord(record.details);
  const candidate = asRecord(details.candidate);

  return compactText(
    details.outputMode ??
      candidate.outputMode ??
      status.outputMode,
  );
};

const compactSampleRate = (record: AudioCrashRecord): string => {
  const status = asRecord(record.audioStatus);
  const details = asRecord(record.details);
  const requested = compactText(
    status.requestedOutputSampleRate ??
      details.requestedOutputSampleRate,
  );
  const actual = compactText(status.actualDeviceSampleRate);

  return actual === 'n/a' ? requested : `${requested}->${actual}`;
};

const compactWarnings = (record: AudioCrashRecord): string[] => {
  const status = asRecord(record.audioStatus);
  return Array.isArray(status.warnings) ? status.warnings.map((warning) => compactText(warning)).filter(Boolean) : [];
};

const classifyAudioFailure = (message: string): string => {
  if (/ASIO/iu.test(message) && /(?:ASE_NotPresent|No device found)/iu.test(message)) {
    return 'asio_device_not_present';
  }

  if (message.includes('timeout_waiting_for_ready')) {
    return 'host_ready_timeout';
  }

  if (message.includes('Device didn\'t start correctly')) {
    return 'driver_start_refused';
  }

  if (message.includes('Couldn\'t open the output device')) {
    return 'device_open_refused';
  }

  if (message.includes('exclusive_denied')) {
    return 'exclusive_denied';
  }

  if (message.includes('audio_session_run_cancelled')) {
    return 'superseded_playback_run';
  }

  if (/\bplay\(\) request was interrupted by a call to (?:pause|load)\(\)/iu.test(message)) {
    return 'superseded_playback_run';
  }

  if (message.includes('ffmpeg_missing')) {
    return 'decoder_missing';
  }

  if (message.includes('ffmpeg_')) {
    return 'decoder_failed';
  }

  if (/\becho-audio-host exit_code_/.test(message)) {
    return 'host_exited_before_ready';
  }

  return 'audio_pipeline_error';
};

const collectDistinct = (values: string[]): string[] =>
  [...new Set(values.filter((value) => value && value !== 'n/a'))];

const createAudioTimelineMarkdown = (records: AudioCrashRecord[]): string[] => {
  const lines = [
    '## Related Audio Events In This Session',
    '',
  ];

  if (records.length === 0) {
    lines.push('- No related audio error files were found for this diagnostics session.');
    return lines;
  }

  lines.push(
    `- Events included: ${records.length}`,
    `- Time window: ${records[0]?.timestamp ?? 'n/a'} -> ${records.at(-1)?.timestamp ?? 'n/a'}`,
    '- Reading tip: different top-level errors can be one incident when the device/mode changes during fallback.',
    '',
    '| # | Time | Severity | Phase | Mode | Device | Rate | Failure class | Recovery signal |',
    '| - | - | - | - | - | - | - | - | - |',
  );

  records.forEach((record, index) => {
    const warnings = compactWarnings(record);
    const recoverySignals = warnings.filter((warning) =>
      /fell_back|fallback|recovered|safe_mode|default_device|skipped_same_device|temporarily_unavailable/iu.test(warning),
    );
    const time = record.timestamp.split('T')[1]?.replace('Z', '') ?? record.timestamp;
    lines.push(
      `| ${index + 1} | ${time} | ${compactText(record.severity)} | ${compactText(record.phase)} | ${compactOutputMode(record)} | ${truncateText(compactDeviceName(record), 42)} | ${compactSampleRate(record)} | ${classifyAudioFailure(record.message)} | ${truncateText(recoverySignals.join(', ') || compactText(record.recovered), 54)} |`,
    );
  });

  return lines;
};

const createAudioCorrelationMarkdown = (records: AudioCrashRecord[]): string[] => {
  const lines = [
    '## Correlation Analysis',
    '',
  ];

  if (records.length === 0) {
    lines.push('- Not enough events to correlate.');
    return lines;
  }

  const failureClasses = collectDistinct(records.map((record) => classifyAudioFailure(record.message)));
  const modes = collectDistinct(records.map(compactOutputMode));
  const devices = collectDistinct(records.map(compactDeviceName));
  const rates = collectDistinct(records.map(compactSampleRate));
  const warningSet = collectDistinct(records.flatMap(compactWarnings));
  const hasAsioFailure = modes.includes('asio') || records.some((record) => /ASIO| -asio\b|mode="asio"/u.test(record.message));
  const hasSharedFailure = modes.includes('shared') || records.some((record) => /mode="shared"|WASAPI|Windows Audio/u.test(record.message));
  const hasFallbackSignals = warningSet.some((warning) => /fell_back|fallback|recovered|safe_mode|default_device|temporarily_unavailable/iu.test(warning));
  const hasDsdPcm = warningSet.some((warning) => warning.startsWith('dsd_source_decoded_to_pcm'));
  const likelySingleIncident = records.length > 1 && (hasFallbackSignals || (hasAsioFailure && hasSharedFailure));

  lines.push(
    `- Likely one chained incident: ${likelySingleIncident ? 'yes' : 'unknown'}`,
    `- Failure classes observed: ${failureClasses.join(', ') || 'n/a'}`,
    `- Output modes involved: ${modes.join(', ') || 'n/a'}`,
    `- Devices involved: ${devices.map((device) => truncateText(device, 72)).join(' | ') || 'n/a'}`,
    `- Requested/actual rate transitions: ${rates.join(', ') || 'n/a'}`,
    `- Recovery/fallback signals: ${warningSet.filter((warning) => /fell_back|fallback|recovered|safe_mode|default_device|skipped_same_device|temporarily_unavailable/iu.test(warning)).join(', ') || 'n/a'}`,
  );

  if (hasDsdPcm) {
    lines.push('- DSD source was decoded to high-rate PCM in at least one event; this can expose ASIO driver rate limits before the app falls back.');
  }

  if (hasAsioFailure && hasSharedFailure) {
    lines.push('- ASIO failed first and Shared/WASAPI also failed later, which points more toward a device/driver state problem than a single bad track.');
  }

  if (records.some((record) => classifyAudioFailure(record.message) === 'superseded_playback_run')) {
    lines.push('- audio_session_run_cancelled appears in the chain; treat it as a follow-on cancellation unless it is the only event.');
  }

  return lines;
};

const explainAudioError = (record: AudioCrashRecord | null): string[] => {
  const message = record?.message ?? '';
  const details = asRecord(record?.details);
  const status = asRecord(record?.audioStatus);
  const outputMode = String(status.outputMode ?? detailValue(details, 'outputMode') ?? 'unknown');
  const deviceName = String(status.outputDeviceName ?? detailValue(details, 'deviceName') ?? 'unknown');
  const warnings = Array.isArray(status.warnings) ? status.warnings.join(', ') : 'n/a';
  const lines = [
    '## Why This Error Happened',
    '',
    `- Operation phase: ${record?.phase ?? 'unknown'}`,
    `- Output mode at the time: ${outputMode}`,
    `- Output device at the time: ${deviceName}`,
    `- Active warnings: ${warnings || 'n/a'}`,
  ];

  if (!record) {
    lines.push('- No audio error record exists yet. This report was opened manually before an audio failure was captured.');
    return lines;
  }

  if (classifyAudioFailure(message) === 'asio_device_not_present') {
    lines.push(
      '- Direct cause: the selected ASIO driver loaded, but the driver reported that its hardware device is not currently present.',
      '- Most likely reasons: the DAC/interface is unplugged or powered off, Windows still has a stale ASIO driver registration, the vendor control panel cannot see the device, or another driver state change happened while ECHO was opening ASIO.',
      '- What to try: power-cycle or replug the interface, confirm the TEAC ASIO control panel can see the device, switch ECHO to Shared output once, or enable ASIO unavailable guard so ECHO skips this ASIO device briefly and uses safe shared output.',
    );
  } else if (message.includes('timeout_waiting_for_ready')) {
    lines.push(
      '- Direct cause: the native audio host was launched, but it did not send its ready event before the timeout.',
      '- Most likely reasons: the ASIO/WASAPI driver was slow or stuck during initialization, the device was busy in another app, the requested sample rate or buffer size was rejected slowly, or the driver needed more time while closing a previous stream.',
      '- What to try: close other audio apps, try a larger ASIO buffer, switch to Shared once and back to ASIO, unplug/replug the interface, or choose another sample rate supported by the driver.',
    );
  } else if (message.includes('spawn_error:')) {
    lines.push(
      '- Direct cause: ECHO could not start echo-audio-host.',
      '- Most likely reasons: the native host executable is missing, blocked by security software, damaged, or packaged in the wrong location.',
      '- What to try: rebuild or reinstall the native audio host, then verify electron-app/build/echo-audio-host.exe exists.',
    );
  } else if (/\becho-audio-host (exit_code_|exit_signal_|exclusive_denied)/.test(message)) {
    lines.push(
      '- Direct cause: echo-audio-host started but exited before audio output became ready.',
      '- Most likely reasons: the selected output device refused the requested mode, crashed during driver setup, or rejected the requested format.',
      '- What to inspect: stderrTail, exitCodeHex, nativeCrash, requestedOutputSampleRate, outputMode, and the selected device name in the JSON sections below.',
    );
  } else if (message.includes('ffmpeg_missing')) {
    lines.push(
      '- Direct cause: the decoder backend is missing, so playback could not decode the selected file.',
      '- What to try: repair the app installation or make sure the bundled ffmpeg binary is present.',
    );
  } else if (message.includes('ffmpeg_error:')) {
    lines.push(
      '- Direct cause: ffmpeg failed while decoding this track.',
      '- Most likely reasons: the file is corrupted, the codec is unsupported by the bundled decoder, or the stream URL expired while opening.',
    );
  } else if (message.includes('asio_output_sample_rate_unusable')) {
    lines.push(
      '- Direct cause: the ASIO driver opened at an unusable low sample rate even though ECHO requested a normal music rate.',
      '- Most likely reasons: driver fallback, stale ASIO state, or a control-panel setting forcing an unexpected clock rate.',
    );
  } else if (message.includes('sample_rate_mismatch')) {
    lines.push(
      '- Direct cause: the device opened at a different sample rate than ECHO requested.',
      '- Most likely reasons: the hardware clock is locked externally, another app owns the device, or the requested rate is unsupported in this mode.',
    );
  } else {
    lines.push(
      '- Direct cause: ECHO received an audio pipeline error that does not match a specialized diagnosis rule yet.',
      '- Next clue: read the exact message, details JSON, audio status snapshot, and recent audio logs below. They include the phase, selected device, output mode, requested rate, opened rate, buffer sizes, and native stderr tail when available.',
    );
  }

  lines.push(
    '',
    '## Error Cause Details',
    '',
    `- Raw message: ${message}`,
    `- Severity: ${record.severity ?? 'fatal'}`,
    `- Recovered automatically: ${record.recovered ?? false}`,
    `- Requested sample rate: ${status.requestedOutputSampleRate ?? detailValue(details, 'requestedOutputSampleRate') ?? 'n/a'}`,
    `- Actual device sample rate: ${status.actualDeviceSampleRate ?? 'n/a'}`,
    `- Requested buffer frames: ${status.nativeRequestedBufferFrames ?? 'n/a'}`,
    `- Actual buffer frames: ${status.nativeActualBufferFrames ?? 'n/a'}`,
  );

  return lines;
};

const readFileText = (filePath: string): string | null => {
  try {
    return existsSync(filePath) && statSync(filePath).isFile() ? readFileSync(filePath, 'utf8') : null;
  } catch {
    return null;
  }
};

const readLogTail = (filePath: string, maxLines = 80): string => {
  const text = readFileText(filePath);
  if (!text) {
    return 'n/a';
  }

  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-maxLines)
    .join('\n');
};

export class CrashReportService {
  private session: CrashSessionInfo | null = null;
  private sessionDir: string | null = null;
  private lastCrashSummary: LastCrashSummary | null = null;
  private logger: Logger | null = null;
  private lastRendererErrorSignature: string | null = null;
  private lastRendererErrorAt = 0;

  constructor(private readonly userDataPath = app.getPath('userData')) {}

  initialize(): void {
    const rootDir = this.getCrashReportsRoot();
    const sessionsDir = this.getSessionsDir();
    mkdirSync(sessionsDir, { recursive: true });
    this.detectLastAbnormalSession(sessionsDir);

    const sessionId = createSessionId();
    const sessionDir = join(sessionsDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });

    this.session = {
      sessionId,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown',
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      startedAt: nowIso(),
      status: 'running',
    };
    this.sessionDir = sessionDir;
    this.logger = new Logger(sessionDir);
    writeJson(join(sessionDir, 'session.json'), this.session);
    mkdirSync(rootDir, { recursive: true });
    // TODO: Evaluate Electron crashReporter with uploadToServer: false after validating dump behavior in the packaged app.
    this.logger.info('main', 'diagnostics session started', { sessionId });
  }

  closeSession(): void {
    if (!this.session || !this.sessionDir || this.session.status !== 'running') {
      return;
    }

    this.session = {
      ...this.session,
      status: 'closed',
      endedAt: nowIso(),
    };
    writeJson(join(this.sessionDir, 'session.json'), this.session);
    this.logger?.info('main', 'diagnostics session closed', { sessionId: this.session.sessionId });
  }

  markShutdownRequested(): void {
    if (!this.session || !this.sessionDir || this.session.status !== 'running' || this.session.shutdownRequestedAt) {
      return;
    }

    this.session = {
      ...this.session,
      shutdownRequestedAt: nowIso(),
    };
    writeJson(join(this.sessionDir, 'session.json'), this.session);
    this.logger?.info('main', 'diagnostics session shutdown requested', { sessionId: this.session.sessionId });
  }

  getLogger(): Logger | null {
    return this.logger;
  }

  getSessionDir(): string | null {
    return this.sessionDir;
  }

  getCrashReportsRoot(): string {
    return join(this.userDataPath, 'crash-reports');
  }

  getSessionsDir(): string {
    return join(this.getCrashReportsRoot(), 'sessions');
  }

  getLastCrashSummary(): LastCrashSummary | null {
    return this.lastCrashSummary;
  }

  clearLastCrashSummary(): void {
    this.lastCrashSummary = null;
  }

  openDiagnosticsFolder(): Promise<string> {
    return shell.openPath(this.getCrashReportsRoot());
  }

  getCrashReportFilePath(sessionDir = this.sessionDir): string {
    return sessionDir ? join(sessionDir, 'crash-report.md') : join(this.getCrashReportsRoot(), 'crash-report.md');
  }

  getAudioCrashReportFilePath(sessionDir = this.sessionDir): string {
    return sessionDir ? join(sessionDir, 'audio-crash-report.md') : join(this.getCrashReportsRoot(), 'audio-crash-report.md');
  }

  getAudioCrashReportsDir(): string {
    const audioCrashDir = this.sessionDir
      ? join(this.sessionDir, 'audio-crashes')
      : join(this.getCrashReportsRoot(), 'audio-crashes');
    mkdirSync(audioCrashDir, { recursive: true });
    return audioCrashDir;
  }

  async openCrashReportFile(options: { preferLastAbnormal?: boolean } = {}): Promise<string> {
    const reportPath = this.writeCrashReportFile(undefined, { preferLastAbnormal: options.preferLastAbnormal ?? false });
    const result = await shell.openPath(reportPath);
    if (result) {
      throw new Error(result);
    }
    return reportPath;
  }

  async openAudioCrashReportFile(): Promise<string> {
    const reportPath = this.writeAudioCrashReportFile();
    const result = await shell.openPath(reportPath);
    if (result) {
      throw new Error(result);
    }
    return reportPath;
  }

  reportCrash(record: Omit<CrashRecord, 'timestamp' | 'sessionId'>): void {
    const timestamp = nowIso();
    recordDiagnosticException({
      source: 'main',
      severity: 'fatal',
      type: record.type,
      message: record.message ?? record.type,
      stack: record.stack,
      details: record.details,
      timestamp,
    });

    if (!this.sessionDir || !this.session) {
      return;
    }

    const crashRecord: CrashRecord = {
      ...record,
      timestamp,
      sessionId: this.session.sessionId,
      details: sanitizeLogPayload(record.details),
    };
    writeJson(join(this.sessionDir, 'crash.json'), crashRecord);
    this.writeCrashReportFile(crashRecord);
    this.logger?.error('crash', record.type, crashRecord);
  }

  reportRendererError(payload: RendererErrorPayload): void {
    const signature = [
      payload.message,
      payload.stack ?? '',
      payload.filename ?? '',
      payload.source ?? '',
    ].join('\n');
    const reportedAt = payload.timestamp ? Date.parse(payload.timestamp) : Date.now();
    const timestampMs = Number.isFinite(reportedAt) ? reportedAt : Date.now();
    if (signature === this.lastRendererErrorSignature && timestampMs - this.lastRendererErrorAt < 2000) {
      return;
    }

    this.lastRendererErrorSignature = signature;
    this.lastRendererErrorAt = timestampMs;

    const safePayload = sanitizeLogPayload(payload);
    this.logger?.error('renderer', payload.message, safePayload);
    this.logger?.error('crash', 'renderer error', safePayload);
    recordDiagnosticException({
      source: 'renderer',
      severity: 'error',
      type: payload.source,
      message: payload.message,
      stack: payload.stack,
      details: {
        filename: payload.filename,
        lineno: payload.lineno,
        colno: payload.colno,
      },
      timestamp: payload.timestamp,
    });
  }

  reportAudioError(payload: AudioCrashReportPayload): void {
    if (!this.sessionDir || !this.session) {
      return;
    }

    const timestamp = nowIso();
    const record: AudioCrashRecord = {
      ...payload,
      type: 'audio',
      timestamp,
      sessionId: this.session.sessionId,
      severity: payload.severity ?? 'fatal',
      details: sanitizeLogPayload(payload.details),
      audioStatus: payload.audioStatus ? safeAudioStatus(payload.audioStatus) : null,
    };
    const fileName = `audio-crash-${timestamp.replace(/[:.]/g, '-')}-${safeFileSegment(payload.phase || 'audio')}.json`;
    const audioCrashDir = join(this.sessionDir, 'audio-crashes');
    mkdirSync(audioCrashDir, { recursive: true });
    writeJson(join(audioCrashDir, fileName), record);
    writeJson(join(this.sessionDir, 'audio-crash.latest.json'), record);
    this.writeAudioCrashReportFile(record);
    this.logger?.error('audio', payload.message, record);
    this.logger?.error('crash', 'audio error', record);
    recordDiagnosticException({
      source: 'audio',
      severity: record.severity === 'fatal' ? 'fatal' : 'error',
      type: 'audio-error',
      message: payload.message,
      stack: payload.stack,
      phase: payload.phase,
      details: payload.details,
      timestamp,
    });
  }

  private writeCrashReportFile(
    record?: CrashRecord | null,
    options: { preferLastAbnormal?: boolean; sessionDir?: string | null } = {},
  ): string {
    const targetSessionDir = options.sessionDir ?? this.resolveCrashReportSessionDir(options.preferLastAbnormal ?? false);
    const reportPath = this.getCrashReportFilePath(targetSessionDir);
    mkdirSync(targetSessionDir ?? this.getCrashReportsRoot(), { recursive: true });
    const crashRecord = record ?? (targetSessionDir ? readJson<CrashRecord>(join(targetSessionDir, 'crash.json')) : null);
    writeFileSync(reportPath, this.createCrashReportMarkdown(crashRecord, { reportPath, sessionDir: targetSessionDir }));
    return reportPath;
  }

  private writeAudioCrashReportFile(record?: AudioCrashRecord | null, sessionDir = this.sessionDir): string {
    const reportPath = this.getAudioCrashReportFilePath(sessionDir);
    mkdirSync(sessionDir ?? this.getCrashReportsRoot(), { recursive: true });
    const audioRecord = record ?? (sessionDir ? readJson<AudioCrashRecord>(join(sessionDir, 'audio-crash.latest.json')) : null);
    writeFileSync(reportPath, this.createAudioCrashReportMarkdown(audioRecord, { reportPath, sessionDir }));
    return reportPath;
  }

  private createCrashReportMarkdown(
    record: CrashRecord | null,
    options: { reportPath: string; sessionDir: string | null },
  ): string {
    const session = this.getCurrentSessionSnapshot(options.sessionDir);
    const lastAbnormalSessionDir = this.getLastAbnormalSessionDir();
    const isLastAbnormalReport = Boolean(options.sessionDir && lastAbnormalSessionDir === options.sessionDir);
    const summaryMessage = record?.message ?? (
      isLastAbnormalReport
        ? 'Previous ECHO Next session did not close normally.'
        : 'No normal crash has been recorded in this session.'
    );
    const runtimeSnapshotMarkdown = isLastAbnormalReport
      ? formatTextBlock('Live runtime snapshots are omitted because this report is for a previous abnormal session. Use the log tails below for the failing run.')
      : [
          '### Playback',
          '',
          formatJsonBlock(this.getSafePlaybackStatus()),
          '',
          '### Audio',
          '',
          formatJsonBlock(this.getSafeAudioStatus()),
          '',
          '### App Settings',
          '',
          formatJsonBlock(getAppSettings()),
        ].join('\n');
    const lines = [
      '# ECHO Next Crash Report',
      '',
      `Generated: ${nowIso()}`,
      `Report file: ${basename(options.reportPath)}`,
      '',
      '## Summary',
      '',
      `- Type: ${record?.type ?? 'no_crash_recorded'}`,
      `- Message: ${summaryMessage}`,
      `- Reason: ${record?.reason ?? (isLastAbnormalReport ? 'abnormalExit' : 'n/a')}`,
      `- Exit code: ${record?.exitCode ?? 'n/a'}`,
      `- Crash timestamp: ${record?.timestamp ?? 'n/a'}`,
      '',
      '## Session',
      '',
      formatJsonBlock(session),
      '',
      '## Last Abnormal Session',
      '',
      formatJsonBlock(this.lastCrashSummary ?? null),
      '',
      '## Crash Details',
      '',
      formatJsonBlock(
        record ?? {
          message: isLastAbnormalReport
            ? 'No crash.json exists for the previous session. abnormalExit was detected from session.json.'
            : 'No crash.json exists for the current session.',
        },
      ),
      '',
      '## Stack',
      '',
      formatTextBlock(record?.stack ?? 'n/a'),
      '',
      '## Safe Runtime Snapshots',
      '',
      runtimeSnapshotMarkdown,
      '',
      '## Recent Logs',
      '',
      this.createLogTailMarkdown(['crash.log', 'main.log', 'renderer.log'], options.sessionDir),
      '',
      '## Privacy',
      '',
      'This report is generated locally. Music files, cover binaries, lyric contents, tokens, cookies, and authentication secrets are not included. Local media paths are reduced to basename plus pathHash when captured through diagnostics snapshots.',
      '',
    ];

    return `${lines.join('\n')}\n`;
  }

  private createAudioCrashReportMarkdown(
    record: AudioCrashRecord | null,
    options: { reportPath: string; sessionDir: string | null },
  ): string {
    const session = this.getCurrentSessionSnapshot(options.sessionDir);
    const relatedAudioRecords = this.getRecentAudioCrashRecords(record, 12, options.sessionDir);
    const lines = [
      '# ECHO Next Audio Crash Report',
      '',
      `Generated: ${nowIso()}`,
      `Report file: ${basename(options.reportPath)}`,
      '',
      '## Summary',
      '',
      `- Phase: ${record?.phase ?? 'no_audio_crash_recorded'}`,
      `- Severity: ${record?.severity ?? 'n/a'}`,
      `- Recovered: ${record?.recovered ?? 'n/a'}`,
      `- Message: ${record?.message ?? 'No audio crash has been recorded in this session.'}`,
      `- Crash timestamp: ${record?.timestamp ?? 'n/a'}`,
      '',
      ...createAudioTimelineMarkdown(relatedAudioRecords),
      '',
      ...createAudioCorrelationMarkdown(relatedAudioRecords),
      '',
      ...explainAudioError(record),
      '',
      '## Session',
      '',
      formatJsonBlock(session),
      '',
      '## Audio Error',
      '',
      formatJsonBlock(record ?? { message: 'No audio-crash.latest.json exists for the current session.' }),
      '',
      '## Stack',
      '',
      formatTextBlock(record?.stack ?? 'n/a'),
      '',
      '## Audio Status Snapshot',
      '',
      formatJsonBlock(record?.audioStatus ?? this.getSafeAudioStatus()),
      '',
      '## Current Playback Snapshot',
      '',
      formatJsonBlock(this.getSafePlaybackStatus()),
      '',
      '## Recent Audio Logs',
      '',
      record
        ? this.createLogTailMarkdown(['audio.log', 'main.log'], options.sessionDir)
        : [
            'No audio crash was recorded, so renderer and crash logs are omitted from this audio-only report.',
            '',
            this.createLogTailMarkdown(['audio.log', 'main.log'], options.sessionDir),
          ].join('\n'),
      '',
      '## Notes For Audio Debugging',
      '',
      '- timeout_waiting_for_ready usually means echo-audio-host was spawned but did not report ready before the main process timeout.',
      '- Useful fields: phase, severity, recovered, outputMode, outputDeviceId, outputDeviceName, warnings, stderrTail, elapsedMs, and mode.',
      '- If recovered is true, playback continued after falling back to default shared output or safe shared output.',
      '',
      '## Privacy',
      '',
      'This report is generated locally. Music files, cover binaries, lyric contents, tokens, cookies, and authentication secrets are not included. Local media paths are reduced to basename plus pathHash when captured through diagnostics snapshots.',
      '',
    ];

    return `${lines.join('\n')}\n`;
  }

  private getRecentAudioCrashRecords(currentRecord: AudioCrashRecord | null, maxRecords = 12, sessionDir = this.sessionDir): AudioCrashRecord[] {
    if (!sessionDir) {
      return currentRecord ? [currentRecord] : [];
    }

    const audioCrashDir = join(sessionDir, 'audio-crashes');
    const records: AudioCrashRecord[] = [];

    try {
      if (existsSync(audioCrashDir) && statSync(audioCrashDir).isDirectory()) {
        for (const fileName of readdirSync(audioCrashDir).filter((name) => name.endsWith('.json')).sort().slice(-maxRecords)) {
          const record = readJson<AudioCrashRecord>(join(audioCrashDir, fileName));
          if (record?.type === 'audio' && record.timestamp) {
            records.push(record);
          }
        }
      }
    } catch {
      // The latest record below is still enough to produce a useful report.
    }

    if (currentRecord && !records.some((record) => record.timestamp === currentRecord.timestamp && record.message === currentRecord.message)) {
      records.push(currentRecord);
    }

    return records
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .slice(-maxRecords);
  }

  private getCurrentSessionSnapshot(sessionDir = this.sessionDir): unknown {
    if (sessionDir && sessionDir === this.sessionDir && this.session) {
      return this.session;
    }

    if (sessionDir) {
      return readJson<CrashSessionInfo>(join(sessionDir, 'session.json'));
    }

    return null;
  }

  private createLogTailMarkdown(fileNames: string[], sessionDir = this.sessionDir): string {
    if (!sessionDir) {
      return formatTextBlock('Diagnostics session has not been initialized.');
    }

    return fileNames
      .map((fileName) => [`### ${fileName}`, '', formatTextBlock(readLogTail(join(sessionDir, fileName)))].join('\n'))
      .join('\n\n');
  }

  async exportDiagnosticsMarkdown(destinationPath?: string): Promise<string> {
    const sourcePath = this.writeDefaultDiagnosticsMarkdown();
    const outputPath = destinationPath ?? (await this.chooseDiagnosticsMarkdownPath());

    if (!outputPath) {
      throw new Error('Diagnostics report export was cancelled.');
    }

    writeFileSync(outputPath, readFileSync(sourcePath));
    this.logger?.info('main', 'diagnostics markdown exported', { outputPath });
    return outputPath;
  }

  private writeDefaultDiagnosticsMarkdown(): string {
    if (this.sessionDir && existsSync(join(this.sessionDir, 'audio-crash.latest.json'))) {
      return this.writeAudioCrashReportFile();
    }

    return this.writeCrashReportFile(undefined, { preferLastAbnormal: true });
  }

  private async chooseDiagnosticsMarkdownPath(): Promise<string | null> {
    const defaultPath = join(
      app.getPath('downloads'),
      `ECHO-Next-Diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.md`,
    );
    const result: SaveDialogReturnValue = await dialog.showSaveDialog({
      title: 'Export ECHO diagnostics report',
      defaultPath,
      filters: [{ name: 'Markdown report', extensions: ['md'] }],
    });

    return result.canceled ? null : (result.filePath ?? null);
  }

  private resolveCrashReportSessionDir(preferLastAbnormal: boolean): string | null {
    if (preferLastAbnormal) {
      return this.getLastAbnormalSessionDir() ?? this.sessionDir;
    }

    return this.sessionDir;
  }

  private getLastAbnormalSessionDir(): string | null {
    if (!this.lastCrashSummary?.sessionBasename) {
      return null;
    }

    const sessionDir = join(this.getSessionsDir(), this.lastCrashSummary.sessionBasename);
    if (hashText(sessionDir) !== this.lastCrashSummary.sessionPathHash) {
      return null;
    }

    try {
      return existsSync(sessionDir) && statSync(sessionDir).isDirectory() ? sessionDir : null;
    } catch {
      return null;
    }
  }

  async exportDiagnosticsZip(destinationPath?: string): Promise<string> {
    if (!this.sessionDir) {
      throw new Error('Diagnostics session has not been initialized.');
    }

    const outputPath = destinationPath ?? (await this.chooseDiagnosticsZipPath());

    if (!outputPath) {
      throw new Error('Diagnostics export was cancelled.');
    }

    const entries = this.collectDiagnosticEntries();
    writeFileSync(outputPath, createZip(entries));
    this.logger?.info('main', 'diagnostics zip exported', { outputPath });
    return outputPath;
  }

  private async chooseDiagnosticsZipPath(): Promise<string | null> {
    const defaultPath = join(
      app.getPath('downloads'),
      `ECHO-Next-Diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
    );
    const result: SaveDialogReturnValue = await dialog.showSaveDialog({
      title: 'Export ECHO diagnostics',
      defaultPath,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });

    return result.canceled ? null : (result.filePath ?? null);
  }

  private collectDiagnosticEntries(): Array<{ name: string; content: Buffer }> {
    if (!this.sessionDir) {
      return [];
    }

    const entries: Array<{ name: string; content: Buffer }> = [];
    for (const fileName of [
      'session.json',
      'crash.json',
      'main.log',
      'renderer.log',
      'library.log',
      'audio.log',
      'crash.log',
      'audio-crash.latest.json',
      'crash-report.md',
      'audio-crash-report.md',
    ]) {
      const filePath = join(this.sessionDir, fileName);
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        entries.push({ name: fileName, content: readFileSync(filePath) });
      }
    }

    const audioCrashDir = join(this.sessionDir, 'audio-crashes');
    if (existsSync(audioCrashDir) && statSync(audioCrashDir).isDirectory()) {
      for (const fileName of readdirSync(audioCrashDir).filter((name) => name.endsWith('.json')).sort().slice(-20)) {
        const filePath = join(audioCrashDir, fileName);
        if (statSync(filePath).isFile()) {
          entries.push({ name: `audio-crashes/${fileName}`, content: readFileSync(filePath) });
        }
      }
    }

    entries.push({ name: 'app-settings.safe.json', content: this.toJsonBuffer(sanitizeLogPayload(getAppSettings())) });
    entries.push({ name: 'startup-timeline.safe.json', content: this.toJsonBuffer(getStartupTimelineSnapshot()) });
    entries.push({ name: 'exception-summary.safe.json', content: this.toJsonBuffer(getExceptionSummarySnapshot()) });
    entries.push({ name: 'exceptions.safe.json', content: this.toJsonBuffer(getExceptionRecordsSnapshot()) });
    const exceptionLog = readExceptionLogFile(this.userDataPath);
    if (exceptionLog) {
      entries.push({ name: 'exceptions.safe.log', content: Buffer.from(exceptionLog, 'utf8') });
    }
    entries.push({ name: 'accounts-status.safe.json', content: this.toJsonBuffer(this.getSafeAccountStatus()) });
    entries.push({ name: 'library-health.safe.json', content: this.toJsonBuffer(this.getSafeLibraryHealth()) });
    entries.push({ name: 'library-recovery.safe.json', content: this.toJsonBuffer(this.getSafeLibraryRecovery()) });
    entries.push({ name: 'library-database-maintenance.safe.json', content: this.toJsonBuffer(this.getSafeLibraryDatabaseMaintenance()) });
    entries.push({ name: 'library-diagnostics.safe.json', content: this.toJsonBuffer(this.getSafeLibraryDiagnostics()) });
    entries.push({ name: 'playback-status.safe.json', content: this.toJsonBuffer(this.getSafePlaybackStatus()) });
    entries.push({ name: 'audio-status.safe.json', content: this.toJsonBuffer(this.getSafeAudioStatus()) });
    entries.push({ name: 'package-version-info.json', content: this.toJsonBuffer(this.getPackageVersionInfo()) });
    entries.push({
      name: 'privacy-notice.txt',
      content: Buffer.from(
        'Diagnostics are generated locally. This package intentionally excludes music files, cover image binaries, lyric contents, tokens, cookies, and authentication secrets.\n',
      ),
    });

    return entries;
  }

  private getSafeLibraryDiagnostics(): unknown {
    try {
      const diagnostics = getLibraryService().getDiagnostics();
      return {
        ...diagnostics,
        databasePath: safePathValue(diagnostics.databasePath),
        coverCachePath: safePathValue(diagnostics.coverCachePath),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private getSafeLibraryHealth(): unknown {
    const result = getLastDataProtectionResult();
    if (!result) {
      return { status: 'unknown' };
    }
    return {
      ...result.libraryHealth,
      databasePath: safePathValue(result.libraryHealth.databasePath),
    };
  }

  private getSafeLibraryRecovery(): unknown {
    const result = getLastDataProtectionResult();
    if (!result) {
      return { action: 'unknown' };
    }
    return {
      ...result.recovery,
      sourceSnapshotPath: safePathValue(result.recovery.sourceSnapshotPath ?? null),
      archivePath: safePathValue(result.recovery.archivePath ?? null),
      health: {
        ...result.recovery.health,
        databasePath: safePathValue(result.recovery.health.databasePath),
      },
    };
  }

  private getSafeLibraryDatabaseMaintenance(): unknown {
    try {
      return sanitizeLogPayload(getLibraryDatabaseMaintenanceReport());
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private getSafeAccountStatus(): unknown {
    try {
      return {
        storagePath: safePathValue(getAccountService().getStoragePath()),
        statuses: getAccountService().getStatuses(),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private getSafePlaybackStatus(): unknown {
    try {
      const status = getAudioSession().getStatus();
      return {
        state: status.state,
        currentTrackId: status.currentTrackId,
        positionSeconds: status.positionSeconds,
        durationSeconds: status.durationSeconds,
        currentFilePath: safePathValue(status.currentFilePath),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private getSafeAudioStatus(): unknown {
    try {
      return safeAudioStatus(getAudioSession().getStatus());
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private getPackageVersionInfo(): unknown {
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown',
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    };
  }

  private toJsonBuffer(value: unknown): Buffer {
    return Buffer.from(`${JSON.stringify(sanitizeLogPayload(value), null, 2)}\n`);
  }

  private detectLastAbnormalSession(sessionsDir: string): void {
    const sessionNames = readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const previousSessionName = sessionNames.at(-1);
    if (!previousSessionName) {
      return;
    }

    const previousSessionDir = join(sessionsDir, previousSessionName);
    const sessionFilePath = join(previousSessionDir, 'session.json');
    const previousSession = readJson<CrashSessionInfo>(sessionFilePath);

    if (previousSession?.status !== 'running') {
      return;
    }

    const detectedAt = nowIso();
    const abnormalSession: CrashSessionInfo = {
      ...previousSession,
      status: 'abnormalExit',
      endedAt: detectedAt,
    };
    writeJson(sessionFilePath, abnormalSession);
    if (previousSession.shutdownRequestedAt && !existsSync(join(previousSessionDir, 'crash.json'))) {
      return;
    }

    this.lastCrashSummary = {
      sessionId: previousSession.sessionId,
      startedAt: previousSession.startedAt,
      endedAt: detectedAt,
      detectedAt,
      sessionBasename: basename(previousSessionDir),
      sessionPathHash: hashText(previousSessionDir),
      reason: 'abnormalExit',
    };
  }
}

let crashReportService: CrashReportService | null = null;

export const getCrashReportService = (): CrashReportService => {
  crashReportService ??= new CrashReportService();
  return crashReportService;
};

export const resetCrashReportServiceForTests = (): void => {
  crashReportService = null;
};
