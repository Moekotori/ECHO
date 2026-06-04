// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryTrack } from '../../../shared/types/library';
import type { MvSettings, TrackVideo } from '../../../shared/types/mv';
import { MvPanel, type MvAudioClock } from './MvPanel';
import { mvDiagnosticsStorageKey } from './mvDiagnostics';

const makeVideo = (overrides: Partial<TrackVideo> = {}): TrackVideo => ({
  id: 'video-1',
  trackId: 'track-1',
  provider: 'local',
  sourceType: 'manual',
  sourceId: 'local:1',
  title: 'Test Song MV',
  artist: 'Test Artist',
  url: null,
  providerUrl: null,
  thumbnailUrl: null,
  filePath: null,
  mediaUrl: 'echo-video://mv/video-1',
  mimeType: 'video/mp4',
  durationSeconds: null,
  width: null,
  height: null,
  selectedQualityId: null,
  qualityLabel: null,
  fps: null,
  offsetMs: 0,
  score: 1,
  selected: true,
  playableInApp: true,
  rawProviderJson: null,
  createdAt: '2026-05-13T00:00:00.000Z',
  updatedAt: '2026-05-13T00:00:00.000Z',
  ...overrides,
});

const defaultMvSettings: MvSettings = {
  autoSearch: true,
  autoPreload: true,
  restartAudioOnLoad: false,
  enabledProviders: ['bilibili', 'youtube'],
  providerOrder: ['bilibili', 'youtube'],
  maxQuality: '1080p',
  allow60fps: true,
};

const makeAudioClock = (
  positionSeconds = 0,
  playbackRate = 1,
  overrides: Partial<MvAudioClock> = {},
): MvAudioClock => ({
  positionSeconds,
  updatedAtMs: performance.now(),
  playbackRate,
  durationSeconds: 180,
  state: 'playing',
  ...overrides,
});

const makeRemoteTrack = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'remote-track-1',
  mediaType: 'remote',
  path: 'remote://source-1/music/Test Song.flac',
  sourceId: 'source-1',
  provider: 'webdav',
  providerTrackId: null,
  remotePath: '/music/Test Song.flac',
  stableKey: 'remote-stable-key',
  title: 'Remote Song',
  artist: 'Remote Artist',
  album: 'Remote Album',
  albumArtist: 'Remote Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 192000,
  bitDepth: 24,
  bitrate: 5868000,
  coverId: 'remote-cover',
  coverThumb: 'echo-cover://thumb/remote-cover',
  fieldSources: {
    title: 'embedded',
    artist: 'embedded',
    album: 'embedded',
  },
  ...overrides,
});

const renderPanel = (
  selected: TrackVideo | null,
  isAudioPlaying = true,
  settings: MvSettings = defaultMvSettings,
  clockPositionSeconds = 0,
  clockPlaybackRate = 1,
  hideFallbackTrackInfo = false,
  smartReadableColorsEnabled = false,
) => {
  window.echo = {
    playback: {
      seek: vi.fn(),
    },
    mv: {
      getSelected: vi.fn().mockResolvedValue(selected),
      getSettings: vi.fn().mockResolvedValue(settings),
      setSettings: vi.fn(),
      findLocalCandidates: vi.fn().mockResolvedValue([]),
      searchNetworkCandidates: vi.fn().mockResolvedValue([]),
      getTemporaryPlayableForSnapshot: vi.fn().mockResolvedValue(null),
      getCandidates: vi.fn().mockResolvedValue([]),
      resolveStreams: vi.fn().mockResolvedValue({ video: selected, variants: [] }),
      setQuality: vi.fn(),
      setOffset: vi.fn(async (_trackId: string, offsetMs: number) => (selected ? { ...selected, offsetMs } : null)),
      chooseLocalVideo: vi.fn().mockResolvedValue(null),
      bindLocalVideo: vi.fn(),
      selectVideo: vi.fn(),
      clearSelected: vi.fn(),
      openExternal: vi.fn(),
    },
  } as unknown as Window['echo'];

  return render(
    <MvPanel
      trackId="track-1"
      title="Test Song"
      artist="Test Artist"
      coverUrl="echo-cover://thumb/test"
      hideFallbackTrackInfo={hideFallbackTrackInfo}
      smartReadableColorsEnabled={smartReadableColorsEnabled}
      isAudioPlaying={isAudioPlaying}
      audioClock={makeAudioClock(clockPositionSeconds, clockPlaybackRate, {
        state: isAudioPlaying ? 'playing' : 'paused',
      })}
    />,
  );
};

beforeEach(() => {
  window.localStorage.removeItem(mvDiagnosticsStorageKey);
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(() => {
  window.localStorage.removeItem(mvDiagnosticsStorageKey);
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MvPanel', () => {
  it('shows cover fallback when no MV is selected', async () => {
    const { container } = renderPanel(null);

    await waitFor(() => expect(window.echo.mv.getSelected).toHaveBeenCalledWith('track-1'));
    expect(container.querySelector('.lyrics-mv-card[data-cover="true"] .lyrics-mv-artwork img')?.getAttribute('src')).toBe(
      'echo-cover://thumb/test',
    );
    expect(screen.getByText('MV unavailable')).toBeTruthy();
    expect(screen.getByText('MV 不可用')).toBeTruthy();
    expect(screen.getByText('未找到可播放 MV')).toBeTruthy();
    expect(screen.queryByText('Find local')).toBeNull();
    expect(screen.queryByText('Choose file')).toBeNull();
  });

  it('auto-dismisses the MV unavailable notice after three seconds', async () => {
    vi.useFakeTimers();
    renderPanel(null);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('未找到可播放 MV')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText('未找到可播放 MV')).toBeNull();
  });

  it('can hide track info on the cover fallback card', async () => {
    renderPanel(null, true, defaultMvSettings, 0, 1, true);

    await waitFor(() => expect(window.echo.mv.getSelected).toHaveBeenCalledWith('track-1'));
    expect(screen.getByText('MV unavailable')).toBeTruthy();
    expect(screen.queryByText('Test Song')).toBeNull();
    expect(screen.queryByText('Test Artist')).toBeNull();
  });

  it('does not load or render MV when MV is disabled', async () => {
    const { container } = renderPanel(makeVideo(), true, { ...defaultMvSettings, enabled: false });

    await waitFor(() => expect(container.querySelector('.lyrics-mv-panel')?.getAttribute('data-mv-enabled')).toBe('false'));
    expect(screen.queryByText('MV disabled')).toBeNull();
    expect(container.querySelector('.lyrics-mv-card')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    expect(window.echo.mv.getSelected).not.toHaveBeenCalled();
    expect(window.echo.mv.searchNetworkCandidates).not.toHaveBeenCalled();
  });

  it('keeps the MV surface empty while disabled settings are still loading', async () => {
    let resolveSettings: (settings: MvSettings) => void = () => undefined;
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      mv: {
        getSelected: vi.fn().mockResolvedValue(makeVideo()),
        getSettings: vi.fn().mockReturnValue(
          new Promise<MvSettings>((resolve) => {
            resolveSettings = resolve;
          }),
        ),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn().mockResolvedValue({ video: makeVideo(), variants: [] }),
        setQuality: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn(),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    expect(container.querySelector('.lyrics-mv-panel')?.getAttribute('data-mv-enabled')).toBe('false');
    expect(container.querySelector('.lyrics-mv-card')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    expect(window.echo.mv.getSelected).not.toHaveBeenCalled();

    await act(async () => {
      resolveSettings({ ...defaultMvSettings, enabled: false });
    });

    await waitFor(() => expect(window.echo.mv.getSettings).toHaveBeenCalled());
    expect(container.querySelector('.lyrics-mv-card')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    expect(window.echo.mv.getSelected).not.toHaveBeenCalled();
  });

  it('preloads MV candidates while audio is playing', async () => {
    const selectedAfterSearch = makeVideo({ provider: 'bilibili' });
    const getSelected = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(selectedAfterSearch);
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      mv: {
        getSelected,
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn().mockResolvedValue({ video: selectedAfterSearch, variants: [] }),
        setQuality: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn(),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    await waitFor(() => expect(window.echo.mv.searchNetworkCandidates).toHaveBeenCalledWith('track-1'));
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/video-1'));
  });

  it('searches and selects remote track MVs from snapshot metadata', async () => {
    const remoteTrack = makeRemoteTrack();
    const selectedAfterSearch = makeVideo({
      id: 'remote-video-1',
      trackId: remoteTrack.id,
      provider: 'bilibili',
      mediaUrl: 'echo-video://mv/remote-video-1',
    });
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      mv: {
        getSelected: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidatesForSnapshot: vi.fn().mockResolvedValue([
          {
            id: 'bilibili:BVremote',
            provider: 'bilibili',
            sourceType: 'search_candidate',
            title: 'Remote Song MV',
            artist: 'Remote Artist',
            filePath: null,
            url: 'https://www.bilibili.com/video/BVremote',
            providerUrl: 'https://www.bilibili.com/video/BVremote',
            thumbnailUrl: 'https://example.test/remote-mv.jpg',
            uploader: 'Remote Channel',
            availableQualities: [],
            durationSeconds: 180,
            score: 0.93,
            playableInApp: true,
            reasons: ['Bilibili search'],
          },
        ]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn().mockResolvedValue({ video: selectedAfterSearch, variants: [] }),
        setQuality: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn().mockResolvedValue(selectedAfterSearch),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId={remoteTrack.id}
        currentTrack={remoteTrack}
        title={remoteTrack.title}
        artist={remoteTrack.artist}
        coverUrl={remoteTrack.coverThumb}
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    await waitFor(() =>
      expect(window.echo.mv.searchNetworkCandidatesForSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: remoteTrack.id,
          title: 'Remote Song',
          artist: 'Remote Artist',
          mediaType: 'remote',
          query: 'Remote Song Remote Artist',
        }),
      ),
    );
    await waitFor(() => expect(window.echo.mv.selectVideo).toHaveBeenCalledWith(remoteTrack.id, 'bilibili:BVremote'));
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/remote-video-1'));
  });

  it('searches non-temporary streaming track MVs from snapshot metadata', async () => {
    const streamingTrack = makeRemoteTrack({
      id: 'spotify-row-1',
      mediaType: 'streaming',
      isTemporary: false,
      path: 'streaming:spotify:6A8NfypDHuwlWbo4aIYca',
      sourceId: null,
      provider: 'spotify',
      providerTrackId: '6A8NfypDHuwlWbo4aIYca',
      remotePath: null,
      stableKey: 'streaming:spotify:6A8NfypDHuwlWbo4aIYca',
      title: 'New Genesis',
      artist: 'Ado',
      album: "UTA'S SONGS ONE PIECE FILM RED",
      albumArtist: 'Ado',
    });
    const selectedAfterSearch = makeVideo({
      id: 'spotify-video-1',
      trackId: streamingTrack.id,
      provider: 'bilibili',
      mediaUrl: 'echo-video://mv/spotify-video-1',
    });
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      mv: {
        getSelected: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidatesForSnapshot: vi.fn().mockResolvedValue([
          {
            id: 'bilibili:BVspotify',
            provider: 'bilibili',
            sourceType: 'search_candidate',
            title: 'New Genesis MV',
            artist: 'Ado',
            filePath: null,
            url: 'https://www.bilibili.com/video/BVspotify',
            providerUrl: 'https://www.bilibili.com/video/BVspotify',
            thumbnailUrl: null,
            uploader: 'Ado Channel',
            availableQualities: [],
            durationSeconds: 240,
            score: 0.94,
            playableInApp: true,
            reasons: ['Bilibili search'],
          },
        ]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn().mockResolvedValue({ video: selectedAfterSearch, variants: [] }),
        setQuality: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn().mockResolvedValue(selectedAfterSearch),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId="streaming:spotify:6A8NfypDHuwlWbo4aIYca"
        currentTrack={streamingTrack}
        title={streamingTrack.title}
        artist={streamingTrack.artist}
        coverUrl={streamingTrack.coverThumb}
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    await waitFor(() =>
      expect(window.echo.mv.searchNetworkCandidatesForSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: 'streaming:spotify:6A8NfypDHuwlWbo4aIYca',
          title: 'New Genesis',
          artist: 'Ado',
          mediaType: 'streaming',
          query: 'New Genesis Ado',
        }),
      ),
    );
    expect(window.echo.mv.searchNetworkCandidates).not.toHaveBeenCalled();
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/spotify-video-1'));
  });

  it('auto-loads MV for AirPlay receiver streams', async () => {
    const airPlayTrack = makeRemoteTrack({
      id: 'airplay-receiver:session-1',
      path: 'airplay-receiver:session-1',
      isTemporary: true,
      title: 'Air Song',
      artist: 'Air Artist',
      fieldSources: { title: 'airplay', artist: 'airplay' },
    });
    const selectedAfterSearch = makeVideo({
      id: 'airplay-video-1',
      trackId: airPlayTrack.id,
      provider: 'bilibili',
      sourceType: 'stream',
      sourceId: 'bilibili:BVairplay',
      title: 'Air Song MV',
      artist: 'Air Artist',
      mediaUrl: 'echo-video://mv/airplay-video-1',
      playableInApp: true,
    });
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      mv: {
        getSelected: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidatesForSnapshot: vi.fn().mockResolvedValue([
          {
            id: 'bilibili:BVairplay',
            trackId: airPlayTrack.id,
            provider: 'bilibili',
            sourceType: 'search',
            sourceId: 'BVairplay',
            title: 'Air Song MV',
            artist: 'Air Artist',
            filePath: null,
            url: 'https://www.bilibili.com/video/BVairplay',
            providerUrl: 'https://www.bilibili.com/video/BVairplay',
            thumbnailUrl: null,
            uploader: 'Air Channel',
            availableQualities: [],
            durationSeconds: 180,
            score: 0.94,
            playableInApp: true,
            reasons: ['Bilibili search'],
          },
        ]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn().mockResolvedValue({ video: selectedAfterSearch, variants: [] }),
        setQuality: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn().mockResolvedValue(selectedAfterSearch),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId={airPlayTrack.id}
        currentTrack={airPlayTrack}
        title={airPlayTrack.title}
        artist={airPlayTrack.artist}
        coverUrl={airPlayTrack.coverThumb}
        isAudioPlaying
        audioClock={makeAudioClock(12, 1, { durationSeconds: null })}
      />,
    );

    await waitFor(() =>
      expect(window.echo.mv.searchNetworkCandidatesForSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: airPlayTrack.id,
          title: 'Air Song',
          artist: 'Air Artist',
          mediaType: 'remote',
          query: 'Air Song Air Artist',
        }),
      ),
    );
    await waitFor(() => expect(window.echo.mv.selectVideo).toHaveBeenCalledWith(airPlayTrack.id, 'bilibili:BVairplay'));
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/airplay-video-1'));
  });

  it('auto-searches and applies AirPlay MVs from receiver metadata before a queue snapshot exists', async () => {
    const selectedAfterSearch = makeVideo({
      id: 'airplay-video-2',
      trackId: 'airplay-receiver:source-1',
      provider: 'bilibili',
      sourceType: 'stream',
      sourceId: 'bilibili:BVairplay2',
      title: 'Air Song MV',
      artist: 'Air Artist',
      mediaUrl: 'echo-video://mv/airplay-video-2',
      playableInApp: true,
    });
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      mv: {
        getSelected: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue({
          ...defaultMvSettings,
          autoSearch: true,
          autoPreload: false,
        }),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidatesForSnapshot: vi.fn().mockResolvedValue([
          {
            id: 'bilibili:BVairplay2',
            provider: 'bilibili',
            sourceType: 'search_candidate',
            title: 'Air Song MV',
            artist: 'Air Artist',
            filePath: null,
            url: 'https://www.bilibili.com/video/BVairplay2',
            providerUrl: 'https://www.bilibili.com/video/BVairplay2',
            thumbnailUrl: null,
            uploader: 'Air Channel',
            availableQualities: [],
            durationSeconds: 180,
            score: 0.94,
            playableInApp: true,
            reasons: ['Bilibili search'],
          },
        ]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn().mockResolvedValue({ video: selectedAfterSearch, variants: [] }),
        setQuality: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn().mockResolvedValue(selectedAfterSearch),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId="airplay-receiver:source-1"
        currentTrack={null}
        title="Air Song"
        artist="Air Artist"
        coverUrl={null}
        isAudioPlaying={false}
        audioClock={makeAudioClock(12, 1, { durationSeconds: 180, state: 'paused' })}
      />,
    );

    await waitFor(() =>
      expect(window.echo.mv.searchNetworkCandidatesForSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: 'airplay-receiver:source-1',
          title: 'Air Song',
          artist: 'Air Artist',
          mediaType: 'remote',
          query: 'Air Song Air Artist',
        }),
      ),
    );
    await waitFor(() =>
      expect(window.echo.mv.selectVideo).toHaveBeenCalledWith('airplay-receiver:source-1', 'bilibili:BVairplay2'),
    );
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/airplay-video-2'));
  });

  it('shows a video for playable selected MV', async () => {
    const { container } = renderPanel(makeVideo());

    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/video-1'));
    const video = container.querySelector('.lyrics-mv-video') as HTMLVideoElement | null;
    expect(video?.muted).toBe(true);
    expect(video?.autoplay).toBe(true);
    expect(video?.controls).toBe(false);
    expect(video?.loop).toBe(false);
    expect(container.querySelector('.lyrics-mv-toolbar')).toBeNull();
  });

  it('notifies playback when the foreground MV ends before the audio', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { container } = renderPanel(makeVideo(), true);

    const video = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    video.dispatchEvent(new Event('ended'));

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mv:ended-before-audio',
        detail: { trackId: 'track-1' },
      }),
    );
  });

  it('does not notify playback when the foreground MV ends while audio is paused', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { container } = renderPanel(makeVideo(), false);

    const video = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    video.dispatchEvent(new Event('ended'));

    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mv:ended-before-audio',
      }),
    );
  });

  it('keeps the immersive background MV looping while foreground MV can end', async () => {
    const { container } = renderPanel(makeVideo(), true, {
      ...defaultMvSettings,
      immersiveBackground: true,
    });

    const foregroundVideo = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });
    const backgroundVideo = container.querySelector('.lyrics-mv-background-video') as HTMLVideoElement | null;

    expect(foregroundVideo.loop).toBe(false);
    expect(backgroundVideo?.loop).toBe(true);
  });

  it('marks the regular MV panel when immersive background is disabled', async () => {
    const { container } = renderPanel(makeVideo(), true, {
      ...defaultMvSettings,
      immersiveBackground: false,
    });

    const panel = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-panel') as HTMLElement | null;
      expect(element).toBeTruthy();
      expect(element?.dataset.mvEnabled).toBe('true');
      return element!;
    });

    expect(panel.dataset.immersiveActive).toBe('false');
    expect(container.querySelector('.lyrics-mv-background')).toBeNull();
  });

  it('uses streaming provider MV metadata to search when no library track id is available', async () => {
    const selectedAfterSearch = makeVideo({ id: 'streaming-video-1', trackId: 'streaming:qqmusic:song-mid', provider: 'bilibili' });
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      streaming: {
        getMv: vi.fn().mockResolvedValue({
          provider: 'qqmusic',
          providerTrackId: 'song-mid',
          status: 'available',
          items: [
            {
              id: 'streaming:qqmusic:mv:mv-1',
              provider: 'qqmusic',
              providerMvId: 'mv-1',
              providerTrackId: 'song-mid',
              title: 'Provider Exact MV',
              artist: 'Provider Artist',
              duration: 180,
              thumbnailUrl: 'https://example.test/mv.jpg',
            },
          ],
        }),
      },
      mv: {
        getSelected: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidatesForSnapshot: vi.fn().mockResolvedValue([
          {
            id: 'bilibili:BVstreaming',
            provider: 'bilibili',
            sourceType: 'search_candidate',
            title: 'Provider Exact MV',
            artist: 'Provider Artist',
            filePath: null,
            url: 'https://www.bilibili.com/video/BVstreaming',
            providerUrl: 'https://www.bilibili.com/video/BVstreaming',
            thumbnailUrl: 'https://example.test/mv.jpg',
            uploader: 'Provider Channel',
            availableQualities: [],
            durationSeconds: 180,
            score: 0.92,
            playableInApp: true,
            reasons: ['Bilibili search'],
          },
        ]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn().mockResolvedValue({ video: selectedAfterSearch, variants: [] }),
        setQuality: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn().mockResolvedValue(selectedAfterSearch),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId={null}
        streamingTarget={{ provider: 'qqmusic', providerTrackId: 'song-mid' }}
        title="Search Title"
        artist="Search Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    await waitFor(() =>
      expect(window.echo.mv.searchNetworkCandidatesForSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: 'streaming:qqmusic:song-mid',
          title: 'Provider Exact MV',
          artist: 'Provider Artist',
          query: 'Provider Exact MV Provider Artist',
        }),
      ),
    );
    await waitFor(() => expect(window.echo.mv.selectVideo).toHaveBeenCalledWith('streaming:qqmusic:song-mid', 'bilibili:BVstreaming'));
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/video-1'));
  });

  it('binds Bilibili streaming tracks directly to their source video for MV playback', async () => {
    const boundVideo = makeVideo({
      id: 'bilibili:BVdirect',
      trackId: 'streaming:bilibili:BVdirect',
      provider: 'bilibili',
      sourceType: 'manual',
      sourceId: 'BVdirect',
      providerUrl: 'https://www.bilibili.com/video/BVdirect',
      mediaUrl: null,
      playableInApp: false,
    });
    const resolvedVideo = {
      ...boundVideo,
      mediaUrl: 'echo-video://mv/bilibili-direct',
      playableInApp: true,
    };
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      streaming: {
        getMv: vi.fn(),
      },
      mv: {
        getSelected: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidatesForSnapshot: vi.fn().mockResolvedValue([]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn().mockResolvedValue({ video: resolvedVideo, variants: [] }),
        setQuality: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        bindUrl: vi.fn().mockResolvedValue(boundVideo),
        selectVideo: vi.fn(),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId={null}
        streamingTarget={{ provider: 'bilibili', providerTrackId: 'BVdirect' }}
        title="Bilibili Source"
        artist="Source UP"
        coverUrl="echo-cover://thumb/bili"
        isAudioPlaying
        audioClock={makeAudioClock(37)}
      />,
    );

    await waitFor(() =>
      expect(window.echo.mv.bindUrl).toHaveBeenCalledWith(
        'streaming:bilibili:BVdirect',
        'https://www.bilibili.com/video/BVdirect',
      ),
    );
    expect(window.echo.streaming.getMv).not.toHaveBeenCalled();
    expect(window.echo.mv.searchNetworkCandidatesForSnapshot).not.toHaveBeenCalled();
    const video = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-video') as HTMLVideoElement | null;
      expect(element?.getAttribute('src')).toBe('echo-video://mv/bilibili-direct');
      return element!;
    });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBeCloseTo(37, 1);
  });

  it('binds YouTube streaming tracks directly and embeds the YouTube video for MV display', async () => {
    const boundVideo = makeVideo({
      id: 'youtube:abc123DEF45',
      trackId: 'streaming:youtube:abc123DEF45',
      provider: 'youtube',
      sourceType: 'manual',
      sourceId: 'abc123DEF45',
      providerUrl: 'https://www.youtube.com/watch?v=abc123DEF45',
      mediaUrl: null,
      playableInApp: false,
    });
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      streaming: {
        getMv: vi.fn(),
      },
      mv: {
        getSelected: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidatesForSnapshot: vi.fn().mockResolvedValue([]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn().mockResolvedValue({ video: boundVideo, variants: [] }),
        setQuality: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        bindUrl: vi.fn().mockResolvedValue(boundVideo),
        selectVideo: vi.fn(),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId={null}
        streamingTarget={{ provider: 'youtube', providerTrackId: 'abc123DEF45' }}
        title="YouTube Source"
        artist="Source Channel"
        coverUrl="echo-cover://thumb/youtube"
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    await waitFor(() =>
      expect(window.echo.mv.bindUrl).toHaveBeenCalledWith(
        'streaming:youtube:abc123DEF45',
        'https://www.youtube.com/watch?v=abc123DEF45',
      ),
    );
    expect(window.echo.streaming.getMv).not.toHaveBeenCalled();
    expect(window.echo.mv.searchNetworkCandidatesForSnapshot).not.toHaveBeenCalled();
    const frame = await waitFor(() => {
      const element = container.querySelector('iframe.lyrics-mv-video--youtube') as HTMLIFrameElement | null;
      expect(element?.getAttribute('src')).toContain('https://www.youtube.com/embed/abc123DEF45');
      return element!;
    });
    expect(frame.getAttribute('src')).toContain('mute=1');
    expect(frame.getAttribute('src')).toContain('autoplay=1');
    expect(frame.getAttribute('src')).toContain('controls=0');
    expect(frame.getAttribute('src')).toContain('disablekb=1');
    expect(frame.getAttribute('src')).toContain('fs=0');
    expect(container.querySelector('.lyrics-mv-panel')?.getAttribute('data-immersive-active')).toBe('true');

    const backgroundFrame = container.querySelector('iframe.lyrics-mv-background-video--youtube') as HTMLIFrameElement | null;
    expect(backgroundFrame?.getAttribute('src')).toContain('https://www.youtube.com/embed/abc123DEF45');
    expect(backgroundFrame?.getAttribute('src')).toContain('controls=0');
    expect(backgroundFrame?.getAttribute('src')).toContain('loop=1');
    expect(backgroundFrame?.getAttribute('src')).toContain('playlist=abc123DEF45');
  });

  it('keeps the MV diagnostics report hidden while a YouTube iframe is visible', async () => {
    window.localStorage.setItem(mvDiagnosticsStorageKey, 'true');
    const { container } = renderPanel(
      makeVideo({
        id: 'youtube:abc123DEF45',
        provider: 'youtube',
        sourceType: 'manual',
        sourceId: 'abc123DEF45',
        providerUrl: 'https://www.youtube.com/watch?v=abc123DEF45',
        mediaUrl: null,
        playableInApp: false,
      }),
      true,
      {
        ...defaultMvSettings,
        immersiveBackground: false,
      },
    );

    await waitFor(() => {
      expect(container.querySelector('iframe.lyrics-mv-video--youtube')?.getAttribute('src')).toContain(
        'https://www.youtube.com/embed/abc123DEF45',
      );
    });
    expect(container.querySelector('.lyrics-mv-diagnostics-report')).toBeNull();
  });

  it('applies immersive MV visual tuning variables', async () => {
    const { container } = renderPanel(makeVideo(), true, {
      ...defaultMvSettings,
      immersiveBackground: true,
      immersiveBackgroundBlurPx: 10,
      immersiveBackgroundBrightnessPercent: 118,
      immersiveBackgroundOverlayOpacityPercent: 35,
    });

    const background = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-background') as HTMLElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    expect(background.style.getPropertyValue('--mv-immersive-blur')).toBe('10px');
    expect(background.style.getPropertyValue('--mv-immersive-brightness')).toBe('118%');
    expect(background.style.getPropertyValue('--mv-immersive-overlay-opacity')).toBe('0.35');
  });

  it('auto scales immersive MV backgrounds from the video aspect ratio', async () => {
    const { container } = renderPanel(makeVideo({ width: 1920, height: 1080 }), true, {
      ...defaultMvSettings,
      immersiveBackground: true,
      immersiveBackgroundAutoScale: true,
      immersiveBackgroundScalePercent: 100,
    });

    const background = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-background') as HTMLElement | null;
      expect(element).toBeTruthy();
      expect(Number(element!.style.getPropertyValue('--mv-immersive-auto-scale'))).toBeGreaterThan(1);
      return element!;
    });

    expect(background.dataset.autoScale).toBe('true');
    expect(Number(background.style.getPropertyValue('--mv-immersive-scale'))).toBeGreaterThan(1);
  });

  it('marks the immersive MV background when lyrics readability enhancement is enabled', async () => {
    const { container } = renderPanel(makeVideo(), true, {
      ...defaultMvSettings,
      immersiveBackground: true,
      lyricsReadabilityEnhanced: true,
    });

    const background = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-background') as HTMLElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    expect(background.dataset.lyricsReadability).toBe('true');
    expect(container.querySelector('.lyrics-mv-panel')?.getAttribute('data-lyrics-readability')).toBe('true');
  });

  it('keeps the lyrics readability marker when immersive MV is disabled', async () => {
    const { container } = renderPanel(makeVideo(), true, {
      ...defaultMvSettings,
      immersiveBackground: false,
      lyricsReadabilityEnhanced: true,
    });

    const panel = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-panel') as HTMLElement | null;
      expect(element).toBeTruthy();
      expect(element?.dataset.lyricsReadability).toBe('true');
      return element!;
    });

    expect(container.querySelector('.lyrics-mv-background')).toBeNull();
    expect(panel.dataset.immersiveActive).toBe('false');
  });

  it('leaves the immersive MV readability marker absent by default', async () => {
    const { container } = renderPanel(makeVideo(), true, {
      ...defaultMvSettings,
      immersiveBackground: true,
    });

    const background = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-background') as HTMLElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    expect(background.dataset.lyricsReadability).toBeUndefined();
  });

  it('marks MV readability when smart readable colors are enabled', async () => {
    const { container } = renderPanel(makeVideo(), true, {
      ...defaultMvSettings,
      immersiveBackground: true,
      lyricsReadabilityEnhanced: false,
    }, 0, 1, false, true);

    const background = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-background') as HTMLElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    expect(background.dataset.lyricsReadability).toBe('true');
    expect(container.querySelector('.lyrics-mv-panel')?.getAttribute('data-lyrics-readability')).toBe('true');
  });

  it('clears the previous MV as soon as the track changes', async () => {
    let resolveSecond: (value: TrackVideo | null) => void = () => undefined;
    const getSelected = vi
      .fn()
      .mockResolvedValueOnce(makeVideo())
      .mockReturnValueOnce(new Promise<TrackVideo | null>((resolve) => {
        resolveSecond = resolve;
      }));

    window.echo = {
      mv: {
        getSelected,
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn(),
        setQuality: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn(),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container, rerender } = render(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/video-1'));

    rerender(
      <MvPanel
        trackId="track-2"
        title="Next Song"
        artist="Next Artist"
        coverUrl="echo-cover://thumb/next"
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    await waitFor(() => expect(container.querySelector('video')).toBeNull());
    expect(screen.getByText('Loading MV')).toBeTruthy();
    expect(screen.queryByText('Test Song MV')).toBeNull();

    resolveSecond(null);
  });

  it('pauses the MV when audio playback pauses', async () => {
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { container, rerender } = renderPanel(makeVideo(), true);

    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/video-1'));

    rerender(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying={false}
        audioClock={makeAudioClock(0, 1, { state: 'paused' })}
      />,
    );

    await waitFor(() => expect(pauseSpy).toHaveBeenCalled());
    expect(playSpy).toHaveBeenCalled();
  });

  it('syncs MV video to the audio position when metadata loads without restarting audio', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 42);

    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.dispatchEvent(new Event('loadedmetadata'));

    await waitFor(() => expect(video.currentTime).toBeCloseTo(42, 3));
    expect(window.echo.playback.seek).not.toHaveBeenCalled();
  });

  it('applies the selected track MV offset when syncing video time', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = renderPanel(makeVideo({ offsetMs: 750 }), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 42);

    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.dispatchEvent(new Event('loadedmetadata'));

    await waitFor(() => expect(video.currentTime).toBeCloseTo(42.75, 3));
  });

  it('applies the MV start offset immediately even when continuous follow is disabled', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = renderPanel(makeVideo({ offsetMs: 40000 }), true, { ...defaultMvSettings, restartAudioOnLoad: false }, 0);

    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.dispatchEvent(new Event('loadedmetadata'));

    await waitFor(() => expect(video.currentTime).toBeCloseTo(40, 3));
  });

  it('does not render MV offset controls on the lyrics page', async () => {
    const { container } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 10);

    await waitFor(() => expect(container.querySelector('video')).toBeTruthy());

    expect(container.querySelector('.mv-offset-controls')).toBeNull();
    expect(screen.queryByLabelText('MV sync')).toBeNull();
  });

  it('corrects drift conservatively while allowing obvious audio position jumps through', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { container, rerender } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 10);
    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await waitFor(() => expect(video.currentTime).toBeCloseTo(10, 3));

    video.currentTime = 10.4;
    nowSpy.mockReturnValue(1500);
    rerender(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(10.9)}
      />,
    );

    expect(video.currentTime).toBeCloseTo(10.4, 3);

    video.currentTime = 20;
    nowSpy.mockReturnValue(1600);
    rerender(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(10.9)}
      />,
    );

    expect(video.currentTime).toBeCloseTo(20, 3);

    video.currentTime = 10.4;
    nowSpy.mockReturnValue(1700);
    rerender(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(45)}
      />,
    );

    await waitFor(() => expect(video.currentTime).toBeCloseTo(45, 3));
  });

  it('does not write video time for frequent clock anchors within the drift threshold', async () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { container, rerender } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 10);
    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await waitFor(() => expect(video.currentTime).toBeCloseTo(10, 3));

    video.currentTime = 10.2;
    performanceNow.mockReturnValue(100);
    nowSpy.mockReturnValue(1100);
    rerender(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(10.25, 1, { updatedAtMs: 100 })}
      />,
    );

    expect(video.currentTime).toBeCloseTo(10.2, 3);
  });

  it('uses video playback-rate nudging for medium MV drift instead of seeking immediately', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { container, rerender } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 10);
    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await waitFor(() => expect(video.currentTime).toBeCloseTo(10, 3));

    video.currentTime = 10;
    nowSpy.mockReturnValue(2500);
    rerender(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(11.4)}
      />,
    );

    expect(video.currentTime).toBeCloseTo(10, 3);
    expect(video.playbackRate).toBeGreaterThan(1);
    expect(window.echo.playback.seek).not.toHaveBeenCalled();
  });

  it('keeps nudging MV drift between audio status refreshes while following progress', async () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 10);
    const video = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await waitFor(() => expect(video.currentTime).toBeCloseTo(10, 3));

    video.currentTime = 10.1;
    performanceNow.mockReturnValue(1200);

    await waitFor(() => expect(video.playbackRate).toBeGreaterThan(1), { timeout: 700 });
    expect(video.currentTime).toBeCloseTo(10.1, 3);
    expect(window.echo.playback.seek).not.toHaveBeenCalled();
  });

  it('force-syncs MV when audio resumes from pause', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container, rerender } = renderPanel(makeVideo(), false, { ...defaultMvSettings, restartAudioOnLoad: true }, 12);
    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await waitFor(() => expect(video.currentTime).toBeCloseTo(12, 3));

    video.currentTime = 0;
    rerender(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(40)}
      />,
    );

    await waitFor(() => expect(video.currentTime).toBeCloseTo(40, 3));
  });

  it('does not continuously adjust video time when MV progress following is disabled', async () => {
    const { container, rerender } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: false }, 30);
    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.currentTime = 0;
    video.dispatchEvent(new Event('loadedmetadata'));

    await waitFor(() => expect(video.currentTime).toBeCloseTo(30, 1));
    video.currentTime = 31;
    rerender(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(45)}
      />,
    );

    expect(video.currentTime).toBeCloseTo(31, 3);
    expect(window.echo.playback.seek).not.toHaveBeenCalled();
  });

  it('force-syncs MV when playback seek commits from the progress bar', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 8);
    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await waitFor(() => expect(video.currentTime).toBeCloseTo(8, 3));

    video.currentTime = 8.2;
    window.dispatchEvent(new CustomEvent('playback:seeked', { detail: { trackId: 'track-1', positionSeconds: 64 } }));

    await waitFor(() => expect(video.currentTime).toBeCloseTo(64, 3));
  });

  it('ignores playback seek sync events for other tracks', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 8);
    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await waitFor(() => expect(video.currentTime).toBeCloseTo(8, 3));

    video.currentTime = 8.2;
    window.dispatchEvent(new CustomEvent('playback:seeked', { detail: { trackId: 'track-2', positionSeconds: 64 } }));

    expect(video.currentTime).toBeCloseTo(8.2, 3);
  });

  it('syncs MV playback rate to the audio playback rate', async () => {
    const { container } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 0, 1.25);
    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    video.dispatchEvent(new Event('loadedmetadata'));

    expect(video.playbackRate).toBeCloseTo(1.25, 3);
  });

  it('wraps the target time for shorter looping MV videos', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 125);
    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 30 });
    video.dispatchEvent(new Event('loadedmetadata'));

    await waitFor(() => expect(video.currentTime).toBeCloseTo(5, 3));
  });

  it('uses loop-aware drift around MV loop boundaries', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { container, rerender } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 29.7);
    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 30 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await waitFor(() => expect(video.currentTime).toBeCloseTo(29.7, 3));

    video.currentTime = 29.8;
    nowSpy.mockReturnValue(2500);
    rerender(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(30.2, 1, { state: 'paused' })}
      />,
    );

    expect(video.currentTime).toBeCloseTo(29.8, 3);
  });

  it('advances the MV sync target from the audio clock anchor and playback rate', async () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { container } = renderPanel(makeVideo(), true, { ...defaultMvSettings, restartAudioOnLoad: true }, 10, 1.5);
    const video = await waitFor(() => {
      const element = container.querySelector('video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element!;
    });

    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    performanceNow.mockReturnValue(2000);
    video.dispatchEvent(new Event('loadedmetadata'));

    await waitFor(() => expect(video.currentTime).toBeCloseTo(11.5, 3));
  });

  it('shows fallback for selected MV that cannot play in app', async () => {
    renderPanel(makeVideo({ playableInApp: false, mediaUrl: null, mimeType: 'video/x-matroska' }));

    expect(await screen.findByText('External player required')).toBeTruthy();
    expect(screen.getByText('本地视频格式不支持')).toBeTruthy();
  });

  it('shows the Bilibili block reason instead of the generic video failure notice', async () => {
    renderPanel(
      makeVideo({
        provider: 'bilibili',
        sourceType: 'search_candidate',
        sourceId: 'BV1blocked',
        mediaUrl: null,
        playableInApp: false,
        rawProviderJson: {
          unavailableReason: 'bilibili-playurl-blocked',
          status: 412,
        },
      }),
    );

    expect(await screen.findByText(/Bilibili/)).toBeTruthy();
  });

  it('uses temporary MV playback when selected MV lookup hits a database error', async () => {
    const recoveredVideo = makeVideo({
      id: 'snapshot-video',
      provider: 'bilibili',
      sourceType: 'stream',
      sourceId: 'BVsnapshot',
      mediaUrl: 'echo-mv://ephemeral/token-1',
      title: 'Recovered MV',
      temporary: true,
    });
    const getTemporaryPlayableForSnapshot = vi.fn().mockResolvedValue(recoveredVideo);
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      mv: {
        getSelected: vi.fn().mockRejectedValue(new Error('DatabaseHealthError: database disk image is malformed')),
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        getTemporaryPlayableForSnapshot,
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn().mockResolvedValue({ video: recoveredVideo, variants: [] }),
        setQuality: vi.fn(),
        setOffset: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn(),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe(recoveredVideo.mediaUrl));
    expect(getTemporaryPlayableForSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: 'track-1',
        title: 'Test Song',
        artist: 'Test Artist',
        mediaType: 'local',
        query: 'Test Song Test Artist',
      }),
    );
    expect(window.echo.mv.selectVideo).not.toHaveBeenCalled();
    expect(await screen.findByText('临时 MV 播放中，数据库待修复')).toBeTruthy();
    expect(screen.queryByText('MV 数据库不可读')).toBeNull();
  });

  it('shows the MV load failure reason in the top-left unavailable badge', async () => {
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      mv: {
        getSelected: vi.fn().mockRejectedValue(new Error('DatabaseHealthError: database disk image is malformed')),
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn(),
        setQuality: vi.fn(),
        setOffset: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn(),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    expect(await screen.findByText('MV 数据库不可读')).toBeTruthy();
    expect(screen.queryByText('DatabaseHealthError: database disk image is malformed')).toBeNull();

    fireEvent.click(screen.getByLabelText('关闭 MV 不可用提示'));

    expect(screen.queryByText('MV 数据库不可读')).toBeNull();
  });

  it('does not surface auto-selected external network candidates in the lyrics MV panel', async () => {
    const { container } = renderPanel(
      makeVideo({
        sourceType: 'search_candidate',
        provider: 'youtube',
        playableInApp: false,
        mediaUrl: null,
        thumbnailUrl: 'https://i.example/external-thumb.jpg',
        title: 'External Search Result',
      }),
    );

    expect(await screen.findByText('MV unavailable')).toBeTruthy();
    expect(screen.queryByText('External player required')).toBeNull();
    expect(screen.queryByText('External Search Result')).toBeNull();
    expect(container.querySelector('.lyrics-mv-artwork img')?.getAttribute('src')).toBe('echo-cover://thumb/test');
  });

  it('refreshes an unplayable search-selected MV before showing it as unavailable', async () => {
    const externalCandidate = makeVideo({
      id: 'video-external',
      sourceType: 'search_candidate',
      provider: 'bilibili',
      sourceId: 'BV1external',
      playableInApp: false,
      mediaUrl: null,
      title: 'External Search Result',
    });
    const playableCandidate = makeVideo({
      id: 'video-playable',
      sourceType: 'search_candidate',
      provider: 'bilibili',
      sourceId: 'BV1playable',
      mediaUrl: 'echo-mv://stream/video-playable/bilibili-qn-80',
      title: 'Playable Search Result',
    });
    const getSelected = vi.fn().mockResolvedValueOnce(externalCandidate).mockResolvedValueOnce(playableCandidate);
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      mv: {
        getSelected,
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn(async (videoId: string) => ({
          video: videoId === playableCandidate.id ? playableCandidate : externalCandidate,
          variants: [],
        })),
        setQuality: vi.fn(),
        setOffset: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn(),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    await waitFor(() => expect(window.echo.mv.searchNetworkCandidates).toHaveBeenCalledWith('track-1'));
    await waitFor(() => expect(getSelected).toHaveBeenCalledTimes(2));
    expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-mv://stream/video-playable/bilibili-qn-80');
    expect(screen.queryByText('MV unavailable')).toBeNull();
  });

  it('keeps a playable MV visible when a stream refresh degrades to external-only', async () => {
    const playableVideo = makeVideo({
      id: 'video-playable',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      sourceId: 'BV1playable',
      mediaUrl: 'echo-mv://stream/video-playable/bilibili-qn-80',
      qualityLabel: '1080p',
    });
    const externalRefresh = {
      ...playableVideo,
      playableInApp: false,
      mediaUrl: null,
      qualityLabel: null,
    };
    window.echo = {
      playback: {
        seek: vi.fn(),
      },
      mv: {
        getSelected: vi.fn().mockResolvedValue(playableVideo),
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        getTemporaryPlayableForSnapshot: vi.fn().mockResolvedValue(null),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn().mockResolvedValue({ video: externalRefresh, variants: [] }),
        setQuality: vi.fn(),
        setOffset: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn(),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    await waitFor(() => expect(window.echo.mv.resolveStreams).toHaveBeenCalledWith('video-playable'));
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-mv://stream/video-playable/bilibili-qn-80'));
    expect(screen.queryByText('MV unavailable')).toBeNull();
  });

  it('falls back to the track cover when the selected MV thumbnail fails to load', async () => {
    const { container } = renderPanel(
      makeVideo({
        playableInApp: false,
        mediaUrl: null,
        thumbnailUrl: 'https://i.example/broken-mv-thumb.jpg',
      }),
    );

    const artwork = await waitFor(() => {
      const image = container.querySelector('.lyrics-mv-artwork img') as HTMLImageElement | null;
      expect(image?.getAttribute('src')).toBe('https://i.example/broken-mv-thumb.jpg');
      return image!;
    });

    fireEvent.error(artwork);

    await waitFor(() =>
      expect(container.querySelector('.lyrics-mv-artwork img')?.getAttribute('src')).toBe('echo-cover://thumb/test'),
    );
  });

  it('refreshes when the MV binding changes elsewhere', async () => {
    renderPanel(null);

    await waitFor(() => expect(window.echo.mv.getSelected).toHaveBeenCalled());
    const initialCallCount = vi.mocked(window.echo.mv.getSelected).mock.calls.length;
    window.dispatchEvent(new CustomEvent('mv:changed', { detail: { trackId: 'track-1' } }));

    await waitFor(() => expect(window.echo.mv.getSelected).toHaveBeenCalledTimes(initialCallCount + 1));
  });

  it('keeps the current MV visible while a manual MV switch is loading', async () => {
    const initialVideo = makeVideo({ id: 'video-1', mediaUrl: 'echo-video://mv/video-1' });
    const nextVideo = makeVideo({ id: 'video-2', mediaUrl: 'echo-video://mv/video-2', title: 'Next MV' });
    let resolveNextSelected: (value: TrackVideo | null) => void = () => undefined;
    const getSelected = vi
      .fn()
      .mockResolvedValueOnce(initialVideo)
      .mockReturnValueOnce(new Promise<TrackVideo | null>((resolve) => {
        resolveNextSelected = resolve;
      }));

    window.echo = {
      mv: {
        getSelected,
        getSettings: vi.fn().mockResolvedValue(defaultMvSettings),
        setSettings: vi.fn(),
        findLocalCandidates: vi.fn().mockResolvedValue([]),
        searchNetworkCandidates: vi.fn().mockResolvedValue([]),
        getCandidates: vi.fn().mockResolvedValue([]),
        resolveStreams: vi.fn(async (videoId: string) => ({
          video: videoId === nextVideo.id ? nextVideo : initialVideo,
          variants: [],
        })),
        setQuality: vi.fn(),
        setOffset: vi.fn(),
        chooseLocalVideo: vi.fn().mockResolvedValue(null),
        bindLocalVideo: vi.fn(),
        selectVideo: vi.fn(),
        clearSelected: vi.fn(),
        openExternal: vi.fn(),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <MvPanel
        trackId="track-1"
        title="Test Song"
        artist="Test Artist"
        coverUrl="echo-cover://thumb/test"
        isAudioPlaying
        audioClock={makeAudioClock(0)}
      />,
    );

    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/video-1'));

    act(() => {
      window.dispatchEvent(new CustomEvent('mv:changed', { detail: { trackId: 'track-1' } }));
    });

    await waitFor(() => expect(getSelected).toHaveBeenCalledTimes(2));
    expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/video-1');
    expect(screen.queryByText('Loading MV')).toBeNull();

    await act(async () => {
      resolveNextSelected(nextVideo);
    });

    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/video-2'));
  });

  it('does not reload the selected MV for lyrics display setting changes', async () => {
    const { container } = renderPanel(makeVideo());

    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/video-1'));
    const initialCallCount = vi.mocked(window.echo.mv.getSelected).mock.calls.length;

    act(() => {
      window.dispatchEvent(
        new CustomEvent('settings:changed', {
          detail: {
            lyricsFontSizePx: 44,
            lyricsSecondaryFontSizePx: 24,
            lyricsContextOpacityPercent: 64,
          },
        }),
      );
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(window.echo.mv.getSelected).toHaveBeenCalledTimes(initialCallCount);
    expect(container.querySelector('video')?.getAttribute('src')).toBe('echo-video://mv/video-1');
  });

  it('applies immersive visual setting patches without reloading settings or the selected MV', async () => {
    const { container } = renderPanel(makeVideo(), true, {
      ...defaultMvSettings,
      immersiveBackground: true,
    });

    const background = await waitFor(() => {
      const element = container.querySelector('.lyrics-mv-background') as HTMLElement | null;
      expect(element).toBeTruthy();
      return element!;
    });
    const initialSettingsCallCount = vi.mocked(window.echo.mv.getSettings).mock.calls.length;
    const initialSelectedCallCount = vi.mocked(window.echo.mv.getSelected).mock.calls.length;

    act(() => {
      window.dispatchEvent(
        new CustomEvent('settings:changed', {
          detail: {
            immersiveBackgroundBlurPx: 12,
            immersiveBackgroundBrightnessPercent: 82,
            immersiveBackgroundOverlayOpacityPercent: 44,
            immersiveBackgroundScalePercent: 138,
          },
        }),
      );
    });

    await waitFor(() => expect(background.style.getPropertyValue('--mv-immersive-blur')).toBe('12px'));
    expect(background.style.getPropertyValue('--mv-immersive-brightness')).toBe('82%');
    expect(background.style.getPropertyValue('--mv-immersive-overlay-opacity')).toBe('0.44');
    expect(background.style.getPropertyValue('--mv-immersive-scale')).toBe('1.38');
    expect(window.echo.mv.getSettings).toHaveBeenCalledTimes(initialSettingsCallCount);
    expect(window.echo.mv.getSelected).toHaveBeenCalledTimes(initialSelectedCallCount);
  });
});
