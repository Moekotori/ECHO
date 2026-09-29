import type {
  AppSettings,
  AppThemeMode,
} from '../../../../shared/types/appSettings';
import type { TranslationKey } from '../../../i18n/locales';
import { normalizeThemeScheduleTime } from '../../../preferences/themePreferences';
import {
  ChipButton,
  SettingRow,
  SettingSubsectionTitle,
  type SettingSubsectionTitleProps,
} from '../components/SettingsPrimitives';
import {
  defaultThemeScheduleDarkAt,
  defaultThemeScheduleLightAt,
  themeModeOptions,
} from './themeSettingsModel';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type ThemeModeSettingsProps = {
  currentMode: AppThemeMode;
  darkAt: string;
  getSubsection: (key: 'appearanceTheme') => SettingSubsectionTitleProps;
  highlighted: boolean;
  lightAt: string;
  onModeChange: (mode: AppThemeMode) => void;
  onScheduleChange: (patch: Partial<AppSettings>) => void;
  scheduleEnabled: boolean;
  scheduleStatus: string;
  t: Translate;
};

export const ThemeModeSettings = ({
  currentMode,
  darkAt,
  getSubsection,
  highlighted,
  lightAt,
  onModeChange,
  onScheduleChange,
  scheduleEnabled,
  scheduleStatus,
  t,
}: ThemeModeSettingsProps): JSX.Element => (
  <>
    <SettingSubsectionTitle {...getSubsection('appearanceTheme')} />
    <SettingRow
      id="settings-row-theme"
      highlighted={highlighted}
      title={t('settings.appearance.theme.title')}
      description={t('settings.appearance.theme.description')}
    >
      <div className="settings-chip-row">
        {themeModeOptions.map((option) => (
          <ChipButton
            active={currentMode === option.mode}
            key={option.mode}
            onClick={() => onModeChange(option.mode)}
          >
            {t(option.labelKey)}
          </ChipButton>
        ))}
      </div>
    </SettingRow>
    <SettingRow
      title={t('settings.appearance.themeSchedule.title')}
      description={t('settings.appearance.themeSchedule.description')}
    >
      <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions settings-theme-schedule">
        <div className="settings-inline-toggle">
          <span>{t('settings.appearance.themeSchedule.toggle')}</span>
          <button
            aria-label={t('settings.appearance.themeSchedule.toggleAria')}
            aria-pressed={scheduleEnabled}
            className={`toggle-btn ${scheduleEnabled ? 'active' : ''}`}
            type="button"
            onClick={() =>
              onScheduleChange({ appearanceThemeScheduleEnabled: !scheduleEnabled })
            }
          >
            <span />
          </button>
        </div>
        <label className="settings-time-field">
          <span>{t('settings.appearance.themeSchedule.darkAt')}</span>
          <input
            type="time"
            value={darkAt}
            disabled={!scheduleEnabled}
            onChange={(event) =>
              onScheduleChange({
                appearanceThemeScheduleDarkAt: normalizeThemeScheduleTime(
                  event.currentTarget.value,
                  defaultThemeScheduleDarkAt,
                ),
              })
            }
          />
        </label>
        <label className="settings-time-field">
          <span>{t('settings.appearance.themeSchedule.lightAt')}</span>
          <input
            type="time"
            value={lightAt}
            disabled={!scheduleEnabled}
            onChange={(event) =>
              onScheduleChange({
                appearanceThemeScheduleLightAt: normalizeThemeScheduleTime(
                  event.currentTarget.value,
                  defaultThemeScheduleLightAt,
                ),
              })
            }
          />
        </label>
        <p className="settings-inline-note">{scheduleStatus}</p>
      </div>
    </SettingRow>
  </>
);
