export const automixAnalysisVersion = 2 as const;
export const automixTransitionPlanVersion = 2 as const;

export type AutomixV2AnalysisStatus = 'complete' | 'partial' | 'unavailable' | 'error';
export type AutomixMusicalMode = 'major' | 'minor';
export type AutomixTransitionModeV2 =
  | 'beat_match'
  | 'phrase_crossfade'
  | 'short_crossfade'
  | 'gapless_fallback';
export type AutomixRuntimePhase = 'off' | 'shadow' | 'native_beta' | 'native_default';
export type AutomixRuntimeState = 'idle' | 'preparing' | 'armed' | 'committed' | 'fallback';

export const resolveAutomixRuntimePhase = (
  value: unknown,
  fallback: AutomixRuntimePhase = 'native_beta',
): AutomixRuntimePhase =>
  value === 'off' || value === 'shadow' || value === 'native_beta' || value === 'native_default'
    ? value
    : fallback;

export type AutomixPhraseBoundary = {
  seconds: number;
  bars: 4 | 8 | 16;
  confidence: number;
};

export type AutomixKeyAnalysis = {
  tonic: number;
  mode: AutomixMusicalMode;
  camelot: string;
  confidence: number;
  chroma: number[];
};

export type AutomixAnalysisV2 = {
  version: typeof automixAnalysisVersion;
  fingerprint: string;
  status: AutomixV2AnalysisStatus;
  durationSeconds: number;
  bpm: number | null;
  bpmConfidence: number | null;
  beatOffsetMs: number | null;
  beatGridSeconds: number[];
  downbeatGridSeconds: number[];
  phraseBoundaries: AutomixPhraseBoundary[];
  key: AutomixKeyAnalysis | null;
  leadingSilenceSeconds: number;
  trailingSilenceSeconds: number;
  integratedLufs: number | null;
  segmentRmsDb: number[];
  energyCurve: number[];
  analyzedAt: string | null;
  error: string | null;
};

export type AutomixTransitionPlanV2 = {
  version: typeof automixTransitionPlanVersion;
  planId: string;
  queueRevision: number;
  fromItemId: string;
  fromTrackId: string;
  toItemId: string;
  toTrackId: string;
  mixSampleRate: number;
  mode: AutomixTransitionModeV2;
  currentStartSeconds: number;
  currentEndSeconds: number;
  fadeStartOutputFrame: number;
  fadeEndOutputFrame: number;
  commitOutputFrame: number;
  nextStartSeconds: number;
  overlapFrames: number;
  currentGainDb: number;
  nextGainDb: number;
  currentReplayGainDb?: number;
  nextReplayGainDb?: number;
  tempoRatio: number;
  fallbackReason: string | null;
};

export type AutomixPrepareRequestV2 = {
  plan: AutomixTransitionPlanV2;
  nextSource: {
    kind: 'local' | 'http';
    uri: string;
    headers?: Record<string, string>;
    mimeType?: string | null;
  };
};

export type AutomixPrepareResultV2 = {
  acknowledged: true;
  state: Extract<AutomixRuntimeState, 'armed' | 'fallback'>;
  planId: string;
  operationId: number;
  reason: string | null;
};

export type AutomixStateV2 = {
  state: AutomixRuntimeState;
  planId: string | null;
  queueRevision: number | null;
  operationId: number | null;
  reason: string | null;
};

export type AutomixTransitionCommittedEventV2 = {
  planId: string;
  queueRevision: number;
  operationId: number;
  fromItemId: string;
  fromTrackId: string;
  toItemId: string;
  toTrackId: string;
  outputFrame: number;
  sourcePositionSeconds: number;
};
