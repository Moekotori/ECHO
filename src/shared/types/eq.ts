export const eqFrequenciesHz = [
  20,
  25,
  31.5,
  40,
  50,
  63,
  80,
  100,
  125,
  160,
  200,
  250,
  315,
  400,
  500,
  630,
  800,
  1000,
  1250,
  1600,
  2000,
  2500,
  3150,
  4000,
  5000,
  6300,
  8000,
  10000,
  12500,
  16000,
  20000,
] as const;

export const eqBandCount = eqFrequenciesHz.length;
export const eqMinGainDb = -12;
export const eqMaxGainDb = 12;
export const eqMinPreampDb = -12;
export const eqMaxPreampDb = 6;
export const eqMinFrequencyHz = 20;
export const eqMaxFrequencyHz = 20000;
export const eqMinQ = 0.1;
export const eqMaxQ = 12;
export const dspHeadroomMinDb = -12;
export const dspHeadroomMaxDb = 0;

export const eqFilterTypes = ['peaking', 'lowShelf', 'highShelf', 'lowPass', 'highPass', 'notch'] as const;

export type EqFilterType = (typeof eqFilterTypes)[number];

export type EqBand = {
  frequencyHz: number;
  gainDb: number;
  q: number;
  filterType?: EqFilterType;
  enabled?: boolean;
};

export type EqState = {
  enabled: boolean;
  preampDb: number;
  dspHeadroomDb?: number;
  dspSafetyLimiterEnabled?: boolean;
  bands: EqBand[];
  presetId: string;
  presetName: string;
  clippingRisk: boolean;
};

export type EqPreset = {
  id: string;
  name: string;
  preampDb: number;
  bands: EqBand[];
  createdAt: string;
  updatedAt: string;
  readonly: boolean;
};

export type EqPresetImportMetadata = {
  source: 'echo-json' | 'equalizer-apo';
  importedFilterCount: number;
  skippedFilterCount: number;
  graphicEqPointCount: number;
  includedFileCount: number;
  skippedIncludeCount: number;
  unsupportedDirectiveCount: number;
  unsupportedDirectiveSummary: Record<string, number>;
  channelScopedFilterCount: number;
  bandwidthFilterCount: number;
  warnings: string[];
};

export type EqPresetImportResult = {
  preset: EqPreset;
  metadata: EqPresetImportMetadata;
};

export type EqPresetImportPreviewResult = {
  request: EqSavePresetRequest;
  metadata: EqPresetImportMetadata;
  fileName: string;
};

export type EqSetBandGainRequest = {
  band: number;
  gainDb: number;
};

export type EqSetBandFrequencyRequest = {
  band: number;
  frequencyHz: number;
};

export type EqSetBandQRequest = {
  band: number;
  q: number;
};

export type EqSetBandFilterTypeRequest = {
  band: number;
  filterType: EqFilterType;
};

export type EqSetBandEnabledRequest = {
  band: number;
  enabled: boolean;
};

export type EqSavePresetRequest = {
  id?: string;
  name: string;
  preampDb: number;
  bands: EqBand[];
};

export type EqProfileBindingTarget = {
  outputMode?: string | null;
  outputDeviceId?: string | null;
  outputDeviceName?: string | null;
  outputDeviceType?: string | null;
  outputBackend?: string | null;
  sharedBackend?: string | null;
  deviceIndex?: number | null;
  deviceName?: string | null;
};

export type EqProfileBinding = {
  key: string;
  label: string;
  outputMode: string;
  createdAt: string;
};

export type EqProfile = {
  id: string;
  name: string;
  state: EqState;
  bindings: EqProfileBinding[];
  createdAt: string;
  updatedAt: string;
};

export type EqSaveProfileRequest = {
  id?: string;
  name: string;
  state: EqState;
};

export type EqBindProfileRequest = {
  profileId: string;
  target: EqProfileBindingTarget;
};

export type EqProfileBindingInfo = {
  key: string;
  label: string;
  profileId: string;
  profileName: string;
} | null;

export type RoomCorrectionStatus = 'empty' | 'loaded' | 'active' | 'error';

export type RoomCorrectionChannelMode = 'none' | 'mono' | 'stereo';

export type RoomCorrectionState = {
  enabled: boolean;
  status: RoomCorrectionStatus;
  irId: string | null;
  irName: string | null;
  channelMode: RoomCorrectionChannelMode;
  sampleRate: number | null;
  tapCount: number;
  trimDb: number;
  latencySamples: number;
  clippingRisk: boolean;
  error: string | null;
};

export const roomCorrectionMinTrimDb = -24;
export const roomCorrectionMaxTrimDb = 6;
export const roomCorrectionMaxTaps = 8192;
