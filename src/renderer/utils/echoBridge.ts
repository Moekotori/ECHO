import type { ChannelBalanceMonoMode, ChannelBalanceState } from '../../shared/types/audio';
import {
  channelBalanceMaxBalance,
  channelBalanceMaxDelayMs,
  channelBalanceMaxGainDb,
  channelBalanceMinBalance,
  channelBalanceMinDelayMs,
  channelBalanceMinGainDb,
} from '../../shared/types/audio';
import type {
  OpraHeadphoneCorrectionApplyResult,
  OpraHeadphoneCorrectionBrowseRequest,
  OpraHeadphoneCorrectionBrowseResult,
  OpraHeadphoneCorrectionSearchRequest,
  OpraHeadphoneCorrectionSearchResult,
} from '../../shared/types/opra';
import type {
  EqBand,
  EqFilterType,
  EqPreset,
  EqPresetImportMetadata,
  EqPresetImportPreviewResult,
  EqPresetImportResult,
  EqProfile,
  EqProfileBinding,
  EqProfileBindingInfo,
  EqProfileBindingTarget,
  EqSavePresetRequest,
  EqSaveProfileRequest,
  EqSetBandEnabledRequest,
  EqSetBandFilterTypeRequest,
  EqSetBandFrequencyRequest,
  EqSetBandGainRequest,
  EqSetBandQRequest,
  EqState,
  RoomCorrectionState,
} from '../../shared/types/eq';
import {
  dspHeadroomMaxDb,
  dspHeadroomMinDb,
  eqBandCount,
  eqFilterTypes,
  eqFrequenciesHz,
  eqMaxFrequencyHz,
  eqMaxGainDb,
  eqMaxPreampDb,
  eqMaxQ,
  eqMinFrequencyHz,
  eqMinGainDb,
  eqMinPreampDb,
  eqMinQ,
} from '../../shared/types/eq';
import { builtInEqPresetDefinitions } from '../../shared/audio/eqBuiltInPresets';
import { formatEqualizerApoGraphicEqPreset, formatEqualizerApoPreset, parseEqualizerApoPreset } from '../../shared/utils/equalizerApoPreset';
import type {
  StreamingFavoriteCollectionDeleteResult,
  StreamingFavoriteCollectionRenameResult,
  StreamingFavoritesImportResult,
  StreamingLikedSongsSyncResult,
  StreamingPlaylistImportResult,
} from '../../shared/types/streaming';

export const getEchoBridge = (): Window['echo'] | null => window.echo ?? null;

export const getAppBridge = (): Window['echo']['app'] | null => getEchoBridge()?.app ?? null;

export const getAudioBridge = (): Window['echo']['audio'] | null => getEchoBridge()?.audio ?? null;

export const getAccountsBridge = (): Window['echo']['accounts'] | null => getEchoBridge()?.accounts ?? null;

export const getDiagnosticsBridge = (): Window['echo']['diagnostics'] | null => getEchoBridge()?.diagnostics ?? null;

export const getDiscordPresenceBridge = (): Window['echo']['discordPresence'] | null => getEchoBridge()?.discordPresence ?? null;

export const getDownloadsBridge = (): Window['echo']['downloads'] | null => getEchoBridge()?.downloads ?? null;

export const getPluginsBridge = (): Window['echo']['plugins'] | null => getEchoBridge()?.plugins ?? null;

const browserEqStorageKey = 'echo-next.browser-eq';

type BrowserEqStorage = {
  state: EqState;
  channelBalance: ChannelBalanceState;
  roomCorrection: RoomCorrectionState;
  userPresets: EqPreset[];
  profiles: EqProfile[];
};

type EqBridgeApi = NonNullable<Window['echo']>['eq'];

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const nowIso = (): string => new Date().toISOString();

const filterTypes = new Set<EqFilterType>(eqFilterTypes);
const legacyEqBandCount = 10;

const normalizeFilterType = (value: unknown): EqFilterType => (filterTypes.has(value as EqFilterType) ? value as EqFilterType : 'peaking');

const createBands = (gains: number[] = []): EqBand[] =>
  eqFrequenciesHz.map((frequencyHz, index) => ({
    frequencyHz,
    gainDb: clamp(Number(gains[index] ?? 0), eqMinGainDb, eqMaxGainDb),
    q: 1,
    filterType: 'peaking',
    enabled: true,
  }));

const browserBuiltInPresets: EqPreset[] = builtInEqPresetDefinitions.map((preset) => ({
  id: preset.id,
  name: preset.name,
  preampDb: preset.preampDb,
  bands: createBands(preset.gains),
  createdAt: 'built-in',
  updatedAt: 'built-in',
  readonly: true,
}));

const defaultBrowserEqState = (): EqState => ({
  enabled: false,
  preampDb: 0,
  dspHeadroomDb: 0,
  dspSafetyLimiterEnabled: true,
  bands: createBands(),
  presetId: 'flat',
  presetName: 'Flat',
  clippingRisk: false,
});

const defaultBrowserChannelBalance = (): ChannelBalanceState => ({
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  leftDelayMs: 0,
  rightDelayMs: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: true,
  clippingRisk: false,
});

const defaultBrowserRoomCorrection = (): RoomCorrectionState => ({
  enabled: false,
  status: 'empty',
  irId: null,
  irName: null,
  channelMode: 'none',
  sampleRate: null,
  tapCount: 0,
  trimDb: 0,
  latencySamples: 0,
  clippingRisk: false,
  error: null,
});

const cloneBands = (bands: EqBand[]): EqBand[] => bands.map((band) => ({ ...band }));

const clonePreset = (preset: EqPreset): EqPreset => ({ ...preset, bands: cloneBands(preset.bands) });

const cloneState = (state: EqState): EqState => ({ ...state, bands: cloneBands(state.bands) });

const cloneProfile = (profile: EqProfile): EqProfile => ({
  ...profile,
  state: cloneState(profile.state),
  bindings: profile.bindings.map((binding) => ({ ...binding })),
});

const sanitizePresetId = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || `preset-${Date.now()}`;

const uniquePresetId = (name: string, existingIds: Set<string>): string => {
  const baseId = sanitizePresetId(name);
  let candidate = baseId;
  let suffix = 2;

  while (existingIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidate;
};

const normalizeBands = (bands: unknown, fallback = createBands()): EqBand[] => {
  if (!Array.isArray(bands) || (bands.length !== eqBandCount && bands.length !== legacyEqBandCount)) {
    return cloneBands(fallback);
  }

  return Array.from({ length: eqBandCount }, (_, index) => {
    const value = bands[index] ?? fallback[index] ?? null;
    const input = value as Partial<EqBand> | null;
    const frequencyHz = Number(input?.frequencyHz ?? eqFrequenciesHz[index]);
    const gainDb = Number(input?.gainDb ?? 0);
    const q = Number(input?.q ?? 1);

    return {
      frequencyHz: Number.isFinite(frequencyHz) ? clamp(frequencyHz, eqMinFrequencyHz, eqMaxFrequencyHz) : eqFrequenciesHz[index],
      gainDb: Number.isFinite(gainDb) ? clamp(gainDb, eqMinGainDb, eqMaxGainDb) : 0,
      q: Number.isFinite(q) && q > 0 ? clamp(q, eqMinQ, eqMaxQ) : 1,
      filterType: normalizeFilterType(input?.filterType),
      enabled: input?.enabled !== false,
    };
  });
};

const normalizeState = (value: unknown): EqState => {
  if (!value || typeof value !== 'object') {
    return defaultBrowserEqState();
  }

  const input = value as Partial<EqState>;
  const preampDb = Number(input.preampDb ?? 0);
  const dspHeadroomDb = Number(input.dspHeadroomDb ?? 0);

  return {
    enabled: Boolean(input.enabled),
    preampDb: Number.isFinite(preampDb) ? clamp(preampDb, eqMinPreampDb, eqMaxPreampDb) : 0,
    dspHeadroomDb: Number.isFinite(dspHeadroomDb) ? clamp(dspHeadroomDb, dspHeadroomMinDb, dspHeadroomMaxDb) : 0,
    dspSafetyLimiterEnabled: input.dspSafetyLimiterEnabled !== false,
    bands: normalizeBands(input.bands),
    presetId: typeof input.presetId === 'string' && input.presetId ? input.presetId : 'flat',
    presetName: typeof input.presetName === 'string' && input.presetName ? input.presetName : 'Flat',
    clippingRisk: Boolean(input.clippingRisk),
  };
};

const normalizeChannelBalance = (patch: Partial<ChannelBalanceState>, fallback = defaultBrowserChannelBalance()): ChannelBalanceState => {
  const balance = Number(patch.balance ?? fallback.balance);
  const leftGainDb = Number(patch.leftGainDb ?? fallback.leftGainDb);
  const rightGainDb = Number(patch.rightGainDb ?? fallback.rightGainDb);
  const leftDelayMs = Number(patch.leftDelayMs ?? fallback.leftDelayMs ?? 0);
  const rightDelayMs = Number(patch.rightDelayMs ?? fallback.rightDelayMs ?? 0);
  const monoModes = new Set<ChannelBalanceMonoMode>(['off', 'sum', 'left', 'right']);

  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : fallback.enabled,
    balance: Number.isFinite(balance) ? clamp(balance, channelBalanceMinBalance, channelBalanceMaxBalance) : fallback.balance,
    leftGainDb: Number.isFinite(leftGainDb) ? clamp(leftGainDb, channelBalanceMinGainDb, channelBalanceMaxGainDb) : fallback.leftGainDb,
    rightGainDb: Number.isFinite(rightGainDb) ? clamp(rightGainDb, channelBalanceMinGainDb, channelBalanceMaxGainDb) : fallback.rightGainDb,
    leftDelayMs: Number.isFinite(leftDelayMs) ? clamp(leftDelayMs, channelBalanceMinDelayMs, channelBalanceMaxDelayMs) : fallback.leftDelayMs ?? 0,
    rightDelayMs: Number.isFinite(rightDelayMs) ? clamp(rightDelayMs, channelBalanceMinDelayMs, channelBalanceMaxDelayMs) : fallback.rightDelayMs ?? 0,
    swapLeftRight: typeof patch.swapLeftRight === 'boolean' ? patch.swapLeftRight : fallback.swapLeftRight,
    monoMode: typeof patch.monoMode === 'string' && monoModes.has(patch.monoMode) ? patch.monoMode : fallback.monoMode,
    invertLeft: typeof patch.invertLeft === 'boolean' ? patch.invertLeft : fallback.invertLeft,
    invertRight: typeof patch.invertRight === 'boolean' ? patch.invertRight : fallback.invertRight,
    constantPower: typeof patch.constantPower === 'boolean' ? patch.constantPower : fallback.constantPower,
    clippingRisk: typeof patch.clippingRisk === 'boolean' ? patch.clippingRisk : fallback.clippingRisk,
  };
};

const normalizePreset = (value: unknown): EqPreset | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const input = value as Partial<EqPreset>;
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 64) : null;
  const id = typeof input.id === 'string' && input.id.trim() ? sanitizePresetId(input.id) : name ? sanitizePresetId(name) : null;
  const preampDb = Number(input.preampDb ?? 0);

  if (!id || !name || !Number.isFinite(preampDb)) {
    return null;
  }

  return {
    id,
    name,
    preampDb: clamp(preampDb, eqMinPreampDb, eqMaxPreampDb),
    bands: normalizeBands(input.bands),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : nowIso(),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : nowIso(),
    readonly: Boolean(input.readonly),
  };
};

const normalizeProfileBinding = (value: unknown): EqProfileBinding | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const input = value as Partial<EqProfileBinding>;
  const key = typeof input.key === 'string' && input.key.trim() ? input.key.trim().slice(0, 512) : null;
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 160) : null;

  if (!key || !label) {
    return null;
  }

  return {
    key,
    label,
    outputMode: typeof input.outputMode === 'string' && input.outputMode.trim() ? input.outputMode.trim().slice(0, 48) : 'shared',
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : nowIso(),
  };
};

const normalizeProfile = (value: unknown): EqProfile | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const input = value as Partial<EqProfile>;
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 64) : null;
  const id = typeof input.id === 'string' && input.id.trim() ? sanitizePresetId(input.id) : name ? sanitizePresetId(name) : null;

  if (!id || !name || !input.state) {
    return null;
  }

  return {
    id,
    name,
    state: normalizeState(input.state),
    bindings: Array.isArray(input.bindings)
      ? input.bindings.map(normalizeProfileBinding).filter((binding): binding is EqProfileBinding => Boolean(binding))
      : [],
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : nowIso(),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : nowIso(),
  };
};

const buildProfileBinding = (target: EqProfileBindingTarget): EqProfileBinding => {
  const outputMode = typeof target.outputMode === 'string' && target.outputMode.trim() ? target.outputMode.trim() : 'shared';
  const deviceId = typeof target.outputDeviceId === 'string' && target.outputDeviceId.trim() ? target.outputDeviceId.trim() : null;
  const deviceName = typeof target.outputDeviceName === 'string' && target.outputDeviceName.trim()
    ? target.outputDeviceName.trim()
    : typeof target.deviceName === 'string' && target.deviceName.trim()
      ? target.deviceName.trim()
      : 'System default output';
  const identity = {
    outputMode,
    outputBackend: typeof target.outputBackend === 'string' && target.outputBackend.trim() ? target.outputBackend.trim() : null,
    sharedBackend: typeof target.sharedBackend === 'string' && target.sharedBackend.trim() ? target.sharedBackend.trim() : null,
    deviceId,
    deviceName,
    deviceType: typeof target.outputDeviceType === 'string' && target.outputDeviceType.trim() ? target.outputDeviceType.trim() : null,
    deviceIndex: Number.isInteger(target.deviceIndex) ? Number(target.deviceIndex) : null,
  };

  return {
    key: JSON.stringify(identity),
    label: `${outputMode.toUpperCase()} / ${deviceName}`,
    outputMode,
    createdAt: nowIso(),
  };
};

const canUseLocalStorage = (): boolean => {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage);
  } catch {
    return false;
  }
};

class BrowserEqBridge implements EqBridgeApi {
  private storage: BrowserEqStorage = {
    state: defaultBrowserEqState(),
    channelBalance: defaultBrowserChannelBalance(),
    roomCorrection: defaultBrowserRoomCorrection(),
    userPresets: [],
    profiles: [],
  };

  constructor() {
    this.storage = this.readStorage();
  }

  async getState(): Promise<EqState> {
    return cloneState(this.storage.state);
  }

  async setEnabled(enabled: boolean): Promise<EqState> {
    this.storage.state = { ...this.storage.state, enabled };
    this.writeStorage();
    return this.getState();
  }

  async setBandGain({ band, gainDb }: EqSetBandGainRequest): Promise<EqState> {
    this.assertBandIndex(band);
    const rawGainDb = Number(gainDb);
    if (!Number.isFinite(rawGainDb)) {
      throw new Error('invalid_eq_band_gain');
    }

    const safeGainDb = clamp(rawGainDb, eqMinGainDb, eqMaxGainDb);
    this.storage.state = {
      ...this.storage.state,
      presetId: 'custom',
      presetName: 'Custom',
      bands: this.storage.state.bands.map((item, index) => (index === band ? { ...item, gainDb: safeGainDb } : item)),
    };
    this.writeStorage();
    return this.getState();
  }

  async setBandFrequency({ band, frequencyHz }: EqSetBandFrequencyRequest): Promise<EqState> {
    this.assertBandIndex(band);
    const rawFrequencyHz = Number(frequencyHz);
    if (!Number.isFinite(rawFrequencyHz)) {
      throw new Error('invalid_eq_band_frequency');
    }

    const safeFrequencyHz = clamp(rawFrequencyHz, eqMinFrequencyHz, eqMaxFrequencyHz);
    this.storage.state = {
      ...this.storage.state,
      presetId: 'custom',
      presetName: 'Custom',
      bands: this.storage.state.bands.map((item, index) => (index === band ? { ...item, frequencyHz: safeFrequencyHz } : item)),
    };
    this.writeStorage();
    return this.getState();
  }

  async setBandQ({ band, q }: EqSetBandQRequest): Promise<EqState> {
    this.assertBandIndex(band);
    const rawQ = Number(q);
    if (!Number.isFinite(rawQ)) {
      throw new Error('invalid_eq_band_q');
    }

    const safeQ = clamp(rawQ, eqMinQ, eqMaxQ);
    this.storage.state = {
      ...this.storage.state,
      presetId: 'custom',
      presetName: 'Custom',
      bands: this.storage.state.bands.map((item, index) => (index === band ? { ...item, q: safeQ } : item)),
    };
    this.writeStorage();
    return this.getState();
  }

  async setBandFilterType({ band, filterType }: EqSetBandFilterTypeRequest): Promise<EqState> {
    this.assertBandIndex(band);
    const safeFilterType = normalizeFilterType(filterType);
    this.storage.state = {
      ...this.storage.state,
      presetId: 'custom',
      presetName: 'Custom',
      bands: this.storage.state.bands.map((item, index) => (index === band ? { ...item, filterType: safeFilterType } : item)),
    };
    this.writeStorage();
    return this.getState();
  }

  async setBandEnabled({ band, enabled }: EqSetBandEnabledRequest): Promise<EqState> {
    this.assertBandIndex(band);
    this.storage.state = {
      ...this.storage.state,
      presetId: 'custom',
      presetName: 'Custom',
      bands: this.storage.state.bands.map((item, index) => (index === band ? { ...item, enabled: enabled === true } : item)),
    };
    this.writeStorage();
    return this.getState();
  }

  async setPreamp(preampDb: number): Promise<EqState> {
    const rawPreampDb = Number(preampDb);
    if (!Number.isFinite(rawPreampDb)) {
      throw new Error('invalid_eq_preamp');
    }

    const safePreampDb = clamp(rawPreampDb, eqMinPreampDb, eqMaxPreampDb);
    this.storage.state = { ...this.storage.state, preampDb: safePreampDb, presetId: 'custom', presetName: 'Custom' };
    this.writeStorage();
    return this.getState();
  }

  async setDspHeadroom(headroomDb: number): Promise<EqState> {
    const rawHeadroomDb = Number(headroomDb);
    if (!Number.isFinite(rawHeadroomDb)) {
      throw new Error('invalid_dsp_headroom');
    }

    const safeHeadroomDb = clamp(rawHeadroomDb, dspHeadroomMinDb, dspHeadroomMaxDb);
    this.storage.state = { ...this.storage.state, dspHeadroomDb: safeHeadroomDb };
    this.writeStorage();
    return this.getState();
  }

  async setDspSafetyLimiterEnabled(enabled: boolean): Promise<EqState> {
    this.storage.state = { ...this.storage.state, dspSafetyLimiterEnabled: enabled !== false };
    this.writeStorage();
    return this.getState();
  }

  async setPreset(presetId: string): Promise<EqState> {
    const preset = this.allPresets().find((item) => item.id === presetId);

    if (!preset) {
      throw new Error('eq_preset_not_found');
    }

    this.storage.state = {
      enabled: this.storage.state.enabled,
      preampDb: preset.preampDb,
      dspHeadroomDb: this.storage.state.dspHeadroomDb,
      dspSafetyLimiterEnabled: this.storage.state.dspSafetyLimiterEnabled !== false,
      bands: cloneBands(preset.bands),
      presetId: preset.id,
      presetName: preset.name,
      clippingRisk: false,
    };
    this.writeStorage();
    return this.getState();
  }

  async reset(): Promise<EqState> {
    return this.setPreset('flat');
  }

  async listPresets(): Promise<EqPreset[]> {
    return this.allPresets().map(clonePreset);
  }

  async savePreset(request: EqSavePresetRequest): Promise<EqPreset> {
    const normalized = normalizePreset({
      id: request.id ?? sanitizePresetId(request.name),
      name: request.name,
      preampDb: request.preampDb,
      bands: request.bands,
      readonly: false,
    });

    if (!normalized) {
      throw new Error('invalid_eq_preset');
    }

    if (browserBuiltInPresets.some((preset) => preset.id === normalized.id)) {
      throw new Error('cannot_overwrite_builtin_eq_preset');
    }

    const existingIndex = this.storage.userPresets.findIndex((preset) => preset.id === normalized.id);
    const existing = existingIndex >= 0 ? this.storage.userPresets[existingIndex] : null;
    const preset: EqPreset = {
      ...normalized,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      readonly: false,
    };

    if (existingIndex >= 0) {
      this.storage.userPresets[existingIndex] = preset;
    } else {
      this.storage.userPresets.push(preset);
    }

    this.writeStorage();
    return clonePreset(preset);
  }

  async exportPreset(request: EqSavePresetRequest): Promise<string | null> {
    const normalized = normalizePreset({
      id: request.id ?? sanitizePresetId(request.name),
      name: request.name,
      preampDb: request.preampDb,
      bands: request.bands,
      readonly: false,
    });

    if (!normalized) {
      throw new Error('invalid_eq_preset');
    }

    const fileName = `${sanitizePresetId(normalized.name) || 'echo-next-eq-preset'}.json`;
    const content = `${JSON.stringify(
      {
        type: 'echo-next-eq-preset',
        version: 1,
        exportedAt: new Date().toISOString(),
        preset: {
          name: normalized.name,
          preampDb: normalized.preampDb,
          bands: normalized.bands,
        },
      },
      null,
      2,
    )}\n`;

    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return fileName;
  }

  async exportApoPreset(request: EqSavePresetRequest): Promise<string | null> {
    const normalized = normalizePreset({
      id: request.id ?? sanitizePresetId(request.name),
      name: request.name,
      preampDb: request.preampDb,
      bands: request.bands,
      readonly: false,
    });

    if (!normalized) {
      throw new Error('invalid_eq_preset');
    }

    const fileName = `${sanitizePresetId(normalized.name) || 'echo-next-eq-preset'}.txt`;
    const blob = new Blob([formatEqualizerApoPreset({
      name: normalized.name,
      preampDb: normalized.preampDb,
      bands: normalized.bands,
    })], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return fileName;
  }

  async exportApoGraphicEqPreset(request: EqSavePresetRequest): Promise<string | null> {
    const normalized = normalizePreset({
      id: request.id ?? sanitizePresetId(request.name),
      name: request.name,
      preampDb: request.preampDb,
      bands: request.bands,
      readonly: false,
    });

    if (!normalized) {
      throw new Error('invalid_eq_preset');
    }

    const fileName = `${sanitizePresetId(normalized.name) || 'echo-next-eq-preset'}-graphic-eq.txt`;
    const blob = new Blob([formatEqualizerApoGraphicEqPreset({
      name: normalized.name,
      preampDb: normalized.preampDb,
      bands: normalized.bands,
    })], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return fileName;
  }

  async previewImportPreset(): Promise<EqPresetImportPreviewResult | null> {
    if (typeof document === 'undefined') {
      return null;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json,.txt,.cfg,.apo';

    const file = await new Promise<File | null>((resolve) => {
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });

    if (!file) {
      return null;
    }

    const rawContent = await file.text();
    const trimmed = rawContent.trimStart();
    const candidate: EqSavePresetRequest & { metadata: EqPresetImportMetadata } = trimmed.startsWith('{')
      ? (() => {
        const parsed = JSON.parse(rawContent) as unknown;
        const payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as { preset?: Partial<EqSavePresetRequest>; name?: unknown; preampDb?: unknown; bands?: unknown }
          : null;
        const jsonCandidate = payload?.preset && typeof payload.preset === 'object' ? payload.preset : payload;
        if (!jsonCandidate || typeof jsonCandidate.name !== 'string') {
          throw new Error('invalid_eq_preset_import');
        }
        return {
          name: jsonCandidate.name,
          preampDb: Number(jsonCandidate.preampDb ?? 0),
          bands: jsonCandidate.bands as EqSavePresetRequest['bands'],
          metadata: {
            source: 'echo-json',
            importedFilterCount: Array.isArray(jsonCandidate.bands) ? jsonCandidate.bands.length : 0,
            skippedFilterCount: 0,
            graphicEqPointCount: 0,
            includedFileCount: 0,
            skippedIncludeCount: 0,
            unsupportedDirectiveCount: 0,
            unsupportedDirectiveSummary: {},
            channelScopedFilterCount: 0,
            bandwidthFilterCount: 0,
            warnings: [],
          },
        };
      })()
      : (() => {
        const equalizerApoPreset = parseEqualizerApoPreset(rawContent, { name: file.name.replace(/\.[^.]+$/, '') || 'Equalizer APO Import' });
        return {
          name: equalizerApoPreset.name,
          preampDb: equalizerApoPreset.preampDb,
          bands: equalizerApoPreset.bands,
          metadata: {
            source: 'equalizer-apo',
            importedFilterCount: equalizerApoPreset.importedFilterCount,
            skippedFilterCount: equalizerApoPreset.skippedFilterCount,
            graphicEqPointCount: equalizerApoPreset.graphicEqPointCount,
            includedFileCount: 0,
            skippedIncludeCount: 0,
            unsupportedDirectiveCount: equalizerApoPreset.unsupportedDirectiveCount,
            unsupportedDirectiveSummary: equalizerApoPreset.unsupportedDirectiveSummary,
            channelScopedFilterCount: equalizerApoPreset.channelScopedFilterCount,
            bandwidthFilterCount: equalizerApoPreset.bandwidthFilterCount,
            warnings: equalizerApoPreset.warnings,
          },
        };
      })();

    return {
      request: {
        id: uniquePresetId(candidate.name, new Set(this.allPresets().map((preset) => preset.id))),
        name: candidate.name,
        preampDb: Number(candidate.preampDb ?? 0),
        bands: candidate.bands,
      },
      metadata: candidate.metadata,
      fileName: file.name,
    };
  }

  async importPreset(): Promise<EqPresetImportResult | null> {
    const preview = await this.previewImportPreset();
    if (!preview) {
      return null;
    }

    const preset = await this.savePreset(preview.request);

    return {
      preset,
      metadata: preview.metadata,
    };
  }

  async deletePreset(presetId: string): Promise<EqPreset[]> {
    if (browserBuiltInPresets.some((preset) => preset.id === presetId)) {
      throw new Error('cannot_delete_builtin_eq_preset');
    }

    this.storage.userPresets = this.storage.userPresets.filter((preset) => preset.id !== presetId);
    this.writeStorage();
    return this.listPresets();
  }

  async browseHeadphoneCorrections(request: OpraHeadphoneCorrectionBrowseRequest): Promise<OpraHeadphoneCorrectionBrowseResult> {
    return {
      query: request.query ?? '',
      vendorId: request.vendorId ?? null,
      productId: request.productId ?? null,
      vendors: [],
      products: [],
      selectedProduct: null,
      status: {
        source: 'empty',
        fetchedAt: null,
        vendorCount: 0,
        productCount: 0,
        eqCount: 0,
      },
    };
  }

  async searchHeadphoneCorrections(request: OpraHeadphoneCorrectionSearchRequest): Promise<OpraHeadphoneCorrectionSearchResult> {
    return {
      query: request.query,
      results: [],
      status: {
        source: 'empty',
        fetchedAt: null,
        vendorCount: 0,
        productCount: 0,
        eqCount: 0,
      },
    };
  }

  async applyHeadphoneCorrection(): Promise<OpraHeadphoneCorrectionApplyResult> {
    throw new Error('opra_bridge_unavailable');
  }

  async listProfiles(): Promise<EqProfile[]> {
    return this.storage.profiles.map(cloneProfile);
  }

  async saveProfile(request: EqSaveProfileRequest): Promise<EqProfile> {
    const name = typeof request.name === 'string' && request.name.trim() ? request.name.trim().slice(0, 64) : null;
    const id = typeof request.id === 'string' && request.id.trim() ? sanitizePresetId(request.id) : name ? sanitizePresetId(name) : null;

    if (!id || !name) {
      throw new Error('invalid_eq_profile');
    }

    const existingIndex = this.storage.profiles.findIndex((profile) => profile.id === id);
    const existing = existingIndex >= 0 ? this.storage.profiles[existingIndex] : null;
    const profile: EqProfile = {
      id,
      name,
      state: normalizeState(request.state),
      bindings: existing?.bindings.map((binding) => ({ ...binding })) ?? [],
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };

    if (existingIndex >= 0) {
      this.storage.profiles[existingIndex] = profile;
    } else {
      this.storage.profiles.push(profile);
    }

    this.writeStorage();
    return cloneProfile(profile);
  }

  async applyProfile(profileId: string): Promise<EqState> {
    const profile = this.storage.profiles.find((item) => item.id === profileId);

    if (!profile) {
      throw new Error('eq_profile_not_found');
    }

    this.storage.state = cloneState(profile.state);
    this.writeStorage();
    return this.getState();
  }

  async deleteProfile(profileId: string): Promise<EqProfile[]> {
    this.storage.profiles = this.storage.profiles.filter((profile) => profile.id !== profileId);
    this.writeStorage();
    return this.listProfiles();
  }

  async bindProfileToOutput(request: { profileId: string; target: EqProfileBindingTarget }): Promise<EqProfileBindingInfo> {
    const binding = buildProfileBinding(request.target);
    const profileIndex = this.storage.profiles.findIndex((profile) => profile.id === request.profileId);

    if (profileIndex < 0) {
      throw new Error('eq_profile_not_found');
    }

    this.storage.profiles = this.storage.profiles.map((profile, index) => ({
      ...profile,
      bindings: index === profileIndex
        ? [...profile.bindings.filter((item) => item.key !== binding.key), binding]
        : profile.bindings.filter((item) => item.key !== binding.key),
      updatedAt: index === profileIndex ? nowIso() : profile.updatedAt,
    }));
    this.writeStorage();

    return {
      key: binding.key,
      label: binding.label,
      profileId: request.profileId,
      profileName: this.storage.profiles[profileIndex].name,
    };
  }

  async getProfileBinding(target: EqProfileBindingTarget): Promise<EqProfileBindingInfo> {
    const binding = buildProfileBinding(target);
    const profile = this.storage.profiles.find((item) => item.bindings.some((profileBinding) => profileBinding.key === binding.key));

    if (!profile) {
      return null;
    }

    const storedBinding = profile.bindings.find((profileBinding) => profileBinding.key === binding.key) ?? binding;
    return {
      key: storedBinding.key,
      label: storedBinding.label,
      profileId: profile.id,
      profileName: profile.name,
    };
  }

  async getChannelBalanceState(): Promise<ChannelBalanceState> {
    return { ...this.storage.channelBalance };
  }

  async setChannelBalanceState(patch: Partial<ChannelBalanceState>): Promise<ChannelBalanceState> {
    this.storage.channelBalance = normalizeChannelBalance(patch, this.storage.channelBalance);
    this.writeStorage();
    return this.getChannelBalanceState();
  }

  async resetChannelBalance(): Promise<ChannelBalanceState> {
    this.storage.channelBalance = defaultBrowserChannelBalance();
    this.writeStorage();
    return this.getChannelBalanceState();
  }

  async getRoomCorrectionState(): Promise<RoomCorrectionState> {
    return { ...this.storage.roomCorrection };
  }

  async importRoomCorrectionIr(): Promise<RoomCorrectionState | null> {
    this.storage.roomCorrection = {
      ...this.storage.roomCorrection,
      enabled: this.storage.roomCorrection.enabled,
      status: this.storage.roomCorrection.enabled ? 'active' : 'loaded',
      irId: `browser-ir-${Date.now()}`,
      irName: 'Browser IR',
      channelMode: 'mono',
      sampleRate: 44100,
      tapCount: 1,
      error: null,
    };
    this.writeStorage();
    return this.getRoomCorrectionState();
  }

  async setRoomCorrectionEnabled(enabled: boolean): Promise<RoomCorrectionState> {
    const hasIr = Boolean(this.storage.roomCorrection.irId);
    this.storage.roomCorrection = {
      ...this.storage.roomCorrection,
      enabled: enabled === true && hasIr,
      status: !hasIr ? 'empty' : enabled === true ? 'active' : 'loaded',
      error: !hasIr && enabled === true ? 'missing_ir' : null,
    };
    this.writeStorage();
    return this.getRoomCorrectionState();
  }

  async setRoomCorrectionTrim(trimDb: number): Promise<RoomCorrectionState> {
    const safeTrimDb = Number.isFinite(trimDb) ? clamp(trimDb, -24, 6) : 0;
    this.storage.roomCorrection = { ...this.storage.roomCorrection, trimDb: safeTrimDb };
    this.writeStorage();
    return this.getRoomCorrectionState();
  }

  async clearRoomCorrection(): Promise<RoomCorrectionState> {
    this.storage.roomCorrection = defaultBrowserRoomCorrection();
    this.writeStorage();
    return this.getRoomCorrectionState();
  }

  private allPresets(): EqPreset[] {
    return [...browserBuiltInPresets, ...this.storage.userPresets];
  }

  private assertBandIndex(band: number): void {
    if (!Number.isInteger(band) || band < 0 || band >= eqBandCount) {
      throw new Error('invalid_eq_band_index');
    }
  }

  private readStorage(): BrowserEqStorage {
    if (!canUseLocalStorage()) {
      return this.storage;
    }

    try {
      const parsed = JSON.parse(window.localStorage.getItem(browserEqStorageKey) ?? '{}') as Partial<BrowserEqStorage>;
      return {
        state: normalizeState(parsed.state),
        channelBalance: normalizeChannelBalance(parsed.channelBalance ?? {}, defaultBrowserChannelBalance()),
        roomCorrection: { ...defaultBrowserRoomCorrection(), ...(parsed.roomCorrection ?? {}) },
        userPresets: Array.isArray(parsed.userPresets)
          ? parsed.userPresets.map(normalizePreset).filter((preset): preset is EqPreset => Boolean(preset && !preset.readonly))
          : [],
        profiles: Array.isArray(parsed.profiles)
          ? parsed.profiles.map(normalizeProfile).filter((profile): profile is EqProfile => Boolean(profile))
          : [],
      };
    } catch {
      return this.storage;
    }
  }

  private writeStorage(): void {
    if (!canUseLocalStorage()) {
      return;
    }

    window.localStorage.setItem(browserEqStorageKey, JSON.stringify(this.storage));
  }
}

let browserEqBridge: EqBridgeApi | null = null;

const getBrowserEqBridge = (): EqBridgeApi => {
  browserEqBridge ??= new BrowserEqBridge();
  return browserEqBridge;
};

export const getEqBridge = (): Window['echo']['eq'] | null => getEchoBridge()?.eq ?? getBrowserEqBridge();

export const getLibraryBridge = (): Window['echo']['library'] | null => getEchoBridge()?.library ?? null;

export const getLibraryLabBridge = (): Window['echo']['libraryLab'] | null => getEchoBridge()?.libraryLab ?? null;

export const getLastFmBridge = (): Window['echo']['lastfm'] | null => getEchoBridge()?.lastfm ?? null;

export const getHqPlayerBridge = (): Window['echo']['hqPlayer'] | null => getEchoBridge()?.hqPlayer ?? null;

export const getMvBridge = (): Window['echo']['mv'] | null => getEchoBridge()?.mv ?? null;

export const getPlaybackBridge = (): Window['echo']['playback'] | null => getEchoBridge()?.playback ?? null;

export const getRemoteSourcesBridge = (): Window['echo']['remoteSources'] | null => getEchoBridge()?.remoteSources ?? null;

export const getSmtcBridge = (): Window['echo']['smtc'] | null => getEchoBridge()?.smtc ?? null;

type StreamingBridgeApi = NonNullable<Window['echo']>['streaming'];

const devApiBaseUrl = 'http://127.0.0.1:5174';

const importPlaylistFromDevApi = async (url: string): Promise<StreamingPlaylistImportResult> => {
  const response = await fetch(`${devApiBaseUrl}/streaming/import-playlist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  }).catch(() => {
    throw new Error('本地开发接口未启动，请重启 npm run dev 后再添加歌单。');
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? '添加流媒体歌单失败');
  }

  return payload as StreamingPlaylistImportResult;
};

const refreshNeteaseDailyRecommendFromDevApi = async (): Promise<StreamingPlaylistImportResult> => {
  const response = await fetch(`${devApiBaseUrl}/streaming/netease-daily-recommend`, {
    method: 'POST',
  }).catch(() => {
    throw new Error('本地开发接口未启动，请重启 npm run dev 后再刷新每日推荐。');
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? '刷新网易云每日推荐失败。');
  }

  return payload as StreamingPlaylistImportResult;
};

const syncLikedSongsFromDevApi = async (provider?: 'netease' | 'qqmusic'): Promise<StreamingLikedSongsSyncResult> => {
  const response = await fetch(`${devApiBaseUrl}/streaming/sync-liked-songs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  }).catch(() => {
    throw new Error('本地开发接口未启动，请重启 npm run dev 后再同步喜欢歌单。');
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? '同步在线喜欢歌单失败。');
  }

  return payload as StreamingLikedSongsSyncResult;
};

const setStreamingTrackLikedFromDevApi = async (request: {
  provider: 'netease' | 'qqmusic';
  providerTrackId: string;
  liked: boolean;
}): Promise<{ liked: boolean }> => {
  const response = await fetch(`${devApiBaseUrl}/streaming/set-track-liked`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  }).catch(() => {
    throw new Error('Local development API is unavailable. Restart npm run dev before syncing liked tracks.');
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? 'Failed to sync liked track.');
  }

  return payload as { liked: boolean };
};

const browserStreamingBridge: StreamingBridgeApi = {
  search: async () => {
    throw new Error('桌面桥接不可用，请在 ECHO Next 客户端窗口中搜索流媒体。');
  },
  getTrack: async () => {
    throw new Error('桌面桥接不可用，请在 ECHO Next 客户端窗口中读取流媒体歌曲。');
  },
  getAlbum: async () => {
    throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to read streaming albums.');
  },
  getArtist: async () => {
    throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to read streaming artists.');
  },
  resolvePlayback: async () => {
    throw new Error('桌面桥接不可用，请在 ECHO Next 客户端窗口中播放流媒体。');
  },
  analyzeBpm: async () => {
    throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to analyze streaming BPM.');
  },
  getLyrics: async () => {
    throw new Error('桌面桥接不可用，请在 ECHO Next 客户端窗口中读取歌词。');
  },
  getMv: async () => {
    throw new Error('桌面桥接不可用，请在 ECHO Next 客户端窗口中读取 MV。');
  },
  getProviders: async () => [],
  importPlaylistFromUrl: importPlaylistFromDevApi,
  importFavoritesFromUrl: async (): Promise<StreamingFavoritesImportResult> => {
    throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to import streaming favorites.');
  },
  exportFavorites: async () => null,
  syncLikedSongs: syncLikedSongsFromDevApi,
  setTrackLiked: setStreamingTrackLikedFromDevApi,
  getFavorites: async () => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    providers: {
      bilibili: [],
      youtube: [],
      soundcloud: [],
    },
    collections: [],
  }),
  setFavorite: async (request) => ({
    favorite: request.favorite,
    item: null,
    snapshot: {
      version: 1,
      updatedAt: new Date().toISOString(),
      providers: {
        bilibili: [],
        youtube: [],
        soundcloud: [],
      },
      collections: [],
    },
  }),
  renameFavoriteCollection: async (): Promise<StreamingFavoriteCollectionRenameResult> => {
    throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to rename streaming favorite lists.');
  },
  syncFavoriteCollection: async (): Promise<StreamingFavoritesImportResult> => {
    throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to sync streaming favorite lists.');
  },
  deleteFavoriteCollection: async (): Promise<StreamingFavoriteCollectionDeleteResult> => {
    throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to delete streaming favorite lists.');
  },
  refreshNeteaseDailyRecommend: refreshNeteaseDailyRecommendFromDevApi,
};

export const getStreamingBridge = (): Window['echo']['streaming'] | null => getEchoBridge()?.streaming ?? browserStreamingBridge;
