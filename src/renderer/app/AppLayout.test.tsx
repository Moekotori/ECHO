// @vitest-environment jsdom
import { useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Captions, ListMusic, Music2 } from 'lucide-react';
import { AppProviders } from './AppProviders';
import { AppLayout } from './AppLayout';
import type { AppRoute } from './routes';
import type { AudioStatus } from '../../shared/types/audio';
import type { DiagnosticMemoryPressureEvent } from '../../shared/types/diagnostics';
import type { LibraryTrack } from '../../shared/types/library';
import type { PlaybackStatus } from '../../shared/types/playback';
import { useAnimatedBackNavigation } from '../hooks/useAnimatedBackNavigation';
import { setPlaybackStatusSnapshot, useSharedPlaybackStatus } from '../stores/playbackStatusStore';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { showAudioErrorNoticeEvent } from '../utils/audioErrorNotice';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 64,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 64 })),
    measureElement: vi.fn(),
  }),
}));

const routes: AppRoute[] = [
  {
    id: 'songs',
    label: 'Songs',
    labelKey: 'route.songs.label',
    description: 'Songs',
    icon: Music2,
    placement: 'main',
    element: <div>Shell page</div>,
  },
  {
    id: 'lyrics',
    label: 'Lyrics',
    labelKey: 'route.lyrics.label',
    description: 'Lyrics',
    icon: Captions,
    placement: 'main',
    chrome: 'standalone',
    element: <div>Standalone lyrics page</div>,
  },
];

const routesWithHome: AppRoute[] = [
  {
    id: 'home',
    label: 'Home',
    labelKey: 'route.home.label',
    description: 'Home',
    icon: Music2,
    placement: 'main',
    element: <div>Home shell</div>,
  },
  ...routes,
];

const routesWithOsuDownloader: AppRoute[] = [
  ...routesWithHome,
  {
    id: 'osu-downloader',
    label: 'osu downloader',
    description: 'osu downloader',
    icon: Music2,
    placement: 'main',
    element: <div>osu downloader shell</div>,
  },
];

const routesWithSettings: AppRoute[] = [
  routesWithHome[0],
  routes[0],
  {
    id: 'settings',
    label: 'Settings',
    labelKey: 'route.settings.label',
    description: 'Settings',
    descriptionKey: 'route.settings.description',
    icon: Music2,
    placement: 'utility',
    element: <div>Settings shell</div>,
  },
];

const routesWithQueue: AppRoute[] = [
  routes[0],
  routes[1],
  {
    id: 'queue',
    label: 'Queue',
    labelKey: 'route.queue.label',
    description: 'Queue',
    icon: ListMusic,
    placement: 'main',
    element: <div>Full queue page</div>,
  },
];

const unlockedDonatorStatus = {
  featureId: 'connect',
  pluginId: 'echo.connect-donator-unlock',
  requiredVersion: 'plugin:echo.connect-donator-unlock:v1',
  unlocked: true,
  pluginInstalled: true,
  pluginEnabled: true,
  hwidHash: 'a'.repeat(64),
  reason: 'unlocked',
  checkedAt: '2026-06-11T00:00:00.000Z',
};

const setViewportSize = (width: number, height: number): void => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
};

const track = (id: string, overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id,
  path: `D:\\Music\\${id}.flac`,
  title: id,
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 180,
  codec: null,
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
  ...overrides,
});

const QueueSetupProbe = ({ tracks, startTrackId }: { tracks: LibraryTrack[]; startTrackId: string }): JSX.Element => {
  const queue = usePlaybackQueue();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    queue.replaceQueue(tracks, { startTrackId });
  }, [queue, startTrackId, tracks]);

  return <div>Queue setup ready</div>;
};

const SharedStatusProbe = (): JSX.Element => {
  useSharedPlaybackStatus();
  return <div>Standalone lyrics page</div>;
};

const LyricsBackProbe = (): JSX.Element => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        window.dispatchEvent(new Event('app:navigate:lyrics-back'));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return <div>Standalone lyrics page</div>;
};

afterEach(() => {
  cleanup();
  setPlaybackStatusSnapshot({
    audioStatus: null,
    playbackStatus: null,
    playbackVisualIntent: null,
    error: null,
  });
  window.sessionStorage.clear();
  window.localStorage.removeItem('echo:diagnostics:crash-notice-enabled');
  vi.useRealTimers();
  vi.restoreAllMocks();
  setViewportSize(1024, 768);
  (window as unknown as { echo?: Window['echo'] }).echo = undefined;
});

describe('AppLayout standalone routes', () => {
  it('forwards one shared playback clock to desktop lyrics', async () => {
    const publishPlaybackStatus = vi.fn();
    const publishAudioStatus = vi.fn();
    const playbackStatus: PlaybackStatus = {
      state: 'playing',
      currentTrackId: 'track-1',
      filePath: 'D:\\Music\\track.flac',
      positionMs: 42000,
      durationMs: 180000,
    };
    const audioStatus = {
      state: 'playing',
      currentTrackId: 'track-1',
      currentFilePath: 'D:\\Music\\track.flac',
      positionSeconds: 42.4,
      durationSeconds: 180,
      playbackRate: 1,
      error: null,
    } as AudioStatus;

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({}),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue(audioStatus),
        onStatus: vi.fn(() => () => undefined),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(null),
        onStatus: vi.fn(() => () => undefined),
      },
      desktopLyrics: {
        getState: vi.fn().mockResolvedValue({ visible: true, locked: false }),
        onStateChanged: vi.fn(() => () => undefined),
        publishAudioStatus,
        publishPlaybackStatus,
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue(playbackStatus),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    act(() => {
      setPlaybackStatusSnapshot({
        playbackStatus,
        audioStatus,
        error: null,
      });
    });

    await waitFor(() => {
      expect(publishAudioStatus).toHaveBeenCalledWith(audioStatus);
    });
    expect(publishPlaybackStatus).not.toHaveBeenCalledWith(playbackStatus);

    act(() => {
      setPlaybackStatusSnapshot({
        playbackStatus,
        audioStatus: null,
        error: null,
      });
    });

    await waitFor(() =>
      expect(publishPlaybackStatus).toHaveBeenCalledWith(playbackStatus),
    );
  });

  it('starts on Home when a home route is available without mounting Songs', async () => {
    window.localStorage.clear();

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routesWithHome} />
      </AppProviders>,
    );

    expect(await screen.findByText('Home shell')).toBeTruthy();
    expect(container.querySelector('[data-route-id="home"]')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('[data-route-id="songs"]')).toBeNull();
  });

  it('falls back to Home when a blocked streaming route is restored from storage', async () => {
    window.localStorage.clear();
    window.localStorage.setItem('echo-next.pending-route', 'streaming');

    const routesWithStreaming: AppRoute[] = [
      routesWithHome[0],
      {
        id: 'streaming',
        label: 'Streaming',
        labelKey: 'route.streaming.label',
        description: 'Streaming',
        icon: Music2,
        placement: 'main',
        element: <div>Streaming shell</div>,
      },
      routes[0],
    ];

    render(
      <AppProviders>
        <AppLayout routes={routesWithStreaming} />
      </AppProviders>,
    );

    expect(await screen.findByText('Home shell')).toBeTruthy();
    expect(screen.queryByText('Streaming shell')).toBeNull();
  });

  it('mounts Songs lazily and keeps it mounted only after the first visit', async () => {
    window.localStorage.clear();
    const onSongsMount = vi.fn();
    const onSongsUnmount = vi.fn();
    const SongsProbe = (): JSX.Element => {
      useEffect(() => {
        onSongsMount();
        return () => onSongsUnmount();
      }, []);

      return <div>Songs lazy probe</div>;
    };
    const localRoutes: AppRoute[] = [
      routesWithHome[0],
      {
        ...routes[0],
        element: <SongsProbe />,
      },
      routes[1],
    ];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByText('Home shell')).toBeTruthy());
    expect(onSongsMount).not.toHaveBeenCalled();

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Songs' }));

    await waitFor(() => expect(onSongsMount).toHaveBeenCalledTimes(1));
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(onSongsUnmount).not.toHaveBeenCalled();
    expect(container.querySelector('[data-route-id="songs"]')?.hasAttribute('hidden')).toBe(true);
  });

  it('returns from Settings to Home by default', async () => {
    window.localStorage.clear();

    render(
      <AppProviders>
        <AppLayout routes={routesWithSettings} />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByText('Home shell')).toBeTruthy());
    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Songs' }));

    await waitFor(() => expect(screen.getByText('Shell page')).toBeTruthy());
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Settings' }));

    await waitFor(() => expect(screen.getByText('Settings shell')).toBeTruthy());
    window.dispatchEvent(new Event('app:navigate:settings-back'));

    await waitFor(() => expect(screen.getByText('Home shell')).toBeTruthy());
    expect(screen.queryByText('Settings shell')).toBeNull();
  });

  it('unmounts History when leaving so heavy stats work cannot stay resident', async () => {
    window.localStorage.clear();
    const onHistoryMount = vi.fn();
    const onHistoryUnmount = vi.fn();
    const HistoryProbe = (): JSX.Element => {
      useEffect(() => {
        onHistoryMount();
        return () => onHistoryUnmount();
      }, []);

      return <div>History transient probe</div>;
    };
    const localRoutes: AppRoute[] = [
      routesWithHome[0],
      routes[0],
      {
        id: 'history',
        label: 'History',
        labelKey: 'route.history.label',
        description: 'History',
        icon: ListMusic,
        placement: 'main',
        element: <HistoryProbe />,
      },
      routes[1],
    ];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByText('Home shell')).toBeTruthy());

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'History' }));

    await waitFor(() => expect(onHistoryMount).toHaveBeenCalledTimes(1));
    expect(container.querySelector('[data-route-id="history"]')?.hasAttribute('hidden')).toBe(false);

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Songs' }));

    await waitFor(() => expect(onHistoryUnmount).toHaveBeenCalledTimes(1));
    expect(container.querySelector('[data-route-id="history"]')).toBeNull();
  });

  it('keeps the playlists route mounted so browse position survives page switches', async () => {
    window.localStorage.clear();
    const onPlaylistsMount = vi.fn();
    const onPlaylistsUnmount = vi.fn();
    const PlaylistsProbe = (): JSX.Element => {
      useEffect(() => {
        onPlaylistsMount();
        return () => onPlaylistsUnmount();
      }, []);

      return (
        <div data-testid="playlist-scroll-probe">
          <div>Playlists persistent probe</div>
        </div>
      );
    };
    const localRoutes: AppRoute[] = [
      routesWithHome[0],
      routes[0],
      {
        id: 'playlists',
        label: 'Playlists',
        labelKey: 'route.playlists.label',
        description: 'Playlists',
        icon: ListMusic,
        placement: 'main',
        element: <PlaylistsProbe />,
      },
      routes[1],
    ];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByText('Home shell')).toBeTruthy());

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Playlists' }));

    const scrollProbe = await screen.findByTestId('playlist-scroll-probe');
    scrollProbe.scrollTop = 480;
    expect(onPlaylistsMount).toHaveBeenCalledTimes(1);

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Songs' }));

    await waitFor(() => expect(container.querySelector('[data-route-id="playlists"]')?.hasAttribute('hidden')).toBe(true));
    expect(onPlaylistsUnmount).not.toHaveBeenCalled();

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Playlists' }));

    await waitFor(() => expect(container.querySelector('[data-route-id="playlists"]')?.hasAttribute('hidden')).toBe(false));
    expect(screen.getByTestId('playlist-scroll-probe').scrollTop).toBe(480);
    expect(onPlaylistsMount).toHaveBeenCalledTimes(1);
    expect(onPlaylistsUnmount).not.toHaveBeenCalled();
  });

  it('lets upper-left chrome notices be closed manually', async () => {
    (window as unknown as { echo?: Window['echo'] }).echo = undefined;

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    fireEvent.click(screen.getByRole('button', { name: /最小化|Minimize/ }));

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /关闭提示|Close notice/ }));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('auto-dismisses upper-left chrome notices after five seconds', async () => {
    vi.useFakeTimers();
    (window as unknown as { echo?: Window['echo'] }).echo = undefined;

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    fireEvent.click(screen.getByRole('button', { name: /最小化|Minimize/ }));
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(screen.getByRole('status')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(document.querySelector('.chrome-notice')?.className).toContain('is-hiding');

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows page notices in the upper-left chrome notice area', async () => {
    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    window.dispatchEvent(new CustomEvent('app:show-chrome-notice', { detail: '随机排序没有稳定位置，当前播放歌曲只能在已加载列表内定位。' }));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('随机排序没有稳定位置，当前播放歌曲只能在已加载列表内定位。'),
    );
  });

  it('suppresses upper-left notices when all notifications are disabled', async () => {
    const getSettings = vi.fn().mockResolvedValue({
      lyricsPlayerBarDrawerEnabled: false,
      notificationsDisabled: true,
      smtcEnabled: true,
    });
    window.echo = {
      app: {
        getSettings,
      },
      diagnostics: {
        getLastCrashSummary: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    window.dispatchEvent(new CustomEvent('app:show-chrome-notice', { detail: 'This should stay hidden' }));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('shows the upcoming track card near the end of the current song when enabled', async () => {
    const getSettings = vi.fn().mockResolvedValue({
      lyricsPlayerBarDrawerEnabled: false,
      notificationsDisabled: false,
      upcomingTrackNoticeEnabled: true,
      smtcEnabled: true,
    });
    window.echo = {
      app: {
        getSettings,
      },
      diagnostics: {
        getLastCrashSummary: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Window['echo'];
    const currentTrack = track('track-current', { title: 'Current Song' });
    const nextTrack = track('track-next', {
      title: 'Next Song',
      artist: 'Next Artist',
      album: 'Next Album',
      coverThumb: 'echo-cover://thumb/next',
    });

    render(
      <AppProviders>
        <QueueSetupProbe tracks={[currentTrack, nextTrack]} startTrackId={currentTrack.id} />
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await screen.findByText('Queue setup ready');

    act(() => {
      setPlaybackStatusSnapshot({
        audioStatus: null,
        playbackStatus: {
          state: 'playing',
          currentTrackId: currentTrack.id,
          filePath: currentTrack.path,
          positionMs: 171_000,
          durationMs: 180_000,
        },
        error: null,
      });
    });

    const notice = await screen.findByText('Next Song');
    const card = notice.closest('.upcoming-track-notice') as HTMLElement;
    expect(card).toBeTruthy();
    await waitFor(() => expect(card.className).toContain('is-visible'));
    expect(card.textContent).toContain('Next Artist');
    expect(card.textContent).toContain('Next Album');
    expect(within(card).getByRole('img', { name: /Next Song/ }).getAttribute('src')).toBe('echo-cover://thumb/next');
  });

  it('shows an upper-left thank-you notice when the donator unlock is verified', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({}),
      },
      connect: {
        getDonatorUnlockStatus: vi.fn().mockResolvedValue(unlockedDonatorStatus),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Pro 已解锁，感谢你的赞助。'));
  });

  it('does not repeat the Pro thank-you notice after the same machine was already thanked', async () => {
    window.localStorage.setItem(
      'echo-next.pro-unlock-thanks:echo.connect-donator-unlock:plugin:echo.connect-donator-unlock:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'shown',
    );
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({}),
      },
      connect: {
        getDonatorUnlockStatus: vi.fn().mockResolvedValue(unlockedDonatorStatus),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByLabelText('ECHO Pro unlocked').textContent).toBe('Pro'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a Pro badge in the titlebar when the donator unlock is verified', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({}),
      },
      connect: {
        getDonatorUnlockStatus: vi.fn().mockResolvedValue(unlockedDonatorStatus),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByLabelText('ECHO Pro unlocked').textContent).toBe('Pro'));
  });

  it('shows an upper-left notice for Windows audio default format warnings', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ lyricsPlayerBarDrawerEnabled: false, smtcEnabled: true }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'idle',
          currentTrackId: null,
          positionMs: 0,
          durationMs: 0,
          filePath: null,
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: null,
          currentFilePath: null,
          positionSeconds: 0,
          durationSeconds: 0,
          warnings: ['windows_audio_default_format_unusual:96000'],
          error: null,
        } as Partial<AudioStatus>),
        onStatus: vi.fn(() => vi.fn()),
      },
      diagnostics: {
        getLastCrashSummary: vi.fn().mockResolvedValue(null),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(null),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('96 kHz'));
    expect(screen.getByRole('status').textContent).toContain('ECHO');
  });

  it('toggles desktop lyrics from the lower-right icon', async () => {
    const show = vi.fn().mockResolvedValue({ visible: true });
    const hide = vi.fn().mockResolvedValue({ visible: false });

    window.echo = {
      desktopLyrics: {
        getState: vi.fn().mockResolvedValue({ visible: false }),
        show,
        hide,
        onStateChanged: vi.fn(() => undefined),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const toggle = await screen.findByRole('button', { name: /桌面歌词|Desktop lyrics/i });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));

    fireEvent.click(toggle);
    await waitFor(() => expect(hide).toHaveBeenCalledTimes(1));
  });

  it('unlocks desktop lyrics from the lower-right icon context menu', async () => {
    const setLocked = vi.fn().mockResolvedValue({ visible: true, locked: false });

    window.echo = {
      desktopLyrics: {
        getState: vi.fn().mockResolvedValue({ visible: true, locked: true }),
        show: vi.fn(),
        hide: vi.fn(),
        setLocked,
        onStateChanged: vi.fn(() => undefined),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const toggle = await screen.findByRole('button', { name: /隐藏桌面歌词|Hide desktop lyrics/i });

    fireEvent.contextMenu(toggle);

    await waitFor(() => expect(setLocked).toHaveBeenCalledWith(false));

    fireEvent.contextMenu(toggle);

    expect(setLocked).toHaveBeenCalledTimes(1);
  });

  it('keeps the abnormal-exit notice off by default', () => {
    const getLastCrashSummary = vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      startedAt: '2026-05-18T00:00:00.000Z',
      detectedAt: '2026-05-18T00:01:00.000Z',
      sessionBasename: 'session-1',
      sessionPathHash: 'hash',
      reason: 'abnormalExit',
    });

    window.echo = {
      diagnostics: {
        getLastCrashSummary,
        openCrashReport: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    expect(getLastCrashSummary).not.toHaveBeenCalled();
    expect(screen.queryByText(/did not exit normally/i)).toBeNull();
  });

  it('opens a markdown crash report from the opt-in abnormal-exit notice', async () => {
    const openCrashReport = vi.fn().mockResolvedValue('D:\\ECHO\\crash-report.md');
    window.localStorage.setItem('echo:diagnostics:crash-notice-enabled', 'true');

    window.echo = {
      diagnostics: {
        getLastCrashSummary: vi.fn().mockResolvedValue({
          sessionId: 'session-1',
          startedAt: '2026-05-18T00:00:00.000Z',
          detectedAt: '2026-05-18T00:01:00.000Z',
          sessionBasename: 'session-1',
          sessionPathHash: 'hash',
          reason: 'abnormalExit',
        }),
        openCrashReport,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByText(/没有正常退出|did not exit normally/i)).toBeTruthy());
    const diagnosticsNotice = screen.getByText(/没有正常退出|did not exit normally/i).closest('.chrome-notice--diagnostics');
    if (!diagnosticsNotice) {
      throw new Error('diagnostics notice was not rendered');
    }
    await waitFor(() => expect(diagnosticsNotice.className).toContain('is-visible'));
    fireEvent.click(within(diagnosticsNotice as HTMLElement).getByRole('button', { name: /打开 Markdown|Open Markdown/i }));

    await waitFor(() => expect(openCrashReport).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Markdown 报告已打开|Markdown report opened/i)).toBeTruthy();
  });

  it('keeps the songs route mounted when navigating away and back', async () => {
    const onSongsMount = vi.fn();
    const onSongsUnmount = vi.fn();
    const SongsProbe = (): JSX.Element => {
      useEffect(() => {
        onSongsMount();
        return () => onSongsUnmount();
      }, []);

      return <div>Songs probe</div>;
    };
    const localRoutes: AppRoute[] = [
      {
        ...routes[0],
        element: <SongsProbe />,
      },
      routes[1],
    ];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    await waitFor(() => expect(onSongsMount).toHaveBeenCalledTimes(1));

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(container.querySelector('[data-route-id="songs"]')?.hasAttribute('hidden')).toBe(true);
    expect(onSongsUnmount).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('app:navigate:lyrics-back'));

    await waitFor(() => expect(container.querySelector('[data-route-id="songs"]')?.hasAttribute('hidden')).toBe(false));
    expect(onSongsMount).toHaveBeenCalledTimes(1);
    expect(onSongsUnmount).not.toHaveBeenCalled();
  });

  it('unmounts hidden persistent routes when memory pressure is reported', async () => {
    const onSongsMount = vi.fn();
    const onSongsUnmount = vi.fn();
    let emitMemoryPressure: ((event: DiagnosticMemoryPressureEvent) => void) | null = null;
    const SongsProbe = (): JSX.Element => {
      useEffect(() => {
        onSongsMount();
        return () => onSongsUnmount();
      }, []);

      return <div>Songs pressure probe</div>;
    };
    const localRoutes: AppRoute[] = [
      {
        ...routes[0],
        element: <SongsProbe />,
      },
      routes[1],
    ];
    window.echo = {
      diagnostics: {
        onMemoryPressure: vi.fn((handler: (event: DiagnosticMemoryPressureEvent) => void) => {
          emitMemoryPressure = handler;
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    await waitFor(() => expect(onSongsMount).toHaveBeenCalledTimes(1));

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(container.querySelector('[data-route-id="songs"]')?.hasAttribute('hidden')).toBe(true));
    expect(onSongsUnmount).not.toHaveBeenCalled();

    act(() => {
      emitMemoryPressure?.({
        timestamp: new Date().toISOString(),
        thresholdBytes: 3 * 1024 * 1024 * 1024,
        totalWorkingSetBytes: 4 * 1024 * 1024 * 1024,
        processCount: 1,
        topProcessType: 'Tab',
        topProcessWorkingSetBytes: 2 * 1024 * 1024 * 1024,
        reportPath: 'memory-pressure-report.md',
      });
    });

    await waitFor(() => expect(container.querySelector('[data-route-id="songs"]')).toBeNull());
    expect(onSongsUnmount).toHaveBeenCalledTimes(1);
  });

  it('keeps the active persistent route mounted when memory pressure is reported', async () => {
    const onSongsMount = vi.fn();
    const onSongsUnmount = vi.fn();
    let emitMemoryPressure: ((event: DiagnosticMemoryPressureEvent) => void) | null = null;
    const SongsProbe = (): JSX.Element => {
      useEffect(() => {
        onSongsMount();
        return () => onSongsUnmount();
      }, []);

      return <div>Songs active pressure probe</div>;
    };
    const localRoutes: AppRoute[] = [
      {
        ...routes[0],
        element: <SongsProbe />,
      },
      routes[1],
    ];
    window.echo = {
      diagnostics: {
        onMemoryPressure: vi.fn((handler: (event: DiagnosticMemoryPressureEvent) => void) => {
          emitMemoryPressure = handler;
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    await waitFor(() => expect(onSongsMount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(emitMemoryPressure).not.toBeNull());

    act(() => {
      emitMemoryPressure?.({
        timestamp: new Date().toISOString(),
        thresholdBytes: 3 * 1024 * 1024 * 1024,
        totalWorkingSetBytes: 4 * 1024 * 1024 * 1024,
        processCount: 1,
        topProcessType: 'Tab',
        topProcessWorkingSetBytes: 2 * 1024 * 1024 * 1024,
        reportPath: 'memory-pressure-report.md',
      });
    });

    expect(container.querySelector('[data-route-id="songs"]')?.hasAttribute('hidden')).toBe(false);
    expect(screen.getByText('Songs active pressure probe')).toBeTruthy();
    expect(onSongsUnmount).not.toHaveBeenCalled();
  });

  it('keeps artist detail mounted when opening lyrics and returning', async () => {
    const onArtistsMount = vi.fn();
    const onArtistsUnmount = vi.fn();
    const ArtistsProbe = (): JSX.Element => {
      const [isDetailOpen, setIsDetailOpen] = useState(false);
      const detailRef = useRef<HTMLDivElement | null>(null);
      const { returnBack } = useAnimatedBackNavigation(() => setIsDetailOpen(false), isDetailOpen, { rootRef: detailRef });

      useEffect(() => {
        onArtistsMount();
        return () => onArtistsUnmount();
      }, []);

      useEffect(() => {
        const handleOpenDetail = (): void => setIsDetailOpen(true);
        window.addEventListener('test:open-artist-detail', handleOpenDetail);
        return () => window.removeEventListener('test:open-artist-detail', handleOpenDetail);
      }, []);

      return (
        <div ref={detailRef}>
          {isDetailOpen ? (
            <>
              <span>Artist detail probe</span>
              <button type="button" onClick={returnBack}>Back to artist wall</button>
            </>
          ) : (
            'Artist wall probe'
          )}
        </div>
      );
    };
    const localRoutes: AppRoute[] = [
      {
        id: 'artists',
        label: 'Artists',
        labelKey: 'route.artists.label',
        description: 'Artists',
        icon: Music2,
        placement: 'main',
        element: <ArtistsProbe />,
      },
      { ...routes[1], element: <LyricsBackProbe /> },
    ];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    await waitFor(() => expect(onArtistsMount).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('test:open-artist-detail'));

    await waitFor(() => expect(screen.getByText('Artist detail probe')).toBeTruthy());
    window.dispatchEvent(new CustomEvent('app:navigate:lyrics', { detail: { mode: 'lyrics' } }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(container.querySelector('[data-route-id="artists"]')?.hasAttribute('hidden')).toBe(true);
    expect(onArtistsUnmount).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(container.querySelector('[data-route-id="artists"]')?.hasAttribute('hidden')).toBe(false));
    expect(screen.getByText('Artist detail probe')).toBeTruthy();
    expect(onArtistsMount).toHaveBeenCalledTimes(1);
    expect(onArtistsUnmount).not.toHaveBeenCalled();
  });

  it('keeps album detail mounted when opening lyrics and returning', async () => {
    const onAlbumsMount = vi.fn();
    const onAlbumsUnmount = vi.fn();
    const AlbumsProbe = (): JSX.Element => {
      const [isDetailOpen, setIsDetailOpen] = useState(false);
      const detailRef = useRef<HTMLDivElement | null>(null);
      const { returnBack } = useAnimatedBackNavigation(() => setIsDetailOpen(false), isDetailOpen, { rootRef: detailRef });

      useEffect(() => {
        onAlbumsMount();
        return () => onAlbumsUnmount();
      }, []);

      useEffect(() => {
        const handleOpenDetail = (): void => setIsDetailOpen(true);
        window.addEventListener('test:open-album-detail', handleOpenDetail);
        return () => window.removeEventListener('test:open-album-detail', handleOpenDetail);
      }, []);

      return (
        <div ref={detailRef}>
          {isDetailOpen ? (
            <>
              <span>Album detail probe</span>
              <button type="button" onClick={returnBack}>Back to album wall</button>
            </>
          ) : (
            'Album wall probe'
          )}
        </div>
      );
    };
    const localRoutes: AppRoute[] = [
      {
        id: 'albums',
        label: 'Albums',
        labelKey: 'route.albums.label',
        description: 'Albums',
        icon: Music2,
        placement: 'main',
        element: <AlbumsProbe />,
      },
      { ...routes[1], element: <LyricsBackProbe /> },
    ];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    await waitFor(() => expect(onAlbumsMount).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('test:open-album-detail'));

    await waitFor(() => expect(screen.getByText('Album detail probe')).toBeTruthy());
    window.dispatchEvent(new CustomEvent('app:navigate:lyrics', { detail: { mode: 'lyrics' } }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(container.querySelector('[data-route-id="albums"]')?.hasAttribute('hidden')).toBe(true);
    expect(onAlbumsUnmount).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(container.querySelector('[data-route-id="albums"]')?.hasAttribute('hidden')).toBe(false));
    expect(screen.getByText('Album detail probe')).toBeTruthy();
    expect(onAlbumsMount).toHaveBeenCalledTimes(1);
    expect(onAlbumsUnmount).not.toHaveBeenCalled();
  });

  it('navigates to the plugin manager from a settings shortcut event', async () => {
    const localRoutes: AppRoute[] = [
      routes[0],
      routes[1],
      {
        id: 'plugins',
        label: 'Plugins',
        description: 'Plugins',
        icon: ListMusic,
        placement: 'main',
        element: <div>Plugin manager page</div>,
      },
    ];

    render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    window.dispatchEvent(new Event('app:navigate:plugins'));

    await waitFor(() => expect(screen.getByText('Plugin manager page')).toBeTruthy());
  });

  it('lets the plugin manager own file drops instead of showing the global music import overlay', async () => {
    const localRoutes: AppRoute[] = [
      routes[0],
      routes[1],
      {
        id: 'plugins',
        label: 'Plugins',
        description: 'Plugins',
        icon: ListMusic,
        placement: 'main',
        element: <div>Plugin manager page</div>,
      },
    ];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    fireEvent.dragEnter(window, {
      dataTransfer: {
        files: [],
        types: ['Files'],
      },
    });
    expect(container.querySelector('.drag-import-overlay')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.drag-import-overlay')).toBeNull();

    window.dispatchEvent(new Event('app:navigate:plugins'));
    await waitFor(() => expect(screen.getByText('Plugin manager page')).toBeTruthy());

    fireEvent.dragEnter(window, {
      dataTransfer: {
        files: [],
        types: ['Files'],
      },
    });

    expect(container.querySelector('.drag-import-overlay')).toBeNull();
  });

  it('imports and enables dropped .echo packages from any normal route', async () => {
    const importDroppedFiles = vi.fn().mockResolvedValue({
      importedCount: 0,
      ignoredCount: 0,
      failedCount: 0,
      outputDirectory: 'D:\\Music',
    });
    const importPackage = vi.fn().mockResolvedValue({
      pluginId: 'echo.pro-unlock',
      directory: 'D:\\Echo\\plugins\\echo.pro-unlock',
      importedFileCount: 2,
      checksum: 'checksum',
    });
    const enable = vi.fn().mockResolvedValue({ pluginId: 'echo.pro-unlock', enabled: true });
    window.echo = {
      library: {
        importDroppedFiles,
      },
      plugins: {
        importPackage,
        enable,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const file = new File(['{}'], 'license.echo', { type: 'application/json' });

    fireEvent.drop(window, {
      dataTransfer: {
        files: [file],
        types: ['Files'],
      },
    });

    await waitFor(() => expect(importPackage).toHaveBeenCalledWith(file));
    await waitFor(() => expect(enable).toHaveBeenCalledWith({ pluginId: 'echo.pro-unlock', trustedPermissions: [] }));
    expect(importDroppedFiles).not.toHaveBeenCalled();
  });

  it('reopens the first-run wizard when settings mark onboarding incomplete', async () => {
    const getSettings = vi.fn().mockResolvedValue({ onboardingCompleted: true, smtcEnabled: true });
    window.echo = {
      app: {
        getSettings,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: { onboardingCompleted: false } }));
    });

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });

  it('does not flash the user notice while settings are still loading', async () => {
    let resolveSettings: (settings: { onboardingCompleted: boolean; smtcEnabled: boolean }) => void = () => undefined;
    const getSettings = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSettings = resolve;
        }),
    );
    window.echo = {
      app: {
        getSettings,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      resolveSettings({ onboardingCompleted: true, smtcEnabled: true });
    });

    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('plays the first-run wizard exit state before unmounting', async () => {
    const getSettings = vi.fn().mockResolvedValue({ onboardingCompleted: true, smtcEnabled: true });
    window.echo = {
      app: {
        getSettings,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    act(() => {
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: { onboardingCompleted: false } }));
    });

    await waitFor(() => expect(screen.getByRole('dialog').getAttribute('data-state')).toBe('open'));

    vi.useFakeTimers();

    act(() => {
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: { onboardingCompleted: true } }));
    });

    expect(screen.getByRole('dialog').getAttribute('data-state')).toBe('closing');

    act(() => {
      vi.advanceTimersByTime(221);
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('applies saved sidebar visibility and order from settings', async () => {
    window.localStorage.clear();
    const getSettings = vi.fn().mockResolvedValue({
      downloadsFeatureUnlocked: true,
      sidebarRouteOrder: ['queue', 'home', 'songs', 'settings'],
      sidebarHiddenRouteIds: ['songs'],
    });
    window.echo = {
      app: {
        getSettings,
      },
    } as unknown as Window['echo'];

    const localRoutes: AppRoute[] = [
      routesWithHome[0],
      routes[0],
      {
        id: 'queue',
        label: 'Queue',
        labelKey: 'route.queue.label',
        description: 'Queue',
        icon: ListMusic,
        placement: 'main',
        element: <div>Queue page</div>,
      },
    ];

    render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    await waitFor(() => {
      expect(within(sidebar).queryByRole('button', { name: 'Songs' })).toBeNull();
      expect(within(sidebar).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual(['Queue', 'Home']);
    });
  });

  it('keeps the Streaming sidebar entry hidden while the manual switch is off', async () => {
    window.localStorage.clear();
    const getSettings = vi.fn().mockResolvedValue({
      sidebarRouteOrder: ['home', 'streaming', 'songs'],
      sidebarHiddenRouteIds: [],
      streamingFeatureEnabled: false,
    });
    window.echo = {
      app: {
        getSettings,
      },
      connect: {
        getDonatorUnlockStatus: vi.fn().mockResolvedValue(unlockedDonatorStatus),
      },
    } as unknown as Window['echo'];

    const localRoutes: AppRoute[] = [
      routesWithHome[0],
      {
        id: 'streaming',
        label: 'Streaming',
        labelKey: 'route.streaming.label',
        description: 'Streaming',
        icon: Music2,
        placement: 'main',
        element: <div>Streaming shell</div>,
      },
      routes[0],
    ];

    render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    await waitFor(() => expect(within(sidebar).queryByRole('button', { name: 'Streaming' })).toBeNull());
    expect(within(sidebar).getByRole('button', { name: 'Home' })).toBeTruthy();
  });

  it('shows and opens the Streaming sidebar entry by default', async () => {
    window.localStorage.clear();
    const getSettings = vi.fn().mockResolvedValue({
      sidebarRouteOrder: ['home', 'streaming', 'songs'],
      sidebarHiddenRouteIds: [],
    });
    window.echo = {
      app: {
        getSettings,
      },
      connect: {
        getDonatorUnlockStatus: vi.fn().mockResolvedValue(unlockedDonatorStatus),
      },
    } as unknown as Window['echo'];

    const localRoutes: AppRoute[] = [
      routesWithHome[0],
      {
        id: 'streaming',
        label: 'Streaming',
        labelKey: 'route.streaming.label',
        description: 'Streaming',
        icon: Music2,
        placement: 'main',
        element: <div>Streaming shell</div>,
      },
      routes[0],
    ];

    render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    const streamingButton = await within(sidebar).findByRole('button', { name: 'Streaming' });
    fireEvent.click(streamingButton);

    expect(await screen.findByText('Streaming shell')).toBeTruthy();
  });

  it('keeps the Connect sidebar entry visible before Pro unlock', async () => {
    window.localStorage.clear();
    const getSettings = vi.fn().mockResolvedValue({
      sidebarRouteOrder: ['home', 'connect', 'songs'],
      sidebarHiddenRouteIds: [],
    });
    window.echo = {
      app: {
        getSettings,
      },
      connect: {
        getDonatorUnlockStatus: vi.fn().mockResolvedValue({
          ...unlockedDonatorStatus,
          unlocked: false,
          pluginInstalled: false,
          pluginEnabled: false,
          hwidHash: 'b'.repeat(64),
          reason: 'license-invalid',
        }),
      },
    } as unknown as Window['echo'];

    const localRoutes: AppRoute[] = [
      routesWithHome[0],
      {
        id: 'connect',
        label: 'Connect',
        description: 'Connect',
        icon: Music2,
        placement: 'main',
        element: <div>Connect locked shell</div>,
      },
      routes[0],
    ];

    render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    await waitFor(() => expect(within(sidebar).getByRole('button', { name: 'Connect' })).toBeTruthy());
  });

  it('shows the built-in osu downloader route when the feature is enabled', async () => {
    window.localStorage.clear();
    const getSettings = vi.fn().mockResolvedValue({
      osuDownloaderFeatureEnabled: true,
      sidebarRouteOrder: ['home', 'songs', 'osu-downloader'],
      sidebarHiddenRouteIds: [],
    });
    window.echo = {
      app: {
        getSettings,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routesWithOsuDownloader} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(await within(sidebar).findByRole('button', { name: 'osu downloader' })).toBeTruthy();
  });

  it('keeps legacy osu downloader marker packages hidden until the built-in feature is enabled', async () => {
    window.localStorage.clear();
    const getSettings = vi.fn().mockResolvedValue({
      sidebarRouteOrder: ['home', 'songs', 'osu-downloader'],
      sidebarHiddenRouteIds: [],
    });
    const listPlugins = vi.fn().mockResolvedValue({
      plugins: [
        {
          id: 'osu.downloader',
          name: 'osu!downloader',
          directory: 'D:\\Echo\\plugins\\osu.downloader',
          enabled: true,
          disabledByHost: false,
          status: 'running',
          contributes: {
            panels: [],
          },
        },
      ],
    });
    window.echo = {
      app: {
        getSettings,
      },
      plugins: {
        list: listPlugins,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routesWithOsuDownloader} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    await waitFor(() => expect(listPlugins).toHaveBeenCalled());
    expect(within(sidebar).queryByRole('button', { name: 'osu downloader' })).toBeNull();
  });

  it('does not expose generic plugin html panels in the sidebar before the host supports them', async () => {
    window.localStorage.clear();
    const getSettings = vi.fn().mockResolvedValue({
      sidebarRouteOrder: ['home', 'songs'],
      sidebarHiddenRouteIds: [],
    });
    const listPlugins = vi.fn().mockResolvedValue({
      plugins: [
        {
          id: 'echo.playback-panel',
          name: 'Playback Panel',
          directory: 'D:\\Echo\\plugins\\echo.playback-panel',
          enabled: true,
          disabledByHost: false,
          status: 'running',
          contributes: {
            panels: [
              {
                id: 'main',
                title: '播放状态',
                path: 'panel.html',
                placement: 'main',
              },
            ],
          },
        },
      ],
    });
    window.echo = {
      app: {
        getSettings,
      },
      plugins: {
        list: listPlugins,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routesWithHome} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    await waitFor(() => expect(listPlugins).toHaveBeenCalled());
    expect(within(sidebar).queryByRole('button', { name: '播放状态' })).toBeNull();
  });

  it('hides a sidebar route from the route context menu', async () => {
    window.localStorage.clear();
    const getSettings = vi.fn().mockResolvedValue({
      downloadsFeatureUnlocked: true,
      sidebarRouteOrder: ['home', 'songs', 'settings'],
      sidebarHiddenRouteIds: [],
    });
    const setSettings = vi.fn().mockImplementation(async (patch) => patch);
    window.echo = {
      app: {
        getSettings,
        setSettings,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routesWithSettings} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    fireEvent.contextMenu(within(sidebar).getByRole('button', { name: 'Songs' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '隐藏' }));

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          sidebarHiddenRouteIds: expect.arrayContaining(['songs']),
        }),
      );
    });
  });

  it('applies saved sidebar auto-hide from settings', async () => {
    window.localStorage.clear();
    const getSettings = vi.fn().mockResolvedValue({
      sidebarAutoHideEnabled: true,
    });
    window.echo = {
      app: {
        getSettings,
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routesWithHome} />
      </AppProviders>,
    );

    await waitFor(() => expect(container.querySelector('.app-shell--sidebar-auto-hide')).toBeTruthy());
  });

  it('applies saved sidebar icon-only from settings', async () => {
    window.localStorage.clear();
    const getSettings = vi.fn().mockResolvedValue({
      sidebarIconOnlyEnabled: true,
    });
    window.echo = {
      app: {
        getSettings,
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routesWithHome} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(container.querySelector('.app-shell--sidebar-icon-only')).toBeTruthy();
      expect(container.querySelector('.sidebar')?.getAttribute('data-icon-only')).toBe('true');
    });
  });

  it('applies saved hidden feature comments from settings', async () => {
    window.localStorage.clear();
    const getSettings = vi.fn().mockResolvedValue({
      featureCommentsHidden: true,
    });
    window.echo = {
      app: {
        getSettings,
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routesWithHome} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(container.querySelector('.app-shell')?.getAttribute('data-feature-comments-hidden')).toBe('true');
    });
  });

  it('shows the touch keyboard when an editable field receives focus and the setting is enabled', async () => {
    window.localStorage.clear();
    const showTouchKeyboard = vi.fn().mockResolvedValue(true);
    const getSettings = vi.fn().mockResolvedValue({
      touchOnScreenKeyboardEnabled: true,
    });
    window.echo = {
      app: {
        getSettings,
        showTouchKeyboard,
      },
    } as unknown as Window['echo'];
    const routesWithInput: AppRoute[] = [
      {
        id: 'songs',
        label: 'Songs',
        labelKey: 'route.songs.label',
        description: 'Songs',
        icon: Music2,
        placement: 'main',
        element: <label>Touch input<input aria-label="Touch input" /></label>,
      },
    ];

    render(
      <AppProviders>
        <AppLayout routes={routesWithInput} />
      </AppProviders>,
    );

    const input = await screen.findByLabelText('Touch input');
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    fireEvent.focusIn(input);

    await waitFor(() => expect(showTouchKeyboard).toHaveBeenCalledTimes(1));
  });

  it('notifies the library views when a download is imported', async () => {
    let jobsUpdated: ((jobs: Array<{ id: string; importedTrackId: string | null }>) => void) | null = null;
    const unsubscribeDownloads = vi.fn();
    const onLibraryChanged = vi.fn();
    const onPlaylistsChanged = vi.fn();
    const receivedEvents: Event[] = [];
    const handleLibraryChanged = (event: Event): void => {
      receivedEvents.push(event);
      onLibraryChanged(event);
    };
    window.echo = {
      downloads: {
        onJobsUpdated: vi.fn((handler) => {
          jobsUpdated = handler as typeof jobsUpdated;
          return unsubscribeDownloads;
        }),
      },
    } as unknown as Window['echo'];
    window.addEventListener('library:changed', handleLibraryChanged);
    window.addEventListener('library:playlists-changed', onPlaylistsChanged);

    const { unmount } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(window.echo?.downloads?.onJobsUpdated).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();

    act(() => {
      jobsUpdated?.([{ id: 'job-1', importedTrackId: null }]);
    });
    expect(onLibraryChanged).not.toHaveBeenCalled();

    act(() => {
      jobsUpdated?.([{ id: 'job-1', importedTrackId: 'track-1' }]);
    });
    expect(onLibraryChanged).not.toHaveBeenCalled();

    act(() => {
      jobsUpdated?.([{ id: 'job-1', importedTrackId: 'track-1' }]);
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(onLibraryChanged).toHaveBeenCalledTimes(1);
    expect((receivedEvents[0] as CustomEvent).detail).toEqual({ preserveScroll: true });
    expect(onPlaylistsChanged).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribeDownloads).toHaveBeenCalledTimes(1);
    window.removeEventListener('library:changed', handleLibraryChanged);
    window.removeEventListener('library:playlists-changed', onPlaylistsChanged);
  });

  it('marks main-process library updates as scroll-preserving', async () => {
    let libraryChangedHandler: (() => void) | null = null;
    const receivedEvents: Event[] = [];
    window.echo = {
      library: {
        getSummary: vi.fn(async () => ({})),
        onLibraryChanged: vi.fn((handler) => {
          libraryChangedHandler = handler;
          return vi.fn();
        }),
      },
    } as unknown as Window['echo'];
    window.addEventListener('library:changed', (event) => receivedEvents.push(event));

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(window.echo?.library.onLibraryChanged).toHaveBeenCalledTimes(1));
    await act(async () => {
      libraryChangedHandler?.();
    });

    expect(receivedEvents).toHaveLength(1);
    expect((receivedEvents[0] as CustomEvent).detail).toEqual({ preserveScroll: true });
  });

  it('keeps the player bar on the standalone lyrics page', async () => {
    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    expect(sidebar).toBeTruthy();
    expect(screen.getByRole('contentinfo', { name: '播放控制' })).toBeTruthy();

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(screen.queryByRole('complementary', { name: 'Main navigation' })).toBeNull();
    expect(screen.getByRole('contentinfo', { name: '播放控制' })).toBeTruthy();
  });

  it('opens the full queue page from the shell player bar', async () => {
    render(
      <AppProviders>
        <AppLayout routes={routesWithQueue} />
      </AppProviders>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Playback queue' }));

    await waitFor(() => expect(screen.getByText('Full queue page')).toBeTruthy());
    expect(screen.queryByRole('complementary', { name: '播放队列抽屉' })).toBeNull();
  });

  it('hides the shell signal path button when the app setting disables it', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ signalPathControlEnabled: false }),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routesWithQueue} />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.queryByRole('button', { name: /打开音频链路|Open audio chain/u })).toBeNull());
    expect(screen.getByRole('button', { name: 'Playback queue' })).toBeTruthy();
  });

  it('shows the shell signal path button when normalized default settings enable it', async () => {
    const currentTrack = track('signal-path-default-track', { codec: 'flac', sampleRate: 96000, bitDepth: 24 });
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ signalPathControlEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <QueueSetupProbe tracks={[currentTrack]} startTrackId={currentTrack.id} />
        <AppLayout routes={routesWithQueue} />
      </AppProviders>,
    );

    await screen.findByText('Queue setup ready');
    expect(await screen.findByRole('button', { name: /打开音频链路|Open audio chain/u })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Playback queue' })).toBeTruthy();
  });

  it('shows the shell signal path button when verified settings enable it, then hides it on the lyrics page', async () => {
    const currentTrack = track('signal-path-track', { codec: 'flac', sampleRate: 96000, bitDepth: 24 });
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ signalPathControlEnabled: true }),
        getEchoProAccountStatus: vi.fn().mockResolvedValue({ pro: true }),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <QueueSetupProbe tracks={[currentTrack]} startTrackId={currentTrack.id} />
        <AppLayout routes={routesWithQueue} />
      </AppProviders>,
    );

    await screen.findByText('Queue setup ready');
    expect(await screen.findByRole('button', { name: /打开音频链路|Open audio chain/u })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Playback queue' })).toBeTruthy();

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /打开音频链路|Open audio chain/u })).toBeNull();
    expect(screen.getByRole('button', { name: 'Playback queue' })).toBeTruthy();
  });

  it('does not wait for a renderer Pro status refresh before showing verified signal path settings', async () => {
    const currentTrack = track('signal-path-verified-track', { codec: 'flac', sampleRate: 96000, bitDepth: 24 });
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ signalPathControlEnabled: true }),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <QueueSetupProbe tracks={[currentTrack]} startTrackId={currentTrack.id} />
        <AppLayout routes={routesWithQueue} />
      </AppProviders>,
    );

    await screen.findByText('Queue setup ready');
    expect(await screen.findByRole('button', { name: /鎵撳紑闊抽閾捐矾|Open audio chain/u })).toBeTruthy();
  });

  it('opens the lightweight queue drawer from the lyrics player bar', async () => {
    render(
      <AppProviders>
        <AppLayout routes={routesWithQueue} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(screen.queryByRole('complementary', { name: '播放队列抽屉' })).toBeNull();
    expect(screen.queryByRole('button', { name: /打开音频链路|Open audio chain/u })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Playback queue' }));

    expect(screen.getByRole('complementary', { name: '播放队列抽屉' })).toBeTruthy();
    expect(screen.getByText('队列为空')).toBeTruthy();
    expect(screen.queryByText('Full queue page')).toBeNull();
  });

  it('opens the lightweight queue drawer from the queue shortcut event on lyrics and MV views', async () => {
    render(
      <AppProviders>
        <AppLayout routes={routesWithQueue} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());

    act(() => {
      window.dispatchEvent(new Event('app:navigate:queue'));
    });

    expect(screen.getByRole('complementary', { name: '播放队列抽屉' })).toBeTruthy();
    expect(screen.queryByText('Full queue page')).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('app:navigate:queue'));
    });

    await waitFor(() => expect(screen.queryByRole('complementary', { name: '播放队列抽屉' })).toBeNull());

    act(() => {
      window.dispatchEvent(new Event('app:navigate:queue'));
    });

    expect(screen.getByRole('complementary', { name: '播放队列抽屉' })).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event('app:navigate:queue'));
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('app:navigate:lyrics', { detail: { mode: 'mv' } }));
    });

    await waitFor(() => expect(screen.queryByRole('complementary', { name: '播放队列抽屉' })).toBeNull());

    act(() => {
      window.dispatchEvent(new Event('app:navigate:queue'));
    });

    expect(screen.getByRole('complementary', { name: '播放队列抽屉' })).toBeTruthy();
    expect(screen.queryByText('Full queue page')).toBeNull();
  });

  it('returns to the previous shell route when the lyrics transport button is clicked from lyrics', async () => {
    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(screen.queryByRole('complementary', { name: 'Main navigation' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Shell page')).toBeTruthy());
    expect(screen.getByRole('complementary', { name: 'Main navigation' })).toBeTruthy();
  });

  it('uses the lyrics transport button to switch from MV to pure lyrics before exiting', async () => {
    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(screen.queryByRole('complementary', { name: 'Main navigation' })).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent('app:navigate:lyrics', { detail: { mode: 'mv' } }));
    });

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(screen.queryByRole('complementary', { name: 'Main navigation' })).toBeNull();

    const playerBar = screen.getByRole('contentinfo');
    fireEvent.click(within(playerBar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(screen.queryByRole('complementary', { name: 'Main navigation' })).toBeNull();

    fireEvent.click(within(playerBar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Shell page')).toBeTruthy());
    expect(screen.getByRole('complementary', { name: 'Main navigation' })).toBeTruthy();
  });

  it('exits the MV page when the MV transport button is clicked again', async () => {
    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent('app:navigate:lyrics', { detail: { mode: 'mv' } }));
    });

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(screen.queryByRole('complementary', { name: 'Main navigation' })).toBeNull();

    fireEvent.click(within(screen.getByRole('contentinfo')).getByRole('button', { name: 'MV' }));

    await waitFor(() => expect(screen.getByText('Shell page')).toBeTruthy());
    expect(screen.getByRole('complementary', { name: 'Main navigation' })).toBeTruthy();
  });

  it('uses the lyrics mini player bar when the lyrics setting is enabled', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: true,
          lyricsPlayerBarDrawerOpacityPercent: 64,
          lyricsPlayerBarDrawerColorMode: 'custom',
          lyricsPlayerBarDrawerColor: '#FFFFFF',
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(container.querySelector('.app-shell--lyrics-player-drawer')).toBeTruthy());
    expect(container.querySelector('.app-shell--lyrics-mini-player')).toBeTruthy();
    expect(container.querySelector('.lyrics-player-drawer-zone')).toBeNull();
    const miniHost = container.querySelector('.lyrics-player-drawer-host') as HTMLElement;
    expect(miniHost.querySelector('.player-bar')).toBeTruthy();
    expect(miniHost.dataset.miniPlayerColorMode).toBe('custom');
    expect(miniHost.style.getPropertyValue('--lyrics-mini-player-background')).toBe('rgba(255, 255, 255, 0.64)');
    expect(miniHost.style.getPropertyValue('--lyrics-mini-player-visual-opacity')).toBe('0.90');
    expect(miniHost.style.getPropertyValue('--lyrics-mini-player-readable-text')).toBe('rgb(17, 24, 39)');
    expect(miniHost.style.getPropertyValue('--lyrics-mini-player-readable-muted')).toBe('rgb(17, 24, 39)');
    expect(miniHost.style.getPropertyValue('--lyrics-mini-player-readable-shadow')).toBe('0 1px 0 rgba(255, 255, 255, 0.54)');
    expect(miniHost.style.getPropertyValue('--lyrics-mini-player-readable-play-bg')).toBe('rgba(17, 24, 39, 0.12)');
    expect(miniHost.style.getPropertyValue('--lyrics-mini-player-readable-play-bg-hover')).toBe('rgba(17, 24, 39, 0.18)');
    expect(miniHost.style.getPropertyValue('--lyrics-mini-player-readable-play-border')).toBe('rgba(17, 24, 39, 0.18)');
    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('applies low lyrics mini player visual transparency without requiring auto-hide', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: true,
          lyricsPlayerBarDrawerAutoHideEnabled: false,
          lyricsPlayerBarDrawerOpacityPercent: 20,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    const miniHost = await waitFor(() => container.querySelector('.lyrics-player-drawer-host') as HTMLElement);
    expect(miniHost.classList.contains('lyrics-player-drawer-host--auto-hide')).toBe(false);
    expect(miniHost.dataset.autoHide).toBeUndefined();
    expect(miniHost.style.getPropertyValue('--lyrics-mini-player-background')).toBe('rgba(35, 33, 32, 0.20)');
    expect(miniHost.style.getPropertyValue('--lyrics-mini-player-visual-opacity')).toBe('0.78');
  });

  it('auto-hides the lyrics mini player bar only after the pointer moves away', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: true,
          lyricsPlayerBarDrawerAutoHideEnabled: true,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    const miniHost = await waitFor(() => {
      const host = container.querySelector('.lyrics-player-drawer-host') as HTMLElement | null;
      expect(host).toBeTruthy();
      expect(host?.dataset.autoHide).toBe('true');
      return host as HTMLElement;
    });

    vi.useFakeTimers();
    act(() => {
      fireEvent.mouseMove(window, { clientX: 1, clientY: 1 });
      vi.advanceTimersByTime(20);
      vi.advanceTimersByTime(480);
    });
    expect(miniHost.dataset.autoHideState).toBe('hidden');
    expect(miniHost.classList.contains('lyrics-player-drawer-host--auto-hidden')).toBe(true);

    act(() => {
      fireEvent.mouseMove(window, { clientX: window.innerWidth / 2, clientY: window.innerHeight - 8 });
      vi.advanceTimersByTime(20);
    });
    expect(miniHost.dataset.autoHideState).toBe('visible');
    expect(miniHost.classList.contains('lyrics-player-drawer-host--auto-hidden')).toBe(false);

    act(() => {
      fireEvent.mouseMove(window, { clientX: 1, clientY: 1 });
      vi.advanceTimersByTime(20);
      vi.advanceTimersByTime(300);
    });
    expect(miniHost.dataset.autoHideState).toBe('hidden');

    act(() => {
      fireEvent.mouseMove(window, { clientX: window.innerWidth - 1, clientY: window.innerHeight - 8 });
      vi.advanceTimersByTime(20);
    });
    expect(miniHost.dataset.autoHideState).toBe('visible');
  });

  it('uses the lyrics mini player bar automatically on the MV page', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          lyricsPlayerBarDrawerAutoEnableForMv: true,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent('app:navigate:lyrics', { detail: { mode: 'mv' } }));
    });

    await waitFor(() => expect(container.querySelector('.app-shell--lyrics-player-drawer')).toBeTruthy());
    expect(container.querySelector('.app-shell--lyrics-mini-player')).toBeTruthy();
  });

  it('keeps the normal MV player bar when MV auto mini player is disabled', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          lyricsPlayerBarDrawerAutoEnableForMv: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent('app:navigate:lyrics', { detail: { mode: 'mv' } }));
    });

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(container.querySelector('.app-shell--lyrics-player-drawer')).toBeNull();
    expect(container.querySelector('.app-shell--lyrics-mini-player')).toBeNull();
  });

  it('keeps the same player bar instance when entering the lyrics mini player', async () => {
    const unsubscribeAudioStatus = vi.fn();
    const audioOnStatus = vi.fn(() => unsubscribeAudioStatus);

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ lyricsPlayerBarDrawerEnabled: true, smtcEnabled: true }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: 'track-1',
          positionMs: 15000,
          durationMs: 120000,
          filePath: 'D:\\Music\\song.flac',
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: 'track-1',
          currentFilePath: 'D:\\Music\\song.flac',
          positionSeconds: 15,
          durationSeconds: 120,
          error: null,
        }),
        onStatus: audioOnStatus,
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(null),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(audioOnStatus).toHaveBeenCalled());
    const initialAudioSubscriptionCount = audioOnStatus.mock.calls.length;

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(container.querySelector('.lyrics-player-drawer-host')).toBeTruthy());
    expect(audioOnStatus).toHaveBeenCalledTimes(initialAudioSubscriptionCount);
    expect(unsubscribeAudioStatus).not.toHaveBeenCalled();
  });

  it('shares one audio status subscription between the player bar and lyrics page', async () => {
    const audioOnStatus = vi.fn(() => vi.fn());
    const localRoutes: AppRoute[] = [
      routes[0],
      {
        ...routes[1],
        element: <SharedStatusProbe />,
      },
    ];

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ lyricsPlayerBarDrawerEnabled: false, smtcEnabled: true }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: 'track-1',
          positionMs: 15000,
          durationMs: 120000,
          filePath: 'D:\\Music\\song.flac',
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: 'track-1',
          currentFilePath: 'D:\\Music\\song.flac',
          positionSeconds: 15,
          durationSeconds: 120,
          error: null,
        }),
        onStatus: audioOnStatus,
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(null),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    await waitFor(() => expect(audioOnStatus).toHaveBeenCalled());
    const initialAudioSubscriptionCount = audioOnStatus.mock.calls.length;
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Main navigation' })).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(audioOnStatus).toHaveBeenCalledTimes(initialAudioSubscriptionCount);
  });

  it('shows an upper-left audio error notice with a report action', async () => {
    const audioStatusHandlers: Array<(status: { error: string | null; state: string }) => void> = [];
    const openAudioCrashReport = vi.fn().mockResolvedValue('D:\\ECHO\\audio-crash-report.md');
    const openAudioCrashTextReport = vi.fn().mockResolvedValue('D:\\ECHO\\audio-crash-report.txt');
    const audioOnStatus = vi.fn((handler) => {
      audioStatusHandlers.push(handler as (status: { error: string | null; state: string }) => void);
      return vi.fn();
    });

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ lyricsPlayerBarDrawerEnabled: false, smtcEnabled: true }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'idle',
          currentTrackId: null,
          positionMs: 0,
          durationMs: 0,
          filePath: null,
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'idle',
          currentTrackId: null,
          currentFilePath: null,
          positionSeconds: 0,
          durationSeconds: 0,
          error: null,
        }),
        onStatus: audioOnStatus,
      },
      diagnostics: {
        getLastCrashSummary: vi.fn().mockResolvedValue(null),
        openAudioCrashReport,
        openAudioCrashTextReport,
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(null),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(audioStatusHandlers[0]).toBeTruthy());
    const emitAudioStatus = audioStatusHandlers[0];
    if (!emitAudioStatus) {
      throw new Error('audio status handler was not registered');
    }
    emitAudioStatus({
      state: 'error',
      error: 'echo-audio-host timeout_waiting_for_ready; mode="asio"',
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('alert').className).toContain('is-visible'));
    expect(screen.getByText(/播放遇到问题|Playback needs attention/i)).toBeTruthy();
    expect(screen.getByText(/完整原始错误|original error/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /打开 Markdown|Open Markdown/i }));
    await waitFor(() => expect(openAudioCrashReport).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /打开 TXT|Open TXT/i }));
    await waitFor(() => expect(openAudioCrashTextReport).toHaveBeenCalledTimes(1));
  });

  it('clears transient audio error notices after playback recovers', async () => {
    const audioStatusHandlers: Array<(status: { error: string | null; state: string }) => void> = [];
    const audioOnStatus = vi.fn((handler) => {
      audioStatusHandlers.push(handler as (status: { error: string | null; state: string }) => void);
      return vi.fn();
    });

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ lyricsPlayerBarDrawerEnabled: false, smtcEnabled: true }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'idle',
          currentTrackId: null,
          positionMs: 0,
          durationMs: 0,
          filePath: null,
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'idle',
          currentTrackId: null,
          currentFilePath: null,
          positionSeconds: 0,
          durationSeconds: 0,
          error: null,
        }),
        onStatus: audioOnStatus,
      },
      diagnostics: {
        getLastCrashSummary: vi.fn().mockResolvedValue(null),
        openAudioCrashReport: vi.fn().mockResolvedValue('D:\\ECHO\\audio-crash-report.md'),
        openAudioCrashTextReport: vi.fn().mockResolvedValue('D:\\ECHO\\audio-crash-report.txt'),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(null),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(audioStatusHandlers[0]).toBeTruthy());
    audioStatusHandlers[0]?.({
      state: 'error',
      error: 'echo-audio-host timeout_waiting_for_ready; mode="asio"',
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    audioStatusHandlers[0]?.({
      state: 'playing',
      error: null,
    });

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('auto-dismisses upper-left audio error notices after five seconds', async () => {
    const audioStatusHandlers: Array<(status: { error: string | null; state: string }) => void> = [];
    const audioOnStatus = vi.fn((handler) => {
      audioStatusHandlers.push(handler as (status: { error: string | null; state: string }) => void);
      return vi.fn();
    });

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ lyricsPlayerBarDrawerEnabled: false, smtcEnabled: true }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'idle',
          currentTrackId: null,
          positionMs: 0,
          durationMs: 0,
          filePath: null,
        }),
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'idle',
          currentTrackId: null,
          currentFilePath: null,
          positionSeconds: 0,
          durationSeconds: 0,
          error: null,
          warnings: [],
        }),
        onStatus: audioOnStatus,
        setOutput: vi.fn().mockResolvedValue({
          state: 'idle',
          currentTrackId: null,
          currentFilePath: null,
          positionSeconds: 0,
          durationSeconds: 0,
          error: null,
          warnings: [],
        }),
      },
      diagnostics: {
        getLastCrashSummary: vi.fn().mockResolvedValue(null),
        openAudioCrashReport: vi.fn().mockResolvedValue('D:\\ECHO\\audio-crash-report.md'),
        openAudioCrashTextReport: vi.fn().mockResolvedValue('D:\\ECHO\\audio-crash-report.txt'),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(null),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(audioStatusHandlers[0]).toBeTruthy());
    vi.useFakeTimers();
    act(() => {
      audioStatusHandlers[0]?.({
        state: 'error',
        error: 'echo-audio-host timeout_waiting_for_ready; mode="asio"',
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(screen.getByRole('alert')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(document.querySelector('.chrome-notice--audio-error')?.className).toContain('is-hiding');
    act(() => {
      vi.advanceTimersByTime(260);
    });

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows dispatched playback errors as an upper-left audio error notice', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ lyricsPlayerBarDrawerEnabled: false, smtcEnabled: true }),
      },
      diagnostics: {
        getLastCrashSummary: vi.fn().mockResolvedValue(null),
        openAudioCrashReport: vi.fn(),
        openAudioCrashTextReport: vi.fn(),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(showAudioErrorNoticeEvent, {
          detail: { message: 'Error invoking remote method playback:play-local-file: echo-audio-host runtime_error' },
        }),
      );
    });

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('播放没有成功');
    expect(notice.textContent).not.toContain('echo-audio-host runtime_error');
    expect(document.querySelector('.chrome-notice--audio-error')).toBeTruthy();
  });

  it('shows an upper-left notice when an account login expires', async () => {
    let accountStatusHandler:
      | ((statuses: Array<{ provider: 'bilibili'; connected: boolean; error: string | null }>) => void)
      | undefined;
    const accountsOnStatusesChanged = vi.fn((handler) => {
      accountStatusHandler = handler as typeof accountStatusHandler;
      return vi.fn();
    });

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ lyricsPlayerBarDrawerEnabled: false, smtcEnabled: true }),
      },
      accounts: {
        onStatusesChanged: accountsOnStatusesChanged,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(accountStatusHandler).toBeTruthy());
    const emitAccountStatuses = accountStatusHandler;
    if (!emitAccountStatuses) {
      throw new Error('account status handler was not registered');
    }
    emitAccountStatuses([{ provider: 'bilibili', connected: false, error: 'Bilibili login is invalid or expired.' }]);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/账号登录失效|Account Login Expired/i)).toBeTruthy();
    expect(screen.getByText(/Bilibili/)).toBeTruthy();
    expect(screen.getByText(/设置 > 集成|Settings > Integrations/i)).toBeTruthy();
  });

  it('suppresses account expiry notices when the setting is enabled', async () => {
    let accountStatusHandler:
      | ((statuses: Array<{ provider: 'bilibili'; connected: boolean; error: string | null }>) => void)
      | undefined;
    const accountsOnStatusesChanged = vi.fn((handler) => {
      accountStatusHandler = handler as typeof accountStatusHandler;
      return vi.fn();
    });

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          smtcEnabled: true,
          suppressAccountExpiryNotices: true,
        }),
      },
      accounts: {
        onStatusesChanged: accountsOnStatusesChanged,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(accountStatusHandler).toBeTruthy());
    await waitFor(() => expect(window.echo?.app?.getSettings).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    const emitAccountStatuses = accountStatusHandler;
    if (!emitAccountStatuses) {
      throw new Error('account status handler was not registered');
    }
    emitAccountStatuses([{ provider: 'bilibili', connected: false, error: 'Bilibili login is invalid or expired.' }]);

    expect(screen.queryByText(/账号登录失效|Account Login Expired/i)).toBeNull();
    expect(screen.queryByText(/设置 > 集成|Settings > Integrations/i)).toBeNull();
  });

  it('hides the app wallpaper layer on the standalone lyrics and MV page without unmounting it', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: 'D:\\Echo\\app-wallpapers\\wallpaper.png',
          appWallpaperScalePercent: 100,
          appWallpaperBlurPx: 12,
          appWallpaperBrightnessPercent: 80,
          appWallpaperUiOpacityPercent: 0,
          appWallpaperVisualProtectionEnabled: false,
          appWallpaperUnifiedOpacityEnabled: true,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(container.querySelector('.app-shell--wallpaper')).toBeTruthy());
    expect(container.querySelector('.app-wallpaper-layer')).toBeTruthy();

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    expect(container.querySelector('.app-shell--lyrics')).toBeTruthy();
    expect(container.querySelector('.app-shell--wallpaper')).toBeNull();
    const wallpaperLayer = container.querySelector('.app-wallpaper-layer') as HTMLElement | null;
    expect(wallpaperLayer).toBeTruthy();
    expect(wallpaperLayer?.dataset.hidden).toBe('true');
  });

  it('suppresses the user app wallpaper while the ambient theme is active without clearing the saved path', async () => {
    const wallpaperPath = 'D:\\Echo\\app-wallpapers\\wallpaper.png';
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          appearanceTheme: 'dark',
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: wallpaperPath,
          appWallpaperMediaType: 'image',
          appWallpaperScalePercent: 100,
          appWallpaperBlurPx: 0,
          appWallpaperBrightnessPercent: 100,
          appWallpaperUiOpacityPercent: 100,
          appWallpaperVisualProtectionEnabled: true,
          appWallpaperUnifiedOpacityEnabled: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const wallpaperImage = await waitFor(() => {
      const element = container.querySelector('.app-wallpaper-layer img') as HTMLImageElement | null;
      expect(element).toBeTruthy();
      return element as HTMLImageElement;
    });
    expect(wallpaperImage.getAttribute('src')).toContain(encodeURIComponent(wallpaperPath));
    expect(container.querySelector('.app-shell--wallpaper')).toBeTruthy();

    act(() => {
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: { appearanceTheme: 'ambient' } }));
    });

    await waitFor(() => expect(container.querySelector('.app-wallpaper-layer')).toBeNull());
    expect(container.querySelector('.app-shell--wallpaper')).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: { appearanceTheme: 'dark' } }));
    });

    await waitFor(() => {
      const element = container.querySelector('.app-wallpaper-layer img') as HTMLImageElement | null;
      expect(element?.getAttribute('src')).toContain(encodeURIComponent(wallpaperPath));
    });
  });

  it('marks the app shell when window acrylic is enabled', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appWindowAcrylicEnabled: true,
          appWindowAcrylicKeepWhenUnfocusedEnabled: true,
          appWindowAcrylicTransparencyPercent: 72,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const shell = await waitFor(() => {
      const element = container.querySelector('.app-shell--acrylic') as HTMLElement | null;
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });

    expect(shell.dataset.windowAcrylic).toBe('true');
    expect(shell.dataset.windowAcrylicKeepUnfocused).toBe('true');
    expect(shell.style.getPropertyValue('--app-acrylic-surface-mix')).toBe('24%');
    expect(shell.style.getPropertyValue('--app-acrylic-home-hero-muted-mix')).toBe('15%');
    expect(shell.querySelector('.app-wallpaper-layer')).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: {
        appWindowAcrylicKeepWhenUnfocusedEnabled: false,
        appWindowAcrylicTransparencyPercent: 30,
      } }));
    });

    await waitFor(() => expect(shell.style.getPropertyValue('--app-acrylic-surface-mix')).toBe('58%'));
    expect(shell.dataset.windowAcrylicKeepUnfocused).toBeUndefined();
  });

  it('applies the portrait app wallpaper only while the viewport is portrait', async () => {
    setViewportSize(1280, 720);
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: 'D:\\Echo\\app-wallpapers\\landscape.png',
          appPortraitWallpaperPath: 'D:\\Echo\\app-wallpapers\\portrait.webp',
          appWallpaperMediaType: 'image',
          appPortraitWallpaperMediaType: 'image',
          appWallpaperScalePercent: 100,
          appWallpaperBlurPx: 0,
          appWallpaperBrightnessPercent: 100,
          appWallpaperUiOpacityPercent: 100,
          appWallpaperVisualProtectionEnabled: true,
          appWallpaperUnifiedOpacityEnabled: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const landscapeImage = await waitFor(() => {
      const element = container.querySelector('.app-wallpaper-layer img') as HTMLImageElement | null;
      expect(element?.getAttribute('src')).toContain('echo-wallpaper://app/custom');
      return element as HTMLImageElement;
    });
    expect(landscapeImage.getAttribute('src')).toContain(encodeURIComponent('D:\\Echo\\app-wallpapers\\landscape.png'));
    expect((container.querySelector('.app-shell') as HTMLElement | null)?.dataset.wallpaperOrientation).toBe('landscape');

    act(() => {
      setViewportSize(390, 844);
      window.dispatchEvent(new Event('resize'));
    });

    const portraitImage = await waitFor(() => {
      const element = container.querySelector('.app-wallpaper-layer img') as HTMLImageElement | null;
      expect(element?.getAttribute('src')).toContain('echo-wallpaper://app-portrait/custom');
      return element as HTMLImageElement;
    });
    expect(portraitImage.getAttribute('src')).toContain(encodeURIComponent('D:\\Echo\\app-wallpapers\\portrait.webp'));
    expect((container.querySelector('.app-shell') as HTMLElement | null)?.dataset.wallpaperOrientation).toBe('portrait');
  });

  it('renders portrait app video wallpaper only while the viewport is portrait', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    setViewportSize(1280, 720);
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: 'D:\\Echo\\app-wallpapers\\landscape.png',
          appPortraitWallpaperPath: 'D:\\Echo\\app-wallpapers\\portrait-motion.webm',
          appWallpaperMediaType: 'image',
          appPortraitWallpaperMediaType: 'video',
          appVideoWallpaperPauseMode: 'never',
          appWallpaperScalePercent: 100,
          appWallpaperBlurPx: 0,
          appWallpaperBrightnessPercent: 100,
          appWallpaperUiOpacityPercent: 100,
          appWallpaperVisualProtectionEnabled: true,
          appWallpaperUnifiedOpacityEnabled: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => {
      const element = container.querySelector('.app-wallpaper-layer img') as HTMLImageElement | null;
      expect(element?.getAttribute('src')).toContain('echo-wallpaper://app/custom');
    });
    expect(container.querySelector('.app-wallpaper-layer video')).toBeNull();

    act(() => {
      setViewportSize(390, 844);
      window.dispatchEvent(new Event('resize'));
    });

    const video = await waitFor(() => {
      const element = container.querySelector('.app-wallpaper-layer video') as HTMLVideoElement | null;
      expect(element?.getAttribute('src')).toContain('echo-wallpaper://app-portrait/custom');
      return element as HTMLVideoElement;
    });
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.getAttribute('src')).toContain(encodeURIComponent('D:\\Echo\\app-wallpapers\\portrait-motion.webm'));
    expect((container.querySelector('.app-shell') as HTMLElement | null)?.dataset.wallpaperOrientation).toBe('portrait');
    fireEvent.loadedData(video);
    await waitFor(() => expect(playSpy).toHaveBeenCalled());
    playSpy.mockRestore();
  });

  it('lets wallpaper opacity pass through without visual protection forcing full transparency', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: 'D:\\Echo\\app-wallpapers\\wallpaper.png',
          appWallpaperScalePercent: 100,
          appWallpaperBlurPx: 0,
          appWallpaperBrightnessPercent: 100,
          appWallpaperUiOpacityPercent: 50,
          appWallpaperVisualProtectionEnabled: false,
          appWallpaperUnifiedOpacityEnabled: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(container.querySelector('.app-wallpaper-layer')).toBeTruthy());
    const wallpaper = container.querySelector('.app-wallpaper-layer img') as HTMLImageElement | null;
    expect(wallpaper).toBeTruthy();
    fireEvent.load(wallpaper as HTMLImageElement);

    const shell = await waitFor(() => {
      const element = container.querySelector('.app-shell--wallpaper-ready') as HTMLElement | null;
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });

    expect(shell.dataset.wallpaperVisualProtection).toBe('false');
    expect(shell.dataset.wallpaperUiTransparent).toBeUndefined();
    expect(shell.style.getPropertyValue('--app-wallpaper-ui-titlebar-alpha')).toBe('0.370');
    expect(shell.style.getPropertyValue('--app-wallpaper-ui-page-base-alpha')).toBe('0.310');
  });

  it('keeps very low nonzero wallpaper opacity from dropping backdrop blur to raw wallpaper', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: 'D:\\Echo\\app-wallpapers\\wallpaper.png',
          appWallpaperScalePercent: 100,
          appWallpaperBlurPx: 0,
          appWallpaperBrightnessPercent: 100,
          appWallpaperUiOpacityPercent: 1,
          appWallpaperVisualProtectionEnabled: false,
          appWallpaperUnifiedOpacityEnabled: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(container.querySelector('.app-wallpaper-layer')).toBeTruthy());
    fireEvent.load(container.querySelector('.app-wallpaper-layer img') as HTMLImageElement);

    const shell = await waitFor(() => {
      const element = container.querySelector('.app-shell--wallpaper-ready') as HTMLElement | null;
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });

    expect(shell.dataset.wallpaperUiTransparent).toBeUndefined();
    expect(shell.style.getPropertyValue('--app-wallpaper-ui-titlebar-alpha')).toBe('0.007');
    expect(shell.style.getPropertyValue('--app-wallpaper-ui-surface-blur')).toBe('8.1px');
  });

  it('marks wallpaper chrome as transparent only when protection is off and UI opacity is zero', async () => {
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: 'D:\\Echo\\app-wallpapers\\wallpaper.png',
          appWallpaperScalePercent: 100,
          appWallpaperBlurPx: 0,
          appWallpaperBrightnessPercent: 100,
          appWallpaperUiOpacityPercent: 0,
          appWallpaperVisualProtectionEnabled: false,
          appWallpaperUnifiedOpacityEnabled: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    await waitFor(() => expect(container.querySelector('.app-wallpaper-layer')).toBeTruthy());
    fireEvent.load(container.querySelector('.app-wallpaper-layer img') as HTMLImageElement);

    const shell = await waitFor(() => {
      const element = container.querySelector('.app-shell--wallpaper-ready') as HTMLElement | null;
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });

    expect(shell.dataset.wallpaperVisualProtection).toBe('false');
    expect(shell.dataset.wallpaperUiTransparent).toBe('true');
    expect(shell.style.getPropertyValue('--app-wallpaper-ui-titlebar-alpha')).toBe('0.000');
  });

  it('renders video app wallpaper and marks it ready after media load', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: 'D:\\Echo\\app-wallpapers\\motion.mp4',
          appWallpaperMediaType: 'video',
          appVideoWallpaperPauseMode: 'smart',
          appWallpaperScalePercent: 115,
          appWallpaperBlurPx: 0,
          appWallpaperBrightnessPercent: 100,
          appWallpaperUiOpacityPercent: 80,
          appWallpaperVisualProtectionEnabled: true,
          appWallpaperUnifiedOpacityEnabled: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const video = await waitFor(() => {
      const element = container.querySelector('.app-wallpaper-layer video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element as HTMLVideoElement;
    });
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);

    fireEvent.loadedData(video);

    await waitFor(() => expect(container.querySelector('.app-shell--wallpaper-ready')).toBeTruthy());
    await waitFor(() => expect(playSpy).toHaveBeenCalled());
    playSpy.mockRestore();
  });

  it('keeps ready video app wallpaper visible after a late media error', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: 'D:\\Echo\\app-wallpapers\\motion.mp4',
          appWallpaperMediaType: 'video',
          appVideoWallpaperPauseMode: 'never',
          appWallpaperScalePercent: 115,
          appWallpaperBlurPx: 0,
          appWallpaperBrightnessPercent: 100,
          appWallpaperUiOpacityPercent: 80,
          appWallpaperVisualProtectionEnabled: true,
          appWallpaperUnifiedOpacityEnabled: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const video = await waitFor(() => {
      const element = container.querySelector('.app-wallpaper-layer video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element as HTMLVideoElement;
    });
    fireEvent.loadedData(video);
    await waitFor(() => expect(container.querySelector('.app-shell--wallpaper-ready')).toBeTruthy());

    fireEvent.error(video);

    expect(container.querySelector('.app-shell--wallpaper-ready')).toBeTruthy();
    expect((container.querySelector('.app-wallpaper-layer') as HTMLElement | null)?.dataset.loaded).toBe('true');
    playSpy.mockRestore();
  });

  it('keeps the loaded video frame visible when smart pause stops playback', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: 'D:\\Echo\\app-wallpapers\\motion.mp4',
          appWallpaperMediaType: 'video',
          appVideoWallpaperPauseMode: 'smart',
          appWallpaperScalePercent: 115,
          appWallpaperBlurPx: 0,
          appWallpaperBrightnessPercent: 100,
          appWallpaperUiOpacityPercent: 80,
          appWallpaperVisualProtectionEnabled: true,
          appWallpaperUnifiedOpacityEnabled: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const video = await waitFor(() => {
      const element = container.querySelector('.app-wallpaper-layer video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element as HTMLVideoElement;
    });
    fireEvent.loadedData(video);
    await waitFor(() => expect(container.querySelector('.app-shell--wallpaper-ready')).toBeTruthy());

    vi.useFakeTimers();
    act(() => {
      window.dispatchEvent(new Event('blur'));
      vi.advanceTimersByTime(15000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(pauseSpy).toHaveBeenCalled();
    expect(container.querySelector('.app-shell--wallpaper-ready')).toBeTruthy();
    expect((container.querySelector('.app-wallpaper-layer') as HTMLElement | null)?.dataset.loaded).toBe('true');
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it('keeps video wallpaper mounted when navigating away and resumes it on return', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: 'D:\\Echo\\app-wallpapers\\motion.mp4',
          appWallpaperMediaType: 'video',
          appVideoWallpaperPauseMode: 'smart',
          appWallpaperScalePercent: 115,
          appWallpaperBlurPx: 0,
          appWallpaperBrightnessPercent: 100,
          appWallpaperUiOpacityPercent: 80,
          appWallpaperVisualProtectionEnabled: true,
          appWallpaperUnifiedOpacityEnabled: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    const { container } = render(
      <AppProviders>
        <AppLayout routes={routes} />
      </AppProviders>,
    );

    const video = await waitFor(() => {
      const element = container.querySelector('.app-wallpaper-layer video') as HTMLVideoElement | null;
      expect(element).toBeTruthy();
      return element as HTMLVideoElement;
    });
    fireEvent.loadedData(video);
    await waitFor(() => expect(container.querySelector('.app-shell--wallpaper-ready')).toBeTruthy());

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Standalone lyrics page')).toBeTruthy());
    const hiddenLayer = container.querySelector('.app-wallpaper-layer') as HTMLElement | null;
    expect(hiddenLayer?.dataset.hidden).toBe('true');
    expect(container.querySelector('.app-wallpaper-layer video')).toBe(video);
    expect(container.querySelector('.app-shell--wallpaper-ready')).toBeNull();
    expect(pauseSpy).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Lyrics' }));

    await waitFor(() => expect(screen.getByText('Shell page')).toBeTruthy());
    await waitFor(() => expect(container.querySelector('.app-shell--wallpaper-ready')).toBeTruthy());
    expect(container.querySelector('.app-wallpaper-layer video')).toBe(video);
    expect((container.querySelector('.app-wallpaper-layer') as HTMLElement | null)?.dataset.hidden).toBeUndefined();
    expect(playSpy).toHaveBeenCalled();
  });

  it('resumes ready video wallpaper after page visibility returns', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          lyricsPlayerBarDrawerEnabled: false,
          appCustomWallpaperPath: 'D:\\Echo\\app-wallpapers\\motion.mp4',
          appWallpaperMediaType: 'video',
          appVideoWallpaperPauseMode: 'smart',
          appWallpaperScalePercent: 115,
          appWallpaperBlurPx: 0,
          appWallpaperBrightnessPercent: 100,
          appWallpaperUiOpacityPercent: 80,
          appWallpaperVisualProtectionEnabled: true,
          appWallpaperUnifiedOpacityEnabled: false,
          smtcEnabled: true,
        }),
      },
    } as unknown as Window['echo'];

    try {
      const { container } = render(
        <AppProviders>
          <AppLayout routes={routes} />
        </AppProviders>,
      );

      const video = await waitFor(() => {
        const element = container.querySelector('.app-wallpaper-layer video') as HTMLVideoElement | null;
        expect(element).toBeTruthy();
        return element as HTMLVideoElement;
      });
      fireEvent.loadedData(video);
      await waitFor(() => expect(container.querySelector('.app-shell--wallpaper-ready')).toBeTruthy());

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(pauseSpy).toHaveBeenCalled());

      playSpy.mockClear();
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));

      await waitFor(() => expect(playSpy).toHaveBeenCalled());
    } finally {
      if (visibilityDescriptor) {
        Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
      } else {
        Reflect.deleteProperty(document, 'visibilityState');
      }
    }
  });
});

describe('AppLayout local file open integration', () => {
  it('imports selected audio and osu archive files through the library bridge', async () => {
    const chooseImportFiles = vi.fn().mockResolvedValue(['D:\\Music\\song.flac', 'D:\\Maps\\beatmap.osz']);
    const importAudioFiles = vi.fn().mockResolvedValue({
      importedCount: 2,
      skippedCount: 0,
      failedCount: 0,
      trackIds: ['track-audio', 'track-osu'],
      tracks: [],
    });
    const localRoutes: AppRoute[] = [
      routes[0],
      {
        id: 'import-file',
        label: 'Import File',
        labelKey: 'route.importFile.label',
        description: 'Import File',
        icon: Music2,
        placement: 'utility',
        element: <div>Import file placeholder</div>,
      },
    ];
    window.echo = {
      library: {
        chooseImportFiles,
        importAudioFiles,
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    fireEvent.click(screen.getByRole('button', { name: /导入文件|Import File/ }));

    await waitFor(() => expect(chooseImportFiles).toHaveBeenCalledTimes(1));
    expect(importAudioFiles).toHaveBeenCalledWith(['D:\\Music\\song.flac', 'D:\\Maps\\beatmap.osz']);
    expect(await screen.findByText(/已入库 2 个文件|Imported 2 files into the library/i)).toBeTruthy();
  });

  it('opens system-provided local audio files through the playback queue', async () => {
    const track: LibraryTrack = {
      id: 'temporary-local:file',
      isTemporary: true,
      path: 'D:\\Loose\\song.flac',
      title: 'Loose Song',
      artist: 'Local Artist',
      album: '',
      albumArtist: 'Local Artist',
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      duration: 120,
      codec: 'FLAC',
      sampleRate: 44100,
      bitDepth: 16,
      bitrate: null,
      coverId: null,
      coverThumb: null,
      fieldSources: {},
    };
    let openHandler: ((paths: string[]) => void) | null = null;
    const resolveLocalAudioFiles = vi.fn().mockResolvedValue({ tracks: [track], rejected: [] });
    const playLocalFile = vi.fn().mockResolvedValue({
      state: 'playing',
      currentTrackId: track.id,
      positionMs: 0,
      durationMs: 120000,
      filePath: track.path,
    });
    const localRoutes: AppRoute[] = [
      routes[0],
      {
        id: 'queue',
        label: 'Queue',
        labelKey: 'route.queue.label',
        description: 'Queue',
        icon: ListMusic,
        placement: 'main',
        element: <div>Queue page</div>,
      },
    ];

    window.echo = {
      playback: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
        playLocalFile,
        resolveLocalAudioFiles,
        onLocalAudioFilesOpened: (handler: (paths: string[]) => void) => {
          openHandler = handler;
          return vi.fn();
        },
      },
      audio: {
        getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, currentFilePath: null, positionSeconds: 0, durationSeconds: 0, error: null }),
        onStatus: vi.fn(() => vi.fn()),
      },
      library: {
        startPlaybackHistory: vi.fn().mockResolvedValue({ historyId: 'history-1' }),
        getLikedTrackIds: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Window['echo'];

    render(
      <AppProviders>
        <AppLayout routes={localRoutes} />
      </AppProviders>,
    );

    await waitFor(() => expect(openHandler).toBeTruthy());
    const emitOpenFiles = openHandler as ((paths: string[]) => void) | null;
    expect(emitOpenFiles).toBeTruthy();
    emitOpenFiles?.(['D:\\Loose\\song.flac']);

    await waitFor(() => expect(resolveLocalAudioFiles).toHaveBeenCalledWith(['D:\\Loose\\song.flac']));
    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: track.path })));
    expect(screen.getByText('Queue page')).toBeTruthy();
  });
});
