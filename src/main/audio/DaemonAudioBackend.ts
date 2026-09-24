import type { AudioBackend, AudioBackendQueueSnapshot, AudioInputSource, ProbeResult } from './AudioBackend';
import { normalizeAudioInputSource } from './AudioBackend';
import type {
  GaplessPrepareRequest,
  GaplessPrepareResult,
  JsonRpcBridge,
  NativeDspProcessingStatus,
  NativeLevelMeterSnapshot,
  ReplayGainConfigPayload,
} from './JsonRpcBridge';
import type { EqProfileBindingTarget } from '../../shared/types/eq';
import type { AudioDeviceInfo, AudioOutputSettings } from '../../shared/types/audio';
import type { NativeBridgeReadyMessage } from './audioTypes';
import type {
  AutomixPrepareRequestV2,
  AutomixPrepareResultV2,
  AutomixStateV2,
  AutomixTransitionCommittedEventV2,
} from '../../shared/types/automix';
import { syncPersistedDspStateToNative } from './DspStateSync';

export type NativeDspProcessingConfig = {
  outputFormat: 'pcm' | 'dop24le' | 'dsd-native-raw';
  echoSrc?: {
    sourceSampleRate: number;
    targetSampleRate: number;
    stages: Array<{ upsampleFactor: 1 | 2 | 4 | 8; taps: number[] }>;
    computeBackend: NonNullable<AudioOutputSettings['echoSrcComputeBackend']>;
  };
  dither?: { mode: AudioOutputSettings['pcmDitherMode']; bitDepth: 16 | 24 };
  sdm?: {
    sourceSampleRate: number;
    targetSampleRate: number;
    stages: Array<{ upsampleFactor: 1 | 2 | 4 | 8; taps: number[] }>;
    qualityProfile: AudioOutputSettings['sdmQualityProfile'];
    computeBackend: NonNullable<AudioOutputSettings['sdmComputeBackend']>;
  };
};

export type DaemonOutputSettings = Partial<AudioOutputSettings> & {
  nativeProcessing?: NativeDspProcessingConfig;
};

export type DaemonOpenSourceOptions = {
  startPaused?: boolean;
  autoPlay?: boolean;
};

const DEBUG_AUDIO = process.env.ECHO_DEBUG_AUDIO === '1';
const audioLog = (...args: unknown[]) => { if (DEBUG_AUDIO) console.log('[audio:daemon]', ...args); };
const postSeekPositionGuardMs = 3000;
const postSeekPositionSlackSeconds = 1;
const nativeLevelMeterIntervalMs = 100;

export class DaemonAudioBackend implements AudioBackend {
  get capabilities() { return { daemon: true, exclusiveMode: true }; }
  private jrpc: JsonRpcBridge;
  private positionSeconds = 0;
  private positionBaseSeconds = 0;
  private sampleRate = 48000;
  private positionCallbacks: Array<(pos: number) => void> = [];
  private endedCallbacks: Array<(params?: Record<string, unknown>) => void> = [];
  private errorCallbacks: Array<(error: Error) => void> = [];
  private firstPcmCallbacks: Array<() => void> = [];
  private pendingFirstPcmOperationIds = new Set<number>();
  private pendingStartedOperationIds = new Set<number>();
  private startedCallbacks: Array<() => void> = [];
  private levelMeterCallbacks: Array<(snapshot: NativeLevelMeterSnapshot) => void> = [];
  private eqStateCallbacks: Array<(state: unknown) => void> = [];
  private channelBalanceCallbacks: Array<(state: unknown) => void> = [];
  private roomCorrectionCallbacks: Array<(state: unknown) => void> = [];
  private automixTransitionCallbacks: Array<(event: AutomixTransitionCommittedEventV2) => void> = [];
  private activeOperationId: number | null = null;
  private activeQueueRevision: number | null = null;
  private operationLane: Promise<unknown> = Promise.resolve();
  private paused = false;
  private pendingSeekPosition: number | null = null;
  private seekInFlight = false;
  private playbackRate = 1;
  private postSeekPositionGuardStartedAtMs: number | null = null;
  private outputSettings: DaemonOutputSettings = {};
  private outputReady: NativeBridgeReadyMessage | null = null;
  private nativeProcessingStatus: NativeDspProcessingStatus | null = null;
  private transportFailure: Error | null = null;

  private positionHandler = (params: Record<string, unknown>) => {
    if (this.seekInFlight) return;
    if (!this.isCurrentOperation(params)) return;
    const processing = params.processing;
    if (processing && typeof processing === 'object' && !Array.isArray(processing)) {
      const next = processing as NativeDspProcessingStatus;
      if (this.nativeProcessingStatus) {
        Object.assign(this.nativeProcessingStatus, next);
      } else {
        this.nativeProcessingStatus = next;
      }
    }
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
  private startedHandler = (params: Record<string, unknown>) => {
    const operationId = Number(params.operationId);
    if (!Number.isFinite(operationId)) return;
    if (this.activeOperationId === null || !this.isCurrentOperation(params)) {
      this.pendingStartedOperationIds.add(operationId);
      return;
    }
    for (const cb of this.startedCallbacks) cb();
  };
  private firstPcmHandler = (params: Record<string, unknown>) => {
    const operationId = Number(params.operationId);
    if (!Number.isFinite(operationId)) return;
    if (!this.isCurrentOperation(params)) {
      this.pendingFirstPcmOperationIds.add(operationId);
      return;
    }
    for (const cb of this.firstPcmCallbacks) cb();
  };
  private endedHandler = (params: Record<string, unknown>) => {
    if (!this.isCurrentOperation(params) && params.queueAdvance !== true) return;
    if (params.queueAdvance === true) {
      const gaplessAdvance = params.gaplessAdvance === true;
      const queueRevision = Number(params.queueRevision);
      const fromOperationId = Number(params.fromOperationId);
      if (
        (!gaplessAdvance && this.activeQueueRevision === null) ||
        (!gaplessAdvance && !Number.isSafeInteger(queueRevision)) ||
        (!gaplessAdvance && (!Number.isFinite(fromOperationId) || fromOperationId !== this.activeOperationId)) ||
        (this.activeQueueRevision !== null
          && Number.isSafeInteger(queueRevision)
          && queueRevision !== this.activeQueueRevision)
      ) {
        this.errorHandler(new Error(
          `daemon_queue_advance_revision_mismatch:${String(params.queueRevision)}:${String(this.activeQueueRevision)}`,
        ));
        return;
      }
      const nextOperationId = params.operationId;
      if (typeof nextOperationId !== 'number' || !Number.isFinite(nextOperationId)) {
        this.errorHandler(new Error('daemon_queue_advance_missing_operation_id'));
        return;
      }
      this.setActiveOperationId(nextOperationId);
      const nextSampleRate = Number(params.nextSampleRate);
      if (Number.isFinite(nextSampleRate) && nextSampleRate > 0) {
        this.sampleRate = nextSampleRate;
      }
      const nextStartSeconds = Number(params.nextStartSeconds);
      this.positionBaseSeconds = Number.isFinite(nextStartSeconds) ? Math.max(0, nextStartSeconds) : 0;
      this.positionSeconds = this.positionBaseSeconds;
      this.paused = false;
      this.pendingSeekPosition = null;
      this.clearSeekGuard();
    }
    for (const cb of this.endedCallbacks) cb(params);
  };
  private audioErrorHandler = (params: Record<string, unknown>) => {
    if (!this.isCurrentOperation(params)) return;
    const message = typeof params.message === 'string' && params.message.trim()
      ? params.message.trim().slice(0, 256)
      : 'daemon_audio_error';
    this.errorHandler(new Error(message));
  };
  private levelMeterHandler = (params: Record<string, unknown>) => {
    if (!this.isCurrentOperation(params)) return;
    const operationId = Number(params.operationId);
    const peakDb = Array.isArray(params.peakDb)
      ? params.peakDb.map(Number).filter(Number.isFinite)
      : [];
    const rmsDb = Array.isArray(params.rmsDb)
      ? params.rmsDb.map(Number).filter(Number.isFinite)
      : [];
    const timestampMs = Number(params.timestampMs);
    if (!Number.isFinite(operationId) || peakDb.length === 0 || rmsDb.length === 0) return;
    const snapshot: NativeLevelMeterSnapshot = {
      operationId,
      peakDb,
      rmsDb,
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
    };
    for (const callback of this.levelMeterCallbacks) callback(snapshot);
  };
  private automixTransitionHandler = (params: Record<string, unknown>) => {
    const queueRevision = Number(params.queueRevision);
    const operationId = Number(params.operationId);
    const outputFrame = Number(params.outputFrame);
    const sourcePositionSeconds = Number(params.sourcePositionSeconds);
    if (!Number.isSafeInteger(queueRevision)
      || (this.activeQueueRevision !== null && queueRevision !== this.activeQueueRevision)
      || !Number.isFinite(operationId)
      || !Number.isFinite(outputFrame)
      || !Number.isFinite(sourcePositionSeconds)) {
      this.errorHandler(new Error('daemon_automix_transition_contract_invalid'));
      return;
    }
    const event: AutomixTransitionCommittedEventV2 = {
      planId: String(params.planId ?? ''),
      queueRevision,
      operationId,
      fromItemId: String(params.fromItemId ?? ''),
      fromTrackId: String(params.fromTrackId ?? ''),
      toItemId: String(params.toItemId ?? ''),
      toTrackId: String(params.toTrackId ?? ''),
      outputFrame,
      sourcePositionSeconds: Math.max(0, sourcePositionSeconds),
    };
    if (!event.planId || !event.fromItemId || !event.toItemId || !event.fromTrackId || !event.toTrackId) {
      this.errorHandler(new Error('daemon_automix_transition_identity_missing'));
      return;
    }
    this.setActiveOperationId(operationId);
    this.positionBaseSeconds = event.sourcePositionSeconds;
    this.positionSeconds = event.sourcePositionSeconds;
    this.clearSeekGuard();
    for (const callback of this.automixTransitionCallbacks) callback(event);
  };
  private errorHandler = (error: Error) => {
    for (const cb of this.errorCallbacks) cb(error);
  };
  private transportErrorHandler = (error: Error) => {
    if (this.transportFailure) return;
    this.transportFailure = error;
    this.errorHandler(error);
  };
  private transportCloseHandler = () => {
    this.transportErrorHandler(new Error('daemon_rpc_bridge_closed'));
  };

  constructor(jrpc: JsonRpcBridge) {
    audioLog('DaemonAudioBackend: created, registering listeners');
    this.jrpc = jrpc;
    jrpc.on('audio.position', this.positionHandler);
    jrpc.on('audio.firstPcm', this.firstPcmHandler);
    jrpc.on('audio.started', this.startedHandler);
    jrpc.on('audio.ended', this.endedHandler);
    jrpc.on('audio.error', this.audioErrorHandler);
    jrpc.on('audio.levelMeter', this.levelMeterHandler);
    jrpc.on('audio.transitionCommitted', this.automixTransitionHandler);
    jrpc.on('error', this.transportErrorHandler);
    jrpc.on('close', this.transportCloseHandler);
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

  async prepareGapless(request: GaplessPrepareRequest): Promise<GaplessPrepareResult> {
    const result = await this.jrpc.prepareGapless({
      ...request,
      sampleRate: request.sampleRate ?? this.sampleRate,
    });
    if (result?.prepared !== true) {
      throw new Error('daemon_gapless_prepare_rejected');
    }
    return result;
  }

  async openFile(filePath: string, startSeconds?: number): Promise<ProbeResult> {
    return this.openSource({ kind: 'local', uri: filePath }, startSeconds);
  }

  async openSource(
    source: AudioInputSource,
    startSeconds?: number,
    options: DaemonOpenSourceOptions = {},
  ): Promise<ProbeResult> {
    return this.enqueueOperation(async () => this.openSourceNow(source, startSeconds, options));
  }

  private async openSourceNow(
    source: AudioInputSource,
    startSeconds?: number,
    options: DaemonOpenSourceOptions = {},
  ): Promise<ProbeResult> {
    const normalizedSource = normalizeAudioInputSource(source);
    audioLog('openSource called:', normalizedSource.kind);
    if (startSeconds !== undefined && !Number.isFinite(startSeconds)) {
      throw new Error('invalid_startSeconds');
    }

    await this.ensureDeviceReady(options.startPaused === true);

    const r = normalizedSource.kind === 'local'
      ? await this.jrpc.openFile(normalizedSource.uri, this.sampleRate, startSeconds)
      : await this.jrpc.openSource(normalizedSource, this.sampleRate, startSeconds);
    audioLog('openSource response:', {
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

    if (options.autoPlay !== false) {
      audioLog('openSource succeeded, calling play');
      await this.jrpc.play();
    }

    return {
      status: r.status, filePath: r.filePath, sampleRate: r.sampleRate,
      sourceSampleRate: r.sourceSampleRate,
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

  getOutputReady(): NativeBridgeReadyMessage | null {
    return this.outputReady ? { ...this.outputReady } : null;
  }

  async startOpenedSource(): Promise<void> {
    await this.enqueueOperation(async () => {
      await this.jrpc.play();
      this.paused = false;
    });
  }

  getNativeProcessingStatus(): NativeDspProcessingStatus | null {
    return this.nativeProcessingStatus;
  }

  async setPlaybackSpeed(rate: number, mode: AudioOutputSettings['playbackSpeedMode']): Promise<void> {
    this.playbackRate = Number.isFinite(rate) ? Math.max(0.25, Math.min(4, rate)) : 1;
    await this.jrpc.setPlaybackRate(rate);
    await this.jrpc.setPlaybackSpeedMode(mode);
  }

  async setVolume(volume: number): Promise<void> {
    const safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    await this.jrpc.setVolume(safeVolume);
  }

  async setReplayGainConfig(config: ReplayGainConfigPayload): Promise<void> {
    await this.jrpc.setReplayGainConfig(config);
  }

  onPosition(cb: (pos: number) => void): void { this.positionCallbacks.push(cb); }
  onEnded(cb: (params?: Record<string, unknown>) => void): void { this.endedCallbacks.push(cb); }
  onError(cb: (err: Error) => void): void {
    this.errorCallbacks.push(cb);
    if (this.transportFailure) cb(this.transportFailure);
  }

  async syncEqState(): Promise<void> {
    await this.jrpc.syncStateToNative();
  }

  async syncDspState(target?: EqProfileBindingTarget): Promise<void> {
    await syncPersistedDspStateToNative(this.jrpc, target);
  }

  async setQueue(snapshot: AudioBackendQueueSnapshot): Promise<void> {
    audioLog(
      'setQueue called with',
      snapshot.items.length,
      'items, repeatMode:',
      snapshot.repeatMode,
      'revision:',
      snapshot.revision,
    );
    await this.jrpc.setQueue(snapshot);
    this.activeQueueRevision = snapshot.revision;
  }

  async clearQueue(): Promise<void> {
    await this.jrpc.clearQueue();
    this.activeQueueRevision = null;
  }

  async prepareAutomixV2(request: AutomixPrepareRequestV2): Promise<AutomixPrepareResultV2> {
    return this.enqueueOperation(async () => {
      const result = await this.jrpc.prepareAutomixV2(request);
      if (result.acknowledged !== true || result.planId !== request.plan.planId) {
        throw new Error('daemon_automix_prepare_ack_mismatch');
      }
      return result;
    });
  }

  async cancelAutomixV2(planId: string): Promise<void> {
    await this.enqueueOperation(async () => {
      const result = await this.jrpc.cancelAutomixV2(planId);
      if (result.acknowledged !== true || result.planId !== planId) {
        throw new Error('daemon_automix_cancel_ack_mismatch');
      }
    });
  }

  async getAutomixStateV2(): Promise<AutomixStateV2> {
    return this.jrpc.getAutomixStateV2();
  }

  onAutomixTransitionCommitted(callback: (event: AutomixTransitionCommittedEventV2) => void): void {
    this.automixTransitionCallbacks.push(callback);
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

  async configureDevice(deviceId: string, settings: DaemonOutputSettings = {}): Promise<void> {
    this.outputSettings = { ...settings };
    const params: Record<string, unknown> = { deviceId };
    if (settings?.outputMode !== undefined) params.outputMode = settings.outputMode;
    if (settings?.requestedOutputSampleRate !== undefined) params.sampleRate = settings.requestedOutputSampleRate;
    if (settings?.bufferSizeFrames != null) params.bufferSize = settings.bufferSizeFrames;
    if (settings?.deviceIndex !== undefined) params.deviceIndex = settings.deviceIndex;
    if (settings?.deviceName !== undefined) params.deviceName = settings.deviceName;
    if (settings?.latencyProfile !== undefined) params.latencyProfile = settings.latencyProfile;
    if (settings?.sharedBackend !== undefined) params.sharedBackend = settings.sharedBackend;
    if (settings.nativeProcessing !== undefined) params.processing = settings.nativeProcessing;
    params.channels = 2;
    const configured = await this.jrpc.configureDevice(params);
    if (configured.accepted !== true) {
      throw new Error('daemon_device_configuration_rejected');
    }
    this.sampleRate = configured.sampleRate;
    this.nativeProcessingStatus = configured.processing ?? null;
    await this.jrpc.setLevelMeterInterval(nativeLevelMeterIntervalMs);
  }
  onStarted(cb: () => void): void { this.startedCallbacks.push(cb); }
  onFirstPcm(cb: () => void): void { this.firstPcmCallbacks.push(cb); }
  onLevelMeter(cb: (snapshot: NativeLevelMeterSnapshot) => void): void { this.levelMeterCallbacks.push(cb); }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationLane.then(operation, operation);
    this.operationLane = next.catch(() => undefined);
    return next;
  }

  private setActiveOperationId(operationId: unknown): void {
    if (typeof operationId === 'number' && Number.isFinite(operationId)) {
      this.activeOperationId = operationId;
      for (const pendingOperationId of this.pendingFirstPcmOperationIds) {
        if (pendingOperationId < operationId) this.pendingFirstPcmOperationIds.delete(pendingOperationId);
      }
      for (const pendingOperationId of this.pendingStartedOperationIds) {
        if (pendingOperationId < operationId) this.pendingStartedOperationIds.delete(pendingOperationId);
      }
      if (this.pendingFirstPcmOperationIds.delete(operationId)) {
        for (const cb of this.firstPcmCallbacks) cb();
      }
      if (this.pendingStartedOperationIds.delete(operationId)) {
        for (const cb of this.startedCallbacks) cb();
      }
    }
  }

  /**
   * Begin exactly one native session for each user-initiated open. The native
   * host owns beginSession(); openFile only starts the matching decoder.
   */
  private async ensureDeviceReady(startPaused = false): Promise<void> {
    const latencyProfile = this.outputSettings.latencyProfile ?? 'balanced';
    const configuredBuffer = this.outputSettings.bufferSizeFrames;
    const buffer = typeof configuredBuffer === 'number' && Number.isFinite(configuredBuffer) && configuredBuffer > 0
      ? Math.round(configuredBuffer)
      : latencyProfile === 'lowLatency' ? 1024 : latencyProfile === 'stable' ? 4096 : 2048;
    const params = {
      sr: this.sampleRate,
      ch: 2,
      buffer,
      fifoMs: 8000,
      prebufferMs: latencyProfile === 'lowLatency' ? 20 : latencyProfile === 'stable' ? 120 : 60,
      startPaused,
    };

    audioLog('ensureDeviceReady: sending session.begin', params);
    const result = await this.jrpc.sessionBegin(params);
    const accepted = result === true || (typeof result === 'object' && result?.accepted === true);
    if (!accepted) {
      throw new Error('daemon_session_begin_rejected');
    }
    if (typeof result !== 'object' || !Number.isSafeInteger(result.sessionId) || result.sessionId <= 0) {
      throw new Error(`daemon_session_begin_missing_session_id:${String(typeof result === 'object' ? result.sessionId : result)}`);
    }
    if (result.ready) {
      this.outputReady = { ...result.ready };
      const actualSampleRate = Number(result.ready.sampleRate);
      if (Number.isFinite(actualSampleRate) && actualSampleRate > 0) {
        this.sampleRate = actualSampleRate;
      }
    }
    audioLog('ensureDeviceReady: device ready', result);
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
    this.jrpc.off('audio.firstPcm', this.firstPcmHandler);
    this.jrpc.off('audio.started', this.startedHandler);
    this.jrpc.off('audio.ended', this.endedHandler);
    this.jrpc.off('audio.error', this.audioErrorHandler);
    this.jrpc.off('audio.levelMeter', this.levelMeterHandler);
    this.jrpc.off('audio.transitionCommitted', this.automixTransitionHandler);
    this.jrpc.off('error', this.transportErrorHandler);
    this.jrpc.off('close', this.transportCloseHandler);
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
    this.errorCallbacks = [];
    this.firstPcmCallbacks = [];
    this.pendingFirstPcmOperationIds.clear();
    this.pendingStartedOperationIds.clear();
    this.startedCallbacks = [];
    this.levelMeterCallbacks = [];
    this.eqStateCallbacks = [];
    this.channelBalanceCallbacks = [];
    this.roomCorrectionCallbacks = [];
    this.automixTransitionCallbacks = [];
  }
}
