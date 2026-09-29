// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AudioStatus } from '../../shared/types/audio';
import type { LibraryTrack } from '../../shared/types/library';
import type { PersistedPlaybackSessionV1, PlaybackStatus } from '../../shared/types/playback';
import { MiniPlayerApp } from './MiniPlayerApp';

const makeTrack = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\Mini Song.flac',
  title: 'Mini Song',
  artist: 'Mini Artist',
  album: 'Mini Album',
  albumArtist: 'Mini Album Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: 'echo-cover://thumb/mini-cover',
  fieldSources: {},
  ...overrides,
});

const makeAudioStatus = (track: LibraryTrack): AudioStatus => ({
  host: 'ready',
  state: 'playing',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: 'wasapi-shared',
  activeOutputBackendImpl: null,
  outputMode: 'shared',
  activeDecodeBackendImpl: null,
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: track.path,
  currentTrackId: track.id,
  currentTrackTitle: track.title,
  currentTrackArtist: track.artist,
  currentTrackAlbum: track.album,
  currentTrackAlbumArtist: track.albumArtist,
  currentTrackCoverUrl: 'echo-cover://thumb/status-cover',
  durationSeconds: track.duration,
  positionSeconds: 42,
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

const makePlaybackStatus = (track: LibraryTrack): PlaybackStatus => ({
  state: 'playing',
  currentTrackId: track.id,
  positionMs: 42_000,
  durationMs: track.duration * 1000,
  filePath: track.path,
});

const makeQueueSession = (track: LibraryTrack, tracks: LibraryTrack[] = [track]): PersistedPlaybackSessionV1 => ({
  version: 1,
  items: tracks.map((item, index) => ({
    queueId: `queue-${index + 1}`,
    track: item,
    source: { type: 'manual', label: 'Test queue' },
    addedAt: '2026-07-12T00:00:00.000Z',
  })),
  currentQueueId: `queue-${Math.max(1, tracks.findIndex((item) => item.id === track.id) + 1)}`,
  currentTrackId: track.id,
  lastPlayedTrack: track,
  history: [],
  mode: {
    isShuffleEnabled: false,
    repeatMode: 'off',
    automixEnabled: false,
    autoFillQueueEnabled: false,
  },
  resume: null,
  updatedAt: '2026-07-12T00:00:00.000Z',
});

const installEchoMock = (
  track: LibraryTrack,
  options: {
    audioStatus?: AudioStatus;
    desktopLyricsAudioStatus?: AudioStatus | null;
    desktopLyricsPlaybackStatus?: PlaybackStatus | null;
    playbackStatus?: PlaybackStatus;
    queueSession?: PersistedPlaybackSessionV1;
    legacyMiniPlayerState?: boolean;
  } = {},
): void => {
  const audioStatus = options.audioStatus ?? makeAudioStatus(track);
  const playbackStatus = options.playbackStatus ?? makePlaybackStatus(track);

  Object.defineProperty(window, 'echo', {
    configurable: true,
    value: {
      app: {
        getSettings: vi.fn().mockResolvedValue({ gaplessPlaybackEnabled: false }),
        setSettings: vi.fn().mockResolvedValue({ gaplessPlaybackEnabled: false }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus),
        onStatus: vi.fn(() => vi.fn()),
        setOutput: vi.fn(async (settings: { volume?: number }) => ({
          ...audioStatus,
          volume: typeof settings.volume === 'number' ? Math.max(0, Math.min(1, settings.volume)) : audioStatus.volume,
        })),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue(playbackStatus),
        getQueueSession: vi.fn().mockResolvedValue(options.queueSession ?? makeQueueSession(track)),
        saveQueueSession: vi.fn().mockResolvedValue(undefined),
        onQueueSessionChanged: vi.fn(() => vi.fn()),
        controlMainWindow: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn().mockResolvedValue({ ...playbackStatus, state: 'paused' }),
        play: vi.fn().mockResolvedValue(playbackStatus),
        playLocalFile: vi.fn().mockResolvedValue(playbackStatus),
        seek: vi.fn().mockResolvedValue(playbackStatus),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(null),
        onStatus: vi.fn(() => vi.fn()),
      },
      desktopLyrics: {
        getLastAudioStatus: vi.fn().mockResolvedValue(options.desktopLyricsAudioStatus ?? null),
        getLastPlaybackStatus: vi.fn().mockResolvedValue(options.desktopLyricsPlaybackStatus ?? null),
        onAudioStatus: vi.fn(() => undefined),
        onPlaybackStatus: vi.fn(() => undefined),
      },
      miniPlayer: {
        getState: vi.fn().mockResolvedValue({
          visible: true,
          locked: false,
          queueOpen: false,
          bounds: null,
          settings: {
            miniPlayerEnabled: true,
            miniPlayerLocked: false,
            miniPlayerAutoHideMainWindow: false,
            miniPlayerBounds: null,
          },
        }),
        onStateChanged: vi.fn(() => undefined),
        hide: vi.fn(),
        show: vi.fn(),
        setLocked: vi.fn(),
        setQueueOpen: vi.fn(async (open: boolean) => ({
          visible: true,
          locked: false,
          ...(options.legacyMiniPlayerState ? {} : { queueOpen: open }),
          bounds: null,
          settings: {
            miniPlayerEnabled: true,
            miniPlayerLocked: false,
            miniPlayerAutoHideMainWindow: false,
            miniPlayerBounds: null,
          },
        })),
        resetBounds: vi.fn(),
      },
    } as unknown as Window['echo'],
  });
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MiniPlayerApp', () => {
  it('renders lightweight track metadata, artwork, and progress', async () => {
    const track = makeTrack();
    installEchoMock(track);

    render(<MiniPlayerApp />);

    expect(await screen.findByText('Mini Song')).toBeTruthy();
    expect(screen.getByText('Mini Artist')).toBeTruthy();
    expect(document.querySelector('.mini-player-cover img')?.getAttribute('src')).toBe('echo-cover://thumb/mini-cover');
    await waitFor(() => expect((screen.getByRole('slider', { name: '播放进度' }) as HTMLInputElement).value).toBe('42'));
  });

  it('commits a seek when the visible progress slider is dragged', async () => {
    const track = makeTrack();
    installEchoMock(track);

    render(<MiniPlayerApp />);

    const slider = await screen.findByRole('slider', { name: '播放进度' }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '90' } });
    fireEvent.pointerUp(slider);

    await waitFor(() => expect(window.echo?.playback?.controlMainWindow).toHaveBeenCalledWith({ type: 'seek', positionSeconds: 90 }));
  });

  it('commits keyboard seek changes through the main-window controller', async () => {
    const track = makeTrack();
    installEchoMock(track);
    render(<MiniPlayerApp />);

    const slider = await screen.findByRole('slider', { name: '播放进度' }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '60' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });

    await waitFor(() => expect(window.echo?.playback?.controlMainWindow).toHaveBeenCalledWith({ type: 'seek', positionSeconds: 60 }));
  });

  it('commits the latest seek after an earlier seek is still pending', async () => {
    const track = makeTrack();
    installEchoMock(track);
    let releaseFirstSeek!: () => void;
    const firstSeek = new Promise<void>((resolve) => {
      releaseFirstSeek = resolve;
    });
    vi.mocked(window.echo!.playback.controlMainWindow!).mockImplementationOnce(() => firstSeek);
    render(<MiniPlayerApp />);

    await screen.findByText('Mini Song');
    const slider = document.querySelector('.mini-player-progress-row input') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '30' } });
    fireEvent.pointerUp(slider);
    fireEvent.change(slider, { target: { value: '90' } });
    fireEvent.pointerUp(slider);

    expect(window.echo?.playback?.controlMainWindow).toHaveBeenCalledTimes(1);
    releaseFirstSeek();
    await waitFor(() => expect(window.echo?.playback?.controlMainWindow).toHaveBeenLastCalledWith({ type: 'seek', positionSeconds: 90 }));
    expect(window.echo?.playback?.controlMainWindow).toHaveBeenCalledTimes(2);
  });

  it('does not submit the same seek again when the slider blurs during commit', async () => {
    const track = makeTrack();
    installEchoMock(track);
    let releaseSeek!: () => void;
    vi.mocked(window.echo!.playback.controlMainWindow!).mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseSeek = resolve;
    }));
    render(<MiniPlayerApp />);

    const slider = await screen.findByRole('slider', { name: '播放进度' }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '75' } });
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);

    expect(window.echo?.playback?.controlMainWindow).toHaveBeenCalledTimes(1);
    releaseSeek();
  });

  it('keeps mini progress anchored after a backward seek returns stale status', async () => {
    const track = makeTrack();
    installEchoMock(track);

    render(<MiniPlayerApp />);

    const slider = await screen.findByRole('slider', { name: '播放进度' }) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.value)).toBe(42));

    fireEvent.change(slider, { target: { value: '0' } });
    fireEvent.pointerUp(slider);

    await waitFor(() => expect(window.echo?.playback?.controlMainWindow).toHaveBeenCalledWith({ type: 'seek', positionSeconds: 0 }));
    await waitFor(() => expect(Number(slider.value)).toBeGreaterThanOrEqual(42));
  });

  it('commits volume changes from the mini player slider', async () => {
    const track = makeTrack();
    installEchoMock(track, {
      audioStatus: {
        ...makeAudioStatus(track),
        volume: 0.42,
      },
    });

    render(<MiniPlayerApp />);

    expect(await screen.findByText('Mini Song')).toBeTruthy();
    fireEvent.click(document.querySelector('.mini-player-volume-toggle') as HTMLButtonElement);
    const volumeSlider = document.querySelector('.mini-player-volume-row input') as HTMLInputElement;
    expect(volumeSlider.value).toBe('0.42');

    fireEvent.change(volumeSlider, { target: { value: '0.35' } });
    fireEvent.pointerUp(volumeSlider);

    await waitFor(() => expect(window.echo?.playback?.controlMainWindow).toHaveBeenCalledWith({ type: 'setVolume', volume: 0.35 }));
  });

  it('restores the reported volume when a volume command fails', async () => {
    const track = makeTrack();
    installEchoMock(track, {
      audioStatus: {
        ...makeAudioStatus(track),
        volume: 0.42,
      },
    });
    vi.mocked(window.echo!.playback.controlMainWindow!).mockRejectedValueOnce(new Error('volume unavailable'));
    render(<MiniPlayerApp />);

    expect(await screen.findByText('Mini Song')).toBeTruthy();
    fireEvent.click(document.querySelector('.mini-player-volume-toggle') as HTMLButtonElement);
    const volumeSlider = document.querySelector('.mini-player-volume-row input') as HTMLInputElement;
    await waitFor(() => expect(volumeSlider.value).toBe('0.42'));

    fireEvent.change(volumeSlider, { target: { value: '0.25' } });
    fireEvent.pointerUp(volumeSlider);

    await waitFor(() => expect(screen.getByText('volume unavailable')).toBeTruthy());
    expect(volumeSlider.value).toBe('0.42');
  });

  it('opens the mini queue and plays a selected queue item', async () => {
    const firstTrack = makeTrack();
    const secondTrack = makeTrack({
      id: 'track-2',
      path: 'D:\\Music\\Queue Pick.flac',
      title: 'Queue Pick',
      artist: 'Queue Artist',
    });
    installEchoMock(firstTrack, { queueSession: makeQueueSession(firstTrack, [firstTrack, secondTrack]) });

    render(<MiniPlayerApp />);

    fireEvent.click(await screen.findByRole('button', { name: '打开播放队列' }));

    expect(window.echo?.miniPlayer?.setQueueOpen).toHaveBeenCalledWith(true);
    expect(window.echo?.miniPlayer?.setQueueOpen).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('group', { name: '播放队列' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Queue Pick/ }));

    await waitFor(() => expect(window.echo?.playback?.controlMainWindow).toHaveBeenCalledWith({ type: 'playQueueItem', queueId: 'queue-2' }));
  });

  it('submits only one next command while the previous transport request is pending', async () => {
    const firstTrack = makeTrack();
    const secondTrack = makeTrack({
      id: 'track-2',
      path: 'D:\\Music\\Second Track.flac',
      title: 'Second Track',
    });
    let releaseNext!: () => void;
    installEchoMock(firstTrack, { queueSession: makeQueueSession(firstTrack, [firstTrack, secondTrack]) });
    vi.mocked(window.echo!.playback.controlMainWindow!).mockImplementation(() => new Promise<void>((resolve) => {
      releaseNext = resolve;
    }));
    render(<MiniPlayerApp />);

    const nextButton = await screen.findByRole('button', { name: '下一首' });
    fireEvent.click(nextButton);
    fireEvent.click(nextButton);

    expect(window.echo?.playback?.controlMainWindow).toHaveBeenCalledTimes(1);
    expect((nextButton as HTMLButtonElement).disabled).toBe(true);

    releaseNext();
    await waitFor(() => expect((nextButton as HTMLButtonElement).disabled).toBe(false));
  });

  it('uses the live track identity for queue highlight and transport availability', async () => {
    const staleTrack = makeTrack({ id: 'track-1', title: 'Stale Queue Track' });
    const liveTrack = makeTrack({ id: 'track-2', path: 'D:\\Music\\Live Queue Track.flac', title: 'Live Queue Track' });
    installEchoMock(liveTrack, { queueSession: makeQueueSession(staleTrack, [staleTrack, liveTrack]) });
    render(<MiniPlayerApp />);

    fireEvent.click(await screen.findByRole('button', { name: '打开播放队列' }));

    const staleButton = screen.getByRole('button', { name: /Stale Queue Track/ });
    const liveButton = screen.getByRole('button', { name: /Live Queue Track/ });
    expect(staleButton.getAttribute('aria-current')).toBeNull();
    expect(liveButton.getAttribute('aria-current')).toBe('true');
    expect((screen.getByRole('button', { name: '上一首' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '下一首' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the persisted queue occurrence active when the same track appears more than once', async () => {
    const track = makeTrack({ title: 'Repeated Track' });
    installEchoMock(track, {
      queueSession: {
        ...makeQueueSession(track, [track, track]),
        currentQueueId: 'queue-2',
      },
    });
    render(<MiniPlayerApp />);

    fireEvent.click(await screen.findByRole('button', { name: '打开播放队列' }));
    const repeatedItems = screen.getAllByRole('button', { name: /Repeated Track/ });

    expect(repeatedItems[0]?.getAttribute('aria-current')).toBeNull();
    expect(repeatedItems[1]?.getAttribute('aria-current')).toBe('true');
    expect((screen.getByRole('button', { name: '上一首' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '下一首' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not restore an initial queue snapshot after a live clear event', async () => {
    const track = makeTrack();
    const staleQueue = makeQueueSession(track);
    installEchoMock(track);
    let resolveInitialQueue!: (session: PersistedPlaybackSessionV1 | null) => void;
    vi.mocked(window.echo!.playback.getQueueSession).mockReturnValue(new Promise((resolve) => {
      resolveInitialQueue = resolve;
    }));
    let publishQueueSession!: (session: PersistedPlaybackSessionV1 | null) => void;
    vi.mocked(window.echo!.playback.onQueueSessionChanged!).mockImplementation((handler) => {
      publishQueueSession = handler;
      return vi.fn();
    });
    render(<MiniPlayerApp />);

    await waitFor(() => expect(publishQueueSession).toBeTypeOf('function'));
    act(() => publishQueueSession(null));
    await act(async () => resolveInitialQueue(staleQueue));
    fireEvent.click(screen.getByRole('button', { name: '打开播放队列' }));

    expect((document.querySelector('.mini-player-queue-header span') as HTMLElement).textContent).toBe('0');
  });

  it('keeps the queue visible when a live older main process omits queueOpen from its state', async () => {
    const track = makeTrack();
    installEchoMock(track, { legacyMiniPlayerState: true });

    render(<MiniPlayerApp />);
    fireEvent.click(await screen.findByRole('button', { name: '打开播放队列' }));

    expect(await screen.findByRole('group', { name: '播放队列' })).toBeTruthy();
    expect(window.echo?.miniPlayer?.setQueueOpen).toHaveBeenCalledWith(true);
  });

  it('does not let an initial window snapshot override a live queue-open event', async () => {
    const track = makeTrack();
    installEchoMock(track);
    const closedState = await window.echo!.miniPlayer.getState();
    let resolveInitialState!: (state: typeof closedState) => void;
    vi.mocked(window.echo!.miniPlayer.getState).mockReturnValue(new Promise((resolve) => {
      resolveInitialState = resolve;
    }));
    let publishMiniPlayerState!: (state: typeof closedState) => void;
    vi.mocked(window.echo!.miniPlayer.onStateChanged!).mockImplementation((handler) => {
      publishMiniPlayerState = handler;
      return vi.fn();
    });
    render(<MiniPlayerApp />);

    await waitFor(() => expect(publishMiniPlayerState).toBeTypeOf('function'));
    act(() => publishMiniPlayerState({ ...closedState, queueOpen: true }));
    expect(await screen.findByRole('group', { name: '播放队列' })).toBeTruthy();

    await act(async () => resolveInitialState({ ...closedState, queueOpen: false }));
    expect(screen.getByRole('group', { name: '播放队列' })).toBeTruthy();
  });

  it('disables playback and queue controls when there is no playable identity', async () => {
    const track = makeTrack();
    installEchoMock(track, {
      audioStatus: {
        ...makeAudioStatus(track),
        state: 'idle',
        currentTrackId: null,
        currentFilePath: null,
        currentTrackTitle: null,
        durationSeconds: 0,
        positionSeconds: 0,
      },
      playbackStatus: {
        state: 'idle',
        currentTrackId: null,
        positionMs: 0,
        durationMs: 0,
        filePath: null,
      },
    });
    vi.mocked(window.echo!.playback.getQueueSession).mockResolvedValue(null);
    render(<MiniPlayerApp />);

    await waitFor(() => expect(window.echo?.audio.getStatus).toHaveBeenCalled());
    expect((document.querySelector('.mini-player-icon-button--play') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('.mini-player-queue-toggle') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('.mini-player-copy strong')?.textContent).not.toBe('No local file');
  });

  it('restores the main window when the mini player close button is clicked', async () => {
    const track = makeTrack();
    installEchoMock(track);

    render(<MiniPlayerApp />);

    expect(await screen.findByText('Mini Song')).toBeTruthy();
    fireEvent.click(document.querySelector('.mini-player-close-button') as HTMLButtonElement);

    expect(window.echo?.miniPlayer?.hide).toHaveBeenCalledWith({ restoreMainWindow: true });
  });

  it('scrolls the title only when it is wider than the available title area', async () => {
    const track = makeTrack({ title: 'A deliberately long mini player song title' });
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('mini-player-title-marquee') ? 120 : 0;
    });
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'STRONG' ? 260 : 0;
    });
    installEchoMock(track);

    render(<MiniPlayerApp />);

    const titleViewport = document.querySelector('.mini-player-title-marquee');
    await waitFor(() => expect(titleViewport?.classList.contains('is-overflowing')).toBe(true));
    expect(titleViewport?.querySelectorAll('strong')).toHaveLength(2);
    expect(titleViewport?.querySelector('strong[aria-hidden="true"]')).toBeTruthy();

    clientWidth.mockRestore();
    scrollWidth.mockRestore();
  });

  it('prefers live playback status over stale mini player queue metadata', async () => {
    const queuedTrack = makeTrack({
      id: 'stale-track',
      path: 'D:\\Music\\Episode 33.flac',
      title: 'Episode 33',
      artist: 'She Her Her Hers',
      coverThumb: 'echo-cover://thumb/stale-cover',
    });
    const liveTrack = makeTrack({
      id: 'live-track',
      path: 'D:\\Music\\Promise Song.flac',
      title: '約束になれ僕らの歌',
      artist: '虹ヶ咲学園スクールアイドル同好会',
      coverThumb: null,
    });
    installEchoMock(liveTrack, { queueSession: makeQueueSession(queuedTrack) });

    render(<MiniPlayerApp />);

    expect(await screen.findByText('約束になれ僕らの歌')).toBeTruthy();
    expect(screen.getByText('虹ヶ咲学園スクールアイドル同好会')).toBeTruthy();
    expect(screen.queryByText('Episode 33')).toBeNull();
    expect(document.querySelector('.mini-player-cover img')?.getAttribute('src')).toBe('echo-cover://thumb/status-cover');
  });

  it('ignores stale forwarded system audio status for a different track', async () => {
    const staleTrack = makeTrack({
      id: 'stale-track',
      path: 'D:\\Music\\Old Mini Song.flac',
      title: 'Old Mini Song',
      artist: 'Old Artist',
      coverThumb: 'echo-cover://thumb/old-cover',
    });
    const liveTrack = makeTrack({
      id: 'live-track',
      path: 'D:\\Music\\Actual Mini Song.flac',
      title: 'Actual Mini Song',
      artist: 'Actual Artist',
      coverThumb: null,
    });
    installEchoMock(liveTrack, {
      audioStatus: {
        ...makeAudioStatus(liveTrack),
        outputMode: 'system',
      },
      desktopLyricsAudioStatus: {
        ...makeAudioStatus(staleTrack),
        outputMode: 'system',
      },
    });

    render(<MiniPlayerApp />);

    expect(await screen.findByText('Actual Mini Song')).toBeTruthy();
    expect(screen.getByText('Actual Artist')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Old Mini Song')).toBeNull());
  });

  it('does not let a delayed initial snapshot replace a live playback event', async () => {
    const staleTrack = makeTrack({ id: 'stale-track', path: 'D:\\Music\\Old Snapshot.flac', title: 'Old Snapshot' });
    const liveTrack = makeTrack({ id: 'live-track', path: 'D:\\Music\\Live Event.flac', title: 'Live Event' });
    installEchoMock(liveTrack, {
      audioStatus: {
        ...makeAudioStatus(liveTrack),
        state: 'idle',
        currentTrackId: null,
        currentFilePath: null,
        durationSeconds: 0,
        positionSeconds: 0,
      },
      playbackStatus: {
        state: 'idle',
        currentTrackId: null,
        positionMs: 0,
        durationMs: 0,
        filePath: null,
      },
      queueSession: makeQueueSession(liveTrack, [staleTrack, liveTrack]),
    });
    let resolveInitialSnapshot!: (status: PlaybackStatus) => void;
    vi.mocked(window.echo!.desktopLyrics.getLastPlaybackStatus!).mockReturnValue(new Promise((resolve) => {
      resolveInitialSnapshot = resolve;
    }));
    let publishPlaybackStatus!: (status: PlaybackStatus) => void;
    vi.mocked(window.echo!.desktopLyrics.onPlaybackStatus!).mockImplementation((handler) => {
      publishPlaybackStatus = handler;
      return vi.fn();
    });

    render(<MiniPlayerApp />);
    await waitFor(() => expect(publishPlaybackStatus).toBeTypeOf('function'));
    act(() => publishPlaybackStatus(makePlaybackStatus(liveTrack)));
    expect(await screen.findByText('Live Event')).toBeTruthy();

    await act(async () => resolveInitialSnapshot(makePlaybackStatus(staleTrack)));
    expect(screen.getByText('Live Event')).toBeTruthy();
    expect(screen.queryByText('Old Snapshot')).toBeNull();
  });

  it('expires forwarded playback status even when no more status events arrive', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T00:00:00.000Z'));
    const fallbackTrack = makeTrack({ id: 'fallback-track', path: 'D:\\Music\\Fallback Track.flac', title: 'Fallback Track' });
    const forwardedTrack = makeTrack({ id: 'forwarded-track', path: 'D:\\Music\\Forwarded Track.flac', title: 'Forwarded Track' });
    installEchoMock(fallbackTrack, {
      audioStatus: {
        ...makeAudioStatus(fallbackTrack),
        state: 'idle',
        currentTrackId: null,
        currentFilePath: null,
        durationSeconds: 0,
        positionSeconds: 0,
      },
      playbackStatus: {
        state: 'idle',
        currentTrackId: null,
        positionMs: 0,
        durationMs: 0,
        filePath: null,
      },
      desktopLyricsPlaybackStatus: makePlaybackStatus(forwardedTrack),
      queueSession: makeQueueSession(fallbackTrack),
    });

    render(<MiniPlayerApp />);
    await act(async () => Promise.resolve());
    expect(screen.getByText('Forwarded Track')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(screen.getByText('Fallback Track')).toBeTruthy();
    expect(screen.queryByText('Forwarded Track')).toBeNull();
  });

  it('keeps a live forwarded system status authoritative after 30 seconds without more events', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T00:00:00.000Z'));
    const staleTrack = makeTrack({
      id: 'stale-track',
      path: 'D:\\Music\\Old Mini Song.flac',
      title: 'Old Mini Song',
      artist: 'Old Artist',
    });
    const liveTrack = makeTrack({
      id: 'live-track',
      path: 'D:\\Music\\Current Song.flac',
      title: 'Current Song',
      artist: 'Current Artist',
    });
    installEchoMock(staleTrack, {
      audioStatus: {
        ...makeAudioStatus(staleTrack),
        outputMode: 'system',
        state: 'idle',
      },
      desktopLyricsAudioStatus: null,
      desktopLyricsPlaybackStatus: null,
      queueSession: makeQueueSession(liveTrack, [staleTrack, liveTrack]),
    });
    let publishAudioStatus!: (status: AudioStatus) => void;
    let publishPlaybackStatus!: (status: PlaybackStatus) => void;
    vi.mocked(window.echo!.desktopLyrics.onAudioStatus!).mockImplementation((handler) => {
      publishAudioStatus = handler;
      return vi.fn();
    });
    vi.mocked(window.echo!.desktopLyrics.onPlaybackStatus!).mockImplementation((handler) => {
      publishPlaybackStatus = handler;
      return vi.fn();
    });

    render(<MiniPlayerApp />);
    await act(async () => Promise.resolve());
    act(() => {
      publishPlaybackStatus({
        ...makePlaybackStatus(liveTrack),
        state: 'paused',
        positionMs: 32_000,
      });
      publishAudioStatus({
        ...makeAudioStatus(liveTrack),
        outputMode: 'system',
        state: 'paused',
        positionSeconds: 32,
      });
    });

    expect(screen.getByText('Current Song')).toBeTruthy();
    expect(screen.getByText('Current Artist')).toBeTruthy();
    expect(screen.queryByText('Old Mini Song')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });

    expect(screen.getByText('Current Song')).toBeTruthy();
    expect(screen.getByText('Current Artist')).toBeTruthy();
    expect(screen.queryByText('Old Mini Song')).toBeNull();
  });

  it('refreshes fixed-volume state when the mini player becomes visible again', async () => {
    const track = makeTrack();
    installEchoMock(track);
    let fixedVolumeEnabled = false;
    vi.mocked(window.echo!.app.getSettings).mockImplementation(async () => ({ fixedVolumeEnabled }) as Awaited<ReturnType<NonNullable<Window['echo']>['app']['getSettings']>>);
    render(<MiniPlayerApp />);

    fireEvent.click(await screen.findByRole('button', { name: '调节音量' }));
    const volumeSlider = screen.getByRole('slider', { name: '音量' }) as HTMLInputElement;
    await waitFor(() => expect(volumeSlider.disabled).toBe(false));

    fixedVolumeEnabled = true;
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(volumeSlider.disabled).toBe(true));
  });

  it('uses forwarded playback status for renderer-owned Spotify playback', async () => {
    const track = makeTrack({
      mediaType: 'streaming',
      provider: 'spotify',
      providerTrackId: 'spotify-track-1',
      stableKey: 'streaming:spotify:spotify-track-1',
    });
    installEchoMock(track, {
      audioStatus: {
        ...makeAudioStatus(track),
        state: 'idle',
        currentTrackId: null,
        currentFilePath: null,
        durationSeconds: 0,
        positionSeconds: 0,
      },
      playbackStatus: {
        state: 'idle',
        currentTrackId: null,
        positionMs: 0,
        durationMs: 0,
        filePath: null,
      },
      desktopLyricsPlaybackStatus: {
        ...makePlaybackStatus(track),
        positionMs: 33_000,
        filePath: track.stableKey ?? track.path,
        volume: 0.37,
      },
    });

    render(<MiniPlayerApp />);

    expect(await screen.findByRole('button', { name: '暂停' })).toBeTruthy();
    await waitFor(() => {
      const value = Number((document.querySelector('.mini-player-progress-row input') as HTMLInputElement).value);
      expect(value).toBe(33);
    });
    fireEvent.click(document.querySelector('.mini-player-volume-toggle') as HTMLButtonElement);
    await waitFor(() => expect((document.querySelector('.mini-player-volume-row input') as HTMLInputElement).value).toBe('0.37'));
  });

  it('lets an identified active host status replace stale renderer-owned playback', async () => {
    const nativeTrack = makeTrack({ title: 'Native Return', artist: 'Native Artist' });
    const staleSpotifyTrack = makeTrack({
      id: 'spotify-old',
      title: 'Old Spotify Track',
      path: 'streaming:spotify:old',
      mediaType: 'streaming',
      provider: 'spotify',
      providerTrackId: 'old',
      stableKey: 'streaming:spotify:old',
    });
    installEchoMock(nativeTrack, {
      desktopLyricsPlaybackStatus: makePlaybackStatus(staleSpotifyTrack),
    });

    render(<MiniPlayerApp />);

    expect(await screen.findByText('Native Return')).toBeTruthy();
    expect(screen.queryByText('Old Spotify Track')).toBeNull();
  });

  it('prefers forwarded system audio status over stale local system state', async () => {
    const staleTrack = makeTrack({
      id: 'stale-track',
      path: 'D:\\Music\\Midsummer Cat.flac',
      title: 'Midsummer Cat',
      artist: 'Sangnoksu',
      coverThumb: 'echo-cover://thumb/stale-cover',
    });
    const liveTrack = makeTrack({
      id: 'live-track',
      path: 'D:\\Music\\Sayonara.flac',
      title: 'Sayonara Cover',
      artist: 'Sana',
      coverThumb: null,
    });
    installEchoMock(staleTrack, {
      audioStatus: {
        ...makeAudioStatus(staleTrack),
        outputMode: 'system',
        positionSeconds: 0,
        currentTrackId: null,
        currentFilePath: null,
      },
      playbackStatus: {
        ...makePlaybackStatus(staleTrack),
        positionMs: 0,
        currentTrackId: null,
        filePath: null,
      },
      desktopLyricsAudioStatus: {
        ...makeAudioStatus(liveTrack),
        outputMode: 'system',
        positionSeconds: 18,
      },
    });

    render(<MiniPlayerApp />);

    expect(await screen.findByText('Sayonara Cover')).toBeTruthy();
    expect(screen.getByText('Sana')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Midsummer Cat')).toBeNull());
    await waitFor(() => {
      const value = Number((document.querySelector('.mini-player-progress-row input') as HTMLInputElement | null)?.value);
      expect(value).toBeGreaterThanOrEqual(18);
      expect(value).toBeLessThan(21);
    });
  });
});
