// @vitest-environment jsdom
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LibraryTrack } from '../../../shared/types/library';
import type { MvMatchCandidate, MvSettings, TrackVideo } from '../../../shared/types/mv';
import { I18nProvider } from '../../i18n/I18nProvider';
import { PlaybackQueueProvider, usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { MvSettingsDrawer } from './MvSettingsDrawer';

const makeTrack = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\song.flac',
  title: 'Test Song',
  artist: 'Test Artist',
  album: 'Test Album',
  albumArtist: 'Test Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
  ...overrides,
});

const makeStreamingTrack = (): LibraryTrack => ({
  ...makeTrack(),
  id: 'streaming:qqmusic:song-mid',
  mediaType: 'streaming',
  isTemporary: true,
  path: 'streaming:qqmusic:song-mid',
  provider: 'qqmusic',
  providerTrackId: 'song-mid',
  stableKey: 'streaming:qqmusic:song-mid',
  title: '新時代',
  artist: 'Ado',
  album: 'UTA',
  albumArtist: 'Ado',
  coverThumb: 'echo-cover://thumb/streaming',
});

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

const makeCandidate = (): MvMatchCandidate => ({
  id: 'candidate-1',
  provider: 'local',
  sourceType: 'sidecar',
  title: 'Test Song',
  artist: 'Test Artist',
  filePath: null,
  url: null,
  providerUrl: null,
  thumbnailUrl: null,
  uploader: null,
  availableQualities: [],
  durationSeconds: null,
  score: 0.95,
  playableInApp: true,
  reasons: ['same basename'],
});

const defaultMvSettings: MvSettings = {
  autoSearch: true,
  autoPreload: true,
  restartAudioOnLoad: false,
  enabledProviders: ['bilibili', 'youtube'],
  providerOrder: ['bilibili', 'youtube'],
  maxQuality: 'max',
  allow60fps: true,
};

const QueueSeed = ({
  children,
  currentTrackId,
  track,
  tracks,
}: {
  children: JSX.Element;
  currentTrackId?: string;
  track: LibraryTrack;
  tracks?: LibraryTrack[];
}): JSX.Element => {
  const { replaceQueue, setCurrentTrackId } = usePlaybackQueue();

  useEffect(() => {
    replaceQueue(tracks ?? [track]);
    setCurrentTrackId(currentTrackId ?? track.id);
  }, [currentTrackId, replaceQueue, setCurrentTrackId, track, tracks]);

  return children;
};

const renderDrawer = (
  settings: MvSettings = defaultMvSettings,
  selectedVideo: TrackVideo | null = null,
  track: LibraryTrack = makeTrack(),
  options: {
    audioTrackId?: string | null;
    playbackTrackId?: string | null;
    queueCurrentTrackId?: string;
    queueTracks?: LibraryTrack[];
  } = {},
) => {
  window.localStorage.setItem('echo-next.locale', 'en-US');
  const audioTrackId = options.audioTrackId ?? track.id;
  const playbackTrackId = options.playbackTrackId ?? track.id;
  window.echo = {
    mv: {
      getSelected: vi.fn().mockResolvedValue(selectedVideo),
      getSettings: vi.fn().mockResolvedValue(settings),
      setSettings: vi.fn().mockImplementation(async (patch: Partial<MvSettings>) => ({ ...settings, ...patch })),
      findLocalCandidates: vi.fn().mockResolvedValue([makeCandidate()]),
      searchNetworkCandidates: vi.fn().mockResolvedValue([]),
      searchNetworkCandidatesForSnapshot: vi.fn().mockResolvedValue([]),
      getCandidates: vi.fn().mockResolvedValue([]),
      resolveStreams: vi.fn().mockImplementation(async () => ({ video: selectedVideo ?? makeVideo(), variants: [] })),
      setQuality: vi.fn(),
      setOffset: vi.fn(async (_trackId: string, offsetMs: number) => (selectedVideo ? { ...selectedVideo, offsetMs } : { ...makeVideo(), offsetMs })),
      chooseLocalVideo: vi.fn().mockResolvedValue(makeVideo()),
      bindLocalVideo: vi.fn(),
      bindUrl: vi.fn().mockResolvedValue({ ...makeVideo(), provider: 'bilibili', sourceId: 'BV1ECHO', providerUrl: 'https://www.bilibili.com/video/BV1ECHO' }),
      selectVideo: vi.fn().mockResolvedValue(makeVideo()),
      clearSelected: vi.fn(),
      openExternal: vi.fn(),
    },
    playback: {
      getStatus: vi.fn().mockResolvedValue({
        state: 'playing',
        currentTrackId: playbackTrackId,
        positionMs: 0,
        durationMs: 180000,
        filePath: 'D:\\Music\\song.flac',
      }),
      playLocalFile: vi.fn().mockResolvedValue({
        state: 'playing',
        currentTrackId: 'track-1',
        positionMs: 0,
        durationMs: 180000,
        filePath: 'D:\\Music\\song.flac',
      }),
      playMediaItem: vi.fn(),
      prepareMediaItem: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      openLocalAudioFile: vi.fn(),
      openLocalAudioFiles: vi.fn(),
      resolveLocalAudioFiles: vi.fn(),
      onLocalAudioFilesOpened: vi.fn(),
    },
    audio: {
      getStatus: vi.fn().mockResolvedValue({
        state: 'playing',
        currentTrackId: audioTrackId,
        currentFilePath: 'D:\\Music\\song.flac',
        positionSeconds: 0,
        durationSeconds: 180,
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        bitrate: null,
        codec: 'flac',
        outputSampleRate: 44100,
        playbackRate: 1,
      }),
    },
    app: {
      getSettings: vi.fn().mockResolvedValue({ lyricsMvAutoShowTrackInfoDisabled: true }),
      setSettings: vi.fn().mockResolvedValue({ lyricsHeaderHidden: false }),
    },
  } as unknown as Window['echo'];

  return render(
    <I18nProvider>
      <PlaybackQueueProvider>
        <QueueSeed currentTrackId={options.queueCurrentTrackId} track={track} tracks={options.queueTracks}>
          <MvSettingsDrawer isOpen onClose={vi.fn()} />
        </QueueSeed>
      </PlaybackQueueProvider>
    </I18nProvider>,
  );
};

const expandNetworkSection = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: /Expand network sources/ }));
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('MvSettingsDrawer', () => {
  it('syncs hidden lyrics song info from the MV master switch when enabled', async () => {
    const { container } = renderDrawer({ ...defaultMvSettings, enabled: true });

    const masterToggle = container.querySelector('.mv-master-toggle') as HTMLButtonElement;
    await waitFor(() => expect(masterToggle).toBeTruthy());
    fireEvent.click(masterToggle);

    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ enabled: false }));
    await waitFor(() => expect(window.echo.app.setSettings).toHaveBeenCalledWith({ lyricsHeaderHidden: false }));
  });

  it('shows selected MV title and video quality in the engine meter', async () => {
    renderDrawer(defaultMvSettings, { ...makeVideo(), width: 1920, height: 1080, fps: 60, qualityLabel: null });

    const engineMeter = within(await screen.findByLabelText('MV engine status'));
    expect(engineMeter.getByText('MV Title')).toBeTruthy();
    expect(engineMeter.getByText('Test Song MV')).toBeTruthy();
    expect(engineMeter.getByText('1080p / 60fps')).toBeTruthy();
    expect(engineMeter.queryByText('Network')).toBeNull();
  });

  it('can hide lyrics only while the MV view is open', async () => {
    renderDrawer({ ...defaultMvSettings, hideLyrics: false });
    await expandNetworkSection();

    const hideLyricsToggle = (await screen.findByText('Hide lyrics in MV view')).closest('button');
    expect(hideLyricsToggle).toBeTruthy();
    fireEvent.click(hideLyricsToggle!);

    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ hideLyrics: true }));
  });

  it('prefers the resolved video dimensions over a stale resolution quality label', async () => {
    renderDrawer(defaultMvSettings, {
      ...makeVideo(),
      provider: 'bilibili',
      width: 1920,
      height: 1080,
      qualityLabel: '8K',
    });

    const engineMeter = within(await screen.findByLabelText('MV engine status'));
    expect(engineMeter.getByText('1080p')).toBeTruthy();
    expect(engineMeter.queryByText('8K')).toBeNull();
    expect(await screen.findByText('Bilibili / 1080p')).toBeTruthy();
  });

  it('shows the platform quality for letterboxed 1080p60 streams instead of the encoded height', async () => {
    renderDrawer(defaultMvSettings, {
      ...makeVideo(),
      provider: 'bilibili',
      width: 1920,
      height: 888,
      qualityLabel: '1080p 60fps',
      fps: 60,
    });

    const engineMeter = within(await screen.findByLabelText('MV engine status'));
    expect(engineMeter.getByText('1080p 60fps')).toBeTruthy();
    expect(engineMeter.queryByText('888p / 60fps')).toBeNull();
    expect(await screen.findByText('Bilibili / 1080p 60fps')).toBeTruthy();
  });

  it('shows 4K 120fps quality without downgrading the label to 60fps', async () => {
    renderDrawer(defaultMvSettings, {
      ...makeVideo(),
      provider: 'bilibili',
      width: 3840,
      height: 2160,
      qualityLabel: '4K 120fps',
      fps: 120,
    });

    const engineMeter = within(await screen.findByLabelText('MV engine status'));
    expect(engineMeter.getByText('4K 120fps')).toBeTruthy();
    expect(engineMeter.queryByText('4K / 60fps')).toBeNull();
    expect(await screen.findByText('Bilibili / 4K 120fps')).toBeTruthy();
  });

  it('contains the MV choose action and omits the local search shortcut', async () => {
    renderDrawer();

    expect(await screen.findByRole('button', { name: /Import local video/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Find local/ })).toBeNull();
  });

  it('chooses a local MV file from the drawer', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: /Import local video/ }));

    await waitFor(() => expect(window.echo.mv.chooseLocalVideo).toHaveBeenCalledWith('track-1'));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'mv:changed' }));
    await waitFor(() =>
      expect(window.echo.playback.playLocalFile).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: 'D:\\Music\\song.flac', trackId: 'track-1' }),
      ),
    );
  });

  it('does not replay the current track when replay on MV change is disabled', async () => {
    renderDrawer({ ...defaultMvSettings, replayAudioOnChange: false });

    fireEvent.click(await screen.findByRole('button', { name: /Import local video/ }));

    await waitFor(() => expect(window.echo.mv.chooseLocalVideo).toHaveBeenCalledWith('track-1'));
    expect(window.echo.playback.playLocalFile).not.toHaveBeenCalled();
  });

  it('updates the max network quality from the drawer menu', async () => {
    renderDrawer();
    await expandNetworkSection();

    fireEvent.click(await screen.findByRole('button', { name: /Max quality Max/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '4K' }));

    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ maxQuality: '2160p' }));
  });

  it('places the max quality control before the network source order list', async () => {
    renderDrawer();
    await expandNetworkSection();

    const maxQualityTrigger = await screen.findByRole('button', { name: /Max quality Max/ });
    const bilibiliToggle = await screen.findByRole('button', { name: 'Bilibili' });

    expect(Boolean(maxQualityTrigger.compareDocumentPosition(bilibiliToggle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('toggles automatic MV search from the drawer', async () => {
    renderDrawer();
    await expandNetworkSection();

    fireEvent.click(await screen.findByRole('button', { name: /Auto search network MV/ }));

    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ autoSearch: false }));
  });

  it('toggles the top-level MV switch from the top of the drawer', async () => {
    renderDrawer();

    const toggle = await screen.findByRole('button', { name: /Enable MV/ });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle);

    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ enabled: false }));
  });

  it('keeps network sources collapsed by default', async () => {
    renderDrawer();

    expect((await screen.findByRole('button', { name: /Expand network sources/ })).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /Auto search network MV/ })).toBeNull();
  });

  it('updates the automatic MV apply threshold from the drawer', async () => {
    renderDrawer();
    await expandNetworkSection();

    const slider = await screen.findByRole('slider', { name: /Auto-apply match/ });
    expect((slider as HTMLInputElement).value).toBe('70');
    expect((slider as HTMLInputElement).min).toBe('30');

    fireEvent.change(slider, { target: { value: '30' } });

    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ autoApplyThreshold: 0.3 }));
  });

  it('toggles MV preload, restart sync, and replay on change from the drawer', async () => {
    renderDrawer();
    await expandNetworkSection();

    fireEvent.click(await screen.findByRole('button', { name: /Preload MV/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Follow music progress/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Precise' }));
    fireEvent.click(await screen.findByRole('button', { name: /Replay music after switching MV/ }));

    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ autoPreload: false }));
    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ restartAudioOnLoad: true }));
    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ syncMode: 'precise' }));
    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ replayAudioOnChange: false }));
  });

  it('shows immersive MV controls and updates zoom', async () => {
    renderDrawer();
    await expandNetworkSection();

    expect(await screen.findByRole('button', { name: /Immersive MV background/ })).toBeTruthy();
    expect(screen.queryByRole('slider', { name: /Background zoom/ })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Immersive background tuning/ }));
    expect(window.localStorage.getItem('echo-next.mv.immersive-controls-open')).toBe('true');
    const slider = screen.getByRole('slider', { name: /Background zoom/ });
    expect((slider as HTMLInputElement).value).toBe('115');
    fireEvent.click(await screen.findByRole('button', { name: /Auto scale/ }));

    fireEvent.change(slider, { target: { value: '140' } });

    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ immersiveBackgroundAutoScale: false }));
    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ immersiveBackgroundScalePercent: 140 }));
  });

  it('updates immersive MV visual tuning controls', async () => {
    renderDrawer();
    await expandNetworkSection();

    fireEvent.click(await screen.findByRole('button', { name: /Immersive background tuning/ }));
    const blur = await screen.findByRole('slider', { name: /Glass blur/ });
    const brightness = screen.getByRole('slider', { name: /Background brightness/ });
    const overlay = screen.getByRole('slider', { name: /Dark overlay/ });

    expect((blur as HTMLInputElement).value).toBe('0');
    expect((brightness as HTMLInputElement).value).toBe('100');
    expect((overlay as HTMLInputElement).value).toBe('0');
    expect(screen.queryByRole('slider', { name: /Horizontal position/ })).toBeNull();
    expect(screen.queryByRole('slider', { name: /Vertical position/ })).toBeNull();

    fireEvent.change(blur, { target: { value: '10' } });
    fireEvent.change(brightness, { target: { value: '118' } });
    fireEvent.change(overlay, { target: { value: '35' } });

    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ immersiveBackgroundBlurPx: 10 }));
    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ immersiveBackgroundBrightnessPercent: 118 }));
    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ immersiveBackgroundOverlayOpacityPercent: 35 }));
  });

  it('does not show lyrics readability enhancement in the MV drawer', async () => {
    renderDrawer();
    await expandNetworkSection();

    expect(await screen.findByRole('button', { name: /Immersive MV background/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Lyrics readability boost/ })).toBeNull();
  });

  it('saves MV offset from the MV drawer', async () => {
    const { container } = renderDrawer(defaultMvSettings, makeVideo());

    await waitFor(() => expect(screen.getByLabelText('MV sync offset')).toBeTruthy());
    expect(screen.queryByRole('slider', { name: /MV sync offset slider/ })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /MV sync calibration/ }));
    fireEvent.click(screen.getByTitle('MV earlier 500ms'));

    await waitFor(() => expect(window.echo.mv.setOffset).toHaveBeenCalledWith('track-1', 500));
    expect(container.querySelector('.mv-offset-collapse-toggle strong')?.textContent).toBe('+500ms');
  });

  it('saves a larger MV offset from the range and number controls', async () => {
    const { container } = renderDrawer(defaultMvSettings, makeVideo());

    fireEvent.click(await screen.findByRole('button', { name: /MV sync calibration/ }));
    fireEvent.change(await screen.findByRole('slider', { name: /MV sync offset slider/ }), { target: { value: '45000' } });

    await waitFor(() => expect(window.echo.mv.setOffset).toHaveBeenCalledWith('track-1', 45000));
    expect(container.querySelector('.mv-offset-collapse-toggle strong')?.textContent).toBe('+45s');

    fireEvent.change(screen.getByRole('spinbutton', { name: /Offset seconds/ }), { target: { value: '-600' } });

    await waitFor(() => expect(window.echo.mv.setOffset).toHaveBeenLastCalledWith('track-1', -600000));
    expect(container.querySelector('.mv-offset-collapse-toggle strong')?.textContent).toBe('-600s');
  });

  it('sets the MV start second for the current song', async () => {
    const { container } = renderDrawer(defaultMvSettings, makeVideo());

    fireEvent.change(await screen.findByRole('spinbutton', { name: /MV start second/ }), { target: { value: '12.5' } });

    await waitFor(() => expect(window.echo.mv.setOffset).toHaveBeenCalledWith('track-1', 12500));
    expect(container.querySelector('.mv-offset-collapse-toggle strong')?.textContent).toBe('+12.5s');

    fireEvent.change(screen.getByRole('spinbutton', { name: /MV start second/ }), { target: { value: '600' } });

    await waitFor(() => expect(window.echo.mv.setOffset).toHaveBeenLastCalledWith('track-1', 600000));
    expect(container.querySelector('.mv-offset-collapse-toggle strong')?.textContent).toBe('+600s');
  });

  it('replays the current song from the MV start point button', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    renderDrawer(defaultMvSettings, makeVideo({ offsetMs: 40000 }));

    const replayButton = await screen.findByRole('button', { name: /Replay the current song/ });
    await waitFor(() => expect((replayButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(replayButton);

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'mv:changed' }));
    await waitFor(() =>
      expect(window.echo.playback.playLocalFile).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: 'D:\\Music\\song.flac', trackId: 'track-1' }),
      ),
    );
  });

  it('resets immersive MV background tuning', async () => {
    renderDrawer({
      ...defaultMvSettings,
      immersiveBackgroundScalePercent: 160,
      immersiveBackgroundOffsetXPercent: 12,
      immersiveBackgroundOffsetYPercent: 88,
      immersiveBackgroundBlurPx: 16,
      immersiveBackgroundBrightnessPercent: 70,
      immersiveBackgroundOverlayOpacityPercent: 80,
    });
    await expandNetworkSection();

    fireEvent.click(await screen.findByRole('button', { name: /Immersive background tuning/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Reset immersive background/ }));

    await waitFor(() =>
      expect(window.echo.mv.setSettings).toHaveBeenCalledWith({
        immersiveBackgroundAutoScale: true,
        immersiveBackgroundScalePercent: 115,
        immersiveBackgroundOffsetXPercent: 50,
        immersiveBackgroundOffsetYPercent: 50,
        immersiveBackgroundBlurPx: 0,
        immersiveBackgroundBrightnessPercent: 100,
        immersiveBackgroundOverlayOpacityPercent: 0,
      }),
    );
  });

  it('reorders network sources by dragging the priority handle', async () => {
    renderDrawer();
    await expandNetworkSection();

    const dragData = {
      effectAllowed: '',
      dropEffect: '',
      getData: vi.fn(() => 'bilibili'),
      setData: vi.fn(),
    };

    const youtubeRow = screen.getByRole('button', { name: 'YouTube' }).closest('.mv-source-row');
    expect(youtubeRow).toBeTruthy();

    fireEvent.dragStart(await screen.findByRole('button', { name: /Drag Bilibili/ }), { dataTransfer: dragData });
    fireEvent.dragOver(youtubeRow as Element, { dataTransfer: dragData });
    fireEvent.drop(youtubeRow as Element, { dataTransfer: dragData });

    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ providerOrder: ['youtube', 'bilibili'] }));
  });

  it('refreshes the current MV when automatic MV search is enabled', async () => {
    renderDrawer({ ...defaultMvSettings, autoSearch: false });
    await expandNetworkSection();

    fireEvent.click(await screen.findByRole('button', { name: /Auto search network MV/ }));

    await waitFor(() => expect(window.echo.mv.setSettings).toHaveBeenCalledWith({ autoSearch: true }));
    await waitFor(() => expect(window.echo.mv.searchNetworkCandidates).toHaveBeenCalledWith('track-1', 'Test Song Test Artist'));
  });

  it('searches network MVs with the custom query input', async () => {
    renderDrawer();

    const input = await screen.findByRole('textbox', { name: /MV search keywords/ });
    expect((input as HTMLInputElement).value).toBe('Test Song Test Artist');

    fireEvent.change(input, { target: { value: 'Roselia HEROIC ADVENT' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Search network MV/ })[1]);

    await waitFor(() => expect(window.echo.mv.searchNetworkCandidates).toHaveBeenCalledWith('track-1', 'Roselia HEROIC ADVENT'));
  });

  it('applies searched MV candidates to the audio status track when the queue is stale', async () => {
    const staleTrack = makeTrack({ id: 'track-stale', title: 'Stale Song' });
    const currentTrack = makeTrack({ id: 'track-current', title: 'Current Song' });
    const currentCandidate = { ...makeCandidate(), id: 'candidate-current', title: 'Current Song MV' };
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    renderDrawer(defaultMvSettings, null, currentTrack, {
      audioTrackId: currentTrack.id,
      playbackTrackId: staleTrack.id,
      queueCurrentTrackId: staleTrack.id,
      queueTracks: [staleTrack, currentTrack],
    });
    vi.mocked(window.echo.mv.searchNetworkCandidates).mockResolvedValue([currentCandidate]);
    vi.mocked(window.echo.mv.selectVideo).mockResolvedValue(makeVideo({ id: currentCandidate.id, trackId: currentTrack.id }));

    const input = await screen.findByRole('textbox', { name: /MV search keywords/ });
    fireEvent.change(input, { target: { value: 'Current Song MV' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Search network MV/ })[1]);
    fireEvent.click(await screen.findByRole('button', { name: /Current Song MV/ }));

    await waitFor(() => expect(window.echo.mv.searchNetworkCandidates).toHaveBeenCalledWith(currentTrack.id, 'Current Song MV'));
    await waitFor(() => expect(window.echo.mv.selectVideo).toHaveBeenCalledWith(currentTrack.id, currentCandidate.id));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { trackId: currentTrack.id },
        type: 'mv:changed',
      }),
    );
  });

  it('keeps the current MV selected when a searched candidate can only open externally', async () => {
    const selectedVideo = makeVideo({ id: 'video-current', title: 'Current playable MV' });
    const externalCandidate = { ...makeCandidate(), id: 'candidate-external', title: 'External Only MV', provider: 'bilibili' as const };
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    renderDrawer(defaultMvSettings, selectedVideo);
    vi.mocked(window.echo.mv.searchNetworkCandidates).mockResolvedValue([externalCandidate]);
    vi.mocked(window.echo.mv.selectVideo).mockRejectedValue(new Error('此 MV 暂时无法在应用内播放，可外部打开。'));

    const input = await screen.findByRole('textbox', { name: /MV search keywords/ });
    fireEvent.change(input, { target: { value: 'External Only MV' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Search network MV/ })[1]);
    const candidateButton = await screen.findByRole('button', { name: /External Only MV/ });
    dispatchSpy.mockClear();
    fireEvent.click(candidateButton);

    await waitFor(() => expect(window.echo.mv.selectVideo).toHaveBeenCalledWith('track-1', 'candidate-external'));
    expect(await screen.findByText('此 MV 暂时无法在应用内播放，可外部打开。')).toBeTruthy();
    expect(screen.getAllByText('Current playable MV').length).toBeGreaterThan(0);
    expect(dispatchSpy.mock.calls.some(([event]) => event instanceof CustomEvent && event.type === 'mv:changed')).toBe(false);
  });

  it('shows an empty network search result as a neutral status', async () => {
    renderDrawer();

    await screen.findByRole('textbox', { name: /MV search keywords/ });
    fireEvent.click(screen.getAllByRole('button', { name: /Search network MV/ })[1]);

    const notice = await screen.findByText('No network MV candidates found');
    expect(notice.className).toContain('mv-settings-search-empty');
    expect(notice.className).not.toContain('mv-settings-search-error');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('waits for the selected MV refresh before enabling searched candidates', async () => {
    let resolveSelectedAfterSearch: (video: TrackVideo | null) => void = () => undefined;
    const firstCandidate = { ...makeCandidate(), id: 'candidate-auto', title: 'Auto Selected MV' };
    const secondCandidate = { ...makeCandidate(), id: 'candidate-manual', title: 'Manual Choice MV', score: 0.83 };

    renderDrawer();
    vi.mocked(window.echo.mv.searchNetworkCandidates).mockResolvedValue([firstCandidate, secondCandidate]);

    await screen.findByRole('textbox', { name: /MV search keywords/ });
    await waitFor(() => expect(window.echo.mv.getSelected).toHaveBeenCalledWith('track-1'));
    vi.mocked(window.echo.mv.getSelected).mockReturnValueOnce(
      new Promise<TrackVideo | null>((resolve) => {
        resolveSelectedAfterSearch = resolve;
      }),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /Search network MV/ })[1]);

    await waitFor(() => expect(window.echo.mv.searchNetworkCandidates).toHaveBeenCalledWith('track-1', 'Test Song Test Artist'));
    expect(screen.queryByRole('button', { name: /Manual Choice MV/ })).toBeNull();

    await act(async () => {
      resolveSelectedAfterSearch(makeVideo());
    });

    expect((await screen.findByRole('button', { name: /Manual Choice MV/ })).hasAttribute('disabled')).toBe(false);
  });

  it('searches streaming tracks through the snapshot MV API', async () => {
    const streamingTrack = makeStreamingTrack();
    const streamingCandidate: MvMatchCandidate = {
      ...makeCandidate(),
      id: 'bilibili:BVstream',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: '新時代 MV',
      artist: 'Ado',
      url: 'https://www.bilibili.com/video/BVstream',
      providerUrl: 'https://www.bilibili.com/video/BVstream',
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    renderDrawer(defaultMvSettings, null, streamingTrack);
    vi.mocked(window.echo.mv.searchNetworkCandidatesForSnapshot).mockResolvedValue([streamingCandidate]);

    const input = await screen.findByRole('textbox', { name: /MV search keywords/ });
    expect((input as HTMLInputElement).value).toBe('新時代 Ado');

    fireEvent.click(screen.getAllByRole('button', { name: /Search network MV/ })[1]);

    await waitFor(() =>
      expect(window.echo.mv.searchNetworkCandidatesForSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: 'streaming:qqmusic:song-mid',
          title: '新時代',
          artist: 'Ado',
          mediaType: 'streaming',
          query: '新時代 Ado',
        }),
      ),
    );
    expect(window.echo.mv.searchNetworkCandidates).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByText('新時代 MV').length).toBeGreaterThan(0));
  });

  it('matches Spotify playback IDs to the queued streaming track before MV search', async () => {
    const spotifyTrack = makeTrack({
      id: 'spotify-row-1',
      mediaType: 'streaming',
      isTemporary: false,
      path: 'streaming:spotify:6A8NfypDHuwlWbo4aIYca',
      provider: 'spotify',
      providerTrackId: '6A8NfypDHuwlWbo4aIYca',
      stableKey: 'streaming:spotify:6A8NfypDHuwlWbo4aIYca',
      title: 'New Genesis',
      artist: 'Ado',
      album: "UTA'S SONGS ONE PIECE FILM RED",
      albumArtist: 'Ado',
    });
    const spotifyCandidate: MvMatchCandidate = {
      ...makeCandidate(),
      id: 'bilibili:BVspotify',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'New Genesis MV',
      artist: 'Ado',
      url: 'https://www.bilibili.com/video/BVspotify',
      providerUrl: 'https://www.bilibili.com/video/BVspotify',
      playableInApp: true,
    };
    const spotifyTrackId = 'streaming:spotify:6A8NfypDHuwlWbo4aIYca';
    renderDrawer(defaultMvSettings, null, spotifyTrack, {
      audioTrackId: spotifyTrackId,
      playbackTrackId: spotifyTrackId,
      queueCurrentTrackId: spotifyTrack.id,
    });
    vi.mocked(window.echo.mv.searchNetworkCandidatesForSnapshot).mockResolvedValue([spotifyCandidate]);

    const input = await screen.findByRole('textbox', { name: /MV search keywords/ });
    expect((input as HTMLInputElement).value).toBe('New Genesis Ado');

    fireEvent.click(screen.getAllByRole('button', { name: /Search network MV/ })[1]);

    await waitFor(() =>
      expect(window.echo.mv.searchNetworkCandidatesForSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: spotifyTrackId,
          title: 'New Genesis',
          artist: 'Ado',
          mediaType: 'streaming',
          query: 'New Genesis Ado',
        }),
      ),
    );
    expect(window.echo.mv.searchNetworkCandidates).not.toHaveBeenCalled();
  });

  it('selects streaming MV candidates with the streaming track key', async () => {
    const streamingTrack = makeStreamingTrack();
    const streamingCandidate: MvMatchCandidate = {
      ...makeCandidate(),
      id: 'bilibili:BVstream',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: '新時代 MV',
      artist: 'Ado',
      url: 'https://www.bilibili.com/video/BVstream',
      providerUrl: 'https://www.bilibili.com/video/BVstream',
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    renderDrawer(defaultMvSettings, null, streamingTrack);
    vi.mocked(window.echo.mv.searchNetworkCandidatesForSnapshot).mockResolvedValue([streamingCandidate]);

    fireEvent.click((await screen.findAllByRole('button', { name: /Search network MV/ }))[1]);
    fireEvent.click(await screen.findByRole('button', { name: /新時代 MV/ }));

    await waitFor(() => expect(window.echo.mv.selectVideo).toHaveBeenCalledWith('streaming:qqmusic:song-mid', 'bilibili:BVstream'));
  });

  it('binds a pasted custom MV link to the current track', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    renderDrawer();

    const input = await screen.findByRole('textbox', { name: /Custom MV link/ });
    fireEvent.change(input, { target: { value: 'https://www.bilibili.com/video/BV1ECHO' } });
    fireEvent.click(screen.getByRole('button', { name: /Apply custom MV/ }));

    await waitFor(() => expect(window.echo.mv.bindUrl).toHaveBeenCalledWith('track-1', 'https://www.bilibili.com/video/BV1ECHO'));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'mv:changed' }));
  });

  it('links the custom MV playing status and shows quality with the stream badge', async () => {
    renderDrawer(defaultMvSettings, {
      ...makeVideo(),
      provider: 'bilibili',
      sourceId: 'BV1MNV',
      providerUrl: 'https://www.bilibili.com/video/BV1MNV',
      playableInApp: true,
      qualityLabel: null,
      height: 4320,
    });

    const playingLink = await screen.findByRole('link', { name: /Now playing: Bilibili - BV1MNV/ });
    expect(playingLink.getAttribute('href')).toBe('https://www.bilibili.com/video/BV1MNV');
    fireEvent.click(playingLink);
    expect(window.echo.mv.openExternal).toHaveBeenCalledWith('video-1');

    const badgeRow = screen.getByText('Direct stream (DASH)').closest('.mv-custom-badges');
    expect(badgeRow).toBeTruthy();
    expect(within(badgeRow as HTMLElement).getByText('8K')).toBeTruthy();
  });

  it('notifies the MV panel when network search auto-selects a candidate', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    renderDrawer();
    await screen.findByRole('textbox', { name: /MV search keywords/ });
    vi.mocked(window.echo.mv.getSelected).mockResolvedValue(makeVideo());

    fireEvent.click(await screen.findAllByRole('button', { name: /Search network MV/ }).then((buttons) => buttons[1]));

    await waitFor(() => expect(window.echo.mv.searchNetworkCandidates).toHaveBeenCalledWith('track-1', 'Test Song Test Artist'));
    await waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'mv:changed' })));
  });
});
