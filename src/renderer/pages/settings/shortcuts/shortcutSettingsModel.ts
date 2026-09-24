import { Headphones, Play, RotateCcw, RotateCw, Search, SkipBack, SkipForward, Square, Volume2, VolumeX } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  globalShortcutActions,
  type GlobalShortcutAction,
  type GlobalShortcutSettings,
  type LocalShortcutSettings,
} from '../../../../shared/types/globalShortcuts';
import type { TranslationKey } from '../../../i18n/locales';

export const globalShortcutActionMeta: Array<{
  action: GlobalShortcutAction;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
}> = [
  { action: 'playPause', titleKey: 'settings.shortcuts.action.playPause.title', descriptionKey: 'settings.shortcuts.action.playPause.description' },
  { action: 'previousTrack', titleKey: 'settings.shortcuts.action.previousTrack.title', descriptionKey: 'settings.shortcuts.action.previousTrack.description' },
  { action: 'nextTrack', titleKey: 'settings.shortcuts.action.nextTrack.title', descriptionKey: 'settings.shortcuts.action.nextTrack.description' },
  { action: 'stop', titleKey: 'settings.shortcuts.action.stop.title', descriptionKey: 'settings.shortcuts.action.stop.description' },
  { action: 'volumeUp', titleKey: 'settings.shortcuts.action.volumeUp.title', descriptionKey: 'settings.shortcuts.action.volumeUp.description' },
  { action: 'volumeDown', titleKey: 'settings.shortcuts.action.volumeDown.title', descriptionKey: 'settings.shortcuts.action.volumeDown.description' },
  { action: 'seekBackward', titleKey: 'settings.shortcuts.action.seekBackward.title', descriptionKey: 'settings.shortcuts.action.seekBackward.description' },
  { action: 'seekForward', titleKey: 'settings.shortcuts.action.seekForward.title', descriptionKey: 'settings.shortcuts.action.seekForward.description' },
  { action: 'toggleCurrentTrackLiked', titleKey: 'settings.shortcuts.action.toggleCurrentTrackLiked.title', descriptionKey: 'settings.shortcuts.action.toggleCurrentTrackLiked.description' },
  { action: 'openPlaybackQueue', titleKey: 'settings.shortcuts.action.openPlaybackQueue.title', descriptionKey: 'settings.shortcuts.action.openPlaybackQueue.description' },
  { action: 'openSearch', titleKey: 'settings.shortcuts.action.openSearch.title', descriptionKey: 'settings.shortcuts.action.openSearch.description' },
  { action: 'toggleShuffle', titleKey: 'settings.shortcuts.action.toggleShuffle.title', descriptionKey: 'settings.shortcuts.action.toggleShuffle.description' },
  { action: 'cycleRepeatMode', titleKey: 'settings.shortcuts.action.cycleRepeatMode.title', descriptionKey: 'settings.shortcuts.action.cycleRepeatMode.description' },
  { action: 'toggleMute', titleKey: 'settings.shortcuts.action.toggleMute.title', descriptionKey: 'settings.shortcuts.action.toggleMute.description' },
  { action: 'toggleMiniPlayer', titleKey: 'settings.shortcuts.action.toggleMiniPlayer.title', descriptionKey: 'settings.shortcuts.action.toggleMiniPlayer.description' },
  { action: 'showMainWindow', titleKey: 'settings.shortcuts.action.showMainWindow.title', descriptionKey: 'settings.shortcuts.action.showMainWindow.description' },
  { action: 'bossKey', titleKey: 'settings.shortcuts.action.bossKey.title', descriptionKey: 'settings.shortcuts.action.bossKey.description' },
  { action: 'speedUp', titleKey: 'settings.shortcuts.action.speedUp.title', descriptionKey: 'settings.shortcuts.action.speedUp.description' },
  { action: 'speedDown', titleKey: 'settings.shortcuts.action.speedDown.title', descriptionKey: 'settings.shortcuts.action.speedDown.description' },
  { action: 'openAudioSettings', titleKey: 'settings.shortcuts.action.openAudioSettings.title', descriptionKey: 'settings.shortcuts.action.openAudioSettings.description' },
  { action: 'openMvSettings', titleKey: 'settings.shortcuts.action.openMvSettings.title', descriptionKey: 'settings.shortcuts.action.openMvSettings.description' },
  { action: 'openLyricsSettings', titleKey: 'settings.shortcuts.action.openLyricsSettings.title', descriptionKey: 'settings.shortcuts.action.openLyricsSettings.description' },
  { action: 'locateCurrentTrack', titleKey: 'settings.shortcuts.action.locateCurrentTrack.title', descriptionKey: 'settings.shortcuts.action.locateCurrentTrack.description' },
  { action: 'toggleDesktopLyrics', titleKey: 'settings.shortcuts.action.toggleDesktopLyrics.title', descriptionKey: 'settings.shortcuts.action.toggleDesktopLyrics.description' },
  { action: 'toggleDesktopLyricsLock', titleKey: 'settings.shortcuts.action.toggleDesktopLyricsLock.title', descriptionKey: 'settings.shortcuts.action.toggleDesktopLyricsLock.description' },
];

export const shortcutActionIcons: Partial<Record<GlobalShortcutAction, LucideIcon>> = {
  playPause: Play,
  previousTrack: SkipBack,
  nextTrack: SkipForward,
  stop: Square,
  volumeUp: Volume2,
  volumeDown: VolumeX,
  seekBackward: RotateCcw,
  seekForward: RotateCw,
  openSearch: Search,
  openAudioSettings: Headphones,
};

export type ShortcutScope = 'local' | 'global';
export type ShortcutFilter = 'all' | 'enabled' | 'unbound' | 'issues';
export type RecordingShortcutTarget = {
  action: GlobalShortcutAction;
  scope: ShortcutScope;
};
export type ShortcutMessageKey = `${ShortcutScope}:${GlobalShortcutAction}`;

export const shortcutMessageKey = (scope: ShortcutScope, action: GlobalShortcutAction): ShortcutMessageKey => `${scope}:${action}`;
export const localShortcutUnavailableActions = new Set<GlobalShortcutAction>(['showMainWindow']);
export const shortcutFilterOptions: Array<{ filter: ShortcutFilter; labelKey: TranslationKey }> = [
  { filter: 'all', labelKey: 'settings.shortcuts.filter.all' },
  { filter: 'enabled', labelKey: 'settings.shortcuts.filter.enabled' },
  { filter: 'unbound', labelKey: 'settings.shortcuts.filter.unbound' },
  { filter: 'issues', labelKey: 'settings.shortcuts.filter.issues' },
];

const shortcutKeyAliases = new Map<string, string>([
  [' ', 'Space'],
  ['Spacebar', 'Space'],
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['Escape', 'Esc'],
  ['+', 'Plus'],
  ['Add', 'Plus'],
  ['NumpadAdd', 'numadd'],
  ['Subtract', '-'],
  ['NumpadSubtract', 'numsub'],
  ['Multiply', '*'],
  ['NumpadMultiply', 'nummult'],
  ['Divide', '/'],
  ['NumpadDivide', 'numdiv'],
  ['Decimal', '.'],
  ['NumpadDecimal', 'numdec'],
  ['MediaPlayPause', 'MediaPlayPause'],
  ['MediaNextTrack', 'MediaNextTrack'],
  ['MediaPreviousTrack', 'MediaPreviousTrack'],
  ['MediaStop', 'MediaStop'],
]);

export const normalizeShortcutEventKey = (event: KeyboardEvent): string | null => {
  const code = event.code;
  const aliasedCode = shortcutKeyAliases.get(code);
  if (aliasedCode) {
    return aliasedCode;
  }

  if (/^Key[A-Z]$/u.test(code)) {
    return code.slice(3);
  }

  if (/^Digit[0-9]$/u.test(code)) {
    return code.slice(5);
  }

  if (/^Numpad[0-9]$/u.test(code)) {
    return `num${code.slice(6)}`;
  }

  const aliased = shortcutKeyAliases.get(event.key);
  if (aliased) {
    return aliased;
  }

  if (event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta') {
    return null;
  }

  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
};

export const acceleratorFromKeyboardEvent = (event: KeyboardEvent): string | null => {
  const key = normalizeShortcutEventKey(event);
  if (!key) {
    return null;
  }

  const modifiers = [
    event.ctrlKey ? 'Ctrl' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    event.metaKey ? 'Command' : null,
  ].filter((item): item is string => Boolean(item));

  return [...modifiers, key].join('+');
};

export const acceleratorFromMouseEvent = (event: MouseEvent): string | null => {
  switch (event.button) {
    case 1:
      return 'MouseButton3';
    case 3:
      return 'MouseButton4';
    case 4:
      return 'MouseButton5';
    default:
      return null;
  }
};

export const formatAcceleratorForDisplay = (accelerator: string | null | undefined, emptyLabel: string): string =>
  accelerator ? accelerator.split('+').join(' + ') : emptyLabel;

export const findDuplicateShortcutAction = (
  shortcuts: GlobalShortcutSettings | LocalShortcutSettings,
  action: GlobalShortcutAction,
  accelerator: string,
): GlobalShortcutAction | null => {
  const normalized = accelerator.toLowerCase();
  return (
    globalShortcutActions.find(
      (candidate) => candidate !== action && shortcuts[candidate]?.accelerator?.toLowerCase() === normalized,
    ) ?? null
  );
};

export const mergeShortcutSettings = <T extends GlobalShortcutSettings | LocalShortcutSettings>(
  defaults: T,
  saved: Partial<T> | null | undefined,
): T =>
  Object.fromEntries(
    globalShortcutActions.map((action) => [
      action,
      {
        ...defaults[action],
        ...(saved?.[action] ?? {}),
      },
    ]),
  ) as T;

