import type { AppSettings, DesktopLyricsBounds } from './appSettings';
import type { AudioStatus } from './audio';
import type { PlaybackStatus } from './playback';

export type DesktopLyricsStylePatch = Partial<Pick<
  AppSettings,
  | 'desktopLyricsFontSizePx'
  | 'desktopLyricsSecondaryFontSizePx'
  | 'desktopLyricsScalePercent'
  | 'desktopLyricsFontFamily'
  | 'desktopLyricsFontFilePath'
  | 'desktopLyricsColorMode'
  | 'desktopLyricsColor'
  | 'desktopLyricsStrokeColor'
  | 'desktopLyricsGradientStartColor'
  | 'desktopLyricsGradientEndColor'
  | 'desktopLyricsOpacityPercent'
  | 'desktopLyricsTextDirection'
  | 'desktopLyricsRomanizationEnabled'
  | 'desktopLyricsTranslationEnabled'
  | 'desktopLyricsHideWhenNoLyricsEnabled'
>>;

export type DesktopLyricsState = {
  visible: boolean;
  locked: boolean;
  bounds: DesktopLyricsBounds | null;
  settings: Pick<
    AppSettings,
    | 'desktopLyricsEnabled'
    | 'desktopLyricsLocked'
    | 'desktopLyricsFontSizePx'
    | 'desktopLyricsSecondaryFontSizePx'
    | 'desktopLyricsScalePercent'
    | 'desktopLyricsFontFamily'
    | 'desktopLyricsFontFilePath'
    | 'desktopLyricsColorMode'
    | 'desktopLyricsColor'
    | 'desktopLyricsStrokeColor'
    | 'desktopLyricsGradientStartColor'
    | 'desktopLyricsGradientEndColor'
    | 'desktopLyricsOpacityPercent'
    | 'desktopLyricsTextDirection'
    | 'desktopLyricsRomanizationEnabled'
    | 'desktopLyricsTranslationEnabled'
    | 'desktopLyricsHideWhenNoLyricsEnabled'
    | 'desktopLyricsBounds'
    | 'lyricsMusicReactiveVisualsEnabled'
  >;
};

export type DesktopLyricsForwardedAudioStatus = {
  status: AudioStatus;
  receivedAtMs: number;
};

export type DesktopLyricsForwardedPlaybackStatus = {
  status: PlaybackStatus;
  receivedAtMs: number;
};
