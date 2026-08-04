import type { AudioBackend, ProbeResult } from './AudioBackend';
import type { JsonRpcBridge } from './JsonRpcBridge';
import type { EqProfileBindingTarget } from '../../shared/types/eq';
import type { AudioDeviceInfo, AudioOutputSettings } from '../../shared/types/audio';

const DEBUG_AUDIO = process.env.ECHO_DEBUG_AUDIO === '1';
const audioLog = (...args: unknown[]) => { if (DEBUG_AUDIO) console.log('[audio:daemon]', ...args); };
const postSeekPositionGuardMs = 3000;
const postSeekPositionSlackSeconds = 1;

export class DaemonAudioBackend implements AudioBackend {
  get capabilities() { return { daemon: true, exclusiveMode: false }; }
  private jrpc: JsonRpcBridge;
  private positionSeconds = 0;
  private positionBaseSeconds = 0;
  private sampleRate = 48000;
  private positionCallbacks: Array<(pos: number) => void> = [];
  private endedCallbacks: Array<(params?: Record<string, unknown>) => void> = [];
  private eqStateCallbacks: Array<(state: unknown) => void> = [];
  private channelBalanceCallbacks: Array<(state: unknown) => void> = [];
  private roomCorrectionCallbacks: Array<(state: unknown) => void> = [];
  private activeOperationId: number | null = null;
  private operationLane: Promise<unknown> = Promise.resolve();
  private paused = false;
  private pendingSeekPosition: number | null = null;
  private seekInFlight = false;
  private playbackRate = 1;
  private postSeekPositionGuardStartedAtMs: number | null = null;
  private lastSessionParams: Record<string, unknown> | null = null;

  private positionHandler = (params: Record<string, unknown>) => {
    if (this.seekInFlight) return;
    if (!this.isCurrentOperation(params)) return;
    if (params && typeof params.framesPlayed === 'number') {
      if (this.shouldIgnorePostSeekPosition(params.framesPlayed)) return;
      this.positionSeconds = this.positionBaseSeconds + params.framesPlayed / this.sampleRate;
      audioLog('position:', {
        framesPlayed: params.framesPlayed,
        positionSeconds: this.positionSeconds,
        sampleRate: this.sampleRate,
        bufferedFrames: params.bufferedFrames,
        inputEnded: params.inputEnded,
        operationId: params.operationId,
      });
      for (const cb of this.positionCallbacks) cb(this.positionSeconds);
    }
  };
  private endedHandler = (params: Record<string, unknown>) => {
    if (!this.isCurrentOperation(params) && params.queueAdvance !== true) return;
    for (const cb of this.endedCallbacks) cb(params);
  };

  constructor(jrpc: JsonRpcBridge) {
    audioLog('DaemonAudioBackend: created, registering listeners');
    this.jrpc = jrpc;
    jrpc.on('audio.position', this.positionHandler);
    jrpc.on('audio.ended', this.endedHandler);
  }

  isBoundToBridge(jrpc: JsonRpcBridge): boolean {
    return this.jrpc === jrpc;
  }

  get isBridgeClosed(): boolean {
    return this.jrpc.isClosed === true;
  }

  async start(): Promise<void> {}

  async prefetch(filePath: string): Promise<void> {
    await this.jrpc.prefetch(filePath, this.sampleRate);
  }

  async openFile(filePath: string, startSeconds?: number): Promise<ProbeResult> {
    return this.enqueueOperation(async () => this.openFileNow(filePath, startSeconds));
  }

  private async openFileNow(filePath: string, startSeconds?: number): Promise<ProbeResult> {
    audioLog('openFile called:', filePath?.slice(-30));
    if (startSeconds !== undefined && !Number.isFinite(startSeconds)) {
      throw new Error('invalid_startSeconds');
    }

    await this.ensureDeviceReady();

    const r = await this.jrpc.openFile(filePath, undefined, startSeconds);
    audioLog('openFile response:', {
      status: r.status,
      operationId: r.operationId,
      sampleRate: r.sampleRate,
      channels: r.channels,
      startSeconds: r.startSeconds,
      durationSeconds: r.durationSeconds,
    });
    this.setActiveOperationId(r.operationId);
    const normalizedStartSeconds = typeof r.startSeconds === 'number' && Number.isFinite(r.startSeconds)
      ? r.startSeconds
      : 0;
    this.sampleRate = r.sampleRate;
    this.positionBaseSeconds = normalizedStartSeconds;
    this.positionSeconds = normalizedStartSeconds;
    this.paused = false;
    this.pendingSeekPosition = null;
    this.clearSeekGuard();

    audioLog('openFile succeeded, calling play');
    await this.jrpc.play();

    return {
      status: r.status, filePath: r.filePath, sampleRate: r.sampleRate,
      channels: r.channels, durationSeconds: r.durationSeconds,
      startSeconds: normalizedStartSeconds,
      codec: r.codec, container: r.container,
      bitDepth: r.bitDepth, bitrate: r.bitrate,
    };
  }

  async pause(): Promise<void>  {
    audioLog('pause called');
    await this.jrpc.pause();
    this.paused = true;
  }

  async resume(): Promise<void> {
    await this.enqueueOperation(async () => {
      audioLog('resume called');
      const pendingSeekPosition = this.pendingSeekPosition;
      await this.jrpc.resume();
      if (pendingSeekPosition !== null) {
        audioLog('resume: applying buffered seek:', pendingSeekPosition);
        await this.seekNativeAndSnapPosition(pendingSeekPosition);
      }
      this.pendingSeekPosition = null;
      this.paused = false;
    });
  }

  async seek(pos: number): Promise<void> {
    await this.enqueueOperation(async () => {
      audioLog('seek called:', pos);
      if (this.paused) {
        audioLog('seek replacing paused buffer:', pos);
        await this.seekNativeAndSnapPosition(pos);
        this.pendingSeekPosition = null;
        return;
      }
      await this.seekNativeAndSnapPosition(pos);
    });
  }
  async stop(): Promise<void>   {
    await this.enqueueOperation(async () => {
      audioLog('stop called');
      const r = await this.jrpc.stop() as { operationId?: number } | void;
      this.setActiveOperationId(r && typeof r === 'object' ? r.operationId : undefined);
      this.positionBaseSeconds = 0;
      this.positionSeconds = 0;
      this.paused = false;
      this.pendingSeekPosition = null;
      this.clearSeekGuard();
    });
  }

  getPositionSeconds(): number { return this.positionSeconds; }

  async setPlaybackSpeed(rate: number, mode: AudioOutputSettings['playbackSpeedMode']): Promise<void> {
    this.playbackRate = Number.isFinite(rate) ? Math.max(0.25, Math.min(4, rate)) : 1;
    await this.jrpc.setPlaybackRate(rate);
    await this.jrpc.setPlaybackSpeedMode(mode);
  }

  async setVolume(volume: number): Promise<void> {
    const safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    await this.jrpc.setVolume(safeVolume);
  }

  onPosition(cb: (pos: number) => void): void { this.positionCallbacks.push(cb); }
  onEnded(cb: (params?: Record<string, unknown>) => void): void { this.endedCallbacks.push(cb); }
  onError(_cb: (err: Error) => void): void {}

  async syncEqState(): Promise<void> {
    await this.jrpc.syncStateToNative();
  }

  async setQueue(
    items: Array<{ filePath: string; sampleRate?: number; startSeconds?: number }>,
    repeatMode: string = 'off',
  ): Promise<void> {
    audioLog('setQueue called with', items.length, 'items, repeatMode:', repeatMode);
    await this.jrpc.setQueue(items, repeatMode);
  }

  async clearQueue(): Promise<void> {
    await this.jrpc.clearQueue();
  }

  async applyBoundProfile(target: EqProfileBindingTarget): Promise<void> {
    await this.jrpc.applyBoundProfileForOutput(target);
  }

  onEqStateChanged(callback: (state: unknown) => void): void {
    this.eqStateCallbacks.push(callback);
    this.jrpc.on('eq.state', callback);
  }

  onChannelBalanceChanged(callback: (state: unknown) => void): void {
    this.channelBalanceCallbacks.push(callback);
    this.jrpc.on('channelBalance.state', callback);
  }

  onRoomCorrectionChanged(callback: (state: unknown) => void): void {
    this.roomCorrectionCallbacks.push(callback);
    this.jrpc.on('roomCorrection.state', callback);
  }

  async getDevices(): Promise<AudioDeviceInfo[]> {
    try {
      const result = await this.jrpc.call<Array<Record<string, unknown>>>('device.enumerate');
      if (!Array.isArray(result)) return [];
      return result.map((d) => ({
        id: String(d.id ?? d.deviceId ?? ''),
        index: Number(d.index ?? 0),
        name: String(d.name ?? ''),
        outputMode: 'shared' as const,
        sampleRate: typeof d.sampleRate === 'number' ? d.sampleRate : null,
        sharedDeviceSampleRate: typeof d.sharedDeviceSampleRate === 'number' ? d.sharedDeviceSampleRate : null,
        isDefault: Boolean(d.isDefault),
      } as AudioDeviceInfo));
    } catch {
      return [];
    }
  }

  async configureDevice(deviceId: string, settings?: Partial<AudioOutputSettings>): Promise<void> {
    try {
      const params: Record<string, unknown> = { deviceId };
      if (settings?.outputMode !== undefined) params.outputMode = settings.outputMode;
      if (settings?.requestedOutputSampleRate !== undefined) params.sampleRate = settings.requestedOutputSampleRate;
      if (settings?.bufferSizeFrames != null) params.bufferSize = settings.bufferSizeFrames;
      if (settings?.deviceName !== undefined) params.deviceName = settings.deviceName;
      if (settings?.latencyProfile !== undefined) params.latencyProfile = settings.latencyProfile;
      if (settings?.sharedBackend !== undefined) params.sharedBackend = settings.sharedBackend;
      await this.jrpc.call<void>('device.configure', [params]);
    } catch {
    }
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationLane.then(operation, operation);
    this.operationLane = next.catch(() => undefined);
    return next;
  }

  private setActiveOperationId(operationId: unknown): void {
    if (typeof operationId === 'number' && Number.isFinite(operationId)) {
      this.activeOperationId = operationId;
    }
  }

  /**
   * Ensure the native device is open by sending session.begin with audio params.
   * Only sends when params have changed since last call (or on first call).
   * The native host treats repeated session.begin as a no-op if already device-ready.
   */
  private async ensureDeviceReady(): Promise<void> {
    const params = {
      sr: 48000,
      ch: 2,
      buffer: 4096,
      fifoMs: 3000,
      prebufferMs: 1000,
    };

    if (this.lastSessionParams !== null) {
      const last = this.lastSessionParams;
      if (last.sr === params.sr && last.ch === params.ch &&
          last.buffer === params.buffer && last.fifoMs === params.fifoMs &&
          last.prebufferMs === params.prebufferMs) {
        return;
      }
    }

    audioLog('ensureDeviceReady: sending session.begin', params);
    try {
      const result = await this.jrpc.sessionBegin(params);
      audioLog('ensureDeviceReady: device ready', result);
      this.lastSessionParams = params as unknown as Record<string, unknown>;
    } catch (err) {
      audioLog('ensureDeviceReady: session.begin failed, continuing without device open:', err instanceof Error ? err.message : String(err));
    }
  }

  private isCurrentOperation(params: Record<string, unknown> | undefined): boolean {
    if (this.activeOperationId === null) return true;
    return params?.operationId === this.activeOperationId;
  }

  private async seekNativeAndSnapPosition(positionSeconds: number): Promise<void> {
    const previousBaseSeconds = this.positionBaseSeconds;
    const previousPositionSeconds = this.positionSeconds;
    this.positionBaseSeconds = positionSeconds;
    this.positionSeconds = positionSeconds;
    this.postSeekPositionGuardStartedAtMs = Date.now();
    this.seekInFlight = true;
    this.emitPosition();
    try {
      const r = await this.jrpc.seek(positionSeconds) as { operationId?: number } | void;
      this.setActiveOperationId(r && typeof r === 'object' ? r.operationId : undefined);
    } catch (error) {
      this.positionBaseSeconds = previousBaseSeconds;
      this.positionSeconds = previousPositionSeconds;
      this.clearSeekGuard();
      this.emitPosition();
      throw error;
    } finally {
      this.seekInFlight = false;
    }
  }

  private clearSeekGuard(): void {
    this.seekInFlight = false;
    this.postSeekPositionGuardStartedAtMs = null;
  }

  private shouldIgnorePostSeekPosition(framesPlayed: number): boolean {
    if (this.postSeekPositionGuardStartedAtMs === null) return false;
    const elapsedMs = Date.now() - this.postSeekPositionGuardStartedAtMs;
    if (elapsedMs > postSeekPositionGuardMs) {
      this.postSeekPositionGuardStartedAtMs = null;
      return false;
    }

    const advancedSeconds = framesPlayed / this.sampleRate;
    const allowedAdvanceSeconds = (elapsedMs / 1000) * this.playbackRate + postSeekPositionSlackSeconds;
    if (advancedSeconds > allowedAdvanceSeconds) return true;

    this.postSeekPositionGuardStartedAtMs = null;
    return false;
  }

  private emitPosition(): void {
    for (const cb of this.positionCallbacks) cb(this.positionSeconds);
  }

  dispose(): void {
    this.jrpc.off('audio.position', this.positionHandler);
    this.jrpc.off('audio.ended', this.endedHandler);
    for (const callback of this.eqStateCallbacks) {
      this.jrpc.off('eq.state', callback);
    }
    for (const callback of this.channelBalanceCallbacks) {
      this.jrpc.off('channelBalance.state', callback);
    }
    for (const callback of this.roomCorrectionCallbacks) {
      this.jrpc.off('roomCorrection.state', callback);
    }
    this.positionCallbacks = [];
    this.endedCallbacks = [];
    this.eqStateCallbacks = [];
    this.channelBalanceCallbacks = [];
    this.roomCorrectionCallbacks = [];
  }
}
