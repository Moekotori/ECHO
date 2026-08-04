export const mvOffsetMinMs = -600000;
export const mvOffsetMaxMs = 600000;
export const mvOffsetStepMs = 100;

export const clampMvOffsetMs = (value: number): number =>
  Math.max(mvOffsetMinMs, Math.min(mvOffsetMaxMs, Math.round(value)));
