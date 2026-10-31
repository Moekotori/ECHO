export type OsuTimingPointInput = {
  bpm: number;
  offsetMs: number;
  meter?: number;
};

export type OsuBookmarkInput = OsuTimingPointInput & {
  measureCount?: number;
};

const trimFixed = (value: number, digits: number): string =>
  value
    .toFixed(digits)
    .replace(/\.?0+$/u, '');

const assertFiniteNumber = (value: number, label: string): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
};

export const getBeatLengthMs = (bpm: number): number => {
  assertFiniteNumber(bpm, 'bpm');
  if (bpm <= 0) {
    throw new Error('bpm must be greater than 0');
  }

  return 60000 / bpm;
};

const assertMeter = (meter: number): void => {
  assertFiniteNumber(meter, 'meter');

  if (meter <= 0 || !Number.isInteger(meter)) {
    throw new Error('meter must be a positive integer');
  }
};

export const getMeasureLengthMs = (bpm: number, meter = 4): number => {
  assertMeter(meter);

  return getBeatLengthMs(bpm) * meter;
};

export const getOsuBookmarkOffsets = ({ bpm, offsetMs, meter = 4, measureCount = 16 }: OsuBookmarkInput): number[] => {
  assertFiniteNumber(offsetMs, 'offsetMs');
  assertFiniteNumber(measureCount, 'measureCount');

  if (measureCount <= 0 || !Number.isInteger(measureCount)) {
    throw new Error('measureCount must be a positive integer');
  }

  const measureLength = getMeasureLengthMs(bpm, meter);
  const firstMeasureIndex = Math.max(0, Math.ceil(-offsetMs / measureLength));

  return Array.from({ length: measureCount }, (_, index) => Math.round(offsetMs + (firstMeasureIndex + index) * measureLength));
};

export const formatOsuTimingPoint = ({ bpm, offsetMs, meter = 4 }: OsuTimingPointInput): string => {
  assertFiniteNumber(offsetMs, 'offsetMs');
  assertMeter(meter);

  const offset = Math.round(offsetMs);
  const beatLength = trimFixed(getBeatLengthMs(bpm), 6);

  return `${offset},${beatLength},${meter},1,0,100,1,0`;
};

export const formatOsuTimingBlock = (input: OsuTimingPointInput): string => `[TimingPoints]\n${formatOsuTimingPoint(input)}`;

export const formatOsuBookmarksLine = (input: OsuBookmarkInput): string => `Bookmarks: ${getOsuBookmarkOffsets(input).join(',')}`;
