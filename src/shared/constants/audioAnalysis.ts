export const BPM_ANALYSIS_VERSION = 5;
export const BPM_CONFIDENCE_THRESHOLD = 0.68;
export const BPM_ANALYSIS_VERSION_FIELD = 'bpmAnalysisVersion';

const isFinitePositive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const isReliableBpmAnalysis = (
  bpm: number | null | undefined,
  confidence: number | null | undefined,
  status?: string | null,
): bpm is number => {
  if (!isFinitePositive(bpm)) {
    return false;
  }

  if (status === 'low_confidence' || status === 'error' || status === 'analyzing') {
    return false;
  }

  if (typeof confidence === 'number' && Number.isFinite(confidence)) {
    return confidence >= BPM_CONFIDENCE_THRESHOLD;
  }

  return status === undefined || status === null || status === 'complete';
};

export const isDisplayableBpmAnalysis = (
  bpm: number | null | undefined,
  status?: string | null,
  _confidence?: number | null,
): bpm is number => {
  if (!isFinitePositive(bpm) || status === 'error' || status === 'analyzing') {
    return false;
  }

  return true;
};

export const isCurrentBpmAnalysis = (fieldSources: Record<string, string> | null | undefined): boolean =>
  fieldSources?.bpm === 'audio_analysis' &&
  fieldSources[BPM_ANALYSIS_VERSION_FIELD] === String(BPM_ANALYSIS_VERSION);

export const hasCurrentBpmAnalysisAttempt = (
  fieldSources: Record<string, string> | null | undefined,
): boolean => fieldSources?.[BPM_ANALYSIS_VERSION_FIELD] === String(BPM_ANALYSIS_VERSION);

export const shouldAnalyzeBpm = (track: {
  bpm?: number | null;
  bpmConfidence?: number | null;
  analysisStatus?: string | null;
  fieldSources?: Record<string, string>;
}): boolean => {
  if (track.analysisStatus === 'analyzing') {
    return false;
  }

  if (hasCurrentBpmAnalysisAttempt(track.fieldSources)) {
    return false;
  }

  if (track.fieldSources?.bpm === 'audio_analysis') {
    return !isCurrentBpmAnalysis(track.fieldSources);
  }

  return !isReliableBpmAnalysis(track.bpm, track.bpmConfidence, track.analysisStatus);
};
