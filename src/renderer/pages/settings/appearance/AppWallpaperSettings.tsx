import { ChevronDown, FolderOpen, Trash2 } from 'lucide-react';
import type { AppSettings } from '../../../../shared/types/appSettings';
import type { TranslationKey } from '../../../i18n/locales';
import {
  ChipButton,
  NumberRangeField,
  SettingRow,
  StatusText,
  ToggleButton,
} from '../components/SettingsPrimitives';
import {
  appVideoWallpaperPauseModeLabels,
  appVideoWallpaperPauseModes,
  appWallpaperDisplayName,
  appWallpaperEffectPresets,
  matchesAppWallpaperEffectPreset,
} from './wallpaperSettingsModel';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type AppWallpaperSettingsProps = {
  advancedOpen: boolean;
  highlighted: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  onChoose: () => void;
  onClear: () => void;
  onPatch: (patch: Partial<AppSettings>) => void;
  onPortraitChoose: () => void;
  onPortraitClear: () => void;
  settings: AppSettings | null;
  t: Translate;
};

export const AppWallpaperSettings = ({
  advancedOpen,
  highlighted,
  onAdvancedOpenChange,
  onChoose,
  onClear,
  onPatch,
  onPortraitChoose,
  onPortraitClear,
  settings,
  t,
}: AppWallpaperSettingsProps): JSX.Element => (
  <SettingRow
    className="setting-row--full setting-row--compact-panel"
    id="settings-row-wallpaper"
    highlighted={highlighted}
    title={t('settings.appearance.wallpaper.title')}
    description={t('settings.appearance.wallpaper.description')}
  >
    {settings ? (
      <div className="settings-cache-panel settings-cache-panel--app-wallpaper">
        {settings.appCustomWallpaperPath || settings.appPortraitWallpaperPath ? (
          <>
            <div className="settings-wallpaper-primary">
              <p
                className="settings-wallpaper-path"
                title={settings.appCustomWallpaperPath ?? settings.appPortraitWallpaperPath ?? undefined}
              >
                <span>{t('settings.appearance.wallpaper.current')}</span>
                {appWallpaperDisplayName(settings.appCustomWallpaperPath ?? settings.appPortraitWallpaperPath ?? '')}
              </p>
              <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                <button className="settings-action-button" type="button" onClick={onChoose}>
                  <FolderOpen size={15} />
                  {t('settings.appearance.wallpaper.replace')}
                </button>
                <button className="settings-danger-button" type="button" onClick={onClear}>
                  <Trash2 size={15} />
                  {t('settings.appearance.wallpaper.clear')}
                </button>
              </div>
            </div>

            {settings.appearanceTheme === 'ambient' ? (
              <StatusText tone="muted">{t('settings.appearance.wallpaper.ambientPaused')}</StatusText>
            ) : settings.lowSpecModeEnabled &&
              (settings.appWallpaperMediaType === 'video' || settings.appPortraitWallpaperMediaType === 'video') ? (
              <StatusText tone="muted">{t('settings.appearance.wallpaper.lowSpecPaused')}</StatusText>
            ) : null}

            <div className="settings-wallpaper-effect-row">
              <span>{t('settings.appearance.wallpaper.effect.title')}</span>
              <div className="settings-chip-row settings-chip-row--left">
                {appWallpaperEffectPresets.map((preset) => (
                  <ChipButton
                    active={matchesAppWallpaperEffectPreset(settings, preset.patch)}
                    key={preset.id}
                    onClick={() => onPatch(preset.patch)}
                  >
                    {t(preset.labelKey)}
                  </ChipButton>
                ))}
              </div>
            </div>

            {settings.appWallpaperMediaType === 'video' || settings.appPortraitWallpaperMediaType === 'video' ? (
              <div className="settings-wallpaper-effect-row">
                <StatusText tone="good">{t('settings.appearance.wallpaper.videoStatus')}</StatusText>
                <div className="settings-chip-row settings-chip-row--left">
                  {appVideoWallpaperPauseModes.map((mode) => (
                    <ChipButton
                      active={(settings.appVideoWallpaperPauseMode ?? 'smart') === mode}
                      key={mode}
                      onClick={() => onPatch({ appVideoWallpaperPauseMode: mode })}
                    >
                      {t(appVideoWallpaperPauseModeLabels[mode])}
                    </ChipButton>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              aria-expanded={advancedOpen}
              className="settings-theme-custom-advanced-toggle settings-wallpaper-advanced-toggle"
              type="button"
              onClick={() => onAdvancedOpenChange(!advancedOpen)}
            >
              <ChevronDown size={15} />
              {advancedOpen
                ? t('settings.appearance.wallpaper.advanced.collapse')
                : t('settings.appearance.wallpaper.advanced.expand')}
            </button>
            <div className="settings-expandable-content settings-wallpaper-advanced" hidden={!advancedOpen}>
              <div className="settings-wallpaper-portrait">
                <div>
                  <strong>{t('settings.appearance.wallpaper.portraitOptional')}</strong>
                  <span>
                    {settings.appPortraitWallpaperPath
                      ? appWallpaperDisplayName(settings.appPortraitWallpaperPath)
                      : t('settings.appearance.wallpaper.portraitFallback')}
                  </span>
                </div>
                <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                  <button className="settings-action-button" type="button" onClick={onPortraitChoose}>
                    <FolderOpen size={15} />
                    {settings.appPortraitWallpaperPath
                      ? t('settings.appearance.wallpaper.portraitReplace')
                      : t('settings.appearance.wallpaper.portraitChoose')}
                  </button>
                  {settings.appPortraitWallpaperPath ? (
                    <button className="settings-danger-button" type="button" onClick={onPortraitClear}>
                      <Trash2 size={15} />
                      {t('settings.appearance.wallpaper.portraitClear')}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="settings-wallpaper-controls">
                <div className="settings-wallpaper-control">
                  <span>{t('settings.appearance.wallpaper.scale')}</span>
                  <NumberRangeField
                    min={100}
                    max={220}
                    step={1}
                    suffix="%"
                    value={settings.appWallpaperScalePercent ?? 100}
                    onChange={(appWallpaperScalePercent) => onPatch({ appWallpaperScalePercent })}
                  />
                </div>
                <div className="settings-wallpaper-control">
                  <span>{t('settings.appearance.wallpaper.blur')}</span>
                  <NumberRangeField
                    min={0}
                    max={40}
                    step={1}
                    suffix="px"
                    value={settings.appWallpaperBlurPx ?? 0}
                    onChange={(appWallpaperBlurPx) => onPatch({ appWallpaperBlurPx })}
                  />
                </div>
                <div className="settings-wallpaper-control">
                  <span>{t('settings.appearance.wallpaper.brightness')}</span>
                  <NumberRangeField
                    min={40}
                    max={140}
                    step={1}
                    suffix="%"
                    value={settings.appWallpaperBrightnessPercent ?? 100}
                    onChange={(appWallpaperBrightnessPercent) => onPatch({ appWallpaperBrightnessPercent })}
                  />
                </div>
                <div className="settings-wallpaper-control">
                  <span>{t('settings.appearance.wallpaper.uiOpacity')}</span>
                  <NumberRangeField
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    value={settings.appWallpaperUiOpacityPercent ?? 100}
                    onChange={(appWallpaperUiOpacityPercent) => onPatch({ appWallpaperUiOpacityPercent })}
                  />
                </div>
                <div className="settings-wallpaper-control settings-wallpaper-control--toggle">
                  <span>{t('settings.appearance.wallpaper.visualProtection')}</span>
                  <ToggleButton
                    active={settings.appWallpaperVisualProtectionEnabled !== false}
                    onClick={() =>
                      onPatch({
                        appWallpaperVisualProtectionEnabled: !(settings.appWallpaperVisualProtectionEnabled !== false),
                      })
                    }
                  />
                </div>
                <div className="settings-wallpaper-control settings-wallpaper-control--toggle">
                  <span>{t('settings.appearance.wallpaper.unifiedOpacity')}</span>
                  <ToggleButton
                    active={settings.appWallpaperUnifiedOpacityEnabled ?? false}
                    onClick={() =>
                      onPatch({
                        appWallpaperUnifiedOpacityEnabled: !(settings.appWallpaperUnifiedOpacityEnabled ?? false),
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="settings-wallpaper-empty">
            <div>
              <strong>{t('settings.appearance.wallpaper.emptyTitle')}</strong>
              <span>{t('settings.appearance.wallpaper.emptyDescription')}</span>
            </div>
            <button className="settings-action-button" type="button" onClick={onChoose}>
              <FolderOpen size={15} />
              {t('settings.appearance.wallpaper.choose')}
            </button>
          </div>
        )}
      </div>
    ) : null}
  </SettingRow>
);
