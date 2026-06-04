export const BPM_ANALYSIS_VERSION = 3;
export const BPM_CONFIDENCE_THRESHOLD = 0.68;

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
): bpm is number => isFinitePositive(bpm) && status !== 'low_confidence' && status !== 'error' && status !== 'analyzing';
