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
import type {
  DiagnosticCoverProtocolRequest,
  DiagnosticCoverProtocolSnapshot,
  DiagnosticLyricsSearchEvent,
  DiagnosticLyricsSearchSnapshot,
  DiagnosticMemoryPressureEvent,
  DiagnosticMemoryProcessMetric,
  DiagnosticMemorySnapshot,
  DiagnosticRendererMemorySnapshot,
  LastCrashSummary,
  RendererErrorPayload,
  CrashSessionInfo,
} from '../../shared/types/diagnostics';
import { getAppSettings } from '../app/appSettings';
import { getLastDataProtectionResult, getLibraryDatabaseMaintenanceReport } from '../app/dataProtection';
import { getAudioSession } from '../audioPublicApi';
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

type DiagnosticMemoryTrendSample = NonNullable<DiagnosticMemorySnapshot['recentSamples']>[number];
type DiagnosticMemoryTrendProcess = DiagnosticMemoryTrendSample['topProcesses'][number];

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

const markdownReportToText = (markdown: string): string =>
  `${markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^```(?:json|text)?$/gm, '-----')
    .replace(/^```$/gm, '-----')
    .trim()}\n`;

const aiReportReviewTip = 'AI review tip: Copy this report and paste it into AI to help identify the problem.';

const formatBytes = (bytes: number | null | undefined): string => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return 'n/a';
  }

  const mib = bytes / (1024 * 1024);
  if (mib < 1024) {
    return `${mib.toFixed(mib >= 100 ? 0 : 1)} MiB`;
  }

  return `${(mib / 1024).toFixed(2)} GiB`;
};

const formatSignedBytes = (bytes: number | null | undefined): string => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) {
    return 'n/a';
  }

  if (bytes === 0) {
    return '0 MiB';
  }

  return `${bytes > 0 ? '+' : '-'}${formatBytes(Math.abs(bytes))}`;
};

const memoryProcessLabel = (metric: DiagnosticMemoryProcessMetric | null | undefined): string =>
  metric ? (metric.serviceName || metric.name || metric.type || `pid-${metric.pid}`) : 'unknown';

const memoryTrendProcessLabel = (metric: DiagnosticMemoryTrendProcess | null | undefined): string =>
  metric ? (metric.serviceName || metric.name || metric.type || `pid-${metric.pid}`) : 'unknown';

const cleanMarkdownTableCell = (value: unknown): string =>
  String(value ?? 'n/a').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

const maxDiagnosticStringLength = 240;

const compactDiagnosticString = (value: string): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxDiagnosticStringLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxDiagnosticStringLength)}... [truncated, hash ${hashText(value)}]`;
};

const sanitizeDiagnosticStrings = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return compactDiagnosticString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticStrings(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeDiagnosticStrings(item)]),
  );
};

const sanitizeMemoryPressureSnapshot = (snapshot: DiagnosticMemorySnapshot): DiagnosticMemorySnapshot =>
  sanitizeDiagnosticStrings(snapshot) as DiagnosticMemorySnapshot;

const createProcessGrowthBreakdownMarkdown = (samples: DiagnosticMemorySnapshot['recentSamples'] | undefined): string[] => {
  const lines = [
    '### Process Growth Breakdown',
    '',
  ];

  if (!samples || samples.length < 2) {
    lines.push('- Not enough retained samples to compare per-process growth.');
    return lines;
  }

  const byPid = new Map<number, {
    first: DiagnosticMemoryTrendProcess;
    firstTimestamp: string;
    last: DiagnosticMemoryTrendProcess;
    lastTimestamp: string;
  }>();

  samples.forEach((sample) => {
    sample.topProcesses.forEach((processMetric) => {
      const existing = byPid.get(processMetric.pid);
      if (!existing) {
        byPid.set(processMetric.pid, {
          first: processMetric,
          firstTimestamp: sample.timestamp,
          last: processMetric,
          lastTimestamp: sample.timestamp,
        });
        return;
      }

      existing.last = processMetric;
      existing.lastTimestamp = sample.timestamp;
    });
  });

  const rows = [...byPid.entries()]
    .map(([pid, item]) => ({
      pid,
      label: memoryTrendProcessLabel(item.last),
      firstTimestamp: item.firstTimestamp,
      lastTimestamp: item.lastTimestamp,
      firstWorking: item.first.workingSetBytes,
      lastWorking: item.last.workingSetBytes,
      workingDelta: item.last.workingSetBytes - item.first.workingSetBytes,
      firstPrivate: item.first.privateBytes,
      lastPrivate: item.last.privateBytes,
      privateDelta: typeof item.last.privateBytes === 'number' && typeof item.first.privateBytes === 'number'
        ? item.last.privateBytes - item.first.privateBytes
        : undefined,
    }))
    .filter((row) => row.firstTimestamp !== row.lastTimestamp)
    .sort((left, right) => {
      const privateDelta = (right.privateDelta ?? Number.NEGATIVE_INFINITY) - (left.privateDelta ?? Number.NEGATIVE_INFINITY);
      return privateDelta || right.workingDelta - left.workingDelta;
    })
    .slice(0, 8);

  if (rows.length === 0) {
    lines.push('- Retained samples did not keep a comparable process long enough to calculate growth.');
    return lines;
  }

  lines.push(
    '| # | Process | Window | Working Set Delta | Private Delta | Working Set First -> Last | Private First -> Last |',
    '| - | - | - | - | - | - | - |',
  );

  rows.forEach((row, index) => {
    lines.push(`| ${[
      index + 1,
      cleanMarkdownTableCell(`${row.label}#${row.pid}`),
      cleanMarkdownTableCell(`${shortIsoTime(row.firstTimestamp)} -> ${shortIsoTime(row.lastTimestamp)}`),
      formatSignedBytes(row.workingDelta),
      formatSignedBytes(row.privateDelta),
      `${formatBytes(row.firstWorking)} -> ${formatBytes(row.lastWorking)}`,
      `${formatBytes(row.firstPrivate)} -> ${formatBytes(row.lastPrivate)}`,
    ].join(' | ')} |`);
  });

  return lines;
};

const createMemoryTrendInflectionMarkdown = (samples: DiagnosticMemorySnapshot['recentSamples'] | undefined): string[] => {
  const lines = [
    '### Memory Inflection Windows',
    '',
  ];

  if (!samples || samples.length < 2) {
    lines.push('- Not enough retained samples to detect a growth inflection.');
    return lines;
  }

  const windows = samples.slice(1).map((sample, index) => {
    const previous = samples[index];
    const processRows = sample.topProcesses.map((processMetric) => {
      const previousProcess = previous.topProcesses.find((item) => item.pid === processMetric.pid);
      return {
        process: processMetric,
        workingDelta: previousProcess ? processMetric.workingSetBytes - previousProcess.workingSetBytes : undefined,
        privateDelta: previousProcess && typeof processMetric.privateBytes === 'number' && typeof previousProcess.privateBytes === 'number'
          ? processMetric.privateBytes - previousProcess.privateBytes
          : undefined,
      };
    });
    const largestProcessDelta = [...processRows].sort((left, right) =>
      (right.privateDelta ?? Number.NEGATIVE_INFINITY) - (left.privateDelta ?? Number.NEGATIVE_INFINITY) ||
      (right.workingDelta ?? Number.NEGATIVE_INFINITY) - (left.workingDelta ?? Number.NEGATIVE_INFINITY),
    )[0] ?? null;

    return {
      previous,
      sample,
      totalWorkingDelta: sample.totalWorkingSetBytes - previous.totalWorkingSetBytes,
      totalPrivateDelta: typeof sample.totalPrivateBytes === 'number' && typeof previous.totalPrivateBytes === 'number'
        ? sample.totalPrivateBytes - previous.totalPrivateBytes
        : undefined,
      topProcessChanged: previous.topProcesses[0]?.pid !== sample.topProcesses[0]?.pid,
      largestProcessDelta,
    };
  }).sort((left, right) =>
    (right.totalPrivateDelta ?? Number.NEGATIVE_INFINITY) - (left.totalPrivateDelta ?? Number.NEGATIVE_INFINITY) ||
    right.totalWorkingDelta - left.totalWorkingDelta,
  ).slice(0, 6);

  lines.push(
    '| # | Window | Total Working Delta | Total Private Delta | Largest Process Delta | Top Process |',
    '| - | - | - | - | - | - |',
  );

  windows.forEach((window, index) => {
    const processDelta = window.largestProcessDelta;
    const process = processDelta?.process;
    const processDeltaText = process
      ? `${memoryTrendProcessLabel(process)}#${process.pid} private ${formatSignedBytes(processDelta.privateDelta)}, working ${formatSignedBytes(processDelta.workingDelta)}`
      : 'n/a';
    const topProcess = window.sample.topProcesses[0] ?? null;
    lines.push(`| ${[
      index + 1,
      cleanMarkdownTableCell(`${shortIsoTime(window.previous.timestamp)} -> ${shortIsoTime(window.sample.timestamp)}`),
      formatSignedBytes(window.totalWorkingDelta),
      formatSignedBytes(window.totalPrivateDelta),
      cleanMarkdownTableCell(processDeltaText),
      cleanMarkdownTableCell(`${topProcess ? `${memoryTrendProcessLabel(topProcess)}#${topProcess.pid}` : 'n/a'}${window.topProcessChanged ? ' (changed)' : ''}`),
    ].join(' | ')} |`);
  });

  return lines;
};

const createSuddenMemorySpikeEventsMarkdown = (snapshot: DiagnosticMemorySnapshot): string[] => {
  const lines = [
    '## Sudden Memory Spike Events',
    '',
  ];
  const samples = snapshot.recentSamples ?? [];

  if (samples.length < 2) {
    lines.push('- Not enough retained samples to expose sudden memory spike events.');
    return lines;
  }

  const mib = 1024 * 1024;
  const triggerMs = Date.parse(snapshot.timestamp);
  const rendererSnapshots = snapshot.rendererProcesses ?? [];
  const coverRequests = snapshot.coverProtocol?.recentRequests ?? [];
  const countBy = (values: string[]): string => {
    const counts = new Map<string, number>();
    values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .map(([key, count]) => `${key} ${count}`)
      .join(', ') || 'n/a';
  };

  const windows = samples.slice(1).map((sample, index) => {
    const previous = samples[index];
    const previousMs = Date.parse(previous.timestamp);
    const sampleMs = Date.parse(sample.timestamp);
    const processDeltas = sample.topProcesses.map((processMetric) => {
      const previousProcess = previous.topProcesses.find((item) => item.pid === processMetric.pid);
      return {
        process: processMetric,
        workingDelta: previousProcess ? processMetric.workingSetBytes - previousProcess.workingSetBytes : undefined,
        privateDelta: previousProcess && typeof processMetric.privateBytes === 'number' && typeof previousProcess.privateBytes === 'number'
          ? processMetric.privateBytes - previousProcess.privateBytes
          : undefined,
      };
    });
    const largestProcessDelta = [...processDeltas].sort((left, right) =>
      (right.privateDelta ?? Number.NEGATIVE_INFINITY) - (left.privateDelta ?? Number.NEGATIVE_INFINITY) ||
      (right.workingDelta ?? Number.NEGATIVE_INFINITY) - (left.workingDelta ?? Number.NEGATIVE_INFINITY),
    )[0] ?? null;
    const totalWorkingDelta = sample.totalWorkingSetBytes - previous.totalWorkingSetBytes;
    const totalPrivateDelta = typeof sample.totalPrivateBytes === 'number' && typeof previous.totalPrivateBytes === 'number'
      ? sample.totalPrivateBytes - previous.totalPrivateBytes
      : undefined;
    const topProcessChanged = previous.topProcesses[0]?.pid !== sample.topProcesses[0]?.pid;
    const startAgeMs = Number.isFinite(triggerMs) && Number.isFinite(sampleMs) ? Math.max(0, triggerMs - sampleMs) : 0;
    const endAgeMs = Number.isFinite(triggerMs) && Number.isFinite(previousMs) ? Math.max(startAgeMs, triggerMs - previousMs) : startAgeMs + 30_000;
    const nearbyActions = rendererSnapshots.flatMap((renderer) =>
      (renderer.userActions?.recent ?? []).filter((action) => action.ageMs >= startAgeMs && action.ageMs <= endAgeMs)
        .map((action) => `${renderer.routeDetail?.reactRouteId ?? renderer.windowKind}:${action.type}`),
    );
    const nearbyImageEvents = rendererSnapshots.flatMap((renderer) =>
      (renderer.images?.lifecycle?.recentEvents ?? []).filter((event) => event.ageMs >= startAgeMs && event.ageMs <= endAgeMs)
        .map((event) => `${renderer.routeDetail?.reactRouteId ?? renderer.windowKind}:${event.type}:${event.srcKind}`),
    );
    const nearbyCoverRequests = coverRequests.filter((request) => {
      const completedMs = Date.parse(request.completedAt);
      return Number.isFinite(completedMs) && Number.isFinite(previousMs) && Number.isFinite(sampleMs)
        ? completedMs >= previousMs && completedMs <= sampleMs
        : false;
    });
    const processPrivateSpike = largestProcessDelta?.privateDelta ?? 0;
    const processWorkingSpike = largestProcessDelta?.workingDelta ?? 0;
    const isSpike =
      (totalPrivateDelta ?? 0) >= 256 * mib ||
      totalWorkingDelta >= 256 * mib ||
      processPrivateSpike >= 128 * mib ||
      processWorkingSpike >= 128 * mib ||
      topProcessChanged;

    return {
      previous,
      sample,
      totalWorkingDelta,
      totalPrivateDelta,
      largestProcessDelta,
      topProcessChanged,
      isSpike,
      nearbyActions,
      nearbyImageEvents,
      nearbyCoverRequests,
    };
  });

  const spikeWindows = windows.filter((window) => window.isSpike);
  const rows = (spikeWindows.length ? spikeWindows : [...windows].sort((left, right) =>
    (right.totalPrivateDelta ?? Number.NEGATIVE_INFINITY) - (left.totalPrivateDelta ?? Number.NEGATIVE_INFINITY) ||
    right.totalWorkingDelta - left.totalWorkingDelta,
  ).slice(0, 4)).slice(0, 8);

  lines.push(
    spikeWindows.length
      ? `- ${spikeWindows.length} retained sample window(s) crossed sudden-spike thresholds.`
      : '- No retained sample window crossed sudden-spike thresholds; showing the largest retained windows anyway.',
    '- Thresholds: total private +256 MiB, total working +256 MiB, single-process private/working +128 MiB, or top-process switch.',
    '',
    '| # | Spike | Window | Total Private Delta | Total Working Delta | Largest Process Delta | Top Switch | Nearby Activity | Nearby Image Events | Cover/Image Requests |',
    '| - | - | - | - | - | - | - | - | - | - |',
  );

  rows.forEach((window, index) => {
    const processDelta = window.largestProcessDelta;
    const process = processDelta?.process;
    const processDeltaText = process
      ? `${memoryTrendProcessLabel(process)}#${process.pid} private ${formatSignedBytes(processDelta.privateDelta)}, working ${formatSignedBytes(processDelta.workingDelta)}`
      : 'n/a';
    const coverByVariant = countBy(window.nearbyCoverRequests.map((request) => `${request.scheme}:${request.variant ?? request.routeKind}`));
    lines.push(`| ${[
      index + 1,
      window.isSpike ? 'yes' : 'no',
      cleanMarkdownTableCell(`${shortIsoTime(window.previous.timestamp)} -> ${shortIsoTime(window.sample.timestamp)}`),
      formatSignedBytes(window.totalPrivateDelta),
      formatSignedBytes(window.totalWorkingDelta),
      cleanMarkdownTableCell(processDeltaText),
      window.topProcessChanged ? 'yes' : 'no',
      cleanMarkdownTableCell(countBy(window.nearbyActions)),
      cleanMarkdownTableCell(countBy(window.nearbyImageEvents)),
      cleanMarkdownTableCell(`${window.nearbyCoverRequests.length}; ${coverByVariant}`),
    ].join(' | ')} |`);
  });

  return lines;
};

const createMemoryProcessTableMarkdown = (metrics: DiagnosticMemoryProcessMetric[]): string[] => {
  const lines = [
    '| # | PID | Type | Name | Working Set | Private | CPU |',
    '| - | - | - | - | - | - | - |',
  ];

  if (metrics.length === 0) {
    lines.push('| - | n/a | n/a | n/a | n/a | n/a | n/a |');
    return lines;
  }

  metrics.forEach((metric, index) => {
    lines.push(`| ${[
      index + 1,
      metric.pid,
      cleanMarkdownTableCell(metric.type),
      cleanMarkdownTableCell(metric.serviceName || metric.name || 'n/a'),
      formatBytes(metric.workingSetBytes),
      formatBytes(metric.privateBytes),
      typeof metric.cpuPercent === 'number' && Number.isFinite(metric.cpuPercent) ? `${metric.cpuPercent.toFixed(1)}%` : 'n/a',
    ].join(' | ')} |`);
  });

  return lines;
};

const createMemoryTrendMarkdown = (samples: DiagnosticMemorySnapshot['recentSamples'] | undefined): string[] => {
  const lines = [
    '## Recent Memory Trend',
    '',
  ];

  if (!samples?.length) {
    lines.push('- No pre-threshold memory trend samples were retained.');
    return lines;
  }

  const first = samples[0];
  const last = samples.at(-1) ?? first;
  lines.push(
    `- Samples retained: ${samples.length}`,
    `- Total working set change: ${formatSignedBytes(last.totalWorkingSetBytes - first.totalWorkingSetBytes)}`,
    `- Total private bytes change: ${formatSignedBytes(
      typeof last.totalPrivateBytes === 'number' && typeof first.totalPrivateBytes === 'number'
        ? last.totalPrivateBytes - first.totalPrivateBytes
        : undefined,
    )}`,
    '',
    '| # | Time | Total Working Set | Total Private | Top Process | Top Working Set | Top Private | CPU |',
    '| - | - | - | - | - | - | - | - |',
  );

  samples.forEach((sample, index) => {
    const top = sample.topProcesses[0] ?? null;
    lines.push(`| ${[
      index + 1,
      cleanMarkdownTableCell(shortIsoTime(sample.timestamp)),
      formatBytes(sample.totalWorkingSetBytes),
      formatBytes(sample.totalPrivateBytes),
      cleanMarkdownTableCell(top ? `${top.type}${top.serviceName || top.name ? `:${top.serviceName ?? top.name}` : ''}#${top.pid}` : 'n/a'),
      formatBytes(top?.workingSetBytes),
      formatBytes(top?.privateBytes),
      typeof top?.cpuPercent === 'number' ? `${top.cpuPercent.toFixed(1)}%` : 'n/a',
    ].join(' | ')} |`);
  });

  lines.push('', ...createMemoryTrendInflectionMarkdown(samples), '', ...createProcessGrowthBreakdownMarkdown(samples));

  return lines;
};

const rendererHeapUsedBytes = (snapshot: DiagnosticRendererMemorySnapshot): number =>
  Math.max(
    snapshot.heap?.usedJSHeapSize ?? 0,
    snapshot.chromium?.runtimeHeapUsage?.usedSize ?? 0,
    snapshot.chromium?.performanceMetrics?.JSHeapUsedSize ?? 0,
  );

const rendererNodeCount = (snapshot: DiagnosticRendererMemorySnapshot): number =>
  Math.max(
    snapshot.dom?.nodeCount ?? 0,
    snapshot.chromium?.domCounters?.nodes ?? 0,
    snapshot.chromium?.performanceMetrics?.Nodes ?? 0,
  );

const rendererNativeGapBytes = (snapshot: DiagnosticRendererMemorySnapshot): number | undefined => {
  const privateBytes = snapshot.process?.privateBytes;
  if (typeof privateBytes !== 'number') {
    return undefined;
  }

  return Math.max(0, privateBytes - rendererHeapUsedBytes(snapshot) - (snapshot.images?.estimatedDecodedBytes ?? 0));
};

const rendererActivityBucketMarkdown = (snapshot: DiagnosticRendererMemorySnapshot): string[] => {
  const actions = snapshot.userActions?.recent ?? [];
  const imageEvents = snapshot.images?.lifecycle?.recentEvents ?? [];
  if (actions.length === 0 && imageEvents.length === 0) {
    return [];
  }

  const buckets = [
    { label: '0-5s', min: 0, max: 5_000 },
    { label: '5-15s', min: 5_000, max: 15_000 },
    { label: '15-30s', min: 15_000, max: 30_000 },
  ];
  const lines = [
    'Recent activity correlation:',
    '',
    '| Age | User actions | Image events | Top action types | Top image kinds |',
    '| - | - | - | - | - |',
  ];

  buckets.forEach((bucket) => {
    const bucketActions = actions.filter((item) => item.ageMs >= bucket.min && item.ageMs < bucket.max);
    const bucketImages = imageEvents.filter((item) => item.ageMs >= bucket.min && item.ageMs < bucket.max);
    const countBy = <T extends string>(values: T[]): string => {
      const counts = new Map<T, number>();
      values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
      return [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 3)
        .map(([key, count]) => `${key} ${count}`)
        .join(', ') || 'n/a';
    };

    lines.push(`| ${[
      bucket.label,
      bucketActions.length,
      bucketImages.length,
      cleanMarkdownTableCell(countBy(bucketActions.map((item) => item.type))),
      cleanMarkdownTableCell(countBy(bucketImages.map((item) => item.srcKind))),
    ].join(' | ')} |`);
  });

  return lines;
};

const createRendererPressureRankingMarkdown = (snapshots: DiagnosticRendererMemorySnapshot[] | undefined): string[] => {
  const lines = [
    '### Renderer Pressure Ranking',
    '',
  ];

  if (!snapshots?.length) {
    lines.push('- No renderer snapshots are available to rank.');
    return lines;
  }

  const rows = snapshots.map((snapshot) => {
    const privateBytes = snapshot.process?.privateBytes ?? 0;
    const heapBytes = rendererHeapUsedBytes(snapshot);
    const decodedBytes = snapshot.images?.estimatedDecodedBytes ?? 0;
    const nativeGap = rendererNativeGapBytes(snapshot);
    const nodes = rendererNodeCount(snapshot);
    const willChange = snapshot.style?.willChangeElementCount ?? 0;
    const blur = snapshot.style?.blurFilterElementCount ?? 0;
    const imageChurn = (snapshot.images?.lifecycle?.mounted ?? 0) +
      (snapshot.images?.lifecycle?.unmounted ?? 0) +
      (snapshot.images?.lifecycle?.srcChanged ?? 0);
    const mediaCount = (snapshot.media?.videoCount ?? 0) + (snapshot.media?.youtubeFrameCount ?? 0);
    const visibleState = snapshot.visibleState ?? {};
    const score =
      (privateBytes >= 1024 * 1024 * 1024 ? 4 : privateBytes >= 512 * 1024 * 1024 ? 2 : 0) +
      ((nativeGap ?? 0) >= 768 * 1024 * 1024 ? 3 : (nativeGap ?? 0) >= 256 * 1024 * 1024 ? 1 : 0) +
      (heapBytes >= 512 * 1024 * 1024 ? 3 : 0) +
      (decodedBytes >= 256 * 1024 * 1024 ? 2 : 0) +
      (nodes >= 50_000 ? 2 : nodes >= 15_000 ? 1 : 0) +
      (willChange >= 100 ? 1 : 0) +
      (blur >= 4 ? 1 : 0) +
      (imageChurn >= 40 ? 1 : 0) +
      (mediaCount > 0 ? 2 : 0) +
      (visibleState.lyricsPageVisible === true || visibleState.mvPanelVisible === true ? 1 : 0);

    const state = [
      snapshot.isVisible === true ? 'visible' : 'hidden',
      visibleState.lyricsRenderPressureReduced === true || visibleState.mvRenderPressureReduced === true ? 'reduced' : 'not-reduced',
      visibleState.lyricsBackgroundMode ? `bg:${visibleState.lyricsBackgroundMode}` : null,
    ].filter(Boolean).join(', ');
    const signals = [
      `gap ${formatBytes(nativeGap)}`,
      `will ${willChange}`,
      `blur ${blur}`,
      `media ${mediaCount}`,
      `img-churn ${imageChurn}`,
    ].join(', ');

    return {
      snapshot,
      score,
      privateBytes,
      heapBytes,
      decodedBytes,
      nativeGap,
      nodes,
      state,
      signals,
    };
  }).sort((left, right) =>
    right.score - left.score ||
    right.privateBytes - left.privateBytes ||
    (right.nativeGap ?? 0) - (left.nativeGap ?? 0),
  );

  lines.push(
    '| Rank | Score | Renderer | Route | Private | Heap | Decoded Images | DOM Nodes | State | Signals |',
    '| - | - | - | - | - | - | - | - | - | - |',
  );

  rows.forEach((row, index) => {
    lines.push(`| ${[
      index + 1,
      row.score,
      cleanMarkdownTableCell(`${row.snapshot.windowKind}#${row.snapshot.pid ?? 'n/a'}`),
      cleanMarkdownTableCell(`${row.snapshot.routeDetail?.reactRouteId ?? row.snapshot.route}/${row.snapshot.routeDetail?.pageMode ?? 'n/a'}`),
      formatBytes(row.privateBytes),
      formatBytes(row.heapBytes),
      formatBytes(row.decodedBytes),
      row.nodes,
      cleanMarkdownTableCell(row.state),
      cleanMarkdownTableCell(row.signals),
    ].join(' | ')} |`);
  });

  return lines;
};

const createRendererSnapshotSummaryMarkdown = (snapshots: DiagnosticRendererMemorySnapshot[] | undefined): string[] => {
  const lines = [
    '## Renderer Process Snapshots',
    '',
  ];

  if (!snapshots?.length) {
    lines.push('- No renderer-side snapshot was captured for this memory pressure event.');
    return lines;
  }

  lines.push(...createRendererPressureRankingMarkdown(snapshots), '');

  snapshots.forEach((snapshot, index) => {
    const heap = snapshot.heap;
    const chromiumHeap = snapshot.chromium?.runtimeHeapUsage;
    const chromiumDom = snapshot.chromium?.domCounters;
    const perf = snapshot.chromium?.performanceMetrics;
    const dom = snapshot.dom;
    const images = snapshot.images;
    const media = snapshot.media;
    const process = snapshot.process;
    const activityCorrelation = rendererActivityBucketMarkdown(snapshot);
    lines.push(
      `### Renderer ${index + 1}: ${snapshot.windowKind}`,
      '',
      `- PID: ${snapshot.pid ?? 'n/a'}`,
      `- Window id: ${snapshot.windowId ?? 'n/a'}`,
      `- Route: ${snapshot.route}${snapshot.routeHash ? ` (hash ${snapshot.routeHash})` : ''}`,
      `- React route/page mode: ${snapshot.routeDetail ? `${snapshot.routeDetail.reactRouteId ?? 'n/a'} / ${snapshot.routeDetail.pageMode ?? 'n/a'} (location ${snapshot.routeDetail.locationRoute ?? 'n/a'})` : 'n/a'}`,
      `- Visible/focused/loading: ${snapshot.isVisible === true ? 'yes' : 'no'} / ${snapshot.isFocused === true ? 'yes' : 'no'} / ${snapshot.isLoading === true ? 'yes' : 'no'}`,
      `- Collection: ${snapshot.collectionError ? `failed: ${snapshot.collectionError}` : `${snapshot.collectionDurationMs ?? 0}ms`}`,
      `- Electron process metric: ${process ? `${process.type ?? 'unknown'} ${formatBytes(process.workingSetBytes)} working / ${formatBytes(process.privateBytes)} private / ${formatBytes(process.peakWorkingSetBytes)} peak / ${typeof process.cpuPercent === 'number' ? `${process.cpuPercent.toFixed(1)}% CPU` : 'n/a CPU'}` : 'n/a'}`,
      `- Heap estimate: ${heap ? `${formatBytes(heap.usedJSHeapSize)} used / ${formatBytes(heap.totalJSHeapSize)} total / ${formatBytes(heap.jsHeapSizeLimit)} limit` : 'n/a'}`,
      `- Chromium heap: ${chromiumHeap ? `${formatBytes(chromiumHeap.usedSize)} used / ${formatBytes(chromiumHeap.totalSize)} total` : 'n/a'}`,
      `- Chromium DOM counters: ${chromiumDom ? `${chromiumDom.documents ?? 'n/a'} documents, ${chromiumDom.nodes ?? 'n/a'} nodes, ${chromiumDom.jsEventListeners ?? 'n/a'} JS event listeners` : 'n/a'}`,
      `- Chromium performance: ${perf ? `JSHeapUsedSize ${formatBytes(perf.JSHeapUsedSize)}, Nodes ${compactText(perf.Nodes)}, LayoutCount ${compactText(perf.LayoutCount)}, RecalcStyleCount ${compactText(perf.RecalcStyleCount)}, TaskDuration ${compactText(perf.TaskDuration)}` : 'n/a'}`,
      `- Chromium debugger: ${snapshot.chromium?.debuggerError ?? 'ok'}`,
      `- DOM: ${dom ? `${dom.nodeCount} nodes, ${dom.elementCount} elements, ${dom.textNodeCount} text nodes, ${dom.documentWidth}x${dom.documentHeight}px document` : 'n/a'}`,
      `- Images: ${images ? `${images.imageElementCount} img, ${images.loadedImageCount} loaded, ${images.brokenImageCount} broken, ${images.echoCoverImageCount} echo-cover, ${images.echoImageProtocolImageCount} echo-image, ${images.remoteImageCount} remote, ${formatBytes(images.estimatedDecodedBytes)} estimated decoded` : 'n/a'}`,
      `- Media nodes: ${media ? `${media.canvasCount} canvas, ${media.videoCount} video, ${media.youtubeFrameCount ?? 0} YouTube iframe, ${media.audioCount} audio` : 'n/a'}`,
      `- Resource entries: ${snapshot.resources ? `${snapshot.resources.totalResourceEntries} total, ${formatBytes(snapshot.resources.totalTransferSize)} transferred, ${formatBytes(snapshot.resources.totalDecodedBodySize)} decoded body` : 'n/a'}`,
      '',
      ...(media?.videoDetails?.length
        ? [
            'Video details:',
            '',
            formatJsonBlock(media.videoDetails),
            '',
          ]
        : []),
      ...(snapshot.userActions
        ? [
            `Recent user actions (${Math.round(snapshot.userActions.recentWindowMs / 1000)}s):`,
            '',
            formatJsonBlock(snapshot.userActions),
            '',
          ]
        : []),
      ...(images?.lifecycle
        ? [
            `Image lifecycle (${Math.round(images.lifecycle.recentWindowMs / 1000)}s):`,
            '',
            formatJsonBlock(images.lifecycle),
            '',
          ]
        : []),
      ...activityCorrelation,
      ...(activityCorrelation.length ? [''] : []),
      'Route detail:',
      '',
      formatJsonBlock(snapshot.routeDetail ?? {}),
      '',
      'Visible state:',
      '',
      formatJsonBlock(snapshot.visibleState ?? {}),
      '',
      'Selector counts:',
      '',
      formatJsonBlock(snapshot.selectors ?? {}),
      '',
      'Renderer app state:',
      '',
      formatJsonBlock(snapshot.appState ?? {}),
      '',
      'Style/resource pressure:',
      '',
      formatJsonBlock({
        style: snapshot.style ?? {},
        resources: snapshot.resources
          ? {
              byInitiatorType: snapshot.resources.byInitiatorType,
              byProtocol: snapshot.resources.byProtocol,
            }
          : {},
        largestImages: images?.largestImages ?? [],
      }),
      '',
    );
  });

  return lines;
};

const shortIsoTime = (value: string): string => value.split('T')[1]?.replace('Z', '') ?? value;

const createLyricsSearchEventsTableMarkdown = (events: DiagnosticLyricsSearchEvent[]): string[] => {
  const lines = [
    '| # | Completed | Kind | Trigger | Provider | Duration | Status | Stale | Canceled | Active | Input | Candidates | Cache |',
    '| - | - | - | - | - | - | - | - | - | - | - | - | - |',
  ];

  if (events.length === 0) {
    lines.push('| - | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |');
    return lines;
  }

  events.forEach((event, index) => {
    const input = [
      `q${event.input.searchTextChars}`,
      `t${event.input.titleChars}`,
      `a${event.input.artistChars}`,
      event.input.hasDuration ? 'dur' : 'no-dur',
      event.input.hasFilePath ? 'file' : 'no-file',
    ].join('/');
    const candidates = [
      `raw ${event.result.rawCandidateCount}`,
      `returned ${event.result.returnedCandidateCount}`,
      `rejected ${event.result.rejectedCandidateCount}`,
    ].join(', ');
    const cache = [
      event.result.lyricsCacheHitBeforeSearch ? 'lyrics-hit' : 'lyrics-miss',
      `candidate-hit ${event.result.storedCandidateCacheHits}`,
      `writes ${event.result.storedCandidateWrites}`,
      `touched ${event.result.storedCandidateRowsTouched}`,
    ].join(', ');
    lines.push(`| ${[
      index + 1,
      cleanMarkdownTableCell(shortIsoTime(event.completedAt)),
      cleanMarkdownTableCell(event.kind),
      cleanMarkdownTableCell(event.trigger),
      cleanMarkdownTableCell(event.providerId ?? 'all'),
      `${event.durationMs}ms`,
      cleanMarkdownTableCell(event.status),
      event.stale ? 'yes' : 'no',
      event.canceled ? 'yes' : 'no',
      `${event.activeAtStart}->${event.activeAtEnd}`,
      cleanMarkdownTableCell(input),
      cleanMarkdownTableCell(candidates),
      cleanMarkdownTableCell(cache),
    ].join(' | ')} |`);
  });

  return lines;
};

const createLyricsSearchDiagnosticsMarkdown = (snapshot: DiagnosticLyricsSearchSnapshot | undefined): string[] => {
  const lines = [
    '## Lyrics Search Diagnostics',
    '',
  ];

  if (!snapshot) {
    lines.push('- No lyrics search diagnostics were captured for this memory pressure event.');
    return lines;
  }

  lines.push(
    `- Captured at: ${snapshot.timestamp}`,
    `- Active search queue: ${snapshot.activeSearchCount} total (${snapshot.activeByKind.track} track, ${snapshot.activeByKind.snapshot} snapshot)`,
    `- Recent search-candidates events retained: ${snapshot.recentSearches.length} / ${snapshot.maxRecentSearches}`,
    '',
    '### Last Observed Lyrics Cache Size',
    '',
    formatJsonBlock(snapshot.lastObservedStorage ?? {}),
    '',
    '### Active Lyrics Searches',
    '',
    formatJsonBlock(snapshot.activeRequests),
    '',
    '### Recent search-candidates Events',
    '',
    ...createLyricsSearchEventsTableMarkdown(snapshot.recentSearches),
    '',
  );

  return lines;
};

const createCoverProtocolRecentRequestsTableMarkdown = (
  requests: DiagnosticCoverProtocolSnapshot['recentRequests'],
): string[] => {
  const lines = [
    '| # | Completed | Scheme | Route | Source | Outcome | Status | Duration | Known bytes | Host | Resource |',
    '| - | - | - | - | - | - | - | - | - | - | - |',
  ];

  if (requests.length === 0) {
    lines.push('| - | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |');
    return lines;
  }

  requests.slice(0, 40).forEach((request, index) => {
    lines.push(`| ${[
      index + 1,
      cleanMarkdownTableCell(shortIsoTime(request.completedAt)),
      cleanMarkdownTableCell(request.scheme),
      cleanMarkdownTableCell(request.variant ? `${request.routeKind}/${request.variant}` : request.routeKind),
      cleanMarkdownTableCell(request.source ?? 'unknown'),
      cleanMarkdownTableCell(request.outcome),
      request.statusCode,
      `${request.durationMs}ms`,
      formatBytes(request.knownBytes),
      cleanMarkdownTableCell(request.targetHost ?? 'n/a'),
      cleanMarkdownTableCell(request.resourceHash ?? request.urlHash),
    ].join(' | ')} |`);
  });

  return lines;
};

const createCoverProtocolTopResourcesTableMarkdown = (
  resources: DiagnosticCoverProtocolSnapshot['topResources'],
): string[] => {
  const lines = [
    '| # | Scheme | Route | Requests | Known bytes | Last outcome | Last status | Host | Resource |',
    '| - | - | - | - | - | - | - | - | - |',
  ];

  if (resources.length === 0) {
    lines.push('| - | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |');
    return lines;
  }

  resources.forEach((resource, index) => {
    lines.push(`| ${[
      index + 1,
      cleanMarkdownTableCell(resource.scheme),
      cleanMarkdownTableCell(resource.variant ? `${resource.routeKind}/${resource.variant}` : resource.routeKind),
      resource.requestCount,
      formatBytes(resource.knownBytes),
      cleanMarkdownTableCell(resource.lastOutcome),
      resource.lastStatusCode,
      cleanMarkdownTableCell(resource.targetHost ?? 'n/a'),
      cleanMarkdownTableCell(resource.resourceHash),
    ].join(' | ')} |`);
  });

  return lines;
};

const createCoverProtocolVariantPressureTableMarkdown = (
  snapshot: DiagnosticCoverProtocolSnapshot,
): string[] => {
  const variants = new Map<string, {
    requestCount: number;
    recentRequestCount: number;
    recentKnownBytes: number;
    topResourceCount: number;
    topKnownBytes: number;
    uniqueRecentResources: Set<string>;
  }>();
  const ensure = (variant: string): {
    requestCount: number;
    recentRequestCount: number;
    recentKnownBytes: number;
    topResourceCount: number;
    topKnownBytes: number;
    uniqueRecentResources: Set<string>;
  } => {
    const key = variant || 'unknown';
    const existing = variants.get(key);
    if (existing) {
      return existing;
    }
    const created = {
      requestCount: snapshot.byVariant[key] ?? 0,
      recentRequestCount: 0,
      recentKnownBytes: 0,
      topResourceCount: 0,
      topKnownBytes: 0,
      uniqueRecentResources: new Set<string>(),
    };
    variants.set(key, created);
    return created;
  };

  for (const variant of ['original', 'large', 'album', 'thumb']) {
    if (snapshot.byVariant[variant] !== undefined) {
      ensure(variant);
    }
  }

  for (const request of snapshot.recentRequests) {
    if (request.scheme !== 'echo-cover') {
      continue;
    }
    const stats = ensure(request.variant ?? request.routeKind);
    stats.recentRequestCount += 1;
    stats.recentKnownBytes += request.knownBytes ?? 0;
    if (request.resourceHash) {
      stats.uniqueRecentResources.add(request.resourceHash);
    }
  }

  for (const resource of snapshot.topResources) {
    if (resource.scheme !== 'echo-cover') {
      continue;
    }
    const stats = ensure(resource.variant ?? resource.routeKind);
    stats.topResourceCount += 1;
    stats.topKnownBytes += resource.knownBytes;
  }

  const lines = [
    '| Variant | Total requests | Recent requests | Recent unique resources | Recent known bytes | Top-resource bytes |',
    '| - | - | - | - | - | - |',
  ];

  const rows = Array.from(variants.entries())
    .sort((left, right) =>
      (right[1].recentKnownBytes - left[1].recentKnownBytes) ||
      (right[1].recentRequestCount - left[1].recentRequestCount) ||
      left[0].localeCompare(right[0]),
    );

  if (rows.length === 0) {
    lines.push('| - | 0 | 0 | 0 | 0 B | 0 B |');
    return lines;
  }

  rows.forEach(([variant, stats]) => {
    lines.push(`| ${[
      cleanMarkdownTableCell(variant),
      stats.requestCount,
      stats.recentRequestCount,
      stats.uniqueRecentResources.size,
      formatBytes(stats.recentKnownBytes),
      formatBytes(stats.topKnownBytes),
    ].join(' | ')} |`);
  });

  return lines;
};

const createCoverProtocolHotspotMarkdown = (snapshot: DiagnosticCoverProtocolSnapshot): string[] => {
  const lines = [
    '### Cover/Image Hotspot Analysis',
    '',
  ];
  const recentByVariant = new Map<string, { requests: number; bytes: number; unique: Set<string> }>();
  const recentByHost = new Map<string, { requests: number; bytes: number; unique: Set<string> }>();
  const recentBySecond = new Map<string, { requests: number; bytes: number; unique: Set<string> }>();
  const bump = (
    map: Map<string, { requests: number; bytes: number; unique: Set<string> }>,
    key: string,
    request: DiagnosticCoverProtocolRequest,
  ): void => {
    const existing = map.get(key) ?? { requests: 0, bytes: 0, unique: new Set<string>() };
    existing.requests += 1;
    existing.bytes += request.knownBytes ?? 0;
    existing.unique.add(request.resourceHash ?? request.urlHash);
    map.set(key, existing);
  };

  snapshot.recentRequests.forEach((request) => {
    bump(recentByVariant, `${request.scheme}:${request.variant ?? request.routeKind}`, request);
    bump(recentByHost, request.targetHost ?? 'local-or-unknown', request);
    bump(recentBySecond, shortIsoTime(request.completedAt).slice(0, 8), request);
  });

  const formatHotspotRows = (
    title: string,
    map: Map<string, { requests: number; bytes: number; unique: Set<string> }>,
    limit: number,
  ): string[] => {
    const rows = [...map.entries()]
      .sort((left, right) => right[1].bytes - left[1].bytes || right[1].requests - left[1].requests || left[0].localeCompare(right[0]))
      .slice(0, limit);
    const section = [
      title,
      '',
      '| Key | Requests | Unique resources | Known bytes |',
      '| - | - | - | - |',
    ];

    if (rows.length === 0) {
      section.push('| n/a | 0 | 0 | n/a |');
      return section;
    }

    rows.forEach(([key, stats]) => {
      section.push(`| ${[
        cleanMarkdownTableCell(key),
        stats.requests,
        stats.unique.size,
        formatBytes(stats.bytes),
      ].join(' | ')} |`);
    });
    return section;
  };

  const repeatedResources = snapshot.topResources
    .filter((resource) => resource.requestCount > 1 || resource.knownBytes >= 1024 * 1024)
    .sort((left, right) => right.knownBytes - left.knownBytes || right.requestCount - left.requestCount)
    .slice(0, 10);

  lines.push(
    '- Read this before Raw Memory Snapshot: high requests with high unique resources suggests churn; high repeated bytes suggests one or a few large assets being decoded/cached repeatedly.',
    '',
    'Repeated/heavy resources:',
    '',
    '| # | Resource | Scheme | Route | Requests | Known bytes | Last completed |',
    '| - | - | - | - | - | - | - |',
  );

  if (repeatedResources.length === 0) {
    lines.push('| - | n/a | n/a | n/a | 0 | n/a | n/a |');
  } else {
    repeatedResources.forEach((resource, index) => {
      lines.push(`| ${[
        index + 1,
        cleanMarkdownTableCell(resource.resourceHash),
        cleanMarkdownTableCell(resource.scheme),
        cleanMarkdownTableCell(resource.variant ? `${resource.routeKind}/${resource.variant}` : resource.routeKind),
        resource.requestCount,
        formatBytes(resource.knownBytes),
        cleanMarkdownTableCell(shortIsoTime(resource.lastCompletedAt)),
      ].join(' | ')} |`);
    });
  }

  lines.push(
    '',
    ...formatHotspotRows('Recent burst by second:', recentBySecond, 8),
    '',
    ...formatHotspotRows('Recent pressure by variant:', recentByVariant, 8),
    '',
    ...formatHotspotRows('Recent pressure by host:', recentByHost, 8),
  );

  return lines;
};

const createCoverProtocolDiagnosticsMarkdown = (snapshot: DiagnosticCoverProtocolSnapshot | undefined): string[] => {
  const lines = [
    '## Cover/Image Protocol Diagnostics',
    '',
  ];

  if (!snapshot) {
    lines.push('- No cover/image protocol diagnostics were captured for this memory pressure event.');
    return lines;
  }

  lines.push(
    `- Captured at: ${snapshot.timestamp}`,
    `- Total requests since start: ${snapshot.totalRequests}`,
    `- Active protocol requests: ${snapshot.activeRequestCount}`,
    `- Known bytes served since start: ${formatBytes(snapshot.totalKnownBytesServed)}`,
    `- Known bytes in retained recent requests: ${formatBytes(snapshot.recentKnownBytesServed)}`,
    `- Tracked unique resources: ${snapshot.trackedUniqueResourceCount}${snapshot.uniqueResourceTrackingTruncated ? ' (tracking limit reached)' : ''}`,
    '',
    '### Protocol Counters',
    '',
    formatJsonBlock({
      byScheme: snapshot.byScheme,
      byOutcome: snapshot.byOutcome,
      bySource: snapshot.bySource,
      byStatusCode: snapshot.byStatusCode,
      byRouteKind: snapshot.byRouteKind,
      byVariant: snapshot.byVariant,
      byTargetHost: snapshot.byTargetHost,
    }),
    '',
    '### Active Protocol Requests',
    '',
    formatJsonBlock(snapshot.activeRequests),
    '',
    '### Top Cover/Image Resources',
    '',
    ...createCoverProtocolTopResourcesTableMarkdown(snapshot.topResources),
    '',
    '### Echo-cover Variant Pressure',
    '',
    ...createCoverProtocolVariantPressureTableMarkdown(snapshot),
    '',
    ...createCoverProtocolHotspotMarkdown(snapshot),
    '',
    '### Recent Cover/Image Requests',
    '',
    ...createCoverProtocolRecentRequestsTableMarkdown(snapshot.recentRequests),
    '',
  );

  return lines;
};

const createLyricsMvGraphicsPressureRecommendation = (
  snapshot: DiagnosticMemorySnapshot,
): DiagnosticMemoryPressureEvent['graphicsPressure'] => {
  const topProcess = snapshot.topProcesses[0] ?? snapshot.metrics[0] ?? null;
  const topProcessLabel = memoryProcessLabel(topProcess).toLowerCase();
  const rendererSnapshots = snapshot.rendererProcesses ?? [];
  const matchedRenderer = rendererSnapshots.find((renderer) => renderer.pid === topProcess?.pid)
    ?? [...rendererSnapshots].sort((left, right) =>
      (right.process?.privateBytes ?? right.process?.workingSetBytes ?? 0) -
      (left.process?.privateBytes ?? left.process?.workingSetBytes ?? 0),
    )[0]
    ?? null;
  const visibleState = matchedRenderer?.visibleState ?? {};
  const lyricsPageVisible = visibleState.lyricsPageVisible === true;
  const mvPanelVisible = visibleState.mvPanelVisible === true;
  const rendererPrivateBytes = matchedRenderer?.process?.privateBytes ?? topProcess?.privateBytes ?? 0;
  const rendererHeapUsedBytes = Math.max(
    matchedRenderer?.heap?.usedJSHeapSize ?? 0,
    matchedRenderer?.chromium?.runtimeHeapUsage?.usedSize ?? 0,
    matchedRenderer?.chromium?.performanceMetrics?.JSHeapUsedSize ?? 0,
  );
  const rendererDomNodes = Math.max(
    matchedRenderer?.dom?.nodeCount ?? 0,
    matchedRenderer?.chromium?.domCounters?.nodes ?? 0,
    matchedRenderer?.chromium?.performanceMetrics?.Nodes ?? 0,
  );
  const foregroundVideoCount = Number(visibleState.mvForegroundVideoCount ?? 0);
  const backgroundVideoCount = Number(visibleState.mvBackgroundVideoCount ?? 0);
  const foregroundYoutubeCount = Number(visibleState.mvForegroundYoutubeFrameCount ?? 0);
  const backgroundYoutubeCount = Number(visibleState.mvBackgroundYoutubeFrameCount ?? 0);
  const duplicateMvVideoDecode =
    (foregroundVideoCount > 0 && backgroundVideoCount > 0) ||
    (foregroundYoutubeCount > 0 && backgroundYoutubeCount > 0);
  const gib = 1024 * 1024 * 1024;
  const mib = 1024 * 1024;

  if (
    !topProcessLabel.includes('tab') &&
    !topProcessLabel.includes('renderer') &&
    matchedRenderer?.windowKind !== 'main'
  ) {
    return null;
  }

  if (
    rendererPrivateBytes < gib ||
    rendererHeapUsedBytes >= 256 * mib ||
    rendererDomNodes >= 30_000 ||
    (!lyricsPageVisible && !mvPanelVisible)
  ) {
    return null;
  }

  return {
    kind: 'lyrics-mv-render-pressure',
    reason: duplicateMvVideoDecode
      ? 'renderer-native-memory-high-with-duplicate-mv-video-decode'
      : 'renderer-native-memory-high-on-lyrics-or-mv-page',
    rendererPid: matchedRenderer?.pid,
    rendererPrivateBytes,
    rendererHeapUsedBytes,
    rendererDomNodes,
    lyricsPageVisible,
    mvPanelVisible,
    duplicateMvVideoDecode,
  };
};

const createGraphicsPressureRecommendationMarkdown = (snapshot: DiagnosticMemorySnapshot): string[] => {
  const lines = [
    '## Graphics Pressure Recommendation',
    '',
  ];
  const graphicsPressure = createLyricsMvGraphicsPressureRecommendation(snapshot);

  if (!graphicsPressure) {
    lines.push('- No lyrics/MV graphics pressure recommendation was generated for this report.');
    return lines;
  }

  const renderer = snapshot.rendererProcesses?.find((item) => item.pid === graphicsPressure.rendererPid)
    ?? snapshot.rendererProcesses?.find((item) => item.visibleState?.lyricsPageVisible === true || item.visibleState?.mvPanelVisible === true)
    ?? null;
  const visibleState = renderer?.visibleState ?? {};

  lines.push(
    `- Recommendation: ${graphicsPressure.kind}`,
    `- Reason: ${graphicsPressure.reason}`,
    `- Renderer: pid ${graphicsPressure.rendererPid ?? renderer?.pid ?? 'n/a'}, private ${formatBytes(graphicsPressure.rendererPrivateBytes)}, heap ${formatBytes(graphicsPressure.rendererHeapUsedBytes)}, DOM ${graphicsPressure.rendererDomNodes ?? 'n/a'} nodes`,
    `- Visible lyrics/MV state: lyrics page ${graphicsPressure.lyricsPageVisible ? 'yes' : 'no'}, MV panel ${graphicsPressure.mvPanelVisible ? 'yes' : 'no'}, duplicate MV decode ${graphicsPressure.duplicateMvVideoDecode ? 'yes' : 'no'}`,
    `- Current reduction state: lyrics reduced ${visibleState.lyricsRenderPressureReduced === true ? 'yes' : 'no'}, MV reduced ${visibleState.mvRenderPressureReduced === true ? 'yes' : 'no'}`,
    `- Current heavy visuals: background ${visibleState.lyricsBackgroundMode ?? 'n/a'}, backdrop ${visibleState.lyricsBackdropVisible === true ? 'yes' : 'no'}, spectrum ${visibleState.lyricsSpectrumVisible === true ? 'yes' : 'no'}, glass ${visibleState.lyricsImmersiveCoverGlass === true ? 'yes' : 'no'}`,
    '- Inspect next: if the recommendation is present but both reduction flags are no, verify whether the renderer is subscribed to memory-pressure events and whether the General graphics guard is intended to gate emergency reduction.',
  );

  return lines;
};

const createMostLikelyNextInspectionsMarkdown = (snapshot: DiagnosticMemorySnapshot): string[] => {
  const lines = [
    '## Most Likely Next Inspections',
    '',
  ];
  const topProcess = snapshot.topProcesses[0] ?? snapshot.metrics[0] ?? null;
  const renderers = snapshot.rendererProcesses ?? [];
  const dominantRenderer = renderers.find((renderer) => renderer.pid === topProcess?.pid)
    ?? [...renderers].sort((left, right) =>
      (right.process?.privateBytes ?? right.process?.workingSetBytes ?? 0) -
      (left.process?.privateBytes ?? left.process?.workingSetBytes ?? 0),
    )[0]
    ?? null;
  const dominantPrivate = dominantRenderer?.process?.privateBytes ?? topProcess?.privateBytes ?? 0;
  const dominantHeap = dominantRenderer ? rendererHeapUsedBytes(dominantRenderer) : 0;
  const dominantDecoded = dominantRenderer?.images?.estimatedDecodedBytes ?? 0;
  const dominantNodes = dominantRenderer ? rendererNodeCount(dominantRenderer) : 0;
  const nativeGap = dominantRenderer ? rendererNativeGapBytes(dominantRenderer) : undefined;
  const graphicsPressure = createLyricsMvGraphicsPressureRecommendation(snapshot);
  const gpuProcess = (snapshot.metrics.length ? snapshot.metrics : snapshot.topProcesses).find((processMetric) =>
    processMetric.type.toLowerCase() === 'gpu' ||
    processMetric.serviceName?.toLowerCase().includes('gpu') === true ||
    processMetric.name?.toLowerCase().includes('gpu') === true,
  );
  const coverProtocol = snapshot.coverProtocol;
  const recentCoverRequests = coverProtocol?.recentRequests ?? [];
  const recentCoverUniqueResources = new Set(recentCoverRequests.map((request) => request.resourceHash ?? request.urlHash)).size;
  const lyricsSearch = snapshot.lyricsSearch;
  const slowLyricsSearches = lyricsSearch?.recentSearches.filter((event) => event.durationMs >= 3000) ?? [];
  const staleLyricsSearches = lyricsSearch?.recentSearches.filter((event) => event.stale) ?? [];
  const rows: Array<{ score: number; suspect: string; evidence: string; next: string }> = [];

  if (graphicsPressure || (gpuProcess && ((gpuProcess.privateBytes ?? 0) >= 1024 * 1024 * 1024))) {
    rows.push({
      score: 95,
      suspect: 'Lyrics/MV graphics or GPU resources',
      evidence: `graphics=${graphicsPressure?.reason ?? 'none'}, gpuPrivate=${formatBytes(gpuProcess?.privateBytes)}, rendererNativeGap=${formatBytes(nativeGap)}`,
      next: 'Check Graphics Pressure Recommendation, Renderer Pressure Ranking, visibleState reduction flags, CSS blur/will-change/media counts.',
    });
  }

  if (coverProtocol && (recentCoverRequests.length >= 80 || recentCoverUniqueResources >= 40 || coverProtocol.trackedUniqueResourceCount >= 200)) {
    rows.push({
      score: 90,
      suspect: 'Cover/image protocol churn or Chromium image cache',
      evidence: `recent=${recentCoverRequests.length}, recentUnique=${recentCoverUniqueResources}, trackedUnique=${coverProtocol.trackedUniqueResourceCount}, recentBytes=${formatBytes(coverProtocol.recentKnownBytesServed)}`,
      next: 'Check Cover/Image Hotspot Analysis for repeated resources, burst seconds, variants, and remote hosts.',
    });
  }

  if (dominantPrivate >= 1024 * 1024 * 1024 && dominantHeap < 256 * 1024 * 1024 && dominantDecoded < 256 * 1024 * 1024 && dominantNodes < 30_000) {
    rows.push({
      score: 85,
      suspect: 'Renderer native memory not explained by JS/DOM/image counters',
      evidence: `private=${formatBytes(dominantPrivate)}, heap=${formatBytes(dominantHeap)}, decoded=${formatBytes(dominantDecoded)}, nodes=${dominantNodes}, nativeGap=${formatBytes(nativeGap)}`,
      next: 'Check Renderer Pressure Ranking and GPU row; suspect compositor, video surfaces, resource cache, CSS effects, or counter gaps.',
    });
  }

  if (dominantHeap >= 512 * 1024 * 1024) {
    rows.push({
      score: 70,
      suspect: 'Renderer JavaScript heap retention',
      evidence: `heap=${formatBytes(dominantHeap)}`,
      next: 'Inspect retained React state, queues, lyric objects, library result caches, and heap snapshots if reproducible.',
    });
  }

  if (dominantNodes >= 50_000 || (dominantRenderer?.chromium?.domCounters?.jsEventListeners ?? 0) >= 10_000) {
    rows.push({
      score: 65,
      suspect: 'DOM or event-listener retention',
      evidence: `nodes=${dominantNodes}, listeners=${dominantRenderer?.chromium?.domCounters?.jsEventListeners ?? 'n/a'}`,
      next: 'Inspect Renderer Process Snapshots, selector counts, mounted hidden routes, lyrics lines/words, and virtualized rows.',
    });
  }

  if ((lyricsSearch?.activeSearchCount ?? 0) > 0 || slowLyricsSearches.length > 0 || staleLyricsSearches.length > 0) {
    rows.push({
      score: 60,
      suspect: 'Lyrics search overlap or stale background work',
      evidence: `active=${lyricsSearch?.activeSearchCount ?? 0}, slow=${slowLyricsSearches.length}, stale=${staleLyricsSearches.length}`,
      next: 'Check Lyrics Search Diagnostics for active queue, triggers, stale/canceled state, and candidate writes.',
    });
  }

  if (topProcess?.type === 'Browser' || memoryProcessLabel(topProcess).toLowerCase().includes('browser')) {
    rows.push({
      score: 55,
      suspect: 'Browser/main process native or cache pressure',
      evidence: `top=${memoryProcessLabel(topProcess)}, private=${formatBytes(topProcess?.privateBytes)}, mainRss=${formatBytes(snapshot.currentProcess.rssBytes)}`,
      next: 'Check Runtime Snapshots, Startup Timeline, Library Diagnostics, scanner/database work, and long-lived main caches.',
    });
  }

  if (rows.length === 0) {
    rows.push({
      score: 10,
      suspect: 'Unclassified pressure',
      evidence: 'No built-in suspect crossed current thresholds.',
      next: 'Compare Raw Memory Snapshot with Recent Memory Trend and add a new targeted counter for the outlier.',
    });
  }

  rows.sort((left, right) => right.score - left.score);
  lines.push(
    '| Priority | Suspect | Evidence | Next inspect |',
    '| - | - | - | - |',
  );
  rows.slice(0, 6).forEach((row, index) => {
    lines.push(`| ${[
      index + 1,
      cleanMarkdownTableCell(row.suspect),
      cleanMarkdownTableCell(row.evidence),
      cleanMarkdownTableCell(row.next),
    ].join(' | ')} |`);
  });

  return lines;
};

const createMemoryPressureSuspectMarkdown = (snapshot: DiagnosticMemorySnapshot): string[] => {
  const lines = [
    '## Automated Suspect Classification',
    '',
  ];
  const topProcess = snapshot.topProcesses[0] ?? snapshot.metrics[0] ?? null;
  const rendererSnapshots = snapshot.rendererProcesses ?? [];
  const matchedRenderer = rendererSnapshots.find((renderer) => renderer.pid === topProcess?.pid)
    ?? [...rendererSnapshots].sort((left, right) =>
      (right.process?.privateBytes ?? right.process?.workingSetBytes ?? 0) -
      (left.process?.privateBytes ?? left.process?.workingSetBytes ?? 0),
    )[0]
    ?? null;
  const rendererPrivate = matchedRenderer?.process?.privateBytes ?? topProcess?.privateBytes ?? 0;
  const rendererWorking = matchedRenderer?.process?.workingSetBytes ?? topProcess?.workingSetBytes ?? 0;
  const rendererHeap = Math.max(
    matchedRenderer?.heap?.usedJSHeapSize ?? 0,
    matchedRenderer?.chromium?.runtimeHeapUsage?.usedSize ?? 0,
    matchedRenderer?.chromium?.performanceMetrics?.JSHeapUsedSize ?? 0,
  );
  const rendererNodes = Math.max(
    matchedRenderer?.dom?.nodeCount ?? 0,
    matchedRenderer?.chromium?.domCounters?.nodes ?? 0,
    matchedRenderer?.chromium?.performanceMetrics?.Nodes ?? 0,
  );
  const rendererListeners = matchedRenderer?.chromium?.domCounters?.jsEventListeners ?? 0;
  const decodedImages = matchedRenderer?.images?.estimatedDecodedBytes ?? 0;
  const imageLifecycle = matchedRenderer?.images?.lifecycle;
  const backgroundUrls = matchedRenderer?.style?.backgroundUrlCount ?? 0;
  const graphicsPressure = createLyricsMvGraphicsPressureRecommendation(snapshot);
  const recentSearches = snapshot.lyricsSearch?.recentSearches ?? [];
  const slowLyricsSearches = recentSearches.filter((event) => event.durationMs >= 3000);
  const staleLyricsSearches = recentSearches.filter((event) => event.stale);
  const activeLyricsSearches = snapshot.lyricsSearch?.activeSearchCount ?? 0;
  const recentCandidateWrites = recentSearches.reduce((total, event) => total + event.result.storedCandidateWrites, 0);
  const coverProtocol = snapshot.coverProtocol;
  const gpuProcess = (snapshot.metrics.length ? snapshot.metrics : snapshot.topProcesses).find((processMetric) =>
    processMetric.type.toLowerCase() === 'gpu' ||
    processMetric.serviceName?.toLowerCase().includes('gpu') === true ||
    processMetric.name?.toLowerCase().includes('gpu') === true,
  );
  const recentCoverRequests = coverProtocol?.recentRequests ?? [];
  const recentCoverUniqueResources = new Set(
    recentCoverRequests.map((request) => request.resourceHash ?? request.urlHash),
  ).size;
  const recentCoverErrors = recentCoverRequests.filter((request) => request.outcome === 'error' || request.statusCode >= 400);
  const totalCoverImageRequests = (coverProtocol?.byScheme['echo-cover'] ?? 0) +
    (coverProtocol?.byScheme['echo-image'] ?? 0) +
    (coverProtocol?.byScheme['echo-artist-image'] ?? 0);
  const samples = snapshot.recentSamples ?? [];
  const firstSample = samples[0];
  const lastSample = samples.at(-1);
  const totalGrowth = firstSample && lastSample ? lastSample.totalWorkingSetBytes - firstSample.totalWorkingSetBytes : 0;
  const matchedProcessTrend = topProcess && firstSample && lastSample
    ? {
        first: firstSample.topProcesses.find((process) => process.pid === topProcess.pid),
        last: lastSample.topProcesses.find((process) => process.pid === topProcess.pid),
      }
    : null;
  const topProcessGrowth = matchedProcessTrend?.first && matchedProcessTrend.last
    ? matchedProcessTrend.last.workingSetBytes - matchedProcessTrend.first.workingSetBytes
    : 0;
  const evidence: string[] = [];
  const gib = 1024 * 1024 * 1024;
  const mib = 1024 * 1024;

  if (matchedRenderer) {
    evidence.push(`Dominant renderer route: ${matchedRenderer.route} (${matchedRenderer.windowKind}, pid ${matchedRenderer.pid ?? 'n/a'}).`);
  }

  if (rendererHeap >= 512 * mib) {
    evidence.push(`JS heap is high: ${formatBytes(rendererHeap)}. Suspect retained React state, lyrics objects, queues, or app-side caches.`);
  }

  if (rendererNodes >= 50_000 || rendererListeners >= 10_000) {
    evidence.push(`DOM/listener pressure is high: ${rendererNodes || 'n/a'} nodes, ${rendererListeners || 'n/a'} JS event listeners. Suspect repeated mounted views, lyrics lines/words, virtualized rows, or leaked listeners.`);
  }

  if (decodedImages >= 512 * mib || backgroundUrls >= 20) {
    evidence.push(`Decoded visual resource pressure is high: ${formatBytes(decodedImages)} estimated image decode, ${backgroundUrls} background-url elements. Suspect cover/background/wallpaper/spectrum visuals.`);
  }

  if (imageLifecycle && (imageLifecycle.mounted + imageLifecycle.unmounted >= 80 || imageLifecycle.srcChanged >= 30)) {
    evidence.push(`Recent img churn is high in the renderer: ${imageLifecycle.mounted} mounted, ${imageLifecycle.unmounted} unmounted, ${imageLifecycle.srcChanged} src changes in ${Math.round(imageLifecycle.recentWindowMs / 1000)}s. Suspect route/page cover walls, player artwork src flips, or hidden image retention.`);
  }

  if (activeLyricsSearches > 0 || slowLyricsSearches.length > 0 || staleLyricsSearches.length > 0) {
    evidence.push(`Lyrics search pressure is visible: ${activeLyricsSearches} active, ${slowLyricsSearches.length} recent >=3s, ${staleLyricsSearches.length} stale. Suspect uncanceled or overlapping search-candidates work.`);
  }

  if (recentCandidateWrites >= 100) {
    evidence.push(`Lyrics candidate writes are high in the retained window: ${recentCandidateWrites}. Suspect candidate-table churn or provider result explosion.`);
  }

  if (
    coverProtocol &&
    (
      coverProtocol.activeRequestCount > 0 ||
      recentCoverRequests.length >= 80 ||
      recentCoverUniqueResources >= 40 ||
      coverProtocol.recentKnownBytesServed >= 256 * mib ||
      coverProtocol.totalKnownBytesServed >= gib ||
      recentCoverErrors.length >= 20
    )
  ) {
    evidence.push(`Cover/image protocol pressure is visible: ${coverProtocol.activeRequestCount} active, ${recentCoverRequests.length} recent, ${recentCoverUniqueResources} recent unique resources, ${formatBytes(coverProtocol.recentKnownBytesServed)} recent known bytes, ${recentCoverErrors.length} recent errors. Suspect cover/image decode or Chromium resource cache pressure.`);
  }

  if (coverProtocol && totalCoverImageRequests >= 500 && coverProtocol.trackedUniqueResourceCount >= 200) {
    evidence.push(`Cover/image protocol has high cumulative churn: ${totalCoverImageRequests} cover/image requests and ${coverProtocol.trackedUniqueResourceCount} tracked unique resources since start.`);
  }

  if (totalGrowth >= 512 * mib) {
    evidence.push(`Recent total memory trend grew by ${formatBytes(totalGrowth)} before the report.`);
  }

  if (topProcessGrowth >= 512 * mib) {
    evidence.push(`Largest process grew by ${formatBytes(topProcessGrowth)} in retained samples, matching pid ${topProcess?.pid ?? 'n/a'}.`);
  }

  if (
    rendererPrivate >= gib &&
    rendererHeap < 256 * mib &&
    decodedImages < 256 * mib &&
    rendererNodes < 30_000
  ) {
    evidence.push(`Renderer private memory is high (${formatBytes(rendererPrivate)}) but JS heap, DOM, and decoded-image counters are not. Suspect Chromium native allocations, GPU/CSS effects, media buffers, WASM/native modules, or a counter gap.`);
  }

  if (gpuProcess && ((gpuProcess.privateBytes ?? 0) >= gib || gpuProcess.workingSetBytes >= 512 * mib)) {
    evidence.push(`GPU process memory is high: ${formatBytes(gpuProcess.workingSetBytes)} working, ${formatBytes(gpuProcess.privateBytes)} private. Suspect compositor textures, image decode/cache, CSS effects, video surfaces, or GPU resource release lag.`);
  }

  if (graphicsPressure?.duplicateMvVideoDecode) {
    evidence.push('Duplicate MV video decode pressure is visible: foreground MV media and immersive background MV media are mounted together while renderer native memory is high.');
  } else if (graphicsPressure) {
    evidence.push('Lyrics/MV graphics pressure is visible while renderer native memory is high. If the General graphics memory guard is enabled, the renderer can reduce lyrics/MV graphics for the current session.');
  }

  if (evidence.length === 0) {
    evidence.push('No single category crossed the built-in thresholds; compare Raw Memory Snapshot, Renderer Process Snapshots, and Recent Memory Trend for the outlier.');
  }

  lines.push(
    `- Largest process: ${memoryProcessLabel(topProcess)} (${formatBytes(topProcess?.workingSetBytes)} working, ${formatBytes(topProcess?.privateBytes)} private).`,
    ...(matchedRenderer && matchedRenderer.pid !== topProcess?.pid
      ? [`- Dominant renderer sample: ${matchedRenderer.route} (${matchedRenderer.windowKind}, pid ${matchedRenderer.pid ?? 'n/a'}, ${formatBytes(rendererWorking)} working, ${formatBytes(rendererPrivate)} private).`]
      : []),
    ...evidence.map((item) => `- ${item}`),
  );

  return lines;
};

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

  if (
    /did not return a playable URL|metadata only|requires the official .* player|must not enter the native audio session/iu.test(message) ||
    /(?:会员|會員|版权|版權|不可播放|无播放权限|無播放權限|permission|unavailable)/iu.test(message)
  ) {
    return 'streaming_playback_unavailable';
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
  const hasSharedFailure = modes.includes('shared') || records.some((record) => /mode="shared"|WASAPI|Windows Audio/u.test(record.message));
  const hasFallbackSignals = warningSet.some((warning) => /fell_back|fallback|recovered|safe_mode|default_device|temporarily_unavailable/iu.test(warning));
  const hasDsdPcm = warningSet.some((warning) => warning.startsWith('dsd_source_decoded_to_pcm'));
  const likelySingleIncident = records.length > 1 && hasFallbackSignals;

  lines.push(
    `- Likely one chained incident: ${likelySingleIncident ? 'yes' : 'unknown'}`,
    `- Failure classes observed: ${failureClasses.join(', ') || 'n/a'}`,
    `- Output modes involved: ${modes.join(', ') || 'n/a'}`,
    `- Devices involved: ${devices.map((device) => truncateText(device, 72)).join(' | ') || 'n/a'}`,
    `- Requested/actual rate transitions: ${rates.join(', ') || 'n/a'}`,
    `- Recovery/fallback signals: ${warningSet.filter((warning) => /fell_back|fallback|recovered|safe_mode|default_device|skipped_same_device|temporarily_unavailable/iu.test(warning)).join(', ') || 'n/a'}`,
  );

  if (hasDsdPcm) {
    lines.push('- DSD source was decoded to high-rate PCM in at least one event.');
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

  if (message.includes('timeout_waiting_for_ready')) {
    lines.push(
      '- Direct cause: the native audio host was launched, but it did not send its ready event before the timeout.',
      '- Most likely reasons: the WASAPI driver was slow or stuck during initialization, the device was busy in another app, the requested sample rate or buffer size was rejected slowly, or the driver needed more time while closing a previous stream.',
      '- What to try: close other audio apps, try a larger buffer, switch to Shared once and back to Exclusive, unplug/replug the interface, or choose another sample rate supported by the driver.',
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
  private lastMemoryPressureSnapshot: DiagnosticMemorySnapshot | null = null;

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

  getCrashReportTextFilePath(sessionDir = this.sessionDir): string {
    return sessionDir ? join(sessionDir, 'crash-report.txt') : join(this.getCrashReportsRoot(), 'crash-report.txt');
  }

  getAudioCrashReportFilePath(sessionDir = this.sessionDir): string {
    return sessionDir ? join(sessionDir, 'audio-crash-report.md') : join(this.getCrashReportsRoot(), 'audio-crash-report.md');
  }

  getAudioCrashReportTextFilePath(sessionDir = this.sessionDir): string {
    return sessionDir ? join(sessionDir, 'audio-crash-report.txt') : join(this.getCrashReportsRoot(), 'audio-crash-report.txt');
  }

  getMemoryPressureReportFilePath(sessionDir = this.sessionDir): string {
    return sessionDir ? join(sessionDir, 'memory-pressure-report.md') : join(this.getCrashReportsRoot(), 'memory-pressure-report.md');
  }

  getMemoryPressureSnapshotFilePath(sessionDir = this.sessionDir): string {
    return sessionDir ? join(sessionDir, 'memory-pressure.latest.json') : join(this.getCrashReportsRoot(), 'memory-pressure.latest.json');
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

  async openCrashReportTextFile(options: { preferLastAbnormal?: boolean } = {}): Promise<string> {
    const reportPath = this.writeCrashReportTextFile(undefined, { preferLastAbnormal: options.preferLastAbnormal ?? false });
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

  async openAudioCrashReportTextFile(): Promise<string> {
    const reportPath = this.writeAudioCrashReportTextFile();
    const result = await shell.openPath(reportPath);
    if (result) {
      throw new Error(result);
    }
    return reportPath;
  }

  async openMemoryPressureReportFile(): Promise<string> {
    const reportPath = this.writeMemoryPressureReportFile();
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

  reportMemoryPressure(snapshot: DiagnosticMemorySnapshot): DiagnosticMemoryPressureEvent {
    const reportPath = this.writeMemoryPressureReportFile(snapshot);
    const topProcess = snapshot.topProcesses[0] ?? snapshot.metrics[0] ?? null;
    const graphicsPressure = createLyricsMvGraphicsPressureRecommendation(snapshot);
    this.logger?.warn('main', 'memory pressure threshold crossed', {
      totalWorkingSetBytes: snapshot.totalWorkingSetBytes,
      thresholdBytes: snapshot.thresholdBytes,
      processCount: snapshot.processCount,
      topProcess: topProcess
        ? {
            pid: topProcess.pid,
            type: topProcess.type,
            name: topProcess.name,
            serviceName: topProcess.serviceName,
            workingSetBytes: topProcess.workingSetBytes,
            privateBytes: topProcess.privateBytes,
          }
        : null,
      reportPath,
    });
    recordDiagnosticException({
      source: 'main',
      severity: 'error',
      type: 'memory-pressure',
      message: `ECHO memory reached ${formatBytes(snapshot.totalWorkingSetBytes)}`,
      details: {
        thresholdBytes: snapshot.thresholdBytes,
        processCount: snapshot.processCount,
        topProcess: topProcess ? memoryProcessLabel(topProcess) : 'unknown',
        reportFile: basename(reportPath),
      },
      timestamp: snapshot.timestamp,
    });

    return {
      timestamp: snapshot.timestamp,
      thresholdBytes: snapshot.thresholdBytes,
      totalWorkingSetBytes: snapshot.totalWorkingSetBytes,
      totalPrivateBytes: snapshot.totalPrivateBytes,
      processCount: snapshot.processCount,
      topProcessType: topProcess ? memoryProcessLabel(topProcess) : 'unknown',
      topProcessWorkingSetBytes: topProcess?.workingSetBytes ?? 0,
      reportPath,
      graphicsPressure,
    };
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

  private writeCrashReportTextFile(
    record?: CrashRecord | null,
    options: { preferLastAbnormal?: boolean; sessionDir?: string | null } = {},
  ): string {
    const targetSessionDir = options.sessionDir ?? this.resolveCrashReportSessionDir(options.preferLastAbnormal ?? false);
    const reportPath = this.getCrashReportTextFilePath(targetSessionDir);
    mkdirSync(targetSessionDir ?? this.getCrashReportsRoot(), { recursive: true });
    const crashRecord = record ?? (targetSessionDir ? readJson<CrashRecord>(join(targetSessionDir, 'crash.json')) : null);
    const markdown = this.createCrashReportMarkdown(crashRecord, { reportPath, sessionDir: targetSessionDir });
    writeFileSync(reportPath, markdownReportToText(markdown));
    return reportPath;
  }

  private writeAudioCrashReportFile(record?: AudioCrashRecord | null, sessionDir = this.sessionDir): string {
    const reportPath = this.getAudioCrashReportFilePath(sessionDir);
    mkdirSync(sessionDir ?? this.getCrashReportsRoot(), { recursive: true });
    const audioRecord = record ?? (sessionDir ? readJson<AudioCrashRecord>(join(sessionDir, 'audio-crash.latest.json')) : null);
    writeFileSync(reportPath, this.createAudioCrashReportMarkdown(audioRecord, { reportPath, sessionDir }));
    return reportPath;
  }

  private writeAudioCrashReportTextFile(record?: AudioCrashRecord | null, sessionDir = this.sessionDir): string {
    const reportPath = this.getAudioCrashReportTextFilePath(sessionDir);
    mkdirSync(sessionDir ?? this.getCrashReportsRoot(), { recursive: true });
    const audioRecord = record ?? (sessionDir ? readJson<AudioCrashRecord>(join(sessionDir, 'audio-crash.latest.json')) : null);
    const markdown = this.createAudioCrashReportMarkdown(audioRecord, { reportPath, sessionDir });
    writeFileSync(reportPath, markdownReportToText(markdown));
    return reportPath;
  }

  private writeMemoryPressureReportFile(snapshot = this.readLatestMemoryPressureSnapshot(), sessionDir = this.sessionDir): string {
    if (!snapshot) {
      throw new Error('No memory pressure report has been generated yet.');
    }

    const targetDir = sessionDir ?? this.getCrashReportsRoot();
    mkdirSync(targetDir, { recursive: true });
    const safeSnapshot = sanitizeMemoryPressureSnapshot(snapshot);
    const snapshotPath = this.getMemoryPressureSnapshotFilePath(sessionDir);
    const reportPath = this.getMemoryPressureReportFilePath(sessionDir);
    writeJson(snapshotPath, sanitizeLogPayload(safeSnapshot));
    this.lastMemoryPressureSnapshot = safeSnapshot;
    writeFileSync(reportPath, this.createMemoryPressureReportMarkdown(safeSnapshot, { reportPath, sessionDir }));
    return reportPath;
  }

  private readLatestMemoryPressureSnapshot(sessionDir = this.sessionDir): DiagnosticMemorySnapshot | null {
    return this.lastMemoryPressureSnapshot ?? readJson<DiagnosticMemorySnapshot>(this.getMemoryPressureSnapshotFilePath(sessionDir));
  }

  private createMemoryPressureReportMarkdown(
    snapshot: DiagnosticMemorySnapshot,
    options: { reportPath: string; sessionDir: string | null },
  ): string {
    const topProcess = snapshot.topProcesses[0] ?? snapshot.metrics[0] ?? null;
    const mainMemory = snapshot.currentProcess;
    const lines = [
      '# ECHO Next Memory Pressure Report',
      '',
      `Generated: ${nowIso()}`,
      `Report file: ${basename(options.reportPath)}`,
      aiReportReviewTip,
      '',
      '## Summary',
      '',
      `- Triggered at: ${snapshot.timestamp}`,
      `- Threshold: ${formatBytes(snapshot.thresholdBytes)}`,
      `- Total working set: ${formatBytes(snapshot.totalWorkingSetBytes)}`,
      `- Total private bytes: ${formatBytes(snapshot.totalPrivateBytes)}`,
      `- Process count: ${snapshot.processCount}`,
      `- Metrics source: ${snapshot.source}`,
      `- Largest process: ${memoryProcessLabel(topProcess)} (${formatBytes(topProcess?.workingSetBytes)})`,
      '',
      '## What To Inspect First',
      '',
      '- If one renderer or utility process dominates the table, inspect the route or background job active near the timestamp.',
      '- If the largest process is Tab, inspect Renderer Process Snapshots for route, DOM nodes, decoded image pressure, heap estimate, and visible lyrics/background/spectrum state.',
      '- If Automated Suspect Classification names a category, inspect that section first before chasing lower-signal logs.',
      '- If renderer private memory is high but JS heap is low, inspect Cover/Image Protocol Diagnostics for image churn, unique resources, and repeated resource hashes.',
      '- If lyrics search is slow nearby, inspect Lyrics Search Diagnostics for active queue size, stale searches, candidate-cache hits, and writes.',
      '- If Browser/main process memory dominates, inspect startup, database, scanner, logging, and long-lived caches.',
      '- If the total is high but private bytes are much lower, some usage may be shared Chromium/Electron memory rather than leaked app-owned objects.',
      '',
      '## Main Process Memory',
      '',
      `- PID: ${mainMemory.pid}`,
      `- RSS: ${formatBytes(mainMemory.rssBytes)}`,
      `- Heap used: ${formatBytes(mainMemory.heapUsedBytes)} / ${formatBytes(mainMemory.heapTotalBytes)}`,
      `- External: ${formatBytes(mainMemory.externalBytes)}`,
      `- Array buffers: ${formatBytes(mainMemory.arrayBuffersBytes)}`,
      '',
      ...createMemoryPressureSuspectMarkdown(snapshot),
      '',
      ...createSuddenMemorySpikeEventsMarkdown(snapshot),
      '',
      ...createMostLikelyNextInspectionsMarkdown(snapshot),
      '',
      ...createGraphicsPressureRecommendationMarkdown(snapshot),
      '',
      ...createMemoryTrendMarkdown(snapshot.recentSamples),
      '',
      '## Top App Processes',
      '',
      ...createMemoryProcessTableMarkdown(snapshot.topProcesses),
      '',
      '## All Process Metrics',
      '',
      ...createMemoryProcessTableMarkdown(snapshot.metrics),
      '',
      ...createRendererSnapshotSummaryMarkdown(snapshot.rendererProcesses),
      '',
      ...createCoverProtocolDiagnosticsMarkdown(snapshot.coverProtocol),
      '',
      ...createLyricsSearchDiagnosticsMarkdown(snapshot.lyricsSearch),
      '',
      '## Runtime Snapshots',
      '',
      '### Playback',
      '',
      formatJsonBlock(this.getSafePlaybackStatus()),
      '',
      '### Audio',
      '',
      formatJsonBlock(this.getSafeAudioStatus()),
      '',
      '### Library Diagnostics',
      '',
      formatJsonBlock(this.getSafeLibraryDiagnostics()),
      '',
      '### Startup Timeline',
      '',
      formatJsonBlock(getStartupTimelineSnapshot()),
      '',
      '### Exception Summary',
      '',
      formatJsonBlock(getExceptionSummarySnapshot()),
      '',
      '## Raw Memory Snapshot',
      '',
      formatJsonBlock(snapshot),
      '',
      '## Recent Logs',
      '',
      this.createLogTailMarkdown(['main.log', 'renderer.log', 'library.log', 'audio.log', 'crash.log'], options.sessionDir),
      '',
      '## Privacy',
      '',
      'This report is generated locally. It stores process memory counters, safe diagnostics snapshots, and recent local logs. Music files, cover binaries, lyric contents, tokens, cookies, and authentication secrets are not included.',
      '',
    ];

    return `${lines.join('\n')}\n`;
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
      aiReportReviewTip,
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
      aiReportReviewTip,
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

    if (this.sessionDir && existsSync(this.getMemoryPressureSnapshotFilePath())) {
      return this.writeMemoryPressureReportFile();
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
      'memory-pressure.latest.json',
      'crash-report.md',
      'audio-crash-report.md',
      'memory-pressure-report.md',
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
    if (previousSession.shutdownRequestedAt && !existsSync(join(previousSessionDir, 'crash.json'))) {
      const closedSession: CrashSessionInfo = {
        ...previousSession,
        status: 'closed',
        endedAt: detectedAt,
      };
      writeJson(sessionFilePath, closedSession);
      return;
    }

    const abnormalSession: CrashSessionInfo = {
      ...previousSession,
      status: 'abnormalExit',
      endedAt: detectedAt,
    };
    writeJson(sessionFilePath, abnormalSession);

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
