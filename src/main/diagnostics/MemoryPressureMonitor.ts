import { app, BrowserWindow } from 'electron';
import type { ProcessMetric } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type {
  DiagnosticMemoryTrendSample,
  DiagnosticMemoryPressureEvent,
  DiagnosticMemoryProcessMetric,
  DiagnosticMemorySnapshot,
  DiagnosticRendererMemorySnapshot,
} from '../../shared/types/diagnostics';
import { getCrashReportService } from './CrashReportService';
import { getCoverProtocolDiagnosticsSnapshot } from './CoverProtocolDiagnostics';
import { getLyricsSearchDiagnosticsSnapshot } from './LyricsSearchDiagnostics';
import { hashText } from './Logger';
import { createSoftMemoryCleanupLogFields, releaseSoftMemoryPressure } from './SoftMemoryJanitor';

export const memoryPressureThresholdBytes = 3 * 1024 * 1024 * 1024;
export const softMemoryPressureThresholdBytes = Math.floor(memoryPressureThresholdBytes * 0.8);

const defaultCheckIntervalMs = 30_000;
const initialCheckDelayMs = 10_000;
const topProcessLimit = 15;
const rendererProbeTimeoutMs = 1500;
const memoryTrendSampleLimit = 40;
const softMemoryPressureRequiredSamples = 2;
const mib = 1024 * 1024;
const gib = 1024 * mib;

type MemoryPressureConsoleSummary = {
  threshold: string;
  totalWorkingSet: string;
  totalPrivate?: string;
  topProcess: {
    pid?: number;
    type: string;
    workingSet: string;
    private?: string;
  };
  dominantRenderer?: {
    pid?: number;
    route: string;
    windowKind: string;
    workingSet?: string;
    private?: string;
    heap?: string;
    nodes?: number;
    decodedImages?: string;
  };
  likelyCause: string;
  evidence: string[];
  reportPath?: string;
};

let checkTimer: NodeJS.Timeout | null = null;
let initialCheckTimer: NodeJS.Timeout | null = null;
let hasReportedMemoryPressure = false;
let isCheckingMemoryPressure = false;
const recentMemoryTrendSamples: DiagnosticMemoryTrendSample[] = [];

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const formatBytes = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 'n/a';
  }

  if (value >= gib) {
    return `${(value / gib).toFixed(2)} GiB`;
  }

  if (value >= mib) {
    return `${(value / mib).toFixed(1)} MiB`;
  }

  return `${Math.round(value / 1024)} KiB`;
};

const kibToBytes = (value: unknown): number => {
  const number = finiteNumber(value);
  return number === null ? 0 : Math.max(0, Math.round(number * 1024));
};

const currentProcessMemorySnapshot = (usage = process.memoryUsage()): DiagnosticMemorySnapshot['currentProcess'] => ({
  pid: process.pid,
  rssBytes: usage.rss,
  heapTotalBytes: usage.heapTotal,
  heapUsedBytes: usage.heapUsed,
  externalBytes: usage.external,
  arrayBuffersBytes: usage.arrayBuffers,
});

const rendererMemoryProbeScript = `
(async () => {
  const count = (selector) => document.querySelectorAll(selector).length;
  const exists = (selector) => document.querySelector(selector) !== null;
  const srcKind = (value) => {
    if (!value) return 'empty';
    if (value.startsWith('echo-cover://')) return 'echo-cover';
    if (value.startsWith('echo-image://')) return 'echo-image';
    if (value.startsWith('echo-artist-image://')) return 'echo-artist-image';
    if (value.startsWith('data:')) return 'data';
    if (/^https?:\\/\\//i.test(value)) return 'remote';
    return 'other';
  };
  const increment = (record, key, by = 1) => {
    const normalized = key || 'unknown';
    record[normalized] = (record[normalized] || 0) + by;
  };
  const routePath = location.protocol === 'data:'
    ? 'data-url'
    : location.pathname.split('/').filter(Boolean).pop() || location.pathname || '/';
  const locationRoute = location.protocol === 'data:'
    ? routePath
    : \`\${routePath}\${location.search || ''}\${location.hash || ''}\`;
  const heap = performance && performance.memory
    ? {
        usedJSHeapSize: Number(performance.memory.usedJSHeapSize) || 0,
        totalJSHeapSize: Number(performance.memory.totalJSHeapSize) || 0,
        jsHeapSizeLimit: Number(performance.memory.jsHeapSizeLimit) || 0,
      }
    : undefined;
  const images = Array.from(document.images || []);
  const imageSource = (image) => image.currentSrc || image.src || '';
  const imageDecodedBytes = (image) => {
    const width = Number(image.naturalWidth) || 0;
    const height = Number(image.naturalHeight) || 0;
    return Math.max(0, width * height * 4);
  };
  const estimatedDecodedBytes = images.reduce((total, image) => total + imageDecodedBytes(image), 0);
  const largestImages = images
    .map((image) => ({
      srcKind: srcKind(imageSource(image)),
      naturalWidth: Number(image.naturalWidth) || 0,
      naturalHeight: Number(image.naturalHeight) || 0,
      decodedBytes: imageDecodedBytes(image),
      className: typeof image.className === 'string' && image.className ? image.className.slice(0, 80) : undefined,
    }))
    .sort((left, right) => right.decodedBytes - left.decodedBytes)
    .slice(0, 12);
  const textWalker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT);
  let textNodeCount = 0;
  while (textNodeCount < 200000 && textWalker.nextNode()) {
    textNodeCount += 1;
  }
  let storageEstimate;
  try {
    storageEstimate = navigator.storage && navigator.storage.estimate
      ? await navigator.storage.estimate()
      : undefined;
  } catch {
    storageEstimate = undefined;
  }
  const resourceEntries = typeof performance.getEntriesByType === 'function'
    ? performance.getEntriesByType('resource')
    : [];
  const resourceSummary = {
    totalResourceEntries: resourceEntries.length,
    totalTransferSize: 0,
    totalDecodedBodySize: 0,
    byInitiatorType: {},
    byProtocol: {},
  };
  for (const entry of resourceEntries.slice(-5000)) {
    increment(resourceSummary.byInitiatorType, entry.initiatorType || entry.entryType || 'unknown');
    try {
      const protocol = new URL(entry.name).protocol.replace(':', '') || 'unknown';
      increment(resourceSummary.byProtocol, protocol);
    } catch {
      increment(resourceSummary.byProtocol, srcKind(entry.name));
    }
    resourceSummary.totalTransferSize += Number(entry.transferSize) || 0;
    resourceSummary.totalDecodedBodySize += Number(entry.decodedBodySize) || 0;
  }
  const styleSummary = {
    backgroundUrlCount: 0,
    echoCoverBackgroundCount: 0,
    echoImageBackgroundCount: 0,
    dataBackgroundCount: 0,
    remoteBackgroundCount: 0,
    blurFilterElementCount: 0,
    willChangeElementCount: 0,
    fixedOrStickyElementCount: 0,
  };
  const styledElements = Array.from(document.querySelectorAll('*')).slice(0, 20000);
  for (const element of styledElements) {
    const style = getComputedStyle(element);
    const backgroundImage = style.backgroundImage || '';
    if (backgroundImage.includes('url(')) {
      styleSummary.backgroundUrlCount += 1;
      if (backgroundImage.includes('echo-cover://')) styleSummary.echoCoverBackgroundCount += 1;
      if (backgroundImage.includes('echo-image://')) styleSummary.echoImageBackgroundCount += 1;
      if (backgroundImage.includes('data:')) styleSummary.dataBackgroundCount += 1;
      if (/https?:\\/\\//i.test(backgroundImage)) styleSummary.remoteBackgroundCount += 1;
    }
    if (style.filter && style.filter !== 'none' && /blur\\(/i.test(style.filter)) {
      styleSummary.blurFilterElementCount += 1;
    }
    if (style.willChange && style.willChange !== 'auto') {
      styleSummary.willChangeElementCount += 1;
    }
    if (style.position === 'fixed' || style.position === 'sticky') {
      styleSummary.fixedOrStickyElementCount += 1;
    }
  }
  const lyricsPage = document.querySelector('.lyrics-page');
  const desktopLyrics = document.querySelector('.desktop-lyrics-app');
  const routeElements = Array.from(document.querySelectorAll('[data-route-id]'));
  const visibleRouteElements = routeElements.filter((element) => !element.hasAttribute('hidden'));
  const activeRouteElement = visibleRouteElements[0] || null;
  const activeRouteId = activeRouteElement?.getAttribute('data-route-id') || null;
  const settingsSection = document.querySelector('[data-settings-section][data-active="true"], .settings-section.is-active');
  const interactionDiagnostics = window.__echoMemoryInteractionDiagnostics?.snapshot?.();
  const playbackQueueDiagnostics = window.__echoPlaybackQueueDiagnostics?.snapshot?.();
  const routeDetail = {
    locationRoute,
    reactRouteId: interactionDiagnostics?.routeId || activeRouteId,
    pageMode: interactionDiagnostics?.pageMode || (lyricsPage ? \`lyrics:\${lyricsPage.getAttribute('data-view-mode') || 'unknown'}\` : null),
    activeRouteId,
    activeRouteHidden: activeRouteElement ? activeRouteElement.hasAttribute('hidden') : null,
    visibleRouteIds: visibleRouteElements.slice(0, 12).map((element) => element.getAttribute('data-route-id')).filter(Boolean),
    lyricsViewMode: lyricsPage ? lyricsPage.getAttribute('data-view-mode') : null,
    settingsSection: settingsSection?.getAttribute('data-settings-section') || null,
  };
  const videos = Array.from(document.querySelectorAll('video'));
  const youtubeFrames = Array.from(document.querySelectorAll('iframe.lyrics-mv-video--youtube, iframe.lyrics-mv-background-video--youtube'));
  const videoSource = (video) => video.currentSrc || video.src || video.getAttribute('src') || '';
  const videoDetails = videos.slice(0, 12).map((video) => ({
    className: typeof video.className === 'string' && video.className ? video.className.slice(0, 120) : undefined,
    srcKind: srcKind(videoSource(video)),
    videoWidth: Number(video.videoWidth) || 0,
    videoHeight: Number(video.videoHeight) || 0,
    readyState: Number(video.readyState) || 0,
    paused: Boolean(video.paused),
    muted: Boolean(video.muted),
    loop: Boolean(video.loop),
    preload: video.preload || '',
  }));
  const selectorCounts = {
    appShell: count('.app-shell'),
    lyricsPage: count('.lyrics-page'),
    lyricsLines: count('.lyrics-line'),
    lyricWordNodes: count('.lyrics-word'),
    desktopLyricsApp: count('.desktop-lyrics-app'),
    desktopLyricsLineNodes: count('.desktop-lyrics-line-text span'),
    lyricsSettingsDrawer: count('.lyrics-settings-drawer:not(.lyrics-visual-settings-drawer)'),
    lyricsVisualSettingsDrawer: count('.lyrics-visual-settings-drawer'),
    lyricsMusicReactiveSpectrum: count('.lyrics-music-reactive-spectrum'),
    lyricsBackdrop: count('.lyrics-backdrop, .lyrics-backdrop-previous-cover'),
    playerCoverImages: count('.player-cover img, .lyrics-track-cover img, .track-cover img'),
    virtualizedRows: count('[data-index], [data-virtual-index]'),
  };

  return {
    route: routeDetail.reactRouteId || routeDetail.pageMode || locationRoute,
    routeDetail,
    title: document.title || undefined,
    heap,
    dom: {
      nodeCount: document.getElementsByTagName('*').length + textNodeCount + 1,
      elementCount: document.getElementsByTagName('*').length,
      textNodeCount,
      documentWidth: Math.max(document.documentElement?.scrollWidth || 0, document.body?.scrollWidth || 0),
      documentHeight: Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0),
    },
    images: {
      imageElementCount: images.length,
      loadedImageCount: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      brokenImageCount: images.filter((image) => image.complete && image.naturalWidth === 0).length,
      echoCoverImageCount: images.filter((image) => imageSource(image).startsWith('echo-cover://')).length,
      echoImageProtocolImageCount: images.filter((image) => imageSource(image).startsWith('echo-image://')).length,
      dataImageCount: images.filter((image) => imageSource(image).startsWith('data:')).length,
      remoteImageCount: images.filter((image) => /^https?:\\/\\//i.test(imageSource(image))).length,
      estimatedDecodedBytes,
      largestImages,
      lifecycle: interactionDiagnostics?.imageLifecycle,
    },
    media: {
      canvasCount: document.querySelectorAll('canvas').length,
      videoCount: videos.length,
      audioCount: document.querySelectorAll('audio').length,
      youtubeFrameCount: youtubeFrames.length,
      videoDetails,
    },
    resources: resourceSummary,
    style: styleSummary,
    selectors: selectorCounts,
    appState: {
      playbackQueue: playbackQueueDiagnostics,
    },
    visibleState: {
      currentReactRoute: routeDetail.reactRouteId,
      currentPageMode: routeDetail.pageMode,
      lyricsPageVisible: Boolean(lyricsPage),
      lyricsViewMode: lyricsPage ? lyricsPage.getAttribute('data-view-mode') : null,
      lyricsBackgroundMode: lyricsPage ? lyricsPage.getAttribute('data-background') : null,
      lyricsRenderPressureReduced: lyricsPage?.getAttribute('data-render-pressure-reduced') === 'true',
      lyricsImmersiveCoverStyle: lyricsPage?.getAttribute('data-immersive-cover-style') === 'true',
      lyricsImmersiveCoverGlass: lyricsPage?.getAttribute('data-immersive-cover-glass') === 'true',
      lyricsSpectrumVisible: exists('.lyrics-music-reactive-spectrum'),
      lyricsBackdropVisible: exists('.lyrics-backdrop'),
      lyricsPreviousBackdropVisible: exists('.lyrics-backdrop-previous-cover'),
      lyricsSettingsDrawerVisible: exists('.lyrics-settings-drawer:not(.lyrics-visual-settings-drawer)'),
      lyricsVisualSettingsDrawerVisible: exists('.lyrics-visual-settings-drawer'),
      desktopLyricsVisible: Boolean(desktopLyrics),
      desktopLyricsMusicReactive: desktopLyrics ? desktopLyrics.getAttribute('data-music-reactive') : null,
      desktopLyricsTextDirection: desktopLyrics ? desktopLyrics.getAttribute('data-text-direction') : null,
      playerCoverVisible: exists('.player-cover img, .lyrics-track-cover img'),
      miniPlayerVisible: exists('.mini-player-shell, .lyrics-mini-player'),
      mvPanelVisible: exists('.lyrics-mv-panel'),
      mvImmersiveActive: document.querySelector('.lyrics-mv-panel')?.getAttribute('data-immersive-active') === 'true',
      mvRenderPressureReduced: document.querySelector('.lyrics-mv-panel')?.getAttribute('data-render-pressure-reduced') === 'true',
      mvForegroundVideoCount: count('video.lyrics-mv-video'),
      mvBackgroundVideoCount: count('video.lyrics-mv-background-video'),
      mvForegroundYoutubeFrameCount: count('iframe.lyrics-mv-video--youtube'),
      mvBackgroundYoutubeFrameCount: count('iframe.lyrics-mv-background-video--youtube'),
    },
    storageEstimate: storageEstimate
      ? {
          usage: Number(storageEstimate.usage) || 0,
          quota: Number(storageEstimate.quota) || 0,
        }
      : undefined,
    userActions: interactionDiagnostics
      ? {
          recentWindowMs: interactionDiagnostics.recentWindowMs,
          counts: interactionDiagnostics.userActions.counts,
          recent: interactionDiagnostics.userActions.recent,
        }
      : undefined,
  };
})()
`;

const createMemoryTrendSample = (snapshot: DiagnosticMemorySnapshot): DiagnosticMemoryTrendSample => ({
  timestamp: snapshot.timestamp,
  totalWorkingSetBytes: snapshot.totalWorkingSetBytes,
  totalPrivateBytes: snapshot.totalPrivateBytes,
  topProcesses: snapshot.topProcesses.slice(0, 8).map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    name: metric.name,
    serviceName: metric.serviceName,
    workingSetBytes: metric.workingSetBytes,
    privateBytes: metric.privateBytes,
    cpuPercent: metric.cpuPercent,
  })),
});

const recordMemoryTrendSample = (snapshot: DiagnosticMemorySnapshot): void => {
  recentMemoryTrendSamples.push(createMemoryTrendSample(snapshot));
  if (recentMemoryTrendSamples.length > memoryTrendSampleLimit) {
    recentMemoryTrendSamples.splice(0, recentMemoryTrendSamples.length - memoryTrendSampleLimit);
  }
};

const getRecentMemoryTrendSamples = (): DiagnosticMemoryTrendSample[] =>
  recentMemoryTrendSamples.map((sample) => ({
    ...sample,
    topProcesses: sample.topProcesses.map((process) => ({ ...process })),
  }));

const normalizeProcessMetric = (metric: ProcessMetric): DiagnosticMemoryProcessMetric => ({
  pid: metric.pid,
  type: metric.type,
  name: metric.name,
  serviceName: metric.serviceName,
  sandboxed: metric.sandboxed,
  creationTime: metric.creationTime,
  workingSetBytes: kibToBytes(metric.memory?.workingSetSize),
  peakWorkingSetBytes: kibToBytes(metric.memory?.peakWorkingSetSize),
  privateBytes: metric.memory?.privateBytes === undefined ? undefined : kibToBytes(metric.memory.privateBytes),
  cpuPercent: finiteNumber(metric.cpu?.percentCPUUsage) ?? undefined,
});

export const createDiagnosticMemorySnapshot = (
  metrics: ProcessMetric[],
  options: {
    appVersion?: string;
    arch?: string;
    currentProcessMemory?: NodeJS.MemoryUsage;
    coverProtocol?: DiagnosticMemorySnapshot['coverProtocol'];
    lyricsSearch?: DiagnosticMemorySnapshot['lyricsSearch'];
    platform?: string;
    recentSamples?: DiagnosticMemoryTrendSample[];
    rendererProcesses?: DiagnosticRendererMemorySnapshot[];
    thresholdBytes?: number;
    timestamp?: string;
  } = {},
): DiagnosticMemorySnapshot => {
  const normalizedMetrics = metrics
    .map(normalizeProcessMetric)
    .sort((left, right) => right.workingSetBytes - left.workingSetBytes);
  const currentProcess = currentProcessMemorySnapshot(options.currentProcessMemory);
  const totalWorkingSetBytes = normalizedMetrics.length > 0
    ? normalizedMetrics.reduce((total, metric) => total + metric.workingSetBytes, 0)
    : currentProcess.rssBytes;
  const privateByteValues = normalizedMetrics
    .map((metric) => metric.privateBytes)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const totalPrivateBytes = privateByteValues.length > 0
    ? privateByteValues.reduce((total, value) => total + value, 0)
    : undefined;

  return {
    timestamp: options.timestamp ?? new Date().toISOString(),
    thresholdBytes: options.thresholdBytes ?? memoryPressureThresholdBytes,
    totalWorkingSetBytes,
    totalPrivateBytes,
    processCount: normalizedMetrics.length || 1,
    source: normalizedMetrics.length > 0 ? 'electron-app-metrics' : 'process-memory-usage',
    currentProcess,
    metrics: normalizedMetrics,
    topProcesses: normalizedMetrics.slice(0, topProcessLimit),
    rendererProcesses: options.rendererProcesses,
    lyricsSearch: options.lyricsSearch,
    coverProtocol: options.coverProtocol,
    recentSamples: options.recentSamples,
    appVersion: options.appVersion ?? safeAppVersion(),
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
  };
};

export const createMemoryPressureConsoleSummary = (
  snapshot: DiagnosticMemorySnapshot,
  reportPath?: string,
): MemoryPressureConsoleSummary => {
  const topProcess = snapshot.topProcesses[0] ?? snapshot.metrics[0] ?? null;
  const renderers = snapshot.rendererProcesses ?? [];
  const dominantRenderer = renderers.find((renderer) => renderer.pid === topProcess?.pid)
    ?? [...renderers].sort((left, right) =>
      (right.process?.privateBytes ?? right.process?.workingSetBytes ?? 0) -
      (left.process?.privateBytes ?? left.process?.workingSetBytes ?? 0),
    )[0]
    ?? null;
  const rendererHeap = Math.max(
    dominantRenderer?.heap?.usedJSHeapSize ?? 0,
    dominantRenderer?.chromium?.runtimeHeapUsage?.usedSize ?? 0,
    dominantRenderer?.chromium?.performanceMetrics?.JSHeapUsedSize ?? 0,
  );
  const rendererNodes = Math.max(
    dominantRenderer?.dom?.nodeCount ?? 0,
    dominantRenderer?.chromium?.domCounters?.nodes ?? 0,
    dominantRenderer?.chromium?.performanceMetrics?.Nodes ?? 0,
  );
  const rendererListeners = dominantRenderer?.chromium?.domCounters?.jsEventListeners ?? 0;
  const rendererPrivate = dominantRenderer?.process?.privateBytes ?? topProcess?.privateBytes ?? 0;
  const rendererWorking = dominantRenderer?.process?.workingSetBytes ?? topProcess?.workingSetBytes ?? 0;
  const decodedImages = dominantRenderer?.images?.estimatedDecodedBytes ?? 0;
  const imageLifecycle = dominantRenderer?.images?.lifecycle;
  const media = dominantRenderer?.media;
  const selectors = dominantRenderer?.selectors;
  const visibleState = dominantRenderer?.visibleState;
  const playbackQueue = dominantRenderer?.appState?.playbackQueue;
  const recentSearches = snapshot.lyricsSearch?.recentSearches ?? [];
  const slowLyricsSearches = recentSearches.filter((event) => event.durationMs >= 3000);
  const staleLyricsSearches = recentSearches.filter((event) => event.stale);
  const recentCandidateWrites = recentSearches.reduce((total, event) => total + event.result.storedCandidateWrites, 0);
  const coverProtocol = snapshot.coverProtocol;
  const recentCoverRequests = coverProtocol?.recentRequests ?? [];
  const recentCoverUniqueResources = new Set(
    recentCoverRequests.map((request) => request.resourceHash ?? request.urlHash),
  ).size;
  const recentCoverErrors = recentCoverRequests.filter((request) => request.outcome === 'error' || request.statusCode >= 400);
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
  let likelyCause = 'unknown-memory-pressure';

  if (dominantRenderer) {
    evidence.push(`dominant renderer ${dominantRenderer.windowKind}:${dominantRenderer.route} pid=${dominantRenderer.pid ?? 'n/a'}`);
  }

  if (rendererHeap >= 512 * mib) {
    likelyCause = 'renderer-js-heap-retention';
    evidence.push(`renderer JS heap high: ${formatBytes(rendererHeap)}`);
  }

  if (rendererNodes >= 50_000 || rendererListeners >= 10_000) {
    likelyCause = likelyCause === 'unknown-memory-pressure' ? 'renderer-dom-listener-pressure' : likelyCause;
    evidence.push(`DOM/listener pressure: nodes=${rendererNodes || 'n/a'}, listeners=${rendererListeners || 'n/a'}`);
  }

  if ((selectors?.lyricsLines ?? 0) >= 1500 || (selectors?.lyricWordNodes ?? 0) >= 5000) {
    likelyCause = likelyCause === 'unknown-memory-pressure' ? 'lyrics-dom-pressure' : likelyCause;
    evidence.push(`lyrics DOM pressure: lines=${selectors?.lyricsLines ?? 0}, wordNodes=${selectors?.lyricWordNodes ?? 0}`);
  }

  if (decodedImages >= 512 * mib || (dominantRenderer?.style?.backgroundUrlCount ?? 0) >= 20) {
    likelyCause = likelyCause === 'unknown-memory-pressure' ? 'decoded-image-or-background-pressure' : likelyCause;
    evidence.push(`visual resource pressure: decodedImages=${formatBytes(decodedImages)}, backgroundUrls=${dominantRenderer?.style?.backgroundUrlCount ?? 0}`);
  }

  if (imageLifecycle && (imageLifecycle.mounted + imageLifecycle.unmounted >= 80 || imageLifecycle.srcChanged >= 30)) {
    likelyCause = likelyCause === 'unknown-memory-pressure' ? 'image-churn' : likelyCause;
    evidence.push(`image churn: mounted=${imageLifecycle.mounted}, unmounted=${imageLifecycle.unmounted}, srcChanged=${imageLifecycle.srcChanged}`);
  }

  if ((media?.videoCount ?? 0) >= 2 || (visibleState?.mvForegroundVideoCount && visibleState.mvBackgroundVideoCount)) {
    likelyCause = likelyCause === 'unknown-memory-pressure' ? 'media-video-buffer-pressure' : likelyCause;
    evidence.push(`media pressure: videos=${media?.videoCount ?? 0}, youtubeFrames=${media?.youtubeFrameCount ?? 0}, mvForeground=${visibleState?.mvForegroundVideoCount ?? 0}, mvBackground=${visibleState?.mvBackgroundVideoCount ?? 0}`);
  }

  if ((snapshot.lyricsSearch?.activeSearchCount ?? 0) > 0 || slowLyricsSearches.length > 0 || staleLyricsSearches.length > 0) {
    likelyCause = likelyCause === 'unknown-memory-pressure' ? 'lyrics-search-overlap' : likelyCause;
    evidence.push(`lyrics search pressure: active=${snapshot.lyricsSearch?.activeSearchCount ?? 0}, slow=${slowLyricsSearches.length}, stale=${staleLyricsSearches.length}`);
  }

  if (
    playbackQueue &&
    (
      playbackQueue.itemCount >= 5_000 ||
      playbackQueue.historyCount >= 5_000 ||
      (playbackQueue.estimatedQueueJsonBytes ?? 0) >= 128 * mib ||
      (playbackQueue.estimatedHistoryJsonBytes ?? 0) >= 128 * mib
    )
  ) {
    likelyCause = likelyCause === 'unknown-memory-pressure' || likelyCause === 'renderer-js-heap-retention'
      ? 'playback-queue-retention'
      : likelyCause;
    evidence.push(`playback queue state: items=${playbackQueue.itemCount}, history=${playbackQueue.historyCount}, estimatedQueue=${formatBytes(playbackQueue.estimatedQueueJsonBytes)}, estimatedHistory=${formatBytes(playbackQueue.estimatedHistoryJsonBytes)}`);
  }

  if (recentCandidateWrites >= 100) {
    likelyCause = likelyCause === 'unknown-memory-pressure' ? 'lyrics-candidate-cache-churn' : likelyCause;
    evidence.push(`lyrics candidate writes in recent window: ${recentCandidateWrites}`);
  }

  if (
    coverProtocol &&
    (
      coverProtocol.activeRequestCount > 0 ||
      recentCoverRequests.length >= 80 ||
      recentCoverUniqueResources >= 40 ||
      coverProtocol.recentKnownBytesServed >= 256 * mib ||
      recentCoverErrors.length >= 20
    )
  ) {
    likelyCause = likelyCause === 'unknown-memory-pressure' ? 'cover-image-protocol-pressure' : likelyCause;
    evidence.push(`cover/image protocol: active=${coverProtocol.activeRequestCount}, recent=${recentCoverRequests.length}, unique=${recentCoverUniqueResources}, recentBytes=${formatBytes(coverProtocol.recentKnownBytesServed)}, errors=${recentCoverErrors.length}`);
  }

  if (totalGrowth >= 512 * mib) {
    evidence.push(`recent total memory growth: ${formatBytes(totalGrowth)}`);
  }

  if (topProcessGrowth >= 512 * mib) {
    evidence.push(`largest process growth: ${formatBytes(topProcessGrowth)}`);
  }

  if (
    dominantRenderer &&
    rendererPrivate >= gib &&
    rendererHeap < 256 * mib &&
    decodedImages < 256 * mib &&
    rendererNodes < 30_000
  ) {
    likelyCause = likelyCause === 'unknown-memory-pressure' ? 'renderer-native-or-gpu-memory' : likelyCause;
    evidence.push(`renderer private high with low JS/DOM/image counters: private=${formatBytes(rendererPrivate)}, heap=${formatBytes(rendererHeap)}, decodedImages=${formatBytes(decodedImages)}, nodes=${rendererNodes || 'n/a'}`);
  }

  if (!dominantRenderer && topProcess?.type === 'Browser') {
    likelyCause = likelyCause === 'unknown-memory-pressure' ? 'browser-main-process-memory' : likelyCause;
    evidence.push('largest process is Browser; suspect main-process/native module/cache pressure rather than renderer DOM');
  }

  if (evidence.length === 0) {
    evidence.push('no built-in subcategory crossed thresholds; inspect memory-pressure-report.md and memory-pressure.latest.json');
  }

  return {
    threshold: formatBytes(snapshot.thresholdBytes),
    totalWorkingSet: formatBytes(snapshot.totalWorkingSetBytes),
    totalPrivate: snapshot.totalPrivateBytes === undefined ? undefined : formatBytes(snapshot.totalPrivateBytes),
    topProcess: {
      pid: topProcess?.pid,
      type: topProcess?.type ?? 'unknown',
      workingSet: formatBytes(topProcess?.workingSetBytes),
      private: topProcess?.privateBytes === undefined ? undefined : formatBytes(topProcess.privateBytes),
    },
    dominantRenderer: dominantRenderer
      ? {
          pid: dominantRenderer.pid,
          route: dominantRenderer.route,
          windowKind: dominantRenderer.windowKind,
          workingSet: formatBytes(rendererWorking),
          private: formatBytes(rendererPrivate),
          heap: formatBytes(rendererHeap),
          nodes: rendererNodes || undefined,
          decodedImages: formatBytes(decodedImages),
        }
      : undefined,
    likelyCause,
    evidence: evidence.slice(0, 12),
    reportPath,
  };
};

const safeAppVersion = (): string => {
  try {
    return app.getVersion();
  } catch {
    return 'unknown';
  }
};

const getAppMetricsSnapshot = (): ProcessMetric[] => {
  try {
    return app.getAppMetrics();
  } catch {
    return [];
  }
};

const safeWindowRoute = (url: string): { route: string; routeHash?: string; windowKind: DiagnosticRendererMemorySnapshot['windowKind'] } => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'data:') {
      return { route: 'data-url', routeHash: hashText(url), windowKind: 'main' };
    }
    const routeName = parsed.pathname.split('/').filter(Boolean).pop() || parsed.pathname || '/';
    const route = `${routeName}${parsed.search || ''}${parsed.hash || ''}`;
    const windowKind = parsed.searchParams.get('desktopLyrics') === '1'
      ? 'desktopLyrics'
      : parsed.searchParams.get('miniPlayer') === '1'
        ? 'miniPlayer'
        : 'main';
    return { route, routeHash: hashText(url), windowKind };
  } catch {
    return { route: url ? 'unknown-url' : 'unloaded', routeHash: url ? hashText(url) : undefined, windowKind: 'unknown' };
  }
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`renderer_probe_timeout_${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref();
    }

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const normalizeRendererProbe = (
  value: unknown,
  fallback: DiagnosticRendererMemorySnapshot,
): DiagnosticRendererMemorySnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  const probe = value as Partial<DiagnosticRendererMemorySnapshot>;
  return {
    ...fallback,
    route: typeof probe.route === 'string' && probe.route.trim() ? probe.route : fallback.route,
    routeDetail: probe.routeDetail,
    title: typeof probe.title === 'string' ? probe.title : fallback.title,
    heap: probe.heap,
    dom: probe.dom,
    images: probe.images,
    media: probe.media,
    resources: probe.resources,
    style: probe.style,
    selectors: probe.selectors,
    appState: probe.appState,
    visibleState: probe.visibleState,
    userActions: probe.userActions,
    storageEstimate: probe.storageEstimate,
  };
};

const safeRead = <T>(read: () => T, fallback: T): T => {
  try {
    return read();
  } catch {
    return fallback;
  }
};

const processMetricForPid = (
  metrics: DiagnosticMemoryProcessMetric[],
  pid: number | undefined,
): DiagnosticRendererMemorySnapshot['process'] | undefined => {
  if (typeof pid !== 'number') {
    return undefined;
  }

  const metric = metrics.find((candidate) => candidate.pid === pid);
  return metric
    ? {
        type: metric.type,
        name: metric.name,
        serviceName: metric.serviceName,
        workingSetBytes: metric.workingSetBytes,
        privateBytes: metric.privateBytes,
        peakWorkingSetBytes: metric.peakWorkingSetBytes,
        cpuPercent: metric.cpuPercent,
      }
    : undefined;
};

const collectChromiumDiagnostics = async (
  window: BrowserWindow,
): Promise<DiagnosticRendererMemorySnapshot['chromium'] | undefined> => {
  const debuggerApi = window.webContents.debugger;
  if (debuggerApi.isAttached()) {
    return { debuggerError: 'debugger_already_attached' };
  }

  try {
    debuggerApi.attach('1.3');
    const runtimeHeapUsage = await debuggerApi.sendCommand('Runtime.getHeapUsage').catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    })) as unknown;
    const domCounters = await debuggerApi.sendCommand('Memory.getDOMCounters').catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    })) as unknown;
    await debuggerApi.sendCommand('Performance.enable').catch(() => undefined);
    const performanceResult = await debuggerApi.sendCommand('Performance.getMetrics').catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    })) as unknown;
    const chromium: DiagnosticRendererMemorySnapshot['chromium'] = {};

    if (runtimeHeapUsage && typeof runtimeHeapUsage === 'object' && !Array.isArray(runtimeHeapUsage)) {
      const record = runtimeHeapUsage as Record<string, unknown>;
      if (typeof record.error === 'string') {
        chromium.debuggerError = `Runtime.getHeapUsage: ${record.error}`;
      } else {
        chromium.runtimeHeapUsage = {
          usedSize: finiteNumber(record.usedSize) ?? undefined,
          totalSize: finiteNumber(record.totalSize) ?? undefined,
        };
      }
    }

    if (domCounters && typeof domCounters === 'object' && !Array.isArray(domCounters)) {
      const record = domCounters as Record<string, unknown>;
      if (typeof record.error === 'string') {
        chromium.debuggerError = `${chromium.debuggerError ? `${chromium.debuggerError}; ` : ''}Memory.getDOMCounters: ${record.error}`;
      } else {
        chromium.domCounters = {
          documents: finiteNumber(record.documents) ?? undefined,
          nodes: finiteNumber(record.nodes) ?? undefined,
          jsEventListeners: finiteNumber(record.jsEventListeners) ?? undefined,
        };
      }
    }

    if (performanceResult && typeof performanceResult === 'object' && !Array.isArray(performanceResult)) {
      const record = performanceResult as Record<string, unknown>;
      if (typeof record.error === 'string') {
        chromium.debuggerError = `${chromium.debuggerError ? `${chromium.debuggerError}; ` : ''}Performance.getMetrics: ${record.error}`;
      } else if (Array.isArray(record.metrics)) {
        chromium.performanceMetrics = Object.fromEntries(
          record.metrics
            .map((metric) => {
              const item = metric && typeof metric === 'object' ? metric as Record<string, unknown> : {};
              const name = typeof item.name === 'string' ? item.name : null;
              const value = finiteNumber(item.value);
              return name && value !== null ? [name, value] : null;
            })
            .filter((entry): entry is [string, number] => Boolean(entry)),
        );
      }
    }

    return chromium;
  } catch (error) {
    return { debuggerError: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      if (debuggerApi.isAttached()) {
        debuggerApi.detach();
      }
    } catch {
      // The renderer may have gone away while collecting diagnostics.
    }
  }
};

const collectRendererMemorySnapshot = async (
  window: BrowserWindow,
  metrics: DiagnosticMemoryProcessMetric[],
): Promise<DiagnosticRendererMemorySnapshot> => {
  const startedAt = Date.now();
  const url = safeRead(() => window.webContents.getURL(), '');
  const route = safeWindowRoute(url);
  const pid = safeRead(() => window.webContents.getOSProcessId(), undefined);
  const base: DiagnosticRendererMemorySnapshot = {
    timestamp: new Date().toISOString(),
    pid,
    windowId: safeRead(() => window.id, undefined),
    windowKind: route.windowKind,
    route: route.route,
    routeHash: route.routeHash,
    isVisible: safeRead(() => window.isVisible(), false),
    isFocused: safeRead(() => window.isFocused(), false),
    isLoading: safeRead(() => window.webContents.isLoading(), false),
    process: processMetricForPid(metrics, pid),
  };

  try {
    const [probe, chromium] = await Promise.all([
      withTimeout(
        window.webContents.executeJavaScript(rendererMemoryProbeScript, true) as Promise<unknown>,
        rendererProbeTimeoutMs,
      ),
      withTimeout(collectChromiumDiagnostics(window), rendererProbeTimeoutMs).catch((error) => ({
        debuggerError: error instanceof Error ? error.message : String(error),
      })),
    ]);
    return {
      ...normalizeRendererProbe(probe, base),
      chromium,
      collectionDurationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ...base,
      collectionDurationMs: Date.now() - startedAt,
      collectionError: error instanceof Error ? error.message : String(error),
    };
  }
};

const collectRendererMemorySnapshots = async (
  metrics: DiagnosticMemoryProcessMetric[],
): Promise<DiagnosticRendererMemorySnapshot[]> => {
  const windows = BrowserWindow.getAllWindows().filter((window) => !safeRead(() => window.isDestroyed(), true));
  return Promise.all(windows.map((window) => collectRendererMemorySnapshot(window, metrics)));
};

const sendMemoryPressureEvent = (event: DiagnosticMemoryPressureEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }

    const send = (): void => {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannels.DiagnosticsMemoryPressure, event);
      }
    };

    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  }
};

export const shouldReleaseSoftMemoryPressure = (
  recentSamples: readonly Pick<DiagnosticMemoryTrendSample, 'totalWorkingSetBytes'>[],
  thresholdBytes = softMemoryPressureThresholdBytes,
): boolean => {
  const samples = recentSamples.slice(-softMemoryPressureRequiredSamples);
  return samples.length >= softMemoryPressureRequiredSamples &&
    samples.every((sample) => sample.totalWorkingSetBytes >= thresholdBytes);
};

const maybeReleaseSoftMemoryPressure = (): void => {
  if (!shouldReleaseSoftMemoryPressure(getRecentMemoryTrendSamples())) {
    return;
  }

  void releaseSoftMemoryPressure({ reason: 'sustained-soft-memory-pressure' })
    .then((summary) => {
      const logFields = createSoftMemoryCleanupLogFields(summary);
      if (!summary.ran) {
        if (summary.cooldownHit) {
          getCrashReportService().getLogger()?.info('main', 'soft memory cleanup skipped', logFields);
        }
        return;
      }

      if (summary.removedEntries === 0 && summary.errorCount === 0) {
        return;
      }

      getCrashReportService().getLogger()?.info('main', 'soft memory cleanup completed', logFields);
    })
    .catch((error) => {
      getCrashReportService().getLogger()?.warn('main', 'soft memory cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
};

export const checkMemoryPressureNow = async (): Promise<DiagnosticMemoryPressureEvent | null> => {
  if (hasReportedMemoryPressure || isCheckingMemoryPressure) {
    return null;
  }

  isCheckingMemoryPressure = true;
  const snapshot = createDiagnosticMemorySnapshot(getAppMetricsSnapshot(), {
    appVersion: safeAppVersion(),
    thresholdBytes: memoryPressureThresholdBytes,
  });
  recordMemoryTrendSample(snapshot);

  if (snapshot.totalWorkingSetBytes < snapshot.thresholdBytes) {
    maybeReleaseSoftMemoryPressure();
    isCheckingMemoryPressure = false;
    return null;
  }

  try {
    const enrichedSnapshot: DiagnosticMemorySnapshot = {
      ...snapshot,
      rendererProcesses: await collectRendererMemorySnapshots(snapshot.metrics),
      lyricsSearch: getLyricsSearchDiagnosticsSnapshot(),
      coverProtocol: getCoverProtocolDiagnosticsSnapshot(),
      recentSamples: getRecentMemoryTrendSamples(),
    };
    const event = getCrashReportService().reportMemoryPressure(enrichedSnapshot);
    const consoleSummary = createMemoryPressureConsoleSummary(enrichedSnapshot, event.reportPath);
    console.warn('[memory-pressure] ECHO memory exceeded threshold', consoleSummary);
    getCrashReportService().getLogger()?.warn('main', 'memory pressure cause summary', consoleSummary);
    hasReportedMemoryPressure = true;
    sendMemoryPressureEvent(event);
    return event;
  } catch (error) {
    getCrashReportService().getLogger()?.warn('main', 'failed to create memory pressure report', {
      error: error instanceof Error ? error.message : String(error),
      totalWorkingSetBytes: snapshot.totalWorkingSetBytes,
      thresholdBytes: snapshot.thresholdBytes,
    });
    return null;
  } finally {
    isCheckingMemoryPressure = false;
  }
};

export const startMemoryPressureMonitor = (): void => {
  if (checkTimer !== null || initialCheckTimer !== null) {
    return;
  }

  hasReportedMemoryPressure = false;
  isCheckingMemoryPressure = false;
  initialCheckTimer = setTimeout(() => {
    initialCheckTimer = null;
    void checkMemoryPressureNow();
  }, initialCheckDelayMs);
  checkTimer = setInterval(() => {
    void checkMemoryPressureNow();
  }, defaultCheckIntervalMs);
};

export const stopMemoryPressureMonitor = (): void => {
  if (initialCheckTimer !== null) {
    clearTimeout(initialCheckTimer);
    initialCheckTimer = null;
  }

  if (checkTimer !== null) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
};
