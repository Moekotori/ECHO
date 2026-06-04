export type OsuTimingPointInput = {
  bpm: number;
  offsetMs: number;
  meter?: number;
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

export const formatOsuTimingPoint = ({ bpm, offsetMs, meter = 4 }: OsuTimingPointInput): string => {
  assertFiniteNumber(offsetMs, 'offsetMs');
  assertFiniteNumber(meter, 'meter');

  if (meter <= 0 || !Number.isInteger(meter)) {
    throw new Error('meter must be a positive integer');
  }

  const offset = Math.round(offsetMs);
  const beatLength = trimFixed(getBeatLengthMs(bpm), 6);

  return `${offset},${beatLength},${meter},1,0,100,1,0`;
};

export const formatOsuTimingBlock = (input: OsuTimingPointInput): string => `[TimingPoints]\n${formatOsuTimingPoint(input)}`;
