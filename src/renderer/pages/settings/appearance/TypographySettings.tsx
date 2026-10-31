import { ChevronDown } from 'lucide-react';
import type { TranslationKey } from '../../../i18n/locales';
import type { AppearancePreferences } from '../../../preferences/appearancePreferences';
import {
  ChipButton,
  NumberRangeField,
  SettingRow,
} from '../components/SettingsPrimitives';
import type { FontPickerTarget } from './fontSettingsModel';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type TypographySettingsProps = {
  highlightedAlbumCoverShape: boolean;
  onChange: (preferences: AppearancePreferences) => void;
  onFontPickerOpen: (target: FontPickerTarget) => void;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
  open: boolean;
  preferences: AppearancePreferences;
  t: Translate;
};

export const TypographySettings = ({
  highlightedAlbumCoverShape,
  onChange,
  onFontPickerOpen,
  onOpenChange,
  onReset,
  open,
  preferences,
  t,
}: TypographySettingsProps): JSX.Element => (
  <>
    <button
      aria-expanded={open}
      className="settings-theme-custom-advanced-toggle"
      type="button"
      onClick={() => onOpenChange(!open)}
    >
      <ChevronDown size={15} />
      {open
        ? t('settings.appearance.typography.collapse')
        : t('settings.appearance.typography.expand')}
    </button>
    <div
      className="settings-expandable-content settings-expandable-content--typography"
      hidden={!open}
    >
      <SettingRow
        title={t('settings.appearance.font.main.title')}
        description={t('settings.appearance.font.main.description')}
      >
        <button
          className="settings-font-picker-button"
          type="button"
          onClick={() => onFontPickerOpen('main')}
        >
          <span
            style={{
              fontFamily: `"${preferences.mainFontFamily}", var(--echo-font-family)`,
            }}
          >
            {preferences.mainFontFamily}
          </span>
          <em>{t('settings.appearance.font.choose')}</em>
        </button>
      </SettingRow>
      <SettingRow
        title={t('settings.appearance.font.chinese.title')}
        description={t('settings.appearance.font.chinese.description')}
      >
        <button
          className="settings-font-picker-button"
          type="button"
          onClick={() => onFontPickerOpen('chinese')}
        >
          <span
            style={{
              fontFamily: `"${preferences.chineseFontFamily}", var(--echo-font-family)`,
            }}
          >
            {preferences.chineseFontFamily}
          </span>
          <em>{t('settings.appearance.font.choose')}</em>
        </button>
      </SettingRow>
      <SettingRow
        title={t('settings.appearance.font.fallback.title')}
        description={t('settings.appearance.font.fallback.description')}
      >
        <button
          className="settings-font-picker-button"
          type="button"
          onClick={() => onFontPickerOpen('fallback')}
        >
          <span
            style={{
              fontFamily: `"${preferences.fallbackFontFamily}", var(--echo-font-family)`,
            }}
          >
            {preferences.fallbackFontFamily}
          </span>
          <em>{t('settings.appearance.font.choose')}</em>
        </button>
      </SettingRow>
      <SettingRow
        title={t('settings.appearance.fontSize.title')}
        description={t('settings.appearance.fontSize.description')}
      >
        <NumberRangeField
          min={12}
          max={18}
          step={1}
          suffix="px"
          value={preferences.baseFontSize}
          onChange={(baseFontSize) => onChange({ ...preferences, baseFontSize })}
        />
      </SettingRow>
      <SettingRow
        title={t('settings.appearance.lineHeight.title')}
        description={t('settings.appearance.lineHeight.description')}
      >
        <NumberRangeField
          min={1.1}
          max={1.8}
          step={0.05}
          suffix=""
          value={preferences.lineHeight}
          onChange={(lineHeight) => onChange({ ...preferences, lineHeight })}
        />
      </SettingRow>
      <SettingRow
        title={t('settings.appearance.textDepth.title')}
        description={t('settings.appearance.textDepth.description')}
      >
        <NumberRangeField
          min={35}
          max={100}
          step={1}
          suffix="%"
          value={preferences.textDepth}
          onChange={(textDepth) => onChange({ ...preferences, textDepth })}
        />
      </SettingRow>
    </div>
    <SettingRow
      id="settings-row-album-cover-shape"
      highlighted={highlightedAlbumCoverShape}
      title={t('settings.appearance.albumCoverShape.title')}
      description={t('settings.appearance.albumCoverShape.description')}
    >
      <div className="settings-chip-row settings-chip-row--left">
        <ChipButton
          active={preferences.albumCoverShape !== 'square'}
          onClick={() => onChange({ ...preferences, albumCoverShape: 'rounded' })}
        >
          {t('settings.appearance.albumCoverShape.rounded')}
        </ChipButton>
        <ChipButton
          active={preferences.albumCoverShape === 'square'}
          onClick={() => onChange({ ...preferences, albumCoverShape: 'square' })}
        >
          {t('settings.appearance.albumCoverShape.square')}
        </ChipButton>
      </div>
    </SettingRow>
    <SettingRow
      title={t('settings.appearance.reset.title')}
      description={t('settings.appearance.reset.description')}
    >
      <button className="settings-action-button" type="button" onClick={onReset}>
        {t('settings.appearance.reset.action')}
      </button>
    </SettingRow>
  </>
);
