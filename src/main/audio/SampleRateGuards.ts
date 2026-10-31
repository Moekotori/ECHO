export const minReasonableAudioSampleRate = 8_000;
export const maxReasonableAudioSampleRate = 50_000_000;

export const normalizeAudioSampleRate = (value: unknown): number | null => {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < minReasonableAudioSampleRate ||
    parsed > maxReasonableAudioSampleRate
  ) {
    return null;
  }

  return Math.round(parsed);
};

export const isReasonableAudioSampleRate = (value: unknown): value is number =>
  normalizeAudioSampleRate(value) !== null;
