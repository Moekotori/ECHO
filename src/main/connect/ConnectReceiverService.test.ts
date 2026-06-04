import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../shared/types/audio';
import type { ConnectReceiverClient } from '../../shared/types/connect';
import { ConnectReceiverService } from './ConnectReceiverService';
import { receiverSinkProtocolInfo } from './ConnectReceiverXml';

const makeAudioStatus = (overrides: Partial<AudioStatus> = {}): AudioStatus => ({
  host: 'ready',
  state: 'idle',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: null,
  activeOutputBackendImpl: null,
  outputMode: 'shared',
  sharedBackend: 'auto',
  useJuceOutputRequested: false,
  useJuceDecodeRequested: false,
  activeDecodeBackendImpl: null,
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'speed',
  currentFilePath: null,
  currentTrackId: null,
  durationSeconds: 0,
  positionSeconds: 0,
  channels: null,
  codec: null,
  bitDepth: null,
  bitrate: null,
  fileSampleRate: null,
  decoderOutputSampleRate: null,
  requestedOutputSampleRate: null,
  actualDeviceSampleRate: null,
  sharedDeviceSampleRate: null,
  resampling: false,
  bitPerfectCandidate: false,
  sampleRateMismatch: false,
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: null,
  clippingRisk: false,
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
  ...overrides,
});

class FakeAudioSession extends EventEmitter {
  status = makeAudioStatus();
  playLocalFile = vi.fn(async (request: { filePath: string; startSeconds?: number }) => {
    this.status = makeAudioStatus({
      state: 'playing',
      currentFilePath: request.filePath,
      durationSeconds: 233,
      positionSeconds: request.startSeconds ?? 0,
      volume: this.status.volume,
    });
    this.emit('status', this.status);
    return this.status;
  });
  play = vi.fn(async () => {
    this.status = { ...this.status, state: 'playing' };
    this.emit('status', this.status);
    return this.status;
  });
  pause = vi.fn(async () => {
    this.status = { ...this.status, state: 'paused' };
    this.emit('status', this.status);
    return this.status;
  });
  stop = vi.fn(() => {
    this.status = { ...this.status, state: 'stopped', positionSeconds: 0 };
    this.emit('status', this.status);
    return this.status;
  });
  seek = vi.fn(async (positionSeconds: number) => {
    this.status = { ...this.status, positionSeconds };
    this.emit('status', this.status);
    return this.status;
  });
  setOutput = vi.fn(async (settings: { volume?: number }) => {
    this.status = { ...this.status, volume: settings.volume ?? this.status.volume };
    this.emit('status', this.status);
    return this.status;
  });
  getStatus = vi.fn(() => this.status);
}

type ReceiverHarness = {
  handleAvTransportAction: (
    action: string,
    args: Record<string, string>,
    client: ConnectReceiverClient,
  ) => Promise<{ serviceType: string; values?: Record<string, string | number> }>;
  handleRenderingControlAction: (
    action: string,
    args: Record<string, string>,
    client: ConnectReceiverClient,
  ) => Promise<{ serviceType: string; values?: Record<string, string | number> }>;
  handleConnectionManagerAction: (action: string) => { serviceType: string; values?: Record<string, string | number> };
  stopPlayback: () => unknown;
};

const client: ConnectReceiverClient = {
  address: '192.168.1.8',
  userAgent: 'vitest-control-point',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const flushPlaybackStart = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createService = (): { audio: FakeAudioSession; service: ConnectReceiverService; harness: ReceiverHarness } => {
  const audio = new FakeAudioSession();
  const service = new ConnectReceiverService({
    audioSession: audio as never,
    uuid: 'test-receiver',
    advertisedName: 'ECHO Test Receiver',
    networkAddresses: () => [{ address: '192.168.1.20', netmask: '255.255.255.0' }],
    now: () => 0,
  });
  return { audio, service, harness: service as unknown as ReceiverHarness };
};

describe('ConnectReceiverService SOAP behavior', () => {
  it('plays the original controller URI after SetAVTransportURI + Play', async () => {
    const { audio, service, harness } = createService();

    await harness.handleAvTransportAction(
      'SetAVTransportURI',
      {
        CurrentURI: 'http://192.168.1.8/media/song.flac',
        CurrentURIMetaData:
          '<DIDL-Lite><item><dc:title>Phone Song</dc:title><upnp:artist>Moe</upnp:artist><res duration="00:03:53">x</res></item></DIDL-Lite>',
      },
      client,
    );
    await harness.handleAvTransportAction('Play', {}, client);
    await flushPlaybackStart();

    expect(audio.playLocalFile).toHaveBeenCalledWith({
      filePath: 'http://192.168.1.8/media/song.flac',
      startSeconds: 0,
    });
    expect(service.getStatus()).toMatchObject({
      state: 'playing',
      currentUri: 'http://192.168.1.8/media/song.flac',
      metadata: { title: 'Phone Song', artist: 'Moe', durationSeconds: 233 },
    });
    await service.dispose();
  });

  it('maps pause, seek, stop, volume, and protocol info', async () => {
    const { audio, service, harness } = createService();

    await harness.handleAvTransportAction('SetAVTransportURI', { CurrentURI: 'http://phone/song.mp3' }, client);
    await harness.handleAvTransportAction('Play', {}, client);
    await flushPlaybackStart();
    await harness.handleAvTransportAction('Pause', {}, client);
    await harness.handleAvTransportAction('Seek', { Target: '00:01:02' }, client);
    await harness.handleRenderingControlAction('SetVolume', { DesiredVolume: '35' }, client);
    const volume = await harness.handleRenderingControlAction('GetVolume', {}, client);
    const protocolInfo = harness.handleConnectionManagerAction('GetProtocolInfo');
    await harness.handleAvTransportAction('Stop', {}, client);

    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.seek).toHaveBeenCalledWith(62);
    expect(audio.setOutput).toHaveBeenCalledWith({ volume: 0.35 });
    expect(volume.values?.CurrentVolume).toBe(35);
    expect(protocolInfo.values?.Sink).toBe(receiverSinkProtocolInfo);
    expect(service.getStatus().state).toBe('stopped');
    await service.dispose();
  });

  it('rejects video URIs before playback', async () => {
    const { audio, service, harness } = createService();

    await expect(
      harness.handleAvTransportAction('SetAVTransportURI', { CurrentURI: 'http://192.168.1.8/movie.mkv' }, client),
    ).rejects.toThrow('video media is not supported');
    expect(audio.playLocalFile).not.toHaveBeenCalled();
    await service.dispose();
  });

  it('allows controllers to clear the current URI before setting a new stream', async () => {
    const { audio, service, harness } = createService();

    await harness.handleAvTransportAction('SetAVTransportURI', { CurrentURI: 'http://phone/song.mp3' }, client);
    await harness.handleAvTransportAction('SetAVTransportURI', { CurrentURI: '', CurrentURIMetaData: '' }, client);

    expect(audio.playLocalFile).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({
      state: 'stopped',
      currentUri: null,
      metadata: null,
      error: null,
    });
    await service.dispose();
  });

  it('stops the previous receiver stream as soon as a new URI arrives', async () => {
    const { audio, service, harness } = createService();

    await harness.handleAvTransportAction('SetAVTransportURI', { CurrentURI: 'http://phone/first.mp3' }, client);
    await harness.handleAvTransportAction('Play', {}, client);
    await flushPlaybackStart();
    await harness.handleAvTransportAction('SetAVTransportURI', { CurrentURI: 'http://phone/second.mp3' }, client);

    expect(audio.stop).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toMatchObject({
      state: 'ready',
      currentUri: 'http://phone/second.mp3',
    });
    await service.dispose();
  });

  it('stops and clears receiver playback through the receiver command', async () => {
    const { audio, service, harness } = createService();

    await harness.handleAvTransportAction('SetAVTransportURI', { CurrentURI: 'http://phone/song.mp3' }, client);
    await harness.handleAvTransportAction('Play', {}, client);
    await flushPlaybackStart();
    harness.stopPlayback();

    expect(audio.stop).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toMatchObject({
      state: 'idle',
      currentUri: null,
      metadata: null,
    });
    await service.dispose();
  });

  it('releases receiver ownership when local playback takes over', async () => {
    const { audio, service, harness } = createService();

    await harness.handleAvTransportAction('SetAVTransportURI', { CurrentURI: 'http://phone/song.mp3' }, client);
    await harness.handleAvTransportAction('Play', {}, client);
    await flushPlaybackStart();

    audio.status = makeAudioStatus({
      state: 'playing',
      currentFilePath: 'D:\\Music\\local.flac',
      currentTrackId: 'local-track',
      durationSeconds: 180,
    });
    audio.emit('status', audio.status);

    expect(service.getStatus()).toMatchObject({
      state: 'idle',
      currentUri: null,
      metadata: null,
      error: null,
    });
    await service.dispose();
  });

  it('acknowledges Play before async audio startup completes', async () => {
    const { audio, service, harness } = createService();
    audio.playLocalFile.mockRejectedValueOnce(new Error('ffmpeg could not read controller stream'));

    await harness.handleAvTransportAction('SetAVTransportURI', { CurrentURI: 'http://phone/song.mp3' }, client);
    const response = await harness.handleAvTransportAction('Play', {}, client);

    expect(response.serviceType).toContain('AVTransport');
    expect(audio.playLocalFile).toHaveBeenCalledWith({
      filePath: 'http://phone/song.mp3',
      startSeconds: 0,
    });

    await flushPlaybackStart();
    expect(service.getStatus()).toMatchObject({
      state: 'error',
      error: 'ffmpeg could not read controller stream',
    });
    await service.dispose();
  });
});
