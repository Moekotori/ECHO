// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../shared/types/audio';
import type { ConnectSessionStatus } from '../../shared/types/connect';
import type { LibraryTrack } from '../../shared/types/library';
import type { LyricLine, TrackLyrics } from '../../shared/types/lyrics';
import type { PlaybackStatus } from '../../shared/types/playback';
import {
  DesktopLyricsApp,
  getInterpolatedPositionMs,
  getDesktopLyricsLineProgress,
  getDesktopLyricsTextFitScale,
  hqPlayerConnectStatusToDesktopLyricsClock,
  selectDesktopLyricsActiveClock,
  shouldShowDesktopLyricsText,
} from './DesktopLyricsApp';

const makeDesktopLyricsSettingsBase = (locked: boolean) => ({
  desktopLyricsEnabled: true,
  desktopLyricsLocked: locked,
  desktopLyricsFontSizePx: 34,
  desktopLyricsSecondaryFontSizePx: 19,
  desktopLyricsScalePercent: 100,
  desktopLyricsFontFamily: 'Microsoft YaHei',
  desktopLyricsFontFilePath: null,
  desktopLyricsColorMode: 'theme',
  desktopLyricsColor: '#FFFFFF',
  desktopLyricsStrokeColor: '#111827',
  desktopLyricsGradientStartColor: '#4F46E5',
  desktopLyricsGradientEndColor: '#EC4899',
  desktopLyricsOpacityPercent: 96,
  desktopLyricsRomanizationEnabled: true,
  desktopLyricsTranslationEnabled: true,
  desktopLyricsTextDirection: 'horizontal',
  lyricsMusicReactiveVisualsEnabled: false,
  desktopLyricsHideWhenNoLyricsEnabled: false,
  desktopLyricsBounds: null,
});

const makeDesktopLyricsSettings = (
  locked: boolean,
  overrides: Partial<ReturnType<typeof makeDesktopLyricsSettingsBase>> = {},
) => ({
  ...makeDesktopLyricsSettingsBase(locked),
  ...overrides,
});

const makeDesktopLyricsTrack = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\Song.flac',
  title: 'Song',
  artist: 'Artist',
  album: '',
  albumArtist: '',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 188,
  codec: null,
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
  mediaType: 'local',
  ...overrides,
});

const makeDesktopTrackLyrics = (
  lines: LyricLine[],
  overrides: Partial<TrackLyrics> = {},
): TrackLyrics => ({
  id: 'lyrics-1',
  trackId: 'track-1',
  provider: 'lrclib',
  kind: 'synced',
  title: 'Song',
  artist: 'Artist',
  album: null,
  durationSeconds: 188,
  lines,
  offsetMs: 0,
  cachedAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
  ...overrides,
});

const makeDesktopAudioStatus = (
  track: LibraryTrack,
  overrides: Partial<AudioStatus> = {},
): AudioStatus => ({
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
  durationSeconds: track.duration,
  positionSeconds: 12,
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
  eqPresetName: null,
  clippingRisk: false,
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
  audioLevels: {
    inputPeakDb: -4,
    inputRmsDb: -18,
    estimatedOutputPeakDb: -4,
    estimatedOutputRmsDb: -18,
    visualSpectrum: Array.from({ length: 32 }, (_, index) => (index % 6) / 5),
    visualSpectrumVersion: 2,
    visualEnergy: 0.64,
    visualTransient: 0.52,
    visualTelemetryState: 'pcm',
    headroomDb: 2.8,
    clipCount: 0,
    lastClipAt: null,
    meterSource: 'pre_native_estimated_post_dsp',
  },
  ...overrides,
});

const renderDesktopLyricsApp = (
  locked: boolean,
  options: {
    playbackStatus?: PlaybackStatus;
    connectStatus?: ConnectSessionStatus | null;
    settings?: Partial<ReturnType<typeof makeDesktopLyricsSettingsBase>>;
    audioStatus?: AudioStatus | null;
    track?: LibraryTrack;
    lyrics?: TrackLyrics | null;
    desktopLyricsVisible?: boolean;
  } = {},
): {
  container: HTMLElement;
  connectPause: ReturnType<typeof vi.fn>;
  connectPlay: ReturnType<typeof vi.fn>;
  playbackPause: ReturnType<typeof vi.fn>;
  playbackPlay: ReturnType<typeof vi.fn>;
  setMousePassthrough: ReturnType<typeof vi.fn>;
  setStyle: ReturnType<typeof vi.fn>;
  triggerRevealMenu: () => void;
} => {
  const settings = makeDesktopLyricsSettings(locked, options.settings);
  const track = options.track ?? null;
  const lyrics = options.lyrics ?? null;
  const playbackStatus = options.playbackStatus ?? {
    currentTrackId: null,
    filePath: null,
    state: 'stopped',
    positionMs: 0,
    durationMs: 0,
  };
  const connectStatus = options.connectStatus ?? null;
  const connectPlay = vi.fn().mockResolvedValue(connectStatus);
  const connectPause = vi.fn().mockResolvedValue(connectStatus);
  const playbackPlay = vi.fn().mockResolvedValue({ ...playbackStatus, state: 'playing' });
  const playbackPause = vi.fn().mockResolvedValue({ ...playbackStatus, state: 'paused' });
  const setMousePassthrough = vi.fn();
  const revealMenuHandlers: Array<() => void> = [];
  const setStyle = vi.fn((patch: Partial<ReturnType<typeof makeDesktopLyricsSettingsBase>>) =>
    Promise.resolve({
      visible: true,
      locked,
      bounds: null,
      settings: {
        ...settings,
        ...patch,
      },
    }),
  );

  window.echo = {
    app: {
      getSettings: vi.fn().mockResolvedValue(settings),
      loadFontFile: vi.fn(),
    },
    connect: {
      getStatus: vi.fn().mockResolvedValue(connectStatus),
      onStatus: vi.fn(() => () => undefined),
      pause: connectPause,
      play: connectPlay,
    },
    desktopLyrics: {
      getLastAudioStatus: vi.fn().mockResolvedValue(options.audioStatus ?? null),
      getState: vi.fn().mockResolvedValue({
        visible: options.desktopLyricsVisible ?? true,
        locked,
        bounds: null,
        settings,
      }),
      onAudioStatus: vi.fn(() => () => undefined),
      onRevealMenu: vi.fn((handler: () => void) => {
        revealMenuHandlers.push(handler);
        return () => {
          const index = revealMenuHandlers.indexOf(handler);
          if (index >= 0) {
            revealMenuHandlers.splice(index, 1);
          }
        };
      }),
      onStateChanged: vi.fn(() => () => undefined),
      setMousePassthrough,
      setStyle,
    },
    playback: {
      getStatus: vi.fn().mockResolvedValue(playbackStatus),
      pause: playbackPause,
      play: playbackPlay,
    },
  } as unknown as typeof window.echo;
  if (track) {
    window.echo.library = {
      getTrack: vi.fn().mockResolvedValue(track),
    } as unknown as typeof window.echo.library;
  }
  if (lyrics) {
    window.echo.lyrics = {
      getForTrack: vi.fn().mockResolvedValue(lyrics),
    } as unknown as typeof window.echo.lyrics;
  }

  const { container } = render(<DesktopLyricsApp />);

  return {
    container,
    connectPause,
    connectPlay,
    playbackPause,
    playbackPlay,
    setMousePassthrough,
    setStyle,
    triggerRevealMenu: () => revealMenuHandlers.forEach((handler) => handler()),
  };
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'elementFromPoint');
  Reflect.deleteProperty(window, 'echo');
});

describe('desktop lyrics text fitting', () => {
  it('keeps vertical desktop lyric columns close together', () => {
    const css = readFileSync('src/renderer/styles/desktop-lyrics.css', 'utf8');

    expect(css).toMatch(/\.desktop-lyrics-app\[data-text-direction="vertical"\] \.desktop-lyrics-line-text \{[\s\S]*?gap: clamp\(6px, 1\.4vw, 18px\);/);
    expect(css).toMatch(/\.desktop-lyrics-upright-character\[data-sideways="true"\] \+ \.desktop-lyrics-upright-character\[data-sideways="true"\][\s\S]*?margin-top: 0\.28em;/);
  });

  it('lets the floating menu use its full width without horizontal scrolling', () => {
    const css = readFileSync('src/renderer/styles/desktop-lyrics.css', 'utf8');

    expect(css).toMatch(/\.desktop-lyrics-menu \{[\s\S]*?max-width: none;[\s\S]*?overflow: visible;/);
    expect(css).not.toContain('overflow-x: auto;');
  });

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

  it('fits vertical desktop lyrics against the available height', () => {
    expect(shouldShowDesktopLyricsText({
      text: '短歌词',
      availableWidthPx: 32,
      availableHeightPx: 320,
      fontSizePx: 34,
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontWeight: 700,
      scalePercent: 100,
      textDirection: 'vertical',
    })).toBe(true);

    const fitScale = getDesktopLyricsTextFitScale({
      text: 'Wonderland '.repeat(10),
      availableWidthPx: 1200,
      availableHeightPx: 180,
      fontSizePx: 34,
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontWeight: 700,
      scalePercent: 100,
      textDirection: 'vertical',
    });

    expect(fitScale).toBe(1);
  });

  it('fits sideways latin runs in vertical desktop lyrics without per-letter height', () => {
    expect(shouldShowDesktopLyricsText({
      text: 'The tenacity',
      availableWidthPx: 32,
      availableHeightPx: 240,
      fontSizePx: 34,
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontWeight: 700,
      scalePercent: 100,
      textDirection: 'vertical',
    })).toBe(true);
  });

  it('keeps horizontal desktop lyrics on the existing minimum fit scale', () => {
    const fitScale = getDesktopLyricsTextFitScale({
      text: 'Wonderland '.repeat(20),
      availableWidthPx: 120,
      fontSizePx: 34,
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontWeight: 700,
      scalePercent: 100,
    });

    expect(fitScale).toBe(0.62);
  });

  it('computes vertical scroll progress from the active lyric timing', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const progress = getDesktopLyricsLineProgress(
      [
        { timeMs: 10_000, text: 'first line' },
        { timeMs: 14_000, text: 'second line' },
      ],
      0,
      {
        source: 'playback',
        currentTrackId: 'track-1',
        filePath: 'D:\\Music\\Song.flac',
        state: 'playing',
        positionMs: 11_000,
        durationMs: 180_000,
        playbackRate: 1,
        updatedAtMs: 0,
      },
      0,
    );

    expect(progress).toBe(0.5);
    performanceNow.mockRestore();
  });

  it('uses the horizontal width when fitting horizontal desktop lyrics', () => {
    const fitScale = getDesktopLyricsTextFitScale({
      text: 'Wonderland '.repeat(10),
      availableWidthPx: 320,
      availableHeightPx: 1800,
      fontSizePx: 34,
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontWeight: 700,
      scalePercent: 100,
    });

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

  it('keeps the desktop lyrics music reactive backdrop disabled even if old settings enabled it', async () => {
    const track = makeDesktopLyricsTrack();
    const { container } = renderDesktopLyricsApp(false, {
      settings: { lyricsMusicReactiveVisualsEnabled: true },
      audioStatus: makeDesktopAudioStatus(track),
      track,
      lyrics: makeDesktopTrackLyrics([{ timeMs: 0, text: 'Reactive line' }]),
      playbackStatus: {
        currentTrackId: track.id,
        filePath: track.path,
        state: 'playing',
        positionMs: 12_000,
        durationMs: 188_000,
      },
    });

    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');
    await waitFor(() => expect(container.textContent).toContain('Reactive line'));
    expect(app?.getAttribute('data-music-reactive')).toBeNull();
    expect(container.querySelector('.desktop-lyrics-reactive-backdrop')).toBeNull();
    expect(app?.style.getPropertyValue('--desktop-lyrics-reactive-energy')).toBe('');
    expect(app?.style.getPropertyValue('--desktop-lyrics-reactive-transient')).toBe('');
  });

  it('hides placeholder desktop lyrics when no lyrics are available and the option is enabled', async () => {
    const track = makeDesktopLyricsTrack();
    const { container } = renderDesktopLyricsApp(false, {
      settings: { desktopLyricsHideWhenNoLyricsEnabled: true },
      audioStatus: makeDesktopAudioStatus(track),
      track,
      lyrics: makeDesktopTrackLyrics([], { kind: 'empty' }),
      playbackStatus: {
        currentTrackId: track.id,
        filePath: track.path,
        state: 'playing',
        positionMs: 12_000,
        durationMs: 188_000,
      },
    });

    await waitFor(() => expect(container.querySelector('.desktop-lyrics-app')).toBeTruthy());
    expect(container.querySelector('.desktop-lyrics-stage')).toBeNull();
    expect(container.textContent).not.toContain('暂无歌词');
    expect(container.textContent).not.toContain('Desktop Lyrics');
  });

  it('still shows real desktop lyrics when the hide-empty option is enabled', async () => {
    const track = makeDesktopLyricsTrack();
    const { container } = renderDesktopLyricsApp(false, {
      settings: { desktopLyricsHideWhenNoLyricsEnabled: true },
      audioStatus: makeDesktopAudioStatus(track),
      track,
      lyrics: makeDesktopTrackLyrics([{ timeMs: 0, text: 'Visible line' }]),
      playbackStatus: {
        currentTrackId: track.id,
        filePath: track.path,
        state: 'playing',
        positionMs: 12_000,
        durationMs: 188_000,
      },
    });

    await waitFor(() => expect(container.textContent).toContain('Visible line'));
    expect(container.querySelector('.desktop-lyrics-stage')).toBeTruthy();
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

  it('toggles a pinned desktop lyrics menu from the footer context-menu command', async () => {
    const { container, triggerRevealMenu } = renderDesktopLyricsApp(false);
    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');

    expect(app).toBeTruthy();
    expect(app?.getAttribute('data-menu-visible')).toBe('false');

    triggerRevealMenu();
    await waitFor(() => expect(app?.getAttribute('data-menu-visible')).toBe('true'));

    window.dispatchEvent(new MouseEvent('mouseleave'));
    await waitFor(() => expect(app?.getAttribute('data-menu-visible')).toBe('true'));

    triggerRevealMenu();
    await waitFor(() => expect(app?.getAttribute('data-menu-visible')).toBe('false'));
  });

  it('toggles the desktop lyrics text direction from the floating menu', async () => {
    const { container, setStyle } = renderDesktopLyricsApp(false);
    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');

    await waitFor(() => expect(app?.getAttribute('data-text-direction')).toBe('horizontal'));
    fireEvent.click(await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="切换横排 / 竖排"]');
      expect(button).toBeTruthy();
      return button!;
    }));

    await waitFor(() => expect(setStyle).toHaveBeenCalledWith({ desktopLyricsTextDirection: 'vertical' }));
    expect(app?.getAttribute('data-text-direction')).toBe('vertical');
  });

  it('adjusts primary and translation font sizes independently from the floating menu', async () => {
    const { container, setStyle } = renderDesktopLyricsApp(false, {
      settings: {
        desktopLyricsFontSizePx: 46,
        desktopLyricsSecondaryFontSizePx: 24,
      },
    });
    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.desktop-lyrics-menu button'));

    await waitFor(() => expect(app?.style.getPropertyValue('--desktop-lyrics-font-size')).toBe('46px'));
    expect(app?.style.getPropertyValue('--desktop-lyrics-secondary-font-size')).toBe('24px');

    fireEvent.click(buttons[2]);
    await waitFor(() => expect(setStyle).toHaveBeenCalledWith({ desktopLyricsFontSizePx: 48 }));

    fireEvent.click(buttons[3]);
    await waitFor(() => expect(setStyle).toHaveBeenCalledWith({ desktopLyricsSecondaryFontSizePx: 23 }));
  });

  it('keeps romanization and translation grouped with vertical desktop lyrics', async () => {
    const { container } = renderDesktopLyricsApp(false, {
      settings: { desktopLyricsTextDirection: 'vertical' },
      track: makeDesktopLyricsTrack(),
      lyrics: makeDesktopTrackLyrics([{
        timeMs: 0,
        text: 'らくになる日はまず来ない',
        romanization: 'ra ku ni na ru hi wa ma zu ko na i',
        translation: '轻松的生活不会到来',
      }]),
      playbackStatus: {
        currentTrackId: 'track-1',
        filePath: 'D:\\Music\\Song.flac',
        state: 'playing',
        positionMs: 0,
        durationMs: 188_000,
      },
    });

    await waitFor(() => expect(container.querySelector('.desktop-lyrics-app')?.getAttribute('data-text-direction')).toBe('vertical'));
    await waitFor(() => expect(container.querySelector('.desktop-lyrics-line-text strong')?.textContent).toBe('らくになる日はまず来ない'));
    const lineText = container.querySelector('.desktop-lyrics-line-text');
    const secondaryTextElements = Array.from(lineText?.children ?? []).filter((element) => element.tagName === 'SPAN');
    expect(lineText?.querySelector('strong')?.textContent).toBe('らくになる日はまず来ない');
    expect(secondaryTextElements[0]?.textContent).toBe('rakuninaruhiwamazukonai');
    expect(secondaryTextElements[1]?.textContent).toBe('轻松的生活不会到来');
    expect(secondaryTextElements[0]?.getAttribute('data-secondary-kind')).toBe('romanization');
    expect(secondaryTextElements[1]?.getAttribute('data-secondary-kind')).toBe('translation');
    expect(lineText?.querySelectorAll('strong .desktop-lyrics-upright-character').length).toBe(
      Array.from('らくになる日はまず来ない').length,
    );
    const romanizationTokens = Array.from(
      lineText?.querySelectorAll<HTMLElement>('[data-secondary-kind="romanization"] .desktop-lyrics-romanization-token') ?? [],
    );
    expect(romanizationTokens.map((token) => token.textContent)).toEqual([
      'ra',
      'ku',
      'ni',
      'na',
      'ru',
      'hi',
      'wa',
      'ma',
      'zu',
      'ko',
      'na',
      'i',
    ]);
    expect(lineText?.querySelectorAll('[data-secondary-kind="romanization"] .desktop-lyrics-romanization-character[data-sideways="true"]').length).toBeGreaterThan(0);
    expect(lineText?.querySelectorAll('[data-secondary-kind="translation"] .desktop-lyrics-upright-character').length).toBe(
      Array.from('轻松的生活不会到来').length,
    );
  });

  it('renders latin text sideways in vertical desktop lyrics', async () => {
    const { container } = renderDesktopLyricsApp(false, {
      settings: { desktopLyricsTextDirection: 'vertical' },
      track: makeDesktopLyricsTrack(),
      lyrics: makeDesktopTrackLyrics([
        { timeMs: 0, text: 'The tenacity', translation: '坚如磐石' },
      ]),
      playbackStatus: {
        currentTrackId: 'track-1',
        filePath: 'D:\\Music\\Song.flac',
        state: 'playing',
        positionMs: 0,
        durationMs: 188_000,
      },
    });

    const sidewaysTokens = await waitFor(() => {
      const tokens = Array.from(container.querySelectorAll<HTMLElement>('strong .desktop-lyrics-upright-character[data-sideways="true"]'));
      expect(tokens.map((token) => token.textContent)).toEqual(['The', 'tenacity']);
      return tokens;
    });

    expect(sidewaysTokens).toHaveLength(2);
    expect(container.querySelectorAll('strong .desktop-lyrics-upright-character')).toHaveLength(2);
  });

  it('keeps vertical desktop lyrics at the configured size when romanization is long', async () => {
    const { container } = renderDesktopLyricsApp(false, {
      settings: { desktopLyricsTextDirection: 'vertical' },
      track: makeDesktopLyricsTrack(),
      lyrics: makeDesktopTrackLyrics([{
        timeMs: 0,
        text: '短い歌詞',
        romanization: 'ra ku ni na ru hi wa ma zu ko na i '.repeat(4).trim(),
        translation: '很长的翻译文本'.repeat(8),
      }]),
      playbackStatus: {
        currentTrackId: 'track-1',
        filePath: 'D:\\Music\\Song.flac',
        state: 'playing',
        positionMs: 0,
        durationMs: 188_000,
      },
    });

    await waitFor(() => expect(container.querySelector('.desktop-lyrics-app')?.getAttribute('data-text-direction')).toBe('vertical'));
    const lineText = container.querySelector<HTMLElement>('.desktop-lyrics-line-text');
    expect(lineText?.style.getPropertyValue('--desktop-lyrics-text-fit-scale')).toBe('1.000');
    expect(Number(lineText?.style.getPropertyValue('--desktop-lyrics-line-progress'))).toBeGreaterThanOrEqual(0);
    expect(Number(lineText?.style.getPropertyValue('--desktop-lyrics-line-progress'))).toBeLessThan(0.01);
    expect(lineText?.style.getPropertyValue('--desktop-lyrics-secondary-text-fit-scale')).toBe('');
    expect(lineText?.querySelectorAll('.desktop-lyrics-scroll-track').length).toBe(lineText?.children.length);
    expect(container.querySelector('.desktop-lyrics-lines strong')?.textContent).toBe('短い歌詞');
  });

  it('centers fitting vertical desktop columns and scrolls overflowing columns by lyric progress', async () => {
    const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
    const innerHeightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(1_000);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 220,
    });

    const options = {
      settings: { desktopLyricsTextDirection: 'vertical' as const },
      track: makeDesktopLyricsTrack(),
      lyrics: makeDesktopTrackLyrics([
        {
          timeMs: 0,
          text: '短い歌詞',
          romanization: 'ra ku ni na ru hi wa ma zu ko na i '.repeat(4).trim(),
          translation: '居中翻译',
        },
        { timeMs: 4_000, text: 'next line' },
      ]),
      playbackStatus: {
        currentTrackId: 'track-1',
        filePath: 'D:\\Music\\Song.flac',
        state: 'paused' as const,
        positionMs: 2_000,
        durationMs: 188_000,
      },
    };

    try {
      const { container } = renderDesktopLyricsApp(false, options);

      await waitFor(() => {
        const lineTextElement = container.querySelector('.desktop-lyrics-line-text');
        expect(lineTextElement).toBeTruthy();
        expect(lineTextElement?.textContent).toContain('居中翻译');
      });
      const lineText = container.querySelector<HTMLElement>('.desktop-lyrics-line-text');
      const clips = Array.from(lineText?.querySelectorAll<HTMLElement>('.desktop-lyrics-scroll-clip') ?? []);
      const tracks = Array.from(lineText?.querySelectorAll<HTMLElement>('.desktop-lyrics-scroll-track') ?? []);
      expect(clips.length).toBe(2);

      Object.defineProperty(clips[0], 'clientHeight', { configurable: true, value: 200 });
      Object.defineProperty(tracks[0], 'scrollHeight', { configurable: true, value: 120 });
      Object.defineProperty(clips[1], 'clientHeight', { configurable: true, value: 200 });
      Object.defineProperty(tracks[1], 'scrollHeight', { configurable: true, value: 520 });

      window.dispatchEvent(new Event('resize'));

      await waitFor(() => expect(clips[1].dataset.overflow).toBe('true'));
      expect(clips[0].dataset.overflow).toBe('false');
      expect(tracks[1].style.getPropertyValue('--desktop-lyrics-scroll-offset')).toBe('-160.00px');
      expect(tracks[0].style.getPropertyValue('--desktop-lyrics-scroll-offset')).toBe('0.00px');
    } finally {
      if (resizeObserverDescriptor) {
        Object.defineProperty(window, 'ResizeObserver', resizeObserverDescriptor);
      } else {
        Reflect.deleteProperty(window, 'ResizeObserver');
      }
      if (innerHeightDescriptor) {
        Object.defineProperty(window, 'innerHeight', innerHeightDescriptor);
      }
    }
  });

  it('pauses native playback from the floating menu while playing', async () => {
    const { container, playbackPause, playbackPlay, connectPause } = renderDesktopLyricsApp(false, {
      playbackStatus: {
        currentTrackId: 'track-1',
        filePath: 'D:\\Music\\Song.flac',
        state: 'playing',
        positionMs: 12_000,
        durationMs: 180_000,
      },
    });

    fireEvent.click(await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="暂停"]');
      expect(button).toBeTruthy();
      return button!;
    }));

    await waitFor(() => expect(playbackPause).toHaveBeenCalledTimes(1));
    expect(playbackPause).toHaveBeenCalledWith();
    expect(playbackPlay).not.toHaveBeenCalled();
    expect(connectPause).not.toHaveBeenCalled();
  });

  it('resumes native playback from the floating menu while paused', async () => {
    const { container, playbackPause, playbackPlay } = renderDesktopLyricsApp(false, {
      playbackStatus: {
        currentTrackId: 'track-1',
        filePath: 'D:\\Music\\Song.flac',
        state: 'paused',
        positionMs: 12_000,
        durationMs: 180_000,
      },
    });

    fireEvent.click(await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="播放"]');
      expect(button).toBeTruthy();
      return button!;
    }));

    await waitFor(() => expect(playbackPlay).toHaveBeenCalledTimes(1));
    expect(playbackPlay).toHaveBeenCalledWith();
    expect(playbackPause).not.toHaveBeenCalled();
  });

  it('keeps the desktop lyric clock moving from the resume click while native playback is pending', async () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const settings = makeDesktopLyricsSettings(false);
    const pausedStatus: PlaybackStatus = {
      currentTrackId: 'track-1',
      filePath: 'D:\\Music\\Song.flac',
      state: 'paused',
      positionMs: 12_000,
      durationMs: 180_000,
    };
    let resolvePlay: ((status: PlaybackStatus) => void) | null = null;
    const playbackPlay = vi.fn(() => new Promise<PlaybackStatus>((resolve) => {
      resolvePlay = resolve;
    }));

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
        setStyle: vi.fn(),
      },
      library: {
        getTrack: vi.fn().mockResolvedValue({
          id: 'track-1',
          path: 'D:\\Music\\Song.flac',
          title: 'Song',
          artist: 'Artist',
          album: null,
          albumArtist: null,
          duration: 180,
          mediaType: 'local',
        }),
      },
      lyrics: {
        getForTrack: vi.fn().mockResolvedValue({
          kind: 'synced',
          provider: 'lrclib',
          lines: [
            { timeMs: 12_000, text: 'resume line' },
            { timeMs: 12_600, text: 'on beat line' },
          ],
          offsetMs: 0,
        }),
      },
      playback: {
        getStatus: vi.fn().mockResolvedValue(pausedStatus),
        pause: vi.fn(),
        play: playbackPlay,
      },
    } as unknown as typeof window.echo;

    const { container } = render(<DesktopLyricsApp />);

    await waitFor(() => expect(container.querySelector('.desktop-lyrics-lines strong')?.textContent).toBe('resume line'));

    fireEvent.click(await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="播放"]');
      expect(button).toBeTruthy();
      return button!;
    }));
    await waitFor(() => expect(playbackPlay).toHaveBeenCalledTimes(1));
    expect(playbackPlay).toHaveBeenCalledWith();

    performanceNow.mockReturnValue(700);
    act(() => {
      for (const [id, callback] of Array.from(frames.entries())) {
        frames.delete(id);
        callback(700);
      }
    });

    await waitFor(() => expect(container.querySelector('.desktop-lyrics-lines strong')?.textContent).toBe('on beat line'));

    await act(async () => {
      resolvePlay?.({ ...pausedStatus, state: 'playing' });
    });
    performanceNow.mockReturnValue(800);
    act(() => {
      for (const [id, callback] of Array.from(frames.entries())) {
        frames.delete(id);
        callback(800);
      }
    });

    expect(container.querySelector('.desktop-lyrics-lines strong')?.textContent).toBe('on beat line');
  });

  it('uses low-frequency lyric sync while the desktop lyrics window is hidden', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval').mockImplementation((handler, timeout): ReturnType<typeof window.setInterval> => {
      void handler;
      void timeout;
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    });
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
    const track = makeDesktopLyricsTrack();

    renderDesktopLyricsApp(false, {
      desktopLyricsVisible: false,
      track,
      lyrics: makeDesktopTrackLyrics([
        { timeMs: 12_000, text: 'hidden line' },
        { timeMs: 12_600, text: 'next hidden line' },
      ]),
      playbackStatus: {
        currentTrackId: track.id,
        filePath: track.path,
        state: 'playing',
        positionMs: 12_000,
        durationMs: track.duration * 1000,
      },
    });

    await waitFor(() => {
      expect(intervalSpy.mock.calls.some(([, timeout]) => timeout === 500)).toBe(true);
    });
  });

  it('prefers Connect playback controls when the active desktop clock is from Connect', async () => {
    const connectStatus: ConnectSessionStatus = {
      deviceId: 'hqplayer:local-desktop',
      protocol: 'hqplayer',
      state: 'playing',
      currentTrackId: 'connect-track',
      metadata: {
        title: 'Connect Track',
        artist: 'Artist',
        album: null,
        albumArtist: null,
        durationSeconds: 180,
        coverHttpUrl: '',
      },
      positionSeconds: 12,
      durationSeconds: 180,
      latencyMs: null,
      error: null,
      updatedAt: '2026-05-25T00:00:00.000Z',
    };
    const { container, connectPause, playbackPause } = renderDesktopLyricsApp(false, { connectStatus });

    fireEvent.click(await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="暂停"]');
      expect(button).toBeTruthy();
      return button!;
    }));

    await waitFor(() => expect(connectPause).toHaveBeenCalledTimes(1));
    expect(playbackPause).not.toHaveBeenCalled();
  });

  it('keeps a local playback command clock ahead of older forwarded desktop lyrics status', () => {
    const playbackClock = {
      source: 'playback' as const,
      currentTrackId: 'track-1',
      filePath: 'D:\\Music\\Song.flac',
      state: 'playing',
      positionMs: 12_700,
      durationMs: 180_000,
      playbackRate: 1,
      updatedAtMs: 700,
    };
    const forwardedClock = {
      ...playbackClock,
      source: 'forwarded' as const,
      positionMs: 12_000,
      updatedAtMs: 100,
    };

    expect(selectDesktopLyricsActiveClock({
      forwardedClock,
      forwardedUpdatedAtMs: 100,
      nowMs: 800,
      playbackClock,
      playbackClockPriorityUntilMs: 2_000,
    })).toBe(playbackClock);
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

  it('auto-hides the desktop lyrics menu after hover idle without a mouse leave event', async () => {
    const { container, setMousePassthrough } = renderDesktopLyricsApp(false);
    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');
    const primaryText = container.querySelector<HTMLElement>('.desktop-lyrics-lines strong');

    expect(app).toBeTruthy();
    expect(primaryText).toBeTruthy();
    await waitFor(() => expect(setMousePassthrough).toHaveBeenCalledWith(true));
    setMousePassthrough.mockClear();

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => primaryText),
    });

    vi.useFakeTimers();
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 40 }));
    });

    expect(app?.getAttribute('data-menu-visible')).toBe('true');
    expect(setMousePassthrough).toHaveBeenCalledWith(false);

    act(() => {
      vi.advanceTimersByTime(1799);
    });
    expect(app?.getAttribute('data-menu-visible')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(app?.getAttribute('data-menu-visible')).toBe('false');
    expect(setMousePassthrough).not.toHaveBeenCalledWith(true);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => app),
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 12, clientY: 12 }));
    });
    expect(setMousePassthrough).toHaveBeenCalledWith(true);
  });

  it('reveals the desktop lyrics menu from the host reveal event', async () => {
    const { container, setMousePassthrough, triggerRevealMenu } = renderDesktopLyricsApp(false);
    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');

    expect(app).toBeTruthy();
    await waitFor(() => expect(setMousePassthrough).toHaveBeenCalledWith(true));
    setMousePassthrough.mockClear();

    act(() => {
      triggerRevealMenu();
    });

    expect(app?.getAttribute('data-menu-visible')).toBe('true');
    expect(setMousePassthrough).toHaveBeenCalledWith(false);
  });

  it('reveals the desktop lyrics menu over the whole unlocked lyrics container', async () => {
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

    await waitFor(() => expect(app?.getAttribute('data-menu-visible')).toBe('true'));
    expect(setMousePassthrough).toHaveBeenCalledWith(false);
  });

  it('reveals the desktop lyrics menu from the vertical lyrics hit rectangle', async () => {
    const { container, setMousePassthrough } = renderDesktopLyricsApp(false, {
      settings: { desktopLyricsTextDirection: 'vertical' },
    });
    const app = container.querySelector<HTMLElement>('.desktop-lyrics-app');
    const lines = container.querySelector<HTMLElement>('.desktop-lyrics-lines');

    expect(app).toBeTruthy();
    expect(lines).toBeTruthy();
    await waitFor(() => expect(setMousePassthrough).toHaveBeenCalledWith(true));
    setMousePassthrough.mockClear();

    Object.defineProperty(lines, 'getBoundingClientRect', {
      configurable: true,
      value: vi.fn(() => ({
        bottom: 580,
        height: 520,
        left: 180,
        right: 320,
        top: 60,
        width: 140,
        x: 180,
        y: 60,
        toJSON: () => ({}),
      })),
    });
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => app),
    });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 320 }));

    await waitFor(() => expect(app?.getAttribute('data-menu-visible')).toBe('true'));
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

  it('switches desktop lyrics to a custom gradient from the floating menu', async () => {
    const { container, setStyle } = renderDesktopLyricsApp(false);

    fireEvent.click(await waitFor(() => {
      const swatch = container.querySelector<HTMLButtonElement>('.desktop-lyrics-gradient-swatch');
      expect(swatch).toBeTruthy();
      return swatch!;
    }));

    await waitFor(() => expect(setStyle).toHaveBeenCalledWith({
      desktopLyricsColorMode: 'gradient',
      desktopLyricsGradientStartColor: '#4F46E5',
      desktopLyricsGradientEndColor: '#EC4899',
    }));
  });
});
