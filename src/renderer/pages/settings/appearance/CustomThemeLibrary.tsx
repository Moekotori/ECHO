import { Check, FileText, History, Palette, Trash2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { AppThemeCustomTheme } from '../../../../shared/types/appSettings';
import type { TranslationKey } from '../../../i18n/locales';
import {
  themePresetOptions,
  type PluginThemeOption,
  type ThemeTone,
} from './themeSettingsModel';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type CustomThemeLibraryProps = {
  activeTheme: AppThemeCustomTheme | null;
  fallbackPresetLabelKey: TranslationKey;
  onCopyTone: (source: ThemeTone, target: ThemeTone) => void;
  onCreate: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onPluginApply: (theme: PluginThemeOption) => void;
  onRename: () => void;
  onSelect: (theme: AppThemeCustomTheme) => void;
  pluginThemes: PluginThemeOption[];
  savedThemeId: string | null;
  savedThemes: AppThemeCustomTheme[];
  t: Translate;
};

export const CustomThemeLibrary = ({
  activeTheme,
  fallbackPresetLabelKey,
  onCopyTone,
  onCreate,
  onDelete,
  onDuplicate,
  onPluginApply,
  onRename,
  onSelect,
  pluginThemes,
  savedThemeId,
  savedThemes,
  t,
}: CustomThemeLibraryProps): JSX.Element => (
  <div className="settings-theme-custom-section settings-theme-custom-library">
    <div className="settings-theme-custom-section-title">
      <strong>{t('settings.appearance.themeCustom.myThemes.title')}</strong>
      <span>{t('settings.appearance.themeCustom.myThemes.description')}</span>
    </div>
    <div className="settings-theme-custom-library-actions">
      <button className="settings-action-button" type="button" onClick={onCreate}>
        <Palette size={15} />
        {t('settings.appearance.themeCustom.action.create')}
      </button>
      <button
        className="settings-action-button"
        type="button"
        onClick={onRename}
        disabled={!activeTheme}
      >
        <FileText size={15} />
        {t('settings.appearance.themeCustom.action.rename')}
      </button>
      <button
        className="settings-action-button"
        type="button"
        onClick={onDuplicate}
        disabled={!activeTheme}
      >
        <History size={15} />
        {t('settings.appearance.themeCustom.action.duplicate')}
      </button>
      <button
        className="settings-danger-button"
        type="button"
        onClick={onDelete}
        disabled={!activeTheme}
      >
        <Trash2 size={15} />
        {t('settings.appearance.themeCustom.action.delete')}
      </button>
    </div>
    <div className="settings-theme-custom-theme-list">
      {savedThemes.length > 0 ? (
        savedThemes.map((theme) => (
          <button
            className={`settings-theme-custom-theme-card${theme.id === savedThemeId ? ' active' : ''}`}
            key={theme.id}
            type="button"
            onClick={() => onSelect(theme)}
          >
            <span>
              <strong>{theme.name}</strong>
              <em>
                {t(
                  themePresetOptions.find(
                    (option) => option.preset === theme.basePreset,
                  )?.labelKey ?? fallbackPresetLabelKey,
                )}
              </em>
            </span>
            {theme.id === savedThemeId ? <Check size={15} /> : null}
          </button>
        ))
      ) : (
        <p className="settings-theme-custom-empty">
          {t('settings.appearance.themeCustom.myThemes.empty')}
        </p>
      )}
    </div>
    {pluginThemes.length > 0 ? (
      <div className="settings-theme-plugin-presets">
        <div className="settings-theme-custom-section-title">
          <strong>插件主题</strong>
          <span>已启用插件贡献的主题会导入到“我的主题”，之后仍可继续微调。</span>
        </div>
        <div className="settings-theme-custom-theme-list">
          {pluginThemes.map((theme) => {
            const installed = savedThemes.some(
              (item) => item.id === theme.customThemeId,
            );
            const active = savedThemeId === theme.customThemeId;
            const preview =
              theme.preview ??
              `linear-gradient(135deg, ${theme.swatches?.[0] ?? '#f6f6f7'} 0%, ${theme.swatches?.[1] ?? '#4b55e8'} 52%, ${theme.swatches?.[2] ?? '#727987'} 100%)`;

            return (
              <button
                className={`settings-theme-custom-theme-card settings-theme-plugin-card${active ? ' active' : ''}`}
                key={`${theme.pluginId}:${theme.id}`}
                type="button"
                onClick={() => onPluginApply(theme)}
              >
                <span>
                  <strong>{theme.title}</strong>
                  <em>
                    {theme.pluginName} v{theme.pluginVersion} ·{' '}
                    {installed ? '更新并应用' : '导入并应用'}
                  </em>
                </span>
                <span
                  className="settings-theme-plugin-preview"
                  aria-hidden="true"
                  style={{ background: preview } as CSSProperties}
                >
                  {(theme.swatches ?? []).slice(0, 4).map((swatch) => (
                    <i
                      key={swatch}
                      style={{ background: swatch } as CSSProperties}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    ) : null}
    <div className="settings-theme-custom-copy-actions">
      <button
        className="settings-action-button"
        type="button"
        onClick={() => onCopyTone('light', 'dark')}
      >
        {t('settings.appearance.themeCustom.action.copyLightToDark')}
      </button>
      <button
        className="settings-action-button"
        type="button"
        onClick={() => onCopyTone('dark', 'light')}
      >
        {t('settings.appearance.themeCustom.action.copyDarkToLight')}
      </button>
    </div>
  </div>
);
