// @vitest-environment jsdom
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AudioStatus } from '../../shared/types/audio';
import type { LibraryTrack } from '../../shared/types/library';
import { PlaybackQueueProvider, usePlaybackQueue } from '../stores/PlaybackQueueProvider';
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
  useJuceOutputRequested: false,
  useJuceDecodeRequested: false,
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
      listDevices: vi.fn(),
      setOutput: vi.fn().mockResolvedValue(makeAudioStatus(track)),
    },
  } as unknown as Window['echo'];
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('NowPlayingPage', () => {
  it('shows a compact current playback overview instead of the lyrics view', async () => {
    const track = makeTrack();
    mockEcho(track);

    const { container } = render(
      <PlaybackQueueProvider>
        <QueueSeed track={track}>
          <NowPlayingPage />
        </QueueSeed>
      </PlaybackQueueProvider>,
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
      <PlaybackQueueProvider>
        <NowPlayingPage />
      </PlaybackQueueProvider>,
    );

    expect(await screen.findByText('Nothing is playing')).toBeTruthy();
  });
});
