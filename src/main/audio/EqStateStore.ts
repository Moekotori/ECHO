import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import electron from 'electron';
import type { ChannelBalanceMonoMode, ChannelBalanceState } from '../../shared/types/audio';
import {
  channelBalanceMaxBalance,
  channelBalanceBandIds,
  channelBalanceBandMaxGainDb,
  channelBalanceBandMinGainDb,
  channelBalanceMaxDelayMs,
  channelBalanceMaxGainDb,
  channelBalanceMinBalance,
  channelBalanceMinDelayMs,
  channelBalanceMinGainDb,
} from '../../shared/types/audio';
import type {
  EqBand,
  EqBindProfileRequest,
  EqFilterType,
  EqPreset,
  EqProfile,
  EqProfileBinding,
  EqProfileBindingInfo,
  EqProfileBindingTarget,
  EqSavePresetRequest,
  EqSaveProfileRequest,
  EqState,
  RoomCorrectionChannelMode,
  RoomCorrectionState,
  RoomCorrectionStatus,
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
  roomCorrectionMaxTrimDb,
  roomCorrectionMinTrimDb,
} from '../../shared/types/eq';
import { builtInEqPresetDefinitions } from '../../shared/audio/eqBuiltInPresets';

type PersistedRoomCorrectionState = RoomCorrectionState & {
  irPath?: string | null;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const nowIso = (): string => new Date().toISOString();

const filterTypesSet = new Set<EqFilterType>(eqFilterTypes);

const legacyEqBandCount = 10;

const normalizeFilterType = (value: unknown): EqFilterType =>
  filterTypesSet.has(value as EqFilterType) ? (value as EqFilterType) : 'peaking';

const roomCorrectionStatuses = new Set<RoomCorrectionStatus>(['empty', 'loaded', 'active', 'error']);
const roomCorrectionChannelModes = new Set<RoomCorrectionChannelMode>(['none', 'mono', 'stereo']);

const monoModes = new Set<ChannelBalanceMonoMode>(['off', 'sum', 'left', 'right']);

const sanitizePresetId = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || `preset-${Date.now()}`;

const validateBands = (bands: unknown, fallbackBands?: EqBand[]): EqBand[] | null => {
  if (!Array.isArray(bands) || (bands.length !== eqBandCount && bands.length !== legacyEqBandCount)) {
    return null;
  }

  const nextBands: EqBand[] = [];

  for (let index = 0; index < eqBandCount; index += 1) {
    const input = bands[index] as Partial<EqBand> | null;
    const fallback = fallbackBands?.[index];
    const frequencyHz = Number(input?.frequencyHz ?? eqFrequenciesHz[index]);
    const gainDb = Number(input?.gainDb ?? 0);
    const q = Number(input?.q ?? fallback?.q ?? 1);
    const hasFilterType = input && Object.prototype.hasOwnProperty.call(input, 'filterType');
    const filterType = hasFilterType ? normalizeFilterType(input?.filterType) : fallback?.filterType ?? 'peaking';
    const enabled = input && Object.prototype.hasOwnProperty.call(input, 'enabled')
      ? input.enabled !== false
      : fallback?.enabled ?? true;

    if (
      !Number.isFinite(frequencyHz) ||
      !Number.isFinite(gainDb) ||
      !Number.isFinite(q) ||
      (hasFilterType && input?.filterType !== filterType)
    ) {
      return null;
    }

    nextBands.push({
      frequencyHz: clamp(frequencyHz, eqMinFrequencyHz, eqMaxFrequencyHz),
      gainDb: clamp(gainDb, eqMinGainDb, eqMaxGainDb),
      q: clamp(q, eqMinQ, eqMaxQ),
      filterType,
      enabled,
    });
  }

  return nextBands;
};

const createBands = (gains: number[] = []): EqBand[] =>
  eqFrequenciesHz.map((frequencyHz, index) => ({
    frequencyHz,
    gainDb: clamp(Number(gains[index] ?? 0), eqMinGainDb, eqMaxGainDb),
    q: 1,
    filterType: 'peaking' as EqFilterType,
    enabled: true,
  }));

const builtInPresets: EqPreset[] = builtInEqPresetDefinitions.map((preset) => ({
  id: preset.id,
  name: preset.name,
  preampDb: preset.preampDb,
  bands: createBands(preset.gains),
  createdAt: 'built-in',
  updatedAt: 'built-in',
  readonly: true,
}));

const defaultState = (): EqState => ({
  enabled: false,
  preampDb: 0,
  dspHeadroomDb: 0,
  dspSafetyLimiterEnabled: true,
  bands: createBands(),
  presetId: 'flat',
  presetName: 'Flat',
  clippingRisk: false,
});

const defaultRoomCorrectionState = (): RoomCorrectionState => ({
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

const defaultChannelBalanceState = (): ChannelBalanceState => ({
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  bandGains: {
    low: { leftGainDb: 0, rightGainDb: 0 },
    mid: { leftGainDb: 0, rightGainDb: 0 },
    high: { leftGainDb: 0, rightGainDb: 0 },
  },
  leftDelayMs: 0,
  rightDelayMs: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: true,
  clippingRisk: false,
});

const normalizeState = (value: unknown): EqState | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<EqState>;
  const preampDb = Number(input.preampDb ?? 0);
  const dspHeadroomDb = Number(input.dspHeadroomDb ?? 0);
  const dspSafetyLimiterEnabled = input.dspSafetyLimiterEnabled !== false;
  const bands = validateBands(input.bands);

  if (!Number.isFinite(preampDb) || !Number.isFinite(dspHeadroomDb) || !bands) {
    return null;
  }

  return {
    enabled: input.enabled === true,
    preampDb: clamp(preampDb, eqMinPreampDb, eqMaxPreampDb),
    dspHeadroomDb: clamp(dspHeadroomDb, dspHeadroomMinDb, dspHeadroomMaxDb),
    dspSafetyLimiterEnabled,
    bands,
    presetId: typeof input.presetId === 'string' && input.presetId.trim() ? input.presetId.trim().slice(0, 64) : 'flat',
    presetName: typeof input.presetName === 'string' && input.presetName.trim() ? input.presetName.trim().slice(0, 64) : 'Flat',
    clippingRisk: false,
  };
};

const normalizePreset = (value: unknown, readonlyFallback = false): EqPreset | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<EqPreset>;
  const id = typeof input.id === 'string' && input.id.trim() ? sanitizePresetId(input.id) : null;
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 64) : null;
  const preampDb = Number(input.preampDb ?? 0);
  const bands = validateBands(input.bands);

  if (!id || !name || !Number.isFinite(preampDb) || !bands) {
    return null;
  }

  return {
    id,
    name,
    preampDb: clamp(preampDb, eqMinPreampDb, eqMaxPreampDb),
    bands,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : nowIso(),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : nowIso(),
    readonly: input.readonly ?? readonlyFallback,
  };
};

const normalizeProfileBinding = (value: unknown): EqProfileBinding | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<EqProfileBinding>;
  const key = typeof input.key === 'string' && input.key.trim() ? input.key.trim().slice(0, 512) : null;
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 160) : null;
  const outputMode = typeof input.outputMode === 'string' && input.outputMode.trim() ? input.outputMode.trim().slice(0, 48) : 'shared';

  if (!key || !label) {
    return null;
  }

  return {
    key,
    label,
    outputMode,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : nowIso(),
  };
};

const normalizeProfile = (value: unknown): EqProfile | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<EqProfile>;
  const id = typeof input.id === 'string' && input.id.trim() ? sanitizePresetId(input.id) : null;
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 64) : null;
  const state = normalizeState(input.state);

  if (!id || !name || !state) {
    return null;
  }

  return {
    id,
    name,
    state,
    bindings: Array.isArray(input.bindings)
      ? input.bindings.map(normalizeProfileBinding).filter((binding): binding is EqProfileBinding => Boolean(binding))
      : [],
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : nowIso(),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : nowIso(),
  };
};

const normalizeRoomCorrectionState = (
  value: unknown,
  fallback: RoomCorrectionState = defaultRoomCorrectionState(),
): RoomCorrectionState => {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const rawStatus =
    typeof input.status === 'string' && roomCorrectionStatuses.has(input.status as RoomCorrectionStatus)
      ? (input.status as RoomCorrectionStatus)
      : fallback.status;
  const rawChannelMode =
    typeof input.channelMode === 'string' && roomCorrectionChannelModes.has(input.channelMode as RoomCorrectionChannelMode)
      ? (input.channelMode as RoomCorrectionChannelMode)
      : fallback.channelMode;
  const tapCount = Number(input.tapCount ?? fallback.tapCount);
  const sampleRate = Number(input.sampleRate ?? fallback.sampleRate);
  const latencySamples = Number(input.latencySamples ?? fallback.latencySamples);
  const trimDb = Number(input.trimDb ?? fallback.trimDb);
  const irId = typeof input.irId === 'string' && input.irId.trim() ? input.irId.trim() : fallback.irId;
  const irName = typeof input.irName === 'string' && input.irName.trim() ? input.irName.trim().slice(0, 160) : fallback.irName;
  const error = typeof input.error === 'string' && input.error.trim() ? input.error.trim().slice(0, 240) : null;

  return {
    enabled: input.enabled === true,
    status: error ? 'error' : rawStatus,
    irId,
    irName,
    channelMode: rawChannelMode,
    sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : null,
    tapCount: Number.isFinite(tapCount) ? Math.max(0, Math.round(tapCount)) : 0,
    trimDb: Number.isFinite(trimDb) ? clamp(trimDb, roomCorrectionMinTrimDb, roomCorrectionMaxTrimDb) : fallback.trimDb,
    latencySamples: Number.isFinite(latencySamples) ? Math.max(0, Math.round(latencySamples)) : 0,
    clippingRisk: input.clippingRisk === true,
    error,
  };
};

const normalizeChannelBalancePatch = (
  patch: Partial<ChannelBalanceState>,
  fallback: ChannelBalanceState,
): ChannelBalanceState => {
  const balance = Number(patch.balance ?? fallback.balance);
  const leftGainDb = Number(patch.leftGainDb ?? fallback.leftGainDb);
  const rightGainDb = Number(patch.rightGainDb ?? fallback.rightGainDb);
  const leftDelayMs = Number(patch.leftDelayMs ?? fallback.leftDelayMs ?? 0);
  const rightDelayMs = Number(patch.rightDelayMs ?? fallback.rightDelayMs ?? 0);
  const monoMode =
    typeof patch.monoMode === 'string' && monoModes.has(patch.monoMode as ChannelBalanceMonoMode)
      ? (patch.monoMode as ChannelBalanceMonoMode)
      : fallback.monoMode;
  const rawBandGains =
    patch.bandGains && typeof patch.bandGains === 'object' && !Array.isArray(patch.bandGains)
      ? patch.bandGains
      : fallback.bandGains;
  const bandGains = channelBalanceBandIds.reduce<NonNullable<ChannelBalanceState['bandGains']>>((next, bandId) => {
    const band = rawBandGains?.[bandId];
    const leftBandGainDb = Number(band?.leftGainDb);
    const rightBandGainDb = Number(band?.rightGainDb);
    next[bandId] = {
      leftGainDb: Number.isFinite(leftBandGainDb)
        ? clamp(leftBandGainDb, channelBalanceBandMinGainDb, channelBalanceBandMaxGainDb)
        : 0,
      rightGainDb: Number.isFinite(rightBandGainDb)
        ? clamp(rightBandGainDb, channelBalanceBandMinGainDb, channelBalanceBandMaxGainDb)
        : 0,
    };
    return next;
  }, {
    low: { leftGainDb: 0, rightGainDb: 0 },
    mid: { leftGainDb: 0, rightGainDb: 0 },
    high: { leftGainDb: 0, rightGainDb: 0 },
  });

  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : fallback.enabled,
    balance: Number.isFinite(balance) ? clamp(balance, channelBalanceMinBalance, channelBalanceMaxBalance) : fallback.balance,
    leftGainDb: Number.isFinite(leftGainDb)
      ? clamp(leftGainDb, channelBalanceMinGainDb, channelBalanceMaxGainDb)
      : fallback.leftGainDb,
    rightGainDb: Number.isFinite(rightGainDb)
      ? clamp(rightGainDb, channelBalanceMinGainDb, channelBalanceMaxGainDb)
      : fallback.rightGainDb,
    bandGains,
    leftDelayMs: Number.isFinite(leftDelayMs)
      ? clamp(leftDelayMs, channelBalanceMinDelayMs, channelBalanceMaxDelayMs)
      : fallback.leftDelayMs ?? 0,
    rightDelayMs: Number.isFinite(rightDelayMs)
      ? clamp(rightDelayMs, channelBalanceMinDelayMs, channelBalanceMaxDelayMs)
      : fallback.rightDelayMs ?? 0,
    swapLeftRight: typeof patch.swapLeftRight === 'boolean' ? patch.swapLeftRight : fallback.swapLeftRight,
    monoMode,
    invertLeft: typeof patch.invertLeft === 'boolean' ? patch.invertLeft : fallback.invertLeft,
    invertRight: typeof patch.invertRight === 'boolean' ? patch.invertRight : fallback.invertRight,
    constantPower: typeof patch.constantPower === 'boolean' ? patch.constantPower : fallback.constantPower,
    clippingRisk: typeof patch.clippingRisk === 'boolean' ? patch.clippingRisk : fallback.clippingRisk,
  };
};

const cloneState = (state: EqState): EqState => ({
  ...state,
  bands: state.bands.map((band) => ({ ...band })),
});

const cloneProfile = (profile: EqProfile): EqProfile => ({
  ...profile,
  state: cloneState(profile.state),
  bindings: profile.bindings.map((binding) => ({ ...binding })),
});

const buildProfileBinding = (target: EqProfileBindingTarget): EqProfileBinding => {
  const outputMode = typeof target.outputMode === 'string' && target.outputMode.trim() ? target.outputMode.trim() : 'shared';
  const deviceId = typeof target.outputDeviceId === 'string' && target.outputDeviceId.trim() ? target.outputDeviceId.trim() : null;
  const deviceName =
    typeof target.outputDeviceName === 'string' && target.outputDeviceName.trim()
      ? target.outputDeviceName.trim()
      : typeof target.deviceName === 'string' && target.deviceName.trim()
        ? target.deviceName.trim()
        : 'System default output';
  const deviceType = typeof target.outputDeviceType === 'string' && target.outputDeviceType.trim() ? target.outputDeviceType.trim() : null;
  const outputBackend = typeof target.outputBackend === 'string' && target.outputBackend.trim() ? target.outputBackend.trim() : null;
  const sharedBackend = typeof target.sharedBackend === 'string' && target.sharedBackend.trim() ? target.sharedBackend.trim() : null;
  const deviceIndex = Number.isInteger(target.deviceIndex) ? Number(target.deviceIndex) : null;
  const identity = {
    outputMode,
    outputBackend,
    sharedBackend,
    deviceId,
    deviceName,
    deviceType,
    deviceIndex,
  };

  return {
    key: JSON.stringify(identity),
    label: `${outputMode.toUpperCase()} / ${deviceName}`,
    outputMode,
    createdAt: nowIso(),
  };
};

const getUserDataPath = (): string => {
  const app = (electron as unknown as { app?: { getPath: (name: string) => string } }).app;

  try {
    const userDataPath = app?.getPath('userData');
    if (isNonEmptyAbsolutePath(userDataPath)) {
      return userDataPath.trim();
    }
  } catch {
    return getFallbackUserDataPath();
  }

  return getFallbackUserDataPath();
};

const getFallbackUserDataPath = (): string => {
  const fallback = getDefaultConfigPath();
  if (!fallback) {
    throw new Error('eq_config_path_unavailable');
  }

  return fallback;
};

const isNonEmptyAbsolutePath = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && isAbsolute(value.trim());

const envAbsolutePath = (name: string): string | null => {
  const value = process.env[name];
  return isNonEmptyAbsolutePath(value) ? value.trim() : null;
};

const getHomeDirectory = (): string | null => {
  const configured = envAbsolutePath('HOME') ?? envAbsolutePath('USERPROFILE');
  if (configured) {
    return configured;
  }

  const detected = homedir();
  return isNonEmptyAbsolutePath(detected) ? detected.trim() : null;
};

const getDefaultConfigPath = (): string | null => {
  if (process.platform === 'linux') {
    const xdgConfigHome = envAbsolutePath('XDG_CONFIG_HOME');
    const homeDirectory = getHomeDirectory();
    const configRoot = xdgConfigHome ?? (homeDirectory ? join(homeDirectory, '.config') : null);
    return configRoot ? join(configRoot, 'echo-next') : null;
  }

  const homeDirectory = getHomeDirectory();

  if (process.platform === 'darwin') {
    return homeDirectory ? join(homeDirectory, 'Library', 'Application Support', 'ECHO NEXT') : null;
  }

  if (process.platform === 'win32') {
    const appData = envAbsolutePath('APPDATA');
    const configRoot = appData ?? (homeDirectory ? join(homeDirectory, 'AppData', 'Roaming') : null);
    return configRoot ? join(configRoot, 'ECHO NEXT') : null;
  }

  return homeDirectory ? join(homeDirectory, '.config', 'echo-next') : null;
};

const getEqDir = (): string => join(getUserDataPath(), 'eq');

export class EqStateStore {
  private static irPath: string | null = null;

  private static get presetPath(): string {
    return join(getEqDir(), 'presets.json');
  }

  private static get statePath(): string {
    return join(getEqDir(), 'state.json');
  }

  private static get profilePath(): string {
    return join(getEqDir(), 'profiles.json');
  }

  private static get roomCorrectionStatePath(): string {
    return join(getEqDir(), 'room-correction-state.json');
  }

  private static get roomCorrectionIrDirectory(): string {
    return join(getEqDir(), 'room-correction', 'irs');
  }

  private static get channelBalanceStatePath(): string {
    return join(getEqDir(), 'channel-balance-state.json');
  }

  private static readUserPresetsFile(): EqPreset[] {
    if (!existsSync(EqStateStore.presetPath)) {
      return [];
    }

    try {
      const parsed = JSON.parse(readFileSync(EqStateStore.presetPath, 'utf8')) as unknown;

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((item) => normalizePreset(item, false))
        .filter((preset): preset is EqPreset => Boolean(preset && !preset.readonly));
    } catch {
      return [];
    }
  }

  private static writeUserPresetsFile(presets: EqPreset[]): void {
    mkdirSync(dirname(EqStateStore.presetPath), { recursive: true });
    writeFileSync(EqStateStore.presetPath, JSON.stringify(presets, null, 2), 'utf8');
  }

  static listPresets(): EqPreset[] {
    return [...builtInPresets, ...EqStateStore.readUserPresetsFile()].map((preset) => ({
      ...preset,
      bands: preset.bands.map((band) => ({ ...band })),
    }));
  }

  static savePreset(request: EqSavePresetRequest): EqPreset {
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

    const presets = EqStateStore.readUserPresetsFile();
    const existingIndex = presets.findIndex((preset) => preset.id === normalized.id);
    const existing = existingIndex >= 0 ? presets[existingIndex] : null;
    const preset: EqPreset = {
      ...normalized,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      readonly: false,
    };

    if (builtInPresets.some((item) => item.id === preset.id)) {
      throw new Error('cannot_overwrite_builtin_eq_preset');
    }

    if (existingIndex >= 0) {
      presets[existingIndex] = preset;
    } else {
      presets.push(preset);
    }

    EqStateStore.writeUserPresetsFile(presets);
    return preset;
  }

  static deletePreset(presetId: string): void {
    if (builtInPresets.some((preset) => preset.id === presetId)) {
      throw new Error('cannot_delete_builtin_eq_preset');
    }

    const presets = EqStateStore.readUserPresetsFile().filter((preset) => preset.id !== presetId);
    EqStateStore.writeUserPresetsFile(presets);
  }

  private static readProfilesFile(): EqProfile[] {
    if (!existsSync(EqStateStore.profilePath)) {
      return [];
    }

    try {
      const parsed = JSON.parse(readFileSync(EqStateStore.profilePath, 'utf8')) as unknown;

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map(normalizeProfile).filter((profile): profile is EqProfile => Boolean(profile));
    } catch {
      return [];
    }
  }

  private static writeProfilesFile(profiles: EqProfile[]): void {
    mkdirSync(dirname(EqStateStore.profilePath), { recursive: true });
    writeFileSync(EqStateStore.profilePath, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8');
  }

  static listProfiles(): EqProfile[] {
    return EqStateStore.readProfilesFile().map(cloneProfile);
  }

  static saveProfile(request: EqSaveProfileRequest): EqProfile {
    const id = typeof request.id === 'string' && request.id.trim() ? sanitizePresetId(request.id) : sanitizePresetId(request.name);
    const state = normalizeState(request.state);
    const name = typeof request.name === 'string' && request.name.trim() ? request.name.trim().slice(0, 64) : null;

    if (!id || !name || !state) {
      throw new Error('invalid_eq_profile');
    }

    const profiles = EqStateStore.readProfilesFile();
    const existingIndex = profiles.findIndex((profile) => profile.id === id);
    const existing = existingIndex >= 0 ? profiles[existingIndex] : null;
    const profile: EqProfile = {
      id,
      name,
      state,
      bindings: existing?.bindings.map((binding) => ({ ...binding })) ?? [],
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };

    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }

    EqStateStore.writeProfilesFile(profiles);
    return cloneProfile(profile);
  }

  static deleteProfile(profileId: string): void {
    const profiles = EqStateStore.readProfilesFile().filter((profile) => profile.id !== profileId);
    EqStateStore.writeProfilesFile(profiles);
  }

  static getProfileBinding(target: EqProfileBindingTarget): EqProfileBindingInfo {
    const binding = buildProfileBinding(target);
    const profile = EqStateStore.readProfilesFile().find((item) =>
      item.bindings.some((profileBinding) => profileBinding.key === binding.key),
    );

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

  static bindProfileToOutput(request: EqBindProfileRequest): EqProfileBindingInfo {
    const binding = buildProfileBinding(request.target);
    const profiles = EqStateStore.readProfilesFile();
    const profileIndex = profiles.findIndex((profile) => profile.id === request.profileId);

    if (profileIndex < 0) {
      throw new Error('eq_profile_not_found');
    }

    const nextProfiles = profiles.map((profile, index) => ({
      ...profile,
      bindings: index === profileIndex
        ? [...profile.bindings.filter((item) => item.key !== binding.key), binding]
        : profile.bindings.filter((item) => item.key !== binding.key),
      updatedAt: index === profileIndex ? nowIso() : profile.updatedAt,
    }));

    EqStateStore.writeProfilesFile(nextProfiles);
    return {
      key: binding.key,
      label: binding.label,
      profileId: request.profileId,
      profileName: nextProfiles[profileIndex].name,
    };
  }

  static importRoomCorrectionIr(sourcePath: string): { irId: string; irName: string } {
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
      throw new Error('invalid_room_correction_ir_path');
    }

    const extension = extname(sourcePath).toLowerCase();
    if (extension !== '.wav') {
      throw new Error('unsupported_room_correction_ir_format');
    }

    if (!existsSync(sourcePath)) {
      throw new Error('room_correction_ir_not_found');
    }

    mkdirSync(EqStateStore.roomCorrectionIrDirectory, { recursive: true });
    const irId = `ir-${randomUUID()}`;
    const irName = basename(sourcePath).replace(/\.[^.]+$/u, '').trim().slice(0, 160) || 'Room Correction IR';
    const targetPath = join(EqStateStore.roomCorrectionIrDirectory, `${irId}.wav`);
    copyFileSync(sourcePath, targetPath);

    EqStateStore.irPath = targetPath;

    const state = {
      ...defaultRoomCorrectionState(),
      status: 'loaded' as const,
      irId,
      irName,
    };
    EqStateStore.saveRoomCorrectionState(state);

    return { irId, irName };
  }

  static loadEqState(): EqState {
    if (!existsSync(EqStateStore.statePath)) {
      return defaultState();
    }

    try {
      return normalizeState(JSON.parse(readFileSync(EqStateStore.statePath, 'utf8'))) ?? defaultState();
    } catch {
      return defaultState();
    }
  }

  static saveEqState(state: EqState): void {
    try {
      mkdirSync(dirname(EqStateStore.statePath), { recursive: true });
      writeFileSync(EqStateStore.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    } catch {
    }
  }

  static loadChannelBalanceState(): ChannelBalanceState {
    if (!existsSync(EqStateStore.channelBalanceStatePath)) {
      return defaultChannelBalanceState();
    }

    try {
      const parsed = JSON.parse(readFileSync(EqStateStore.channelBalanceStatePath, 'utf8')) as unknown;
      return normalizeChannelBalancePatch(
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partial<ChannelBalanceState>) : {},
        defaultChannelBalanceState(),
      );
    } catch {
      return defaultChannelBalanceState();
    }
  }

  static saveChannelBalanceState(state: ChannelBalanceState): void {
    try {
      mkdirSync(dirname(EqStateStore.channelBalanceStatePath), { recursive: true });
      writeFileSync(EqStateStore.channelBalanceStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    } catch {
    }
  }

  static loadRoomCorrectionState(): RoomCorrectionState {
    if (!existsSync(EqStateStore.roomCorrectionStatePath)) {
      EqStateStore.irPath = null;
      return defaultRoomCorrectionState();
    }

    try {
      const parsed = JSON.parse(readFileSync(EqStateStore.roomCorrectionStatePath, 'utf8')) as PersistedRoomCorrectionState;
      const state = normalizeRoomCorrectionState(parsed);
      EqStateStore.irPath = typeof parsed.irPath === 'string' && parsed.irPath.trim() ? parsed.irPath : null;

      if (EqStateStore.irPath && !existsSync(EqStateStore.irPath)) {
        return {
          ...state,
          enabled: false,
          status: 'error',
          error: 'missing_file',
        };
      }

      return state;
    } catch {
      EqStateStore.irPath = null;
      return defaultRoomCorrectionState();
    }
  }

  static saveRoomCorrectionState(state: RoomCorrectionState): void {
    try {
      mkdirSync(dirname(EqStateStore.roomCorrectionStatePath), { recursive: true });
      const persisted: PersistedRoomCorrectionState = {
        ...state,
        irPath: EqStateStore.irPath,
      };
      writeFileSync(EqStateStore.roomCorrectionStatePath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
    } catch {
    }
  }
}
