import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Captions,
  Check,
  ChevronDown,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  MonitorPlay,
  Palette,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Type,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type { AppSettings, LyricsMiniPlayerColorMode, LyricsPageStyle } from '../../../shared/types/appSettings';
import type { MvSettings } from '../../../shared/types/mv';
import { musicReactiveVisualsFeatureEnabled } from '../../../shared/utils/musicReactiveScene';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { registerAppearanceFontFile } from '../../preferences/appearancePreferences';
import { StyledSelect } from '../ui/StyledSelect';

type LyricsVisualSettingsDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
};

type LyricsVisualGroupKey =
  | 'layout'
  | 'cover'
  | 'readability'
  | 'display'
  | 'miniPlayer'
  | 'typography'
  | 'background'
  | 'mv';

type LyricsVisualGroupProps = {
  children: ReactNode;
  description: string;
  icon: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  title: string;
};

const defaultLyricsVisualGroupOpen: Record<LyricsVisualGroupKey, boolean> = {
  layout: true,
  cover: false,
  readability: false,
  display: false,
  miniPlayer: false,
  typography: false,
  background: false,
  mv: false,
};

const LyricsVisualGroup = ({ children, description, icon, isOpen, onToggle, title }: LyricsVisualGroupProps): JSX.Element => {
  return (
    <div className={`lyrics-visual-group${isOpen ? ' lyrics-visual-group--open' : ''}`} data-collapsed={isOpen ? 'false' : 'true'}>
      <button className="lyrics-visual-group__toggle" type="button" aria-expanded={isOpen} onClick={onToggle}>
        <span className="lyrics-visual-group__heading">
          {icon}
          <span>
            <strong>{title}</strong>
            <small>{description}</small>
          </span>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div className="lyrics-visual-group__shell" aria-hidden={!isOpen} {...(!isOpen ? { inert: '' } : {})}>
        {isOpen ? <div className="lyrics-visual-group__content">{children}</div> : null}
      </div>
    </div>
  );
};

type LyricsVisualAppSettings = Pick<
  AppSettings,
  | 'lyricsSmartReadableColorsEnabled'
  | 'lyricsHeaderHidden'
  | 'lyricsCornerControlsAutoHideEnabled'
  | 'lyricsMvAutoShowTrackInfoDisabled'
  | 'lyricsEmptyStateHidden'
  | 'lyricsPlayerBarDrawerEnabled'
  | 'lyricsPlayerBarDrawerAutoEnableForMv'
  | 'lyricsPlayerBarDrawerAutoHideEnabled'
  | 'lyricsPlayerBarDrawerCompactOnIdleEnabled'
  | 'lyricsPlayerBarDrawerOpacityPercent'
  | 'lyricsPlayerBarDrawerColorMode'
  | 'lyricsPlayerBarDrawerColor'
  | 'lyricsRomanizationEnabled'
  | 'lyricsTranslationEnabled'
  | 'lyricsFontSizePx'
  | 'lyricsSecondaryFontSizePx'
  | 'lyricsFontFamily'
  | 'lyricsFontFilePath'
  | 'lyricsTextDirection'
  | 'lyricsLineSpacingPercent'
  | 'lyricsLineMaxChars'
  | 'lyricsContextOpacityPercent'
  | 'lyricsColor'
  | 'lyricsImmersiveCoverStyleEnabled'
  | 'lyricsPageStyle'
  | 'lyricsImmersiveCoverGlassEnabled'
  | 'lyricsImmersiveCoverGlassBlurPx'
  | 'lyricsRoseVinylBackgroundBlurPx'
  | 'lyricsHighResolutionNetworkCoverEnabled'
  | 'lyricsMusicReactiveVisualsEnabled'
  | 'lyricsBackgroundMode'
  | 'lyricsCustomWallpaperPath'
  | 'lyricsCoverOpacityPercent'
  | 'lyricsCoverBlurPx'
  | 'lyricsCoverBrightnessPercent'
  | 'lyricsBackgroundScalePercent'
>;

type LyricsVisualMvSettings = Pick<
  MvSettings,
  | 'immersiveBackground'
  | 'immersiveBackgroundAutoScale'
  | 'immersiveBackgroundScalePercent'
  | 'immersiveBackgroundOffsetXPercent'
  | 'immersiveBackgroundOffsetYPercent'
  | 'immersiveBackgroundBlurPx'
  | 'immersiveBackgroundBrightnessPercent'
  | 'immersiveBackgroundOverlayOpacityPercent'
  | 'hideLyrics'
  | 'lyricsReadabilityEnhanced'
>;

const drawerExitAnimationMs = 480;
const lyricsBackgroundTuningOpenStorageKey = 'echo-next.lyrics.background-tuning-open';
const mvImmersiveControlsOpenStorageKey = 'echo-next.mv.immersive-controls-open';

const fallbackAppSettings: LyricsVisualAppSettings = {
  lyricsSmartReadableColorsEnabled: false,
  lyricsHeaderHidden: false,
  lyricsCornerControlsAutoHideEnabled: false,
  lyricsMvAutoShowTrackInfoDisabled: true,
  lyricsEmptyStateHidden: true,
  lyricsPlayerBarDrawerEnabled: true,
  lyricsPlayerBarDrawerAutoEnableForMv: true,
  lyricsPlayerBarDrawerAutoHideEnabled: false,
  lyricsPlayerBarDrawerCompactOnIdleEnabled: false,
  lyricsPlayerBarDrawerOpacityPercent: 78,
  lyricsPlayerBarDrawerColorMode: 'default',
  lyricsPlayerBarDrawerColor: '#232120',
  lyricsRomanizationEnabled: true,
  lyricsTranslationEnabled: true,
  lyricsFontSizePx: 40,
  lyricsSecondaryFontSizePx: 22,
  lyricsFontFamily: 'Microsoft YaHei',
  lyricsFontFilePath: null,
  lyricsTextDirection: 'horizontal',
  lyricsLineSpacingPercent: 110,
  lyricsLineMaxChars: 0,
  lyricsContextOpacityPercent: 49,
  lyricsColor: '#314054',
  lyricsPageStyle: 'default',
  lyricsImmersiveCoverStyleEnabled: false,
  lyricsImmersiveCoverGlassEnabled: false,
  lyricsImmersiveCoverGlassBlurPx: 16,
  lyricsRoseVinylBackgroundBlurPx: 18,
  lyricsHighResolutionNetworkCoverEnabled: false,
  lyricsMusicReactiveVisualsEnabled: false,
  lyricsBackgroundMode: 'theme',
  lyricsCustomWallpaperPath: null,
  lyricsCoverOpacityPercent: 100,
  lyricsCoverBlurPx: 10,
  lyricsCoverBrightnessPercent: 100,
  lyricsBackgroundScalePercent: 100,
};

const colorSwatches = ['#314054', '#FFFFFF', '#F6D365', '#8FCFBD', '#A8C7FA', '#FF8A80'];
const fallbackLyricsFontFamilies = [
  'Microsoft YaHei',
  'Microsoft JhengHei',
  'PingFang SC',
  'PingFang TC',
  'Noto Sans SC',
  'Noto Sans TC',
  'Source Han Sans SC',
  'Source Han Sans TC',
  'SimHei',
  'SimSun',
  'Segoe UI',
  'Arial',
  'Inter',
  'Outfit',
];

type LocalFontData = {
  family: string;
};

type NavigatorWithLocalFonts = Navigator & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

const mvImmersiveBackgroundDefaults = {
  immersiveBackgroundAutoScale: true,
  immersiveBackgroundScalePercent: 115,
  immersiveBackgroundOffsetXPercent: 50,
  immersiveBackgroundOffsetYPercent: 50,
  immersiveBackgroundBlurPx: 0,
  immersiveBackgroundBrightnessPercent: 100,
  immersiveBackgroundOverlayOpacityPercent: 0,
} satisfies Partial<LyricsVisualMvSettings>;

const fallbackMvSettings: LyricsVisualMvSettings = {
  immersiveBackground: true,
  ...mvImmersiveBackgroundDefaults,
  hideLyrics: false,
  lyricsReadabilityEnhanced: false,
};

const dispatchSettingsChanged = (patch?: Partial<AppSettings> | Partial<MvSettings>): void => {
  window.dispatchEvent(patch ? new CustomEvent('settings:changed', { detail: patch }) : new Event('settings:changed'));
};

const dispatchLyricsDisplaySettingsChanged = (patch: Partial<AppSettings>): void => {
  window.dispatchEvent(new CustomEvent('lyrics:display-settings-changed', { detail: patch }));
};

const readStorageFlag = (key: string, fallback = false): boolean => {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
};

const writeStorageFlag = (key: string, enabled: boolean): void => {
  try {
    window.localStorage.setItem(key, enabled ? 'true' : 'false');
  } catch {
    // UI-only preference; the real visual settings remain usable without localStorage.
  }
};

const sanitizeFontFamily = (value: string): string => value.replace(/[\r\n;]/g, '').trim();

const LyricsFontPickerModal = ({
  currentFont,
  fonts,
  isBusy,
  onChooseFile,
  onClose,
  onSelect,
  query,
  setQuery,
}: {
  currentFont: string;
  fonts: string[];
  isBusy: boolean;
  onChooseFile: () => void;
  onClose: () => void;
  onSelect: (fontFamily: string) => void;
  query: string;
  setQuery: (query: string) => void;
}): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredFonts = normalizedQuery ? fonts.filter((font) => font.toLowerCase().includes(normalizedQuery)) : fonts;

  return (
    <div className="settings-modal-backdrop lyrics-font-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-font-modal lyrics-font-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('lyricsSettings.fontPicker.aria')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-font-modal-header">
          <h3>{t('lyricsSettings.fontPicker.title')}</h3>
          <button className="settings-icon-button" type="button" onClick={onClose} aria-label={t('lyricsSettings.fontPicker.close')}>
            <X size={15} />
          </button>
        </header>
        <label className="settings-font-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder={t('lyricsSettings.fontPicker.searchPlaceholder')} />
        </label>
        <button className="settings-font-file-button" type="button" disabled={isBusy} onClick={onChooseFile}>
          <FolderOpen size={15} aria-hidden="true" />
          {t('lyricsSettings.fontPicker.chooseFile')}
        </button>
        <div className="settings-font-list">
          {filteredFonts.map((font) => (
            <button
              className={`settings-font-option ${font === currentFont ? 'active' : ''}`}
              key={font}
              type="button"
              style={{ fontFamily: `"${font}", var(--echo-font-family)` }}
              onClick={() => onSelect(font)}
            >
              <span>{font}</span>
              <em>{t('lyricsSettings.fontPicker.preview')}</em>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};

const selectAppSettings = (settings: AppSettings): LyricsVisualAppSettings => ({
  lyricsSmartReadableColorsEnabled: settings.lyricsSmartReadableColorsEnabled === true,
  lyricsHeaderHidden: settings.lyricsHeaderHidden === true,
  lyricsCornerControlsAutoHideEnabled: settings.lyricsCornerControlsAutoHideEnabled === true,
  lyricsMvAutoShowTrackInfoDisabled: settings.lyricsMvAutoShowTrackInfoDisabled !== false,
  lyricsEmptyStateHidden: settings.lyricsEmptyStateHidden !== false,
  lyricsPlayerBarDrawerEnabled: settings.lyricsPlayerBarDrawerEnabled !== false,
  lyricsPlayerBarDrawerAutoEnableForMv: settings.lyricsPlayerBarDrawerAutoEnableForMv !== false,
  lyricsPlayerBarDrawerAutoHideEnabled: settings.lyricsPlayerBarDrawerAutoHideEnabled === true,
  lyricsPlayerBarDrawerCompactOnIdleEnabled: settings.lyricsPlayerBarDrawerCompactOnIdleEnabled === true,
  lyricsPlayerBarDrawerOpacityPercent:
    settings.lyricsPlayerBarDrawerOpacityPercent ?? fallbackAppSettings.lyricsPlayerBarDrawerOpacityPercent,
  lyricsPlayerBarDrawerColorMode:
    settings.lyricsPlayerBarDrawerColorMode ?? fallbackAppSettings.lyricsPlayerBarDrawerColorMode,
  lyricsPlayerBarDrawerColor:
    settings.lyricsPlayerBarDrawerColor ?? fallbackAppSettings.lyricsPlayerBarDrawerColor,
  lyricsRomanizationEnabled: settings.lyricsRomanizationEnabled,
  lyricsTranslationEnabled: settings.lyricsTranslationEnabled,
  lyricsFontSizePx: settings.lyricsFontSizePx,
  lyricsSecondaryFontSizePx: settings.lyricsSecondaryFontSizePx ?? fallbackAppSettings.lyricsSecondaryFontSizePx,
  lyricsFontFamily: settings.lyricsFontFamily ?? fallbackAppSettings.lyricsFontFamily,
  lyricsFontFilePath: settings.lyricsFontFilePath ?? fallbackAppSettings.lyricsFontFilePath,
  lyricsTextDirection: settings.lyricsTextDirection ?? fallbackAppSettings.lyricsTextDirection,
  lyricsLineSpacingPercent: settings.lyricsLineSpacingPercent ?? fallbackAppSettings.lyricsLineSpacingPercent,
  lyricsLineMaxChars: settings.lyricsLineMaxChars ?? fallbackAppSettings.lyricsLineMaxChars,
  lyricsContextOpacityPercent: settings.lyricsContextOpacityPercent ?? fallbackAppSettings.lyricsContextOpacityPercent,
  lyricsColor: settings.lyricsColor,
  lyricsPageStyle: settings.lyricsPageStyle ?? fallbackAppSettings.lyricsPageStyle,
  lyricsImmersiveCoverStyleEnabled: settings.lyricsImmersiveCoverStyleEnabled === true,
  lyricsImmersiveCoverGlassEnabled: settings.lyricsImmersiveCoverGlassEnabled === true,
  lyricsImmersiveCoverGlassBlurPx: settings.lyricsImmersiveCoverGlassBlurPx ?? fallbackAppSettings.lyricsImmersiveCoverGlassBlurPx,
  lyricsRoseVinylBackgroundBlurPx: settings.lyricsRoseVinylBackgroundBlurPx ?? fallbackAppSettings.lyricsRoseVinylBackgroundBlurPx,
  lyricsHighResolutionNetworkCoverEnabled: settings.lyricsHighResolutionNetworkCoverEnabled === true,
  lyricsMusicReactiveVisualsEnabled: settings.lyricsMusicReactiveVisualsEnabled === true,
  lyricsBackgroundMode: settings.lyricsBackgroundMode ?? fallbackAppSettings.lyricsBackgroundMode,
  lyricsCustomWallpaperPath: settings.lyricsCustomWallpaperPath ?? null,
  lyricsCoverOpacityPercent: settings.lyricsCoverOpacityPercent ?? fallbackAppSettings.lyricsCoverOpacityPercent,
  lyricsCoverBlurPx: settings.lyricsCoverBlurPx ?? fallbackAppSettings.lyricsCoverBlurPx,
  lyricsCoverBrightnessPercent: settings.lyricsCoverBrightnessPercent ?? fallbackAppSettings.lyricsCoverBrightnessPercent,
  lyricsBackgroundScalePercent: settings.lyricsBackgroundScalePercent ?? fallbackAppSettings.lyricsBackgroundScalePercent,
});

const selectMvSettings = (settings: MvSettings | null | undefined): LyricsVisualMvSettings => ({
  immersiveBackground: settings?.immersiveBackground !== false,
  immersiveBackgroundAutoScale: settings?.immersiveBackgroundAutoScale !== false,
  immersiveBackgroundScalePercent: settings?.immersiveBackgroundScalePercent ?? fallbackMvSettings.immersiveBackgroundScalePercent,
  immersiveBackgroundOffsetXPercent: settings?.immersiveBackgroundOffsetXPercent ?? fallbackMvSettings.immersiveBackgroundOffsetXPercent,
  immersiveBackgroundOffsetYPercent: settings?.immersiveBackgroundOffsetYPercent ?? fallbackMvSettings.immersiveBackgroundOffsetYPercent,
  immersiveBackgroundBlurPx: settings?.immersiveBackgroundBlurPx ?? fallbackMvSettings.immersiveBackgroundBlurPx,
  immersiveBackgroundBrightnessPercent:
    settings?.immersiveBackgroundBrightnessPercent ?? fallbackMvSettings.immersiveBackgroundBrightnessPercent,
  immersiveBackgroundOverlayOpacityPercent:
    settings?.immersiveBackgroundOverlayOpacityPercent ?? fallbackMvSettings.immersiveBackgroundOverlayOpacityPercent,
  hideLyrics: settings?.hideLyrics === true,
  lyricsReadabilityEnhanced: settings?.lyricsReadabilityEnhanced === true,
});

export const LyricsVisualSettingsDrawer = ({ isOpen, onClose }: LyricsVisualSettingsDrawerProps): JSX.Element | null => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isMotionOpen, setIsMotionOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<LyricsVisualAppSettings>(fallbackAppSettings);
  const [mvSettings, setMvSettings] = useState<LyricsVisualMvSettings>(fallbackMvSettings);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBackgroundControlsOpen, setIsBackgroundControlsOpen] = useState(true);
  const [isBackgroundModeMenuOpen, setIsBackgroundModeMenuOpen] = useState(false);
  const [isBackgroundTuningOpen, setIsBackgroundTuningOpen] = useState(() => readStorageFlag(lyricsBackgroundTuningOpenStorageKey));
  const [isMvImmersiveControlsOpen, setIsMvImmersiveControlsOpen] = useState(() => readStorageFlag(mvImmersiveControlsOpenStorageKey));
  const [openVisualGroups, setOpenVisualGroups] = useState(defaultLyricsVisualGroupOpen);
  const [isFontPickerOpen, setIsFontPickerOpen] = useState(false);
  const [fontPickerQuery, setFontPickerQuery] = useState('');
  const [fontFamilies, setFontFamilies] = useState<string[]>(fallbackLyricsFontFamilies);
  const appSaveRequestIdRef = useRef(0);
  const mvSaveRequestIdRef = useRef(0);
  const debouncedSaveRequestIdRef = useRef(0);
  const debouncedSaveTimerRef = useRef<number | null>(null);
  const pendingDebouncedSettingsRef = useRef<Partial<AppSettings>>({});
  const lastGlassBlurCommitRef = useRef(fallbackAppSettings.lyricsImmersiveCoverGlassBlurPx);
  const lastRoseVinylBackgroundBlurCommitRef = useRef(fallbackAppSettings.lyricsRoseVinylBackgroundBlurPx);
  const [glassBlurDraftPx, setGlassBlurDraftPx] = useState<number | null>(null);
  const [roseVinylBackgroundBlurDraftPx, setRoseVinylBackgroundBlurDraftPx] = useState<number | null>(null);

  const lyricsBackgroundModeOptions = useMemo(
    () => [
      { mode: 'theme', label: t('lyricsSettings.background.mode.theme') },
      { mode: 'cover', label: t('lyricsSettings.background.mode.cover') },
      { mode: 'coverColor', label: t('lyricsSettings.background.mode.coverColor') },
      { mode: 'customWallpaper', label: t('lyricsSettings.background.mode.customWallpaper') },
    ] satisfies Array<{ mode: AppSettings['lyricsBackgroundMode']; label: string }>,
    [t],
  );
  const lyricsBackgroundModeLabel =
    lyricsBackgroundModeOptions.find((option) => option.mode === appSettings.lyricsBackgroundMode)?.label ??
    t('lyricsSettings.background.mode.theme');
  const miniPlayerColorModeOptions = useMemo(
    () => [
      { mode: 'default', label: t('lyricsSettings.display.miniPlayerDefaultDark') },
      { mode: 'custom', label: t('lyricsSettings.font.custom') },
      { mode: 'cover', label: t('lyricsSettings.background.mode.cover') },
    ] satisfies Array<{ mode: LyricsMiniPlayerColorMode; label: string }>,
    [t],
  );
  const miniPlayerColorMode: LyricsMiniPlayerColorMode =
    appSettings.lyricsPlayerBarDrawerColorMode ?? fallbackAppSettings.lyricsPlayerBarDrawerColorMode ?? 'default';
  const miniPlayerColorModeLabel =
    miniPlayerColorModeOptions.find((option) => option.mode === miniPlayerColorMode)?.label ??
    t('lyricsSettings.display.miniPlayerDefaultDark');
  const immersiveBackground = mvSettings.immersiveBackground !== false;
  const miniPlayerOpacityPercent =
    appSettings.lyricsPlayerBarDrawerOpacityPercent ?? fallbackAppSettings.lyricsPlayerBarDrawerOpacityPercent;
  const miniPlayerColor =
    appSettings.lyricsPlayerBarDrawerColor ?? fallbackAppSettings.lyricsPlayerBarDrawerColor ?? '#232120';
  const lyricsLineMaxChars = appSettings.lyricsLineMaxChars ?? fallbackAppSettings.lyricsLineMaxChars ?? 0;
  const lyricsContextOpacityPercent =
    appSettings.lyricsContextOpacityPercent ?? fallbackAppSettings.lyricsContextOpacityPercent;
  const lyricsFontFamily = appSettings.lyricsFontFamily ?? fallbackAppSettings.lyricsFontFamily ?? 'Microsoft YaHei';
  const isSecondaryLyricsSizeOpen = appSettings.lyricsRomanizationEnabled || appSettings.lyricsTranslationEnabled;
  const lyricsPageStyleOptions = useMemo(
    () => [
      { mode: 'default', label: t('lyricsSettings.visual.pageStyleDefault') },
      { mode: 'roseVinyl', label: t('lyricsSettings.visual.pageStyleRoseVinyl') },
    ] satisfies Array<{ mode: LyricsPageStyle; label: string }>,
    [t],
  );
  const lyricsPageStyle = appSettings.lyricsPageStyle ?? fallbackAppSettings.lyricsPageStyle ?? 'default';
  const canUseImmersiveGlassControls =
    appSettings.lyricsImmersiveCoverStyleEnabled === true || lyricsPageStyle === 'roseVinyl';
  const lyricsPageStyleLabel =
    lyricsPageStyleOptions.find((option) => option.mode === lyricsPageStyle)?.label ??
    t('lyricsSettings.visual.pageStyleDefault');
  const displayedGlassBlurPx = glassBlurDraftPx ?? appSettings.lyricsImmersiveCoverGlassBlurPx;
  const displayedRoseVinylBackgroundBlurPx =
    roseVinylBackgroundBlurDraftPx ?? appSettings.lyricsRoseVinylBackgroundBlurPx;

  const loadSettings = useCallback(async (): Promise<void> => {
    try {
      const [nextAppSettings, nextMvSettings] = await Promise.all([
        window.echo?.app?.getSettings?.(),
        window.echo?.mv?.getSettings?.().catch(() => null) ?? Promise.resolve(null),
      ]);

      if (nextAppSettings) {
        setAppSettings(selectAppSettings(nextAppSettings));
      } else {
        setAppSettings(fallbackAppSettings);
      }
      setMvSettings(selectMvSettings(nextMvSettings));
      setError(null);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
    }
  }, []);

  const patchAppSettings = useCallback(async (patch: Partial<AppSettings>, optimistic = true): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.setSettings) {
      setError('Desktop bridge unavailable');
      return;
    }

    const requestId = appSaveRequestIdRef.current + 1;
    appSaveRequestIdRef.current = requestId;
    if (optimistic) {
      setAppSettings((current) => ({ ...current, ...(patch as Partial<LyricsVisualAppSettings>) }));
      dispatchSettingsChanged(patch);
      dispatchLyricsDisplaySettingsChanged(patch);
    }

    setIsBusy(true);
    try {
      const nextSettings = await app.setSettings(patch);
      if (requestId === appSaveRequestIdRef.current) {
        const nextVisualSettings = selectAppSettings(nextSettings);
        setAppSettings(nextVisualSettings);
        setError(null);
        if (!optimistic) {
          dispatchSettingsChanged(patch);
          dispatchLyricsDisplaySettingsChanged(patch);
        }
      }
    } catch (settingsError) {
      if (requestId === appSaveRequestIdRef.current) {
        setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
        dispatchSettingsChanged();
      }
    } finally {
      if (requestId === appSaveRequestIdRef.current) {
        setIsBusy(false);
      }
    }
  }, []);

  const flushDebouncedSettings = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    const patch = pendingDebouncedSettingsRef.current;
    pendingDebouncedSettingsRef.current = {};
    debouncedSaveTimerRef.current = null;

    if (!app?.setSettings || Object.keys(patch).length === 0) {
      return;
    }

    const requestId = debouncedSaveRequestIdRef.current + 1;
    debouncedSaveRequestIdRef.current = requestId;
    try {
      const nextSettings = await app.setSettings(patch);
      if (requestId === debouncedSaveRequestIdRef.current) {
        setAppSettings(selectAppSettings(nextSettings));
        setError(null);
        dispatchSettingsChanged(patch);
      }
    } catch (settingsError) {
      if (requestId === debouncedSaveRequestIdRef.current) {
        setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
        dispatchSettingsChanged();
      }
    }
  }, []);

  const patchAppSettingsDebounced = useCallback(
    (patch: Partial<AppSettings>): void => {
      if (!window.echo?.app?.setSettings) {
        setError('Desktop bridge unavailable');
        return;
      }

      pendingDebouncedSettingsRef.current = {
        ...pendingDebouncedSettingsRef.current,
        ...patch,
      };
      setAppSettings((current) => ({ ...current, ...(patch as Partial<LyricsVisualAppSettings>) }));
      dispatchSettingsChanged(patch);
      dispatchLyricsDisplaySettingsChanged(patch);

      if (debouncedSaveTimerRef.current !== null) {
        window.clearTimeout(debouncedSaveTimerRef.current);
      }

      debouncedSaveTimerRef.current = window.setTimeout(() => {
        void flushDebouncedSettings();
      }, 240);
    },
    [flushDebouncedSettings],
  );

  const openFontPicker = useCallback((): void => {
    setFontPickerQuery('');
    setIsFontPickerOpen(true);
  }, []);

  const applySelectedFontFamily = useCallback((value: string): void => {
    const fontFamily = sanitizeFontFamily(value);
    if (!fontFamily || fontFamily === lyricsFontFamily) {
      setIsFontPickerOpen(false);
      return;
    }

    setFontFamilies((current) => Array.from(new Set([...current, fontFamily])).sort((a, b) => a.localeCompare(b)));
    setIsFontPickerOpen(false);
    void patchAppSettings({ lyricsFontFamily: fontFamily, lyricsFontFilePath: null });
  }, [lyricsFontFamily, patchAppSettings]);

  const chooseFontFileForLyrics = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.chooseFontFile) {
      setError('Desktop bridge unavailable');
      return;
    }

    setIsBusy(true);
    try {
      const fontFile = await app.chooseFontFile();
      if (!fontFile) {
        return;
      }

      const fontFamily = await registerAppearanceFontFile('lyrics', fontFile);
      setFontFamilies((current) => Array.from(new Set([...current, fontFamily])).sort((a, b) => a.localeCompare(b)));
      setIsFontPickerOpen(false);
      await patchAppSettings({ lyricsFontFamily: fontFamily, lyricsFontFilePath: fontFile.path });
    } catch (fontError) {
      setError(fontError instanceof Error ? fontError.message : String(fontError));
    } finally {
      setIsBusy(false);
    }
  }, [patchAppSettings]);

  const previewAppSettings = useCallback((patch: Partial<AppSettings>): void => {
    setAppSettings((current) => ({ ...current, ...(patch as Partial<LyricsVisualAppSettings>) }));
    dispatchSettingsChanged(patch);
    dispatchLyricsDisplaySettingsChanged(patch);
  }, []);

  useEffect(() => {
    if (!isFontPickerOpen) {
      return undefined;
    }

    const queryLocalFonts = (navigator as NavigatorWithLocalFonts).queryLocalFonts;

    if (!queryLocalFonts) {
      return undefined;
    }

    let cancelled = false;
    void queryLocalFonts()
      .then((fonts) => {
        if (cancelled) {
          return;
        }

        const families = Array.from(
          new Set([
            ...fallbackLyricsFontFamilies,
            ...fonts.map((font) => sanitizeFontFamily(font.family)).filter(Boolean),
          ]),
        ).sort((a, b) => a.localeCompare(b));
        setFontFamilies(families);
      })
      .catch(() => setFontFamilies(fallbackLyricsFontFamilies));

    return () => {
      cancelled = true;
    };
  }, [isFontPickerOpen]);

  useEffect(() => {
    lastGlassBlurCommitRef.current = appSettings.lyricsImmersiveCoverGlassBlurPx;
  }, [appSettings.lyricsImmersiveCoverGlassBlurPx]);

  useEffect(() => {
    if (roseVinylBackgroundBlurDraftPx === null) {
      lastRoseVinylBackgroundBlurCommitRef.current = appSettings.lyricsRoseVinylBackgroundBlurPx;
    }
  }, [appSettings.lyricsRoseVinylBackgroundBlurPx, roseVinylBackgroundBlurDraftPx]);

  useEffect(() => {
    if (!isOpen) {
      setGlassBlurDraftPx(null);
      setRoseVinylBackgroundBlurDraftPx(null);
    }
  }, [isOpen]);

  const commitGlassBlurPx = useCallback(
    (value: number): void => {
      const nextValue = Math.max(0, Math.min(32, Math.round(value)));
      setGlassBlurDraftPx(null);
      if (nextValue === lastGlassBlurCommitRef.current) {
        return;
      }

      lastGlassBlurCommitRef.current = nextValue;
      void patchAppSettings({ lyricsImmersiveCoverGlassBlurPx: nextValue });
    },
    [patchAppSettings],
  );

  const commitRoseVinylBackgroundBlurPx = useCallback(
    (value: number): void => {
      const nextValue = Math.max(0, Math.min(48, Math.round(value)));
      setRoseVinylBackgroundBlurDraftPx(null);
      if (nextValue === lastRoseVinylBackgroundBlurCommitRef.current) {
        return;
      }

      lastRoseVinylBackgroundBlurCommitRef.current = nextValue;
      void patchAppSettings({ lyricsRoseVinylBackgroundBlurPx: nextValue });
    },
    [patchAppSettings],
  );

  const patchMvSettings = useCallback(
    async (patch: Partial<MvSettings>): Promise<void> => {
      const mv = window.echo?.mv;
      if (!mv?.setSettings) {
        setError('Desktop bridge unavailable');
        return;
      }

      const previousSettings = mvSettings;
      const requestId = mvSaveRequestIdRef.current + 1;
      mvSaveRequestIdRef.current = requestId;
      setMvSettings((current) => ({ ...current, ...(patch as Partial<LyricsVisualMvSettings>) }));
      dispatchSettingsChanged(patch);
      setIsBusy(true);

      try {
        const nextSettings = await mv.setSettings(patch);
        if (requestId === mvSaveRequestIdRef.current) {
          setMvSettings(selectMvSettings(nextSettings));
          setError(null);
          dispatchSettingsChanged(patch);
        }
      } catch (settingsError) {
        if (requestId === mvSaveRequestIdRef.current) {
          setMvSettings(previousSettings);
          setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
          dispatchSettingsChanged();
        }
      } finally {
        if (requestId === mvSaveRequestIdRef.current) {
          setIsBusy(false);
        }
      }
    },
    [mvSettings],
  );

  const chooseWallpaper = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.chooseLyricsWallpaper || !app.setSettings) {
      setError('Desktop bridge unavailable');
      return;
    }

    try {
      const wallpaperPath = await app.chooseLyricsWallpaper();
      if (wallpaperPath) {
        const patch: Partial<AppSettings> = {
          lyricsBackgroundMode: 'customWallpaper',
          lyricsCustomWallpaperPath: wallpaperPath,
        };
        const nextSettings = await app.setSettings(patch);
        setAppSettings(selectAppSettings(nextSettings));
        dispatchSettingsChanged(patch);
        dispatchLyricsDisplaySettingsChanged(patch);
        setError(null);
      }
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
    }
  }, []);

  const toggleBackgroundTuning = useCallback((): void => {
    setIsBackgroundTuningOpen((current) => {
      const next = !current;
      writeStorageFlag(lyricsBackgroundTuningOpenStorageKey, next);
      return next;
    });
  }, []);

  const toggleMvImmersiveControls = useCallback((): void => {
    setIsMvImmersiveControlsOpen((current) => {
      const next = !current;
      writeStorageFlag(mvImmersiveControlsOpenStorageKey, next);
      return next;
    });
  }, []);

  const toggleVisualGroup = useCallback((group: LyricsVisualGroupKey): void => {
    setOpenVisualGroups((current) => ({ ...current, [group]: !current[group] }));
  }, []);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      let secondFrame = 0;
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          setIsMotionOpen(true);
          void loadSettings();
        });
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
      };
    }

    setIsMotionOpen(false);
    if (!shouldRender) {
      return undefined;
    }

    const timer = window.setTimeout(() => setShouldRender(false), drawerExitAnimationMs);
    return () => window.clearTimeout(timer);
  }, [isOpen, loadSettings, shouldRender]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(
    () => () => {
      if (debouncedSaveTimerRef.current !== null) {
        window.clearTimeout(debouncedSaveTimerRef.current);
        void flushDebouncedSettings();
      }
    },
    [flushDebouncedSettings],
  );

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="audio-drawer-root lyrics-visual-settings-drawer-root no-drag" role="presentation" data-open={isMotionOpen}>
      <button className="audio-drawer-scrim" type="button" aria-label={t('lyricsSettings.drawer.close')} onClick={onClose} />
      <aside className="audio-drawer lyrics-settings-drawer lyrics-visual-settings-drawer" aria-label={t('lyricsSettings.visual.title')}>
        <div className="audio-drawer-scroll">
          <header className="audio-drawer-header">
            <div>
              <ImageIcon size={18} />
              <h2>{t('lyricsSettings.visual.title')}</h2>
            </div>
            <button className="audio-drawer-close" type="button" aria-label={t('lyricsSettings.drawer.close')} title={t('lyricsSettings.drawer.close')} onClick={onClose}>
              <X size={20} />
            </button>
          </header>

          <section className="audio-drawer-section audio-drawer-options audio-drawer-options--open">
            <div className="audio-drawer-section-title">
              <ImageIcon size={17} />
              <h3>{t('lyricsSettings.visual.title')}</h3>
            </div>

            <LyricsVisualGroup
              icon={<Captions size={17} />}
              title={t('lyricsSettings.visual.group.layout.title')}
              description={t('lyricsSettings.visual.group.layout.description')}
              isOpen={openVisualGroups.layout}
              onToggle={() => toggleVisualGroup('layout')}
            >
            <div className="lyrics-color-panel lyrics-page-style-panel" data-style={lyricsPageStyle}>
              <div className="lyrics-color-panel__header">
                <span>
                  <Captions size={15} />
                  <strong>{t('lyricsSettings.visual.pageStyle')}</strong>
                </span>
                <em>{lyricsPageStyleLabel}</em>
              </div>
              <StyledSelect<LyricsPageStyle>
                className="lyrics-page-style-select"
                ariaLabel={t('lyricsSettings.visual.pageStyle')}
                value={lyricsPageStyle}
                options={lyricsPageStyleOptions.map((option) => ({ value: option.mode, label: option.label }))}
                disabled={isBusy}
                showFilterIcon={false}
                onChange={(style) => void patchAppSettings({ lyricsPageStyle: style })}
              />
              <p>{t('lyricsSettings.visual.pageStyleDescription')}</p>
              {lyricsPageStyle === 'roseVinyl' ? (
                <div className="lyrics-page-style-panel__rose-controls">
                  <label className="lyrics-drawer-range lyrics-rose-vinyl-background-blur-range">
                    <span>
                      <strong>{t('lyricsSettings.visual.roseVinylBackgroundBlur')}</strong>
                      <em>{displayedRoseVinylBackgroundBlurPx}px</em>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={48}
                      step={1}
                      value={displayedRoseVinylBackgroundBlurPx}
                      onChange={(event) => {
                        const nextValue = Number(event.currentTarget.value);
                        setRoseVinylBackgroundBlurDraftPx(nextValue);
                        previewAppSettings({ lyricsRoseVinylBackgroundBlurPx: nextValue });
                      }}
                      onPointerUp={(event) => commitRoseVinylBackgroundBlurPx(Number(event.currentTarget.value))}
                      onKeyUp={(event) => commitRoseVinylBackgroundBlurPx(Number(event.currentTarget.value))}
                      onBlur={(event) => {
                        if (roseVinylBackgroundBlurDraftPx !== null) {
                          commitRoseVinylBackgroundBlurPx(Number(event.currentTarget.value));
                        }
                      }}
                    />
                  </label>
                  <p>{t('lyricsSettings.visual.roseVinylBackgroundBlurDescription')}</p>
                </div>
              ) : null}
            </div>
            </LyricsVisualGroup>

            <LyricsVisualGroup
              icon={<ImageIcon size={17} />}
              title={t('lyricsSettings.visual.group.cover.title')}
              description={t('lyricsSettings.visual.group.cover.description')}
              isOpen={openVisualGroups.cover}
              onToggle={() => toggleVisualGroup('cover')}
            >
            <label className="audio-toggle-row lyrics-immersive-cover-style-toggle">
              <span>
                <Captions size={17} />
                <strong>{t('lyricsSettings.background.immersiveCoverStyle')}</strong>
              </span>
              <input
                type="checkbox"
                checked={appSettings.lyricsImmersiveCoverStyleEnabled === true}
                disabled={isBusy}
                onChange={(event) => void patchAppSettings({ lyricsImmersiveCoverStyleEnabled: event.currentTarget.checked })}
              />
            </label>
            <p>{t('lyricsSettings.background.immersiveCoverStyleDescription')}</p>

            {canUseImmersiveGlassControls ? (
              <div className="lyrics-immersive-glass-controls">
                <label className="audio-toggle-row lyrics-immersive-cover-glass-toggle">
                  <span>
                    <SlidersHorizontal size={17} />
                    <strong>{t('lyricsSettings.background.immersiveCoverGlass')}</strong>
                  </span>
                  <input
                    type="checkbox"
                    checked={appSettings.lyricsImmersiveCoverGlassEnabled === true}
                    disabled={isBusy}
                    onChange={(event) => void patchAppSettings({ lyricsImmersiveCoverGlassEnabled: event.currentTarget.checked })}
                  />
                </label>
                <p>{t('lyricsSettings.background.immersiveCoverGlassDescription')}</p>
                {appSettings.lyricsImmersiveCoverGlassEnabled ? (
                  <label className="lyrics-drawer-range lyrics-immersive-cover-glass-blur-range">
                    <span>
                      <strong>{t('lyricsSettings.background.immersiveCoverGlassBlur')}</strong>
                      <em>{displayedGlassBlurPx}px</em>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={32}
                      step={1}
                      value={displayedGlassBlurPx}
                      onChange={(event) => setGlassBlurDraftPx(Number(event.currentTarget.value))}
                      onPointerUp={(event) => commitGlassBlurPx(Number(event.currentTarget.value))}
                      onKeyUp={(event) => commitGlassBlurPx(Number(event.currentTarget.value))}
                      onBlur={(event) => {
                        if (glassBlurDraftPx !== null) {
                          commitGlassBlurPx(Number(event.currentTarget.value));
                        }
                      }}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}

            {musicReactiveVisualsFeatureEnabled ? (
              <>
                <label className="audio-toggle-row lyrics-music-reactive-toggle">
                  <span>
                    <Zap size={17} />
                    <strong>{t('lyricsSettings.background.musicReactiveVisuals')}</strong>
                  </span>
                  <input
                    type="checkbox"
                    checked={appSettings.lyricsMusicReactiveVisualsEnabled === true}
                    disabled={isBusy}
                    onChange={(event) => void patchAppSettings({ lyricsMusicReactiveVisualsEnabled: event.currentTarget.checked })}
                  />
                </label>
                <p>{t('lyricsSettings.background.musicReactiveVisualsDescription')}</p>
              </>
            ) : null}
            </LyricsVisualGroup>

            <LyricsVisualGroup
              icon={<EyeOff size={17} />}
              title={t('lyricsSettings.visual.group.readability.title')}
              description={t('lyricsSettings.visual.group.readability.description')}
              isOpen={openVisualGroups.readability}
              onToggle={() => toggleVisualGroup('readability')}
            >
            <label className="audio-toggle-row lyrics-smart-readable-toggle">
              <span>
                <EyeOff size={17} />
                <strong>{t('lyricsSettings.background.smartReadable')}</strong>
              </span>
              <input
                type="checkbox"
                checked={appSettings.lyricsSmartReadableColorsEnabled === true}
                disabled={isBusy}
                onChange={(event) => void patchAppSettings({ lyricsSmartReadableColorsEnabled: event.currentTarget.checked })}
              />
            </label>
            <p>{t('lyricsSettings.background.smartReadableDescription')}</p>

            <label className="audio-toggle-row lyrics-readability-toggle">
              <span>
                <EyeOff size={17} />
                <strong>{t('lyricsSettings.background.readability')}</strong>
              </span>
              <input
                type="checkbox"
                checked={mvSettings.lyricsReadabilityEnhanced === true}
                disabled={isBusy}
                onChange={(event) => void patchMvSettings({ lyricsReadabilityEnhanced: event.currentTarget.checked })}
              />
            </label>
            <p>{t('lyricsSettings.background.readabilityDescription')}</p>
            </LyricsVisualGroup>

            <LyricsVisualGroup
              icon={<EyeOff size={17} />}
              title={t('lyricsSettings.visual.group.display.title')}
              description={t('lyricsSettings.visual.group.display.description')}
              isOpen={openVisualGroups.display}
              onToggle={() => toggleVisualGroup('display')}
            >
            <label className="audio-toggle-row">
              <span>
                <EyeOff size={17} />
                <strong>{t('lyricsSettings.display.hideTrackInfo')}</strong>
              </span>
              <input
                type="checkbox"
                checked={appSettings.lyricsHeaderHidden}
                disabled={isBusy}
                onChange={(event) => void patchAppSettings({ lyricsHeaderHidden: event.currentTarget.checked })}
              />
            </label>
            {appSettings.lyricsHeaderHidden ? (
              <label className="audio-toggle-row">
                <span>
                  <EyeOff size={17} />
                  <strong>{t('lyricsSettings.display.disableMvTrackInfoAutoShow')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={appSettings.lyricsMvAutoShowTrackInfoDisabled}
                  disabled={isBusy}
                  onChange={(event) => void patchAppSettings({ lyricsMvAutoShowTrackInfoDisabled: event.currentTarget.checked })}
                />
              </label>
            ) : null}

            <label className="audio-toggle-row">
              <span>
                <EyeOff size={17} />
                <strong>{t('lyricsSettings.display.hideEmptyState')}</strong>
              </span>
              <input
                type="checkbox"
                checked={appSettings.lyricsEmptyStateHidden}
                disabled={isBusy}
                onChange={(event) => void patchAppSettings({ lyricsEmptyStateHidden: event.currentTarget.checked })}
              />
            </label>
            <p>{t('lyricsSettings.display.hideEmptyStateDescription')}</p>

            <label className="audio-toggle-row">
              <span>
                <EyeOff size={17} />
                <strong>{t('lyricsSettings.display.cornerControlsAutoHide')}</strong>
              </span>
              <input
                type="checkbox"
                checked={appSettings.lyricsCornerControlsAutoHideEnabled === true}
                disabled={isBusy}
                onChange={(event) => void patchAppSettings({ lyricsCornerControlsAutoHideEnabled: event.currentTarget.checked })}
              />
            </label>
            <p>{t('lyricsSettings.display.cornerControlsAutoHideDescription')}</p>
            </LyricsVisualGroup>

            <LyricsVisualGroup
              icon={<SlidersHorizontal size={17} />}
              title={t('lyricsSettings.visual.group.miniPlayer.title')}
              description={t('lyricsSettings.visual.group.miniPlayer.description')}
              isOpen={openVisualGroups.miniPlayer}
              onToggle={() => toggleVisualGroup('miniPlayer')}
            >
            <label className="audio-toggle-row">
              <span>
                <EyeOff size={17} />
                <strong>{t('lyricsSettings.display.miniPlayer')}</strong>
              </span>
              <input
                type="checkbox"
                checked={appSettings.lyricsPlayerBarDrawerEnabled}
                disabled={isBusy}
                onChange={(event) => void patchAppSettings({ lyricsPlayerBarDrawerEnabled: event.currentTarget.checked })}
              />
            </label>
            <p>{t('lyricsSettings.display.miniPlayerDescription')}</p>
            <p>{t('lyricsSettings.display.miniPlayerHint')}</p>
            <label className="audio-toggle-row">
              <span>
                <EyeOff size={17} />
                <strong>{t('lyricsSettings.display.miniPlayerAutoMv')}</strong>
              </span>
              <input
                type="checkbox"
                checked={appSettings.lyricsPlayerBarDrawerAutoEnableForMv !== false}
                disabled={isBusy}
                onChange={(event) => void patchAppSettings({ lyricsPlayerBarDrawerAutoEnableForMv: event.currentTarget.checked })}
              />
            </label>
            <p>{t('lyricsSettings.display.miniPlayerAutoMvDescription')}</p>
            <label className="audio-toggle-row">
              <span>
                <EyeOff size={17} />
                <strong>{t('lyricsSettings.display.miniPlayerAutoHide')}</strong>
              </span>
              <input
                type="checkbox"
                checked={appSettings.lyricsPlayerBarDrawerAutoHideEnabled === true}
                disabled={
                  isBusy ||
                  (appSettings.lyricsPlayerBarDrawerEnabled !== true &&
                    appSettings.lyricsPlayerBarDrawerAutoEnableForMv === false)
                }
                onChange={(event) => void patchAppSettings({ lyricsPlayerBarDrawerAutoHideEnabled: event.currentTarget.checked })}
              />
            </label>
            <p>{t('lyricsSettings.display.miniPlayerAutoHideDescription')}</p>
            <label className="audio-toggle-row">
              <span>
                <EyeOff size={17} />
                <strong>{t('lyricsSettings.display.miniPlayerCompactOnIdle')}</strong>
              </span>
              <input
                type="checkbox"
                checked={appSettings.lyricsPlayerBarDrawerCompactOnIdleEnabled === true}
                disabled={
                  isBusy ||
                  (appSettings.lyricsPlayerBarDrawerEnabled !== true &&
                    appSettings.lyricsPlayerBarDrawerAutoEnableForMv === false)
                }
                onChange={(event) => void patchAppSettings({ lyricsPlayerBarDrawerCompactOnIdleEnabled: event.currentTarget.checked })}
              />
            </label>
            <p>{t('lyricsSettings.display.miniPlayerCompactOnIdleDescription')}</p>

            {appSettings.lyricsPlayerBarDrawerEnabled ? (
              <div className="audio-drawer-mini-grid lyrics-mini-player-options">
                <div className="lyrics-mini-player-tuning-row">
                  <label className="lyrics-drawer-range">
                    <span>
                      <strong>
                        <EyeOff size={15} />
                        {t('lyricsSettings.display.miniPlayerOpacity')}
                      </strong>
                      <em>{miniPlayerOpacityPercent}%</em>
                    </span>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      step={1}
                      value={miniPlayerOpacityPercent}
                      disabled={isBusy}
                      onChange={(event) =>
                        patchAppSettingsDebounced({ lyricsPlayerBarDrawerOpacityPercent: Number(event.currentTarget.value) })
                      }
                    />
                  </label>

                  <div className="lyrics-color-panel lyrics-mini-player-color-panel">
                    <div className="lyrics-color-panel__header">
                      <span>
                        <Palette size={15} />
                        <strong>{t('lyricsSettings.display.miniPlayerColor')}</strong>
                      </span>
                      <em>{miniPlayerColorMode === 'custom' ? miniPlayerColor : miniPlayerColorModeLabel}</em>
                    </div>
                    <StyledSelect<LyricsMiniPlayerColorMode>
                      className="lyrics-mini-player-color-mode-select"
                      ariaLabel={t('lyricsSettings.display.miniPlayerColorMode')}
                      value={miniPlayerColorMode}
                      options={miniPlayerColorModeOptions.map((option) => ({ value: option.mode, label: option.label }))}
                      disabled={isBusy}
                      showFilterIcon={false}
                      onChange={(mode) => void patchAppSettings({ lyricsPlayerBarDrawerColorMode: mode })}
                    />
                  </div>
                </div>

                {miniPlayerColorMode === 'custom' ? (
                  <>
                    <div className="lyrics-color-panel__header lyrics-mini-player-custom-color">
                      <span>
                        <Palette size={15} />
                        <strong>{t('lyricsSettings.display.customColor')}</strong>
                      </span>
                      <label className="lyrics-color-input" title={t('lyricsSettings.display.chooseMiniPlayerColor')}>
                        <input
                          type="color"
                          value={miniPlayerColor}
                          disabled={isBusy}
                          onChange={(event) => void patchAppSettings({ lyricsPlayerBarDrawerColor: event.currentTarget.value })}
                        />
                        <em>{miniPlayerColor}</em>
                      </label>
                    </div>
                    <div className="lyrics-color-swatches" aria-label={t('lyricsSettings.display.miniPlayerPalette')}>
                      {colorSwatches.map((color) => (
                        <button
                          className="lyrics-color-swatch"
                          type="button"
                          key={color}
                          style={{ backgroundColor: color }}
                          aria-label={t('lyricsSettings.display.useMiniPlayerColor', { color })}
                          aria-pressed={miniPlayerColor.toUpperCase() === color}
                          disabled={isBusy}
                          onClick={() => void patchAppSettings({ lyricsPlayerBarDrawerColor: color })}
                        >
                          {miniPlayerColor.toUpperCase() === color ? <Check size={13} /> : null}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                {miniPlayerColorMode === 'cover' ? (
                  <p>{t('lyricsSettings.display.coverMiniPlayerHint')}</p>
                ) : null}
              </div>
            ) : null}
            </LyricsVisualGroup>

            <LyricsVisualGroup
              icon={<Type size={17} />}
              title={t('lyricsSettings.visual.group.typography.title')}
              description={t('lyricsSettings.visual.group.typography.description')}
              isOpen={openVisualGroups.typography}
              onToggle={() => toggleVisualGroup('typography')}
            >
            <div className="lyrics-font-panel">
              <div className="lyrics-color-panel__header">
                <span>
                  <Type size={15} />
                  <strong>{t('lyricsSettings.style.lyricsFont')}</strong>
                </span>
                <em title={appSettings.lyricsFontFilePath ?? undefined}>
                  {appSettings.lyricsFontFilePath ? t('lyricsSettings.font.custom') : t('lyricsSettings.font.system')}
                </em>
              </div>
              <button
                className="lyrics-font-picker-button"
                type="button"
                disabled={isBusy}
                onClick={openFontPicker}
              >
                <span style={{ fontFamily: `"${lyricsFontFamily}", var(--echo-font-family)` }}>{lyricsFontFamily}</span>
                <em>{t('lyricsSettings.font.chooseInstalled')}</em>
              </button>
              <div className="lyrics-font-actions">
                <button
                  className="audio-device-pill"
                  type="button"
                  disabled={isBusy}
                  onClick={openFontPicker}
                >
                  <Check size={15} />
                  <span>
                    <strong>{t('lyricsSettings.font.applySystem')}</strong>
                    <small>{t('lyricsSettings.font.lyricsOnly')}</small>
                  </span>
                  <em>{t('lyricsSettings.action.fonts')}</em>
                </button>
                <button className="audio-device-pill" type="button" disabled={isBusy} onClick={() => void chooseFontFileForLyrics()}>
                  <Upload size={15} />
                  <span>
                    <strong>{t('lyricsSettings.font.importFile')}</strong>
                    <small>TTF / OTF / WOFF / WOFF2</small>
                  </span>
                  <em>{t('lyricsSettings.action.choose')}</em>
                </button>
                <button
                  className="audio-device-pill"
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    const fallbackFontFamily = fallbackAppSettings.lyricsFontFamily ?? 'Microsoft YaHei';
                    setIsFontPickerOpen(false);
                    void patchAppSettings({
                      lyricsFontFamily: fallbackFontFamily,
                      lyricsFontFilePath: fallbackAppSettings.lyricsFontFilePath,
                    });
                  }}
                >
                  <RotateCcw size={15} />
                  <span>
                    <strong>{t('lyricsSettings.font.restoreLyricsDefault')}</strong>
                    <small>{fallbackAppSettings.lyricsFontFamily}</small>
                  </span>
                  <em>{t('lyricsSettings.action.reset')}</em>
                </button>
              </div>
            </div>

            <div className="lyrics-style-range-grid">
              {isSecondaryLyricsSizeOpen ? (
                <label className="lyrics-drawer-range lyrics-secondary-size-range">
                  <span>
                    <strong>
                      <Type size={15} />
                      {t('lyricsSettings.style.secondaryFontSize')}
                    </strong>
                    <em>{appSettings.lyricsSecondaryFontSizePx}px</em>
                  </span>
                  <input
                    type="range"
                    min={12}
                    max={32}
                    step={1}
                    value={appSettings.lyricsSecondaryFontSizePx}
                    onChange={(event) => patchAppSettingsDebounced({ lyricsSecondaryFontSizePx: Number(event.currentTarget.value) })}
                  />
                </label>
              ) : null}
              <label className="lyrics-drawer-range">
                <span>
                  <strong>
                    <Type size={15} />
                    {t('lyricsSettings.style.fontSize')}
                  </strong>
                  <em>{appSettings.lyricsFontSizePx}px</em>
                </span>
                <input
                  type="range"
                  min={22}
                  max={56}
                  step={1}
                  value={appSettings.lyricsFontSizePx}
                  onChange={(event) => patchAppSettingsDebounced({ lyricsFontSizePx: Number(event.currentTarget.value) })}
                />
              </label>
              <label className="lyrics-drawer-range">
                <span>
                  <strong>
                    <SlidersHorizontal size={15} />
                    {t('lyricsSettings.style.lineSpacing')}
                  </strong>
                  <em>{appSettings.lyricsLineSpacingPercent}%</em>
                </span>
                <input
                  type="range"
                  min={60}
                  max={150}
                  step={1}
                  value={appSettings.lyricsLineSpacingPercent}
                  onChange={(event) => patchAppSettingsDebounced({ lyricsLineSpacingPercent: Number(event.currentTarget.value) })}
                />
              </label>
              <label className="lyrics-drawer-range">
                <span>
                  <strong>
                    <Type size={15} />
                    {t('lyricsSettings.style.lineMaxChars')}
                  </strong>
                  <em>{lyricsLineMaxChars > 0 ? t('lyricsSettings.style.lineMaxCharsValue', { count: lyricsLineMaxChars }) : t('lyricsSettings.status.auto')}</em>
                </span>
                <input
                  type="range"
                  min={0}
                  max={80}
                  step={1}
                  value={lyricsLineMaxChars}
                  onChange={(event) => patchAppSettingsDebounced({ lyricsLineMaxChars: Number(event.currentTarget.value) })}
                />
              </label>
              <label className="lyrics-drawer-range">
                <span>
                  <strong>
                    <EyeOff size={15} />
                    {t('lyricsSettings.style.contextOpacity')}
                  </strong>
                  <em>{lyricsContextOpacityPercent}%</em>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={lyricsContextOpacityPercent}
                  onChange={(event) => patchAppSettingsDebounced({ lyricsContextOpacityPercent: Number(event.currentTarget.value) })}
                />
              </label>
            </div>

            <div className="lyrics-color-panel" id="settings-row-lyrics-color">
              <div className="lyrics-color-panel__header">
                <span>
                  <Palette size={15} />
                  <strong>{t('lyricsSettings.style.lyricsColor')}</strong>
                </span>
                <label className="lyrics-color-input" title={t('lyricsSettings.style.chooseLyricsColor')}>
                  <input
                    type="color"
                    value={appSettings.lyricsColor}
                    onChange={(event) => patchAppSettingsDebounced({ lyricsColor: event.currentTarget.value })}
                  />
                  <em>{appSettings.lyricsColor}</em>
                </label>
              </div>
              <div className="lyrics-color-swatches" aria-label={t('lyricsSettings.style.lyricsColorPalette')}>
                {colorSwatches.map((color) => (
                  <button
                    className="lyrics-color-swatch"
                    type="button"
                    key={color}
                    style={{ backgroundColor: color }}
                    aria-label={t('lyricsSettings.style.useColor', { color })}
                    aria-pressed={appSettings.lyricsColor.toUpperCase() === color}
                    disabled={isBusy}
                    onClick={() => void patchAppSettings({ lyricsColor: color })}
                  >
                    {appSettings.lyricsColor.toUpperCase() === color ? <Check size={13} /> : null}
                  </button>
                ))}
                <button
                  className="lyrics-color-reset"
                  type="button"
                  disabled={isBusy}
                  onClick={() => void patchAppSettings({ lyricsColor: fallbackAppSettings.lyricsColor })}
                >
                  <RotateCcw size={14} />
                  {t('lyricsSettings.action.reset')}
                </button>
              </div>
              <div
                className="lyrics-color-preview"
                style={{ '--lyrics-preview-color': appSettings.lyricsColor } as CSSProperties}
              >
                <span>{t('lyricsSettings.preview.primary')}</span>
                <small>{t('lyricsSettings.preview.secondary')}</small>
              </div>
            </div>
            </LyricsVisualGroup>

            <LyricsVisualGroup
              icon={<ImageIcon size={17} />}
              title={t('lyricsSettings.visual.group.background.title')}
              description={t('lyricsSettings.visual.group.background.description')}
              isOpen={openVisualGroups.background}
              onToggle={() => toggleVisualGroup('background')}
            >
            <div className="audio-toggle-row lyrics-background-toggle lyrics-background-toggle--with-mode">
              <span>
                <ImageIcon size={17} />
                <strong>{t('lyricsSettings.background.showControls')}</strong>
              </span>
              <div className="lyrics-background-toggle__actions">
                <div
                  className="lyrics-background-select"
                  onBlur={(event) => {
                    const nextFocus = event.relatedTarget;
                    if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
                      setIsBackgroundModeMenuOpen(false);
                    }
                  }}
                >
                <span>{t('lyricsSettings.background.modeAria')}</span>
                <button
                  className="lyrics-background-select__trigger"
                  type="button"
                  aria-label={t('lyricsSettings.background.modeAria')}
                  aria-haspopup="listbox"
                  aria-expanded={isBackgroundModeMenuOpen}
                  disabled={isBusy}
                  onClick={() => setIsBackgroundModeMenuOpen((open) => !open)}
                >
                  <strong>{lyricsBackgroundModeLabel}</strong>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
                {isBackgroundModeMenuOpen ? (
                  <div className="lyrics-background-select__menu" role="listbox" aria-label={t('lyricsSettings.background.modeAria')}>
                    {lyricsBackgroundModeOptions.map((option) => (
                      <button
                        className="lyrics-background-select__option"
                        type="button"
                        role="option"
                        aria-selected={appSettings.lyricsBackgroundMode === option.mode}
                        data-mode={option.mode}
                        key={option.mode}
                        onClick={() => {
                          setIsBackgroundModeMenuOpen(false);
                          if (option.mode === 'customWallpaper' && !appSettings.lyricsCustomWallpaperPath) {
                            void chooseWallpaper();
                            return;
                          }

                          void patchAppSettings({ lyricsBackgroundMode: option.mode });
                        }}
                      >
                        <span>{option.label}</span>
                        {appSettings.lyricsBackgroundMode === option.mode ? <Check size={15} aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                </div>
                <input type="checkbox" checked={isBackgroundControlsOpen} onChange={(event) => setIsBackgroundControlsOpen(event.currentTarget.checked)} />
              </div>
            </div>

            <div className="lyrics-background-controls" hidden={!isBackgroundControlsOpen}>
              <p>{t('lyricsSettings.background.modeDescription')}</p>

              <label className="audio-toggle-row lyrics-background-network-cover-toggle">
                <span>
                  <ImageIcon size={17} />
                  <strong>{t('lyricsSettings.background.highResolutionCover')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={appSettings.lyricsHighResolutionNetworkCoverEnabled === true}
                  disabled={isBusy || appSettings.lyricsBackgroundMode !== 'cover'}
                  onChange={(event) => void patchAppSettings({ lyricsHighResolutionNetworkCoverEnabled: event.currentTarget.checked })}
                />
              </label>
              <p>{t('lyricsSettings.background.highResolutionCoverDescription')}</p>

              <div className={`lyrics-cover-tuning${isBackgroundTuningOpen ? ' lyrics-cover-tuning--open' : ''}`}>
                <button
                  className="lyrics-background-tuning-collapse-button"
                  type="button"
                  aria-expanded={isBackgroundTuningOpen}
                  onClick={toggleBackgroundTuning}
                >
                  <span>
                    <ImageIcon size={17} />
                    <strong>{t('lyricsSettings.background.tuning')}</strong>
                    <small>{t('lyricsSettings.background.tuningDescription')}</small>
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>

                {isBackgroundTuningOpen ? (
                  <div className="lyrics-cover-tuning-body">
                    <label className="lyrics-drawer-range">
                      <span>
                        <strong>{t('lyricsSettings.background.scale')}</strong>
                        <em>{appSettings.lyricsBackgroundScalePercent}%</em>
                      </span>
                      <input
                        type="range"
                        min={70}
                        max={180}
                        step={1}
                        value={appSettings.lyricsBackgroundScalePercent}
                        onChange={(event) => patchAppSettingsDebounced({ lyricsBackgroundScalePercent: Number(event.currentTarget.value) })}
                      />
                    </label>
                    <label className="lyrics-drawer-range">
                      <span>
                        <strong>{t('lyricsSettings.background.opacity')}</strong>
                        <em>{appSettings.lyricsCoverOpacityPercent}%</em>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={appSettings.lyricsCoverOpacityPercent}
                        onChange={(event) => patchAppSettingsDebounced({ lyricsCoverOpacityPercent: Number(event.currentTarget.value) })}
                      />
                    </label>
                    <label className="lyrics-drawer-range">
                      <span>
                        <strong>{t('lyricsSettings.background.blur')}</strong>
                        <em>{appSettings.lyricsCoverBlurPx}px</em>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={60}
                        step={1}
                        value={appSettings.lyricsCoverBlurPx}
                        onChange={(event) => patchAppSettingsDebounced({ lyricsCoverBlurPx: Number(event.currentTarget.value) })}
                      />
                    </label>
                    <label className="lyrics-drawer-range">
                      <span>
                        <strong>{t('lyricsSettings.background.brightness')}</strong>
                        <em>{appSettings.lyricsCoverBrightnessPercent}%</em>
                      </span>
                      <input
                        type="range"
                        min={40}
                        max={140}
                        step={1}
                        value={appSettings.lyricsCoverBrightnessPercent}
                        onChange={(event) => patchAppSettingsDebounced({ lyricsCoverBrightnessPercent: Number(event.currentTarget.value) })}
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="lyrics-wallpaper-actions">
                <button className="audio-device-pill" type="button" disabled={isBusy} onClick={() => void chooseWallpaper()}>
                  <Upload size={15} />
                  <span>
                    <strong>{t('lyricsSettings.background.chooseWallpaper')}</strong>
                    <small>{appSettings.lyricsCustomWallpaperPath ? t('lyricsSettings.background.wallpaperSaved') : 'JPG / PNG / WEBP'}</small>
                  </span>
                  <em>{t('lyricsSettings.action.choose')}</em>
                </button>
                {appSettings.lyricsCustomWallpaperPath ? (
                  <button
                    className="audio-device-pill"
                    type="button"
                    disabled={isBusy}
                    onClick={() => void patchAppSettings({ lyricsBackgroundMode: 'theme', lyricsCustomWallpaperPath: null })}
                  >
                    <Trash2 size={15} />
                    <span>
                      <strong>{t('lyricsSettings.background.clearWallpaper')}</strong>
                      <small>{t('lyricsSettings.background.clearWallpaperHint')}</small>
                    </span>
                    <em>Clear</em>
                  </button>
                ) : null}
              </div>
              {appSettings.lyricsCustomWallpaperPath ? (
                <p className="lyrics-wallpaper-path" title={appSettings.lyricsCustomWallpaperPath}>
                  {appSettings.lyricsCustomWallpaperPath}
                </p>
              ) : null}
            </div>
            </LyricsVisualGroup>
          </section>

          <section className="audio-drawer-section audio-drawer-options audio-drawer-options--open">
            <LyricsVisualGroup
              icon={<MonitorPlay size={17} />}
              title={t('lyricsSettings.visual.group.mv.title')}
              description={t('lyricsSettings.visual.group.mv.description')}
              isOpen={openVisualGroups.mv}
              onToggle={() => toggleVisualGroup('mv')}
            >
            <button
              type="button"
              className="mv-source-toggle mv-auto-apply-toggle"
              aria-pressed={immersiveBackground}
              onClick={() => void patchMvSettings({ immersiveBackground: !immersiveBackground })}
            >
              <span className="mv-switch-track" aria-hidden="true">
                <span />
              </span>
              <span className="mv-toggle-copy">
                <strong>{t('mvSettings.immersive.title')}</strong>
                <em>{t('mvSettings.immersive.description')}</em>
              </span>
            </button>
            <button
              type="button"
              className="mv-source-toggle mv-auto-apply-toggle"
              aria-pressed={mvSettings.hideLyrics === true}
              onClick={() => void patchMvSettings({ hideLyrics: mvSettings.hideLyrics !== true })}
            >
              <span className="mv-switch-track" aria-hidden="true">
                <span />
              </span>
              <span className="mv-toggle-copy">
                <strong>{t('mvSettings.immersive.hideLyrics')}</strong>
                <em>{t('mvSettings.immersive.hideLyricsDescription')}</em>
              </span>
            </button>

            {immersiveBackground ? (
              <div className={`mv-immersive-controls${isMvImmersiveControlsOpen ? ' mv-immersive-controls--open' : ''}`}>
                <button
                  type="button"
                  className="mv-immersive-collapse"
                  aria-expanded={isMvImmersiveControlsOpen}
                  onClick={toggleMvImmersiveControls}
                >
                  <span>
                    <MonitorPlay size={15} />
                    <strong>{t('mvSettings.immersive.tuning')}</strong>
                    <em>{t('mvSettings.immersive.visualHint')}</em>
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>

                {isMvImmersiveControlsOpen ? (
                  <div className="mv-immersive-controls-body">
                    <button
                      type="button"
                      className="mv-immersive-reset"
                      onClick={() => void patchMvSettings(mvImmersiveBackgroundDefaults)}
                    >
                      <RotateCcw size={15} />
                      {t('mvSettings.immersive.reset')}
                    </button>
                    <button
                      type="button"
                      className="mv-source-toggle mv-auto-apply-toggle"
                      aria-pressed={mvSettings.immersiveBackgroundAutoScale !== false}
                      onClick={() => void patchMvSettings({ immersiveBackgroundAutoScale: mvSettings.immersiveBackgroundAutoScale === false })}
                    >
                      <span className="mv-switch-track" aria-hidden="true">
                        <span />
                      </span>
                      <span className="mv-toggle-copy">
                        <strong>{t('mvSettings.immersive.autoScale')}</strong>
                        <em>{t('mvSettings.immersive.autoScaleDescription')}</em>
                      </span>
                    </button>
                    <label className="mv-threshold-control">
                      <span className="mv-threshold-copy">
                        <strong>{t('mvSettings.immersive.zoom')}</strong>
                        <em>{mvSettings.immersiveBackgroundScalePercent ?? 115}%</em>
                      </span>
                      <span className="mv-threshold-slider">
                        <input
                          type="range"
                          min="70"
                          max="220"
                          step="1"
                          value={mvSettings.immersiveBackgroundScalePercent ?? 115}
                          aria-label={t('mvSettings.immersive.zoom')}
                          onChange={(event) => void patchMvSettings({ immersiveBackgroundScalePercent: Number(event.currentTarget.value) })}
                        />
                        <strong>{mvSettings.immersiveBackgroundScalePercent ?? 115}%</strong>
                      </span>
                    </label>
                    <label className="mv-threshold-control">
                      <span className="mv-threshold-copy">
                        <strong>{t('mvSettings.immersive.blur')}</strong>
                        <em>{t('mvSettings.immersive.visualHint')}</em>
                      </span>
                      <span className="mv-threshold-slider">
                        <input
                          type="range"
                          min="0"
                          max="32"
                          step="1"
                          value={mvSettings.immersiveBackgroundBlurPx ?? 0}
                          aria-label={t('mvSettings.immersive.blur')}
                          onChange={(event) => void patchMvSettings({ immersiveBackgroundBlurPx: Number(event.currentTarget.value) })}
                        />
                        <strong>{mvSettings.immersiveBackgroundBlurPx ?? 0}px</strong>
                      </span>
                    </label>
                    <label className="mv-threshold-control">
                      <span className="mv-threshold-copy">
                        <strong>{t('mvSettings.immersive.brightness')}</strong>
                        <em>{t('mvSettings.immersive.visualHint')}</em>
                      </span>
                      <span className="mv-threshold-slider">
                        <input
                          type="range"
                          min="60"
                          max="140"
                          step="1"
                          value={mvSettings.immersiveBackgroundBrightnessPercent ?? 100}
                          aria-label={t('mvSettings.immersive.brightness')}
                          onChange={(event) => void patchMvSettings({ immersiveBackgroundBrightnessPercent: Number(event.currentTarget.value) })}
                        />
                        <strong>{mvSettings.immersiveBackgroundBrightnessPercent ?? 100}%</strong>
                      </span>
                    </label>
                    <label className="mv-threshold-control">
                      <span className="mv-threshold-copy">
                        <strong>{t('mvSettings.immersive.overlay')}</strong>
                        <em>{t('mvSettings.immersive.overlayHint')}</em>
                      </span>
                      <span className="mv-threshold-slider">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={mvSettings.immersiveBackgroundOverlayOpacityPercent ?? 0}
                          aria-label={t('mvSettings.immersive.overlay')}
                          onChange={(event) => void patchMvSettings({ immersiveBackgroundOverlayOpacityPercent: Number(event.currentTarget.value) })}
                        />
                        <strong>{mvSettings.immersiveBackgroundOverlayOpacityPercent ?? 0}%</strong>
                      </span>
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}
            </LyricsVisualGroup>
          </section>

          {isFontPickerOpen ? (
            <LyricsFontPickerModal
              currentFont={lyricsFontFamily}
              fonts={fontFamilies}
              isBusy={isBusy}
              onChooseFile={() => void chooseFontFileForLyrics()}
              onClose={() => setIsFontPickerOpen(false)}
              onSelect={applySelectedFontFamily}
              query={fontPickerQuery}
              setQuery={setFontPickerQuery}
            />
          ) : null}

          {error ? <p className="audio-drawer-error">{error}</p> : null}
        </div>
      </aside>
    </div>
  );
};
