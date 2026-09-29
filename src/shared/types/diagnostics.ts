export type DiagnosticScope = 'main' | 'renderer' | 'library' | 'audio' | 'playback' | 'network' | 'crash';

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export type DiagnosticConsoleSource = 'stdout' | 'stderr' | 'renderer' | 'system';

export type DiagnosticConsoleLevel = DiagnosticLevel | 'log';

export type DiagnosticConsoleEntry = {
  id: number;
  timestamp: string;
  source: DiagnosticConsoleSource;
  level: DiagnosticConsoleLevel;
  message: string;
  rawMessage?: string;
  details?: {
    line?: number;
    sourceId?: string;
  };
};

export type DiagnosticConsoleSnapshot = {
  entries: DiagnosticConsoleEntry[];
  maxEntries: number;
};

export type CrashSessionStatus = 'running' | 'closed' | 'abnormalExit';

export type CrashSessionInfo = {
  sessionId: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  startedAt: string;
  shutdownRequestedAt?: string;
  endedAt?: string;
  status: CrashSessionStatus;
};

export type LastCrashSummary = {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  detectedAt: string;
  sessionBasename: string;
  sessionPathHash: string;
  reason: 'abnormalExit';
};

export type RendererErrorPayload = {
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  source: 'error' | 'unhandledrejection';
  timestamp: string;
};

export type DiagnosticPerformanceStallPayload = {
  source: 'main' | 'renderer';
  kind: 'event_loop' | 'animation_frame' | 'long_task';
  durationMs: number;
  thresholdMs: number;
  timestamp: string;
  windowKind?: 'main' | 'desktopLyrics' | 'miniPlayer' | 'unknown';
  url?: string;
  details?: Record<string, unknown>;
};

export type DiagnosticMemoryProcessMetric = {
  pid: number;
  type: string;
  name?: string;
  serviceName?: string;
  sandboxed?: boolean;
  creationTime?: number;
  workingSetBytes: number;
  peakWorkingSetBytes: number;
  privateBytes?: number;
  cpuPercent?: number;
};

export type DiagnosticCurrentProcessMemory = {
  pid: number;
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
};

export type DiagnosticRendererHeapEstimate = {
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
};

export type DiagnosticRendererMemorySnapshot = {
  timestamp: string;
  pid?: number;
  windowId?: number;
  windowKind: 'main' | 'desktopLyrics' | 'miniPlayer' | 'unknown';
  route: string;
  routeHash?: string;
  routeDetail?: {
    locationRoute?: string;
    reactRouteId?: string | null;
    pageMode?: string | null;
    activeRouteId?: string | null;
    activeRouteHidden?: boolean | null;
    visibleRouteIds?: string[];
    lyricsViewMode?: string | null;
    settingsSection?: string | null;
  };
  title?: string;
  isVisible?: boolean;
  isFocused?: boolean;
  isLoading?: boolean;
  collectionDurationMs?: number;
  collectionError?: string;
  process?: {
    type?: string;
    name?: string;
    serviceName?: string;
    workingSetBytes?: number;
    privateBytes?: number;
    peakWorkingSetBytes?: number;
    cpuPercent?: number;
  };
  heap?: DiagnosticRendererHeapEstimate;
  chromium?: {
    runtimeHeapUsage?: {
      usedSize?: number;
      totalSize?: number;
    };
    domCounters?: {
      documents?: number;
      nodes?: number;
      jsEventListeners?: number;
    };
    performanceMetrics?: Record<string, number>;
    debuggerError?: string;
  };
  dom?: {
    nodeCount: number;
    elementCount: number;
    textNodeCount: number;
    documentWidth: number;
    documentHeight: number;
  };
  images?: {
    imageElementCount: number;
    loadedImageCount: number;
    brokenImageCount: number;
    echoCoverImageCount: number;
    echoImageProtocolImageCount: number;
    dataImageCount: number;
    remoteImageCount: number;
    estimatedDecodedBytes: number;
    largestImages: Array<{
      srcKind: 'echo-cover' | 'echo-image' | 'echo-artist-image' | 'data' | 'remote' | 'other' | 'empty';
      naturalWidth: number;
      naturalHeight: number;
      decodedBytes: number;
      className?: string;
    }>;
    lifecycle?: {
      recentWindowMs: number;
      mounted: number;
      unmounted: number;
      srcChanged: number;
      bySrcKind: Record<string, number>;
      byVariant: Record<string, number>;
      recentEvents: Array<{
        ageMs: number;
        type: 'mount' | 'unmount' | 'src-change';
        routeId?: string;
        srcKind: 'echo-cover' | 'echo-image' | 'echo-artist-image' | 'data' | 'remote' | 'other' | 'empty';
        variant?: string;
        className?: string;
      }>;
    };
  };
  userActions?: {
    recentWindowMs: number;
    counts: Record<string, number>;
    recent: Array<{
      ageMs: number;
      type: string;
      routeId?: string;
      target?: string;
      targetClass?: string;
      detail?: string;
    }>;
  };
  media?: {
    canvasCount: number;
    videoCount: number;
    audioCount: number;
    youtubeFrameCount?: number;
    videoDetails?: Array<{
      className?: string;
      srcKind: 'echo-cover' | 'echo-image' | 'data' | 'remote' | 'other' | 'empty';
      videoWidth: number;
      videoHeight: number;
      readyState: number;
      paused: boolean;
      muted: boolean;
      loop: boolean;
      preload: string;
    }>;
  };
  resources?: {
    totalResourceEntries: number;
    totalTransferSize: number;
    totalDecodedBodySize: number;
    byInitiatorType: Record<string, number>;
    byProtocol: Record<string, number>;
  };
  style?: {
    backgroundUrlCount: number;
    echoCoverBackgroundCount: number;
    echoImageBackgroundCount: number;
    dataBackgroundCount: number;
    remoteBackgroundCount: number;
    blurFilterElementCount: number;
    willChangeElementCount: number;
    fixedOrStickyElementCount: number;
  };
  selectors?: Record<string, number>;
  appState?: {
    playbackQueue?: {
      itemCount: number;
      historyCount: number;
      playlistItemCount?: number;
      shuffleDeckCount?: number;
      automixAnalysisPendingCount?: number;
      automixAnalysisTimerCount?: number;
      currentSourceType?: string | null;
      queueSampleJsonBytes?: number;
      historySampleJsonBytes?: number;
      estimatedQueueJsonBytes?: number;
      estimatedHistoryJsonBytes?: number;
    };
  };
  visibleState?: Record<string, boolean | number | string | null>;
  storageEstimate?: {
    usage?: number;
    quota?: number;
  };
};

export type DiagnosticLyricsSearchStorageSnapshot = {
  lyricsCacheRows: number;
  candidateRows: number;
  candidateRowsForTrack: number;
  pendingCandidateRowsForTrack: number;
  rejectedCandidateRowsForTrack: number;
  acceptedCandidateRowsForTrack: number;
};

export type DiagnosticLyricsSearchEvent = {
  id: number;
  kind: 'track' | 'snapshot';
  trigger: 'missing-lyrics' | 'smart-alignment' | 'manual' | 'rematch';
  status: 'completed' | 'failed';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  activeAtStart: number;
  activeAtEnd: number;
  providerId: string | null;
  enabledProviderCount: number;
  networkEnabled: boolean;
  deepSearchEnabled: boolean;
  trackIdHash: string;
  queryHash: string;
  input: {
    searchTextChars: number;
    titleChars: number;
    artistChars: number;
    albumChars: number;
    hasDuration: boolean;
    hasFilePath: boolean;
    hasSourceId: boolean;
    hasStableKey: boolean;
    mediaType: string | null;
  };
  result: {
    rawCandidateCount: number;
    returnedCandidateCount: number;
    storedCandidateRowsTouched: number;
    storedCandidateCacheHits: number;
    storedCandidateWrites: number;
    rejectedCandidateCount: number;
    lyricsCacheHitBeforeSearch: boolean;
  };
  canceled: boolean;
  stale: boolean;
  error?: string;
  storage?: DiagnosticLyricsSearchStorageSnapshot | null;
};

export type DiagnosticLyricsSearchActiveRequest = {
  id: number;
  kind: 'track' | 'snapshot';
  trigger: 'missing-lyrics' | 'smart-alignment' | 'manual' | 'rematch';
  startedAt: string;
  activeMs: number;
  providerId: string | null;
  trackIdHash: string;
  queryHash: string;
};

export type DiagnosticLyricsSearchSnapshot = {
  timestamp: string;
  activeSearchCount: number;
  activeByKind: Record<'track' | 'snapshot', number>;
  activeRequests: DiagnosticLyricsSearchActiveRequest[];
  recentSearches: DiagnosticLyricsSearchEvent[];
  lastObservedStorage: DiagnosticLyricsSearchStorageSnapshot | null;
  maxRecentSearches: number;
};

export type DiagnosticCoverProtocolScheme = 'echo-cover' | 'echo-wallpaper' | 'echo-artist-image' | 'echo-image';

export type DiagnosticCoverProtocolOutcome = 'ok' | 'default' | 'missing' | 'invalid' | 'blocked' | 'error';

export type DiagnosticCoverProtocolRequest = {
  id: number;
  scheme: DiagnosticCoverProtocolScheme;
  routeKind: string;
  variant?: string;
  method: string;
  urlHash: string;
  resourceHash?: string;
  targetHost?: string;
  source?: string;
  outcome: DiagnosticCoverProtocolOutcome;
  statusCode: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  knownBytes?: number;
  contentType?: string;
  cacheControl?: string;
  error?: string;
};

export type DiagnosticCoverProtocolActiveRequest = {
  id: number;
  scheme: DiagnosticCoverProtocolScheme;
  routeKind: string;
  variant?: string;
  method: string;
  urlHash: string;
  resourceHash?: string;
  targetHost?: string;
  startedAt: string;
  activeMs: number;
};

export type DiagnosticCoverProtocolResourceSummary = {
  scheme: DiagnosticCoverProtocolScheme;
  routeKind: string;
  variant?: string;
  resourceHash: string;
  targetHost?: string;
  requestCount: number;
  knownBytes: number;
  lastOutcome: DiagnosticCoverProtocolOutcome;
  lastStatusCode: number;
  lastCompletedAt: string;
};

export type DiagnosticCoverProtocolSnapshot = {
  timestamp: string;
  totalRequests: number;
  activeRequestCount: number;
  activeRequests: DiagnosticCoverProtocolActiveRequest[];
  recentRequests: DiagnosticCoverProtocolRequest[];
  maxRecentRequests: number;
  byScheme: Record<string, number>;
  byOutcome: Record<string, number>;
  bySource: Record<string, number>;
  byStatusCode: Record<string, number>;
  byRouteKind: Record<string, number>;
  byVariant: Record<string, number>;
  byTargetHost: Record<string, number>;
  totalKnownBytesServed: number;
  recentKnownBytesServed: number;
  trackedUniqueResourceCount: number;
  uniqueResourceTrackingTruncated: boolean;
  topResources: DiagnosticCoverProtocolResourceSummary[];
};

export type DiagnosticMemoryTrendProcess = {
  pid: number;
  type: string;
  name?: string;
  serviceName?: string;
  workingSetBytes: number;
  privateBytes?: number;
  cpuPercent?: number;
};

export type DiagnosticMemoryTrendSample = {
  timestamp: string;
  totalWorkingSetBytes: number;
  totalPrivateBytes?: number;
  topProcesses: DiagnosticMemoryTrendProcess[];
};

export type DiagnosticMemorySnapshot = {
  timestamp: string;
  thresholdBytes: number;
  totalWorkingSetBytes: number;
  totalPrivateBytes?: number;
  processCount: number;
  source: 'electron-app-metrics' | 'process-memory-usage';
  currentProcess: DiagnosticCurrentProcessMemory;
  metrics: DiagnosticMemoryProcessMetric[];
  topProcesses: DiagnosticMemoryProcessMetric[];
  rendererProcesses?: DiagnosticRendererMemorySnapshot[];
  lyricsSearch?: DiagnosticLyricsSearchSnapshot;
  coverProtocol?: DiagnosticCoverProtocolSnapshot;
  recentSamples?: DiagnosticMemoryTrendSample[];
  appVersion: string;
  platform: string;
  arch: string;
};

export type DiagnosticMemoryPressureEvent = {
  timestamp: string;
  thresholdBytes: number;
  totalWorkingSetBytes: number;
  totalPrivateBytes?: number;
  processCount: number;
  topProcessType: string;
  topProcessWorkingSetBytes: number;
  reportPath: string;
  graphicsPressure?: {
    kind: 'lyrics-mv-render-pressure';
    reason: string;
    rendererPid?: number;
    rendererPrivateBytes?: number;
    rendererHeapUsedBytes?: number;
    rendererDomNodes?: number;
    lyricsPageVisible?: boolean;
    mvPanelVisible?: boolean;
    duplicateMvVideoDecode?: boolean;
  } | null;
};
