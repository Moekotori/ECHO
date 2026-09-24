import {
  ChevronDown,
  Download,
  FolderOpen,
  Palette,
  RotateCw,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import type { AppThemeCustomTheme } from '../../../../shared/types/appSettings';
import type { TranslationKey } from '../../../i18n/locales';
import { ChipButton, SettingRow, ToggleButton } from '../components/SettingsPrimitives';
import { CustomThemeLibrary } from './CustomThemeLibrary';
import { ThemeColorFieldGroup } from './ThemeColorFieldGroup';
import {
  advancedThemeColorFields,
  coreThemeColorFields,
  gradientThemeColorFields,
  numberThemeFields,
  stateThemeColorFields,
  surfaceThemeColorFields,
  type PluginThemeOption,
  type ThemeColorField,
  type ThemeEditorDefaults,
  type ThemeNumberField,
  type ThemeTone,
} from './themeSettingsModel';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type ThemeCustomEditorProps = {
  activeTheme?: AppThemeCustomTheme;
  advancedOpen: boolean;
  ambientActive: boolean;
  ambientLockMessage: string;
  message: string | null;
  onAdvancedOpenChange: (open: boolean) => void;
  onAutoFix: () => void;
  onColorChange: (field: ThemeColorField, value: string) => void;
  onCopyTone: (fromTone: ThemeTone, toTone: ThemeTone) => void;
  onCreate: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onImport: () => void;
  onMotionEnabledChange: (enabled: boolean) => void;
  onNumberChange: (field: ThemeNumberField, value: number) => void;
  onPanelOpenChange: (open: boolean) => void;
  onPluginApply: (theme: PluginThemeOption) => void;
  onRename: () => void;
  onReset: () => void;
  onSave: () => void;
  onSelect: (theme: AppThemeCustomTheme) => void;
  onToneChange: (tone: ThemeTone) => void;
  panelOpen: boolean;
  pluginThemes: PluginThemeOption[];
  presetLabelKey: TranslationKey;
  savedThemeId: string | null;
  savedThemes: AppThemeCustomTheme[];
  t: Translate;
  tone: ThemeTone;
  values: ThemeEditorDefaults;
  warningCount: number;
};

export const ThemeCustomEditor = ({
  activeTheme,
  advancedOpen,
  ambientActive,
  ambientLockMessage,
  message,
  onAdvancedOpenChange,
  onAutoFix,
  onColorChange,
  onCopyTone,
  onCreate,
  onDelete,
  onDuplicate,
  onExport,
  onImport,
  onMotionEnabledChange,
  onNumberChange,
  onPanelOpenChange,
  onPluginApply,
  onRename,
  onReset,
  onSave,
  onSelect,
  onToneChange,
  panelOpen,
  pluginThemes,
  presetLabelKey,
  savedThemeId,
  savedThemes,
  t,
  tone,
  values,
  warningCount,
}: ThemeCustomEditorProps): JSX.Element => {
  const gradientPreview = `linear-gradient(135deg, ${values.appBg} 0%, ${values.appBg2} 52%, ${values.appBg3} 100%)`;

  return (
    <SettingRow
      className="setting-row--full setting-row--theme-custom"
      title={t('settings.appearance.themeCustom.title')}
      description={t('settings.appearance.themeCustom.description')}
    >
      <div className="settings-theme-custom-panel">
        <div className="settings-theme-custom-header">
          <div className="settings-theme-custom-heading">
            <span>{t('settings.appearance.themeCustom.preview.title')}</span>
            <strong>
              {ambientActive
                ? t('settings.appearance.theme.ambient')
                : activeTheme?.name ?? t(presetLabelKey)}
            </strong>
            <em>
              {ambientActive
                ? ambientLockMessage
                : t('settings.appearance.themeCustom.preview.description')}
            </em>
          </div>
          <div className="settings-theme-custom-toolbar">
            <div className="settings-chip-row settings-chip-row--left">
              <ChipButton
                active={tone === 'light'}
                disabled={ambientActive}
                onClick={() => onToneChange('light')}
              >
                {t('settings.appearance.theme.light')}
              </ChipButton>
              <ChipButton
                active={tone === 'dark'}
                disabled={ambientActive}
                onClick={() => onToneChange('dark')}
              >
                {t('settings.appearance.theme.dark')}
              </ChipButton>
            </div>
            <div
              className="settings-theme-custom-preview"
              aria-hidden="true"
              style={{ background: gradientPreview }}
            >
              <span style={{ background: values.accent }} />
              <span style={{ background: values.accentStrong }} />
              <span style={{ background: values.secondary }} />
              <strong style={{ background: values.accent, color: values.onAccent }}>Aa</strong>
            </div>
          </div>
        </div>

        <button
          aria-expanded={panelOpen}
          aria-disabled={ambientActive}
          className="settings-theme-custom-advanced-toggle"
          disabled={ambientActive}
          title={ambientActive ? ambientLockMessage : undefined}
          type="button"
          onClick={() => onPanelOpenChange(!panelOpen)}
        >
          <ChevronDown size={15} />
          {panelOpen
            ? t('settings.appearance.themeCustom.collapse')
            : t('settings.appearance.themeCustom.expand')}
        </button>
        {ambientActive ? <p className="settings-inline-note">{ambientLockMessage}</p> : null}

        <div className="settings-expandable-content" hidden={!panelOpen || ambientActive}>
          <CustomThemeLibrary
            activeTheme={activeTheme ?? null}
            fallbackPresetLabelKey={presetLabelKey}
            onCopyTone={onCopyTone}
            onCreate={onCreate}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onPluginApply={onPluginApply}
            onRename={onRename}
            onSelect={onSelect}
            pluginThemes={pluginThemes}
            savedThemeId={savedThemeId}
            savedThemes={savedThemes}
            t={t}
          />

          <div className="settings-theme-custom-mock-preview" aria-hidden="true">
            <div className="settings-theme-custom-mock-titlebar" style={{ background: values.titlebar }} />
            <div className="settings-theme-custom-mock-body" style={{ background: values.panel }}>
              <aside style={{ background: values.sidebar }}>
                <span style={{ background: values.chip, color: values.text }}>曲库</span>
                <span style={{ background: values.rowActive, color: values.heading }}>外观</span>
                <span style={{ background: values.chip, color: values.muted }}>歌词</span>
              </aside>
              <main>
                <div
                  className="settings-theme-custom-mock-card"
                  style={{ background: values.field, color: values.text }}
                >
                  <strong style={{ color: values.heading }}>Aa 主题预览</strong>
                  <em style={{ color: values.muted }}>标题、正文和弱化文字</em>
                </div>
                <div
                  className="settings-theme-custom-mock-row"
                  style={{ background: values.row, color: values.text }}
                >
                  <span>播放列表</span>
                  <strong style={{ color: values.accentStrong }}>128</strong>
                </div>
                <div
                  className="settings-theme-custom-mock-row"
                  style={{ background: values.rowHover, color: values.text }}
                >
                  <span>悬停状态</span>
                  <strong style={{ color: values.secondary }}>ON</strong>
                </div>
                <div
                  className="settings-theme-custom-mock-accent"
                  style={{ background: values.accent, color: values.onAccent }}
                >
                  主要按钮
                </div>
              </main>
            </div>
            <div className="settings-theme-custom-mock-player" style={{ background: values.player }}>
              <strong style={{ color: values.heading }}>Now Playing</strong>
              <span style={{ background: values.success }} />
              <span style={{ background: values.warning }} />
              <span style={{ background: values.danger }} />
            </div>
          </div>

          <ThemeColorFieldGroup
            descriptionKey="settings.appearance.themeCustom.group.core.description"
            fields={coreThemeColorFields}
            onChange={onColorChange}
            t={t}
            titleKey="settings.appearance.themeCustom.group.core"
            values={values}
          />

          <ThemeColorFieldGroup
            compact
            descriptionKey="settings.appearance.themeCustom.group.gradient.description"
            fields={gradientThemeColorFields}
            gradientPreview={gradientPreview}
            onChange={onColorChange}
            t={t}
            titleKey="settings.appearance.themeCustom.group.gradient"
            values={values}
          />

          <button
            className="settings-theme-custom-advanced-toggle"
            type="button"
            onClick={() => onAdvancedOpenChange(!advancedOpen)}
          >
            <SlidersHorizontal size={15} />
            {advancedOpen
              ? t('settings.appearance.themeCustom.advanced.hide')
              : t('settings.appearance.themeCustom.advanced.show')}
          </button>

          <ThemeColorFieldGroup
            descriptionKey="settings.appearance.themeCustom.group.surface.description"
            fields={surfaceThemeColorFields}
            hidden={!advancedOpen}
            onChange={onColorChange}
            t={t}
            titleKey="settings.appearance.themeCustom.group.surface"
            values={values}
          />

          <ThemeColorFieldGroup
            descriptionKey="settings.appearance.themeCustom.group.state.description"
            fields={stateThemeColorFields}
            hidden={!advancedOpen}
            onChange={onColorChange}
            showAdvancedGrid
            t={t}
            titleKey="settings.appearance.themeCustom.group.state"
            values={values}
          />

          <div className="settings-theme-custom-sliders" hidden={!advancedOpen}>
            {numberThemeFields
              .filter((option) =>
                option.field !== 'motionSpeedSeconds' &&
                option.field !== 'motionIntensityPercent')
              .map((option) => (
                <label className="settings-theme-custom-slider" key={option.field}>
                  <span>
                    <em>
                      <strong>{t(option.labelKey)}</strong>
                      {t(option.descriptionKey)}
                    </em>
                    <strong>
                      {values[option.field]}
                      {option.suffix}
                    </strong>
                  </span>
                  <input
                    aria-label={t(option.labelKey)}
                    min={option.min}
                    max={option.max}
                    step={option.step ?? 1}
                    type="range"
                    value={values[option.field]}
                    onChange={(event) =>
                      onNumberChange(option.field, Number(event.currentTarget.value))}
                  />
                </label>
              ))}
          </div>

          <div className="settings-theme-custom-section" hidden={!advancedOpen}>
            <div className="settings-theme-custom-section-title">
              <strong>{t('settings.appearance.themeCustom.group.motion')}</strong>
              <span>{t('settings.appearance.themeCustom.group.motion.description')}</span>
            </div>
            <div className="settings-theme-custom-motion-row">
              <span>
                <strong>{t('settings.appearance.themeCustom.field.motionEnabled')}</strong>
                <em>{t('settings.appearance.themeCustom.field.motionEnabled.description')}</em>
              </span>
              <ToggleButton
                active={values.motionEnabled}
                onClick={() => onMotionEnabledChange(!values.motionEnabled)}
              />
            </div>
            <div className="settings-theme-custom-sliders settings-theme-custom-sliders--motion">
              {numberThemeFields
                .filter((option) =>
                  option.field === 'motionSpeedSeconds' ||
                  option.field === 'motionIntensityPercent')
                .map((option) => (
                  <label className="settings-theme-custom-slider" key={option.field}>
                    <span>
                      <em>
                        <strong>{t(option.labelKey)}</strong>
                        {t(option.descriptionKey)}
                      </em>
                      <strong>
                        {values[option.field]}
                        {option.suffix}
                      </strong>
                    </span>
                    <input
                      aria-label={t(option.labelKey)}
                      min={option.min}
                      max={option.max}
                      step={option.step ?? 1}
                      type="range"
                      value={values[option.field]}
                      onChange={(event) =>
                        onNumberChange(option.field, Number(event.currentTarget.value))}
                    />
                  </label>
                ))}
            </div>
          </div>

          <ThemeColorFieldGroup
            descriptionKey="settings.appearance.themeCustom.group.advanced.description"
            fields={advancedThemeColorFields}
            hidden={!advancedOpen}
            onChange={onColorChange}
            showAdvancedGrid
            t={t}
            titleKey="settings.appearance.themeCustom.group.advanced"
            values={values}
          />

          {warningCount > 0 ? (
            <p className="settings-theme-custom-warning">
              {t('settings.appearance.themeCustom.message.lowContrast')}
            </p>
          ) : null}
          {message ? <p className="settings-theme-custom-message">{message}</p> : null}

          <div className="settings-theme-custom-actions">
            <button className="settings-action-button" type="button" onClick={onAutoFix}>
              <Palette size={15} />
              {t('settings.appearance.themeCustom.action.autoFix')}
            </button>
            <button className="settings-action-button" type="button" onClick={onSave}>
              <Save size={15} />
              {t('settings.appearance.themeCustom.action.save')}
            </button>
            <button className="settings-action-button" type="button" onClick={onExport}>
              <Download size={15} />
              {t('settings.appearance.themeCustom.action.export')}
            </button>
            <button className="settings-action-button" type="button" onClick={onImport}>
              <FolderOpen size={15} />
              {t('settings.appearance.themeCustom.action.import')}
            </button>
            <button className="settings-danger-button" type="button" onClick={onReset}>
              <RotateCw size={15} />
              {t('settings.appearance.themeCustom.action.reset')}
            </button>
          </div>
        </div>
      </div>
    </SettingRow>
  );
};
