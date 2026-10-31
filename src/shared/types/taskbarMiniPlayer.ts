import type { AppSettings, DesktopLyricsBounds } from './appSettings';

export type TaskbarMiniPlayerEdge = 'top' | 'bottom' | 'left' | 'right';

export type TaskbarMiniPlayerUnsupportedReason =
  | 'non-windows'
  | 'taskbar-not-found'
  | 'taskbar-autohide'
  | 'taskbar-too-small'
  | 'display-unavailable'
  | 'host-missing'
  | 'host-start-failed';

export type TaskbarMiniPlayerState = {
  visible: boolean;
  supported: boolean;
  unsupportedReason: TaskbarMiniPlayerUnsupportedReason | null;
  bounds: DesktopLyricsBounds | null;
  edge: TaskbarMiniPlayerEdge | null;
  hostState?: 'unsupported' | 'missing' | 'stopped' | 'starting' | 'ready' | 'restarting' | 'stopping' | 'error';
  lastError?: string | null;
  settings: Pick<AppSettings, 'taskbarMiniPlayerEnabled'>;
};
