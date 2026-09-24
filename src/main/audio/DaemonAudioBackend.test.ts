import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DaemonAudioBackend } from './DaemonAudioBackend';
import type { JsonRpcBridge, OpenFileResult } from './JsonRpcBridge';

const createRpc = () => {
  const rpc = new EventEmitter() as EventEmitter & Record<string, unknown>;
  let nativeSessionId = 0;
  Object.assign(rpc, {
    isClosed: false,
    sessionBegin: vi.fn().mockImplementation(async (params: { sessionId?: number }) => ({
      accepted: true,
      sessionId: params.sessionId ?? ++nativeSessionId,
      ready: {
        ready: true,
        readyLevel: 'device',
        sampleRate: 48_000,
      },
    })),
    configureDevice: vi.fn().mockResolvedValue({
      accepted: true,
      changed: true,
      deviceOpened: false,
      outputMode: 'shared',
      deviceId: 'shared:3',
      deviceIndex: 3,
      deviceName: 'USB DAC',
      sampleRate: 96_000,
      channels: 2,
      bufferSize: 4096,
      sharedBackend: 'windows',
    }),
    openFile: vi.fn().mockResolvedValue({
      status: 'ready',
      operationId: 7,
      filePath: 'track.flac',
      sampleRate: 48_000,
      channels: 2,
      durationSeconds: 120,
      startSeconds: 0,
      codec: 'FLAC',
      container: 'FLAC',
    }),
    openSource: vi.fn().mockResolvedValue({
      status: 'ready',
      operationId: 11,
      filePath: 'https://media.example.test/track.flac',
      sampleRate: 48_000,
      channels: 2,
      durationSeconds: 120,
      startSeconds: 0,
      codec: 'FLAC',
      container: 'FLAC',
    }),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue({ operationId: 8 }),
    stop: vi.fn().mockResolvedValue({ operationId: 9 }),
    setPlaybackRate: vi.fn().mockResolvedValue(undefined),
    setPlaybackSpeedMode: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    setReplayGainConfig: vi.fn().mockResolvedValue(undefined),
    setLevelMeterInterval: vi.fn().mockResolvedValue(undefined),
    prepareGapless: vi.fn().mockResolvedValue({
      prepared: true,
      operationId: 7,
      filePath: 'next.flac',
    }),
    prepareAutomixV2: vi.fn().mockResolvedValue({
      acknowledged: true,
      state: 'armed',
      planId: 'plan-12',
      operationId: 7,
      reason: null,
    }),
    cancelAutomixV2: vi.fn().mockResolvedValue({
      acknowledged: true,
      state: 'idle',
      planId: 'plan-12',
    }),
    getAutomixStateV2: vi.fn().mockResolvedValue({
      state: 'armed',
      planId: 'plan-12',
      queueRevision: 12,
      operationId: 7,
      reason: null,
    }),
    setQueue: vi.fn().mockResolvedValue(undefined),
    syncStateToNative: vi.fn().mockResolvedValue(undefined),
  });
  return rpc as unknown as JsonRpcBridge;
};

describe('DaemonAudioBackend', () => {
  it('awaits device readiness before opening and playing a local file', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);

    const result = await backend.openFile('track.flac', 12);

    expect(rpc.sessionBegin).toHaveBeenCalledWith({
      sr: 48_000,
      ch: 2,
      buffer: 2048,
      fifoMs: 8000,
      prebufferMs: 60,
      startPaused: false,
    });
    expect(rpc.openFile).toHaveBeenCalledWith('track.flac', 48_000, 12);
    expect(rpc.play).toHaveBeenCalledOnce();
    expect(result.sampleRate).toBe(48_000);
    backend.dispose();
  });

  it('replays an audio.started notification that arrives before openFile resolves', async () => {
    const rpc = createRpc();
    let resolveOpen: ((value: OpenFileResult) => void) | null = null;
    vi.mocked(rpc.openFile).mockImplementation(() => new Promise((resolve) => { resolveOpen = resolve; }));
    const backend = new DaemonAudioBackend(rpc);
    const onStarted = vi.fn();
    backend.onStarted(onStarted);

    const opening = backend.openFile('track.flac');
    await vi.waitFor(() => expect(rpc.openFile).toHaveBeenCalledOnce());
    rpc.emit('audio.started', { operationId: 7 });
    expect(onStarted).not.toHaveBeenCalled();

    resolveOpen!({
      status: 'ready',
      operationId: 7,
      filePath: 'track.flac',
      sampleRate: 48_000,
      sourceSampleRate: 48_000,
      channels: 2,
      durationSeconds: 120,
      startSeconds: 0,
      codec: 'FLAC',
      container: 'FLAC',
    });
    await opening;

    expect(onStarted).toHaveBeenCalledOnce();
    backend.dispose();
  });

  it('fails closed when the native device session cannot be prepared', async () => {
    const rpc = createRpc();
    vi.mocked(rpc.sessionBegin).mockRejectedValueOnce(new Error('device_not_ready'));
    const backend = new DaemonAudioBackend(rpc);

    await expect(backend.openFile('track.flac')).rejects.toThrow('device_not_ready');
    expect(rpc.openFile).not.toHaveBeenCalled();
    expect(rpc.play).not.toHaveBeenCalled();
    backend.dispose();
  });

  it('opens HTTP input through audio.openSource and preserves only approved headers', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);

    await backend.openSource({
      kind: 'http',
      uri: 'https://media.example.test/track.flac',
      headers: {
        cookie: 'MUSIC_U=secret',
        referer: 'https://music.163.com/',
      },
      mimeType: 'audio/flac',
    });

    expect(rpc.openSource).toHaveBeenCalledWith({
      kind: 'http',
      uri: 'https://media.example.test/track.flac',
      headers: {
        Cookie: 'MUSIC_U=secret',
        Referer: 'https://music.163.com/',
      },
      mimeType: 'audio/flac',
    }, 48_000, undefined);
    expect(rpc.openFile).not.toHaveBeenCalled();
    backend.dispose();
  });

  it('awaits native gapless priming at the active device rate', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    await backend.openFile('track.flac');

    await backend.prepareGapless({ filePath: 'next.flac', trackId: 'next-track' });

    expect(rpc.prepareGapless).toHaveBeenCalledWith({
      filePath: 'next.flac',
      trackId: 'next-track',
      sampleRate: 48_000,
    });
    backend.dispose();
  });

  it('accepts a host-owned gapless boundary without requiring a queue revision', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const onEnded = vi.fn();
    const onError = vi.fn();
    backend.onEnded(onEnded);
    backend.onError(onError);
    await backend.openFile('track.flac');

    rpc.emit('audio.ended', {
      queueAdvance: true,
      gaplessAdvance: true,
      operationId: 8,
      nextTrackId: 'next-track',
      nextFilePath: 'next.flac',
      nextSampleRate: 48_000,
      nextStartSeconds: 0,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onEnded).toHaveBeenCalledWith(expect.objectContaining({ gaplessAdvance: true, operationId: 8 }));
    backend.dispose();
  });

  it('can probe a remote source while the native session remains paused', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);

    await backend.openSource(
      { kind: 'http', uri: 'https://media.example.test/track.flac' },
      0,
      { startPaused: true, autoPlay: false },
    );

    expect(rpc.sessionBegin).toHaveBeenCalledWith(expect.objectContaining({ startPaused: true }));
    expect(rpc.play).not.toHaveBeenCalled();

    await backend.startOpenedSource();
    expect(rpc.play).toHaveBeenCalledOnce();
    backend.dispose();
  });

  it('forwards only the active operation audio.error notification', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const onError = vi.fn();
    backend.onError(onError);
    await backend.openSource({ kind: 'http', uri: 'https://media.example.test/track.flac' });

    rpc.emit('audio.error', { operationId: 10, message: 'stale failure' });
    rpc.emit('audio.error', { operationId: 11, message: 'Server returned 403 Forbidden' });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Server returned 403 Forbidden',
    }));
    backend.dispose();
  });

  it('rejects unsafe HTTP headers before opening the native source', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);

    await expect(backend.openSource({
      kind: 'http',
      uri: 'https://media.example.test/track.flac',
      headers: { Cookie: 'safe\r\nX-Injected: true' },
    })).rejects.toThrow('invalid_audio_input_header');

    expect(rpc.openSource).not.toHaveBeenCalled();
    backend.dispose();
  });

  it('delivers an early first-PCM notification after the matching open response arrives', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const onFirstPcm = vi.fn();
    backend.onFirstPcm(onFirstPcm);
    vi.mocked(rpc.openSource).mockImplementationOnce(async () => {
      rpc.emit('audio.firstPcm', { operationId: 11 });
      return {
        status: 'ready',
        operationId: 11,
        filePath: 'https://media.example.test/track.flac',
        sampleRate: 48_000,
        channels: 2,
        durationSeconds: 120,
        startSeconds: 0,
        codec: 'FLAC',
        container: 'FLAC',
      };
    });

    await backend.openSource({ kind: 'http', uri: 'https://media.example.test/track.flac' });

    expect(onFirstPcm).toHaveBeenCalledOnce();
    backend.dispose();
  });

  it('awaits authoritative device configuration and advances exactly one native session per open', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);

    await backend.configureDevice('shared:3', {
      outputMode: 'shared',
      requestedOutputSampleRate: 96_000,
      bufferSizeFrames: 4096,
      deviceIndex: 3,
      deviceName: 'USB DAC',
      latencyProfile: 'stable',
      sharedBackend: 'windows',
      nativeProcessing: {
        outputFormat: 'dop24le',
        sdm: {
          sourceSampleRate: 48_000,
          targetSampleRate: 96_000,
          stages: [{ upsampleFactor: 2, taps: [0.25, 0.5, 0.25] }],
          qualityProfile: 'reference',
          computeBackend: 'cpu',
        },
      },
    });
    await backend.openFile('first.flac');
    await backend.openFile('second.flac');

    expect(rpc.configureDevice).toHaveBeenCalledWith({
      deviceId: 'shared:3',
      outputMode: 'shared',
      sampleRate: 96_000,
      bufferSize: 4096,
      deviceIndex: 3,
      deviceName: 'USB DAC',
      latencyProfile: 'stable',
      sharedBackend: 'windows',
      channels: 2,
      processing: {
        outputFormat: 'dop24le',
        sdm: {
          sourceSampleRate: 48_000,
          targetSampleRate: 96_000,
          stages: [{ upsampleFactor: 2, taps: [0.25, 0.5, 0.25] }],
          qualityProfile: 'reference',
          computeBackend: 'cpu',
        },
      },
    });
    expect(rpc.setLevelMeterInterval).toHaveBeenCalledWith(100);
    expect(rpc.sessionBegin).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sr: 96_000,
      buffer: 4096,
      fifoMs: 8000,
      prebufferMs: 120,
    }));
    expect(rpc.sessionBegin).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ sessionId: expect.anything() }));
    backend.dispose();
  });

  it('forwards valid native post-DSP level snapshots for the active operation', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const onLevelMeter = vi.fn();
    backend.onLevelMeter(onLevelMeter);
    await backend.openFile('track.flac');

    rpc.emit('audio.levelMeter', {
      operationId: 7,
      peakDb: [-8.5, -7.25],
      rmsDb: [-19.5, -18.75],
      timestampMs: 100,
    });
    rpc.emit('audio.levelMeter', {
      operationId: 99,
      peakDb: [-1],
      rmsDb: [-4],
      timestampMs: 200,
    });

    expect(onLevelMeter).toHaveBeenCalledOnce();
    expect(onLevelMeter).toHaveBeenCalledWith({
      operationId: 7,
      peakDb: [-8.5, -7.25],
      rmsDb: [-19.5, -18.75],
      timestampMs: 100,
    });
    backend.dispose();
    rpc.emit('audio.levelMeter', {
      operationId: 7,
      peakDb: [-3],
      rmsDb: [-9],
      timestampMs: 300,
    });
    expect(onLevelMeter).toHaveBeenCalledOnce();
  });

  it('updates native DSP performance telemetry in place from position events', async () => {
    const rpc = createRpc();
    const processing = {
      outputFormat: 'pcm' as const,
      dither: { active: false, mode: 'off', bitDepth: 24 },
      echoSrc: {
        active: true,
        sourceSampleRate: 48_000,
        targetSampleRate: 192_000,
        stageCount: 1,
        requestedBackend: 'cuda' as const,
        activeBackend: 'cuda' as const,
        deviceName: 'NVIDIA Test GPU',
        fallbackReason: null,
        processedBlocks: 0,
        averageProcessMilliseconds: 0,
      },
      sdm: {
        active: false,
        sourceSampleRate: 0,
        targetSampleRate: 0,
        stageCount: 0,
        requestedBackend: 'cpu' as const,
        activeBackend: 'cpu' as const,
        fallbackReason: null,
      },
    };
    vi.mocked(rpc.configureDevice).mockResolvedValueOnce({
      accepted: true,
      changed: true,
      deviceOpened: false,
      outputMode: 'shared',
      deviceId: 'shared:3',
      deviceIndex: 3,
      deviceName: 'USB DAC',
      sampleRate: 192_000,
      channels: 2,
      bufferSize: 4096,
      sharedBackend: 'windows',
      processing,
    });
    const backend = new DaemonAudioBackend(rpc);
    await backend.configureDevice('shared:3');
    const configuredReference = backend.getNativeProcessingStatus();

    rpc.emit('audio.position', {
      framesPlayed: 4096,
      bufferedFrames: 8192,
      inputEnded: false,
      processing: {
        ...processing,
        echoSrc: {
          ...processing.echoSrc,
          processedBlocks: 4,
          lastInputFrames: 4096,
          lastOutputFrames: 16_384,
          averageProcessMilliseconds: 0.36,
        },
      },
    });

    expect(backend.getNativeProcessingStatus()).toBe(configuredReference);
    expect(configuredReference?.echoSrc).toMatchObject({
      processedBlocks: 4,
      lastInputFrames: 4096,
      lastOutputFrames: 16_384,
      averageProcessMilliseconds: 0.36,
    });
    backend.dispose();
  });

  it('adopts the resident native daemon session when the backend is recreated', async () => {
    const rpc = createRpc();
    const firstBackend = new DaemonAudioBackend(rpc);
    await firstBackend.openFile('first.flac');
    firstBackend.dispose();

    const secondBackend = new DaemonAudioBackend(rpc);
    await secondBackend.openFile('second.flac');

    expect(rpc.sessionBegin).toHaveBeenNthCalledWith(1, expect.not.objectContaining({ sessionId: expect.anything() }));
    expect(rpc.sessionBegin).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ sessionId: expect.anything() }));
    secondBackend.dispose();
  });

  it('rejects a session acknowledgement without the native session id before file open', async () => {
    const rpc = createRpc();
    vi.mocked(rpc.sessionBegin).mockResolvedValueOnce(true);
    const backend = new DaemonAudioBackend(rpc);

    await expect(backend.openFile('track.flac')).rejects.toThrow('daemon_session_begin_missing_session_id:true');
    expect(rpc.openFile).not.toHaveBeenCalled();
    backend.dispose();
  });

  it('awaits ReplayGain configuration in the native DSP control plane', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const config = {
      trackGainDb: -4.25,
      albumGainDb: -4.25,
      peak: 0,
      mode: 1,
      preampDb: 0,
      preventClipping: false,
    };

    await backend.setReplayGainConfig(config);

    expect(rpc.setReplayGainConfig).toHaveBeenCalledWith(config);
    backend.dispose();
  });

  it('keeps paused seek and resume serialized on the native operation lane', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    await backend.openFile('track.flac');

    await backend.pause();
    await backend.seek(42);
    await backend.resume();

    expect(rpc.pause).toHaveBeenCalledOnce();
    expect(rpc.seek).toHaveBeenCalledWith(42);
    expect(rpc.resume).toHaveBeenCalledOnce();
    expect(backend.getPositionSeconds()).toBe(42);
    backend.dispose();
  });

  it('forwards transport failures once and removes all shared listeners on dispose', () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const onError = vi.fn();
    backend.onError(onError);

    rpc.emit('error', new Error('rpc_closed'));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'rpc_closed' }));
    rpc.emit('close');
    expect(onError).toHaveBeenCalledTimes(1);

    backend.dispose();
    expect(rpc.listenerCount('audio.position')).toBe(0);
    expect(rpc.listenerCount('audio.firstPcm')).toBe(0);
    expect(rpc.listenerCount('audio.started')).toBe(0);
    expect(rpc.listenerCount('audio.ended')).toBe(0);
    expect(rpc.listenerCount('audio.error')).toBe(0);
    expect(rpc.listenerCount('error')).toBe(0);
    expect(rpc.listenerCount('close')).toBe(0);
  });

  it('turns a transport close without a preceding error into a backend error', () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const onError = vi.fn();

    rpc.emit('close');
    rpc.emit('close');
    backend.onError(onError);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'daemon_rpc_bridge_closed' }));
    backend.dispose();
  });

  it('adopts the autonomous queue operation before accepting next-track position events', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const onPosition = vi.fn();
    const onEnded = vi.fn();
    backend.onPosition(onPosition);
    backend.onEnded(onEnded);
    await backend.openFile('track.flac');
    await backend.setQueue({
      revision: 3,
      currentItemId: 'queue-1',
      repeatMode: 'off',
      items: [
        { itemId: 'queue-1', trackId: 'track-1', filePath: 'track.flac' },
        { itemId: 'queue-2', trackId: 'track-2', filePath: 'track-2.flac' },
      ],
    });

    rpc.emit('audio.ended', {
      queueAdvance: true,
      fromOperationId: 7,
      operationId: 8,
      queueRevision: 3,
      nextItemId: 'queue-2',
      nextTrackId: 'track-2',
      nextFilePath: 'track-2.flac',
      nextSampleRate: 48_000,
      nextStartSeconds: 2,
    });
    rpc.emit('audio.position', { operationId: 8, framesPlayed: 48_000, bufferedFrames: 512, inputEnded: false });

    expect(onEnded).toHaveBeenCalledWith(expect.objectContaining({ operationId: 8, queueAdvance: true }));
    expect(onPosition).toHaveBeenCalledWith(3);
    expect(backend.getPositionSeconds()).toBe(3);
    backend.dispose();
  });

  it('fails closed when queueAdvance omits the new operation id', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const onError = vi.fn();
    const onEnded = vi.fn();
    backend.onError(onError);
    backend.onEnded(onEnded);
    await backend.openFile('track.flac');
    await backend.setQueue({
      revision: 3,
      currentItemId: 'queue-1',
      repeatMode: 'off',
      items: [{ itemId: 'queue-1', trackId: 'track-1', filePath: 'track.flac' }],
    });

    rpc.emit('audio.ended', {
      queueAdvance: true,
      fromOperationId: 7,
      queueRevision: 3,
      nextTrackId: 'track-2',
    });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'daemon_queue_advance_missing_operation_id' }));
    expect(onEnded).not.toHaveBeenCalled();
    backend.dispose();
  });

  it('rejects an autonomous advance from an older queue revision', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const onError = vi.fn();
    const onEnded = vi.fn();
    backend.onError(onError);
    backend.onEnded(onEnded);
    await backend.openFile('track.flac');
    await backend.setQueue({
      revision: 4,
      currentItemId: 'queue-1',
      repeatMode: 'off',
      items: [{ itemId: 'queue-1', trackId: 'track-1', filePath: 'track.flac' }],
    });

    rpc.emit('audio.ended', { queueAdvance: true, fromOperationId: 7, operationId: 8, queueRevision: 3 });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'daemon_queue_advance_revision_mismatch:3:4',
    }));
    expect(onEnded).not.toHaveBeenCalled();
    backend.dispose();
  });

  it('rejects a queue transition from a stale queue revision', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const onError = vi.fn();
    const onEnded = vi.fn();
    backend.onError(onError);
    backend.onEnded(onEnded);
    await backend.openFile('track.flac');
    await backend.setQueue({
      revision: 4,
      currentItemId: 'queue-1',
      repeatMode: 'off',
      items: [{ itemId: 'queue-1', trackId: 'track-1', filePath: 'track.flac' }],
    });

    rpc.emit('audio.ended', {
      queueAdvance: true,
      fromOperationId: 7,
      operationId: 8,
      queueRevision: 3,
      nextSampleRate: 44_100,
    });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'daemon_queue_advance_revision_mismatch:3:4',
    }));
    expect(onEnded).not.toHaveBeenCalled();
    backend.dispose();
  });

  it('rejects a same-revision queue transition that is not from the current operation', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const onError = vi.fn();
    const onEnded = vi.fn();
    backend.onError(onError);
    backend.onEnded(onEnded);
    await backend.openFile('track.flac');
    await backend.setQueue({
      revision: 4,
      currentItemId: 'queue-1',
      repeatMode: 'off',
      items: [{ itemId: 'queue-1', trackId: 'track-1', filePath: 'track.flac' }],
    });

    rpc.emit('audio.ended', {
      queueAdvance: true,
      fromOperationId: 6,
      operationId: 8,
      queueRevision: 4,
      nextSampleRate: 44_100,
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onEnded).not.toHaveBeenCalled();
    backend.dispose();
  });

  it('awaits AutoMix prepare acknowledgement and adopts the committed operation at the output frame', async () => {
    const rpc = createRpc();
    const backend = new DaemonAudioBackend(rpc);
    const committed = vi.fn();
    backend.onAutomixTransitionCommitted(committed);
    await backend.openFile('track.flac');
    await backend.setQueue({
      revision: 12,
      currentItemId: 'item-a',
      repeatMode: 'off',
      items: [
        { itemId: 'item-a', trackId: 'track-a', filePath: 'track.flac' },
        { itemId: 'item-b', trackId: 'track-b', filePath: 'next.flac' },
      ],
    });
    const plan = {
      version: 2 as const,
      planId: 'plan-12',
      queueRevision: 12,
      fromItemId: 'item-a',
      fromTrackId: 'track-a',
      toItemId: 'item-b',
      toTrackId: 'track-b',
      mixSampleRate: 48_000,
      mode: 'short_crossfade' as const,
      currentStartSeconds: 0,
      currentEndSeconds: 120,
      fadeStartOutputFrame: 5_000_000,
      fadeEndOutputFrame: 5_096_000,
      commitOutputFrame: 5_048_000,
      nextStartSeconds: 0,
      overlapFrames: 96_000,
      currentGainDb: 0,
      nextGainDb: 0,
      tempoRatio: 1,
      fallbackReason: 'analysis_unavailable',
    };

    await expect(backend.prepareAutomixV2({
      plan,
      nextSource: { kind: 'local', uri: 'next.flac' },
    })).resolves.toMatchObject({ acknowledged: true, state: 'armed' });
    expect(rpc.prepareAutomixV2).toHaveBeenCalledOnce();

    rpc.emit('audio.transitionCommitted', {
      planId: 'plan-12',
      queueRevision: 12,
      operationId: 8,
      fromItemId: 'item-a',
      fromTrackId: 'track-a',
      toItemId: 'item-b',
      toTrackId: 'track-b',
      outputFrame: 5_048_000,
      sourcePositionSeconds: 1,
    });
    rpc.emit('audio.position', {
      operationId: 8,
      framesPlayed: 48_000,
      bufferedFrames: 512,
      inputEnded: false,
    });

    expect(committed).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan-12',
      operationId: 8,
      outputFrame: 5_048_000,
    }));
    expect(backend.getPositionSeconds()).toBe(2);
    backend.dispose();
  });

  it.each(['exclusive', 'asio'] as const)(
    'arms Smart Transition without reopening the resident %s device session',
    async (outputMode) => {
      const rpc = createRpc();
      vi.mocked(rpc.configureDevice).mockResolvedValueOnce({
        accepted: true,
        changed: true,
        deviceOpened: true,
        outputMode,
        deviceId: `${outputMode}:dac`,
        deviceIndex: 4,
        deviceName: `${outputMode.toUpperCase()} DAC`,
        sampleRate: 96_000,
        channels: 2,
        bufferSize: 256,
        sharedBackend: 'auto',
      });
      const backend = new DaemonAudioBackend(rpc);
      await backend.configureDevice(`${outputMode}:dac`, {
        outputMode,
        requestedOutputSampleRate: 96_000,
        bufferSizeFrames: 256,
      });
      await backend.openFile('track.flac');
      await backend.setQueue({
        revision: 21,
        currentItemId: 'item-a',
        repeatMode: 'off',
        items: [
          { itemId: 'item-a', trackId: 'track-a', filePath: 'track.flac' },
          { itemId: 'item-b', trackId: 'track-b', filePath: 'next.flac' },
        ],
      });

      vi.mocked(rpc.configureDevice).mockClear();
      vi.mocked(rpc.sessionBegin).mockClear();
      vi.mocked(rpc.openFile).mockClear();
      vi.mocked(rpc.play).mockClear();

      await expect(backend.prepareAutomixV2({
        plan: {
          version: 2,
          planId: 'plan-12',
          queueRevision: 21,
          fromItemId: 'item-a',
          fromTrackId: 'track-a',
          toItemId: 'item-b',
          toTrackId: 'track-b',
          mixSampleRate: 96_000,
          mode: 'short_crossfade',
          currentStartSeconds: 0,
          currentEndSeconds: 120,
          fadeStartOutputFrame: 9_000_000,
          fadeEndOutputFrame: 9_192_000,
          commitOutputFrame: 9_096_000,
          nextStartSeconds: 0,
          overlapFrames: 192_000,
          currentGainDb: 0,
          nextGainDb: 0,
          tempoRatio: 1,
          fallbackReason: 'analysis_unavailable',
        },
        nextSource: { kind: 'local', uri: 'next.flac' },
      })).resolves.toMatchObject({ acknowledged: true, state: 'armed' });

      expect(rpc.prepareAutomixV2).toHaveBeenCalledOnce();
      expect(rpc.configureDevice).not.toHaveBeenCalled();
      expect(rpc.sessionBegin).not.toHaveBeenCalled();
      expect(rpc.openFile).not.toHaveBeenCalled();
      expect(rpc.play).not.toHaveBeenCalled();
      backend.dispose();
    },
  );

  it('fails closed on a mismatched AutoMix prepare acknowledgement', async () => {
    const rpc = createRpc();
    vi.mocked(rpc.prepareAutomixV2).mockResolvedValueOnce({
      acknowledged: true,
      state: 'armed',
      planId: 'stale-plan',
      operationId: 7,
      reason: null,
    });
    const backend = new DaemonAudioBackend(rpc);

    await expect(backend.prepareAutomixV2({
      plan: {
        version: 2,
        planId: 'current-plan',
        queueRevision: 1,
        fromItemId: 'a',
        fromTrackId: 'a',
        toItemId: 'b',
        toTrackId: 'b',
        mixSampleRate: 48_000,
        mode: 'short_crossfade',
        currentStartSeconds: 0,
        currentEndSeconds: 10,
        fadeStartOutputFrame: 100,
        fadeEndOutputFrame: 200,
        commitOutputFrame: 150,
        nextStartSeconds: 0,
        overlapFrames: 100,
        currentGainDb: 0,
        nextGainDb: 0,
        tempoRatio: 1,
        fallbackReason: 'test',
      },
      nextSource: { kind: 'local', uri: 'next.flac' },
    })).rejects.toThrow('daemon_automix_prepare_ack_mismatch');
    backend.dispose();
  });
});
