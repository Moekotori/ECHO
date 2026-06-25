import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ChannelBalanceMonoMode,
  ChannelBalanceState,
} from '../../shared/types/audio';
import {
  channelBalanceMaxBalance,
  channelBalanceMinBalance,
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
import { getDaemonClient } from './DaemonClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getUserDataPath = (): string => {
  try {
    const electron = require('electron') as { app?: { getPath?: (name: string) => string } };
    if (electron?.app?.getPath) {
      const basePath = electron.app.getPath('userData');
      if (basePath) return basePath;
    }
  } catch { /* not in electron */ }
  return '.';
};

const nowIso = (): string => new Date().toISOString();

const sanitizePresetId = (id: string): string =>
  id.replace(/[^a-zA-Z0-9_-]/g, '_') || `preset_${Date.now()}`;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const readJsonFile = <T>(filePath: string, fallback: T): T => {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch { return fallback; }
};

const writeJsonFile = (filePath: string, data: unknown): void => {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

// ---------------------------------------------------------------------------
// Default factory functions
// ---------------------------------------------------------------------------

const defaultBand = (i: number): EqBand => ({
  frequencyHz: eqFrequenciesHz[i] ?? 1000,
  gainDb: 0,
  q: 1.41,
  filterType: 'peaking',
  enabled: true,
});

const defaultState = (): EqState => ({
  enabled: false,
  preampDb: 0,
  dspHeadroomDb: 0,
  bands: Array.from({ length: eqBandCount }, (_, i) => defaultBand(i)),
  presetId: 'default',
  presetName: 'Default',
  clippingRisk: false,
});

const defaultChannelBalanceState = (): ChannelBalanceState => ({
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: false,
});

const defaultRoomCorrectionState = (): RoomCorrectionState => ({
  enabled: false,
  status: 'empty',
  irId: null,
  irName: null,
  channelMode: 'stereo',
  sampleRate: null,
  tapCount: 0,
  trimDb: 0,
  latencySamples: 0,
  clippingRisk: false,
  error: null,
});

const cloneState = (s: EqState): EqState => ({
  ...s,
  bands: s.bands.map((b) => ({ ...b })),
});

// ---------------------------------------------------------------------------
// EqBridge — manages EQ state, presets, profiles; delegates processing to daemon
// ---------------------------------------------------------------------------

export class EqBridge extends EventEmitter {
  private state: EqState;
  private channelBalanceState: ChannelBalanceState;
  private roomCorrectionState: RoomCorrectionState;
  private roomCorrectionIrPath: string | null = null;
  private stateRevision = 0;
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
    this.state = readJsonFile<EqState>(this.statePath, defaultState());
    this.channelBalanceState = readJsonFile<ChannelBalanceState>(
      join(userDataPath, 'channel-balance-state.json'),
      defaultChannelBalanceState(),
    );
    this.roomCorrectionState = readJsonFile<RoomCorrectionState>(this.roomCorrectionStatePath, defaultRoomCorrectionState());
    this.on('error', () => undefined);
  }

  // ----- State queries -----

  getState(): EqState {
    return cloneState(this.state);
  }

  getChannelBalanceState(): ChannelBalanceState {
    return { ...this.channelBalanceState };
  }

  getRoomCorrectionState(): RoomCorrectionState {
    return { ...this.roomCorrectionState };
  }

  getRoomCorrectionIrPath(): string | null {
    return this.roomCorrectionIrPath;
  }

  // ----- Core EQ operations -----

  async setEnabled(enabled: boolean): Promise<EqState> {
    this.state.enabled = enabled;
    this.stateRevision++;
    this.persistState();
    this.emit('state', this.getState());
    return this.getState();
  }

  async setPreamp(preampDb: number): Promise<EqState> {
    this.state.preampDb = clamp(preampDb, eqMinPreampDb, eqMaxPreampDb);
    this.stateRevision++;
    this.persistState();
    this.emit('state', this.getState());
    return this.getState();
  }

  async setBand(index: number, band: Partial<EqBand>): Promise<EqState> {
    if (index < 0 || index >= this.state.bands.length) return this.getState();
    const target = this.state.bands[index];
    if (band.frequencyHz !== undefined) target.frequencyHz = clamp(band.frequencyHz, eqMinFrequencyHz, eqMaxFrequencyHz);
    if (band.gainDb !== undefined) target.gainDb = clamp(band.gainDb, eqMinGainDb, eqMaxGainDb);
    if (band.q !== undefined) target.q = clamp(band.q, eqMinQ, eqMaxQ);
    if (band.filterType !== undefined && eqFilterTypes.includes(band.filterType)) target.filterType = band.filterType;
    if (band.enabled !== undefined) target.enabled = band.enabled;
    this.stateRevision++;
    this.persistState();
    this.emit('state', this.getState());
    return this.getState();
  }

  async setBandGain(index: number, gainDb: number): Promise<EqState> {
    return this.setBand(index, { gainDb });
  }

  async setBandEnabled(index: number, enabled: boolean): Promise<EqState> {
    return this.setBand(index, { enabled });
  }

  async setBandFilterType(index: number, filterType: EqFilterType): Promise<EqState> {
    return this.setBand(index, { filterType });
  }

  async setBandFrequency(index: number, frequencyHz: number): Promise<EqState> {
    return this.setBand(index, { frequencyHz });
  }

  async setBandQ(index: number, q: number): Promise<EqState> {
    return this.setBand(index, { q });
  }

  async setDspHeadroom(db: number): Promise<EqState> {
    this.state.dspHeadroomDb = clamp(db, dspHeadroomMinDb, dspHeadroomMaxDb);
    this.persistState();
    this.emit('state', this.getState());
    return this.getState();
  }

  async resetState(): Promise<EqState> {
    this.state = defaultState();
    this.stateRevision++;
    this.persistState();
    this.emit('state', this.getState());
    return this.getState();
  }

  // ----- Presets -----

  getPresets(): EqPreset[] {
    return readJsonFile<EqPreset[]>(this.presetPath, []);
  }

  savePreset(request: EqSavePresetRequest): EqPreset {
    const presets = this.getPresets();
    const id = request.id ?? `${sanitizePresetId(request.name)}_${Date.now()}`;
    const existing = presets.findIndex((p) => p.id === id);
    const preset: EqPreset = {
      id,
      name: request.name.slice(0, 64),
      preampDb: clamp(request.preampDb, eqMinPreampDb, eqMaxPreampDb),
      bands: request.bands.map((b, i) => ({
        frequencyHz: clamp(b.frequencyHz ?? eqFrequenciesHz[i] ?? 1000, eqMinFrequencyHz, eqMaxFrequencyHz),
        gainDb: clamp(b.gainDb, eqMinGainDb, eqMaxGainDb),
        q: clamp(b.q ?? 1.41, eqMinQ, eqMaxQ),
        filterType: b.filterType ?? 'peaking',
        enabled: b.enabled !== false,
      })),
      createdAt: existing >= 0 ? presets[existing].createdAt : nowIso(),
      updatedAt: nowIso(),
      readonly: existing >= 0 ? presets[existing].readonly : false,
    };
    if (existing >= 0) {
      presets[existing] = preset;
    } else {
      presets.push(preset);
    }
    writeJsonFile(this.presetPath, presets);
    return preset;
  }

  async setPreset(presetId: string): Promise<EqState> {
    const preset = this.getPresets().find((p) => p.id === presetId);
    if (!preset) throw new Error('eq_preset_not_found');
    this.state.enabled = true;
    this.state.preampDb = preset.preampDb;
    this.state.bands = preset.bands.map((b) => ({ ...b }));
    this.state.presetId = preset.id;
    this.state.presetName = preset.name;
    this.stateRevision++;
    this.persistState();
    this.emit('state', this.getState());
    return this.getState();
  }

  deletePreset(presetId: string): void {
    writeJsonFile(this.presetPath, this.getPresets().filter((p) => p.id !== presetId));
  }

  async importPreset(request: EqSavePresetRequest): Promise<EqPreset> {
    return this.savePreset(request);
  }

  // ----- Profiles -----

  getProfiles(): EqProfile[] {
    return readJsonFile<EqProfile[]>(this.profilePath, []);
  }

  getProfileBindings(): EqProfileBindingInfo[] {
    return this.getProfiles().flatMap((profile) =>
      profile.bindings.map((binding) => ({
        ...binding,
        profileId: profile.id,
        profileName: profile.name,
      })),
    );
  }

  saveProfile(request: EqSaveProfileRequest): EqProfile {
    const profiles = this.getProfiles();
    const id = request.id ?? `profile_${Date.now()}`;
    const existing = profiles.findIndex((p) => p.id === id);
    const profile: EqProfile = {
      id,
      name: request.name.slice(0, 64),
      state: request.state,
      bindings: [],
      createdAt: existing >= 0 ? profiles[existing].createdAt : nowIso(),
      updatedAt: nowIso(),
    };
    if (existing >= 0) {
      profiles[existing] = profile;
    } else {
      profiles.push(profile);
    }
    writeJsonFile(this.profilePath, profiles);
    return profile;
  }

  async bindProfile(request: EqBindProfileRequest): Promise<EqState> {
    const profiles = this.getProfiles();
    const profile = profiles.find((p) => p.id === request.profileId);
    if (!profile) throw new Error('eq_profile_not_found');
    const target = request.target;
    profile.bindings.push({
      key: JSON.stringify({
        outputMode: target.outputMode ?? 'shared',
        outputDeviceId: target.outputDeviceId ?? null,
        deviceName: target.deviceName ?? target.outputDeviceName ?? 'System default output',
      }),
      label: `${(target.outputMode ?? 'shared').toUpperCase()} / ${target.deviceName ?? target.outputDeviceName ?? 'Default'}`,
      outputMode: target.outputMode ?? 'shared',
      createdAt: nowIso(),
    });
    writeJsonFile(this.profilePath, profiles);
    this.emit('profile', profile);
    return this.getState();
  }

  deleteProfile(profileId: string): void {
    writeJsonFile(this.profilePath, this.getProfiles().filter((p) => p.id !== profileId));
  }

  applyBoundProfileForOutput(_target: EqProfileBindingTarget): void {
    // EQ profile application is handled by the daemon
  }

  // ----- Channel Balance -----

  async setChannelBalanceEnabled(enabled: boolean): Promise<ChannelBalanceState> {
    this.channelBalanceState.enabled = enabled;
    this.emit('channelBalanceState', { ...this.channelBalanceState });
    return { ...this.channelBalanceState };
  }

  async setChannelBalanceBalance(balance: number): Promise<ChannelBalanceState> {
    this.channelBalanceState.balance = clamp(balance, channelBalanceMinBalance, channelBalanceMaxBalance);
    this.emit('channelBalanceState', { ...this.channelBalanceState });
    return { ...this.channelBalanceState };
  }

  async setChannelBalanceMonoMode(mode: ChannelBalanceMonoMode): Promise<ChannelBalanceState> {
    this.channelBalanceState.monoMode = mode;
    this.emit('channelBalanceState', { ...this.channelBalanceState });
    return { ...this.channelBalanceState };
  }

  async setChannelBalanceInvertLeft(invert: boolean): Promise<ChannelBalanceState> {
    this.channelBalanceState.invertLeft = invert;
    this.emit('channelBalanceState', { ...this.channelBalanceState });
    return { ...this.channelBalanceState };
  }

  async setChannelBalanceInvertRight(invert: boolean): Promise<ChannelBalanceState> {
    this.channelBalanceState.invertRight = invert;
    this.emit('channelBalanceState', { ...this.channelBalanceState });
    return { ...this.channelBalanceState };
  }

  async setChannelBalanceSwapChannels(swap: boolean): Promise<ChannelBalanceState> {
    this.channelBalanceState.swapLeftRight = swap;
    this.emit('channelBalanceState', { ...this.channelBalanceState });
    return { ...this.channelBalanceState };
  }

  // ----- Room Correction -----

  getRoomCorrectionIrList(): string[] {
    try {
      if (!existsSync(this.roomCorrectionIrDirectory)) return [];
      return readFileSync(this.roomCorrectionIrDirectory, 'utf8').split('\n').filter(Boolean);
    } catch { return []; }
  }

  async setRoomCorrectionEnabled(enabled: boolean): Promise<RoomCorrectionState> {
    this.roomCorrectionState.enabled = enabled;
    this.roomCorrectionState.status = enabled ? 'active' : 'loaded';
    writeJsonFile(this.roomCorrectionStatePath, this.roomCorrectionState);
    this.emit('roomCorrectionState', { ...this.roomCorrectionState });
    return { ...this.roomCorrectionState };
  }

  async setRoomCorrectionChannelMode(mode: RoomCorrectionChannelMode): Promise<RoomCorrectionState> {
    this.roomCorrectionState.channelMode = mode;
    writeJsonFile(this.roomCorrectionStatePath, this.roomCorrectionState);
    this.emit('roomCorrectionState', { ...this.roomCorrectionState });
    return { ...this.roomCorrectionState };
  }

  async setRoomCorrectionTrimDb(trimDb: number): Promise<RoomCorrectionState> {
    this.roomCorrectionState.trimDb = clamp(trimDb, roomCorrectionMinTrimDb, roomCorrectionMaxTrimDb);
    writeJsonFile(this.roomCorrectionStatePath, this.roomCorrectionState);
    this.emit('roomCorrectionState', { ...this.roomCorrectionState });
    return { ...this.roomCorrectionState };
  }

  async importRoomCorrectionIr(filePath: string): Promise<RoomCorrectionState | null> {
    this.roomCorrectionIrPath = filePath;
    this.roomCorrectionState.enabled = true;
    this.roomCorrectionState.status = 'active';
    this.roomCorrectionState.irId = 'imported';
    this.roomCorrectionState.irName = filePath.split('/').pop() ?? filePath.split('\\').pop() ?? 'imported.wav';
    writeJsonFile(this.roomCorrectionStatePath, this.roomCorrectionState);
    this.emit('roomCorrectionState', { ...this.roomCorrectionState });
    return { ...this.roomCorrectionState };
  }

  async resetRoomCorrection(): Promise<RoomCorrectionState> {
    this.roomCorrectionState = defaultRoomCorrectionState();
    this.roomCorrectionIrPath = null;
    writeJsonFile(this.roomCorrectionStatePath, this.roomCorrectionState);
    this.emit('roomCorrectionState', { ...this.roomCorrectionState });
    return { ...this.roomCorrectionState };
  }

  // ----- Native bridge (delegated to daemon) -----

  reserveControlPort(): number { return 0; }

  connect(_port: number): void { /* handled by daemon */ }

  disconnect(_expectedPort?: number | null): void { /* handled by daemon */ }

  async syncStateToNative(): Promise<void> {
    try {
      await getDaemonClient().command('eq.syncState', {
        state: this.state,
        channelBalance: this.channelBalanceState,
        roomCorrection: this.roomCorrectionState,
      });
    } catch {
      // daemon not running
    }
  }

  // ----- Persistence -----

  private persistState(): void {
    writeJsonFile(this.statePath, this.state);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let defaultBridge: EqBridge | null = null;

export const getEqBridge = (): EqBridge => {
  if (!defaultBridge) {
    defaultBridge = new EqBridge();
    defaultBridge.setMaxListeners(64);
  }
  return defaultBridge;
};
