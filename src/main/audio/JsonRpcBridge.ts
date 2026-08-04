import { EventEmitter } from 'node:events';
import * as readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { AudioOutputSettings, ChannelBalanceState } from '../../shared/types/audio';
import type {
  EqBindProfileRequest,
  EqPreset,
  EqProfile,
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

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 internal types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  result: unknown;
  id: number;
}

interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  error: JsonRpcErrorObject;
  id: number;
}

interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ---------------------------------------------------------------------------
// Pending request entry
// ---------------------------------------------------------------------------

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface JsonRpcBridgeOptions {
  /** Default timeout per request in ms (default: 10 000) */
  defaultTimeout?: number;
  /** Heartbeat interval in ms (default: 5 000) */
  heartbeatInterval?: number;
}

export interface OpenFileResult {
  status: string; // "decoding" | "probed"
  operationId?: number;
  filePath: string;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  startSeconds?: number;
  codec: string;
  container: string;
  bitDepth?: number;
  bitrate?: number;
}

export interface AudioOperationResult {
  operationId?: number;
}

export interface SessionBeginResult {
  ready: boolean;
  readyLevel: string;
  sr: number;
  ch: number;
  buffer: number;
  fifoMs: number;
  prebufferMs: number;
}

export interface ReplayGainConfigPayload {
  trackGainDb: number;
  albumGainDb: number;
  peak: number;
  mode: number;
  preampDb: number;
  preventClipping: boolean;
}

// ---------------------------------------------------------------------------
// JsonRpcBridge
// ---------------------------------------------------------------------------

/**
 * JSON-RPC 2.0 client that communicates with the native audio host over
 * stdio pipes (fd 3 for write, fd 4 for read).
 *
 * Pipe-based JSON-RPC 2.0 transport for DSP communication with the native
 * audio host, exposing the EQ/channel-balance/room-correction public API.
 */
export class JsonRpcBridge extends EventEmitter {
  // Transport
  private writable: Writable | null = null;
  private reader: readline.Interface | null = null;
  private closed = false;

  // Request sequencing
  private nextId = 1;
  private pending = new Map<number, PendingEntry>();

  // Configuration
  private readonly defaultTimeout: number;
  private readonly heartbeatInterval: number;

  // Heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private consecutivePongMisses = 0;
  private readonly maxPongMisses = 2;

  // ------------------------------------------------------------------
  // Construction
  // ------------------------------------------------------------------

  constructor(options: JsonRpcBridgeOptions = {}) {
    super();
    this.defaultTimeout = options.defaultTimeout ?? 10_000;
    this.heartbeatInterval = options.heartbeatInterval ?? 5_000;
  }

  // ------------------------------------------------------------------
  // Connection lifecycle
  // ------------------------------------------------------------------

  /** Whether the bridge has been closed. */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Start reading from `readable` and writing to `writable`.
   *
   * @param readable  The host→main JSON-RPC response pipe (fd 4 read side).
   * @param writable  The main→host JSON-RPC request pipe  (fd 3 write side).
   */
  open(readable: Readable, writable: Writable): void {
    if (this.reader) {
      this.reader.close();
    }

    this.closed = false;
    this.writable = writable;
    this.reader = readline.createInterface({ input: readable, crlfDelay: Infinity });

    this.reader.on('line', (line: string) => this.handleLine(line));
    this.reader.on('close', () => this.handleTransportClose());

    writable.on('error', (error: Error) => {
      this.emit('error', error);
    });

    this.startHeartbeat();
  }

  /**
   * Graceful shutdown: send `rpc.shutdown`, clear pending requests,
   * stop heartbeat, close streams.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    this.stopHeartbeat();

    try {
      await this.call<string>('rpc.shutdown');
    } catch {
      // Best-effort – host may already be gone.
    }

    this.rejectAllPending(new Error('rpc_bridge_closed'));
    this.teardownTransport();
  }

  // ------------------------------------------------------------------
  // Core JSON-RPC 2.0 primitives
  // ------------------------------------------------------------------

  /**
   * Issue a JSON-RPC 2.0 **request** (with auto-incrementing `id`) and
   * return a Promise that resolves with the result or rejects with an error.
   *
   * @param method   JSON-RPC method name (e.g. `"eq.getState"`).
   * @param params   Positional params array.
   * @param options  Per-call overrides (e.g. custom timeout).
   */
  call<T>(method: string, params?: unknown[] | Record<string, unknown>, options?: { timeout?: number }): Promise<T> {
    if (this.closed || !this.writable) {
      return Promise.reject(new Error('rpc_bridge_not_open'));
    }

    const id = this.nextId;
    this.nextId += 1;

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const timeout = options?.timeout ?? this.defaultTimeout;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc_timeout: ${method} (${timeout}ms)`));
      }, timeout);

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer, method });

      try {
        this.writable!.write(`${JSON.stringify(request)}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Send a JSON-RPC 2.0 **notification** (no `id` field, no response
   * expected).
   */
  notify(method: string, params?: unknown): void {
    if (this.closed || !this.writable) return;

    this.writeNotification(method, params).catch((error: Error) => this.emit('error', error));
  }

  writeNotification(method: string, params?: unknown): Promise<void> {
    if (this.closed || !this.writable || this.writable.destroyed || this.writable.writableEnded || !this.writable.writable) {
      return Promise.reject(new Error('rpc_bridge_not_open'));
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    return this.writeLine(`${JSON.stringify(notification)}\n`);
  }

  private writeLine(line: string): Promise<void> {
    const writable = this.writable;
    if (this.closed || !writable || writable.destroyed || writable.writableEnded || !writable.writable) {
      return Promise.reject(new Error('rpc_bridge_not_open'));
    }

    return new Promise<void>((resolve, reject) => {
      let writeFinished = false;
      let drainFinished = false;
      let settled = false;

      const cleanup = (): void => {
        writable.off('error', onError);
        writable.off('drain', onDrain);
      };
      const finish = (): void => {
        if (!settled && writeFinished && drainFinished) {
          settled = true;
          cleanup();
          resolve();
        }
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const onDrain = (): void => {
        drainFinished = true;
        finish();
      };
      const onError = (error: Error): void => fail(error);

      writable.once('error', onError);
      try {
        const acceptsMore = writable.write(line, (error?: Error | null) => {
          if (error) {
            fail(error);
            return;
          }
          writeFinished = true;
          finish();
        });
        if (acceptsMore) {
          drainFinished = true;
        } else {
          writable.once('drain', onDrain);
        }
      } catch (error) {
        fail(error);
      }
    });
  }

  // ------------------------------------------------------------------
  // Line processing
  // ------------------------------------------------------------------

  private handleLine(line: string): void {
    if (!line.trim()) return;

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      // JSON-RPC parse error – ignored on the client side (the host
      // receives the parse error response when the client writes).
      return;
    }

    if (isResponse(message)) {
      this.handleResponse(message);
    } else {
      this.handleNotification(message);
    }
  }

  private handleResponse(message: JsonRpcResponse): void {
    const entry = this.pending.get(message.id);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.pending.delete(message.id);

    if ('error' in message && message.error) {
      const err = message.error;
      const rpcError = new Error(err.message || `rpc_error_${err.code}`) as Error & {
        code: number;
        data?: unknown;
      };
      rpcError.code = err.code;
      rpcError.data = err.data;
      entry.reject(rpcError);
    } else {
      entry.resolve((message as JsonRpcSuccessResponse).result);
    }
  }

  private handleNotification(message: JsonRpcNotification): void {
    const { method, params } = message;

    // Emit typed events so consumers can subscribe directly:
    //   bridge.on('audio.ended', (params) => { ... })
    this.emit(method, params);

    // Also emit a generic 'notification' event for catch-all handlers.
    this.emit('notification', method, params);

    // Track heartbeat responses.
    if (method === 'rpc.pong') {
      this.consecutivePongMisses = 0;
    }
  }

  // ------------------------------------------------------------------
  // Transport teardown
  // ------------------------------------------------------------------

  private handleTransportClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    this.rejectAllPending(new Error('rpc_stream_closed'));
    this.emit('close');
  }

  private teardownTransport(): void {
    if (this.reader) {
      this.reader.close();
      this.reader = null;
    }

    if (this.writable) {
      try {
        this.writable.end();
      } catch {
        // Stream already ended.
      }
      this.writable = null;
    }
  }

  private rejectAllPending(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  // ------------------------------------------------------------------
  // Heartbeat
  // ------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.consecutivePongMisses = 0;

    this.heartbeatTimer = setInterval(() => {
      if (this.closed) return;

      this.call<string>('rpc.ping')
        .then(() => {
          this.consecutivePongMisses = 0;
        })
        .catch(() => {
          this.consecutivePongMisses += 1;
          if (this.consecutivePongMisses >= this.maxPongMisses) {
            this.emit('error', new Error('rpc_heartbeat_lost'));
            this.handleTransportClose();
          }
        });
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.consecutivePongMisses = 0;
  }

  // ==================================================================
  // EQ methods
  // ==================================================================

  async getEqState(): Promise<EqState> {
    return this.call<EqState>('eq.getState');
  }

  async getState(): Promise<EqState> {
    return this.getEqState();
  }

  /**
   * Prefetch an audio file for gapless / queued playback.
   * Decodes a short initial window in the daemon background and stores it
   * as a partial cache entry (complete=false). Partial entries are never
   * used for openFile/seek — they only warm the decoder path.
   */
  async prefetch(filePath: string, sampleRate?: number): Promise<boolean> {
    const params: Record<string, unknown> = { filePath };
    if (sampleRate != null) params.sampleRate = sampleRate;
    return this.call<boolean>('audio.prefetch', [params]);
  }

  /**
   * Set the playback queue on the daemon for autonomous track advancement.
   * The daemon stores this queue and auto-advances when tracks end.
   */
  async setQueue(
    items: Array<{ filePath: string; sampleRate?: number; startSeconds?: number }>,
    repeatMode: string = 'off',
  ): Promise<void> {
    await this.call<void>('queue.set', { items, repeatMode });
  }

  async clearQueue(): Promise<void> {
    await this.call<void>('queue.clear');
  }

  /**
   * Open the audio device with given parameters.
   * All params optional — daemon uses defaults (sr=48000, ch=2, buffer=4096, fifoMs=3000, prebufferMs=1000).
   * Called once before first playback or when device params change.
   * Native host treats repeated calls as no-op if already in device-ready state.
   */
  async sessionBegin(params?: {
    sr?: number;
    ch?: number;
    buffer?: number;
    fifoMs?: number;
    prebufferMs?: number;
  }): Promise<SessionBeginResult> {
    return this.call<SessionBeginResult>('audio.sessionBegin', params ?? {});
  }

  /**
   * Open an audio file for playback.
   * Probes metadata (fast) and starts background decode.
   * Returns immediately with probe results. Decode runs in background thread on the host.
   */
  async openFile(filePath: string, sampleRate?: number, startSeconds?: number): Promise<OpenFileResult> {
    const params: Record<string, unknown> = { filePath };
    if (sampleRate != null) params.sampleRate = sampleRate;
    if (startSeconds != null) params.startSeconds = startSeconds;
    return this.call<OpenFileResult>('audio.openFile', [params]);
  }

  async play(): Promise<void> {
    await this.call<void>('audio.play', []);
  }

  async stop(): Promise<AudioOperationResult | void> {
    return this.call<AudioOperationResult | void>('audio.stop', []);
  }

  async pause(): Promise<void> {
    await this.call<void>('audio.pause', []);
  }

  async resume(): Promise<void> {
    await this.call<void>('audio.resume', []);
  }

  async seek(positionSeconds: number): Promise<AudioOperationResult | void> {
    return this.call<AudioOperationResult | void>('audio.seek', [{ positionSeconds }]);
  }

  async setPlaybackRate(rate: number): Promise<void> {
    await this.call<void>('playbackRate.setRate', [rate]);
  }

  async setPlaybackSpeedMode(mode: AudioOutputSettings['playbackSpeedMode']): Promise<void> {
    await this.call<void>('playbackRate.setMode', [mode]);
  }

  async setVolume(volume: number): Promise<void> {
    await this.call<void>('audio.setVolume', [{ volume }]);
  }

  async setReplayGainConfig(config: ReplayGainConfigPayload): Promise<void> {
    await this.call<void>('replayGain.setConfig', [config]);
  }

  async setLevelMeterInterval(intervalMs: number): Promise<void> {
    await this.call<void>('levelMeter.setInterval', [intervalMs]);
  }

  /**
   * Rehydrate EQ/DSP state from native host after a host restart.
   * Called by AudioSession on every playback start. The native host
   * responds with its current EQ state after rehydration.
   */
  async syncStateToNative(): Promise<void> {
    await this.call<void>('eq.syncState', []);
  }

  async setEnabled(enabled: boolean): Promise<EqState> {
    return this.call<EqState>('eq.setEnabled', [enabled]);
  }

  async setBandGain(request: EqSetBandGainRequest): Promise<EqState> {
    return this.call<EqState>('eq.setBandGain', [request]);
  }

  async setBandFrequency(request: EqSetBandFrequencyRequest): Promise<EqState> {
    return this.call<EqState>('eq.setBandFrequency', [request]);
  }

  async setBandQ(request: EqSetBandQRequest): Promise<EqState> {
    return this.call<EqState>('eq.setBandQ', [request]);
  }

  async setBandFilterType(request: EqSetBandFilterTypeRequest): Promise<EqState> {
    return this.call<EqState>('eq.setBandFilterType', [request]);
  }

  async setBandEnabled(request: EqSetBandEnabledRequest): Promise<EqState> {
    return this.call<EqState>('eq.setBandEnabled', [request]);
  }

  async setPreamp(preampDb: number): Promise<EqState> {
    return this.call<EqState>('eq.setPreamp', [preampDb]);
  }

  /** Apply a preset by ID (native host resolves the preset definition). */
  async setPreset(presetId: string): Promise<EqState> {
    return this.call<EqState>('eq.setPreset', [presetId]);
  }

  /** Set full EQ state (used for daemon state sync). */
  async setState(state: EqState): Promise<EqState> {
    return this.call<EqState>('eq.setState', [state]);
  }

  /** Reset EQ bands to flat (0 dB, peaking, Q=1). */
  async reset(): Promise<EqState> {
    return this.call<EqState>('eq.reset');
  }

  // ==================================================================
  // DSP methods
  // ==================================================================

  async setDspHeadroom(headroomDb: number): Promise<EqState> {
    return this.call<EqState>('dsp.setHeadroom', [headroomDb]);
  }

  async setDspSafetyLimiterEnabled(enabled: boolean): Promise<EqState> {
    return this.call<EqState>('dsp.setSafetyLimiter', [enabled]);
  }

  // ==================================================================
  // Channel-balance methods
  // ==================================================================

  async getChannelBalanceState(): Promise<ChannelBalanceState> {
    return this.call<ChannelBalanceState>('channelBalance.getState');
  }

  async setChannelBalanceState(patch: Partial<ChannelBalanceState>): Promise<ChannelBalanceState> {
    return this.call<ChannelBalanceState>('channelBalance.setState', [patch]);
  }

  async resetChannelBalance(): Promise<ChannelBalanceState> {
    return this.call<ChannelBalanceState>('channelBalance.reset');
  }

  // ==================================================================
  // Room-correction methods
  // ==================================================================

  async getRoomCorrectionState(): Promise<RoomCorrectionState> {
    return this.call<RoomCorrectionState>('roomCorrection.getState');
  }

  /**
   * Import an impulse-response WAV file for room correction.
   *
   * Generates a unique `irId` and derives `irName` from the file name,
   * then delegates to {@link call} with `roomCorrection.loadIr`.
   */
  async importRoomCorrectionIr(sourcePath: string): Promise<RoomCorrectionState> {
    const irId = `ir-${randomUUID()}`;
    const irName = basename(sourcePath).replace(/\.[^.]+$/u, '').trim().slice(0, 160) || 'Room Correction IR';

    return this.call<RoomCorrectionState>('roomCorrection.loadIr', [{ path: sourcePath, irId, irName }]);
  }

  async setRoomCorrectionEnabled(enabled: boolean): Promise<RoomCorrectionState> {
    return this.call<RoomCorrectionState>('roomCorrection.setEnabled', [enabled]);
  }

  async setRoomCorrectionTrim(trimDb: number): Promise<RoomCorrectionState> {
    return this.call<RoomCorrectionState>('roomCorrection.setTrim', [trimDb]);
  }

  /** Unload IR and reset room-correction state. */
  async clearRoomCorrection(): Promise<RoomCorrectionState> {
    return this.call<RoomCorrectionState>('roomCorrection.clear');
  }

  // ==================================================================
  // Preset methods
  // ==================================================================

  async listPresets(): Promise<EqPreset[]> {
    return this.call<EqPreset[]>('preset.list');
  }

  /** Save (create or update) a user preset. */
  async savePreset(request: EqSavePresetRequest): Promise<EqPreset> {
    return this.call<EqPreset>('preset.save', [request]);
  }

  async deletePreset(presetId: string): Promise<EqPreset[]> {
    return this.call<EqPreset[]>('preset.delete', [presetId]);
  }

  // ==================================================================
  // Profile methods
  // ==================================================================

  async listProfiles(): Promise<EqProfile[]> {
    return this.call<EqProfile[]>('profile.list');
  }

  /** Save (create or update) an EQ profile. */
  async saveProfile(request: EqSaveProfileRequest): Promise<EqProfile> {
    return this.call<EqProfile>('profile.save', [request]);
  }

  async applyProfile(profileId: string): Promise<EqState> {
    return this.call<EqState>('profile.apply', [profileId]);
  }

  async deleteProfile(profileId: string): Promise<EqProfile[]> {
    return this.call<EqProfile[]>('profile.delete', [profileId]);
  }

  async bindProfileToOutput(request: EqBindProfileRequest): Promise<EqProfileBindingInfo> {
    return this.call<EqProfileBindingInfo>('profile.bind', [request]);
  }

  async getProfileBinding(target: EqProfileBindingTarget): Promise<EqProfileBindingInfo> {
    return this.call<EqProfileBindingInfo>('profile.getBinding', [target]);
  }

  async applyBoundProfileForOutput(target: EqProfileBindingTarget): Promise<EqProfile | null> {
    return this.call<EqProfile | null>('profile.applyBound', [target]);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type-guard: does the message have an `id` field (i.e. it is a Response)? */
function isResponse(
  message: JsonRpcMessage,
): message is JsonRpcResponse {
  return 'id' in message && message.id !== null && message.id !== undefined;
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Create a new {@link JsonRpcBridge} instance with optional configuration.
 */
export function createJsonRpcBridge(options?: JsonRpcBridgeOptions): JsonRpcBridge {
  return new JsonRpcBridge(options);
}
