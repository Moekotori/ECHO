export const hiResMinimumBitDepth = 24;
export const hiResMinimumSampleRate = 88_200;

const dsdCodecs = new Set(['DSF', 'DFF', 'DSD']);

const positiveNumber = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

export const isDsdCodec = (codec: string | null | undefined): boolean => {
  const normalized = codec?.trim().toUpperCase();
  return Boolean(normalized && dsdCodecs.has(normalized));
};

export const isHiResAudioSpec = ({
  bitDepth,
  codec,
  sampleRate,
  streamingQuality,
}: {
  bitDepth?: number | null;
  codec?: string | null;
  sampleRate?: number | null;
  streamingQuality?: string | null;
}): boolean => {
  if (streamingQuality === 'hires' || isDsdCodec(codec)) {
    return true;
  }

  const normalizedBitDepth = positiveNumber(bitDepth);
  const normalizedSampleRate = positiveNumber(sampleRate);

  return Boolean(
    normalizedBitDepth !== null &&
      normalizedSampleRate !== null &&
      normalizedBitDepth >= hiResMinimumBitDepth &&
      normalizedSampleRate >= hiResMinimumSampleRate,
  );
};
