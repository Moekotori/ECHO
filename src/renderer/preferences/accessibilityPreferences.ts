import type { AccessibilityPreferences } from '../../shared/types/appSettings';

export const defaultAccessibilityPreferences: AccessibilityPreferences = {
  reduceMotionEnabled: false,
  highContrastEnabled: false,
  uiScalePercent: 100,
  alwaysShowFocusEnabled: false,
  screenReaderAnnouncementsEnabled: false,
};

const uiScalePercents = [100, 115, 130, 150] as const;

export const normalizeAccessibilityPreferences = (
  value: Partial<AccessibilityPreferences> | null | undefined,
): AccessibilityPreferences => {
  const uiScalePercent = uiScalePercents.includes(value?.uiScalePercent as typeof uiScalePercents[number])
    ? value?.uiScalePercent as AccessibilityPreferences['uiScalePercent']
    : defaultAccessibilityPreferences.uiScalePercent;

  return {
    reduceMotionEnabled: value?.reduceMotionEnabled === true,
    highContrastEnabled: value?.highContrastEnabled === true,
    uiScalePercent,
    alwaysShowFocusEnabled: value?.alwaysShowFocusEnabled === true,
    screenReaderAnnouncementsEnabled: value?.screenReaderAnnouncementsEnabled === true,
  };
};

export const applyAccessibilityPreferences = (
  value: Partial<AccessibilityPreferences> | null | undefined,
): AccessibilityPreferences => {
  const preferences = normalizeAccessibilityPreferences(value);
  const root = document.documentElement;

  root.dataset.accessibilityReduceMotion = preferences.reduceMotionEnabled ? 'true' : 'false';
  root.dataset.accessibilityHighContrast = preferences.highContrastEnabled ? 'true' : 'false';
  root.dataset.accessibilityAlwaysShowFocus = preferences.alwaysShowFocusEnabled ? 'true' : 'false';
  root.dataset.accessibilityScreenReaderAnnouncements = preferences.screenReaderAnnouncementsEnabled ? 'true' : 'false';
  root.dataset.accessibilityScale = String(preferences.uiScalePercent);
  root.style.setProperty('--echo-accessibility-ui-scale', String(preferences.uiScalePercent / 100));

  return preferences;
};
