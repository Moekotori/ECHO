export const dspRackModuleIds = [
  'equalizer',
  'convolution',
  'replayGain',
  'compressor',
  'crossfeed',
  'stereoField',
  'channelMatrix',
  'channelBalance',
] as const;

export type DspRackModuleId = (typeof dspRackModuleIds)[number];

export const dspRackFixedPostStageIds = [
  'headroom',
  'truePeakLimiter',
  'playbackRate',
  'levelMeter',
] as const;

export type DspRackFixedPostStageId = (typeof dspRackFixedPostStageIds)[number];

export const compressorThresholdMinDb = -72;
export const compressorThresholdMaxDb = 0;
export const compressorRatioMin = 1;
export const compressorRatioMax = 40;
export const compressorAttackMinMs = 0.1;
export const compressorAttackMaxMs = 500;
export const compressorReleaseMinMs = 5;
export const compressorReleaseMaxMs = 5_000;
export const compressorKneeMinDb = 0;
export const compressorKneeMaxDb = 24;
export const compressorMakeupMinDb = -24;
export const compressorMakeupMaxDb = 24;

export type CompressorState = {
  enabled: boolean;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  makeupDb: number;
  mix: number;
  gainReductionDb: number;
  clippingRisk: boolean;
};

export type CrossfeedState = {
  enabled: boolean;
  amount: number;
  cutoffHz: number;
};

export type StereoFieldState = {
  enabled: boolean;
  width: number;
  centerGainDb: number;
  sideGainDb: number;
  clippingRisk: boolean;
};

export type ChannelMatrixState = {
  enabled: boolean;
  leftToLeft: number;
  rightToLeft: number;
  leftToRight: number;
  rightToRight: number;
  clippingRisk: boolean;
};

export type DspRackState = {
  schemaVersion: 3;
  order: DspRackModuleId[];
  compressor: CompressorState;
  crossfeed: CrossfeedState;
  stereoField: StereoFieldState;
  channelMatrix: ChannelMatrixState;
  reorderableModules: DspRackModuleId[];
  fixedPostStages: DspRackFixedPostStageId[];
};

export const defaultDspRackState = (): DspRackState => ({
  schemaVersion: 3,
  order: [...dspRackModuleIds],
  compressor: {
    enabled: false,
    thresholdDb: -18,
    ratio: 4,
    attackMs: 10,
    releaseMs: 120,
    kneeDb: 6,
    makeupDb: 0,
    mix: 1,
    gainReductionDb: 0,
    clippingRisk: false,
  },
  crossfeed: {
    enabled: false,
    amount: 0.25,
    cutoffHz: 700,
  },
  stereoField: {
    enabled: false,
    width: 1,
    centerGainDb: 0,
    sideGainDb: 0,
    clippingRisk: false,
  },
  channelMatrix: {
    enabled: false,
    leftToLeft: 1,
    rightToLeft: 0,
    leftToRight: 0,
    rightToRight: 1,
    clippingRisk: false,
  },
  reorderableModules: [...dspRackModuleIds],
  fixedPostStages: [...dspRackFixedPostStageIds],
});

export const normalizeDspRackState = (value: unknown): DspRackState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultDspRackState();
  }

  const candidate = value as {
    order?: unknown;
    compressor?: unknown;
    crossfeed?: unknown;
    stereoField?: unknown;
    channelMatrix?: unknown;
  };
  if (!Array.isArray(candidate.order) || candidate.order.length === 0) {
    return defaultDspRackState();
  }

  const knownIds = new Set<string>(dspRackModuleIds);
  const order = candidate.order.filter((item): item is DspRackModuleId => typeof item === 'string' && knownIds.has(item));
  if (order.length !== candidate.order.length || new Set(order).size !== order.length) {
    return defaultDspRackState();
  }
  for (const moduleId of dspRackModuleIds) {
    if (!order.includes(moduleId)) order.push(moduleId);
  }

  const defaultsState = defaultDspRackState();
  const defaults = defaultsState.compressor;
  const compressorInput = candidate.compressor && typeof candidate.compressor === 'object' && !Array.isArray(candidate.compressor)
    ? candidate.compressor as Partial<CompressorState>
    : {};
  const number = (input: unknown, fallback: number, min: number, max: number): number => {
    return typeof input === 'number' && Number.isFinite(input)
      ? Math.max(min, Math.min(max, input))
      : fallback;
  };
  const compressor: CompressorState = {
    enabled: compressorInput.enabled === true,
    thresholdDb: number(compressorInput.thresholdDb, defaults.thresholdDb, compressorThresholdMinDb, compressorThresholdMaxDb),
    ratio: number(compressorInput.ratio, defaults.ratio, compressorRatioMin, compressorRatioMax),
    attackMs: number(compressorInput.attackMs, defaults.attackMs, compressorAttackMinMs, compressorAttackMaxMs),
    releaseMs: number(compressorInput.releaseMs, defaults.releaseMs, compressorReleaseMinMs, compressorReleaseMaxMs),
    kneeDb: number(compressorInput.kneeDb, defaults.kneeDb, compressorKneeMinDb, compressorKneeMaxDb),
    makeupDb: number(compressorInput.makeupDb, defaults.makeupDb, compressorMakeupMinDb, compressorMakeupMaxDb),
    mix: number(compressorInput.mix, defaults.mix, 0, 1),
    gainReductionDb: Math.max(0, number(compressorInput.gainReductionDb, 0, 0, 144)),
    clippingRisk: compressorInput.clippingRisk === true,
  };
  const object = <T>(input: unknown): Partial<T> => input && typeof input === 'object' && !Array.isArray(input)
    ? input as Partial<T>
    : {};
  const crossfeedInput = object<CrossfeedState>(candidate.crossfeed);
  const stereoFieldInput = object<StereoFieldState>(candidate.stereoField);
  const channelMatrixInput = object<ChannelMatrixState>(candidate.channelMatrix);
  const crossfeed: CrossfeedState = {
    enabled: crossfeedInput.enabled === true,
    amount: number(crossfeedInput.amount, defaultsState.crossfeed.amount, 0, 1),
    cutoffHz: number(crossfeedInput.cutoffHz, defaultsState.crossfeed.cutoffHz, 100, 4_000),
  };
  const stereoField: StereoFieldState = {
    enabled: stereoFieldInput.enabled === true,
    width: number(stereoFieldInput.width, defaultsState.stereoField.width, 0, 2),
    centerGainDb: number(stereoFieldInput.centerGainDb, defaultsState.stereoField.centerGainDb, -18, 18),
    sideGainDb: number(stereoFieldInput.sideGainDb, defaultsState.stereoField.sideGainDb, -18, 18),
    clippingRisk: stereoFieldInput.clippingRisk === true,
  };
  const channelMatrix: ChannelMatrixState = {
    enabled: channelMatrixInput.enabled === true,
    leftToLeft: number(channelMatrixInput.leftToLeft, defaultsState.channelMatrix.leftToLeft, -2, 2),
    rightToLeft: number(channelMatrixInput.rightToLeft, defaultsState.channelMatrix.rightToLeft, -2, 2),
    leftToRight: number(channelMatrixInput.leftToRight, defaultsState.channelMatrix.leftToRight, -2, 2),
    rightToRight: number(channelMatrixInput.rightToRight, defaultsState.channelMatrix.rightToRight, -2, 2),
    clippingRisk: channelMatrixInput.clippingRisk === true,
  };

  return {
    schemaVersion: 3,
    order,
    compressor,
    crossfeed,
    stereoField,
    channelMatrix,
    reorderableModules: [...dspRackModuleIds],
    fixedPostStages: [...dspRackFixedPostStageIds],
  };
};
