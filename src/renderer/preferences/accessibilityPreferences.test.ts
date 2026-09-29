// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  applyAccessibilityPreferences,
  normalizeAccessibilityPreferences,
} from './accessibilityPreferences';

describe('accessibility preferences', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-accessibility-reduce-motion');
    document.documentElement.removeAttribute('data-accessibility-high-contrast');
    document.documentElement.removeAttribute('data-accessibility-always-show-focus');
    document.documentElement.removeAttribute('data-accessibility-screen-reader-announcements');
    document.documentElement.removeAttribute('data-accessibility-scale');
    document.documentElement.style.removeProperty('--echo-accessibility-ui-scale');
  });

  it('applies the accessibility state to the document root', () => {
    applyAccessibilityPreferences({
      reduceMotionEnabled: true,
      highContrastEnabled: true,
      uiScalePercent: 130,
      alwaysShowFocusEnabled: true,
      screenReaderAnnouncementsEnabled: true,
    });

    expect(document.documentElement.dataset.accessibilityReduceMotion).toBe('true');
    expect(document.documentElement.dataset.accessibilityHighContrast).toBe('true');
    expect(document.documentElement.dataset.accessibilityAlwaysShowFocus).toBe('true');
    expect(document.documentElement.dataset.accessibilityScreenReaderAnnouncements).toBe('true');
    expect(document.documentElement.dataset.accessibilityScale).toBe('130');
    expect(document.documentElement.style.getPropertyValue('--echo-accessibility-ui-scale')).toBe('1.3');
  });

  it('falls back to 100% for unsupported scale values', () => {
    expect(normalizeAccessibilityPreferences({
      uiScalePercent: 999 as 100,
    }).uiScalePercent).toBe(100);
  });
});
