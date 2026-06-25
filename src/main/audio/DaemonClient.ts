import { spawn as nodeSpawn, execFileSync as nodeExecFileSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
import type { AudioStatus } from '../../shared/types/audio';
import type { PlaybackMemory } from './PlaybackMemoryStore';

// =========================================================================
// DaemonClient — JSON-RPC 2.0 client for the echo-audio-daemon subprocess
// =========================================================================

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JMsg {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  params?: unknown;
}

const READY_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 10_000;
const GRACEFUL_SHUTDOWN_MS = 3_000;
const RECONNECT_DELAY_MS = 1_000;

/** JSON-RPC 2.0 client for the echo-audio-daemon subprocess. */
export class DaemonClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private shuttingDown = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private autoReconnect = false;

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  /**
   * Spawn the daemon binary.
   * @param binaryPath  - Explicit path (omit for auto-resolution).
   * @param args        - CLI arguments (default `['--null-output']` in dev).
   * @param autoRestart - If true, respawn on unexpected exit (default false).
   */
  async spawn(
    binaryPath?: string,
    args?: string[],
    autoRestart?: boolean,
  ): Promise<void> {
    this.autoReconnect = autoRestart ?? false;
    const bin = binaryPath ?? resolveBinary();
    const argv = args ?? [];

    return new Promise<void>((resolveReady, rejectReady) => {
      try {
        const proc = nodeSpawn(bin, argv, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        this.proc = proc;
        proc.stderr.resume();

        const rl = createInterface({ input: proc.stdout });
        let ready = false;
        let timeout: ReturnType<typeof setTimeout> | null = null;

        rl.on('line', (line: string) => {
          let msg: JMsg;
          try { msg = JSON.parse(line); } catch { return; }
          this.handleMessage(msg);
          if (msg.method === 'event.ready' && !ready) {
            ready = true;
            if (timeout) clearTimeout(timeout);
            resolveReady();
          }
        });

        proc.on('error', (err) => {
          if (!ready) { ready = true; if (timeout) clearTimeout(timeout); rejectReady(err); }
          this.onExit();
        });

        proc.on('exit', (code, signal) => {
          if (!ready) {
            ready = true;
            if (timeout) clearTimeout(timeout);
            rejectReady(new Error(`Daemon exited before ready (code=${code} signal=${signal})`));
          }
          this.onExit();
        });

        timeout = setTimeout(() => {
          if (!ready) { ready = true; resolveReady(); }
        }, READY_TIMEOUT_MS);
      } catch (err) {
        rejectReady(err);
      }
    });
  }

  async command(method: string, params?: unknown): Promise<unknown> {
    if (!this.running) throw new Error('Daemon is not running');

    const id = ++this.nextId;
    const req: Record<string, unknown> = { jsonrpc: '2.0', id, method };
    if (params !== undefined) req.params = params;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.proc!.stdin.write(JSON.stringify(req) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /** Gracefully shut down the daemon (RPC + SIGKILL fallback). */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (!this.proc || this.proc.exitCode !== null) return;

    try { await this.command('shutdown'); } catch { /* process may have already exited */ }

    await this.forceKill();
    this.proc = null;
  }

  private handleMessage(msg: JMsg): void {
    if (msg.id != null) {
      const pr = this.pending.get(Number(msg.id));
      if (!pr) return;
      clearTimeout(pr.timer);
      this.pending.delete(Number(msg.id));

      if (msg.error) {
        const err = new Error(msg.error.message) as Error & { code?: number; data?: unknown };
        err.code = msg.error.code;
        err.data = msg.error.data;
        pr.reject(err);
      } else {
        pr.resolve(msg.result);
      }
      return;
    }

    if (msg.method) {
      this.emit(msg.method, msg.params ?? {});
    }
  }

  private onExit(): void {
    this.proc = null;
    for (const [, pr] of this.pending) { clearTimeout(pr.timer); pr.reject(new Error('Daemon process exited')); }
    this.pending.clear();
    if (!this.shuttingDown && this.autoReconnect) {
      this.reconnectTimer = setTimeout(() => { this.spawn().catch(() => {}); }, RECONNECT_DELAY_MS);
    }
  }

  private forceKill(): Promise<void> {
    const p = this.proc;
    if (!p || p.exitCode !== null || p.killed) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => { p.kill('SIGKILL'); resolve(); }, GRACEFUL_SHUTDOWN_MS);
      p.on('exit', () => { clearTimeout(timer); resolve(); });
      p.stdin.end();
      p.kill();
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let defaultDaemonClient: DaemonClient | null = null;

export const getDaemonClient = (): DaemonClient => {
  defaultDaemonClient ??= new DaemonClient();
  return defaultDaemonClient;
};

/** Resolve the daemon binary path (prod: resourcesPath, dev: electron-app/build/...). */
function resolveBinary(): string {
  if (process.resourcesPath) {
    return join(process.resourcesPath, 'echo-audio-daemon');
  }
  // Dev: look in electron-app/build/ (where ensure-audio-daemon copies it)
  const devPath = join(process.cwd(), 'electron-app', 'build', 'echo-audio-daemon');
  if (existsSync(devPath)) return devPath;
  // Fallback: direct build output
  return join(process.cwd(), 'native', 'echo-audio-daemon', 'build', 'src', 'echo-audio-daemon');
}

// =========================================================================
// AudioSession — thin wrapper around DaemonClient
// =========================================================================

export type AudioErrorRecoveryHandler = (error: Error, status: AudioStatus) => boolean;

export class AudioSession extends EventEmitter {
  private status: AudioStatus = { state: 'idle' } as AudioStatus;
  private audioErrorRecoveryHandler: AudioErrorRecoveryHandler | null = null;

  constructor() {
    super();
    this.setMaxListeners(64);

    const client = getDaemonClient();
    client.on('event.status', (params: unknown) => {
      const s = params as AudioStatus;
      this.status = s;
      this.emit('status', s);
    });
  }

  // ----- state query -----

  getStatus(): AudioStatus {
    return this.status;
  }

  getDiagnostics(): Record<string, unknown> {
    return {};
  }

  // ----- playback control -----

  async play(): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('play');
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  async pause(): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('pause');
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  stop(): AudioStatus {
    getDaemonClient().command('stop').catch(() => undefined);
    return this.status;
  }

  async seek(seconds: number): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('seek', { seconds });
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  async playLocalFile(request: Record<string, unknown>): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('playLocalFile', request);
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  async prepareLocalFile(request: Record<string, unknown>): Promise<void> {
    try {
      await getDaemonClient().command('prepareLocalFile', request);
    } catch { /* daemon not ready */ }
  }

  async playPcmStream(request: Record<string, unknown>): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('playPcmStream', request);
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  async restorePlaybackMemory(memory: PlaybackMemory): Promise<void> {
    try {
      await getDaemonClient().command('restorePlaybackMemory', memory);
    } catch { /* daemon not ready */ }
  }

  async setOutput(settings: Record<string, unknown>): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('setOutput', settings);
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  setAudioErrorRecoveryHandler(handler: AudioErrorRecoveryHandler | null): void {
    this.audioErrorRecoveryHandler = handler;
  }

  dispose(): void {
    this.removeAllListeners();
  }

  async disposeGracefully(reason = 'app-quit'): Promise<void> {
    try {
      await getDaemonClient().command('shutdown', { reason });
    } catch { /* daemon not running */ }
    this.dispose();
  }
}

// ---------------------------------------------------------------------------
// AudioSession Singleton
// ---------------------------------------------------------------------------

let defaultAudioSession: AudioSession | null = null;

export const getAudioSession = (): AudioSession => {
  defaultAudioSession ??= new AudioSession();
  return defaultAudioSession;
};

export const disposeDefaultAudioSessionGracefully = async (reason = 'app-quit'): Promise<void> => {
  if (!defaultAudioSession) return;
  const session = defaultAudioSession;
  defaultAudioSession = null;
  await session.disposeGracefully(reason);
};

// =========================================================================
// EqBridge — manages EQ state, presets, profiles
// =========================================================================

const getUserDataPath = (): string => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
// EqBridge Singleton
// ---------------------------------------------------------------------------

let defaultBridge: EqBridge | null = null;

export const getEqBridge = (): EqBridge => {
  if (!defaultBridge) {
    defaultBridge = new EqBridge();
    defaultBridge.setMaxListeners(64);
  }
  return defaultBridge;
};

// =========================================================================
// FfmpegToolchain — FFmpeg binary resolution
// =========================================================================

export type FfmpegToolchainSource = 'explicit' | 'bundled' | 'dev-bundled' | 'system';

export type FfmpegToolchainInfo = {
  path: string;
  source: FfmpegToolchainSource;
  version: string | null;
  healthy: boolean;
  soxrAvailable: boolean;
  aresampleAvailable: boolean;
  buildConfiguration: string | null;
  manifestVersion: string | null;
  error: string | null;
};

export type FfmpegToolchainDependencies = {
  ffmpegPath?: string | null;
  env?: NodeJS.ProcessEnv;
  systemFfmpegPath?: string | null;
  resourcesPath?: string | null;
  platform?: NodeJS.Platform;
  cwd?: string;
  existsSync?: (path: string) => boolean;
  execFileSync?: typeof nodeExecFileSync;
  logger?: (message: string) => void;
  requireHealthy?: boolean;
};

type FfmpegCandidate = {
  path: string;
  source: FfmpegToolchainSource;
  mustExist: boolean;
};

type FfmpegManifest = {
  version?: unknown;
};

const toolchainCache = new Map<string, FfmpegToolchainInfo>();

const normalizePath = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

export const normalizeAsarUnpackedPath = (path: string): string =>
  path.includes('app.asar') && !path.includes('app.asar.unpacked')
    ? path.replace('app.asar', 'app.asar.unpacked')
    : path;

const getResourcesPath = (dependencies: FfmpegToolchainDependencies): string | null => {
  const explicit = normalizePath(dependencies.resourcesPath);
  if (explicit) {
    return explicit;
  }

  const processResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return normalizePath(processResourcesPath);
};

const readManifestVersion = (ffmpegPath: string): string | null => {
  try {
    const manifestPath = join(dirname(ffmpegPath), 'ffmpeg-manifest.json');
    if (!existsSync(manifestPath)) {
      return null;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FfmpegManifest;
    return typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version.trim() : null;
  } catch {
    return null;
  }
};

const collectCandidates = (dependencies: FfmpegToolchainDependencies = {}): FfmpegCandidate[] => {
  const env = dependencies.env ?? process.env;
  const resourcesPath = getResourcesPath(dependencies);
  const cwd = dependencies.cwd ?? process.cwd();
  const platform = dependencies.platform ?? process.platform;
  const executableName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const systemPath = normalizePath(dependencies.systemFfmpegPath) ?? 'ffmpeg';
  const candidates: Array<FfmpegCandidate | null> = [
    normalizePath(dependencies.ffmpegPath)
      ? { path: normalizeAsarUnpackedPath(normalizePath(dependencies.ffmpegPath) as string), source: 'explicit', mustExist: false }
      : null,
    normalizePath(env.ECHO_FFMPEG_PATH)
      ? { path: normalizeAsarUnpackedPath(normalizePath(env.ECHO_FFMPEG_PATH) as string), source: 'explicit', mustExist: false }
      : null,
    resourcesPath
      ? { path: resolve(resourcesPath, 'tools', executableName), source: 'bundled', mustExist: true }
      : null,
    platform !== 'win32'
      ? { path: resolve(cwd, 'electron-app', 'tools-linux', executableName), source: 'dev-bundled', mustExist: true }
      : null,
    { path: resolve(cwd, 'electron-app', 'tools', executableName), source: 'dev-bundled', mustExist: true },
    { path: systemPath, source: 'system', mustExist: false },
  ];

  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is FfmpegCandidate => {
    if (!candidate || seen.has(candidate.path)) {
      return false;
    }

    seen.add(candidate.path);
    return true;
  });
};

const parseVersion = (output: string): string | null => {
  const firstLine = output.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? '';
  const match = firstLine.match(/^ffmpeg version\s+([^\s]+)/iu);
  return match?.[1] ?? null;
};

const parseBuildConfiguration = (output: string): string | null => {
  const match = output.match(/configuration:\s*(.+)/iu);
  return match?.[1]?.trim() ?? null;
};

const hasAresampleFilter = (output: string): boolean => /(^|\n)\s*\.{2,3}\s+aresample\s+/iu.test(output);

const inspectCandidate = (
  candidate: FfmpegCandidate,
  dependencies: FfmpegToolchainDependencies,
): FfmpegToolchainInfo => {
  const cacheKey = `${candidate.source}:${candidate.path}`;
  const cached = toolchainCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const execFileSync = dependencies.execFileSync ?? nodeExecFileSync;
  try {
    const versionOutput = execFileSync(candidate.path, ['-hide_banner', '-version'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    }) as string;
    const filtersOutput = execFileSync(candidate.path, ['-hide_banner', '-filters'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    }) as string;
    const buildConfiguration = parseBuildConfiguration(versionOutput);
    const info: FfmpegToolchainInfo = {
      path: candidate.path,
      source: candidate.source,
      version: parseVersion(versionOutput),
      healthy: true,
      soxrAvailable: Boolean(buildConfiguration?.includes('--enable-libsoxr')) && hasAresampleFilter(filtersOutput),
      aresampleAvailable: hasAresampleFilter(filtersOutput),
      buildConfiguration,
      manifestVersion: readManifestVersion(candidate.path),
      error: null,
    };
    toolchainCache.set(cacheKey, info);
    return info;
  } catch (error) {
    const info: FfmpegToolchainInfo = {
      path: candidate.path,
      source: candidate.source,
      version: null,
      healthy: false,
      soxrAvailable: false,
      aresampleAvailable: false,
      buildConfiguration: null,
      manifestVersion: readManifestVersion(candidate.path),
      error: error instanceof Error ? error.message : String(error),
    };
    toolchainCache.set(cacheKey, info);
    return info;
  }
};

export const resolveFfmpegToolchain = (dependencies: FfmpegToolchainDependencies = {}): FfmpegToolchainInfo => {
  const existsSyncFn = dependencies.existsSync ?? existsSync;
  const requireHealthy = dependencies.requireHealthy !== false;
  const candidates = collectCandidates(dependencies);
  let firstUnhealthy: FfmpegToolchainInfo | null = null;

  for (const candidate of candidates) {
    if (candidate.mustExist && !existsSyncFn(candidate.path)) {
      continue;
    }

    if (!requireHealthy) {
      return {
        path: candidate.path,
        source: candidate.source,
        version: null,
        healthy: true,
        soxrAvailable: false,
        aresampleAvailable: false,
        buildConfiguration: null,
        manifestVersion: readManifestVersion(candidate.path),
        error: null,
      };
    }

    const info = inspectCandidate(candidate, dependencies);
    if (info.healthy) {
      return info;
    }

    firstUnhealthy ??= info;
  }

  return firstUnhealthy ?? {
    path: 'ffmpeg',
    source: 'system',
    version: null,
    healthy: false,
    soxrAvailable: false,
    aresampleAvailable: false,
    buildConfiguration: null,
    manifestVersion: null,
    error: 'ffmpeg_missing',
  };
};

export const resolveFfmpegToolchainPath = (dependencies: FfmpegToolchainDependencies = {}): string =>
  resolveFfmpegToolchain({ ...dependencies, requireHealthy: dependencies.requireHealthy ?? false }).path;

export const clearFfmpegToolchainCache = (): void => {
  toolchainCache.clear();
};
