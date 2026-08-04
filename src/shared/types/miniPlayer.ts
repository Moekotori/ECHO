import type { AppSettings, DesktopLyricsBounds } from './appSettings';

export type MiniPlayerBounds = DesktopLyricsBounds;

export type MiniPlayerState = {
  visible: boolean;
  locked: boolean;
  bounds: MiniPlayerBounds | null;
  settings: Pick<AppSettings, 'miniPlayerEnabled' | 'miniPlayerLocked' | 'miniPlayerAutoHideMainWindow' | 'miniPlayerBounds'>;
};

export type MiniPlayerHideOptions = {
  restoreMainWindow?: boolean;
};
