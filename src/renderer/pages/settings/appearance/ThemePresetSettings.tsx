import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { AppThemePreset } from '../../../../shared/types/appSettings';
import type { TranslationKey } from '../../../i18n/locales';
import { SettingRow } from '../components/SettingsPrimitives';
import {
  isProOnlyThemePreset,
  randomThemePresetOption,
  themePresetOptions,
} from './themeSettingsModel';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type ThemePresetSettingsProps = {
  ambientActive: boolean;
  ambientLockMessage: string;
  echoProUnlocked: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onPresetChange: (preset: AppThemePreset) => void;
  onRandomCreate: () => void;
  selectedPreset: AppThemePreset;
  summaryLabel: string;
  summaryPreview: string;
  t: Translate;
};

export const ThemePresetSettings = ({
  ambientActive,
  ambientLockMessage,
  echoProUnlocked,
  expanded,
  onExpandedChange,
  onPresetChange,
  onRandomCreate,
  selectedPreset,
  summaryLabel,
  summaryPreview,
  t,
}: ThemePresetSettingsProps): JSX.Element => (
  <SettingRow
    className="setting-row--full setting-row--theme-presets"
    title={t('settings.appearance.themePreset.title')}
    description={t('settings.appearance.themePreset.description')}
  >
    <div className="settings-theme-preset-panel">
      <button
        aria-expanded={expanded}
        aria-disabled={ambientActive}
        className={`settings-theme-preset-summary${ambientActive ? ' locked' : ''}`}
        disabled={ambientActive}
        title={ambientActive ? ambientLockMessage : undefined}
        type="button"
        onClick={() => onExpandedChange(!expanded)}
      >
        <span
          aria-hidden="true"
          className="settings-theme-preset-summary-preview"
          style={{ background: summaryPreview } as CSSProperties}
        />
        <span>
          <strong>{summaryLabel}</strong>
          <em>
            {ambientActive
              ? ambientLockMessage
              : expanded
                ? '收起主题预设'
                : '展开主题预设'}
          </em>
        </span>
        <ChevronDown size={16} />
      </button>
      {ambientActive ? (
        <p className="settings-inline-note">{ambientLockMessage}</p>
      ) : null}
      {expanded ? (
        <div className="settings-theme-preset-grid settings-expandable-content">
          <button
            aria-disabled={ambientActive}
            aria-pressed="false"
            className={`settings-theme-preset-card${ambientActive ? ' locked' : ''}`}
            data-preset="random"
            disabled={ambientActive}
            onClick={onRandomCreate}
            title={
              ambientActive
                ? ambientLockMessage
                : t(randomThemePresetOption.descriptionKey)
            }
            type="button"
          >
            <span
              aria-hidden="true"
              className="settings-theme-preset-preview"
              style={{ background: randomThemePresetOption.preview } as CSSProperties}
            >
              <RefreshCw size={16} />
            </span>
            <span className="settings-theme-preset-copy">
              <strong>{t(randomThemePresetOption.labelKey)}</strong>
              <em>{t(randomThemePresetOption.descriptionKey)}</em>
            </span>
            <span aria-hidden="true" className="settings-theme-preset-swatches">
              {randomThemePresetOption.swatches.map((swatch) => (
                <span
                  key={swatch}
                  style={{ background: swatch } as CSSProperties}
                />
              ))}
            </span>
          </button>
          {themePresetOptions.map((option) => {
            const isActive = !ambientActive && selectedPreset === option.preset;
            const isProThemeLocked =
              isProOnlyThemePreset(option.preset) && !echoProUnlocked;
            const isThemeCardLocked = ambientActive || isProThemeLocked;

            return (
              <button
                aria-disabled={isThemeCardLocked}
                aria-pressed={isActive}
                className={`settings-theme-preset-card${isActive ? ' active' : ''}${isThemeCardLocked ? ' locked' : ''}`}
                data-preset={option.preset}
                disabled={isThemeCardLocked}
                key={option.preset}
                onClick={() => onPresetChange(option.preset)}
                title={
                  ambientActive
                    ? ambientLockMessage
                    : isProThemeLocked
                      ? 'Pro Only'
                      : t(option.descriptionKey)
                }
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="settings-theme-preset-preview"
                  style={{ background: option.preview } as CSSProperties}
                >
                  {isActive ? <Check size={16} /> : null}
                </span>
                <span className="settings-theme-preset-copy">
                  <strong>{t(option.labelKey)}</strong>
                  <em>{t(option.descriptionKey)}</em>
                  {isProThemeLocked ? <small>Pro Only</small> : null}
                </span>
                <span aria-hidden="true" className="settings-theme-preset-swatches">
                  {option.swatches.map((swatch) => (
                    <span
                      key={swatch}
                      style={{ background: swatch } as CSSProperties}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  </SettingRow>
);
