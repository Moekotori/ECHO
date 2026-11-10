import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Music2, Play, SkipBack, SkipForward } from 'lucide-react';
import type { AppThemeMode, AppThemePreset, AppThemePresetOverrides } from '../../../shared/types/appSettings';
import { mergeThemeToneValues } from '../../pages/settings/appearance/themeSettingsModel';
import '../../styles/first-run-appearance-preview.css';

type Props = {
  theme: AppThemeMode;
  preset: AppThemePreset;
  overrides?: AppThemePresetOverrides;
  label: string;
  wallpaperUrl: string | null;
  mediaType: 'image' | 'video';
  mediaStyle: CSSProperties;
  uiAlpha: number;
};

/** Local draft preview: selecting a theme must not persist settings before Finish. */
export const FirstRunAppearancePreview = ({ theme, preset, overrides, label, wallpaperUrl, mediaType, mediaStyle, uiAlpha }: Props): JSX.Element => {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    if (theme !== 'system' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setSystemDark(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [theme]);

  const tone = theme === 'dark' || theme === 'ambient' || (theme === 'system' && systemDark) ? 'dark' : 'light';
  const effectivePreset = theme === 'ambient' ? 'classic' : preset;
  const values = mergeThemeToneValues(effectivePreset, tone, overrides?.[effectivePreset]?.[tone] ?? {});
  const style = {
    '--fr-preview-bg': values.appBg,
    '--fr-preview-bg2': values.appBg2,
    '--fr-preview-bg3': values.appBg3,
    '--fr-preview-panel': values.panel,
    '--fr-preview-text': values.text,
    '--fr-preview-muted': values.muted,
    '--fr-preview-accent': values.accent,
    '--fr-preview-border': values.border,
    '--fr-preview-ui': `${(wallpaperUrl ? uiAlpha : 1) * 100}%`,
    colorScheme: tone,
  } as CSSProperties;

  return (
    <div className="first-run-appearance-preview" role="img" aria-label={label} style={style}>
      {wallpaperUrl ? mediaType === 'video'
        ? <video className="first-run-appearance-preview-media" src={wallpaperUrl} autoPlay loop muted playsInline style={mediaStyle} />
        : <img className="first-run-appearance-preview-media" src={wallpaperUrl} alt="" style={mediaStyle} />
        : null}
      <div className="first-run-appearance-preview-sidebar" aria-hidden="true">
        <Music2 size={22} />
        <i /><i /><i />
      </div>
      <div className="first-run-appearance-preview-content" aria-hidden="true">
        <strong>ECHO</strong>
        <span>{label}</span>
        <div className="first-run-appearance-preview-row"><Music2 size={18} /><i /><i /></div>
        <div className="first-run-appearance-preview-row"><Music2 size={18} /><i /><i /></div>
      </div>
      <div className="first-run-appearance-preview-player" aria-hidden="true">
        <SkipBack size={14} /><Play size={17} /><SkipForward size={14} /><i />
      </div>
    </div>
  );
};
