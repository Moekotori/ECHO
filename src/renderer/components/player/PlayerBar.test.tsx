// @vitest-environment jsdom
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AudioStatus } from '../../../shared/types/audio';
import { hqPlayerConnectDeviceId, type AirPlayReceiverStatus, type ConnectSessionStatus } from '../../../shared/types/connect';
import type { EqState } from '../../../shared/types/eq';
import { createDefaultGlobalShortcuts, createDefaultLocalShortcuts, type GlobalShortcutAction } from '../../../shared/types/globalShortcuts';
import type { HqPlayerStatus } from '../../../shared/types/hqplayer';
import type { LibraryTrack } from '../../../shared/types/library';
import type { SmtcCommand } from '../../../shared/types/smtc';
import { I18nProvider } from '../../i18n/I18nProvider';
import { PlaybackQueueProvider, usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { beginPlaybackSeekSnapshot, setPlaybackStatusSnapshot } from '../../stores/playbackStatusStore';
import { AudioSignalPathControl, AudioSignalPathPopover } from './AudioSignalPathPopover';
import { PlaybackCommandController } from './PlaybackCommandController';
import { PlayerBar } from './PlayerBar';

vi.mock('./SleepTimerButton', () => ({
  SleepTimerButton: () => <button type="button" aria-label="Sleep timer" />,
}));

const makeTrack = (index: number, overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: `track-${index}`,
  path: `D:\\Music\\song-${index}.flac`,
  title: `Song ${index}`,
  artist: `Artist ${index}`,
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: index,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180 + index,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

const audioStatus = (track: LibraryTrack): AudioStatus => ({
  host: 'ready',
  state: 'playing',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: 'wasapi-shared',
  activeOutputBackendImpl: null,
  outputMode: 'shared',
  useJuceOutputRequested: false,
  useJuceDecodeRequested: false,
  activeDecodeBackendImpl: null,
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: track.path,
  currentTrackId: track.id,
  durationSeconds: track.duration,
  positionSeconds: 4,
  channels: 2,
  codec: track.codec,
  bitDepth: track.bitDepth,
  bitrate: track.bitrate,
  fileSampleRate: track.sampleRate,
  decoderOutputSampleRate: track.sampleRate,
  requestedOutputSampleRate: track.sampleRate,
  actualDeviceSampleRate: track.sampleRate,
  sharedDeviceSampleRate: track.sampleRate,
  resampling: false,
  bitPerfectCandidate: false,
  sampleRateMismatch: false,
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: 'Flat',
  clippingRisk: false,
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
});

type SignalPathVisualNode = {
  title: string;
  value: string;
  tone: string | null;
  variant: string | null;
};

const readSignalPathVisualState = (dialog: HTMLElement): {
  tone: string | null;
  nodes: SignalPathVisualNode[];
} => ({
  tone: dialog.getAttribute('data-tone'),
  nodes: Array.from(dialog.querySelectorAll('.signal-path-roon-node')).map((node) => ({
    title: node.querySelector('.signal-path-roon-node__title')?.textContent ?? '',
    value: node.querySelector('.signal-path-roon-node__copy em')?.textContent ?? '',
    tone: node.getAttribute('data-tone'),
    variant: node.getAttribute('data-variant'),
  })),
});

const referenceArtifactManifestText = 'artifact-manifest-reference / deterministic 38/38 / planned none / not-applicable none / source impulse+sweep+log-sweep+near-nyquist+multi-tone+random+silence+phase-group-delay+phase-mode+apodizing+alias-rejection+realtime-budget+null-residual+formal-validation / reports dsd-family-path+backend-support+output-device-policy+latency-budget+readiness-contract+generation-cache-key+realtime-budget-summary+quality-rollback+output-resampling-risk+pcm-output-quantization+pcm-ingress-guard+gain-staging+iir-eq+channel-scope+stereo-procedural+per-ear-eq-placement+shared-convolution-duplicate-guard+shared-convolution-serial-null+gapless-concat+fir-gapless-history+callback-safe-controls+equal-power-crossfade+block-boundary+flush-drain';

const eqState = (): EqState => ({
  enabled: false,
  preampDb: 0,
  presetId: 'flat',
  presetName: 'Flat',
  clippingRisk: false,
  bands: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((frequencyHz) => ({
    frequencyHz,
    gainDb: 0,
    q: 1,
  })),
});

const dlnaConnectStatus = (track: LibraryTrack, state: ConnectSessionStatus['state'] = 'paused'): ConnectSessionStatus => ({
  deviceId: 'dlna:matrix-mini-i-pro-4',
  protocol: 'dlna',
  state,
  currentTrackId: track.id,
  metadata: {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    durationSeconds: track.duration,
    coverHttpUrl: '',
  },
  positionSeconds: 12,
  durationSeconds: track.duration,
  latencyMs: 86,
  error: null,
  updatedAt: '2026-05-27T07:30:00.000Z',
});

const hqPlayerConnectStatus = (track: LibraryTrack, state: ConnectSessionStatus['state'] = 'playing'): ConnectSessionStatus => ({
  deviceId: hqPlayerConnectDeviceId,
  protocol: 'hqplayer',
  state,
  currentTrackId: track.id,
  metadata: {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    durationSeconds: track.duration,
    coverHttpUrl: '',
  },
  positionSeconds: 12,
  durationSeconds: track.duration,
  latencyMs: 42,
  error: null,
  updatedAt: '2026-06-05T08:00:00.000Z',
});

const airPlayReceiverStatus = (track: LibraryTrack, state: AirPlayReceiverStatus['state'] = 'playing'): AirPlayReceiverStatus => ({
  enabled: true,
  state,
  protocol: 'airplay1',
  advertisedName: 'ECHO Next',
  nativeAvailable: true,
  currentSourceId: track.path,
  currentClient: null,
  metadata: {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    durationSeconds: track.duration,
    coverHttpUrl: '',
  },
  currentLyricLine: null,
  artworkUrl: null,
  positionSeconds: 12,
  durationSeconds: track.duration,
  volume: 100,
  error: null,
  debugEvents: [],
  updatedAt: '2026-06-07T05:30:00.000Z',
});

const subscribeAudioStatusHandlers = (handlers: Array<(status: AudioStatus) => void>) => (handler: (status: AudioStatus) => void): (() => void) => {
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  };
};

const emitAudioStatus = (handlers: Array<(status: AudioStatus) => void>, status: AudioStatus): void => {
  handlers.forEach((handler) => handler(status));
};

const QueueSeed = ({ showSignalPathControl, tracks }: { showSignalPathControl?: boolean; tracks: LibraryTrack[] }): JSX.Element => {
  const { setCurrentTrackId, replaceQueue } = usePlaybackQueue();

  useEffect(() => {
    replaceQueue(tracks);
    setCurrentTrackId(tracks[0]?.id ?? null);
  }, [replaceQueue, setCurrentTrackId, tracks]);

  return <PlayerBar showSignalPathControl={showSignalPathControl} />;
};

const ExternalPlaySeed = ({ track }: { track: LibraryTrack }): JSX.Element => {
  const { playTrack } = usePlaybackQueue();

  useEffect(() => {
    void playTrack(track);
  }, [playTrack, track]);

  return <PlayerBar />;
};

const ManualVisibleTrackSeed = ({
  initialTrackId,
  tracks,
}: {
  initialTrackId: string;
  tracks: LibraryTrack[];
}): JSX.Element => {
  const { replaceQueue, setCurrentTrackId } = usePlaybackQueue();

  useEffect(() => {
    replaceQueue(tracks);
    setCurrentTrackId(initialTrackId);
  }, [initialTrackId, replaceQueue, setCurrentTrackId, tracks]);

  return (
    <>
      <button type="button" onClick={() => setCurrentTrackId(tracks[0]?.id ?? null)}>
        Show current track
      </button>
      <PlayerBar />
    </>
  );
};

afterEach(() => {
  cleanup();
  setPlaybackStatusSnapshot({
    audioStatus: null,
    playbackStatus: null,
    playbackVisualIntent: null,
    error: null,
  });
  window.echo = undefined as unknown as typeof window.echo;
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PlayerBar', () => {
  it('routes footer play to the active DLNA Connect session instead of local playback', async () => {
    const track = makeTrack(31, { title: 'Matrix Route Track' });
    const pausedConnectStatus = dlnaConnectStatus(track, 'paused');
    const playingConnectStatus = dlnaConnectStatus(track, 'playing');
    const connectPlay = vi.fn().mockResolvedValue(playingConnectStatus);
    const localPlay = vi.fn();
    const localPause = vi.fn();

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'paused',
          currentTrackId: track.id,
          positionMs: 8000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: localPlay,
        pause: localPause,
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(pausedConnectStatus),
        play: connectPlay,
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        onStatus: vi.fn(() => vi.fn()),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        onStatus: vi.fn(() => vi.fn()),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Matrix Route Track');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() => expect(connectPlay).toHaveBeenCalledTimes(1));
    expect(localPlay).not.toHaveBeenCalled();
    expect(localPause).not.toHaveBeenCalled();
  });

  it('pauses the active HQPlayer Connect session even while takeover mode is enabled', async () => {
    window.localStorage.setItem('echo-next.hqplayer-takeover-enabled', 'true');
    const track = makeTrack(32, { title: 'HQPlayer Takeover Pause Track' });
    const playingConnectStatus = hqPlayerConnectStatus(track, 'playing');
    const pausedConnectStatus = hqPlayerConnectStatus(track, 'paused');
    const connectPause = vi.fn().mockResolvedValue(pausedConnectStatus);
    const activateLocalPlayback = vi.fn();

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 12000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: activateLocalPlayback,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(playingConnectStatus),
        play: vi.fn(),
        pause: connectPause,
        stop: vi.fn(),
        seek: vi.fn(),
        onStatus: vi.fn(() => vi.fn()),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        onStatus: vi.fn(() => vi.fn()),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('HQPlayer Takeover Pause Track');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(connectPause).toHaveBeenCalledTimes(1));
    expect(activateLocalPlayback).not.toHaveBeenCalled();
    expect(screen.queryByText('HQPlayer 接管中，ECHO 已避免抢占本机音频设备。')).toBeNull();
  });

  it('opens the bottom signal path popover with the current audio chain', async () => {
    const track = makeTrack(33, { title: 'Signal Path Track', codec: 'flac', sampleRate: 96000, bitDepth: 24 });
    const status = {
      ...audioStatus(track),
      bitDepth: 24,
      fileSampleRate: 96000,
      decoderOutputSampleRate: 96000,
      requestedOutputSampleRate: 96000,
      actualDeviceSampleRate: 96000,
      bitPerfectCandidate: true,
    };

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 8000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(null),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        onStatus: vi.fn(() => vi.fn()),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(status),
        onStatus: vi.fn(() => vi.fn()),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed showSignalPathControl={true} tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Signal Path Track');
    const signalPathButton = screen.getByRole('button', { name: '打开音频链路：纯净候选，FLAC / 96k / 24b' });
    expect(signalPathButton.textContent).toBe('');
    expect(signalPathButton.getAttribute('title')).toBe('打开音频链路：纯净候选，FLAC / 96k / 24b');

    fireEvent.click(signalPathButton);

    const dialog = await screen.findByRole('dialog', { name: '信号路径' });
    expect(dialog.textContent).toContain('信号路径: 无损');
    expect(dialog.textContent).toContain('数据源');
    expect(dialog.textContent).toContain('FLAC 96kHz 24bit');
    expect(dialog.textContent).toContain('输出');
  });

  it('opens the bottom signal path popover with the active HQPlayer chain', async () => {
    const track = makeTrack(37, { title: 'HQPlayer Signal Track', codec: 'flac', sampleRate: 44100, bitDepth: 16 });
    const connectStatus = hqPlayerConnectStatus(track, 'playing');
    const hqStatus: HqPlayerStatus = {
      enabled: true,
      state: 'available',
      endpoint: {
        connectionMode: 'localDesktop',
        host: '127.0.0.1',
        port: 4321,
      },
      mediaServerEnabled: false,
      defaultPlaybackBackend: 'hqplayer',
      profileName: 'SDM',
      lastCheckedAt: '2026-06-05T08:00:00.000Z',
      lastError: null,
      controlInfo: {
        name: 'Local HQPlayer',
        product: 'HQPlayer Desktop',
        version: '5.17.2',
        platform: 'Windows',
        engine: '5.29.2',
        receivedAt: '2026-06-05T08:00:00.000Z',
      },
      playbackStatus: {
        state: 'playing',
        stateCode: 1,
        track: 1,
        trackId: track.id,
        tracksTotal: 1,
        queued: false,
        positionSeconds: 12,
        durationSeconds: track.duration,
        volume: null,
        activeMode: 'SDM',
        activeFilter: 'sinc-long',
        activeShaper: 'ASDM7EC-super',
        activeRate: 22579200,
        activeBits: 1,
        activeChannels: 2,
        inputFill: null,
        outputFill: null,
        outputDelayUs: null,
        apodizing: null,
        metadata: {
          uri: track.path,
          mime: 'audio/flac',
          title: track.title,
          artist: track.artist,
          album: track.album,
          albumArtist: track.albumArtist,
          composer: null,
          performer: null,
          genre: null,
          date: null,
          sampleRate: 44100,
          bits: 16,
          channels: 2,
          bitrate: track.bitrate,
        },
        receivedAt: '2026-06-05T08:00:00.000Z',
      },
    };

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'paused',
          currentTrackId: track.id,
          positionMs: 12000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(connectStatus),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        onStatus: vi.fn(() => vi.fn()),
      },
      hqPlayer: {
        getStatus: vi.fn().mockResolvedValue(hqStatus),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(track),
          state: 'idle',
          currentTrackId: null,
          currentFilePath: null,
        }),
        onStatus: vi.fn(() => vi.fn()),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed showSignalPathControl={true} tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('HQPlayer Signal Track');
    const signalPathButton = await screen.findByRole('button', { name: /HQPlayer/u });
    fireEvent.click(signalPathButton);

    const dialog = await screen.findByRole('dialog', { name: '信号路径' });
    expect(dialog.textContent).toContain('信号路径: HQPlayer');
    expect(dialog.textContent).toContain('FLAC 44.1kHz 16bit 2ch');
    await waitFor(() => expect(dialog.textContent).toContain('HQPlayer Desktop'));
    expect(dialog.textContent).toContain('SDM / sinc-long / ASDM7EC-super');
    expect(dialog.textContent).toContain('HQPlayer 输出 / 22.58MHz / 1bit / 2ch');
    expect(dialog.textContent).not.toContain('等待信号');
  });

  it('shows enhanced signal path nodes when EQ is enabled', () => {
    const track = makeTrack(34, { title: 'EQ Signal Track', codec: 'flac', sampleRate: 96000, bitDepth: 24 });
    const status = {
      ...audioStatus(track),
      bitDepth: 24,
      eqEnabled: true,
      dspActive: true,
      eqPresetName: 'Custom',
      nativeOutputFormat: 'pcm32',
    };

    render(
      <>
        <AudioSignalPathControl isOpen={true} status={status} track={track} onClick={vi.fn()} />
        <AudioSignalPathPopover isOpen={true} status={status} track={track} onClose={vi.fn()} />
      </>,
    );

    expect(screen.getByRole('button', { name: '打开音频链路：UZUME skeleton，FLAC / 96k / 24b' }).textContent).toBe('');
    const dialog = screen.getByRole('dialog', { name: '信号路径' });
    expect(dialog.textContent).toContain('信号路径: UZUME skeleton');
    expect(dialog.textContent).toContain('参数化 EQ');
    expect(dialog.textContent).toContain('5 个频段');
    expect(dialog.textContent).toContain('比特位深转换');
    expect(dialog.textContent).toContain('64bit Float 至 32bit');
  });

  it('does not render UZUME reference nodes without a compiled reference plan', () => {
    const track = makeTrack(37, { title: 'No Reference Signal Track', codec: 'flac', sampleRate: 48000, bitDepth: 24 });
    const status = {
      ...audioStatus(track),
      bitDepth: 24,
      dspActive: true,
      eqEnabled: true,
      nativeOutputFormat: 'pcm32',
    };

    render(
      <>
        <AudioSignalPathControl isOpen={true} status={status} track={track} onClick={vi.fn()} />
        <AudioSignalPathPopover isOpen={true} status={status} track={track} onClose={vi.fn()} />
      </>,
    );

    const dialog = screen.getByRole('dialog', { name: '信号路径' });
    const visualState = readSignalPathVisualState(dialog);

    expect(dialog.textContent).toContain('信号路径: UZUME skeleton');
    expect(dialog.textContent).not.toContain('UZUME reference compiler');
    expect(dialog.textContent).not.toContain('artifact-manifest-reference');
    expect(dialog.textContent).not.toContain('realtime-budget-summary-reference');
    expect(visualState.nodes.filter((node) => node.title.toLowerCase().includes('reference'))).toEqual([]);
  });

  it('shows UZUME reference compiler assignments in the signal path popover', () => {
    const track = makeTrack(134, { title: 'Reference Signal Track', codec: 'flac', sampleRate: 48000, bitDepth: 24 });
    const status = {
      ...audioStatus(track),
      bitDepth: 24,
      dspActive: true,
      eqEnabled: true,
      roomCorrectionEnabled: true,
      dspClippingRisk: true,
      dspLimiterProtecting: false,
      dspHeadroomDb: -6,
      nativeOutputFormat: 'pcm32',
      uzumeFormatPath: 'pcm_processed',
      uzumeHeadroomActive: true,
      uzumeGpuLimiterPlaybackActive: false,
      uzumeReferencePlan: {
        schemaVersion: 1,
        telemetrySchemaVersion: 2,
        formatPath: 'pcm_processed',
        sourceContainer: 'pcm',
        outputContainer: 'pcm',
        internalDomain: 'multibit-pcm',
        bitPerfectState: 'disabled',
        directDisabledReason: 'uzume_processing_enabled',
        backendSupport: {
          artifact: 'backend-support-reference',
          policy: 'reference-backend-only-no-runtime-switch',
          formatPath: 'pcm_processed',
          selectedBackend: 'cpu-float64-reference',
          realtimeBackend: 'not-enabled',
          outputDevicePolicyState: 'shared-mixer-risk',
          cpuReference: {
            id: 'cpu-float64-reference',
            state: 'available',
            role: 'deterministic-reference',
          },
          cpuAvx: {
            id: 'cpu-avx2-fused-macro-kernel',
            state: 'future-production-gate',
            gate: 'rpc-003-cpu-realtime-gate',
          },
          gpu: {
            id: 'gpu-render-ahead-offload',
            state: 'future-render-ahead-gate',
            gate: 'rpc-005-gpu-render-ahead-gate',
          },
          legacy: {
            id: 'legacy-dsp-chain',
            state: 'non-uzume-fallback-only',
            allowedInCompiler: false,
          },
          reasons: [
            'cpu_float64_reference_selected_for_rpc002',
            'avx2_gpu_runtime_backends_deferred_beyond_reference_gate',
            'legacy_dsp_chain_not_entered_by_uzume_compiler',
            'backend_support_reference_only',
          ],
        },
        formatPathPlan: {
          pcm_bitperfect: { state: 'disabled', reason: 'uzume_processing_enabled' },
          pcm_processed: { state: 'current', reason: null },
          dsd_direct: { state: 'unavailable', reason: 'requires_dsd_source' },
          dsd_upsampling: { state: 'unavailable', reason: 'requires_dsd_source' },
          d2p_processed: { state: 'unavailable', reason: 'd2p_requires_dsd_source' },
          sdm_processed: { state: 'unavailable', reason: 'sdm_reference_engine_not_ready' },
        },
        outputDevicePolicy: {
          artifact: 'output-device-policy-reference',
          formatPath: 'pcm_processed',
          outputMode: 'shared',
          deviceCapability: 'shared-mixer',
          state: 'shared-mixer-risk',
          sourceContainer: 'pcm',
          outputContainer: 'pcm',
          fileRate: 44100,
          decoderOutputRate: 44100,
          requestedOutputRate: 48000,
          actualDeviceRate: 48000,
          sharedDeviceRate: 48000,
          bitPerfectCandidate: false,
          resampling: true,
          sampleRateMismatch: true,
          recommendation: 'prefer-exclusive-or-device-rate-match',
          reasons: ['shared_or_system_output_may_use_mixer_resampling', 'output_device_policy_reference_only'],
        },
        latencyBudget: {
          artifact: 'latency-budget-reference',
          policy: 'reference-budget-summary-no-runtime-scheduler',
          state: 'ready',
          selectedBackend: 'cpu-float64-reference',
          realtimeBackend: 'not-enabled',
          outputDevicePolicyState: 'shared-mixer-risk',
          sourceRate: 44100,
          targetRate: 48000,
          srcGroupDelaySamples: 35,
          srcGroupDelayMs: 0.729,
          srcLookaheadSamples: 35,
          srcLookaheadMs: 0.729,
          convolutionLatencyClass: 'quality-first',
          convolutionLatencySamples: 1024,
          convolutionDirectHeadTaps: 128,
          convolutionWarmupFrames: 512,
          convolutionTailFrames: 2047,
          convolutionDrainFrames: 2047,
          callbackBlockFrames: 512,
          internalBlockFrames: 1024,
          outputBlockFrames: 512,
          preRollRequiredFrames: 10240,
          deadlineSlackFrames: 13760,
          outputRingDepthFrames: 1024,
          callbackRingCapacityFrames: 4096,
          callbackRingDepthFrames: 2560,
          callbackRingDepthBlocks: 5,
          renderAheadState: 'cache-warming',
          renderAheadTargetFrames: 9600,
          renderAheadReadyFrames: 2400,
          cacheBudgetBytes: 384000,
          cacheBytesAfterEvict: 0,
          latencyOwners: { 'shared-convolution': 'room-ir-latency', 'pcm-src': 'resampling-reference' },
          callbackRule: 'read-committed-output-only',
          schedulerState: 'reference-only',
          reasons: [
            'latency_budget_summary_derived_from_reference_reports',
            'cpu_float64_reference_only_no_runtime_scheduler',
            'callback_reads_committed_output_only',
            'production_latency_compensation_deferred_to_realtime_gate',
          ],
        },
        readinessContract: {
          artifact: 'readiness-contract-reference',
          policy: 'main-playback-owns-timeline-uzume-reports-readiness',
          state: 'waiting-for-full-profile',
          intent: 'normal-playlist-boundary',
          playbackPolicy: 'predictive-cache',
          selectedPath: 'wait-for-full-profile',
          waitTarget: 'cpu-or-gpu-full-profile',
          fullProfileReady: false,
          gpuPrewarmReady: false,
          gpuPrewarmState: 'future-render-ahead-gate',
          cacheState: 'miss',
          cacheCommitState: 'callback-keeps-prior-committed-output',
          cacheKey: 'next-head:reference:0',
          renderAheadState: 'cache-warming',
          renderAheadReadyFrames: 2400,
          renderAheadTargetFrames: 9600,
          deadlineState: 'deadline-safe',
          deadlineSlackFrames: 13760,
          callbackRingState: 'stable',
          callbackRingTelemetryStatus: 'safe',
          shortBridgeCandidate: 'blocked',
          shortBridgeReason: 'intent_requires_full_quality_profile',
          crossfadeToFullProfile: 'blocked-by-intent',
          generationCommitRule: 'current-generation-only',
          staleGenerationCommitAllowed: false,
          handoffStrategy: 'same-pipeline-no-reset',
          productionScheduler: 'not-enabled',
          reasons: [
            'readiness_summary_derived_from_reference_reports',
            'main_playback_logic_owns_timeline_and_policy',
            'gpu_prewarm_deferred_to_render_ahead_gate',
            'stale_generation_commit_disallowed',
            'readiness_contract_reference_only',
          ],
        },
        generationCacheKey: {
          artifact: 'generation-cache-key-reference',
          policy: 'generation-safe-cache-key-contract-reference',
          state: 'ready',
          generationId: 1,
          generationSource: 'playback-intent-reference',
          timelineScope: 'normal-next-track-head',
          trackRole: 'next-track-head',
          sourceIdentity: 'next-reference',
          albumSegmentKey: null,
          albumSegmentIndex: null,
          requestKey: 'next-head:reference:0',
          cacheKey: 'next-head:reference:0|generation:1|timeline:normal-next-track-head|album:none|profile:ui-ref|device:ui-ref',
          profileFingerprint: 'profile:ui-ref',
          profileComponents: ['format:pcm_processed', 'domain:multibit-pcm', 'sections:format-path+peq+shared-convolution+pcm-src+dither', 'src:44.1k-family->48k-family', 'conv:48k-family:quality-first', 'backend:cpu-float64-reference'],
          deviceFingerprint: 'device:ui-ref',
          deviceComponents: ['mode:shared', 'capability:shared-mixer', 'requested:48000', 'actual:48000', 'shared:48000', 'output:pcm'],
          invalidatesOn: ['seek', 'manual-skip', 'profile-change', 'device-change', 'output-mode-change', 'sample-rate-plan-change'],
          preservesOn: ['pause', 'resume', 'mute', 'volume', 'declick'],
          staleCommitRule: 'reject-stale-generation',
          callbackSlotRule: 'late-current-generation-retain-for-future-only',
          evictionRule: 'stale-then-farthest-from-boundary',
          rendererControl: 'inspect-only',
          reasons: [
            'cache_key_includes_generation_profile_device_and_timeline',
            'album_segments_use_segment_index_when_gapless',
            'file_path_alone_is_not_a_valid_cache_key',
            'renderer_may_inspect_but_not_mutate_cache_keys',
            'generation_cache_key_reference_only',
          ],
        },
        realtimeBudgetSummary: {
          artifact: 'realtime-budget-summary-reference',
          policy: 'reference-budget-no-measured-runtime-factor',
          state: 'offline-reference-only',
          selectedBackend: 'cpu-float64-reference',
          realtimeBackend: 'not-enabled',
          measuredRealtimeFactor: null,
          measuredRealtimeFactorState: 'not-measured-in-rpc002',
          srcBudgetBackend: 'scalar-float64-reference',
          srcEstimatedMultiplyAdds: 2048,
          srcEstimatedRealtimeFactor: null,
          srcSafetyClass: 'offline-reference-only',
          callbackRingDepthBlocks: 5,
          callbackRingTelemetryStatus: 'safe',
          renderAheadReadyFrames: 2400,
          renderAheadTargetFrames: 9600,
          renderAheadCoverageRatio: 0.25,
          cpuFullProfileFallback: 'reference-available',
          gpuRealtimeFactor: null,
          realtimeSafetyGate: 'rpc-003-cpu-realtime-gate',
          gpuRenderAheadGate: 'rpc-005-gpu-render-ahead-gate',
          thresholdSafeFactor: 2,
          thresholdMarginalFactor: 1.1,
          rendererControl: 'inspect-only',
          reasons: [
            'realtime_factor_not_measured_in_rpc002',
            'scalar_float64_budget_is_reference_only',
            'cpu_avx2_realtime_gate_deferred_to_rpc003',
            'gpu_render_ahead_realtime_gate_deferred_to_rpc005',
            'renderer_may_inspect_but_not_control_realtime_path',
          ],
        },
        orderedProfileSections: ['format-path', 'peq', 'shared-convolution', 'pcm-src', 'dither'],
        engineAssignments: [
          { sectionId: 'format-path', engineId: 'format-path-planner-reference', active: true, source: 'format-planner' },
          { sectionId: 'peq', engineId: 'iir-reference', active: true, source: 'ui-section', mergeGroupId: 'iir-reference' },
          { sectionId: 'shared-convolution', engineId: 'shared-convolution-planner-reference', active: true, source: 'ui-section', mergeGroupId: 'shared-convolution-reference', latencyOwner: 'room-ir-latency' },
          { sectionId: 'pcm-src', engineId: 'resampling-reference', active: true, source: 'ui-section', mergeGroupId: 'resampling-reference', splitReason: 'legacy_default_resampler_active_reference_only', latencyOwner: 'resampling-reference' },
          { sectionId: 'dither', engineId: 'dither-reference', active: true, source: 'format-planner', mergeGroupId: 'dither-reference' },
        ],
        mergeGroups: [
          { id: 'iir-reference', engineId: 'iir-reference', sections: ['peq'], active: true, splitReason: null },
          { id: 'shared-convolution-reference', engineId: 'shared-convolution-planner-reference', sections: ['shared-convolution'], active: true, sampleRateFamily: '48k-family', splitReason: null },
          { id: 'resampling-reference', engineId: 'resampling-reference', sections: ['pcm-src'], active: true, sampleRateFamily: '48k-family', splitReason: 'legacy_default_resampler_active_reference_only' },
          { id: 'dither-reference', engineId: 'dither-reference', sections: ['dither'], active: true, splitReason: null },
        ],
        latencyOwners: { 'shared-convolution': 'room-ir-latency', 'pcm-src': 'resampling-reference' },
        artifactPlan: {
          impulse: 'deterministic-reference',
          sweep: 'deterministic-reference',
          logSweep: 'deterministic-reference',
          nearNyquist: 'deterministic-reference',
          multiTone: 'deterministic-reference',
          random: 'deterministic-reference',
          silence: 'deterministic-reference',
          phaseGroupDelay: 'deterministic-reference',
          phaseMode: 'deterministic-reference',
          apodizing: 'deterministic-reference',
          aliasRejection: 'deterministic-reference',
          realtimeBudget: 'deterministic-reference',
          nullResidual: 'deterministic-reference',
          formalValidation: 'deterministic-reference',
          dsdFamilyPath: 'deterministic-reference',
          backendSupport: 'deterministic-reference',
          outputDevicePolicy: 'deterministic-reference',
          latencyBudget: 'deterministic-reference',
          readinessContract: 'deterministic-reference',
          generationCacheKey: 'deterministic-reference',
          realtimeBudgetSummary: 'deterministic-reference',
          qualityRollback: 'deterministic-reference',
          outputResamplingRisk: 'deterministic-reference',
          pcmOutputQuantization: 'deterministic-reference',
          pcmIngressGuard: 'deterministic-reference',
          gainStaging: 'deterministic-reference',
          iirEq: 'deterministic-reference',
          channelScope: 'deterministic-reference',
          stereoProcedural: 'deterministic-reference',
          perEarEqPlacement: 'deterministic-reference',
          sharedConvolutionDuplicateGuard: 'deterministic-reference',
          sharedConvolutionSerialNull: 'deterministic-reference',
          gaplessConcat: 'deterministic-reference',
          firGaplessHistory: 'deterministic-reference',
          callbackSafeControls: 'deterministic-reference',
          equalPowerCrossfade: 'deterministic-reference',
          blockBoundary: 'deterministic-reference',
          flushDrain: 'deterministic-reference',
        },
        dsdFamily: {
          artifact: 'dsd-family-path-control-reference',
          formatPath: 'd2p_processed',
          sourceContainer: 'dsd',
          outputContainer: 'pcm',
          internalDomain: 'multibit-pcm',
          state: 'd2p-reference',
          directDisabledReason: 'dsd_source_decoded_to_pcm',
          fallbackReason: null,
          experimental: false,
          pcmDomainDspAllowed: true,
          entersPcmDsp: true,
          pcmDitherAllowed: true,
          sdmNoiseShapingTelemetry: false,
          allowedControls: ['safety-metering', 'eq', 'fir', 'pcm-src', 'pcm-dither', 'pcm-limiter'],
          disabledControls: [],
          dsd: {
            sourceDsdRate: 2822400,
            targetDsdRate: 2822400,
            outputEncoding: null,
          },
          d2p: {
            active: true,
            available: true,
            decimationProfile: 'dsd64-to-176k4-reference-low-pass',
            internalPcmRate: 176400,
          },
          sdm: {
            active: false,
            available: false,
            mode: 'none',
            modulatorProfile: null,
            targetDsdRate: null,
            headroomDb: null,
            overloadMarginDb: null,
            ultrasonicNoiseRisk: null,
            realtimeSafetyClass: 'offline-reference-only',
          },
          reasons: ['d2p_reports_decimation_profile_and_internal_pcm_rate'],
        },
        resampling: {
          active: true,
          family: 'poly-sinc-reference',
          phaseMode: 'linear',
          apodizing: 'reference-windowed-sinc',
          sourceRate: 44100,
          targetRate: 48000,
          sameRateBypass: false,
          groupDelaySamples: 35,
          groupDelayMs: 0.729,
          lookaheadMs: 0.729,
          realtimeSafetyClass: 'offline-reference-only',
          outputResamplingRisk: {
            artifact: 'output-double-resampling-risk-reference',
            state: 'legacy-resampler-active',
            reason: 'legacy_default_resampler_active_reference_only',
            requestedOutputRate: 48000,
            actualDeviceRate: 48000,
            sharedDeviceRate: null,
            currentResamplerEngine: 'default',
            signalPathTone: 'warning',
            recommendation: 'show-legacy-resampler-as-non-uzume-risk',
          },
          artifactMetrics: {
            aliasRejectionDb: 18.5,
            passbandRippleDb: 0.01,
            stopbandAttenuationDb: 96,
            cutoffRatioEstimate: 0.92,
            transitionWidthRatioEstimate: 0.08,
            phaseGroupDelaySpreadSamples: 2.5,
            silenceResidual: {
              state: 'exact-silence',
              comparedFrames: 64,
              maxAbs: 0,
              rms: 0,
            },
            multiTonePeak: 0.75,
            randomPeak: 0.62,
            randomSeed: 99537410,
            realtimeBudget: {
              backend: 'scalar-float64-reference',
              estimatedMultiplyAdds: 2048,
              estimatedRealtimeFactor: null,
              safetyClass: 'offline-reference-only',
            },
            nullResidual: {
              state: 'not-applicable',
              comparedFrames: 64,
              maxAbs: null,
              rms: null,
            },
          },
          phaseModeArtifacts: {
            artifact: 'poly-sinc-phase-mode-reference',
            phaseModesMeasured: ['linear', 'minimum', 'intermediate'],
            modes: [
              { mode: 'linear', impulsePeakIndex: 32, groupDelaySamples: 32, groupDelaySpreadSamples: 2.5, preRingingEnergy: 0.2, postRingingEnergy: 0.2, residualVsLinearMaxAbs: 0, residualVsLinearRms: 0 },
              { mode: 'minimum', impulsePeakIndex: 8, groupDelaySamples: 8, groupDelaySpreadSamples: 1.1, preRingingEnergy: 0.01, postRingingEnergy: 0.35, residualVsLinearMaxAbs: 0.12, residualVsLinearRms: 0.03 },
              { mode: 'intermediate', impulsePeakIndex: 20, groupDelaySamples: 20, groupDelaySpreadSamples: 1.8, preRingingEnergy: 0.08, postRingingEnergy: 0.28, residualVsLinearMaxAbs: 0.06, residualVsLinearRms: 0.015 },
            ],
          },
          apodizingArtifact: {
            artifact: 'poly-sinc-apodizing-response-reference',
            mode: 'reference-windowed-sinc',
            baseline: 'rectangular-sinc-reference',
            state: 'apodizing-changes-ringing-response',
            highFrequencyRestorationClaim: false,
            apodizedRingingEnergy: 0.12,
            baselineRingingEnergy: 0.2,
            ringingReductionDb: 2.22,
            responseResidualMaxAbs: 0.04,
            responseResidualRms: 0.01,
          },
          validation: {
            artifact: 'poly-sinc-formal-validation-reference',
            overall: 'pass',
            checks: [
              { id: 'passband-ripple', state: 'pass', actual: 0.01, threshold: 0.1, reason: 'passband_ripple_threshold' },
              { id: 'stopband-attenuation', state: 'pass', actual: 96, threshold: 36, reason: 'stopband_attenuation_threshold' },
              { id: 'transition-width', state: 'pass', actual: 0.08, threshold: 0.08, reason: 'transition_width_threshold' },
              { id: 'silence-preservation', state: 'pass', actual: 0, threshold: 1e-12, reason: 'silence_must_remain_exact_zero' },
              { id: 'same-rate-null', state: 'not-applicable', actual: null, threshold: 1e-12, reason: 'sample_rate_conversion_null_not_applicable' },
              { id: 'realtime-budget', state: 'pass', actual: 2048, threshold: 20000, reason: 'scalar_float64_reference_budget_threshold' },
            ],
            thresholds: {
              passbandRippleDbMax: 0.1,
              stopbandAttenuationDbMin: 36,
              transitionWidthRatioMax: 0.08,
              silenceMaxAbs: 1e-12,
              sameRateNullMaxAbs: 1e-12,
              sameRateNullRmsMax: 1e-12,
              estimatedMultiplyAddsMax: 20000,
              requireMeasuredRealtimeFactor: false,
            },
          },
          qualityRollback: {
            artifact: 'poly-sinc-quality-rollback-reference',
            state: 'armed',
            reason: 'realtime-budget-warning',
            primaryProfile: {
              id: 'poly-sinc-reference-linear-full',
              family: 'poly-sinc-reference',
              phaseMode: 'linear',
              apodizing: 'reference-windowed-sinc',
              tapCount: 64,
              stopbandAttenuationDb: 96,
              latencyClass: 'full',
              shortBridgeOnlyFor: null,
            },
            rollbackChain: [
              {
                id: 'poly-sinc-reference-linear-balanced',
                family: 'poly-sinc-reference',
                phaseMode: 'linear',
                apodizing: 'reference-windowed-sinc',
                tapCount: 48,
                stopbandAttenuationDb: 84,
                latencyClass: 'balanced',
                shortBridgeOnlyFor: null,
              },
              {
                id: 'poly-sinc-reference-linear-short',
                family: 'poly-sinc-reference',
                phaseMode: 'linear',
                apodizing: 'reference-windowed-sinc',
                tapCount: 32,
                stopbandAttenuationDb: 72,
                latencyClass: 'balanced',
                shortBridgeOnlyFor: null,
              },
            ],
            familyLock: 'poly-sinc-reference-only',
            legacyFallbackAllowed: false,
            legacyFallbackSignalPath: 'UZUME bypass / legacy non-UZUME path',
            shortBridgeIsRollback: false,
          },
        },
        sharedConvolution: {
          active: true,
          engine: 'shared-convolution-planner-reference',
          sources: [
            { id: 'room-ir', kind: 'room-ir', sampleRate: 48000, sampleRateFamily: '48k-family', channelLayout: 'stereo', channels: 2, tapCount: 2048, latencySamples: 1024, phasePolicy: 'linear', routing: 'per-channel' },
            { id: 'headphone-fir', kind: 'headphone-fir-correction', sampleRate: 44100, sampleRateFamily: '44.1k-family', channelLayout: 'stereo', channels: 2, tapCount: 512, latencySamples: 256, phasePolicy: 'linear', routing: 'per-channel' },
          ],
          mergedSourceIds: ['room-ir'],
          splitSourceIds: ['headphone-fir'],
          splitReasons: { 'headphone-fir': 'sample_rate_family_mismatch' },
          partitionPlan: {
            sampleRateFamily: '48k-family',
            latencyClass: 'quality-first',
            callbackBlockFrames: 512,
            internalBlockFrames: 1024,
            fftHeadSize: 2048,
            tailFrames: 2047,
            drainFrames: 2047,
          },
          responseResampleReports: [
            {
              artifact: 'high-precision-response-resample-policy-reference',
              sourceId: 'room-ir',
              kind: 'room-ir',
              sourceRate: 48000,
              targetRate: 48000,
              sourceFamily: '48k-family',
              targetFamily: '48k-family',
              state: 'same-rate-bypass',
              engine: 'exact-bypass',
              sameRateBypass: true,
              linearInterpolationRejected: false,
              filterContract: null,
              reason: 'same_rate_exact_bypass',
            },
            {
              artifact: 'high-precision-response-resample-policy-reference',
              sourceId: 'headphone-fir',
              kind: 'headphone-fir-correction',
              sourceRate: 44100,
              targetRate: 48000,
              sourceFamily: '44.1k-family',
              targetFamily: '48k-family',
              state: 'windowed-sinc-reference-required',
              engine: 'windowed-sinc-float64-reference',
              sameRateBypass: false,
              linearInterpolationRejected: true,
              filterContract: {
                tapCount: 64,
                phaseCount: 1024,
                cutoffRatio: 0.92,
                transitionWidthRatio: 0.08,
                stopbandAttenuationDb: 96,
                passbandRippleDb: 0.01,
              },
              reason: 'cross_family_response_resample_uses_windowed_sinc_reference',
            },
          ],
          duplicatePlanGuard: {
            artifact: 'shared-convolution-duplicate-plan-guard-reference',
            engine: 'shared-convolution-planner-reference',
            state: 'single-shared-plan',
            sourceAssignments: [
              {
                sourceId: 'room-ir',
                state: 'shared-plan',
                convolverPlanId: 'cpu-sce-48k-family:48000:stereo:room-ir:512',
                fftPlanId: 'cpu-sce-48k-family:48000:stereo:room-ir:512:fft:1024',
                splitReason: null,
              },
              {
                sourceId: 'headphone-fir',
                state: 'split-required',
                convolverPlanId: null,
                fftPlanId: null,
                splitReason: 'sample_rate_family_mismatch',
              },
            ],
            planCounts: {
              mergedSourceCount: 1,
              splitSourceCount: 1,
              convolverPlanCount: 1,
              cpuFftPlanCount: 1,
              gpuFftPlanCount: 1,
              rejectedDuplicateConvolverCount: 0,
              rejectedDuplicateFftPlanCount: 0,
            },
            rejectedDuplicatePlans: [],
            reasons: ['compatible_sources_share_single_convolution_plan', 'duplicate_per_source_convolver_and_fft_plans_rejected'],
          },
          serialNullReference: {
            artifact: 'shared-convolution-serial-null-reference',
            engine: 'shared-convolution-planner-reference',
            state: 'split-or-inactive',
            sourceOrder: ['room-ir'],
            mergedResponseTapCounts: [],
            comparedFrames: 0,
            maxAbs: null,
            rms: null,
            reasons: ['serial_null_skipped_for_split_or_inactive_plan', 'serial_null_reference_only'],
          },
        },
        pcmOutputQuantization: {
          artifact: 'pcm-output-quantization-dither-reference',
          formatPath: 'pcm_processed',
          outputSampleFormat: 'int32',
          state: 'quantized',
          bitPerfectState: 'disabled',
          pcmDitherAllowed: true,
          sdmNoiseShapingTelemetry: false,
          dither: {
            mode: 'tpdf',
            enabled: true,
            seed: 219668994,
            lsbAmplitude: 1 / 2147483647,
            peakDitherLsb: 0.875,
            noiseShaping: 'none',
          },
          quantization: {
            bitDepth: 32,
            maxInteger: 2147483647,
            clippedSamples: 0,
            residualMaxAbs: 2.4e-10,
            residualRms: 1.1e-10,
          },
          reasons: [
            'fixed_point_pcm_output_quantized',
            'pcm_dither_disables_bitperfect',
            'pcm_tpdf_or_plain_quantization_reference',
          ],
        },
        pcmIngressGuard: {
          artifact: 'pcm-ingress-guard-reference',
          state: 'ok',
          expectedChannels: 2,
          channelCount: 2,
          frameCount: 8,
          rectangular: true,
          counts: {
            nonFiniteReplaced: 0,
            denormalZeroed: 0,
            channelMismatchCount: 0,
            silenceFrames: 1,
          },
          peak: 0.875,
          reasons: ['pcm_ingress_ready_for_reference_processing'],
        },
        gainStaging: {
          artifact: 'gain-staging-reference',
          engine: 'gain-reference',
          orderContract: ['input', 'headroom', 'replaygain', 'materialized-gain', 'output'],
          stages: [
            { id: 'input', gainDb: 0, cumulativeGainDb: 0, peak: 0.875, rms: 0.4, peakDbfs: -1.16, rmsDbfs: -7.96, clippingRisk: false },
            { id: 'headroom', gainDb: -6, cumulativeGainDb: -6, peak: 0.4385, rms: 0.2, peakDbfs: -7.16, rmsDbfs: -13.96, clippingRisk: false },
            { id: 'replaygain', gainDb: 0, cumulativeGainDb: -6, peak: 0.4385, rms: 0.2, peakDbfs: -7.16, rmsDbfs: -13.96, clippingRisk: false },
            { id: 'materialized-gain', gainDb: 0, cumulativeGainDb: -6, peak: 0.4385, rms: 0.2, peakDbfs: -7.16, rmsDbfs: -13.96, clippingRisk: false },
            { id: 'output', gainDb: 0, cumulativeGainDb: -6, peak: 0.4385, rms: 0.2, peakDbfs: -7.16, rmsDbfs: -13.96, clippingRisk: false },
          ],
          totalGainDb: -6,
          totalGainLinear: 0.501187,
          recommendedAdditionalHeadroomDb: 0,
          clipRisk: false,
          reasons: [
            'headroom_applied_before_replaygain_and_materialized_gain',
            'gain_stages_merge_to_single_gain_reference',
            'gain_staging_within_sample_peak_budget',
          ],
        },
        iirEq: {
          artifact: 'iir-eq-reference',
          engine: 'iir-reference',
          orderContract: 'ui-band-order-biquad-cascade',
          state: 'active',
          sampleRate: 44100,
          bandCount: 1,
          activeBandCount: 1,
          bypassedBandCount: 0,
          bands: [
            {
              index: 0,
              filterType: 'peaking',
              frequencyHz: 1000,
              requestedFrequencyHz: 1000,
              q: 1,
              gainDb: 3,
              state: 'active',
              coefficientState: 'generated',
              responsePeakDb: 3,
              responseDipDb: 0,
              phaseSpanRadians: 0.25,
              reasons: ['biquad_coefficients_generated', 'frequency_response_measured'],
            },
          ],
          residual: {
            state: 'processed',
            comparedFrames: 8,
            maxAbs: 0.12,
            rms: 0.04,
          },
          reasons: ['peq_basic_iir_reference_only', 'active_biquads_applied_in_ui_order'],
        },
        channelScope: {
          artifact: 'channel-scope-reference',
          engine: 'stereo-procedural-reference',
          scopeContract: 'targeted-channels-only',
          channelCount: 2,
          operationCount: 1,
          appliedOperationCount: 1,
          noopOperationCount: 0,
          invalidOperationCount: 0,
          untouchedChannelIndexes: [1],
          operations: [
            {
              id: 'left-trim-scope',
              kind: 'gain',
              targetChannels: [0],
              skippedChannels: [1],
              state: 'applied',
              gainDb: -1,
              sourceChannel: null,
              reasons: ['operation_applied_to_target_channels_only'],
            },
          ],
          residualByChannel: [
            { channelIndex: 0, state: 'processed', maxAbs: 0.01, rms: 0.004 },
            { channelIndex: 1, state: 'out-of-scope-bypass', maxAbs: 0, rms: 0 },
          ],
          reasons: ['channel_scope_resolved_before_operation', 'out_of_scope_channels_must_remain_exact_bypass'],
        },
        stereoProcedural: {
          artifact: 'stereo-procedural-matrix-filter-reference',
          engine: 'stereo-procedural-reference',
          state: 'active',
          sampleRate: 44100,
          channelCount: 2,
          steps: ['trim', 'delay'],
          matrix: [[1, 0], [0, 1]],
          delaySamples: { left: 0, right: 44.1 },
          routing: {
            invertLeft: false,
            invertRight: false,
            swapLeftRight: false,
            monoMode: 'off',
          },
          crossfeed: {
            enabled: false,
            crossDelaySamples: 0,
            lowPassHz: null,
            centerPreservation: 'none',
          },
          input: { peak: 0.875, rms: 0.4 },
          output: { peak: 0.78, rms: 0.35 },
          residual: {
            state: 'processed',
            comparedFrames: 8,
            maxAbs: 0.1,
            rms: 0.03,
          },
          reasons: [
            'stereo_procedural_reference_only',
            'stereo_procedural_steps_applied_in_order',
            'band_compensation_requires_iir_reference_split',
          ],
        },
        perEarEqPlacement: {
          artifact: 'per-ear-eq-placement-reference',
          orderContract: ['pre-crossfeed-eq', 'crossfeed-matrix-filter', 'post-crossfeed-eq'],
          compilerRule: 'do-not-reorder-across-crossfeed-without-null-proof',
          state: 'placement-sensitive',
          sampleRate: 44100,
          perEarEq: {
            leftGainDb: -6,
            rightGainDb: 6,
          },
          crossfeed: {
            enabled: true,
            crossGainDb: -9,
            crossDelayMs: 0,
            lowPassHz: 22050,
            centerPreservation: 'none',
          },
          preCrossfeedSteps: ['pre-per-ear-eq', 'crossfeed'],
          postCrossfeedSteps: ['crossfeed', 'post-per-ear-eq'],
          residual: {
            comparedFrames: 4,
            maxAbs: 0.188,
            rms: 0.052,
          },
          reasons: ['crossfeed_and_asymmetric_per_ear_eq_are_not_commutative', 'do_not_reorder_across_crossfeed_without_null_proof', 'per_ear_eq_placement_reference_only'],
        },
        blockBoundary: {
          artifact: 'block-boundary-split-reference',
          policy: 'valid-frames-committed-padding-never-output',
          blockFrames: 6,
          inputFrames: 8,
          channelCount: 2,
          blockCount: 2,
          blockStates: ['full', 'partial-padded'],
          coverage: {
            state: 'exact',
            coveredFrames: 8,
            missingFrames: 0,
            duplicateFrames: 0,
            committedFrames: 8,
            paddedFrames: 4,
          },
          residual: {
            state: 'exact-reassembly',
            comparedFrames: 8,
            maxAbs: 0,
            rms: 0,
          },
          boundaryCount: 1,
          maxIntroducedDiscontinuity: 0,
          reasons: [
            'block_boundaries_cover_each_source_frame_once',
            'final_block_zero_padding_not_committed',
            'reassembled_output_matches_source_without_boundary_discontinuity',
          ],
        },
        flushDrain: {
          artifact: 'flush-drain-reference',
          engine: 'direct-fir-float64-reference',
          generationId: 7,
          generationState: 'current',
          naturalEof: {
            intent: 'natural-eof',
            generationAfter: 7,
            state: 'drain-committed',
            sourceFrames: 3,
            tailFrames: 2,
            drainFrames: 2,
            resetRequired: false,
            drainCommitAllowed: true,
            residual: {
              sourceWindowMaxAbs: 0,
              sourceWindowRms: 0,
              drainMaxAbs: 0,
              drainRms: 0,
            },
            reasons: ['natural_eof_commits_drain_tail', 'drain_frames_match_filter_tail'],
          },
          manualFlush: {
            intent: 'manual-flush',
            generationAfter: 8,
            state: 'tail-dropped-and-reset',
            sourceFrames: 3,
            tailFrames: 2,
            drainFrames: 0,
            resetRequired: true,
            drainCommitAllowed: false,
            residual: {
              sourceWindowMaxAbs: 0,
              sourceWindowRms: 0,
              drainMaxAbs: 0,
              drainRms: 0,
            },
            reasons: ['transport_boundary_drops_pending_tail', 'generation_increment_required', 'render_state_reset_required'],
          },
        },
        gaplessConcat: {
          artifact: 'gapless-concat-reference',
          policy: 'source-pcm-concat-before-src',
          state: 'src-stateful',
          sourceRate: 44100,
          targetRate: 48000,
          ratio: 48000 / 44100,
          segmentCount: 2,
          boundaryCount: 1,
          concatNullResidual: {
            state: 'concat-matches-no-reset',
            comparedFrames: 18,
            maxAbs: 0,
            rms: 0,
          },
          resetResidual: {
            state: 'reset-vs-concat-reference',
            comparedFrames: 18,
            maxAbs: 0.125,
            rms: 0.03125,
          },
          boundaries: [
            { beforeSegmentId: 'track-a', afterSegmentId: 'track-b', sourceFrameOffset: 8, outputFrameOffset: 9, concatVsNoResetMaxAbs: 0, resetVsConcatMaxAbs: 0.125, resetVsConcatRms: 0.03125, outputJump: 0.25 },
          ],
          reasons: ['source_pcm_concat_before_src', 'src_state_must_not_reset_at_gapless_boundary', 'reset_per_track_src_compared_against_concat_reference', 'reference_artifact_generated_offline'],
        },
        firGaplessHistory: {
          artifact: 'fir-gapless-history-reference',
          policy: 'source-pcm-concat-before-fir',
          engine: 'direct-fir-float64-reference',
          state: 'history-required',
          sourceId: 'room-ir',
          sampleRate: 48000,
          segmentCount: 2,
          boundaryCount: 1,
          tailFrames: 3,
          drainFrames: 3,
          concatNullResidual: {
            state: 'concat-matches-no-reset-history',
            comparedFrames: 19,
            maxAbs: 0,
            rms: 0,
          },
          resetResidual: {
            state: 'reset-vs-concat-history-reference',
            comparedFrames: 19,
            maxAbs: 0.1875,
            rms: 0.046875,
          },
          boundaries: [
            { beforeSegmentId: 'track-a', afterSegmentId: 'track-b', sourceFrameOffset: 8, outputFrameOffset: 8, overlapHistoryFrames: 3, concatVsNoResetMaxAbs: 0, resetVsConcatMaxAbs: 0.1875, resetVsConcatRms: 0.046875, outputJump: 0.3125 },
          ],
          reasons: ['source_pcm_concat_before_fir', 'fir_history_must_cross_gapless_boundary', 'reset_per_track_fir_history_compared_against_concat_reference', 'fir_gapless_reference_only'],
        },
        callbackSafeControls: {
          artifact: 'callback-safe-urgent-controls-reference',
          policy: 'urgent-controls-after-committed-output',
          urgentControl: {
            control: 'mute',
            classification: 'callback-safe-urgent-control',
            generationState: 'current',
            state: 'applied',
            callbackRule: 'read-committed-output-then-apply-urgent-control',
            renderCacheAction: 'preserve',
            generationAfterControl: 1,
            requiresRenderGraphRebuild: false,
            commitAllowed: true,
            gainEnvelopeFrames: 8,
            declick: {
              enabled: true,
              frames: 4,
              startGain: 1,
              endGain: 0,
              maxStep: 1 / 3,
            },
            peak: {
              input: 0.875,
              output: 1 / 12,
            },
            reasons: ['callback_safe_urgent_control', 'render_cache_preserved', 'declick_gain_ramp', 'output_gain_zeroed'],
          },
          renderStateBoundary: {
            control: 'seek',
            classification: 'render-state-boundary',
            generationState: 'current',
            state: 'render-cache-invalidated',
            callbackRule: 'read-committed-output-only',
            renderCacheAction: 'invalidate-generation',
            generationAfterControl: 2,
            requiresRenderGraphRebuild: true,
            commitAllowed: false,
            gainEnvelopeFrames: 0,
            declick: {
              enabled: false,
              frames: 0,
              startGain: 0,
              endGain: 0,
              maxStep: 0,
            },
            peak: {
              input: 0.875,
              output: 0,
            },
            reasons: ['transport_boundary_requires_generation_increment', 'render_ahead_cache_invalidated', 'callback_keeps_prior_committed_output'],
          },
        },
        equalPowerCrossfade: {
          artifact: 'equal-power-crossfade-reference',
          policy: 'random-access-short-bridge-to-full-profile-only',
          rendered: {
            intent: 'user-random-seek-or-skip',
            sampleRate: 48000,
            fadeFrames: 5,
            durationMs: 5 / 48000 * 1000,
            state: 'crossfade-rendered',
            rejectionReason: null,
            gainLaw: {
              state: 'equal-power',
              maxPowerSumError: 0,
              midpointShortBridgeGain: Math.SQRT1_2,
              midpointFullProfileGain: Math.SQRT1_2,
            },
            residualVsHardSwitch: {
              state: 'measured-crossfade-difference',
              comparedFrames: 5,
              maxAbs: 0.20710678118654746,
              rms: 0.09578113585405947,
            },
            peak: {
              shortBridge: 1,
              fullProfile: 1,
              output: 1,
            },
            reasons: ['random_access_short_bridge_requires_equal_power_crossfade', 'full_profile_ready', 'equal_power_gain_law_reference', 'hard_switch_residual_measured'],
          },
          rejectedBoundary: {
            intent: 'gapless-boundary',
            sampleRate: 48000,
            fadeFrames: 5,
            durationMs: 5 / 48000 * 1000,
            state: 'rejected',
            rejectionReason: 'intent_not_user_random_seek_or_skip',
            gainLaw: {
              state: 'not-applicable',
              maxPowerSumError: 0,
              midpointShortBridgeGain: null,
              midpointFullProfileGain: null,
            },
            residualVsHardSwitch: {
              state: 'not-applicable',
              comparedFrames: 0,
              maxAbs: null,
              rms: null,
            },
            peak: {
              shortBridge: 1,
              fullProfile: 1,
              output: 0,
            },
            reasons: ['only_user_random_seek_or_skip_can_use_short_bridge_crossfade', 'gapless_boundary_waits_for_full_profile', 'equal_power_crossfade_reference_only'],
          },
        },
        continuity: {
          artifact: 'continuity-telemetry-reference',
          policy: 'callback-read-committed-reference',
          continuity: {
            artifact: 'continuity-quality-policy-reference',
            intent: 'normal-playlist-boundary',
            policy: 'predictive-cache',
            selectedPath: 'wait-for-full-profile',
            callbackRule: 'read-committed-output-only',
            commitAllowed: false,
            shortBridgeAllowed: false,
            shortBridgeReason: 'intent_requires_full_quality_profile',
            qualityRollback: 'none',
            waitTarget: 'cpu-or-gpu-full-profile',
          },
          preRoll: {
            artifact: 'pre-roll-deadline-reference',
            state: 'deadline-safe',
            preRollRequiredFrames: 10240,
            framesUntilBoundary: 24000,
            deadlineSlackFrames: 13760,
            renderAheadState: 'cache-warming',
            renderAheadTargetFrames: 9600,
            renderAheadReadyFrames: 2400,
            callbackBlockFrames: 512,
            outputRingDepthFrames: 1024,
            readRule: 'read-committed-output-only',
            mustNotWaitForGpu: true,
            handoffStrategy: 'same-pipeline-no-reset',
            requiresDualPipeline: false,
            commitAllowed: false,
            shortBridgeAllowed: false,
          },
          callbackRing: {
            artifact: 'cpu-callback-ring-reference',
            state: 'stable',
            telemetryStatus: 'safe',
            capacityFrames: 4096,
            depthFrames: 2560,
            depthBlocks: 5,
            callbackBlockFrames: 512,
            missingFrames: 0,
            readRule: 'read-committed-output-only',
            mustNotWaitForGpu: true,
            shortBridgeAllowed: false,
            shortBridgeReason: 'cpu_only_ring_does_not_enable_short_bridge',
          },
          renderAheadCache: {
            artifact: 'render-ahead-cache-reference',
            lookupState: 'miss',
            commitState: 'callback-keeps-prior-committed-output',
            commitAllowed: false,
            callbackRule: 'read-committed-output-only',
            mustNotWaitForGpu: true,
            requestKey: 'next-head:reference:0',
            budgetBytes: 384000,
            bytesBeforeEvict: 0,
            bytesAfterEvict: 0,
            retainedKeys: [],
            evictionCount: 0,
          },
          fallback: {
            artifact: 'fallback-injection-underrun-reference',
            state: 'prior-committed-fallback',
            selectedSource: 'prior-committed',
            telemetryStatus: 'marginal',
            callbackMustNotWaitForGpu: true,
            shortBridgeAllowed: false,
            shortBridgeReason: 'underrun_protection_does_not_enable_short_bridge',
            qualityRollback: 'controlled-fallback',
            fallbackInjected: true,
            commitAllowed: true,
          },
        },
      },
    } as unknown as AudioStatus;

    render(
      <>
        <AudioSignalPathControl isOpen={true} status={status} track={track} onClick={vi.fn()} />
        <AudioSignalPathPopover isOpen={true} status={status} track={track} onClose={vi.fn()} />
      </>,
    );

    const dialog = screen.getByRole('dialog', { name: '信号路径' });
    expect(dialog.textContent).toContain('UZUME reference compiler');
    expect(dialog.textContent).toContain('schema v1 / telemetry v2 / pcm_processed / multibit-pcm');
    expect(dialog.textContent).toContain('Reference assignment');
    expect(dialog.textContent).toContain('format-path->format path planner ref(active)');
    expect(dialog.textContent).toContain('shared-convolution->shared convolution planner ref(active, merge:shared-convolution-reference, latency:room-ir-latency)');
    expect(dialog.textContent).toContain('pcm-src->resampling ref(active, merge:resampling-reference, latency:resampling-reference, split:legacy default resampler active reference only)');
    expect(dialog.textContent).toContain('UZUME artifact manifest reference');
    expect(dialog.textContent).toContain(referenceArtifactManifestText);
    expect(dialog.textContent).toContain('UZUME reference path plan');
    expect(dialog.textContent).toContain('pcm_bitperfect:disabled/uzume processing enabled | pcm_processed:current | dsd_direct:unavailable/requires dsd source | dsd_upsampling:unavailable/requires dsd source | d2p_processed:unavailable/d2p requires dsd source | sdm_processed:unavailable/sdm reference engine not ready');
    expect(dialog.textContent).toContain('UZUME reference bit-perfect');
    expect(dialog.textContent).toContain('disabled / direct disabled:uzume processing enabled / pcm->pcm / multibit-pcm / format:pcm_processed');
    expect(dialog.textContent).toContain('UZUME backend support reference');
    expect(dialog.textContent).toContain('backend-support-reference / reference-backend-only-no-runtime-switch / selected cpu-float64-reference / realtime not-enabled / cpu available deterministic-reference / avx future-production-gate rpc-003-cpu-realtime-gate / gpu future-render-ahead-gate rpc-005-gpu-render-ahead-gate / legacy non-uzume-fallback-only compiler blocked / output shared-mixer-risk / reasons cpu float64 reference selected for rpc002 | avx2 gpu runtime backends deferred beyond reference gate | legacy dsp chain not entered by uzume compiler | backend support reference only');
    expect(dialog.textContent).toContain('UZUME output device policy reference');
    expect(dialog.textContent).toContain('output-device-policy-reference / pcm_processed / shared / shared-mixer / shared-mixer-risk / file 44.1kHz / decoder 44.1kHz / requested 48kHz / actual 48kHz / shared 48kHz / output pcm / bit-perfect candidate no / resampling yes / mismatch yes / recommend prefer-exclusive-or-device-rate-match / reasons shared or system output may use mixer resampling | output device policy reference only');
    expect(dialog.textContent).toContain('UZUME latency budget reference');
    expect(dialog.textContent).toContain('latency-budget-reference / cpu-float64-reference / realtime not-enabled / src 35 samples/0.73 ms lookahead 35 samples/0.73 ms / conv quality-first latency 1024 frames direct-head 128 taps warmup 512 frames tail 2047 frames drain 2047 frames / blocks 512 frames->1024 frames->512 frames / pre-roll 10240 frames slack 13760 frames / ring 2560 frames/4096 frames 5 blocks / render-ahead cache-warming 2400/9600 frames / cache 0 bytes/384000 bytes / owners shared-convolution->room-ir-latency | pcm-src->resampling-reference / read-committed-output-only / reference-only / reasons latency budget summary derived from reference reports | cpu float64 reference only no runtime scheduler | callback reads committed output only | production latency compensation deferred to realtime gate');
    expect(dialog.textContent).toContain('UZUME readiness contract reference');
    expect(dialog.textContent).toContain('readiness-contract-reference / main-playback-owns-timeline-uzume-reports-readiness / waiting-for-full-profile / normal-playlist-boundary->wait-for-full-profile / wait cpu-or-gpu-full-profile / full-profile not-ready / gpu-prewarm future-render-ahead-gate / cache miss->callback-keeps-prior-committed-output key next-head:reference:0 / render-ahead cache-warming 2400/9600 / deadline deadline-safe slack 13760 frames / ring stable/safe / short-bridge blocked intent requires full quality profile / crossfade blocked-by-intent / generation current-generation-only stale blocked / same-pipeline-no-reset / scheduler not-enabled / reasons readiness summary derived from reference reports | main playback logic owns timeline and policy | gpu prewarm deferred to render ahead gate | stale generation commit disallowed | readiness contract reference only');
    expect(dialog.textContent).toContain('UZUME generation cache key reference');
    expect(dialog.textContent).toContain('generation-cache-key-reference / generation-safe-cache-key-contract-reference / gen 1 / normal-next-track-head / next-track-head / request next-head:reference:0 / cache next-head:reference:0|generation:1|timeline:normal-next-track-head|album:none|profile:ui-ref|device:ui-ref / profile:ui-ref / device:ui-ref / profile format:pcm_processed + domain:multibit-pcm + sections:format-path+peq+shared-convolution+pcm-src+dither + src:44.1k-family->48k-family + conv:48k-family:quality-first + backend:cpu-float64-reference / device mode:shared + capability:shared-mixer + requested:48000 + actual:48000 + shared:48000 + output:pcm / album none index n/a / invalidate seek+manual-skip+profile-change+device-change+output-mode-change+sample-rate-plan-change / preserve pause+resume+mute+volume+declick / reject-stale-generation / late-current-generation-retain-for-future-only / stale-then-farthest-from-boundary / renderer inspect-only / reasons cache key includes generation profile device and timeline | album segments use segment index when gapless | file path alone is not a valid cache key | renderer may inspect but not mutate cache keys | generation cache key reference only');
    expect(dialog.textContent).toContain('UZUME realtime budget summary reference');
    expect(dialog.textContent).toContain('realtime-budget-summary-reference / reference-budget-no-measured-runtime-factor / offline-reference-only / selected cpu-float64-reference / realtime not-enabled / measured not-measured-in-rpc002 / src scalar-float64-reference 2048 multiply-adds factor unmeasured offline-reference-only / ring 5 blocks safe / render-ahead 2400/9600 25% / cpu reference-available / gpu factor unmeasured / thresholds safe 2x marginal 1.1x / rpc-003-cpu-realtime-gate / rpc-005-gpu-render-ahead-gate / renderer inspect-only / reasons realtime factor not measured in rpc002 | scalar float64 budget is reference only | cpu avx2 realtime gate deferred to rpc003 | gpu render ahead realtime gate deferred to rpc005 | renderer may inspect but not control realtime path');
    expect(dialog.textContent).toContain('Reference merge groups');
    expect(dialog.textContent).toContain('shared-convolution-reference->shared convolution planner ref(active, 48k-family, sections:shared-convolution)');
    expect(dialog.textContent).toContain('Reference latency owners');
    expect(dialog.textContent).toContain('shared-convolution->room-ir-latency | pcm-src->resampling-reference');
    expect(dialog.textContent).toContain('UZUME SRC reference');
    expect(dialog.textContent).toContain('poly-sinc-reference / 44.1kHz->48kHz / linear / reference-windowed-sinc / 35 samples / 0.73 ms / lookahead 0.73 ms / offline-reference-only');
    expect(dialog.textContent).toContain('risk:legacy default resampler active reference only');
    expect(dialog.textContent).toContain('artifacts:impulse+sweep+near-Nyquist+phase/group-delay');
    expect(dialog.textContent).toContain('alias 18.5 dB');
    expect(dialog.textContent).toContain('UZUME SRC rollback reference');
    expect(dialog.textContent).toContain('armed / realtime budget warning / poly-sinc-reference-only / poly-sinc-reference-linear-full:64 taps/96 dB/full -> poly-sinc-reference-linear-balanced:48 taps/84 dB/balanced -> poly-sinc-reference-linear-short:32 taps/72 dB/balanced / legacy blocked:UZUME bypass / legacy non-UZUME path / short bridge not rollback');
    expect(dialog.textContent).toContain('UZUME SRC budget reference');
    expect(dialog.textContent).toContain('scalar-float64-reference / 2048 multiply-adds / realtime factor unmeasured / offline-reference-only / null not-applicable');
    expect(dialog.textContent).toContain('UZUME SRC artifact reference');
    expect(dialog.textContent).toContain('passband 0.01 dB / stopband 96 dB / cutoff 0.92 / transition 0.08 / phase spread 2.5 samples / silence exact-silence max 0 / multi-tone peak 0.75 / seeded-random peak 0.62 / random seed 99537410');
    expect(dialog.textContent).toContain('UZUME SRC validation reference');
    expect(dialog.textContent).toContain('poly-sinc-formal-validation-reference / overall pass / passband-ripple:pass / stopband-attenuation:pass / transition-width:pass / silence-preservation:pass / same-rate-null:not-applicable / realtime-budget:pass');
    expect(dialog.textContent).toContain('UZUME SRC output risk reference');
    expect(dialog.textContent).toContain('output-double-resampling-risk-reference / legacy-resampler-active / legacy default resampler active reference only / requested 48kHz / actual 48kHz / current default / tone warning / recommend show legacy resampler as non uzume risk');
    expect(dialog.textContent).toContain('UZUME SRC phase/apodizing reference');
    expect(dialog.textContent).toContain('poly-sinc-phase-mode-reference / modes linear+minimum+intermediate / linear gd 32 spread 2.5 residual 0/0 | minimum gd 8 spread 1.1 residual 0.12/0.03 | intermediate gd 20 spread 1.8 residual 0.06/0.015 / poly-sinc-apodizing-response-reference / apodizing-changes-ringing-response / reference-windowed-sinc vs rectangular-sinc-reference / ringing reduction 2.22 dB / response residual 0.04/0.01 / no hf restoration claim');
    expect(dialog.textContent).toContain('UZUME DSD family reference');
    expect(dialog.textContent).toContain('dsd-family-path-control-reference / d2p_processed:d2p-reference / dsd->pcm / multibit-pcm / direct disabled dsd source decoded to pcm / allowed safety-metering+eq+fir+pcm-src+pcm-dither+pcm-limiter / disabled none / pcm dsp allowed / pcm dither allowed / sdm noise none / d2p dsd64-to-176k4-reference-low-pass @ 176400 Hz / sdm unavailable / reasons d2p reports decimation profile and internal pcm rate');
    expect(dialog.textContent).toContain('UZUME convolution reference');
    expect(dialog.textContent).toContain('shared-convolution-planner-reference / room-ir / 48k-family / quality-first / block 512->1024 / fft 2048 / tail 2047 / drain 2047');
    expect(dialog.textContent).toContain('UZUME response resample reference');
    expect(dialog.textContent).toContain('room-ir:same-rate-bypass / 48kHz->48kHz / 48k-family->48k-family / exact-bypass / linear interpolation not used / same rate exact bypass | headphone-fir:windowed-sinc-reference-required / 44.1kHz->48kHz / 44.1k-family->48k-family / windowed-sinc-float64-reference / linear interpolation rejected / 64 taps/0.92 cutoff/96 dB / cross family response resample uses windowed sinc reference');
    expect(dialog.textContent).toContain('UZUME convolution duplicate guard');
    expect(dialog.textContent).toContain('shared-convolution-duplicate-plan-guard-reference / shared-convolution-planner-reference / single-shared-plan / merged 1 / split 1 / convolver plans 1 / cpu fft 1 / gpu fft 1 / rejected conv 0 / rejected fft 0 / room-ir:shared-plan conv cpu-sce-48k-family:48000:stereo:room-ir:512 fft cpu-sce-48k-family:48000:stereo:room-ir:512:fft:1024 | headphone-fir:split-required split sample rate family mismatch / rejected none / reasons compatible sources share single convolution plan | duplicate per source convolver and fft plans rejected');
    expect(dialog.textContent).toContain('UZUME convolution serial null reference');
    expect(dialog.textContent).toContain('shared-convolution-serial-null-reference / shared-convolution-planner-reference / split-or-inactive / order room-ir / merged taps none / frames 0 / residual n/a / reasons serial null skipped for split or inactive plan | serial null reference only');
    expect(dialog.textContent).toContain('UZUME PCM output quantization reference');
    expect(dialog.textContent).toContain('pcm-output-quantization-dither-reference / pcm_processed->int32 / quantized / bit-perfect disabled / pcm dither allowed / dither tpdf enabled / seed 219668994 / lsb 4.66e-10 / peak 0.875 lsb / noise none / 32 bit / max 2147483647 / clips 0 / residual 2.40e-10/1.10e-10 / sdm noise none / reasons fixed point pcm output quantized | pcm dither disables bitperfect | pcm tpdf or plain quantization reference');
    expect(dialog.textContent).toContain('UZUME PCM ingress guard reference');
    expect(dialog.textContent).toContain('pcm-ingress-guard-reference / ok / expected 2 / channels 2 / frames 8 / rectangular / peak 0.875 / non-finite 0 / denormal 0 / mismatch 0 / silence 1 / reasons pcm ingress ready for reference processing');
    expect(dialog.textContent).toContain('UZUME gain staging reference');
    expect(dialog.textContent).toContain('gain-staging-reference / order input->headroom->replaygain->materialized-gain->output / total -6 dB / linear 0.5012 / clip safe / extra headroom 0 dB / input:gain 0 dB/cum 0 dB/peak 0.875 | headroom:gain -6 dB/cum -6 dB/peak 0.4385');
    expect(dialog.textContent).toContain('UZUME PEQ/IIR reference');
    expect(dialog.textContent).toContain('iir-eq-reference / iir-reference / active / sample 44.1kHz / bands 1/1 active / bypassed 0 / order ui-band-order-biquad-cascade / band0 peaking 1kHz 3 dB q 1 active coeff generated resp 3/0 dB phase 0.25 / residual processed 0.12/0.04');
    expect(dialog.textContent).toContain('UZUME channel scope reference');
    expect(dialog.textContent).toContain('channel-scope-reference / stereo-procedural-reference / targeted-channels-only / channels 2 / ops 1 / applied 1 / noop 0 / invalid 0 / untouched 1 / left-trim-scope:applied->0 skip 1 gain -1 dB');
    expect(dialog.textContent).toContain('UZUME stereo procedural reference');
    expect(dialog.textContent).toContain('stereo-procedural-matrix-filter-reference / stereo-procedural-reference / active / sample 44.1kHz / channels 2 / steps trim->delay / delay 0/44.1 samples / matrix [1,0;0,1] / routing identity / crossfeed disabled');
    expect(dialog.textContent).toContain('UZUME per-ear EQ placement reference');
    expect(dialog.textContent).toContain('per-ear-eq-placement-reference / do-not-reorder-across-crossfeed-without-null-proof / placement-sensitive / sample 44.1kHz / order pre-crossfeed-eq->crossfeed-matrix-filter->post-crossfeed-eq / per-ear -6/6 dB / crossfeed -9 dB delay 0 ms lowpass 22050 center none / pre pre-per-ear-eq->crossfeed / post crossfeed->post-per-ear-eq / residual 4 frames 0.188/0.052 / reasons crossfeed and asymmetric per ear eq are not commutative | do not reorder across crossfeed without null proof | per ear eq placement reference only');
    expect(dialog.textContent).toContain('UZUME block boundary reference');
    expect(dialog.textContent).toContain('block-boundary-split-reference / valid-frames-committed-padding-never-output / block 6 / input 8 / channels 2 / blocks 2 / states full+partial-padded / coverage exact covered 8 missing 0 duplicate 0 committed 8 padded 4 / residual exact-reassembly 0/0 / boundaries 1 / introduced 0');
    expect(dialog.textContent).toContain('UZUME flush/drain reference');
    expect(dialog.textContent).toContain('flush-drain-reference / direct-fir-float64-reference / generation 7/current / natural-eof:drain-committed / gen 7 / tail 2 / drain 2 / no reset / drain committed / source residual 0/0 / drain residual 0/0 / reasons natural eof commits drain tail | drain frames match filter tail / manual-flush:tail-dropped-and-reset / gen 8 / tail 2 / drain 0 / reset required / drain blocked');
    expect(dialog.textContent).toContain('UZUME gapless SRC reference');
    expect(dialog.textContent).toContain('gapless-concat-reference / source-pcm-concat-before-src / src-stateful / 44.1kHz->48kHz / ratio 1.088435 / segments 2 / boundaries 1 / concat concat-matches-no-reset 0/0 / reset reset-vs-concat-reference 0.125/0.03125 / boundary track-a->track-b out 9 reset 0.125 jump 0.25 / reasons source pcm concat before src | src state must not reset at gapless boundary | reset per track src compared against concat reference | reference artifact generated offline');
    expect(dialog.textContent).toContain('UZUME FIR gapless reference');
    expect(dialog.textContent).toContain('fir-gapless-history-reference / source-pcm-concat-before-fir / direct-fir-float64-reference / history-required / room-ir / sample 48kHz / segments 2 / boundaries 1 / tail 3 / drain 3 / concat concat-matches-no-reset-history 0/0 / reset reset-vs-concat-history-reference 0.1875/0.046875 / boundary track-a->track-b out 8 overlap 3 reset 0.1875 jump 0.3125 / reasons source pcm concat before fir | fir history must cross gapless boundary | reset per track fir history compared against concat reference | fir gapless reference only');
    expect(dialog.textContent).toContain('UZUME urgent controls reference');
    expect(dialog.textContent).toContain('callback-safe-urgent-controls-reference / urgent-controls-after-committed-output / urgent:mute:applied / callback-safe-urgent-control / read-committed-output-then-apply-urgent-control / cache preserve / gen 1 / no rebuild / commit allowed / declick enabled 4 frames 1->0 step 0.333333 / envelope 8 / peak 0.875->0.083333 / reasons callback safe urgent control | render cache preserved | declick gain ramp | output gain zeroed / boundary:seek:render-cache-invalidated / render-state-boundary / read-committed-output-only / cache invalidate-generation / gen 2 / rebuild required / commit blocked / declick off 0 frames 0->0 step 0 / envelope 0 / peak 0.875->0 / reasons transport boundary requires generation increment | render ahead cache invalidated | callback keeps prior committed output');
    expect(dialog.textContent).toContain('UZUME equal-power crossfade reference');
    expect(dialog.textContent).toContain('equal-power-crossfade-reference / random-access-short-bridge-to-full-profile-only / rendered:user-random-seek-or-skip:crossfade-rendered / accepted / sample 48kHz / fade 5 frames/0.104 ms / gain equal-power / mid 0.707107/0.707107 / power error 0 / residual measured-crossfade-difference 0.207107/0.095781 / peak 1/1/1 / reasons random access short bridge requires equal power crossfade | full profile ready | equal power gain law reference | hard switch residual measured / rejected-boundary:gapless-boundary:rejected / reject intent not user random seek or skip / sample 48kHz / fade 5 frames/0.104 ms / gain not-applicable / mid n/a / power error 0 / residual not-applicable / peak 1/1/0 / reasons only user random seek or skip can use short bridge crossfade | gapless boundary waits for full profile | equal power crossfade reference only');
    expect(dialog.textContent).toContain('UZUME continuity reference');
    expect(dialog.textContent).toContain('predictive-cache / normal-playlist-boundary->wait-for-full-profile / callback:read-committed-output-only / wait:cpu-or-gpu-full-profile / short bridge blocked:intent requires full quality profile / rollback:none');
    expect(dialog.textContent).toContain('UZUME pre-roll reference');
    expect(dialog.textContent).toContain('deadline-safe / required 10240 frames / slack 13760 frames / render-ahead cache-warming 2400/9600 / ring 1024 frames / same-pipeline-no-reset / same pipeline / commit waits full profile');
    expect(dialog.textContent).toContain('UZUME callback ring reference');
    expect(dialog.textContent).toContain('stable/safe / depth 2560 frames / 5 blocks / block 512 frames / missing 0 frames / read-committed-output-only / no GPU wait / short bridge blocked:cpu only ring does not enable short bridge');
    expect(dialog.textContent).toContain('UZUME render-ahead cache reference');
    expect(dialog.textContent).toContain('miss->callback-keeps-prior-committed-output / key next-head:reference:0 / cache 0 bytes/384000 bytes / retained none / evictions 0 / read-committed-output-only / no GPU wait');
    expect(dialog.textContent).toContain('UZUME underrun fallback reference');
    expect(dialog.textContent).toContain('prior-committed-fallback / source prior-committed / marginal / rollback:controlled-fallback / fallback injected / no GPU wait / short bridge blocked:underrun protection does not enable short bridge');
    expect(dialog.textContent).toContain('UZUME headroom reference');
    expect(dialog.textContent).toContain('Headroom -6.0 dB / gain-reference / active');
    expect(dialog.textContent).toContain('UZUME safety meter');
    expect(dialog.textContent).toContain('near-limit / clipping risk / stage telemetry separate from limiter');
    expect(dialog.textContent).toContain('UZUME limiter reference');
    expect(dialog.textContent).toContain('sample-domain safety limiter / standby / GPU limiter planned');

    const visualState = readSignalPathVisualState(dialog);
    expect(visualState.tone).toBe('warning');
    expect(visualState.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'UZUME reference compiler', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'Reference assignment', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME artifact manifest reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME reference path plan', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME reference bit-perfect', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME backend support reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME output device policy reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME latency budget reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME readiness contract reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME generation cache key reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME realtime budget summary reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME PCM ingress guard reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME gain staging reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME PEQ/IIR reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME channel scope reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME stereo procedural reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME per-ear EQ placement reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME block boundary reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME flush/drain reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME gapless SRC reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME FIR gapless reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME urgent controls reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME equal-power crossfade reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME SRC reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME SRC rollback reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME SRC budget reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME SRC artifact reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME SRC validation reference', tone: 'good', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME SRC output risk reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME SRC phase/apodizing reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME DSD family reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME convolution reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME response resample reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME convolution duplicate guard', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME convolution serial null reference', tone: 'muted', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME PCM output quantization reference', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME continuity reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME pre-roll reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME callback ring reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME render-ahead cache reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME underrun fallback reference', tone: 'process', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME safety meter', tone: 'warning', variant: 'process' }),
        expect.objectContaining({ title: 'UZUME limiter reference', tone: 'warning', variant: 'process' }),
      ]),
    );
    expect(visualState.nodes.filter((node) => node.tone === 'danger')).toEqual([]);

    cleanup();

    status.uzumeReferencePlan!.artifactPlan.dsdFamilyPath = 'not-applicable';
    render(
      <>
        <AudioSignalPathControl isOpen={true} status={status} track={track} onClick={vi.fn()} />
        <AudioSignalPathPopover isOpen={true} status={status} track={track} onClose={vi.fn()} />
      </>,
    );

    let artifactManifestDialog = screen.getByRole('dialog', { name: '信号路径' });
    expect(artifactManifestDialog.textContent).toContain('deterministic 37/38 / planned none / not-applicable dsd-family-path');
    let artifactManifestVisualState = readSignalPathVisualState(artifactManifestDialog);
    expect(artifactManifestVisualState.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'UZUME artifact manifest reference', tone: 'process', variant: 'process' }),
      ]),
    );

    cleanup();

    status.uzumeReferencePlan!.artifactPlan.aliasRejection = 'planned';
    render(
      <>
        <AudioSignalPathControl isOpen={true} status={status} track={track} onClick={vi.fn()} />
        <AudioSignalPathPopover isOpen={true} status={status} track={track} onClose={vi.fn()} />
      </>,
    );

    artifactManifestDialog = screen.getByRole('dialog', { name: '信号路径' });
    expect(artifactManifestDialog.textContent).toContain('deterministic 36/38 / planned alias-rejection / not-applicable dsd-family-path');
    artifactManifestVisualState = readSignalPathVisualState(artifactManifestDialog);
    expect(artifactManifestVisualState.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'UZUME artifact manifest reference', tone: 'warning', variant: 'process' }),
      ]),
    );
  });

  it('shows the source and output rates when playback is resampled', () => {
    const track = makeTrack(35, { title: 'Resampled Signal Track', codec: 'flac', sampleRate: 96000, bitDepth: 24 });
    const status = {
      ...audioStatus(track),
      decoderOutputSampleRate: 48000,
      requestedOutputSampleRate: 48000,
      actualDeviceSampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      resampling: true,
    };

    render(
      <>
        <AudioSignalPathControl isOpen={true} status={status} track={track} onClick={vi.fn()} />
        <AudioSignalPathPopover isOpen={true} status={status} track={track} onClose={vi.fn()} />
      </>,
    );

    const dialog = screen.getByRole('dialog', { name: '信号路径' });
    expect(dialog.textContent).toContain('信号路径: 重采样');
    expect(dialog.textContent).toContain('重采样');
    expect(dialog.textContent).toContain('96kHz -> 48kHz');
  });

  it('shows ECHO SRC as upsampling in the signal path', () => {
    const track = makeTrack(36, { title: 'Upsampled Signal Track', codec: 'flac', sampleRate: 44100, bitDepth: 16 });
    const status = {
      ...audioStatus(track),
      decoderOutputSampleRate: 352800,
      requestedOutputSampleRate: 352800,
      actualDeviceSampleRate: 352800,
      resampling: true,
      dspActive: true,
      echoSrcMode: 'family8x' as const,
      echoSrcQualityProfile: 'transparent' as const,
      echoSrcTargetSampleRate: 352800,
      echoSrcActive: true,
      resamplerEngine: 'soxr' as const,
      resamplerFallbackActive: false,
    };

    render(
      <>
        <AudioSignalPathControl isOpen={true} status={status} track={track} onClick={vi.fn()} />
        <AudioSignalPathPopover isOpen={true} status={status} track={track} onClose={vi.fn()} />
      </>,
    );

    const dialog = screen.getByRole('dialog', { name: '信号路径' });
    expect(dialog.textContent).toContain('ECHO/SOXR SRC (compat)');
    expect(dialog.textContent).toContain('44.1kHz -> 352.8kHz / SOXR Transparent');
    expect(dialog.textContent).not.toContain('96kHz -> 48kHz');
  });

  it('routes global play/pause to the active DLNA Connect session instead of local playback', async () => {
    const track = makeTrack(32, { title: 'Matrix Shortcut Track' });
    const playingConnectStatus = dlnaConnectStatus(track, 'playing');
    const pausedConnectStatus = dlnaConnectStatus(track, 'paused');
    const connectPause = vi.fn().mockResolvedValue(pausedConnectStatus);
    const localPause = vi.fn();
    const globalShortcutHandlers: Array<(action: GlobalShortcutAction) => void> = [];

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 8000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: localPause,
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(playingConnectStatus),
        play: vi.fn(),
        pause: connectPause,
        stop: vi.fn(),
        seek: vi.fn(),
        onStatus: vi.fn(() => vi.fn()),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        onStatus: vi.fn(() => vi.fn()),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
        onGlobalShortcutCommand: vi.fn((handler) => {
          globalShortcutHandlers[0] = handler as typeof globalShortcutHandlers[number];
          return () => {
            globalShortcutHandlers.length = 0;
          };
        }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Matrix Shortcut Track');
    await waitFor(() => expect(globalShortcutHandlers[0]).toBeTruthy());
    globalShortcutHandlers[0]?.('playPause');

    await waitFor(() => expect(connectPause).toHaveBeenCalledTimes(1));
    expect(localPause).not.toHaveBeenCalled();
  });

  it('opens the lyrics page when the artwork button is clicked', async () => {
    const track = makeTrack(3, {
      title: 'Cover Click Track',
      artist: 'Cover Click Artist',
      coverId: 'cover-click',
      coverThumb: 'echo-cover://thumb/cover-click',
    });
    const onNavigateLyrics = vi.fn();
    const onNavigateNowPlaying = vi.fn();

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 12000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({
          smtcEnabled: true,
          downloadsFeatureUnlocked: true,
          streamingDownloadActionsEnabled: true,
        }),
      },
    } as unknown as Window['echo'];
    window.addEventListener('app:navigate:lyrics', onNavigateLyrics);
    window.addEventListener('app:navigate:now-playing', onNavigateNowPlaying);

    try {
      render(
        <PlaybackQueueProvider>
          <PlayerBar />
        </PlaybackQueueProvider>,
      );

      await screen.findByText('Cover Click Track');
      fireEvent.click(screen.getByRole('button', { name: '打开歌词' }));

      expect(onNavigateLyrics).toHaveBeenCalledTimes(1);
      expect((onNavigateLyrics.mock.calls[0][0] as CustomEvent).detail).toEqual({ mode: 'lyrics' });
      expect(window.sessionStorage.getItem('echo:lyrics:view-mode')).toBe('lyrics');
      expect(onNavigateNowPlaying).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'MV' }));

      expect(onNavigateLyrics).toHaveBeenCalledTimes(2);
      expect((onNavigateLyrics.mock.calls[1][0] as CustomEvent).detail).toEqual({ mode: 'mv' });
      expect(window.sessionStorage.getItem('echo:lyrics:view-mode')).toBe('mv');
      expect(onNavigateNowPlaying).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('app:navigate:lyrics', onNavigateLyrics);
      window.removeEventListener('app:navigate:now-playing', onNavigateNowPlaying);
    }
  });

  it('shows a short audiohost timeout message in the footer', async () => {
    const track = makeTrack(12);
    const rawError =
      'echo-audio-host timeout_waiting_for_ready; host="echo-audio-host.exe"; args="-sr 44100 -ch 2"; mode="shared"; elapsedMs=15000; stderrTail="[echo-audio-host] createDevice is still waiting"';

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'error',
          currentTrackId: track.id,
          positionMs: 0,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(track),
          state: 'error',
          error: rawError,
        }),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlayerBar />
      </PlaybackQueueProvider>,
    );

    expect(await screen.findByText('音频输出启动超时，可能是驱动初始化太慢、设备被占用，或采样率/缓冲设置被拒绝。')).toBeTruthy();
    expect(screen.queryByText(/timeout_waiting_for_ready/)).toBeNull();
  });

  it('hydrates restored playback from the library so cover art survives restart', async () => {
    const restoredTrack = makeTrack(9, {
      title: 'Restored Track',
      artist: 'Restored Artist',
      coverId: 'cover-restored',
      coverThumb: 'echo-cover://thumb/cover-restored',
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'paused',
          currentTrackId: restoredTrack.id,
          positionMs: 138000,
          durationMs: restoredTrack.duration * 1000,
          filePath: restoredTrack.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(restoredTrack),
          state: 'paused',
        }),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(restoredTrack),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [restoredTrack.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <PlaybackQueueProvider>
        <PlayerBar />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Restored Track');
    expect(screen.getByText('Restored Artist')).toBeTruthy();
    expect(container.querySelector('.player-cover img')?.getAttribute('src')).toBe('echo-cover://original/cover-restored');
  });

  it('shows cover art for a track started outside the SongsPage loaded queue', async () => {
    const albumTrack = makeTrack(7, {
      title: 'Album Detail Track',
      artist: 'Album Detail Artist',
      coverThumb: 'echo-cover://album/cover-7',
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: null,
          positionMs: 0,
          durationMs: albumTrack.duration * 1000,
          filePath: albumTrack.path,
        }),
        playLocalFile: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: albumTrack.id,
          positionMs: 0,
          durationMs: albumTrack.duration * 1000,
          filePath: albumTrack.path,
        }),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(albumTrack),
          currentTrackId: null,
        }),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
      app: {
        getVersion: vi.fn(),
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <PlaybackQueueProvider>
        <ExternalPlaySeed track={albumTrack} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Album Detail Track');
    expect(screen.getByText('Album Detail Artist')).toBeTruthy();
    expect(container.querySelector('.player-cover img')?.getAttribute('src')).toBe('echo-cover://original/cover-7');
    expect(screen.queryByText(/\.flac$/i)).toBeNull();
    expect(screen.queryByText('Local file')).toBeNull();
  });

  it('keeps the newly queued next track visible when audio status still reports the previous track', async () => {
    const firstTrack = makeTrack(1);
    const secondTrack = makeTrack(2);
    let playbackTrack = firstTrack;

    window.echo = {
      playback: {
        getStatus: vi.fn().mockImplementation(() =>
          Promise.resolve({
            state: 'playing',
            currentTrackId: playbackTrack.id,
            positionMs: 4000,
            durationMs: playbackTrack.duration * 1000,
            filePath: playbackTrack.path,
          }),
        ),
        playLocalFile: vi.fn().mockImplementation(({ filePath, trackId }: { filePath: string; trackId?: string }) => {
          playbackTrack = trackId === secondTrack.id ? secondTrack : firstTrack;

          return Promise.resolve({
            state: 'playing',
            currentTrackId: trackId ?? playbackTrack.id,
            positionMs: 0,
            durationMs: playbackTrack.duration * 1000,
            filePath,
          });
        }),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(firstTrack)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[firstTrack, secondTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(screen.getByText('Song 2')).toBeTruthy());
    expect(screen.queryByText('Song 1')).toBeNull();
  });

  it('keeps the transport in playing view while a track switch is pending', async () => {
    const firstTrack = makeTrack(1);
    const secondTrack = makeTrack(2);
    const audioStatusHandlers: Array<(status: AudioStatus) => void> = [];
    let resolveSecondPlay: (() => void) | null = null;
    const playLocalFile = vi.fn().mockImplementation(({ filePath, trackId }: { filePath: string; trackId?: string }) =>
      new Promise((resolve) => {
        resolveSecondPlay = () =>
          resolve({
            state: 'playing',
            currentTrackId: trackId ?? secondTrack.id,
            positionMs: 0,
            durationMs: secondTrack.duration * 1000,
            filePath,
          });
      }),
    );

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: firstTrack.id,
          positionMs: 4000,
          durationMs: firstTrack.duration * 1000,
          filePath: firstTrack.path,
        }),
        playLocalFile,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(firstTrack)),
        onStatus: vi.fn(subscribeAudioStatusHandlers(audioStatusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getLikedTrackIds: vi.fn().mockResolvedValue({ [firstTrack.id]: false, [secondTrack.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[firstTrack, secondTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByRole('button', { name: 'Pause' });
    act(() => {
      emitAudioStatus(audioStatusHandlers, {
        ...audioStatus(firstTrack),
        positionSeconds: 16,
      });
    });
    await waitFor(() => expect(Number((screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement).value)).toBe(16));

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: secondTrack.id })));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(Number((screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement).value)).toBe(0);

    act(() => {
      emitAudioStatus(audioStatusHandlers, {
        ...audioStatus(secondTrack),
        positionSeconds: 17,
      });
    });

    expect(Number((screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement).value)).toBe(0);

    act(() => {
      emitAudioStatus(audioStatusHandlers, {
        ...audioStatus(firstTrack),
        state: 'paused',
      });
    });

    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(Number((screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement).value)).toBe(0);

    const finishSecondPlay = resolveSecondPlay ?? (() => undefined);
    act(() => {
      finishSecondPlay();
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy());

    act(() => {
      emitAudioStatus(audioStatusHandlers, {
        ...audioStatus(secondTrack),
        positionSeconds: 17,
      });
    });

    expect(Number((screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement).value)).toBe(0);
  });

  it('uses current-track audio status when playback status is stale', async () => {
    const staleTrack = makeTrack(1);
    const currentTrack = makeTrack(2);

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: staleTrack.id,
          positionMs: 0,
          durationMs: staleTrack.duration * 1000,
          filePath: staleTrack.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(currentTrack),
          positionSeconds: 7,
        }),
        onStatus: vi.fn(),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getLikedTrackIds: vi.fn().mockResolvedValue({ [staleTrack.id]: false, [currentTrack.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[currentTrack, staleTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 2');
    const slider = screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.value)).toBeGreaterThanOrEqual(7));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('does not reuse stale previous-track progress for the visible current track', async () => {
    const staleTrack = makeTrack(1);
    const currentTrack = makeTrack(2);

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: staleTrack.id,
          positionMs: 135000,
          durationMs: staleTrack.duration * 1000,
          filePath: staleTrack.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(staleTrack),
          positionSeconds: 135,
        }),
        onStatus: vi.fn(),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getLikedTrackIds: vi.fn().mockResolvedValue({ [staleTrack.id]: false, [currentTrack.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <ManualVisibleTrackSeed initialTrackId={staleTrack.id} tracks={[currentTrack, staleTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    fireEvent.click(screen.getByRole('button', { name: 'Show current track' }));
    await screen.findByText('Song 2');
    expect(screen.queryByText('Song 1')).toBeNull();
    const slider = screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.value)).toBe(0));
  });

  it('keeps volume and playback speed popovers mutually exclusive', async () => {
    const track = makeTrack(1);

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Volume' }).parentElement!);
    expect(screen.getByText('100%')).toBeTruthy();

    fireEvent.mouseEnter(screen.getByRole('button', { name: /播放速度|Playback speed/u }).parentElement!);
    expect(screen.getByText('1.00x')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('100%')).toBeNull());

    fireEvent.pointerMove(window, { clientX: 500, clientY: 500 });
    await waitFor(() => expect(screen.queryByText('1.00x')).toBeNull());
  });

  it('handles the space playback shortcut even when the focused target stops keydown bubbling', async () => {
    const track = makeTrack(1);
    const pause = vi.fn().mockResolvedValue({
      state: 'paused',
      currentTrackId: track.id,
      positionMs: 4000,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause,
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[track]} />
        <div data-testid="space-blocker" tabIndex={0} onKeyDown={(event) => event.stopPropagation()} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    fireEvent.keyDown(screen.getByTestId('space-blocker'), { code: 'Space', key: ' ' });

    await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
  });

  it('does not hijack space typed into editable fields', async () => {
    const track = makeTrack(1);
    const pause = vi.fn();

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause,
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[track]} />
        <input aria-label="Search text" />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    fireEvent.keyDown(screen.getByLabelText('Search text'), { code: 'Space', key: ' ' });

    expect(pause).not.toHaveBeenCalled();
  });

  it('does not hijack space when a focused search field receives a window-level key event', async () => {
    const track = makeTrack(1);
    const pause = vi.fn();

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause,
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[track]} />
        <input aria-label="Search text" type="search" />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    const searchInput = screen.getByLabelText('Search text');
    searchInput.focus();
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });

    expect(document.activeElement).toBe(searchInput);
    expect(pause).not.toHaveBeenCalled();
  });

  it('does not handle local shortcuts while an IME composition key is active', async () => {
    const track = makeTrack(1);
    const pause = vi.fn();

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause,
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Space', key: 'Process' });
    Object.defineProperty(event, 'isComposing', { value: true });
    Object.defineProperty(event, 'keyCode', { value: 229 });
    window.dispatchEvent(event);

    expect(pause).not.toHaveBeenCalled();
  });

  it('uses the main process playback state before toggling from the space shortcut', async () => {
    const track = makeTrack(1);
    const play = vi.fn();
    const pause = vi.fn().mockResolvedValue({
      state: 'paused',
      currentTrackId: track.id,
      positionMs: 4000,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({
        state: 'paused',
        currentTrackId: track.id,
        positionMs: 4000,
        durationMs: track.duration * 1000,
        filePath: track.path,
      })
      .mockResolvedValue({
        state: 'playing',
        currentTrackId: track.id,
        positionMs: 4000,
        durationMs: track.duration * 1000,
        filePath: track.path,
      });

    window.echo = {
      playback: {
        getStatus,
        playLocalFile: vi.fn(),
        play,
        pause,
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(track),
          state: 'paused',
        }),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });

    await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
    expect(play).not.toHaveBeenCalled();
  });

  it('does not let a stale paused refresh freeze the UI after resuming playback', async () => {
    const track = makeTrack(1);
    const playbackGetStatus = vi.fn().mockResolvedValue({
      state: 'paused',
      currentTrackId: track.id,
      positionMs: 10000,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });
    const audioGetStatus = vi
      .fn()
      .mockResolvedValueOnce({
        ...audioStatus(track),
        state: 'paused',
        positionSeconds: 10,
      })
      .mockResolvedValue({
        ...audioStatus(track),
        state: 'paused',
        positionSeconds: 10,
      });
    const play = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: track.id,
      positionMs: 10000,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });

    window.echo = {
      playback: {
        getStatus: playbackGetStatus,
        playLocalFile: vi.fn(),
        play,
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: audioGetStatus,
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByRole('button', { name: 'Play' });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(audioGetStatus.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('resumes a visibly paused streaming track instead of reopening the media item', async () => {
    const track = makeTrack(41, {
      id: 'streaming:netease:resume-visible',
      path: 'https://cdn.example.test/resume-visible.flac',
      mediaType: 'streaming',
      provider: 'netease',
      providerTrackId: 'resume-visible',
      stableKey: 'streaming:netease:resume-visible',
      title: 'Paused Stream',
    });
    const play = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: track.id,
      positionMs: 12000,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });
    const playMediaItem = vi.fn();
    const playLocalFile = vi.fn();

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'idle',
          currentTrackId: null,
          positionMs: 0,
          durationMs: 0,
          filePath: null,
        }),
        playLocalFile,
        playMediaItem,
        play,
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(track),
          state: 'paused',
          positionSeconds: 12,
        }),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByRole('button', { name: 'Play' });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(playMediaItem).not.toHaveBeenCalled();
    expect(playLocalFile).not.toHaveBeenCalled();
  });

  it('keeps polling local BPM analysis after playback is paused', async () => {
    const track = makeTrack(1, {
      bpm: null,
      analysisStatus: 'none',
    });
    const analyzedTrack = {
      ...track,
      bpm: 128,
      bpmConfidence: 0.86,
      beatOffsetMs: 12,
      analysisStatus: 'complete' as const,
      analysisUpdatedAt: '2026-05-14T12:00:00.000Z',
    };
    const startBpmAnalysis = vi.fn().mockResolvedValue({
      id: 'bpm-job-1',
      status: 'running',
      totalTracks: 1,
      processedTracks: 0,
      updatedTracks: 0,
      errorCount: 0,
      currentTrackTitle: track.title,
      startedAt: '2026-05-14T11:59:58.000Z',
      finishedAt: null,
      errors: [],
    });
    const getBpmAnalysisStatus = vi.fn().mockResolvedValue({
      id: 'bpm-job-1',
      status: 'completed',
      totalTracks: 1,
      processedTracks: 1,
      updatedTracks: 1,
      errorCount: 0,
      currentTrackTitle: null,
      startedAt: '2026-05-14T11:59:58.000Z',
      finishedAt: '2026-05-14T12:00:00.000Z',
      errors: [],
    });
    const pause = vi.fn().mockResolvedValue({
      state: 'paused',
      currentTrackId: track.id,
      positionMs: 4000,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause,
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(analyzedTrack),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
        startBpmAnalysis,
        getBpmAnalysisStatus,
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    await waitFor(() => expect(startBpmAnalysis).toHaveBeenCalledWith({ trackIds: [track.id] }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByText('128 BPM')).toBeTruthy(), { timeout: 3000 });
    expect(getBpmAnalysisStatus).toHaveBeenCalledWith('bpm-job-1');
  }, 10000);

  it('pauses from the visible playing state even when the bridge status is stale', async () => {
    const track = makeTrack(1);
    const play = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: track.id,
      positionMs: 4000,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });
    const pause = vi.fn().mockResolvedValue({
      state: 'paused',
      currentTrackId: track.id,
      positionMs: 4000,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'paused',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play,
        pause,
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByRole('button', { name: 'Pause' });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
    expect(play).not.toHaveBeenCalled();
  });

  it('starts playback BPM analysis for embedded BPM that has not been verified by ECHO', async () => {
    const track = makeTrack(1, {
      bpm: 126,
      bpmConfidence: 1,
      beatOffsetMs: null,
      analysisStatus: 'complete',
      fieldSources: { bpm: 'embedded' },
    });
    const analyzedTrack = {
      ...track,
      bpm: 128,
      bpmConfidence: 0.86,
      beatOffsetMs: 12,
      analysisStatus: 'complete' as const,
      analysisUpdatedAt: '2026-05-14T12:00:00.000Z',
      fieldSources: { bpm: 'audio_analysis', beatOffsetMs: 'audio_analysis' },
    };
    const startBpmAnalysis = vi.fn().mockResolvedValue({
      id: 'bpm-job-embedded',
      status: 'running',
      totalTracks: 1,
      processedTracks: 0,
      updatedTracks: 0,
      errorCount: 0,
      currentTrackTitle: track.title,
      startedAt: '2026-05-14T11:59:58.000Z',
      finishedAt: null,
      errors: [],
    });
    const getBpmAnalysisStatus = vi.fn().mockResolvedValue({
      id: 'bpm-job-embedded',
      status: 'completed',
      totalTracks: 1,
      processedTracks: 1,
      updatedTracks: 1,
      errorCount: 0,
      currentTrackTitle: null,
      startedAt: '2026-05-14T11:59:58.000Z',
      finishedAt: '2026-05-14T12:00:00.000Z',
      errors: [],
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(analyzedTrack),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
        startBpmAnalysis,
        getBpmAnalysisStatus,
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await waitFor(() => expect(startBpmAnalysis).toHaveBeenCalledWith({ trackIds: [track.id] }));
    await waitFor(() => expect(screen.getByText('128 BPM')).toBeTruthy(), { timeout: 3000 });
  }, 10000);

  it('starts playback BPM analysis when the setting is enabled during the current song', async () => {
    const track = makeTrack(1, {
      bpm: null,
      analysisStatus: 'none',
    });
    const analyzedTrack = {
      ...track,
      bpm: 128,
      bpmConfidence: 0.86,
      beatOffsetMs: 12,
      analysisStatus: 'complete' as const,
      analysisUpdatedAt: '2026-05-14T12:00:00.000Z',
      fieldSources: { bpm: 'audio_analysis', beatOffsetMs: 'audio_analysis' },
    };
    const startBpmAnalysis = vi.fn().mockResolvedValue({
      id: 'bpm-job-enabled-late',
      status: 'running',
      totalTracks: 1,
      processedTracks: 0,
      updatedTracks: 0,
      errorCount: 0,
      currentTrackTitle: track.title,
      startedAt: '2026-05-14T11:59:58.000Z',
      finishedAt: null,
      errors: [],
    });
    const getBpmAnalysisStatus = vi.fn().mockResolvedValue({
      id: 'bpm-job-enabled-late',
      status: 'completed',
      totalTracks: 1,
      processedTracks: 1,
      updatedTracks: 1,
      errorCount: 0,
      currentTrackTitle: null,
      startedAt: '2026-05-14T11:59:58.000Z',
      finishedAt: '2026-05-14T12:00:00.000Z',
      errors: [],
    });
    let appSettings = { smtcEnabled: true, audioAnalysisEnabled: false };

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(analyzedTrack),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
        startBpmAnalysis,
        getBpmAnalysisStatus,
      },
      app: {
        getSettings: vi.fn(() => Promise.resolve(appSettings)),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    await waitFor(() => expect(window.echo?.app.getSettings).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(startBpmAnalysis).not.toHaveBeenCalled();

    appSettings = { smtcEnabled: true, audioAnalysisEnabled: true };
    act(() => {
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: { audioAnalysisEnabled: true } }));
    });

    await waitFor(() => expect(startBpmAnalysis).toHaveBeenCalledWith({ trackIds: [track.id] }));
    await waitFor(() => expect(screen.getByText('128 BPM')).toBeTruthy(), { timeout: 3000 });
  }, 10000);

  it('does not start streaming BPM analysis for SoundCloud playback', async () => {
    const track = makeTrack(7, {
      id: 'streaming:soundcloud:track-7',
      path: 'streaming:soundcloud:track-7',
      mediaType: 'streaming',
      provider: 'soundcloud',
      providerTrackId: 'https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A7',
      stableKey: 'streaming:soundcloud:track-7',
      streamingQuality: 'standard',
      codec: null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
      bpm: null,
      bpmConfidence: null,
      analysisStatus: 'none',
    });
    const analyzeBpm = vi.fn().mockResolvedValue({
      trackId: track.id,
      bpm: 128,
      confidence: 0.9,
      beatOffsetMs: 0,
      status: 'complete',
      error: null,
      updatedAt: '2026-05-17T00:00:00.000Z',
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        playMediaItem: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      streaming: {
        analyzeBpm,
      },
      library: {
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true, audioAnalysisEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 7');
    await waitFor(() => expect(window.echo?.app.getSettings).toHaveBeenCalled());
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(analyzeBpm).not.toHaveBeenCalled();
  });

  it('routes SMTC transport and seek commands through the playback queue', async () => {
    const firstTrack = makeTrack(1);
    const secondTrack = makeTrack(2);
    const smtcHandlers: Array<(command: SmtcCommand) => void> = [];
    const playLocalFile = vi.fn().mockImplementation(({ filePath, trackId }: { filePath: string; trackId?: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: trackId ?? null,
        positionMs: 0,
        durationMs: (trackId === secondTrack.id ? secondTrack.duration : firstTrack.duration) * 1000,
        filePath,
      }),
    );
    const pause = vi.fn().mockResolvedValue({
      state: 'paused',
      currentTrackId: secondTrack.id,
      positionMs: 4000,
      durationMs: secondTrack.duration * 1000,
      filePath: secondTrack.path,
    });
    const seek = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: firstTrack.id,
      positionMs: 42000,
      durationMs: firstTrack.duration * 1000,
      filePath: firstTrack.path,
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: firstTrack.id,
          positionMs: 4000,
          durationMs: firstTrack.duration * 1000,
          filePath: firstTrack.path,
        }),
        playLocalFile,
        play: vi.fn(),
        pause,
        stop: vi.fn(),
        seek,
        openLocalAudioFile: vi.fn(),
      },
      smtc: {
        onCommand: vi.fn((handler) => {
          smtcHandlers[0] = handler;
          return () => {
            smtcHandlers.length = 0;
          };
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(firstTrack)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[firstTrack, secondTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    expect(smtcHandlers[0]).toBeTruthy();
    smtcHandlers[0]?.('next');

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: secondTrack.id })));
    smtcHandlers[0]?.('previous');

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: firstTrack.id })));
    smtcHandlers[0]?.('pause');

    await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
    smtcHandlers[0]?.({ type: 'seek', positionSeconds: 42 });

    await waitFor(() => expect(seek).toHaveBeenCalledWith(42));
  });

  it('routes global shortcut commands through the playback queue', async () => {
    const firstTrack = makeTrack(1);
    const secondTrack = makeTrack(2);
    const globalShortcutHandlers: Array<(command: GlobalShortcutAction) => void> = [];
    const playLocalFile = vi.fn().mockImplementation(({ filePath, trackId }: { filePath: string; trackId?: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: trackId ?? null,
        positionMs: 0,
        durationMs: (trackId === secondTrack.id ? secondTrack.duration : firstTrack.duration) * 1000,
        filePath,
      }),
    );
    const pause = vi.fn().mockResolvedValue({
      state: 'paused',
      currentTrackId: secondTrack.id,
      positionMs: 4000,
      durationMs: secondTrack.duration * 1000,
      filePath: secondTrack.path,
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'paused',
          currentTrackId: firstTrack.id,
          positionMs: 4000,
          durationMs: firstTrack.duration * 1000,
          filePath: firstTrack.path,
        }),
        playLocalFile,
        play: vi.fn(),
        pause,
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
        onGlobalShortcutCommand: vi.fn((handler) => {
          globalShortcutHandlers[0] = handler as typeof globalShortcutHandlers[number];
          return () => {
            globalShortcutHandlers.length = 0;
          };
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(firstTrack)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[firstTrack, secondTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    expect(globalShortcutHandlers[0]).toBeTruthy();
    globalShortcutHandlers[0]?.('nextTrack');

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: secondTrack.id })));
    globalShortcutHandlers[0]?.('previousTrack');

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: firstTrack.id })));
    globalShortcutHandlers[0]?.('playPause');

    await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
  });

  it('routes focused-window shortcuts through the playback queue while ECHO is focused', async () => {
    const firstTrack = makeTrack(1);
    const secondTrack = makeTrack(2);
    const playLocalFile = vi.fn().mockImplementation(({ filePath, trackId }: { filePath: string; trackId?: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: trackId ?? null,
        positionMs: 0,
        durationMs: (trackId === secondTrack.id ? secondTrack.duration : firstTrack.duration) * 1000,
        filePath,
      }),
    );
    const localShortcuts = {
      ...createDefaultLocalShortcuts(),
      nextTrack: { enabled: true, accelerator: 'D' },
    };

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'paused',
          currentTrackId: firstTrack.id,
          positionMs: 4000,
          durationMs: firstTrack.duration * 1000,
          filePath: firstTrack.path,
        }),
        playLocalFile,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true, localShortcuts }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(firstTrack)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[firstTrack, secondTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    await waitFor(() => expect(window.echo?.app?.getSettings).toHaveBeenCalled());
    fireEvent.keyDown(window, { code: 'KeyD', key: 'd' });

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: secondTrack.id })));
  });

  it('does not crash when saved shortcut settings are missing newer actions', async () => {
    const track = makeTrack(1);
    const localShortcuts = createDefaultLocalShortcuts();
    const globalShortcuts = createDefaultGlobalShortcuts();
    delete (localShortcuts as Partial<typeof localShortcuts>).toggleDesktopLyricsLock;
    delete (globalShortcuts as Partial<typeof globalShortcuts>).toggleDesktopLyricsLock;

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'paused',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true, localShortcuts, globalShortcuts }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    await waitFor(() => expect(window.echo?.app?.getSettings).toHaveBeenCalled());
  });

  it('handles boss key and playback speed global shortcut commands', async () => {
    const track = makeTrack(1);
    const globalShortcutHandlers: Array<(command: GlobalShortcutAction) => void> = [];
    const setOutput = vi.fn().mockResolvedValue(audioStatus(track));
    const setSettings = vi.fn().mockResolvedValue({ smtcEnabled: true, playbackSpeed: 1.1, playbackSpeedMode: 'nightcore' });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
        setSettings,
        onGlobalShortcutCommand: vi.fn((handler) => {
          globalShortcutHandlers[0] = handler as typeof globalShortcutHandlers[number];
          return () => {
            globalShortcutHandlers.length = 0;
          };
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(track),
          playbackRate: 1,
          playbackSpeedMode: 'nightcore',
        }),
        listDevices: vi.fn(),
        setOutput,
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    globalShortcutHandlers[0]?.('speedUp');
    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ playbackRate: 1.1, playbackSpeedMode: 'nightcore' }));
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ playbackSpeed: 1.1, playbackSpeedMode: 'nightcore' }));

    setOutput.mockClear();
    globalShortcutHandlers[0]?.('bossKey');
    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ volume: 0 }));
  });

  it('opens settings drawers from global shortcut commands', async () => {
    const track = makeTrack(1);
    const globalShortcutHandlers: Array<(command: GlobalShortcutAction) => void> = [];
    const openAudioSettings = vi.fn();
    const openMvSettings = vi.fn();
    const openLyricsSettings = vi.fn();
    const setDesktopLyricsLocked = vi.fn().mockResolvedValue({ locked: true });
    window.addEventListener('app:open-audio-settings', openAudioSettings);
    window.addEventListener('app:open-mv-settings', openMvSettings);
    window.addEventListener('app:open-lyrics-settings', openLyricsSettings);

    window.echo = {
      playback: {
        getStatus: vi.fn(),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
        onGlobalShortcutCommand: vi.fn((handler) => {
          globalShortcutHandlers[0] = handler as typeof globalShortcutHandlers[number];
          return () => {
            globalShortcutHandlers.length = 0;
          };
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      desktopLyrics: {
        getState: vi.fn().mockResolvedValue({ locked: false }),
        setLocked: setDesktopLyricsLocked,
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    globalShortcutHandlers[0]?.('openAudioSettings');
    globalShortcutHandlers[0]?.('openMvSettings');
    globalShortcutHandlers[0]?.('openLyricsSettings');
    globalShortcutHandlers[0]?.('toggleDesktopLyricsLock');

    expect(openAudioSettings).toHaveBeenCalledTimes(1);
    expect(openMvSettings).toHaveBeenCalledTimes(1);
    expect(openLyricsSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(setDesktopLyricsLocked).toHaveBeenCalledWith(true));
    window.removeEventListener('app:open-audio-settings', openAudioSettings);
    window.removeEventListener('app:open-mv-settings', openMvSettings);
    window.removeEventListener('app:open-lyrics-settings', openLyricsSettings);
  });

  it('publishes current playback metadata and actions through the browser media session', async () => {
    const track = makeTrack(1, {
      title: 'SMTC Song',
      artist: 'SMTC Artist',
      album: 'SMTC Album',
      coverId: 'cover-1',
      coverThumb: 'echo-cover://thumb/cover-1',
    });
    const actionHandlers = new Map<string, MediaSessionActionHandler | null>();
    const mediaSession = {
      metadata: null as MediaMetadata | null,
      playbackState: 'none' as MediaSessionPlaybackState,
      setActionHandler: vi.fn((action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
        actionHandlers.set(action, handler);
      }),
      setPositionState: vi.fn(),
    };
    const play = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: track.id,
      positionMs: 4000,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });

    class TestMediaMetadata {
      title: string;
      artist: string;
      album: string;
      artwork: MediaImage[];

      constructor(init: MediaMetadataInit) {
        this.title = init.title ?? '';
        this.artist = init.artist ?? '';
        this.album = init.album ?? '';
        this.artwork = init.artwork ?? [];
      }
    }

    vi.stubGlobal('MediaMetadata', TestMediaMetadata);
    Object.defineProperty(window.navigator, 'mediaSession', {
      configurable: true,
      value: mediaSession,
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'paused',
          currentTrackId: track.id,
          positionMs: 4000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play,
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(track),
          state: 'paused',
        }),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      app: {
        getVersion: vi.fn(),
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('SMTC Song');
    await waitFor(() => expect(mediaSession.metadata?.title).toBe('SMTC Song'));

    expect(mediaSession.metadata?.artist).toBe('SMTC Artist');
    expect(mediaSession.metadata?.album).toBe('SMTC Album');
    expect(container.querySelector('.player-cover img')?.getAttribute('src')).toBe('echo-cover://original/cover-1');
    expect(mediaSession.metadata?.artwork).toHaveLength(0);
    expect(mediaSession.playbackState).toBe('paused');
    expect(mediaSession.setPositionState).toHaveBeenCalledWith({
      duration: track.duration,
      playbackRate: 1,
      position: 4,
    });

    actionHandlers.get('play')?.({ action: 'play' });
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it('keeps streaming progress moving when status briefly stays at zero', async () => {
    const track = makeTrack(1, {
      id: 'streaming:qqmusic:song-1',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:song-1',
      provider: 'qqmusic',
      providerTrackId: 'song-1',
      codec: null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
    });
    const zeroAudioStatus = { ...audioStatus(track), positionSeconds: 0 };

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 0,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(zeroAudioStatus),
        onStatus: vi.fn(),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    expect(screen.getByText('QQ')).toBeTruthy();
    const slider = screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement;
    expect(Number(slider.value)).toBe(0);
    await waitFor(() => expect(Number(slider.value)).toBeGreaterThan(0.1), { timeout: 1000 });
  });

  it('shows a loading animation for streaming tracks while playback is preparing', async () => {
    const track = makeTrack(1, {
      id: 'streaming:qqmusic:song-1',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:song-1',
      provider: 'qqmusic',
      providerTrackId: 'song-1',
      codec: null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
    });
    const loadingAudioStatus = { ...audioStatus(track), state: 'loading' as const, positionSeconds: 0 };

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'loading',
          currentTrackId: track.id,
          positionMs: 0,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(loadingAudioStatus),
        onStatus: vi.fn(),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('正在加载流媒体');
    expect(container.querySelector('.player-bar')?.getAttribute('data-network-loading')).toBe('true');
    expect(container.querySelector('.progress-track')?.getAttribute('data-loading')).toBe('true');
  });

  it('keeps progress from jumping backward on a brief same-track stale audio status', async () => {
    const track = makeTrack(1);
    const statusHandlers: Array<(status: AudioStatus) => void> = [];

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 12000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({ ...audioStatus(track), positionSeconds: 12 }),
        onStatus: vi.fn(subscribeAudioStatusHandlers(statusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    const slider = screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.value)).toBeGreaterThanOrEqual(12));

    act(() => {
      emitAudioStatus(statusHandlers, { ...audioStatus(track), positionSeconds: 10.6 });
    });

    expect(Number(slider.value)).toBeGreaterThanOrEqual(12);
  });

  it('does not retain same-track audio status after a shared seek snapshot clears audio telemetry', async () => {
    const track = makeTrack(1, { duration: 240 });
    const initialAudioStatus = {
      ...audioStatus(track),
      durationSeconds: track.duration,
      positionSeconds: 181,
    };

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 181000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(initialAudioStatus),
        onStatus: vi.fn(),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    const slider = screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.value)).toBeGreaterThanOrEqual(181));

    act(() => {
      beginPlaybackSeekSnapshot({
        state: 'playing',
        currentTrackId: track.id,
        positionMs: 60000,
        durationMs: track.duration * 1000,
        filePath: track.path,
      });
    });

    await waitFor(() => expect(Number(slider.value)).toBeLessThan(65));
    expect(Number(slider.value)).toBeGreaterThanOrEqual(60);
  });

  it('keeps high-speed progress from jumping backward on a brief same-track stale audio status', async () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const track = makeTrack(1);
    const statusHandlers: Array<(status: AudioStatus) => void> = [];
    const initialStatus = { ...audioStatus(track), playbackRate: 2, positionSeconds: 12 };

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 12000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(initialStatus),
        onStatus: vi.fn(subscribeAudioStatusHandlers(statusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    const slider = screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.value)).toBeGreaterThanOrEqual(12));

    performanceNow.mockReturnValue(900);
    act(() => {
      emitAudioStatus(statusHandlers, { ...audioStatus(track), playbackRate: 2, positionSeconds: 12.2 });
    });

    expect(Number(slider.value)).toBeGreaterThanOrEqual(13.7);
  });

  it('keeps high-speed progress from jumping far forward on a brief same-track stale audio status', async () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const track = makeTrack(1);
    const statusHandlers: Array<(status: AudioStatus) => void> = [];
    const initialStatus = { ...audioStatus(track), playbackRate: 1.5, positionSeconds: 12 };

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 12000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(initialStatus),
        onStatus: vi.fn(subscribeAudioStatusHandlers(statusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    const slider = screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.value)).toBeGreaterThanOrEqual(12));

    performanceNow.mockReturnValue(500);
    act(() => {
      emitAudioStatus(statusHandlers, { ...audioStatus(track), playbackRate: 1.5, positionSeconds: 60 });
    });

    expect(Number(slider.value)).toBeLessThan(14);
    expect(Number(slider.value)).toBeGreaterThanOrEqual(12.7);
  });

  it('keeps slow-speed progress from jumping far forward on a brief same-track stale audio status', async () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const track = makeTrack(1);
    const statusHandlers: Array<(status: AudioStatus) => void> = [];
    const initialStatus = { ...audioStatus(track), playbackRate: 0.5, positionSeconds: 12 };

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 12000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(initialStatus),
        onStatus: vi.fn(subscribeAudioStatusHandlers(statusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    const slider = screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.value)).toBeGreaterThanOrEqual(12));

    performanceNow.mockReturnValue(500);
    act(() => {
      emitAudioStatus(statusHandlers, { ...audioStatus(track), playbackRate: 0.5, positionSeconds: 60 });
    });

    expect(Number(slider.value)).toBeLessThan(13);
    expect(Number(slider.value)).toBeGreaterThanOrEqual(12.2);
  });

  it('rebases progress smoothly when playback speed changes with a stale source position', async () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const track = makeTrack(1);
    const statusHandlers: Array<(status: AudioStatus) => void> = [];

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 12000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({ ...audioStatus(track), playbackRate: 1, positionSeconds: 12 }),
        onStatus: vi.fn(subscribeAudioStatusHandlers(statusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    const slider = screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.value)).toBeGreaterThanOrEqual(12));

    performanceNow.mockReturnValue(2000);
    act(() => {
      emitAudioStatus(statusHandlers, { ...audioStatus(track), playbackRate: 2, positionSeconds: 12.4 });
    });

    expect(Number(slider.value)).toBeGreaterThanOrEqual(13.9);
  });

  it('broadcasts the requested seek target when streaming seek returns stale status', async () => {
    const track = makeTrack(1, {
      id: 'streaming:qqmusic:song-1',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:song-1',
      provider: 'qqmusic',
      providerTrackId: 'song-1',
    });
    const seek = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: track.id,
      positionMs: 0,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });
    const seekedHandler = vi.fn();

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 0,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek,
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({ ...audioStatus(track), positionSeconds: 0 }),
        onStatus: vi.fn(),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    window.addEventListener('playback:seeked', seekedHandler);

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    const slider = screen.getByRole('slider', { name: 'Seek position' });
    fireEvent.change(slider, { target: { value: '21' } });
    fireEvent.pointerUp(slider);

    await waitFor(() => expect(seek).toHaveBeenCalledWith(21));
    await waitFor(() => expect(seekedHandler).toHaveBeenCalled());
    expect((seekedHandler.mock.calls[0][0] as CustomEvent).detail.positionSeconds).toBe(21);

    window.removeEventListener('playback:seeked', seekedHandler);
  });

  it('keeps the progress slider enabled for AirPlay receiver playback', async () => {
    const track = makeTrack(71, {
      id: 'airplay-receiver:source-1:air-song',
      path: 'airplay-receiver:source-1',
      mediaType: 'remote',
      isTemporary: true,
      title: 'AirPlay Seek Track',
      artist: 'Air Artist',
      duration: 180,
      fieldSources: { title: 'airplay', artist: 'airplay' },
    });
    const seek = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: track.id,
      positionMs: 42_000,
      durationMs: track.duration * 1000,
      filePath: track.path,
    });
    const status = airPlayReceiverStatus(track, 'playing');

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 12_000,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek,
        openLocalAudioFile: vi.fn(),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(null),
        getAirPlayReceiverStatus: vi.fn().mockResolvedValue(status),
        onAirPlayReceiverStatus: vi.fn(() => vi.fn()),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(track),
          currentFilePath: track.path,
          currentTrackId: track.id,
          positionSeconds: 12,
        }),
        onStatus: vi.fn(() => vi.fn()),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({}),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(track),
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
    } as unknown as Window['echo'];

    render(
      <I18nProvider>
        <PlaybackQueueProvider>
          <QueueSeed tracks={[track]} />
        </PlaybackQueueProvider>
      </I18nProvider>,
    );

    await screen.findByText('AirPlay Seek Track');
    const slider = screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement;
    await waitFor(() => expect(slider.disabled).toBe(false));

    fireEvent.change(slider, { target: { value: '42' } });
    fireEvent.pointerUp(slider);

    await waitFor(() => expect(seek).toHaveBeenCalledWith(42));
  });

  it('keeps the visible progress anchored when status hovers just behind a seek target', async () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const track = makeTrack(1);
    const statusHandlers: Array<(status: AudioStatus) => void> = [];
    let playbackPositionMs = 12_000;
    let audioPositionSeconds = 12;
    const seek = vi.fn().mockImplementation(async () => {
      playbackPositionMs = 59_800;
      audioPositionSeconds = 59.8;
      return {
        state: 'playing',
        currentTrackId: track.id,
        positionMs: playbackPositionMs,
        durationMs: track.duration * 1000,
        filePath: track.path,
      };
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockImplementation(() => Promise.resolve({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: playbackPositionMs,
          durationMs: track.duration * 1000,
          filePath: track.path,
        })),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek,
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockImplementation(() => Promise.resolve({
          ...audioStatus(track),
          positionSeconds: audioPositionSeconds,
        })),
        onStatus: vi.fn(subscribeAudioStatusHandlers(statusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({}),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    const slider = screen.getByRole('slider', { name: 'Seek position' }) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.value)).toBeGreaterThanOrEqual(12));

    fireEvent.change(slider, { target: { value: '60' } });
    fireEvent.pointerUp(slider);

    await waitFor(() => expect(seek).toHaveBeenCalledWith(60));
    await waitFor(() => expect(Number(slider.value)).toBeGreaterThanOrEqual(60));
    expect(screen.queryByText('0:59')).toBeNull();

    performanceNow.mockReturnValue(600);
    act(() => {
      emitAudioStatus(statusHandlers, { ...audioStatus(track), positionSeconds: 59.85 });
    });

    expect(Number(slider.value)).toBeGreaterThanOrEqual(60);
    expect(screen.queryByText('0:59')).toBeNull();
  });

  it('starts a download job from the player for the current streaming track', async () => {
    const track = makeTrack(21, {
      id: 'streaming:qqmusic:song-mid',
      mediaType: 'streaming',
      path: 'streaming:qqmusic:song-mid',
      provider: 'qqmusic',
      providerTrackId: 'song-mid',
      stableKey: 'streaming:qqmusic:song-mid',
      streamingQuality: 'lossless',
      title: 'Streaming Download Track',
      artist: 'Stream Artist',
      album: 'Stream Album',
      albumArtist: 'Stream Album Artist',
      coverThumb: 'https://img.example/cover.jpg',
    });
    const resolvePlayback = vi.fn().mockResolvedValue({
      provider: 'qqmusic',
      providerTrackId: 'song-mid',
      url: 'https://isure.stream.qqmusic.qq.com/song.flac',
      expiresAt: null,
      mimeType: 'audio/flac',
      bitrate: 900000,
      sampleRate: null,
      bitDepth: 16,
      codec: 'flac',
      headers: { Referer: 'https://y.qq.com/' },
      requiresProxy: false,
      supportsRange: true,
      downloadAuthorizationToken: 'download-token-1',
    });
    const createUrlJob = vi.fn().mockResolvedValue({
      id: 'download-job-1',
      sourceUrl: 'https://isure.stream.qqmusic.qq.com/song.flac',
      provider: 'unknown',
      audioStrategy: 'best_available',
      status: 'queued',
      title: 'Streaming Download Track',
      durationSeconds: null,
      thumbnailUrl: 'https://img.example/cover.jpg',
      webpageUrl: 'https://y.qq.com/n/ryqq/songDetail/song-mid',
      outputPath: null,
      downloadedBytes: null,
      totalBytes: null,
      speedBytesPerSecond: null,
      etaSeconds: null,
      importedTrackId: null,
      progress: 0,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: track.id,
          positionMs: 0,
          durationMs: track.duration * 1000,
          filePath: track.path,
        }),
        playLocalFile: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(track)),
        onStatus: vi.fn(),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      streaming: {
        resolvePlayback,
      },
      downloads: {
        createUrlJob,
        getJobs: vi.fn().mockResolvedValue([]),
        onJobsUpdated: vi.fn(() => () => undefined),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({
          smtcEnabled: true,
          downloadsFeatureUnlocked: true,
          streamingDownloadActionsEnabled: true,
        }),
      },
      library: {
        getLikedTrackIds: vi.fn().mockResolvedValue({ [track.id]: false }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[track]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Streaming Download Track');
    fireEvent.click(await screen.findByRole('button', { name: '下载当前流媒体' }));

    await waitFor(() =>
      expect(resolvePlayback).toHaveBeenCalledWith({
        provider: 'qqmusic',
        providerTrackId: 'song-mid',
        quality: 'lossless',
      }),
    );
    await waitFor(() =>
      expect(createUrlJob).toHaveBeenCalledWith(
        'https://isure.stream.qqmusic.qq.com/song.flac',
        expect.objectContaining({
          title: 'Streaming Download Track',
          artist: 'Stream Artist',
          album: 'Stream Album',
          albumArtist: 'Stream Album Artist',
          coverUrl: 'https://img.example/cover.jpg',
          webpageUrl: 'https://y.qq.com/n/ryqq/songDetail/song-mid',
          directAudio: true,
          directAudioMimeType: 'audio/flac',
          directAudioExtension: 'flac',
          streamingProvider: 'qqmusic',
          streamingProviderTrackId: 'song-mid',
          streamingStableKey: 'streaming:qqmusic:song-mid',
          downloadAuthorizationToken: 'download-token-1',
        }),
      ),
    );
    expect(await screen.findByText('正在下载：Streaming Download Track')).toBeTruthy();
  });

  it('auto-plays the next queued track when audio status pushes ended', async () => {
    const firstTrack = makeTrack(1);
    const secondTrack = makeTrack(2);
    const thirdTrack = makeTrack(3);
    const statusHandlers: Array<(status: AudioStatus) => void> = [];
    const playLocalFile = vi.fn().mockImplementation(({ filePath, trackId }: { filePath: string; trackId?: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: trackId ?? null,
        positionMs: 0,
        durationMs: (trackId === thirdTrack.id ? thirdTrack.duration : trackId === secondTrack.id ? secondTrack.duration : firstTrack.duration) * 1000,
        filePath,
      }),
    );

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: firstTrack.id,
          positionMs: 4000,
          durationMs: firstTrack.duration * 1000,
          filePath: firstTrack.path,
        }),
        playLocalFile,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(firstTrack)),
        onStatus: vi.fn(subscribeAudioStatusHandlers(statusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[firstTrack, secondTrack, thirdTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    expect(statusHandlers).not.toHaveLength(0);
    emitAudioStatus(statusHandlers, {
      ...audioStatus(firstTrack),
      state: 'ended',
      positionSeconds: firstTrack.duration,
    });

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: secondTrack.id })));
    await screen.findByText('Song 2');

    emitAudioStatus(statusHandlers, {
      ...audioStatus(firstTrack),
      state: 'ended',
      positionSeconds: firstTrack.duration,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(playLocalFile).not.toHaveBeenCalledWith(expect.objectContaining({ trackId: thirdTrack.id }));

    emitAudioStatus(statusHandlers, audioStatus(secondTrack));
    expect(screen.getByText('Song 2')).toBeTruthy();
  });

  it('retries ended auto-advance when the first next-track playback attempt fails', async () => {
    const firstTrack = makeTrack(1);
    const secondTrack = makeTrack(2);
    const statusHandlers: Array<(status: AudioStatus) => void> = [];
    const playLocalFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary playback bridge stall'))
      .mockResolvedValue({
        state: 'playing',
        currentTrackId: secondTrack.id,
        positionMs: 0,
        durationMs: secondTrack.duration * 1000,
        filePath: secondTrack.path,
      });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: firstTrack.id,
          positionMs: 4000,
          durationMs: firstTrack.duration * 1000,
          filePath: firstTrack.path,
        }),
        playLocalFile,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(firstTrack)),
        onStatus: vi.fn(subscribeAudioStatusHandlers(statusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[firstTrack, secondTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    emitAudioStatus(statusHandlers, {
      ...audioStatus(firstTrack),
      state: 'ended',
      positionSeconds: firstTrack.duration,
    });

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => window.setTimeout(resolve, 1300));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(2));
    expect(playLocalFile).toHaveBeenLastCalledWith(expect.objectContaining({ trackId: secondTrack.id }));
    await screen.findByText('Song 2');
  });

  it('auto-plays the next queued track when playback stays playing at the track tail', async () => {
    const firstTrack = makeTrack(1);
    const secondTrack = makeTrack(2);
    const statusHandlers: Array<(status: AudioStatus) => void> = [];
    const playLocalFile = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: secondTrack.id,
      positionMs: 0,
      durationMs: secondTrack.duration * 1000,
      filePath: secondTrack.path,
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: firstTrack.id,
          positionMs: firstTrack.duration * 1000,
          durationMs: firstTrack.duration * 1000,
          filePath: firstTrack.path,
        }),
        playLocalFile,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(firstTrack)),
        onStatus: vi.fn(subscribeAudioStatusHandlers(statusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[firstTrack, secondTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    emitAudioStatus(statusHandlers, {
      ...audioStatus(firstTrack),
      state: 'playing',
      positionSeconds: firstTrack.duration,
    });

    await new Promise((resolve) => window.setTimeout(resolve, 1700));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: secondTrack.id })));
    await screen.findByText('Song 2');
  });

  it('auto-plays the next queued track when Spotify polling reaches the track tail', async () => {
    const spotifyTrack = makeTrack(1, {
      id: 'streaming:spotify:abc123',
      path: 'streaming:spotify:abc123',
      stableKey: 'streaming:spotify:abc123',
      mediaType: 'streaming',
      provider: 'spotify',
      providerTrackId: 'abc123',
      codec: 'spotify',
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
    });
    const secondTrack = makeTrack(2);
    const playLocalFile = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: secondTrack.id,
      positionMs: 0,
      durationMs: secondTrack.duration * 1000,
      filePath: secondTrack.path,
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: spotifyTrack.id,
          positionMs: 0,
          durationMs: spotifyTrack.duration * 1000,
          filePath: spotifyTrack.path,
        }),
        playLocalFile,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      spotify: {
        getAccessToken: vi.fn(),
        getDevices: vi.fn().mockResolvedValue([]),
        getPlaybackState: vi
          .fn()
          .mockResolvedValueOnce({
            isPlaying: true,
            progressMs: 1_000,
            itemUri: 'spotify:track:abc123',
            deviceId: 'spotify-device',
            deviceName: 'Spotify Desktop',
          })
          .mockResolvedValue({
            isPlaying: false,
            progressMs: spotifyTrack.duration * 1000,
            itemUri: 'spotify:track:abc123',
            deviceId: 'spotify-device',
            deviceName: 'Spotify Desktop',
          }),
        ensureConnectDevice: vi.fn(),
        startPlayback: vi.fn(),
        transferPlayback: vi.fn(),
        pause: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn(),
        seek: vi.fn(),
        setVolume: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(spotifyTrack),
          state: 'idle',
          currentTrackId: null,
          currentFilePath: null,
          positionSeconds: 0,
        }),
        onStatus: vi.fn(),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getLikedTrackIds: vi.fn().mockResolvedValue({ [spotifyTrack.id]: false, [secondTrack.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[spotifyTrack, secondTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: secondTrack.id })), {
      timeout: 3000,
    });
    await screen.findByText('Song 2');
  });

  it('auto-plays the next queued track when Spotify ended status uses the stable streaming key', async () => {
    const spotifyStableKey = 'streaming:spotify:abc123';
    const spotifyTrack = makeTrack(1, {
      id: 'spotify-row-1',
      path: spotifyStableKey,
      stableKey: spotifyStableKey,
      mediaType: 'streaming',
      provider: 'spotify',
      providerTrackId: 'abc123',
      codec: 'spotify',
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
    });
    const secondTrack = makeTrack(2);
    const playLocalFile = vi.fn().mockImplementation(({ filePath, trackId }: { filePath: string; trackId?: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: trackId ?? null,
        positionMs: 0,
        durationMs: secondTrack.duration * 1000,
        filePath,
      }),
    );

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: spotifyStableKey,
          positionMs: 4000,
          durationMs: spotifyTrack.duration * 1000,
          filePath: spotifyTrack.path,
        }),
        playLocalFile,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          ...audioStatus(spotifyTrack),
          currentTrackId: spotifyStableKey,
          currentFilePath: spotifyTrack.path,
        }),
        onStatus: vi.fn(),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      library: {
        getLikedTrackIds: vi.fn().mockResolvedValue({ [spotifyTrack.id]: false, [secondTrack.id]: false }),
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ smtcEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[spotifyTrack, secondTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    act(() => {
      setPlaybackStatusSnapshot({
        playbackStatus: {
          state: 'ended',
          currentTrackId: spotifyStableKey,
          positionMs: spotifyTrack.duration * 1000,
          durationMs: spotifyTrack.duration * 1000,
          filePath: spotifyTrack.path,
        },
        audioStatus: {
          ...audioStatus(spotifyTrack),
          state: 'ended',
          currentTrackId: spotifyStableKey,
          currentFilePath: spotifyTrack.path,
          positionSeconds: spotifyTrack.duration,
        },
        playbackVisualIntent: null,
        error: null,
      });
    });

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: secondTrack.id })));
    await screen.findByText('Song 2');
  });

  it('does not auto-play next when an ended status arrives before the track tail', async () => {
    const firstTrack = makeTrack(1);
    const secondTrack = makeTrack(2);
    const statusHandlers: Array<(status: AudioStatus) => void> = [];
    const playLocalFile = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: secondTrack.id,
      positionMs: 0,
      durationMs: secondTrack.duration * 1000,
      filePath: secondTrack.path,
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'paused',
          currentTrackId: firstTrack.id,
          positionMs: 4000,
          durationMs: firstTrack.duration * 1000,
          filePath: firstTrack.path,
        }),
        playLocalFile,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(firstTrack)),
        onStatus: vi.fn(subscribeAudioStatusHandlers(statusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[firstTrack, secondTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    expect(statusHandlers).not.toHaveLength(0);
    emitAudioStatus(statusHandlers, {
      ...audioStatus(firstTrack),
      state: 'ended',
      positionSeconds: 42,
    });

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(playLocalFile).not.toHaveBeenCalled();
    expect(screen.getByText('Song 1')).toBeTruthy();
  });

  it('still auto-plays the next queued track when the audio ends after the MV', async () => {
    const firstTrack = makeTrack(1);
    const secondTrack = makeTrack(2);
    const statusHandlers: Array<(status: AudioStatus) => void> = [];
    const playLocalFile = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: secondTrack.id,
      positionMs: 0,
      durationMs: secondTrack.duration * 1000,
      filePath: secondTrack.path,
    });

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: firstTrack.id,
          positionMs: 4000,
          durationMs: firstTrack.duration * 1000,
          filePath: firstTrack.path,
        }),
        playLocalFile,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        openLocalAudioFile: vi.fn(),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus(firstTrack)),
        onStatus: vi.fn(subscribeAudioStatusHandlers(statusHandlers)),
        listDevices: vi.fn(),
        setOutput: vi.fn(),
      },
      eq: {
        getState: vi.fn().mockResolvedValue(eqState()),
        setEnabled: vi.fn().mockResolvedValue(eqState()),
        setBandGain: vi.fn().mockResolvedValue(eqState()),
        setPreamp: vi.fn().mockResolvedValue(eqState()),
        setPreset: vi.fn().mockResolvedValue(eqState()),
        reset: vi.fn().mockResolvedValue(eqState()),
        listPresets: vi.fn().mockResolvedValue([]),
        savePreset: vi.fn(),
        deletePreset: vi.fn().mockResolvedValue([]),
      },
      library: {
        getTracks: vi.fn(),
        getAlbums: vi.fn(),
        getAlbumTracks: vi.fn(),
        getSummary: vi.fn(),
        chooseFolder: vi.fn(),
        addFolder: vi.fn(),
        getFolders: vi.fn(),
        removeFolder: vi.fn(),
        scanFolder: vi.fn(),
        getScanStatus: vi.fn(),
        cancelScan: vi.fn(),
        getDiagnostics: vi.fn(),
      },
      app: {
        getVersion: vi.fn(),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <PlaybackQueueProvider>
        <QueueSeed tracks={[firstTrack, secondTrack]} />
      </PlaybackQueueProvider>,
    );

    await screen.findByText('Song 1');
    window.dispatchEvent(new CustomEvent('mv:ended-before-audio', { detail: { trackId: firstTrack.id } }));

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(playLocalFile).not.toHaveBeenCalled();

    emitAudioStatus(statusHandlers, {
      ...audioStatus(firstTrack),
      state: 'ended',
      positionSeconds: firstTrack.duration,
    });

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: secondTrack.id })));
    await screen.findByText('Song 2');
  });
});
