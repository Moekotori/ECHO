export type MouseSideButtonDirection = 'previous' | 'next';

export const getMouseSideButtonDirection = (event: MouseEvent): MouseSideButtonDirection | null => {
  if (event.button === 3) {
    return 'previous';
  }

  if (event.button === 4) {
    return 'next';
  }

  return null;
};

export const shouldIgnoreMouseSideButtonTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
};
