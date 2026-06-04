// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectSessionStatus } from '../../shared/types/connect';
import {
  DesktopLyricsApp,
  getInterpolatedPositionMs,
  getDesktopLyricsTextFitScale,
  hqPlayerConnectStatusToDesktopLyricsClock,
  shouldShowDesktopLyricsText,
} from './DesktopLyricsApp';

const makeDesktopLyricsSettings = (locked: boolean) => ({
  desktopLyricsEnabled: true,
  desktopLyricsLocked: locked,
  desktopLyricsFontSizePx: 34,
  desktopLyricsScalePercent: 100,
  desktopLyricsFontFamily: 'Microsoft YaHei',
  desktopLyricsFontFilePath: null,
  desktopLyricsColorMode: 'theme',
  desktopLyricsColor: '#FFFFFF',
  desktopLyricsStrokeColor: '#111827',
  desktopLyricsOpacityPercent: 96,
  desktopLyricsRomanizationEnabled: true,
  desktopLyricsTranslationEnabled: true,
  desktopLyricsBounds: null,
});

const renderDesktopLyricsApp = (
  locked: boolean,
): { container: HTMLElement; setMousePassthrough: ReturnType<typeof vi.fn> } => {
  const settings = makeDesktopLyricsSettings(locked);
  const setMousePassthrough = vi.fn();

  window.echo = {
    app: {
      getSettings: vi.fn().mockResolvedValue(settings),
      loadFontFile: vi.fn(),
    },
    connect: {
      getStatus: vi.fn().mockResolvedValue(null),
      onStatus: vi.fn(() => () => undefined),
    },
    desktopLyrics: {
      getLastAudioStatus: vi.fn().mockResolvedValue(null),
      getState: vi.fn().mockResolvedValue({
        visible: true,
        locked,
        bounds: null,
        settings,
      }),
      onAudioStatus: vi.fn(() => () => undefined),
      onStateChanged: vi.fn(() => () => undefined),
      setMousePassthrough,
    },
    playback: {
      getStatus: vi.fn().mockResolvedValue({
        currentTrackId: null,
        filePath: null,
        state: 'stopped',
        positionMs: 0,
        durationMs: 0,
      }),
    },
  } as unknown as typeof window.echo;

  const { container } = render(<DesktopLyricsApp />);

  return { container, setMousePassthrough };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'elementFromPoint');
  Reflect.deleteProperty(window, 'echo');
});

describe('desktop lyrics text fitting', () => {
  it('hides text that would overflow the desktop lyrics window', () => {
    expect(shouldShowDesktopLyricsText({
      text: '短歌词',
      availableWidthPx: 320,
      fontSizePx: 34,
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontWeight: 700,
      scalePercent: 100,
    })).toBe(true);

    expect(shouldShowDesktopLyricsText({
      text: 'これはとてもとてもとてもとても長いデスクトップ歌詞です',
      availableWidthPx: 320,
      fontSizePx: 34,
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontWeight: 700,
      scalePercent: 100,
    })).toBe(false);
  });

  it('shrinks long primary lyrics instead of requiring them to be hidden', () => {
    expect(getDesktopLyricsTextFitScale({
      text: 'Short lyric',
      availableWidthPx: 320,
      fontSizePx: 34,
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontWeight: 700,
      scalePercent: 100,
    })).toBe(1);

    const fitScale = getDesktopLyricsTextFitScale({
      text: 'Wonderland '.repeat(10),
      availableWidthPx: 320,
      fontSizePx: 34,
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontWeight: 700,
      scalePercent: 100,
    });

    expect(fitScale).toBeGreaterThanOrEqual(0.62);
    expect(fitScale).toBeLessThan(1);
  });

  it('uses HQPlayer Connect status as a desktop lyrics clock', () => {
    const clock = hqPlayerConnectStatusToDesktopLyricsClock({
      deviceId: 'hqplayer:local-desktop',
      protocol: 'hqplayer',
      state: 'playing',
      currentTrackId: 'track-hq',
      metadata: {
        title: 'HQ Track',
        artist: 'Artist',
        album: null,
        albumArtist: null,
        durationSeconds: 180,
        coverHttpUrl: '',
      },
      positionSeconds: 12.5,
      durationSeconds: 180,
      latencyMs: null,
      error: null,
      updatedAt: '2026-05-25T00:00:00.000Z',
    } satisfies ConnectSessionStatus, 1234);

    expect(clock).toMatchObject({
      currentTrackId: 'track-hq',
      filePath: null,
      state: 'playing',
      positionMs: 12500,
      durationMs: 180000,
      playbackRate: 1,
      updatedAtMs: 1234,
    });
  });

  it('holds forwarded desktop lyrics clock when native position telemetry is stale', () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(2000);

    try {
      expect(getInterpolatedPositionMs({
        source: 'forwarded',
        currentTrackId: 'track-1',
        filePath: 'C:\\Music\\track.flac',
        state: 'playing',
        positionMs: 8900,
        durationMs: 180000,
        playbackRate: 1,
        updatedAtMs: 0,
        nativePositionStalenessMs: 1200,
        nativeBufferedMs: 240,
        nativeUnderrunCallbacks: 0,
      })).toBe(8900);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('holds forwarded desktop lyrics clock after underrun with low buffer', () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(2000);

    try {
      expect(getInterpolatedPositionMs({
        source: 'forwarded',
        currentTrackId: 'track-1',
        filePath: 'C:\\Music\\track.flac',
        state: 'playing',
        positionMs: 8900,
        durationMs: 180000,
        playbackRate: 1,
        updatedAtMs: 0,
        nativePositionStalenessMs: 0,
        nativeBufferedMs: 12,
        nativeUnderrunCallbacks: 1,
      })).toBe(8900);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('keeps interpolating desktop lyrics when playback telemetry is healthy', () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(2000);

    try {
      expect(getInterpolatedPositionMs({
        source: 'forwarded',
        currentTrackId: 'track-1',
        filePath: 'C:\\Music\\track.flac',
        state: 'playing',
        positionMs: 8900,
        durationMs: 180000,
        playbackRate: 1,
        updatedAtMs: 0,
        nativePositionStalenessMs: 20,
        nativeBufferedMs: 240,
        nativeUnderrunCallbacks: 0,
      })).toBe(10900);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('keeps mouse passthrough enabled when locked even after mouse movement', async () => {
    const { setMousePassthrough } = renderDesktopLyricsApp(true);

    await waitFor(() => expect(setMousePassthrough).toHaveBeenCalledWith(true));
    setMousePassthrough.mockClear();

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));

    expect(setMousePassthrough).not.toHaveBeenCalledWith(false);
  });

  it('hides the desktop lyrics menu on mouse leave even after a control keeps focus', async () => {
    const { container } = renderDesktopLyricsApp(false);

    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');
    const firstControl = container.querySelector<HTMLButtonElement>('.desktop-lyrics-menu button');

    expect(app).toBeTruthy();
    expect(firstControl).toBeTruthy();

    fireEvent.focus(firstControl!);
    await waitFor(() => expect(app?.getAttribute('data-menu-visible')).toBe('true'));

    window.dispatchEvent(new MouseEvent('mouseleave'));

    await waitFor(() => expect(app?.getAttribute('data-menu-visible')).toBe('false'));
  });

  it('does not reveal the desktop lyrics menu over transparent window space', async () => {
    const { container, setMousePassthrough } = renderDesktopLyricsApp(false);
    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');

    expect(app).toBeTruthy();
    await waitFor(() => expect(setMousePassthrough).toHaveBeenCalledWith(true));
    setMousePassthrough.mockClear();

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => app),
    });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 12, clientY: 12 }));

    expect(app?.getAttribute('data-menu-visible')).toBe('false');
    expect(setMousePassthrough).not.toHaveBeenCalledWith(false);
  });

  it('reveals the desktop lyrics menu when hovering the lyrics text', async () => {
    const { container, setMousePassthrough } = renderDesktopLyricsApp(false);
    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');
    const lines = container.querySelector<HTMLElement>('.desktop-lyrics-lines');
    const primaryText = lines?.querySelector<HTMLElement>('strong');

    expect(app).toBeTruthy();
    expect(lines).toBeTruthy();
    expect(primaryText).toBeTruthy();
    await waitFor(() => expect(setMousePassthrough).toHaveBeenCalledWith(true));
    setMousePassthrough.mockClear();

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => primaryText),
    });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 40 }));

    await waitFor(() => expect(app?.getAttribute('data-menu-visible')).toBe('true'));
    expect(setMousePassthrough).toHaveBeenCalledWith(false);
  });

  it('does not reveal the desktop lyrics menu over lyrics container empty space', async () => {
    const { container, setMousePassthrough } = renderDesktopLyricsApp(false);
    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');
    const lines = container.querySelector<HTMLElement>('.desktop-lyrics-lines');

    expect(app).toBeTruthy();
    expect(lines).toBeTruthy();
    await waitFor(() => expect(setMousePassthrough).toHaveBeenCalledWith(true));
    setMousePassthrough.mockClear();

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => lines),
    });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 40 }));

    expect(app?.getAttribute('data-menu-visible')).toBe('false');
    expect(setMousePassthrough).toHaveBeenCalledWith(false);
  });

  it('loads lyrics through snapshot metadata for temporary remote tracks', async () => {
    const settings = makeDesktopLyricsSettings(false);
    const getForSnapshot = vi.fn().mockResolvedValue({
      kind: 'synced',
      provider: 'lrclib',
      lines: [{ timeMs: 0, text: 'remote lyric' }],
      offsetMs: 0,
    });
    const getForTrack = vi.fn().mockResolvedValue(null);
    const remoteTrackId = 'remote-browser:baidu:/music/Remote Song.flac';

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue(settings),
        loadFontFile: vi.fn(),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(null),
        onStatus: vi.fn(() => () => undefined),
      },
      desktopLyrics: {
        getLastAudioStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: remoteTrackId,
          currentFilePath: 'remote://baidu/music/Remote Song.flac',
          currentTrackTitle: 'Remote Song',
          currentTrackArtist: 'Remote Artist',
          currentTrackAlbum: 'Remote Album',
          currentTrackAlbumArtist: null,
          positionSeconds: 0,
          durationSeconds: 188,
          playbackRate: 1,
        }),
        getState: vi.fn().mockResolvedValue({
          visible: true,
          locked: false,
          bounds: null,
          settings,
        }),
        onAudioStatus: vi.fn(() => () => undefined),
        onStateChanged: vi.fn(() => () => undefined),
        setMousePassthrough: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(null),
      },
      lyrics: {
        getForSnapshot,
        getForTrack,
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          currentTrackId: null,
          filePath: null,
          state: 'stopped',
          positionMs: 0,
          durationMs: 0,
        }),
      },
    } as unknown as typeof window.echo;

    render(<DesktopLyricsApp />);

    await waitFor(() => expect(getForSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      trackId: remoteTrackId,
      title: 'Remote Song',
      artist: 'Remote Artist',
      album: 'Remote Album',
      durationSeconds: 188,
      mediaType: 'remote',
      sourceId: 'baidu',
      stableKey: remoteTrackId,
    })));
    expect(getForTrack).not.toHaveBeenCalled();
  });

  it('reloads desktop lyrics when the current track lyrics change', async () => {
    const settings = makeDesktopLyricsSettings(false);
    let onChangedHandler: ((trackId: string) => void) | null = null;
    const getForTrack = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        kind: 'synced',
        provider: 'lrclib',
        lines: [{ timeMs: 0, text: 'applied lyric' }],
        offsetMs: 0,
      });

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue(settings),
        loadFontFile: vi.fn(),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(null),
        onStatus: vi.fn(() => () => undefined),
      },
      desktopLyrics: {
        getLastAudioStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: 'track-1',
          currentFilePath: 'D:\\Music\\Song.flac',
          currentTrackTitle: 'Song',
          currentTrackArtist: 'Artist',
          currentTrackAlbum: null,
          currentTrackAlbumArtist: null,
          positionSeconds: 0,
          durationSeconds: 188,
          playbackRate: 1,
        }),
        getState: vi.fn().mockResolvedValue({
          visible: true,
          locked: false,
          bounds: null,
          settings,
        }),
        onAudioStatus: vi.fn(() => () => undefined),
        onStateChanged: vi.fn(() => () => undefined),
        setMousePassthrough: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(null),
      },
      lyrics: {
        getForTrack,
        onChanged: vi.fn((handler) => {
          onChangedHandler = handler;
          return () => undefined;
        }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          currentTrackId: null,
          filePath: null,
          state: 'stopped',
          positionMs: 0,
          durationMs: 0,
        }),
      },
    } as unknown as typeof window.echo;

    const { container } = render(<DesktopLyricsApp />);

    await waitFor(() => expect(getForTrack).toHaveBeenCalledTimes(1));
    expect(container.textContent).toContain('暂无歌词');

    act(() => {
      onChangedHandler?.('track-1');
    });

    await waitFor(() => expect(getForTrack).toHaveBeenCalledTimes(2));
    expect(container.textContent).toContain('applied lyric');
  });

  it('loads Spotify desktop lyrics from forwarded playback status', async () => {
    const settings = makeDesktopLyricsSettings(false);
    const getLyrics = vi.fn().mockResolvedValue({
      provider: 'spotify',
      providerTrackId: 'abc123',
      status: 'available',
      plainLyrics: null,
      syncedLyrics: null,
      lines: [{ timeMs: 0, text: 'spotify lyric' }],
      sourceLabel: 'Spotify lyrics',
    });

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue(settings),
        loadFontFile: vi.fn(),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(null),
        onStatus: vi.fn(() => () => undefined),
      },
      desktopLyrics: {
        getLastAudioStatus: vi.fn().mockResolvedValue(null),
        getLastPlaybackStatus: vi.fn().mockResolvedValue({
          state: 'playing',
          currentTrackId: 'spotify-row-1',
          positionMs: 0,
          durationMs: 180000,
          filePath: 'streaming:spotify:abc123',
        }),
        getState: vi.fn().mockResolvedValue({
          visible: true,
          locked: false,
          bounds: null,
          settings,
        }),
        onAudioStatus: vi.fn(() => () => undefined),
        onPlaybackStatus: vi.fn(() => () => undefined),
        onStateChanged: vi.fn(() => () => undefined),
        setMousePassthrough: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue(null),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          currentTrackId: null,
          filePath: null,
          state: 'stopped',
          positionMs: 0,
          durationMs: 0,
        }),
      },
      streaming: {
        getLyrics,
      },
    } as unknown as typeof window.echo;

    render(<DesktopLyricsApp />);

    await waitFor(() => expect(getLyrics).toHaveBeenCalledWith({
      provider: 'spotify',
      providerTrackId: 'abc123',
    }));
  });

  it('uses theme color mode by default and switches to custom colors from swatches', async () => {
    const settings = makeDesktopLyricsSettings(false);
    const setStyle = vi.fn().mockResolvedValue({
      visible: true,
      locked: false,
      bounds: null,
      settings: {
        ...settings,
        desktopLyricsColorMode: 'custom',
        desktopLyricsColor: '#FFD166',
      },
    });

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue(settings),
        loadFontFile: vi.fn(),
      },
      connect: {
        getStatus: vi.fn().mockResolvedValue(null),
        onStatus: vi.fn(() => () => undefined),
      },
      desktopLyrics: {
        getLastAudioStatus: vi.fn().mockResolvedValue(null),
        getState: vi.fn().mockResolvedValue({
          visible: true,
          locked: false,
          bounds: null,
          settings,
        }),
        onAudioStatus: vi.fn(() => () => undefined),
        onStateChanged: vi.fn(() => () => undefined),
        setMousePassthrough: vi.fn(),
        setStyle,
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue({
          currentTrackId: null,
          filePath: null,
          state: 'stopped',
          positionMs: 0,
          durationMs: 0,
        }),
      },
    } as unknown as typeof window.echo;

    const { container } = render(<DesktopLyricsApp />);
    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');

    expect(app?.getAttribute('data-color-mode')).toBe('theme');
    expect(app?.style.getPropertyValue('--desktop-lyrics-color')).toBe('var(--desktop-lyrics-theme-color)');

    fireEvent.click(await waitFor(() => {
      const swatch = container.querySelector<HTMLButtonElement>('button[title="#FFD166"]');
      expect(swatch).toBeTruthy();
      return swatch!;
    }));

    await waitFor(() => expect(setStyle).toHaveBeenCalledWith({
      desktopLyricsColorMode: 'custom',
      desktopLyricsColor: '#FFD166',
    }));
  });
});
