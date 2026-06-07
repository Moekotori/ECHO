import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';
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
  EqSetBandEnabledRequest,
  EqSetBandFilterTypeRequest,
  EqSetBandFrequencyRequest,
  EqSetBandGainRequest,
  EqSetBandQRequest,
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
import { defaultChannelBalanceSettings, getAppSettings, setAppSettings } from '../app/appSettings';

type PendingRequest = {
  expectedState: 'eq' | 'channelBalance' | 'roomCorrection';
  resolve: (state: EqState | ChannelBalanceState | RoomCorrectionState) => void;
  reject: (error: Error) => void;
};

type PersistedRoomCorrectionState = RoomCorrectionState & {
  irPath?: string | null;
};

const controlPortBase = 45210;
let nextControlPort = controlPortBase;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const nowIso = (): string => new Date().toISOString();

const filterTypes = new Set<EqFilterType>(eqFilterTypes);
const legacyEqBandCount = 10;

const normalizeFilterType = (value: unknown): EqFilterType => (filterTypes.has(value as EqFilterType) ? value as EqFilterType : 'peaking');

const roomCorrectionStatuses = new Set<RoomCorrectionStatus>(['empty', 'loaded', 'active', 'error']);
const roomCorrectionChannelModes = new Set<RoomCorrectionChannelMode>(['none', 'mono', 'stereo']);

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

const normalizeRoomCorrectionState = (value: unknown, fallback: RoomCorrectionState = defaultRoomCorrectionState()): RoomCorrectionState => {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawStatus = typeof input.status === 'string' && roomCorrectionStatuses.has(input.status as RoomCorrectionStatus)
    ? input.status as RoomCorrectionStatus
    : fallback.status;
  const rawChannelMode =
    typeof input.channelMode === 'string' && roomCorrectionChannelModes.has(input.channelMode as RoomCorrectionChannelMode)
      ? input.channelMode as RoomCorrectionChannelMode
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

const createBands = (gains: number[] = []): EqBand[] =>
  eqFrequenciesHz.map((frequencyHz, index) => ({
    frequencyHz,
    gainDb: clamp(Number(gains[index] ?? 0), eqMinGainDb, eqMaxGainDb),
    q: 1,
    filterType: 'peaking',
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

const monoModes = new Set<ChannelBalanceMonoMode>(['off', 'sum', 'left', 'right']);

const defaultChannelBalanceState = (): ChannelBalanceState => ({
  ...defaultChannelBalanceSettings,
  clippingRisk: false,
});

const normalizeChannelBalancePatch = (
  patch: Partial<ChannelBalanceState>,
  fallback: ChannelBalanceState,
): ChannelBalanceState => {
  const balance = Number(patch.balance ?? fallback.balance);
  const leftGainDb = Number(patch.leftGainDb ?? fallback.leftGainDb);
  const rightGainDb = Number(patch.rightGainDb ?? fallback.rightGainDb);
  const leftDelayMs = Number(patch.leftDelayMs ?? fallback.leftDelayMs ?? 0);
  const rightDelayMs = Number(patch.rightDelayMs ?? fallback.rightDelayMs ?? 0);
  const monoMode = typeof patch.monoMode === 'string' && monoModes.has(patch.monoMode) ? patch.monoMode : fallback.monoMode;
  const rawBandGains = patch.bandGains && typeof patch.bandGains === 'object' && !Array.isArray(patch.bandGains)
    ? patch.bandGains
    : fallback.bandGains;
  const bandGains = channelBalanceBandIds.reduce<NonNullable<ChannelBalanceState['bandGains']>>((next, bandId) => {
    const band = rawBandGains?.[bandId];
    const leftBandGainDb = Number(band?.leftGainDb);
    const rightBandGainDb = Number(band?.rightGainDb);
    next[bandId] = {
      leftGainDb: Number.isFinite(leftBandGainDb) ? clamp(leftBandGainDb, channelBalanceBandMinGainDb, channelBalanceBandMaxGainDb) : 0,
      rightGainDb: Number.isFinite(rightBandGainDb) ? clamp(rightBandGainDb, channelBalanceBandMinGainDb, channelBalanceBandMaxGainDb) : 0,
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
    leftGainDb: Number.isFinite(leftGainDb) ? clamp(leftGainDb, channelBalanceMinGainDb, channelBalanceMaxGainDb) : fallback.leftGainDb,
    rightGainDb: Number.isFinite(rightGainDb) ? clamp(rightGainDb, channelBalanceMinGainDb, channelBalanceMaxGainDb) : fallback.rightGainDb,
    bandGains,
    leftDelayMs: Number.isFinite(leftDelayMs) ? clamp(leftDelayMs, channelBalanceMinDelayMs, channelBalanceMaxDelayMs) : fallback.leftDelayMs ?? 0,
    rightDelayMs: Number.isFinite(rightDelayMs) ? clamp(rightDelayMs, channelBalanceMinDelayMs, channelBalanceMaxDelayMs) : fallback.rightDelayMs ?? 0,
    swapLeftRight: typeof patch.swapLeftRight === 'boolean' ? patch.swapLeftRight : fallback.swapLeftRight,
    monoMode,
    invertLeft: typeof patch.invertLeft === 'boolean' ? patch.invertLeft : fallback.invertLeft,
    invertRight: typeof patch.invertRight === 'boolean' ? patch.invertRight : fallback.invertRight,
    constantPower: typeof patch.constantPower === 'boolean' ? patch.constantPower : fallback.constantPower,
    clippingRisk: typeof patch.clippingRisk === 'boolean' ? patch.clippingRisk : fallback.clippingRisk,
  };
};

const isDefaultChannelBalanceState = (state: ChannelBalanceState): boolean => {
  const fallback = defaultChannelBalanceState();
  return state.enabled === fallback.enabled &&
    state.balance === fallback.balance &&
    state.leftGainDb === fallback.leftGainDb &&
    state.rightGainDb === fallback.rightGainDb &&
    channelBalanceBandIds.every((bandId) => (
      (state.bandGains?.[bandId]?.leftGainDb ?? 0) === (fallback.bandGains?.[bandId]?.leftGainDb ?? 0) &&
      (state.bandGains?.[bandId]?.rightGainDb ?? 0) === (fallback.bandGains?.[bandId]?.rightGainDb ?? 0)
    )) &&
    (state.leftDelayMs ?? 0) === (fallback.leftDelayMs ?? 0) &&
    (state.rightDelayMs ?? 0) === (fallback.rightDelayMs ?? 0) &&
    state.swapLeftRight === fallback.swapLeftRight &&
    state.monoMode === fallback.monoMode &&
    state.invertLeft === fallback.invertLeft &&
    state.invertRight === fallback.invertRight &&
    state.constantPower === fallback.constantPower;
};

const getUserDataPath = (): string => {
  const app = (electron as unknown as { app?: { getPath: (name: string) => string } }).app;

  try {
    return app?.getPath('userData') ?? process.cwd();
  } catch {
    return process.cwd();
  }
};

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
    const enabled = input && Object.prototype.hasOwnProperty.call(input, 'enabled') ? input.enabled !== false : fallback?.enabled ?? true;

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
  const deviceName = typeof target.outputDeviceName === 'string' && target.outputDeviceName.trim()
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

export class EqBridge extends EventEmitter {
  private state: EqState = defaultState();
  private channelBalanceState: ChannelBalanceState = defaultChannelBalanceState();
  private roomCorrectionState: RoomCorrectionState = defaultRoomCorrectionState();
  private roomCorrectionIrPath: string | null = null;
  private socket: net.Socket | null = null;
  private activeControlPort: number | null = null;
  private nativeSyncTargetEqState: EqState | null = null;
  private nativeSyncTargetRevision: number | null = null;
  private nativeCommandQueue: Promise<unknown> = Promise.resolve();
  private stateRevision = 0;
  private pending: PendingRequest[] = [];
  private receiveBuffer = '';
  private readonly presetPath: string;
  private readonly statePath: string;
  private readonly profilePath: string;
  private readonly roomCorrectionStatePath: string;
  private readonly roomCorrectionIrDirectory: string;
  private readonly backupDirectory: string;
  private readonly backupMarkerPath: string;

  constructor(userDataPath = getUserDataPath()) {
    super();
    this.presetPath = join(userDataPath, 'eq-presets.json');
    this.statePath = join(userDataPath, 'eq-state.json');
    this.profilePath = join(userDataPath, 'eq-profiles.json');
    this.roomCorrectionStatePath = join(userDataPath, 'room-correction-state.json');
    this.roomCorrectionIrDirectory = join(userDataPath, 'room-correction', 'irs');
    this.backupDirectory = join(userDataPath, 'eq-backups');
    this.backupMarkerPath = join(this.backupDirectory, 'phase2-backup.done');
    this.state = this.readPersistedState();
    try {
      this.channelBalanceState = normalizeChannelBalancePatch(getAppSettings().channelBalance, defaultChannelBalanceState());
    } catch {
      this.channelBalanceState = defaultChannelBalanceState();
    }
    this.readPersistedRoomCorrectionState();
    this.on('error', () => undefined);
  }

  reserveControlPort(): number {
    const port = nextControlPort;
    nextControlPort += 1;

    if (nextControlPort > controlPortBase + 900) {
      nextControlPort = controlPortBase;
    }

    return port;
  }

  connect(port: number): void {
    this.disconnect();

    if (!port || port <= 0) {
      return;
    }

    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 5000 });
    this.socket = socket;
    this.activeControlPort = port;
    socket.setNoDelay(true);
    socket.on('connect', () => {
      if (this.socket !== socket) {
        return;
      }

      socket.setTimeout(0);
      socket.setKeepAlive(true, 30000);
      void this.syncStateToNative().catch((error: unknown) => {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      });
    });
    socket.on('timeout', () => {
      socket.destroy(new Error('eq_control_connection_timeout'));
    });
    socket.on('data', (chunk) => this.handleData(chunk));
    socket.on('error', (error) => {
      if (this.socket !== socket) {
        return;
      }

      this.rejectPending(error);
      this.emit('error', error);
    });
    socket.on('close', () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.activeControlPort = null;
      this.rejectPending(new Error('eq_control_closed'));
    });
  }

  disconnect(expectedPort?: number | null): void {
    if (expectedPort && this.activeControlPort !== expectedPort) {
      return;
    }

    const socket = this.socket;
    this.socket = null;
    this.activeControlPort = null;

    if (socket) {
      socket.destroy();
    }

    this.rejectPending(new Error('eq_control_disconnected'));
  }

  getState(): EqState {
    return cloneState(this.state);
  }

  getChannelBalanceState(): ChannelBalanceState {
    return { ...this.channelBalanceState };
  }

  getRoomCorrectionState(): RoomCorrectionState {
    return { ...this.roomCorrectionState };
  }

  private markStateChanged(): void {
    this.stateRevision += 1;
  }

  listPresets(): EqPreset[] {
    return [...builtInPresets, ...this.readUserPresets()].map((preset) => ({
      ...preset,
      bands: preset.bands.map((band) => ({ ...band })),
    }));
  }

  async setEnabled(enabled: boolean): Promise<EqState> {
    this.state = { ...this.state, enabled };
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'eq:set-enabled', enabled });
    return this.emitState();
  }

  async setBandGain(request: EqSetBandGainRequest): Promise<EqState> {
    if (!Number.isInteger(request.band) || request.band < 0 || request.band >= eqBandCount) {
      throw new Error('invalid_eq_band_index');
    }

    const rawGainDb = Number(request.gainDb);
    if (!Number.isFinite(rawGainDb)) {
      throw new Error('invalid_eq_band_gain');
    }

    const gainDb = clamp(rawGainDb, eqMinGainDb, eqMaxGainDb);
    const bands = this.state.bands.map((band, index) => (index === request.band ? { ...band, gainDb } : band));
    this.state = { ...this.state, bands, presetId: 'custom', presetName: 'Custom' };
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'eq:set-band-gain', band: request.band, gainDb });
    return this.emitState();
  }

  async setBandFrequency(request: EqSetBandFrequencyRequest): Promise<EqState> {
    if (!Number.isInteger(request.band) || request.band < 0 || request.band >= eqBandCount) {
      throw new Error('invalid_eq_band_index');
    }

    const frequencyHz = clamp(Number(request.frequencyHz), eqMinFrequencyHz, eqMaxFrequencyHz);

    if (!Number.isFinite(frequencyHz)) {
      throw new Error('invalid_eq_band_frequency');
    }

    const bands = this.state.bands.map((band, index) => (index === request.band ? { ...band, frequencyHz } : band));
    this.state = { ...this.state, bands, presetId: 'custom', presetName: 'Custom' };
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'eq:set-band-frequency', band: request.band, frequencyHz });
    return this.emitState();
  }

  async setBandQ(request: EqSetBandQRequest): Promise<EqState> {
    if (!Number.isInteger(request.band) || request.band < 0 || request.band >= eqBandCount) {
      throw new Error('invalid_eq_band_index');
    }

    const q = Number(request.q);
    if (!Number.isFinite(q)) {
      throw new Error('invalid_eq_band_q');
    }

    const safeQ = clamp(q, eqMinQ, eqMaxQ);
    const bands = this.state.bands.map((band, index) => (index === request.band ? { ...band, q: safeQ } : band));
    this.state = { ...this.state, bands, presetId: 'custom', presetName: 'Custom' };
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'eq:set-band-q', band: request.band, q: safeQ });
    return this.emitState();
  }

  async setBandFilterType(request: EqSetBandFilterTypeRequest): Promise<EqState> {
    if (!Number.isInteger(request.band) || request.band < 0 || request.band >= eqBandCount) {
      throw new Error('invalid_eq_band_index');
    }

    const filterType = normalizeFilterType(request.filterType);
    if (filterType !== request.filterType) {
      throw new Error('invalid_eq_band_filter_type');
    }

    const bands = this.state.bands.map((band, index) => (index === request.band ? { ...band, filterType } : band));
    this.state = { ...this.state, bands, presetId: 'custom', presetName: 'Custom' };
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'eq:set-band-filter-type', band: request.band, filterType });
    return this.emitState();
  }

  async setBandEnabled(request: EqSetBandEnabledRequest): Promise<EqState> {
    if (!Number.isInteger(request.band) || request.band < 0 || request.band >= eqBandCount) {
      throw new Error('invalid_eq_band_index');
    }

    const enabled = request.enabled === true;
    const bands = this.state.bands.map((band, index) => (index === request.band ? { ...band, enabled } : band));
    this.state = { ...this.state, bands, presetId: 'custom', presetName: 'Custom' };
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'eq:set-band-enabled', band: request.band, enabled });
    return this.emitState();
  }

  async setPreamp(preampDb: number): Promise<EqState> {
    const rawPreampDb = Number(preampDb);
    if (!Number.isFinite(rawPreampDb)) {
      throw new Error('invalid_eq_preamp');
    }

    const safePreampDb = clamp(rawPreampDb, eqMinPreampDb, eqMaxPreampDb);
    this.state = { ...this.state, preampDb: safePreampDb, presetId: 'custom', presetName: 'Custom' };
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'eq:set-preamp', preampDb: safePreampDb });
    return this.emitState();
  }

  async setDspHeadroom(headroomDb: number): Promise<EqState> {
    const rawHeadroomDb = Number(headroomDb);
    if (!Number.isFinite(rawHeadroomDb)) {
      throw new Error('invalid_dsp_headroom');
    }

    const safeHeadroomDb = clamp(rawHeadroomDb, dspHeadroomMinDb, dspHeadroomMaxDb);
    this.state = { ...this.state, dspHeadroomDb: safeHeadroomDb };
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'dsp:set-headroom', headroomDb: safeHeadroomDb });
    return this.emitState();
  }

  async setDspSafetyLimiterEnabled(enabled: boolean): Promise<EqState> {
    const safetyLimiterEnabled = enabled !== false;
    this.state = { ...this.state, dspSafetyLimiterEnabled: safetyLimiterEnabled };
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'dsp:set-safety-limiter-enabled', enabled: safetyLimiterEnabled });
    return this.emitState();
  }

  async setPreset(presetId: string): Promise<EqState> {
    const preset = this.listPresets().find((item) => item.id === presetId);

    if (!preset) {
      throw new Error('eq_preset_not_found');
    }

    this.state = {
      enabled: this.state.enabled,
      preampDb: preset.preampDb,
      dspHeadroomDb: this.state.dspHeadroomDb,
      dspSafetyLimiterEnabled: this.state.dspSafetyLimiterEnabled !== false,
      bands: preset.bands.map((band) => ({ ...band })),
      presetId: preset.id,
      presetName: preset.name,
      clippingRisk: false,
    };
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'eq:set-preset', preampDb: preset.preampDb, bands: preset.bands });
    return this.emitState();
  }

  async reset(): Promise<EqState> {
    const flat = builtInPresets[0];
    this.state = {
      enabled: this.state.enabled,
      preampDb: flat.preampDb,
      dspHeadroomDb: this.state.dspHeadroomDb,
      dspSafetyLimiterEnabled: this.state.dspSafetyLimiterEnabled !== false,
      bands: flat.bands.map((band) => ({ ...band })),
      presetId: flat.id,
      presetName: flat.name,
      clippingRisk: false,
    };
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'eq:set-preset', preampDb: flat.preampDb, bands: flat.bands });
    return this.emitState();
  }

  async setChannelBalanceState(patch: Partial<ChannelBalanceState>): Promise<ChannelBalanceState> {
    this.channelBalanceState = normalizeChannelBalancePatch(patch, this.channelBalanceState);
    this.persistChannelBalanceState();
    await this.sendNativeChannelBalance({ type: 'channelBalance.setState', state: this.channelBalanceState });
    return this.emitChannelBalanceState();
  }

  async resetChannelBalance(): Promise<ChannelBalanceState> {
    this.channelBalanceState = defaultChannelBalanceState();
    this.persistChannelBalanceState();
    await this.sendNativeChannelBalance({ type: 'channelBalance.reset' });
    return this.emitChannelBalanceState();
  }

  async importRoomCorrectionIr(sourcePath: string): Promise<RoomCorrectionState> {
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

    mkdirSync(this.roomCorrectionIrDirectory, { recursive: true });
    const irId = `ir-${randomUUID()}`;
    const irName = basename(sourcePath).replace(/\.[^.]+$/u, '').trim().slice(0, 160) || 'Room Correction IR';
    const targetPath = join(this.roomCorrectionIrDirectory, `${irId}.wav`);
    copyFileSync(sourcePath, targetPath);

    this.roomCorrectionIrPath = targetPath;
    this.roomCorrectionState = {
      ...defaultRoomCorrectionState(),
      enabled: this.roomCorrectionState.enabled,
      status: this.roomCorrectionState.enabled ? 'active' : 'loaded',
      irId,
      irName,
      trimDb: this.roomCorrectionState.trimDb,
    };
    this.persistRoomCorrectionState();

    const loaded = await this.sendNativeRoomCorrection({
      type: 'roomCorrection.loadIr',
      path: targetPath,
      irId,
      irName,
    });
    if (this.roomCorrectionState.enabled) {
      await this.sendNativeRoomCorrection({ type: 'roomCorrection.setEnabled', enabled: true });
    }
    await this.sendNativeRoomCorrection({ type: 'roomCorrection.setTrim', trimDb: this.roomCorrectionState.trimDb });
    return loaded.error ? this.emitRoomCorrectionState() : this.getRoomCorrectionState();
  }

  async setRoomCorrectionEnabled(enabled: boolean): Promise<RoomCorrectionState> {
    const hasIr = Boolean(this.roomCorrectionState.irId && this.roomCorrectionIrPath);
    this.roomCorrectionState = {
      ...this.roomCorrectionState,
      enabled: enabled === true && hasIr,
      status: !hasIr ? 'empty' : enabled === true ? 'active' : 'loaded',
      error: !hasIr && enabled === true ? 'missing_ir' : null,
    };
    this.persistRoomCorrectionState();
    await this.sendNativeRoomCorrection({ type: 'roomCorrection.setEnabled', enabled: this.roomCorrectionState.enabled });
    return this.emitRoomCorrectionState();
  }

  async setRoomCorrectionTrim(trimDb: number): Promise<RoomCorrectionState> {
    const safeTrimDb = clamp(Number(trimDb), roomCorrectionMinTrimDb, roomCorrectionMaxTrimDb);
    if (!Number.isFinite(safeTrimDb)) {
      throw new Error('invalid_room_correction_trim');
    }

    this.roomCorrectionState = { ...this.roomCorrectionState, trimDb: safeTrimDb };
    this.persistRoomCorrectionState();
    await this.sendNativeRoomCorrection({ type: 'roomCorrection.setTrim', trimDb: safeTrimDb });
    return this.emitRoomCorrectionState();
  }

  async clearRoomCorrection(): Promise<RoomCorrectionState> {
    this.roomCorrectionIrPath = null;
    this.roomCorrectionState = defaultRoomCorrectionState();
    this.persistRoomCorrectionState();
    await this.sendNativeRoomCorrection({ type: 'roomCorrection.clear' });
    return this.emitRoomCorrectionState();
  }

  savePreset(request: EqSavePresetRequest): EqPreset {
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

    const presets = this.readUserPresets();
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

    this.writeUserPresets(presets);
    this.state = {
      ...this.state,
      preampDb: preset.preampDb,
      bands: preset.bands.map((band) => ({ ...band })),
      presetId: preset.id,
      presetName: preset.name,
      clippingRisk: false,
    };
    this.markStateChanged();
    this.persistState();
    this.emitState();
    return preset;
  }

  deletePreset(presetId: string): EqPreset[] {
    if (builtInPresets.some((preset) => preset.id === presetId)) {
      throw new Error('cannot_delete_builtin_eq_preset');
    }

    const presets = this.readUserPresets().filter((preset) => preset.id !== presetId);
    this.writeUserPresets(presets);
    return this.listPresets();
  }

  listProfiles(): EqProfile[] {
    return this.readProfiles().map(cloneProfile);
  }

  saveProfile(request: EqSaveProfileRequest): EqProfile {
    const id = typeof request.id === 'string' && request.id.trim() ? sanitizePresetId(request.id) : sanitizePresetId(request.name);
    const state = normalizeState(request.state);
    const name = typeof request.name === 'string' && request.name.trim() ? request.name.trim().slice(0, 64) : null;

    if (!id || !name || !state) {
      throw new Error('invalid_eq_profile');
    }

    const profiles = this.readProfiles();
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

    this.writeProfiles(profiles);
    return cloneProfile(profile);
  }

  async applyProfile(profileId: string): Promise<EqState> {
    const profile = this.readProfiles().find((item) => item.id === profileId);

    if (!profile) {
      throw new Error('eq_profile_not_found');
    }

    this.state = cloneState(profile.state);
    this.markStateChanged();
    this.persistState();
    await this.sendNative({ type: 'eq:set-enabled', enabled: this.state.enabled });
    await this.sendNative({ type: 'eq:set-preset', preampDb: this.state.preampDb, bands: this.state.bands });
    return this.emitState();
  }

  deleteProfile(profileId: string): EqProfile[] {
    const profiles = this.readProfiles().filter((profile) => profile.id !== profileId);
    this.writeProfiles(profiles);
    return profiles.map(cloneProfile);
  }

  bindProfileToOutput(request: EqBindProfileRequest): EqProfileBindingInfo {
    const binding = buildProfileBinding(request.target);
    const profiles = this.readProfiles();
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

    this.writeProfiles(nextProfiles);
    return {
      key: binding.key,
      label: binding.label,
      profileId: request.profileId,
      profileName: nextProfiles[profileIndex].name,
    };
  }

  getProfileBinding(target: EqProfileBindingTarget): EqProfileBindingInfo {
    const binding = buildProfileBinding(target);
    const profile = this.readProfiles().find((item) => item.bindings.some((profileBinding) => profileBinding.key === binding.key));

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

  applyBoundProfileForOutput(target: EqProfileBindingTarget): EqProfile | null {
    const binding = this.getProfileBinding(target);

    if (!binding) {
      return null;
    }

    const profile = this.readProfiles().find((item) => item.id === binding.profileId);

    if (!profile) {
      return null;
    }

    this.state = cloneState(profile.state);
    this.markStateChanged();
    this.persistState();
    this.emitState();
    return cloneProfile(profile);
  }

  async syncStateToNative(): Promise<void> {
    const eqState = this.getState();
    const channelBalanceState = this.getChannelBalanceState();
    const roomCorrectionState = this.getRoomCorrectionState();

    this.nativeSyncTargetEqState = eqState;
    this.nativeSyncTargetRevision = this.stateRevision;
    try {
      await this.enqueueNative(async () => {
        await this.sendNativeNow({ type: 'eq:set-enabled', enabled: eqState.enabled });
        await this.sendNativeNow({ type: 'eq:set-preset', preampDb: eqState.preampDb, bands: eqState.bands });
        await this.sendNativeNow({ type: 'dsp:set-headroom', headroomDb: eqState.dspHeadroomDb ?? 0 });
        await this.sendNativeNow({ type: 'dsp:set-safety-limiter-enabled', enabled: eqState.dspSafetyLimiterEnabled !== false });
      });
    } finally {
      const syncRevision = this.nativeSyncTargetRevision;
      this.nativeSyncTargetEqState = null;
      this.nativeSyncTargetRevision = null;
      if (syncRevision === this.stateRevision) {
        this.state = eqState;
        this.emitState();
      }
    }

    if (!isDefaultChannelBalanceState(channelBalanceState)) {
      await this.sendNativeChannelBalance({ type: 'channelBalance.setState', state: channelBalanceState });
    }

    if (this.roomCorrectionIrPath && existsSync(this.roomCorrectionIrPath) && roomCorrectionState.irId && roomCorrectionState.irName) {
      await this.sendNativeRoomCorrection({
        type: 'roomCorrection.loadIr',
        path: this.roomCorrectionIrPath,
        irId: roomCorrectionState.irId,
        irName: roomCorrectionState.irName,
      });
      await this.sendNativeRoomCorrection({ type: 'roomCorrection.setTrim', trimDb: roomCorrectionState.trimDb });
      await this.sendNativeRoomCorrection({ type: 'roomCorrection.setEnabled', enabled: roomCorrectionState.enabled });
    } else if (roomCorrectionState.irId || roomCorrectionState.enabled || this.roomCorrectionIrPath) {
      this.roomCorrectionState = {
        ...defaultRoomCorrectionState(),
        trimDb: roomCorrectionState.trimDb,
        error: roomCorrectionState.irId ? 'missing_file' : null,
        status: roomCorrectionState.irId ? 'error' : 'empty',
      };
      this.roomCorrectionIrPath = null;
      this.persistRoomCorrectionState();
      this.emitRoomCorrectionState();
    }
  }

  private async sendNative(message: Record<string, unknown>): Promise<EqState> {
    return this.enqueueNative(() => this.sendNativeNow(message));
  }

  private async sendNativeNow(message: Record<string, unknown>): Promise<EqState> {
    const socket = this.socket;

    if (!socket || socket.destroyed || !socket.writable) {
      return this.getState();
    }

    return new Promise<EqState>((resolve, reject) => {
      this.pending.push({ expectedState: 'eq', resolve: (state) => resolve(state as EqState), reject });
      socket.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          this.rejectPending(error);
        }
      });
    });
  }

  private async sendNativeChannelBalance(message: Record<string, unknown>): Promise<ChannelBalanceState> {
    return this.enqueueNative(() => this.sendNativeChannelBalanceNow(message));
  }

  private async sendNativeChannelBalanceNow(message: Record<string, unknown>): Promise<ChannelBalanceState> {
    const socket = this.socket;

    if (!socket || socket.destroyed || !socket.writable) {
      return this.getChannelBalanceState();
    }

    return new Promise<ChannelBalanceState>((resolve, reject) => {
      this.pending.push({ expectedState: 'channelBalance', resolve: (state) => resolve(state as ChannelBalanceState), reject });
      socket.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          this.rejectPending(error);
        }
      });
    });
  }

  private async sendNativeRoomCorrection(message: Record<string, unknown>): Promise<RoomCorrectionState> {
    return this.enqueueNative(() => this.sendNativeRoomCorrectionNow(message));
  }

  private async sendNativeRoomCorrectionNow(message: Record<string, unknown>): Promise<RoomCorrectionState> {
    const socket = this.socket;

    if (!socket || socket.destroyed || !socket.writable) {
      return this.getRoomCorrectionState();
    }

    return new Promise<RoomCorrectionState>((resolve, reject) => {
      this.pending.push({ expectedState: 'roomCorrection', resolve: (state) => resolve(state as RoomCorrectionState), reject });
      socket.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          this.rejectPending(error);
        }
      });
    });
  }

  private enqueueNative<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.nativeCommandQueue.then(operation, operation);
    this.nativeCommandQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private handleData(chunk: Buffer): void {
    this.receiveBuffer += chunk.toString('utf8');
    let newlineIndex = this.receiveBuffer.indexOf('\n');

    while (newlineIndex >= 0) {
      const line = this.receiveBuffer.slice(0, newlineIndex).trim();
      this.receiveBuffer = this.receiveBuffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.receiveBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    const pending = this.pending.shift();

    if (!line) {
      pending?.resolve(
        pending.expectedState === 'channelBalance'
          ? this.getChannelBalanceState()
          : pending.expectedState === 'roomCorrection'
            ? this.getRoomCorrectionState()
            : this.getState(),
      );
      return;
    }

    try {
      const message = JSON.parse(line) as Partial<EqState & ChannelBalanceState & RoomCorrectionState> & { type?: string; message?: string; headroomDb?: unknown; safetyLimiterEnabled?: unknown };

      if (message.type === 'eq:error') {
        pending?.reject(new Error(message.message ?? 'eq_native_error'));
        return;
      }

      if (message.type === 'eq:state') {
        const syncTarget = this.nativeSyncTargetEqState;
        if (syncTarget) {
          if (this.nativeSyncTargetRevision === this.stateRevision) {
            this.state = {
              ...syncTarget,
              clippingRisk: Boolean(message.clippingRisk),
            };
            this.emitState();
          }
        } else {
          this.state = {
            ...this.state,
            enabled: Boolean(message.enabled),
            preampDb: clamp(Number(message.preampDb ?? this.state.preampDb), eqMinPreampDb, eqMaxPreampDb),
            bands: validateBands(message.bands, this.state.bands) ?? this.state.bands,
            clippingRisk: Boolean(message.clippingRisk),
          };
          this.emitState();
        }
      }

      if (message.type === 'channelBalance:state') {
        this.channelBalanceState = normalizeChannelBalancePatch(message, this.channelBalanceState);
        this.emitChannelBalanceState();
      }

      if (message.type === 'roomCorrection:state') {
        this.roomCorrectionState = normalizeRoomCorrectionState(message, this.roomCorrectionState);
        this.persistRoomCorrectionState();
        this.emitRoomCorrectionState();
      }

      if (message.type === 'dsp:state') {
        const dspHeadroomDb = Number(message.headroomDb ?? this.state.dspHeadroomDb);
        this.state = {
          ...this.state,
          dspHeadroomDb: Number.isFinite(dspHeadroomDb) ? clamp(dspHeadroomDb, dspHeadroomMinDb, dspHeadroomMaxDb) : this.state.dspHeadroomDb,
          dspSafetyLimiterEnabled: message.safetyLimiterEnabled !== false,
        };
        this.emitState();
      }

      pending?.resolve(
        pending.expectedState === 'channelBalance'
          ? this.getChannelBalanceState()
          : pending.expectedState === 'roomCorrection'
            ? this.getRoomCorrectionState()
            : this.getState(),
      );
    } catch (error) {
      pending?.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private emitState(): EqState {
    const state = this.getState();
    this.emit('state', state);
    return state;
  }

  private emitChannelBalanceState(): ChannelBalanceState {
    const state = this.getChannelBalanceState();
    this.emit('channelBalanceState', state);
    return state;
  }

  private emitRoomCorrectionState(): RoomCorrectionState {
    const state = this.getRoomCorrectionState();
    this.emit('roomCorrectionState', state);
    return state;
  }

  private persistChannelBalanceState(): void {
    try {
      setAppSettings({ channelBalance: this.channelBalanceState });
    } catch {
      // Tests and early startup can run without a ready Electron app path.
    }
  }

  private persistRoomCorrectionState(): void {
    try {
      mkdirSync(dirname(this.roomCorrectionStatePath), { recursive: true });
      const persisted: PersistedRoomCorrectionState = {
        ...this.roomCorrectionState,
        irPath: this.roomCorrectionIrPath,
      };
      writeFileSync(this.roomCorrectionStatePath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
    } catch {
      // Tests and early startup can run without a ready Electron app path.
    }
  }

  private readPersistedRoomCorrectionState(): void {
    if (!existsSync(this.roomCorrectionStatePath)) {
      this.roomCorrectionState = defaultRoomCorrectionState();
      this.roomCorrectionIrPath = null;
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.roomCorrectionStatePath, 'utf8')) as PersistedRoomCorrectionState;
      this.roomCorrectionState = normalizeRoomCorrectionState(parsed);
      this.roomCorrectionIrPath = typeof parsed.irPath === 'string' && parsed.irPath.trim() ? parsed.irPath : null;
      if (this.roomCorrectionIrPath && !existsSync(this.roomCorrectionIrPath)) {
        this.roomCorrectionState = {
          ...this.roomCorrectionState,
          enabled: false,
          status: 'error',
          error: 'missing_file',
        };
      }
    } catch {
      this.roomCorrectionState = defaultRoomCorrectionState();
      this.roomCorrectionIrPath = null;
    }
  }

  private rejectPending(error: Error): void {
    const pending = this.pending;
    this.pending = [];
    pending.forEach((request) => request.reject(error));
  }

  private readUserPresets(): EqPreset[] {
    if (!existsSync(this.presetPath)) {
      return [];
    }

    try {
      const parsed = JSON.parse(readFileSync(this.presetPath, 'utf8')) as unknown;

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

  private writeUserPresets(presets: EqPreset[]): void {
    this.ensurePhase2Backup();
    mkdirSync(dirname(this.presetPath), { recursive: true });
    writeFileSync(this.presetPath, JSON.stringify(presets, null, 2), 'utf8');
  }

  private readProfiles(): EqProfile[] {
    if (!existsSync(this.profilePath)) {
      return [];
    }

    try {
      const parsed = JSON.parse(readFileSync(this.profilePath, 'utf8')) as unknown;

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map(normalizeProfile).filter((profile): profile is EqProfile => Boolean(profile));
    } catch {
      return [];
    }
  }

  private writeProfiles(profiles: EqProfile[]): void {
    this.ensurePhase2Backup();
    mkdirSync(dirname(this.profilePath), { recursive: true });
    writeFileSync(this.profilePath, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8');
  }

  private readPersistedState(): EqState {
    if (!existsSync(this.statePath)) {
      return defaultState();
    }

    try {
      return normalizeState(JSON.parse(readFileSync(this.statePath, 'utf8'))) ?? defaultState();
    } catch {
      return defaultState();
    }
  }

  private persistState(): void {
    try {
      this.ensurePhase2Backup();
      mkdirSync(dirname(this.statePath), { recursive: true });
      writeFileSync(this.statePath, `${JSON.stringify(this.getState(), null, 2)}\n`, 'utf8');
    } catch {
      // Persistence is best-effort; audio controls should still work if the profile path is unavailable.
    }
  }

  private ensurePhase2Backup(): void {
    if (existsSync(this.backupMarkerPath)) {
      return;
    }

    const timestamp = nowIso().replace(/[:.]/g, '-');
    const backupPath = join(this.backupDirectory, `phase2-${timestamp}`);
    mkdirSync(backupPath, { recursive: true });

    for (const fileName of ['eq-state.json', 'eq-presets.json', 'eq-profiles.json']) {
      const sourcePath = join(dirname(this.statePath), fileName);
      if (existsSync(sourcePath)) {
        copyFileSync(sourcePath, join(backupPath, fileName));
      }
    }

    mkdirSync(this.backupDirectory, { recursive: true });
    writeFileSync(this.backupMarkerPath, `${timestamp}\n`, 'utf8');
  }
}

let defaultEqBridge: EqBridge | null = null;

export const getEqBridge = (): EqBridge => {
  if (!defaultEqBridge) {
    defaultEqBridge = new EqBridge();
    defaultEqBridge.setMaxListeners(64);
  }
  return defaultEqBridge;
};
