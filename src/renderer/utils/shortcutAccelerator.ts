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

const normalizeShortcutEventKey = (event: KeyboardEvent): string | null => {
  const aliasedCode = shortcutKeyAliases.get(event.code);
  if (aliasedCode) {
    return aliasedCode;
  }

  if (/^Key[A-Z]$/u.test(event.code)) {
    return event.code.slice(3);
  }

  if (/^Digit[0-9]$/u.test(event.code)) {
    return event.code.slice(5);
  }

  if (/^Numpad[0-9]$/u.test(event.code)) {
    return `num${event.code.slice(6)}`;
  }

  const aliasedKey = shortcutKeyAliases.get(event.key);
  if (aliasedKey) {
    return aliasedKey;
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

const isTextEditingElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false;
  }

  const editableTarget = target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]',
  );
  return Boolean(editableTarget) || target instanceof HTMLElement && target.isContentEditable;
};

export const isShortcutTextTarget = (event: KeyboardEvent): boolean =>
  event.composedPath().some((target) => isTextEditingElement(target)) || isTextEditingElement(document.activeElement);
