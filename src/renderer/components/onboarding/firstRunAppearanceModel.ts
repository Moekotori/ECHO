import type { AppThemeMode } from '../../../shared/types/appSettings';
import type { TranslationKey } from '../../i18n/locales';
import { isProOnlyThemePreset, themePresetOptions } from '../../pages/settings/appearance/themeSettingsModel';

export const firstRunThemeModes: Array<{ mode: AppThemeMode; labelKey: TranslationKey; descriptionKey: TranslationKey; hintKey: TranslationKey }> = [
  { mode: 'light', labelKey: 'settings.appearance.theme.light', descriptionKey: 'firstRun.theme.light.description', hintKey: 'firstRun.theme.light.hint' },
  { mode: 'dark', labelKey: 'settings.appearance.theme.dark', descriptionKey: 'firstRun.theme.dark.description', hintKey: 'firstRun.theme.dark.hint' },
  { mode: 'system', labelKey: 'settings.appearance.theme.followSystem', descriptionKey: 'firstRun.theme.system.description', hintKey: 'firstRun.theme.system.hint' },
  { mode: 'ambient', labelKey: 'settings.appearance.theme.ambient', descriptionKey: 'firstRun.theme.ambient.description', hintKey: 'firstRun.theme.ambient.hint' },
];

/* The full built-in preset catalog from the settings page, minus Pro-only entries
   (ECHO Pro stays out of the first-run flow). */
export const firstRunThemePresets = themePresetOptions.filter((option) => !isProOnlyThemePreset(option.preset));

