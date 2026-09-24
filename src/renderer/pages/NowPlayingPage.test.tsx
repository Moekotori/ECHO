// @vitest-environment jsdom
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { AudioStatus } from '../../shared/types/audio';
import type { LibraryTrack } from '../../shared/types/library';
import { I18nProvider } from '../i18n/I18nProvider';
import { PlaybackQueueProvider, usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { showAudioErrorNoticeEvent } from '../utils/audioErrorNotice';
import { NowPlayingPage } from './NowPlayingPage';

const makeTrack = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\song.flac',
  title: 'Test Song',
  artist: 'Test Artist',
  album: 'Test Album',
  albumArtist: 'Test Album Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 96000,
  bitDepth: 24,
  bitrate: 2400000,
  coverId: null,
  coverThumb: 'echo-cover://thumb/test',
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'present',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

const makeAudioStatus = (track: LibraryTrack | null): AudioStatus => ({
  host: 'ready',
  state: track ? 'playing' : 'idle',
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
  currentFilePath: track?.path ?? null,
  currentTrackId: track?.id ?? null,
  durationSeconds: track?.duration ?? 0,
  positionSeconds: 0,
  channels: 2,
  codec: track?.codec ?? null,
  bitDepth: track?.bitDepth ?? null,
  bitrate: track?.bitrate ?? null,
  fileSampleRate: track?.sampleRate ?? null,
  decoderOutputSampleRate: track?.sampleRate ?? null,
  requestedOutputSampleRate: track?.sampleRate ?? null,
  actualDeviceSampleRate: track?.sampleRate ?? null,
  sharedDeviceSampleRate: track?.sampleRate ?? null,
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

const QueueSeed = ({ children, track }: { children: JSX.Element; track: LibraryTrack }): JSX.Element => {
  const { replaceQueue, setCurrentTrackId } = usePlaybackQueue();

  useEffect(() => {
    replaceQueue([track]);
    setCurrentTrackId(track.id);
  }, [replaceQueue, setCurrentTrackId, track]);

  return children;
};

const mockEcho = (track: LibraryTrack | null): void => {
  window.echo = {
    playback: {
      getStatus: vi.fn().mockResolvedValue({
        state: track ? 'playing' : 'idle',
        currentTrackId: track?.id ?? null,
        positionMs: 0,
        durationMs: (track?.duration ?? 0) * 1000,
        filePath: track?.path ?? null,
      }),
      playLocalFile: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      openLocalAudioFile: vi.fn(),
    },
    audio: {
      getStatus: vi.fn().mockResolvedValue(makeAudioStatus(track)),
      onStatus: vi.fn(() => vi.fn()),
      listDevices: vi.fn(),
      setOutput: vi.fn().mockResolvedValue(makeAudioStatus(track)),
    },
  } as unknown as Window['echo'];
};

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('echo-next.locale', 'zh-CN');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('NowPlayingPage', () => {
  it('does not start a page-local 500ms playback status poll', async () => {
    const track = makeTrack();
    mockEcho(track);
    const intervalSpy = vi.spyOn(window, 'setInterval');

    render(
      <I18nProvider>
        <PlaybackQueueProvider>
          <QueueSeed track={track}>
            <NowPlayingPage />
          </QueueSeed>
        </PlaybackQueueProvider>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Test Song' })).toBeTruthy();
    expect(intervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 500);
  });

  it('routes audio host failures to the upper-left notice without rendering them in the page', async () => {
    const track = makeTrack();
    const rawError = 'echo-audio-host runtime_error; nativeMessage="WASAPI exclusive format unsupported"';
    const notices: Event[] = [];
    const handleNotice = (event: Event): void => {
      notices.push(event);
    };
    mockEcho(track);
    vi.mocked(window.echo.audio.getStatus).mockResolvedValue({
      ...makeAudioStatus(track),
      state: 'error',
      error: rawError,
    });
    window.addEventListener(showAudioErrorNoticeEvent, handleNotice);

    try {
      const { container } = render(
        <I18nProvider>
          <PlaybackQueueProvider>
            <QueueSeed track={track}>
              <NowPlayingPage />
            </QueueSeed>
          </PlaybackQueueProvider>
        </I18nProvider>,
      );

      await waitFor(() => expect(notices.length).toBeGreaterThan(0));
      expect((notices[0] as CustomEvent<{ message: string }>).detail.message).toBe(rawError);
      expect(container.querySelector('.now-playing-error')).toBeNull();
      expect(screen.queryByText(rawError)).toBeNull();
    } finally {
      window.removeEventListener(showAudioErrorNoticeEvent, handleNotice);
    }
  });

  it('shows a compact current playback overview instead of the lyrics view', async () => {
    const track = makeTrack();
    mockEcho(track);

    const { container } = render(
      <I18nProvider>
        <PlaybackQueueProvider>
          <QueueSeed track={track}>
            <NowPlayingPage />
          </QueueSeed>
        </PlaybackQueueProvider>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: '正在播放' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Test Song' })).toBeTruthy();
    expect(screen.getByText('Test Artist')).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开歌词' })).toBeTruthy();
    expect(container.querySelector('.lyrics-page')).toBeNull();
  });

  it('shows an empty overview when no song is playing', async () => {
    mockEcho(null);

    render(
      <I18nProvider>
        <PlaybackQueueProvider>
          <NowPlayingPage />
        </PlaybackQueueProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('暂无播放')).toBeTruthy();
  });
});
