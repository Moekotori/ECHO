import type { CSSProperties } from 'react';
import { CheckCircle2, Image as ImageIcon, Loader2, Trash2 } from 'lucide-react';
import type { AppThemeMode, AppThemePreset, AppThemePresetOverrides, LyricsPageStyle } from '../../../shared/types/appSettings';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { appWallpaperDisplayName, appWallpaperEffectPresets } from '../../pages/settings/appearance/wallpaperSettingsModel';
import type { AppWallpaperEffectPresetId } from '../../pages/settings/appearance/wallpaperSettingsModel';
import { StyledSelect } from '../ui/StyledSelect';
import { firstRunThemeModes, firstRunThemePresets } from './firstRunAppearanceModel';
import { FirstRunAppearancePreview } from './FirstRunAppearancePreview';
import { FirstRunLyricsStylePicker } from './FirstRunLyricsStylePicker';

type Props = {
  theme: AppThemeMode;
  preset: AppThemePreset;
  presetOverrides?: AppThemePresetOverrides;
  onThemeChange: (value: AppThemeMode) => void;
  onPresetChange: (value: AppThemePreset) => void;
  lyricsStyle: LyricsPageStyle;
  onLyricsStyleChange: (value: LyricsPageStyle) => void;
  wallpaperPath: string | null;
  wallpaperPreviewUrl: string | null;
  wallpaperMediaType: 'image' | 'video';
  wallpaperMediaStyle: CSSProperties;
  wallpaperUiAlpha: number;
  effectId: AppWallpaperEffectPresetId;
  onEffectChange: (value: AppWallpaperEffectPresetId) => void;
  onChooseWallpaper: () => void;
  onClearWallpaper: () => void;
  busy: string | null;
};

/** Controlled appearance choices; persistence stays with the wizard. */
export const FirstRunAppearanceStep = ({ theme, preset, presetOverrides, onThemeChange, onPresetChange,
  lyricsStyle, onLyricsStyleChange,
  wallpaperPath, wallpaperPreviewUrl, wallpaperMediaType, wallpaperMediaStyle, wallpaperUiAlpha,
  effectId, onEffectChange, onChooseWallpaper, onClearWallpaper, busy }: Props): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const ambient = theme === 'ambient';
  const selectedPreset = firstRunThemePresets.find((item) => item.preset === (ambient ? 'classic' : preset)) ?? firstRunThemePresets[0]!;
  const presetLabel = ambient ? t('settings.appearance.theme.ambient') : t(selectedPreset.labelKey);
  const effectLabel = t((appWallpaperEffectPresets.find((item) => item.id === effectId) ?? appWallpaperEffectPresets[0]!).labelKey);

  return (
    <div className="first-run-appearance-panel">
      <FirstRunAppearancePreview
        theme={theme} preset={preset} overrides={presetOverrides}
        label={`${t(firstRunThemeModes.find((item) => item.mode === theme)!.labelKey)} · ${presetLabel}`}
        wallpaperUrl={wallpaperPreviewUrl} mediaType={wallpaperMediaType}
        mediaStyle={wallpaperMediaStyle} uiAlpha={wallpaperUiAlpha}
      />
      <section className="first-run-appearance-section">
        <header>
          <div>
            <span>{t('firstRun.theme.modeTitle')}</span>
            <strong>{t(firstRunThemeModes.find((item) => item.mode === theme)!.labelKey)}</strong>
          </div>
        </header>
        <div className="first-run-appearance-mode-grid">
          {firstRunThemeModes.map((item) => (
            <button
              className={theme === item.mode ? 'is-active' : undefined}
              key={item.mode}
              type="button"
              aria-pressed={theme === item.mode}
              onClick={() => onThemeChange(item.mode)}
            >
              <span>
                <strong>{t(item.labelKey)}</strong>
                <small>{t(item.hintKey)}</small>
              </span>
              {theme === item.mode ? <CheckCircle2 size={17} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </section>
      <details className="first-run-appearance-section first-run-preset-disclosure">
        <summary>
          <div>
            <span>{t('firstRun.theme.presetTitle')}</span>
            <strong>{presetLabel}</strong>
          </div>
          {ambient ? <small>{t('settings.appearance.themePreset.ambientLocked')}</small> : null}
        </summary>
        <div className="first-run-appearance-preset-grid first-run-appearance-preset-grid--catalog">
          {firstRunThemePresets.map((item) => {
            const isActive = !ambient && preset === item.preset;
            return (
              <button
                className={isActive ? 'is-active' : undefined}
                disabled={ambient}
                key={item.preset}
                type="button"
                aria-disabled={ambient}
                aria-pressed={isActive}
                title={ambient ? t('settings.appearance.themePreset.ambientLocked') : t(item.descriptionKey)}
                onClick={() => onPresetChange(item.preset)}
              >
                <span className="first-run-theme-swatch" data-preset={item.preset} style={{ background: item.preview }} aria-hidden="true" />
                <span className="first-run-appearance-preset-copy">
                  <strong>{t(item.labelKey)}</strong>
                  <span className="first-run-theme-dots" aria-hidden="true">
                    {item.swatches.slice(0, 4).map((swatch) => (
                      <i key={swatch} style={{ background: swatch }} />
                    ))}
                  </span>
                </span>
                {isActive ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </details>
      <FirstRunLyricsStylePicker value={lyricsStyle} onChange={onLyricsStyleChange} disabled={busy !== null} />
      <section className="first-run-appearance-section first-run-wallpaper-section">
        <header>
          <div>
            <span>{t('firstRun.wallpaper.title')}</span>
            <strong>{wallpaperPath ? appWallpaperDisplayName(wallpaperPath) : t('firstRun.summary.backgroundDefault')}</strong>
          </div>
          {wallpaperPath ? <small>{effectLabel}</small> : null}
        </header>
        <div>
          <div className="first-run-wallpaper-controls">
            <div className="settings-chip-row settings-chip-row--left">
              <button className="settings-action-button" type="button" disabled={busy !== null} onClick={onChooseWallpaper}>
                {busy === 'wallpaper' ? <Loader2 className="spinning-icon" size={15} /> : <ImageIcon size={15} />}
                {wallpaperPath ? t('settings.appearance.wallpaper.replace') : t('settings.appearance.wallpaper.choose')}
              </button>
              {wallpaperPath ? (
                <button className="settings-action-button" type="button" disabled={busy !== null} onClick={onClearWallpaper}>
                  <Trash2 size={15} />
                  {t('firstRun.wallpaper.clear')}
                </button>
              ) : null}
            </div>
            {wallpaperPath ? (
              <StyledSelect<AppWallpaperEffectPresetId>
                className="first-run-scan-select"
                value={effectId}
                options={appWallpaperEffectPresets.map((preset) => ({
                  value: preset.id,
                  label: t(preset.labelKey),
                }))}
                onChange={(value) => onEffectChange(value)}
                ariaLabel={t('settings.appearance.wallpaper.effect.title')}
                triggerAriaLabel={`${t('settings.appearance.wallpaper.effect.title')}: ${effectLabel}`}
                showFilterIcon={false}
              />
            ) : null}
            <p className="first-run-basics-hint">{t('firstRun.wallpaper.hint')}</p>
          </div>
        </div>
      </section>
    </div>
  );
};
