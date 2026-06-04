// @vitest-environment jsdom
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AudioStatus } from '../../../shared/types/audio';
import type { ConnectSessionStatus } from '../../../shared/types/connect';
import type { EqState } from '../../../shared/types/eq';
import { createDefaultGlobalShortcuts, createDefaultLocalShortcuts, type GlobalShortcutAction } from '../../../shared/types/globalShortcuts';
import type { LibraryTrack } from '../../../shared/types/library';
import type { SmtcCommand } from '../../../shared/types/smtc';
import { PlaybackQueueProvider, usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { setPlaybackStatusSnapshot } from '../../stores/playbackStatusStore';
import { AudioSignalPathControl, AudioSignalPathPopover } from './AudioSignalPathPopover';
import { PlaybackCommandController } from './PlaybackCommandController';
import { PlayerBar } from './PlayerBar';

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

    expect(screen.getByRole('button', { name: '打开音频链路：已强化，FLAC / 96k / 24b' }).textContent).toBe('');
    const dialog = screen.getByRole('dialog', { name: '信号路径' });
    expect(dialog.textContent).toContain('信号路径: 已强化');
    expect(dialog.textContent).toContain('参数化 EQ');
    expect(dialog.textContent).toContain('5 个频段');
    expect(dialog.textContent).toContain('比特位深转换');
    expect(dialog.textContent).toContain('64bit Float 至 32bit');
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
