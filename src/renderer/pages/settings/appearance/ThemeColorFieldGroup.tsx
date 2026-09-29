import type { CSSProperties } from 'react';
import type { TranslationKey } from '../../../i18n/locales';
import type {
  ThemeColorField,
  ThemeEditorDefaults,
} from './themeSettingsModel';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type ThemeColorFieldOption = {
  descriptionKey: TranslationKey;
  field: ThemeColorField;
  labelKey: TranslationKey;
};

type ThemeColorFieldGroupProps = {
  compact?: boolean;
  descriptionKey: TranslationKey;
  fields: ThemeColorFieldOption[];
  gradientPreview?: string;
  hidden?: boolean;
  onChange: (field: ThemeColorField, value: string) => void;
  showAdvancedGrid?: boolean;
  t: Translate;
  titleKey: TranslationKey;
  values: ThemeEditorDefaults;
};

export const ThemeColorFieldGroup = ({
  compact = false,
  descriptionKey,
  fields,
  gradientPreview,
  hidden = false,
  onChange,
  showAdvancedGrid = false,
  t,
  titleKey,
  values,
}: ThemeColorFieldGroupProps): JSX.Element => {
  const controls = fields.map((option) => (
    <label
      className={`settings-theme-custom-color-card${compact ? ' settings-theme-custom-color-card--compact' : ''}`}
      key={option.field}
    >
      <span className="settings-theme-custom-color-copy">
        <strong>{t(option.labelKey)}</strong>
        <em>{t(option.descriptionKey)}</em>
      </span>
      <span className="settings-theme-custom-color-control">
        <code>{values[option.field].toUpperCase()}</code>
        <input
          aria-label={t(option.labelKey)}
          type="color"
          value={values[option.field]}
          onChange={(event) => onChange(option.field, event.currentTarget.value)}
        />
      </span>
    </label>
  ));

  return (
    <div
      className={`settings-theme-custom-section${gradientPreview ? ' settings-theme-custom-section--gradient' : ''}`}
      hidden={hidden}
    >
      <div className="settings-theme-custom-section-title">
        <strong>{t(titleKey)}</strong>
        <span>{t(descriptionKey)}</span>
      </div>
      {gradientPreview ? (
        <div
          className="settings-theme-custom-gradient-card"
          style={{ background: gradientPreview } as CSSProperties}
        >
          {controls}
        </div>
      ) : (
        <div
          className={`settings-theme-custom-card-grid${showAdvancedGrid ? ' settings-theme-custom-card-grid--advanced' : ''}`}
        >
          {controls}
        </div>
      )}
    </div>
  );
};
