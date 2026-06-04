import type { AppSettings, DesktopLyricsBounds } from './appSettings';
import type { AudioStatus } from './audio';
import type { PlaybackStatus } from './playback';

export type DesktopLyricsStylePatch = Partial<Pick<
  AppSettings,
  | 'desktopLyricsFontSizePx'
  | 'desktopLyricsScalePercent'
  | 'desktopLyricsFontFamily'
  | 'desktopLyricsFontFilePath'
  | 'desktopLyricsColorMode'
  | 'desktopLyricsColor'
  | 'desktopLyricsStrokeColor'
  | 'desktopLyricsOpacityPercent'
  | 'desktopLyricsRomanizationEnabled'
  | 'desktopLyricsTranslationEnabled'
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
    | 'desktopLyricsScalePercent'
    | 'desktopLyricsFontFamily'
    | 'desktopLyricsFontFilePath'
    | 'desktopLyricsColorMode'
    | 'desktopLyricsColor'
    | 'desktopLyricsStrokeColor'
    | 'desktopLyricsOpacityPercent'
    | 'desktopLyricsRomanizationEnabled'
    | 'desktopLyricsTranslationEnabled'
    | 'desktopLyricsBounds'
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
