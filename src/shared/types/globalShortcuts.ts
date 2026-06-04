export const globalShortcutActions = [
  'playPause',
  'previousTrack',
  'nextTrack',
  'stop',
  'volumeUp',
  'volumeDown',
  'seekBackward',
  'seekForward',
  'showMainWindow',
  'bossKey',
  'speedUp',
  'speedDown',
  'openAudioSettings',
  'openMvSettings',
  'openLyricsSettings',
  'locateCurrentTrack',
  'toggleDesktopLyrics',
  'toggleDesktopLyricsLock',
] as const;

export type GlobalShortcutAction = (typeof globalShortcutActions)[number];

export type GlobalShortcutBinding = {
  enabled: boolean;
  accelerator: string | null;
};

export type GlobalShortcutSettings = Record<GlobalShortcutAction, GlobalShortcutBinding>;
export type LocalShortcutAction = GlobalShortcutAction;
export type LocalShortcutBinding = GlobalShortcutBinding;
export type LocalShortcutSettings = Record<LocalShortcutAction, LocalShortcutBinding>;

export type GlobalShortcutValidationReason =
  | 'empty'
  | 'duplicate'
  | 'invalid'
  | 'unsafe'
  | 'unavailable'
  | 'available';

export type GlobalShortcutValidationResult = {
  valid: boolean;
  available: boolean;
  accelerator: string | null;
  reason: GlobalShortcutValidationReason;
};

export const recommendedGlobalShortcuts: GlobalShortcutSettings = {
  playPause: { enabled: false, accelerator: 'Ctrl+Space' },
  previousTrack: { enabled: false, accelerator: 'Ctrl+K' },
  nextTrack: { enabled: false, accelerator: 'Ctrl+J' },
  stop: { enabled: false, accelerator: null },
  volumeUp: { enabled: false, accelerator: 'Ctrl+Up' },
  volumeDown: { enabled: false, accelerator: 'Ctrl+Down' },
  seekBackward: { enabled: false, accelerator: 'Ctrl+Left' },
  seekForward: { enabled: false, accelerator: 'Ctrl+Right' },
  showMainWindow: { enabled: false, accelerator: 'Ctrl+E' },
  bossKey: { enabled: false, accelerator: 'Ctrl+B' },
  speedUp: { enabled: false, accelerator: null },
  speedDown: { enabled: false, accelerator: null },
  openAudioSettings: { enabled: false, accelerator: null },
  openMvSettings: { enabled: false, accelerator: null },
  openLyricsSettings: { enabled: false, accelerator: null },
  locateCurrentTrack: { enabled: false, accelerator: null },
  toggleDesktopLyrics: { enabled: false, accelerator: null },
  toggleDesktopLyricsLock: { enabled: false, accelerator: null },
};

export const recommendedLocalShortcuts: LocalShortcutSettings = {
  playPause: { enabled: true, accelerator: 'Space' },
  previousTrack: { enabled: false, accelerator: 'Ctrl+K' },
  nextTrack: { enabled: false, accelerator: 'Ctrl+J' },
  stop: { enabled: false, accelerator: 'S' },
  volumeUp: { enabled: false, accelerator: 'Ctrl+Up' },
  volumeDown: { enabled: false, accelerator: 'Ctrl+Down' },
  seekBackward: { enabled: false, accelerator: 'Left' },
  seekForward: { enabled: false, accelerator: 'Right' },
  showMainWindow: { enabled: false, accelerator: null },
  bossKey: { enabled: false, accelerator: null },
  speedUp: { enabled: false, accelerator: 'Ctrl+=' },
  speedDown: { enabled: false, accelerator: 'Ctrl+-' },
  openAudioSettings: { enabled: false, accelerator: null },
  openMvSettings: { enabled: false, accelerator: null },
  openLyricsSettings: { enabled: false, accelerator: null },
  locateCurrentTrack: { enabled: false, accelerator: null },
  toggleDesktopLyrics: { enabled: false, accelerator: null },
  toggleDesktopLyricsLock: { enabled: false, accelerator: null },
};

const modifierAliases = new Map<string, string>([
  ['cmdorctrl', 'CommandOrControl'],
  ['commandorcontrol', 'CommandOrControl'],
  ['ctrl', 'Ctrl'],
  ['control', 'Ctrl'],
  ['cmd', 'Command'],
  ['command', 'Command'],
  ['meta', 'Command'],
  ['option', 'Alt'],
  ['alt', 'Alt'],
  ['shift', 'Shift'],
  ['super', 'Super'],
]);

const modifierOrder = ['CommandOrControl', 'Command', 'Ctrl', 'Super', 'Alt', 'Shift'];
const modifierSet = new Set(modifierOrder);
const keyAliases = new Map<string, string>([
  [' ', 'Space'],
  ['spacebar', 'Space'],
  ['space', 'Space'],
  ['esc', 'Esc'],
  ['escape', 'Esc'],
  ['arrowleft', 'Left'],
  ['left', 'Left'],
  ['arrowright', 'Right'],
  ['right', 'Right'],
  ['arrowup', 'Up'],
  ['up', 'Up'],
  ['arrowdown', 'Down'],
  ['down', 'Down'],
  ['mediaplaypause', 'MediaPlayPause'],
  ['medianexttrack', 'MediaNextTrack'],
  ['mediaprevioustrack', 'MediaPreviousTrack'],
  ['mediastop', 'MediaStop'],
  ['mousebutton3', 'MouseButton3'],
  ['mousebutton4', 'MouseButton4'],
  ['mousebutton5', 'MouseButton5'],
  ['xbutton1', 'MouseButton4'],
  ['xbutton2', 'MouseButton5'],
  ['browserback', 'BrowserBack'],
  ['browserforward', 'BrowserForward'],
  ['plus', 'Plus'],
  ['+', 'Plus'],
  ['add', 'Plus'],
  ['numadd', 'numadd'],
  ['numpadadd', 'numadd'],
  ['subtract', '-'],
  ['numsub', 'numsub'],
  ['numpadsubtract', 'numsub'],
  ['multiply', '*'],
  ['nummult', 'nummult'],
  ['numpadmultiply', 'nummult'],
  ['divide', '/'],
  ['numdiv', 'numdiv'],
  ['numpaddivide', 'numdiv'],
  ['decimal', '.'],
  ['numdec', 'numdec'],
  ['numpaddecimal', 'numdec'],
]);

for (let index = 0; index <= 9; index += 1) {
  keyAliases.set(`num${index}`, `num${index}`);
  keyAliases.set(`numpad${index}`, `num${index}`);
}

const normalizeKeyToken = (token: string): string | null => {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  const alias = keyAliases.get(trimmed.toLowerCase());
  if (alias) {
    return alias;
  }

  if (/^Key[A-Z]$/u.test(trimmed)) {
    return trimmed.slice(3);
  }

  if (/^Digit[0-9]$/u.test(trimmed)) {
    return trimmed.slice(5);
  }

  if (/^[a-z]$/u.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  if (/^[A-Z0-9]$/u.test(trimmed)) {
    return trimmed;
  }

  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/iu.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const mouseButtonMatch = /^MouseButton([1-5])$/iu.exec(trimmed);
  if (mouseButtonMatch) {
    return `MouseButton${mouseButtonMatch[1]}`;
  }

  if (/^[A-Za-z0-9_-]+$/u.test(trimmed)) {
    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  }

  if (trimmed === '-' || trimmed === '=' || trimmed === '[' || trimmed === ']' || trimmed === ';' || trimmed === "'" || trimmed === ',' || trimmed === '.' || trimmed === '/' || trimmed === '\\') {
    return trimmed;
  }

  return null;
};

export const normalizeGlobalShortcutAccelerator = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  const modifiers = new Set<string>();
  let key: string | null = null;

  for (const part of parts) {
    const modifier = modifierAliases.get(part.toLowerCase());
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }

    if (key !== null) {
      return null;
    }

    key = normalizeKeyToken(part);
  }

  if (!key || modifierSet.has(key)) {
    return null;
  }

  const orderedModifiers = modifierOrder.filter((modifier) => modifiers.has(modifier));
  return [...orderedModifiers, key].join('+');
};

export const validateGlobalShortcutAccelerator = (value: unknown): GlobalShortcutValidationResult => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { valid: false, available: false, accelerator: null, reason: 'empty' };
  }

  const accelerator = normalizeGlobalShortcutAccelerator(value);
  if (!accelerator) {
    return { valid: false, available: false, accelerator: null, reason: 'invalid' };
  }

  return { valid: true, available: true, accelerator, reason: 'available' };
};

export const isMouseButtonAccelerator = (accelerator: string | null | undefined): accelerator is string =>
  typeof accelerator === 'string' && /^MouseButton[3-5]$/u.test(accelerator);

export const createDefaultGlobalShortcuts = (): GlobalShortcutSettings =>
  Object.fromEntries(globalShortcutActions.map((action) => [action, { enabled: false, accelerator: null }])) as GlobalShortcutSettings;

export const createDefaultLocalShortcuts = (): LocalShortcutSettings =>
  Object.fromEntries(
    globalShortcutActions.map((action) => [
      action,
      {
        ...recommendedLocalShortcuts[action],
      },
    ]),
  ) as LocalShortcutSettings;

export const createRecommendedGlobalShortcuts = (): GlobalShortcutSettings =>
  Object.fromEntries(
    globalShortcutActions.map((action) => [
      action,
      {
        ...recommendedGlobalShortcuts[action],
      },
    ]),
  ) as GlobalShortcutSettings;

export const createRecommendedLocalShortcuts = (): LocalShortcutSettings =>
  Object.fromEntries(
    globalShortcutActions.map((action) => [
      action,
      {
        ...recommendedLocalShortcuts[action],
      },
    ]),
  ) as LocalShortcutSettings;
