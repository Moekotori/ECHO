import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, FolderOpen, Gauge, Gift, HardDrive, Headphones, Languages, Loader2, LogIn, Palette, ScanLine, Sparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioOutputMode } from '../../../shared/types/audio';
import type { AppSettings, AppThemeMode, AppThemePreset, ScanPerformanceMode } from '../../../shared/types/appSettings';
import { detectRendererPlatform, isAdvancedNativeOutputPlatform, isNativeSharedOutputPlatform } from '../../../shared/utils/audioPlatformCapabilities';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { localeOptions } from '../../i18n/locales';
import type { Locale, TranslationKey } from '../../i18n/locales';
import { updateThemePreferences } from '../../preferences/themePreferences';
import { rememberLibraryScanStatus } from '../../stores/libraryScanSession';

type FirstRunWizardProps = {
  initialSettings: AppSettings | null;
  onClose: () => void;
  onCompleted: (settings: AppSettings | null) => void;
  presentationState?: 'open' | 'closing';
};

type FirstRunStepId = 'language' | 'library' | 'cache' | 'scan' | 'audio' | 'performance' | 'appearance' | 'accounts' | 'summary';

type FirstRunStep = {
  id: FirstRunStepId;
  labelKey: TranslationKey;
  eyebrowKey?: TranslationKey;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
};

const echoDocumentationUrl = 'https://echonext.moe/zh/docs/';
const echoSponsorUrl = 'https://afdian.com/a/echonext';

type FirstRunOption<T extends string> = {
  mode: T;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  hintKey: TranslationKey;
};

type FirstRunFeatureToggleId = 'lowLoadPlayback' | 'albumWallVirtualization' | 'osuDownloader' | 'nativeDirectLocalPlayback';

type FirstRunFeatureToggle = {
  id: FirstRunFeatureToggleId;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  hintKey: TranslationKey;
};

const scanModes: Array<FirstRunOption<ScanPerformanceMode>> = [
  { mode: 'balanced', labelKey: 'firstRun.scan.balanced.label', descriptionKey: 'firstRun.scan.balanced.description', hintKey: 'firstRun.scan.balanced.hint' },
  { mode: 'low', labelKey: 'firstRun.scan.low.label', descriptionKey: 'firstRun.scan.low.description', hintKey: 'firstRun.scan.low.hint' },
  { mode: 'performance', labelKey: 'firstRun.scan.performance.label', descriptionKey: 'firstRun.scan.performance.description', hintKey: 'firstRun.scan.performance.hint' },
];

const outputModes: Array<FirstRunOption<AudioOutputMode>> = [
  { mode: 'shared', labelKey: 'firstRun.audio.shared.label', descriptionKey: 'firstRun.audio.shared.description', hintKey: 'firstRun.audio.shared.hint' },
  { mode: 'system', labelKey: 'firstRun.audio.system.label', descriptionKey: 'firstRun.audio.system.description', hintKey: 'firstRun.audio.system.hint' },
  { mode: 'exclusive', labelKey: 'firstRun.audio.exclusive.label', descriptionKey: 'firstRun.audio.exclusive.description', hintKey: 'firstRun.audio.exclusive.hint' },
];

const themeModes: Array<FirstRunOption<AppThemeMode>> = [
  { mode: 'light', labelKey: 'settings.appearance.theme.light', descriptionKey: 'firstRun.theme.light.description', hintKey: 'firstRun.theme.light.hint' },
  { mode: 'dark', labelKey: 'settings.appearance.theme.dark', descriptionKey: 'firstRun.theme.dark.description', hintKey: 'firstRun.theme.dark.hint' },
  { mode: 'system', labelKey: 'settings.appearance.theme.followSystem', descriptionKey: 'firstRun.theme.system.description', hintKey: 'firstRun.theme.system.hint' },
  { mode: 'ambient', labelKey: 'settings.appearance.theme.ambient', descriptionKey: 'firstRun.theme.ambient.description', hintKey: 'firstRun.theme.ambient.hint' },
];

const themePresets: Array<{ preset: AppThemePreset; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { preset: 'classic', labelKey: 'settings.appearance.themePreset.classic', descriptionKey: 'settings.appearance.themePreset.classic.description' },
  { preset: 'sakuraMilk', labelKey: 'settings.appearance.themePreset.sakuraMilk', descriptionKey: 'settings.appearance.themePreset.sakuraMilk.description' },
  { preset: 'mintCandy', labelKey: 'settings.appearance.themePreset.mintCandy', descriptionKey: 'settings.appearance.themePreset.mintCandy.description' },
  { preset: 'echoTwilight', labelKey: 'settings.appearance.themePreset.echoTwilight', descriptionKey: 'settings.appearance.themePreset.echoTwilight.description' },
  { preset: 'graphiteAurora', labelKey: 'settings.appearance.themePreset.graphiteAurora', descriptionKey: 'settings.appearance.themePreset.graphiteAurora.description' },
  { preset: 'darkSideMoon', labelKey: 'settings.appearance.themePreset.darkSideMoon', descriptionKey: 'settings.appearance.themePreset.darkSideMoon.description' },
];

const featureToggles: FirstRunFeatureToggle[] = [
  {
    id: 'lowLoadPlayback',
    labelKey: 'firstRun.feature.lowLoad.label',
    descriptionKey: 'firstRun.feature.lowLoad.description',
    hintKey: 'firstRun.feature.lowLoad.hint',
  },
  {
    id: 'albumWallVirtualization',
    labelKey: 'firstRun.feature.albumWall.label',
    descriptionKey: 'firstRun.feature.albumWall.description',
    hintKey: 'firstRun.feature.albumWall.hint',
  },
  {
    id: 'osuDownloader',
    labelKey: 'firstRun.feature.osuDownloader.label',
    descriptionKey: 'firstRun.feature.osuDownloader.description',
    hintKey: 'firstRun.feature.osuDownloader.hint',
  },
  {
    id: 'nativeDirectLocalPlayback',
    labelKey: 'firstRun.feature.localDirect.label',
    descriptionKey: 'firstRun.feature.localDirect.description',
    hintKey: 'firstRun.feature.localDirect.hint',
  },
];

const detectFirstRunPlatform = (): NodeJS.Platform | 'unknown' =>
  typeof window !== 'undefined' ? detectRendererPlatform(window.navigator) : 'unknown';

const getSupportedFirstRunOutputModes = (
  platform: NodeJS.Platform | 'unknown',
): Array<FirstRunOption<AudioOutputMode>> =>
  outputModes
    .filter((item) => {
      if (item.mode === 'system') {
        return true;
      }

      if (item.mode === 'shared') {
        return isNativeSharedOutputPlatform(platform);
      }

      return isAdvancedNativeOutputPlatform(platform);
    })
    .map((item) =>
      platform === 'linux' && item.mode === 'shared'
        ? {
            ...item,
            labelKey: 'firstRun.audio.linuxShared.label',
            descriptionKey: 'firstRun.audio.linuxShared.description',
            hintKey: 'firstRun.audio.linuxShared.hint',
          }
        : item,
    );

const firstRunSteps: FirstRunStep[] = [
  {
    id: 'language',
    labelKey: 'firstRun.step.language.label',
    eyebrowKey: 'firstRun.step.language.eyebrow',
    titleKey: 'firstRun.step.language.title',
    descriptionKey: 'firstRun.step.language.description',
    icon: Languages,
  },
  {
    id: 'library',
    labelKey: 'firstRun.step.library.label',
    eyebrowKey: 'firstRun.step.library.eyebrow',
    titleKey: 'firstRun.step.library.title',
    descriptionKey: 'firstRun.step.library.description',
    icon: FolderOpen,
  },
  {
    id: 'cache',
    labelKey: 'firstRun.step.cache.label',
    eyebrowKey: 'firstRun.step.cache.eyebrow',
    titleKey: 'firstRun.step.cache.title',
    descriptionKey: 'firstRun.step.cache.description',
    icon: HardDrive,
  },
  {
    id: 'scan',
    labelKey: 'firstRun.step.scan.label',
    eyebrowKey: 'firstRun.step.scan.eyebrow',
    titleKey: 'firstRun.step.scan.title',
    descriptionKey: 'firstRun.step.scan.description',
    icon: ScanLine,
  },
  {
    id: 'audio',
    labelKey: 'firstRun.step.audio.label',
    eyebrowKey: 'firstRun.step.audio.eyebrow',
    titleKey: 'firstRun.step.audio.title',
    descriptionKey: 'firstRun.step.audio.description',
    icon: Headphones,
  },
  {
    id: 'performance',
    labelKey: 'firstRun.step.performance.label',
    titleKey: 'firstRun.step.performance.title',
    descriptionKey: 'firstRun.step.performance.description',
    icon: Gauge,
  },
  {
    id: 'appearance',
    labelKey: 'firstRun.step.appearance.label',
    eyebrowKey: 'firstRun.step.appearance.eyebrow',
    titleKey: 'firstRun.step.appearance.title',
    descriptionKey: 'firstRun.step.appearance.description',
    icon: Palette,
  },
  {
    id: 'accounts',
    labelKey: 'firstRun.step.accounts.label',
    eyebrowKey: 'firstRun.step.accounts.eyebrow',
    titleKey: 'firstRun.step.accounts.title',
    descriptionKey: 'firstRun.step.accounts.description',
    icon: LogIn,
  },
  {
    id: 'summary',
    labelKey: 'firstRun.step.summary.label',
    eyebrowKey: 'firstRun.step.summary.eyebrow',
    titleKey: 'firstRun.step.summary.title',
    descriptionKey: 'firstRun.step.summary.description',
    icon: CheckCircle2,
  },
];

const firstRunStepNotes: Record<FirstRunStepId, TranslationKey[]> = {
  language: ['firstRun.detail.language.applyNow', 'firstRun.detail.language.changeLater'],
  library: ['firstRun.detail.library.safe', 'firstRun.detail.library.scan'],
  cache: ['firstRun.detail.cache.space', 'firstRun.detail.cache.changeLater'],
  scan: ['firstRun.detail.scan.balanced', 'firstRun.detail.scan.low'],
  audio: ['firstRun.detail.audio.shared', 'firstRun.detail.audio.advanced'],
  performance: ['firstRun.detail.performance.optional', 'firstRun.detail.performance.changeLater'],
  appearance: ['firstRun.detail.appearance.preview', 'firstRun.detail.appearance.system'],
  accounts: ['firstRun.detail.accounts.later', 'firstRun.detail.accounts.local'],
  summary: ['firstRun.detail.summary.save', 'firstRun.detail.summary.docs'],
};

export const FirstRunWizard = ({ initialSettings, onClose, onCompleted, presentationState = 'open' }: FirstRunWizardProps): JSX.Element => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? translateFallback;
  const activeLocale = i18n?.locale ?? (initialSettings?.locale as Locale | undefined) ?? 'zh-CN';
  const setLocale = i18n?.setLocale;
  const [rendererPlatform] = useState<NodeJS.Platform | 'unknown'>(() => detectFirstRunPlatform());
  const firstRunOutputModes = useMemo(() => getSupportedFirstRunOutputModes(rendererPlatform), [rendererPlatform]);
  const [activeStepId, setActiveStepId] = useState<FirstRunStepId>('language');
  const [musicFolderPath, setMusicFolderPath] = useState<string | null>(null);
  const [cacheDirectory, setCacheDirectory] = useState<string | null | undefined>(undefined);
  const [scanMode, setScanMode] = useState<ScanPerformanceMode>(initialSettings?.scanPerformanceMode ?? 'balanced');
  const [appearanceTheme, setAppearanceTheme] = useState<AppThemeMode>(initialSettings?.appearanceTheme ?? 'light');
  const [appearanceThemePreset, setAppearanceThemePreset] = useState<AppThemePreset>(initialSettings?.appearanceThemePreset ?? 'classic');
  const [lowLoadPlaybackModeEnabled, setLowLoadPlaybackModeEnabled] = useState(initialSettings?.lowLoadPlaybackModeEnabled === true);
  const [albumWallVirtualizationEnabled, setAlbumWallVirtualizationEnabled] = useState(initialSettings?.albumWallVirtualizationEnabled === true);
  const [osuDownloaderFeatureEnabled, setOsuDownloaderFeatureEnabled] = useState(initialSettings?.osuDownloaderFeatureEnabled === true);
  const [nativeDirectLocalPlaybackEnabled, setNativeDirectLocalPlaybackEnabled] = useState(initialSettings?.audioNativeDirectLocalPlaybackEnabled === true);
  const [outputMode, setOutputMode] = useState<AudioOutputMode>(() => {
    const supportedModes = getSupportedFirstRunOutputModes(rendererPlatform);
    const fallbackMode = supportedModes.some((item) => item.mode === 'shared') ? 'shared' : 'system';
    const rememberedMode = initialSettings?.rememberedAudioOutput?.outputMode ?? fallbackMode;
    return supportedModes.some((item) => item.mode === rememberedMode) ? rememberedMode : fallbackMode;
  });
  const [scanNow, setScanNow] = useState(true);
  const [busy, setBusy] = useState<'folder' | 'cache' | 'finish' | 'skip' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeStepIndex = Math.max(0, firstRunSteps.findIndex((step) => step.id === activeStepId));
  const activeStep = firstRunSteps[activeStepIndex] ?? firstRunSteps[0]!;
  const ActiveIcon = activeStep.icon;
  const isFinalStep = activeStep.id === 'summary';
  const progressPercent = ((activeStepIndex + 1) / firstRunSteps.length) * 100;
  const progressPercentLabel = `${Math.round(progressPercent)}%`;
  const stepNumberLabel = `${activeStepIndex + 1} / ${firstRunSteps.length}`;
  const activeStepNotes = firstRunStepNotes[activeStep.id];

  const cacheDirectoryLabel = useMemo(() => {
    if (cacheDirectory === undefined) {
      return initialSettings?.coverCacheDir ?? t('firstRun.defaultLocation');
    }
    return cacheDirectory ?? t('firstRun.defaultLocation');
  }, [cacheDirectory, initialSettings?.coverCacheDir, t]);

  const scanModeLabel = t(scanModes.find((item) => item.mode === scanMode)?.labelKey ?? 'firstRun.scan.balanced.label');
  const outputModeLabel = t(firstRunOutputModes.find((item) => item.mode === outputMode)?.labelKey ?? 'firstRun.audio.system.label');
  const appearanceThemeLabel = t(themeModes.find((item) => item.mode === appearanceTheme)?.labelKey ?? 'settings.appearance.theme.light');
  const ambientThemeSelected = appearanceTheme === 'ambient';
  const effectiveAppearanceThemePreset = ambientThemeSelected ? 'classic' : appearanceThemePreset;
  const appearancePresetLabel = ambientThemeSelected
    ? t('settings.appearance.theme.ambient')
    : t(themePresets.find((item) => item.preset === appearanceThemePreset)?.labelKey ?? 'settings.appearance.themePreset.classic');
  const featureEnabledById: Record<FirstRunFeatureToggleId, boolean> = {
    lowLoadPlayback: lowLoadPlaybackModeEnabled,
    albumWallVirtualization: albumWallVirtualizationEnabled,
    osuDownloader: osuDownloaderFeatureEnabled,
    nativeDirectLocalPlayback: nativeDirectLocalPlaybackEnabled,
  };
  const enabledFeatureLabels = featureToggles
    .filter((item) => featureEnabledById[item.id])
    .map((item) => t(item.labelKey));
  const featureSummaryLabel = enabledFeatureLabels.length ? enabledFeatureLabels.join(', ') : t('firstRun.summary.featuresDefault');

  const setFeatureToggleEnabled = (id: FirstRunFeatureToggleId, enabled: boolean): void => {
    switch (id) {
      case 'lowLoadPlayback':
        setLowLoadPlaybackModeEnabled(enabled);
        return;
      case 'albumWallVirtualization':
        setAlbumWallVirtualizationEnabled(enabled);
        return;
      case 'osuDownloader':
        setOsuDownloaderFeatureEnabled(enabled);
        return;
      case 'nativeDirectLocalPlayback':
        setNativeDirectLocalPlaybackEnabled(enabled);
        return;
      default:
        return;
    }
  };

  const chooseMusicFolder = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.chooseFolder) {
      setError(t('firstRun.error.desktopBridgeMusicFolder'));
      return;
    }

    try {
      setBusy('folder');
      setError(null);
      const chosen = await library.chooseFolder();
      if (chosen) {
        setMusicFolderPath(chosen);
      }
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const chooseCacheDirectory = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.chooseCacheDirectory) {
      setError(t('firstRun.error.desktopBridgeCache'));
      return;
    }

    try {
      setBusy('cache');
      setError(null);
      const chosen = await app.chooseCacheDirectory();
      if (chosen) {
        setCacheDirectory(chosen);
      }
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const skip = useCallback(async (): Promise<void> => {
    try {
      setBusy('skip');
      setError(null);
      const settings = await window.echo?.app?.setSettings?.({ onboardingCompleted: true });
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: settings ?? { onboardingCompleted: true } }));
      onCompleted(settings ?? null);
      onClose();
    } catch (skipError) {
      setError(skipError instanceof Error ? skipError.message : String(skipError));
    } finally {
      setBusy(null);
    }
  }, [onClose, onCompleted]);

  const finish = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    const library = window.echo?.library;

    if (!app?.setSettings) {
      setError(t('firstRun.error.desktopBridgeSave'));
      return;
    }

    try {
      setBusy('finish');
      setError(null);
      setMessage(null);

      if (cacheDirectory !== undefined && app.setCoverCacheDirectory) {
        await app.setCoverCacheDirectory({ directory: cacheDirectory, migrate: false });
      }

      const currentSettings = await app.getSettings().catch(() => initialSettings);
      const rememberedAudioOutput = {
        ...(currentSettings?.rememberedAudioOutput ?? initialSettings?.rememberedAudioOutput),
        enabled: true,
        outputMode,
      };
      const nextSettings = await app.setSettings({
        onboardingCompleted: true,
        appearanceTheme,
        appearanceThemeCustomId: null,
        appearanceThemePreset: effectiveAppearanceThemePreset,
        scanPerformanceMode: scanMode,
        lowLoadPlaybackModeEnabled,
        albumWallVirtualizationEnabled,
        osuDownloaderFeatureEnabled,
        audioNativeDirectLocalPlaybackEnabled: nativeDirectLocalPlaybackEnabled,
        rememberedAudioOutput,
      });
      updateThemePreferences(appearanceTheme, effectiveAppearanceThemePreset, nextSettings.appearanceThemePresetOverrides ?? {}, {
        animate: true,
        customThemeId: null,
        customThemes: nextSettings.appearanceCustomThemes ?? [],
      });

      await window.echo?.audio?.setOutput?.({ outputMode, nativeDirectLocalPlaybackEnabled }).catch(() => undefined);

      if (musicFolderPath && library?.addFolder) {
        const folder = await library.addFolder(musicFolderPath);
        if (scanNow && library.scanFolder) {
          rememberLibraryScanStatus(await library.scanFolder(folder.id));
        }
        window.dispatchEvent(new Event('library:changed'));
      }

      window.dispatchEvent(new CustomEvent('settings:changed', { detail: nextSettings }));
      setMessage(t('firstRun.message.saved'));
      onCompleted(nextSettings);
      onClose();
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : String(finishError));
    } finally {
      setBusy(null);
    }
  }, [
    albumWallVirtualizationEnabled,
    appearanceTheme,
    cacheDirectory,
    effectiveAppearanceThemePreset,
    initialSettings,
    lowLoadPlaybackModeEnabled,
    musicFolderPath,
    nativeDirectLocalPlaybackEnabled,
    onClose,
    onCompleted,
    osuDownloaderFeatureEnabled,
    outputMode,
    scanMode,
    scanNow,
    t,
  ]);

  const openExternalUrl = useCallback((url: string): void => {
    const openExternalUrl = window.echo?.app?.openExternalUrl;
    if (openExternalUrl) {
      void openExternalUrl(url).catch(() => {
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const openDocumentation = useCallback((): void => openExternalUrl(echoDocumentationUrl), [openExternalUrl]);
  const openSponsorChannel = useCallback((): void => openExternalUrl(echoSponsorUrl), [openExternalUrl]);

  const goToPreviousStep = (): void => {
    setActiveStepId(firstRunSteps[Math.max(0, activeStepIndex - 1)]!.id);
  };

  const goToNextStep = (): void => {
    setActiveStepId(firstRunSteps[Math.min(firstRunSteps.length - 1, activeStepIndex + 1)]!.id);
  };

  const renderStepBody = (): JSX.Element => {
    switch (activeStep.id) {
      case 'language':
        return (
          <div className="first-run-options first-run-options--cards first-run-options--compact first-run-language-options">
            {localeOptions.map((option) => (
              <button
                className={activeLocale === option.locale ? 'is-active' : undefined}
                key={option.locale}
                type="button"
                aria-pressed={activeLocale === option.locale}
                onClick={() => setLocale?.(option.locale)}
              >
                <strong>{option.label}</strong>
                <span>{t(`firstRun.language.${option.locale}.description` as TranslationKey)}</span>
                <em>{activeLocale === option.locale ? t('firstRun.language.current') : t('firstRun.language.choose')}</em>
              </button>
            ))}
          </div>
        );
      case 'library':
        return (
          <div className="first-run-control-panel">
            <p className="first-run-selection-label">{t('firstRun.currentSelection')}</p>
            <div className="first-run-path-preview">{musicFolderPath ?? t('firstRun.library.noneSelected')}</div>
            <div className="settings-chip-row settings-chip-row--left">
              <button className="settings-action-button" type="button" disabled={busy !== null} onClick={() => void chooseMusicFolder()}>
                {busy === 'folder' ? <Loader2 className="spinning-icon" size={15} /> : <FolderOpen size={15} />}
                {t('firstRun.library.chooseFolder')}
              </button>
              <label className="first-run-scan-toggle">
                <input type="checkbox" checked={scanNow} onChange={(event) => setScanNow(event.target.checked)} />
                <span className="first-run-scan-switch" aria-hidden="true" />
                <span>{t('firstRun.library.scanAfterFinish')}</span>
              </label>
            </div>
          </div>
        );
      case 'cache':
        return (
          <div className="first-run-control-panel">
            <p className="first-run-selection-label">{t('firstRun.currentSelection')}</p>
            <div className="first-run-path-preview">{cacheDirectoryLabel}</div>
            <div className="settings-chip-row settings-chip-row--left">
              <button className="settings-action-button" type="button" disabled={busy !== null} onClick={() => void chooseCacheDirectory()}>
                {busy === 'cache' ? <Loader2 className="spinning-icon" size={15} /> : <HardDrive size={15} />}
                {t('firstRun.cache.chooseLocation')}
              </button>
              <button className="settings-action-button" type="button" disabled={busy !== null} onClick={() => setCacheDirectory(null)}>
                {t('firstRun.cache.useDefault')}
              </button>
            </div>
          </div>
        );
      case 'scan':
        return (
          <div className="first-run-options first-run-options--cards">
            {scanModes.map((item) => (
              <button
                className={scanMode === item.mode ? 'is-active' : undefined}
                key={item.mode}
                type="button"
                aria-pressed={scanMode === item.mode}
                onClick={() => setScanMode(item.mode)}
              >
                <strong>{t(item.labelKey)}</strong>
                <span>{t(item.descriptionKey)}</span>
                <em>{t(item.hintKey)}</em>
              </button>
            ))}
          </div>
        );
      case 'audio':
        return (
          <div className="first-run-options first-run-options--cards first-run-options--compact">
            {firstRunOutputModes.map((item) => (
              <button
                className={outputMode === item.mode ? 'is-active' : undefined}
                key={item.mode}
                type="button"
                aria-pressed={outputMode === item.mode}
                onClick={() => setOutputMode(item.mode)}
              >
                <strong>{t(item.labelKey)}</strong>
                <span>{t(item.descriptionKey)}</span>
                <em>{t(item.hintKey)}</em>
              </button>
            ))}
          </div>
        );
      case 'performance':
        return (
          <div className="first-run-options first-run-options--cards first-run-options--compact">
            {featureToggles.map((item) => {
              const enabled = featureEnabledById[item.id];
              return (
                <button
                  className={enabled ? 'is-active' : undefined}
                  key={item.id}
                  type="button"
                  aria-pressed={enabled}
                  onClick={() => setFeatureToggleEnabled(item.id, !enabled)}
                >
                  <strong>{t(item.labelKey)}</strong>
                  <span>{t(item.descriptionKey)}</span>
                  <em>{enabled ? t('firstRun.feature.enabled') : t(item.hintKey)}</em>
                </button>
              );
            })}
          </div>
        );
      case 'appearance':
        return (
          <div className="first-run-appearance-guide">
            <div>
              <p className="first-run-selection-label">{t('firstRun.theme.modeTitle')}</p>
              <div className="first-run-options first-run-options--cards first-run-options--compact">
                {themeModes.map((item) => (
                  <button
                    className={appearanceTheme === item.mode ? 'is-active' : undefined}
                    key={item.mode}
                    type="button"
                    aria-pressed={appearanceTheme === item.mode}
                    onClick={() => setAppearanceTheme(item.mode)}
                  >
                    <strong>{t(item.labelKey)}</strong>
                    <span>{t(item.descriptionKey)}</span>
                    <em>{t(item.hintKey)}</em>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="first-run-selection-label">{t('firstRun.theme.presetTitle')}</p>
              {ambientThemeSelected ? <p className="settings-inline-note">{t('settings.appearance.themePreset.ambientLocked')}</p> : null}
              <div className="first-run-theme-presets">
                {themePresets.map((item) => (
                  <button
                    className={!ambientThemeSelected && appearanceThemePreset === item.preset ? 'is-active' : undefined}
                    disabled={ambientThemeSelected}
                    key={item.preset}
                    type="button"
                    aria-disabled={ambientThemeSelected}
                    aria-pressed={!ambientThemeSelected && appearanceThemePreset === item.preset}
                    title={ambientThemeSelected ? t('settings.appearance.themePreset.ambientLocked') : undefined}
                    onClick={() => setAppearanceThemePreset(item.preset)}
                  >
                    <span className="first-run-theme-swatch" data-preset={item.preset} aria-hidden="true" />
                    <strong>{t(item.labelKey)}</strong>
                    <span>{t(item.descriptionKey)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      case 'accounts':
        return (
          <div className="first-run-account-guide">
            <ol>
              <li>
                <strong>{t('firstRun.accounts.open.title')}</strong>
                <span>{t('firstRun.accounts.open.description')}</span>
              </li>
              <li>
                <strong>{t('firstRun.accounts.login.title')}</strong>
                <span>{t('firstRun.accounts.login.description')}</span>
              </li>
              <li>
                <strong>{t('firstRun.accounts.cookie.title')}</strong>
                <span>{t('firstRun.accounts.cookie.description')}</span>
              </li>
              <li>
                <strong>{t('firstRun.accounts.spotify.title')}</strong>
                <span>{t('firstRun.accounts.spotify.description')}</span>
              </li>
            </ol>
            <p>{t('firstRun.accounts.note')}</p>
          </div>
        );
      case 'summary':
        return (
          <div className="first-run-summary-stack">
            <div className="first-run-final-card">
              <Sparkles size={24} aria-hidden="true" />
              <div>
                <h3>{t('firstRun.summary.readyTitle')}</h3>
                <p>{t('firstRun.summary.readyDescription')}</p>
              </div>
            </div>
            <div className="first-run-pro-card">
              <div className="first-run-pro-heading">
                <Gift size={22} aria-hidden="true" />
                <div>
                  <span>{t('firstRun.pro.kicker')}</span>
                  <h3>{t('firstRun.pro.title')}</h3>
                </div>
              </div>
              <p>{t('firstRun.pro.description')}</p>
              <p>{t('firstRun.pro.freeNotice')}</p>
              <p>{t('firstRun.pro.contributors')}</p>
              <strong>{t('firstRun.pro.benefitsTitle')}</strong>
              <ul>
                <li>{t('firstRun.pro.benefit.connect')}</li>
                <li>{t('firstRun.pro.benefit.mobile')}</li>
                <li>{t('firstRun.pro.benefit.themes')}</li>
                <li>{t('firstRun.pro.benefit.plugins')}</li>
                <li>{t('firstRun.pro.benefit.donators')}</li>
                <li>{t('firstRun.pro.benefit.network')}</li>
                <li>{t('firstRun.pro.benefit.storeKey')}</li>
              </ul>
              <button className="settings-action-button" type="button" onClick={openSponsorChannel}>
                <Gift size={15} />
                {t('firstRun.pro.action')}
              </button>
            </div>
          </div>
        );
      default:
        return <div />;
    }
  };

  return (
    <div className="first-run-backdrop" data-state={presentationState} role="dialog" aria-modal="true" aria-labelledby="first-run-title" aria-describedby="first-run-description">
      <section className="first-run-panel">
        <header className="first-run-header">
          <div className="first-run-heading">
            <span className="section-kicker">ECHO Next</span>
            <h2 id="first-run-title">{t('firstRun.title')}</h2>
            <p id="first-run-description">{t('firstRun.description')}</p>
            <button className="first-run-doc-button" type="button" onClick={openDocumentation}>
              <BookOpen size={15} />
              <span>{t('firstRun.docs.action')}</span>
              <ArrowRight size={14} />
            </button>
          </div>
          <button className="queue-icon-button" type="button" aria-label={t('firstRun.action.skipWizard')} title={t('firstRun.action.skipWizard')} disabled={busy !== null} onClick={() => void skip()}>
            <X size={17} />
          </button>
        </header>

        <div className="first-run-progress-shell" aria-hidden="true">
          <div className="first-run-progress-meta">
            <span>{stepNumberLabel} &middot; {progressPercentLabel}</span>
            <strong>{t(activeStep.labelKey)}</strong>
          </div>
          <div className="first-run-progress">
            <span style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        <nav className="first-run-stepper" aria-label={t('firstRun.aria.steps')}>
          {firstRunSteps.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = step.id === activeStep.id;
            const isDone = index < activeStepIndex;
            return (
              <button
                className={`${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`.trim()}
                key={step.id}
                type="button"
                aria-current={isActive ? 'step' : undefined}
                disabled={busy !== null}
                onClick={() => setActiveStepId(step.id)}
              >
                <span>{isDone ? <CheckCircle2 size={14} /> : <StepIcon size={14} />}</span>
                {t(step.labelKey)}
              </button>
            );
          })}
        </nav>

        <div className="first-run-layout">
          <main className="first-run-stage" data-step={activeStep.id} key={activeStep.id}>
            <div className="first-run-stage-icon">
              <ActiveIcon size={26} />
            </div>
            <div className="first-run-stage-copy">
              <span>{stepNumberLabel}</span>
              <h3>{t(activeStep.titleKey)}</h3>
              <p>{t(activeStep.descriptionKey)}</p>
              <div className="first-run-step-notes" aria-label={t('firstRun.aria.stepNotes')}>
                {activeStepNotes.map((noteKey) => (
                  <span key={noteKey}>
                    <CheckCircle2 size={12} />
                    {t(noteKey)}
                  </span>
                ))}
              </div>
            </div>
            {renderStepBody()}
          </main>

          <aside className="first-run-summary" aria-label={t('firstRun.aria.summary')}>
            <span className="first-run-summary-kicker">{t('firstRun.summary.kicker')}</span>
            <div className="first-run-summary-current">
              <span>{stepNumberLabel}</span>
              <strong>{t(activeStep.titleKey)}</strong>
              <em>{progressPercentLabel}</em>
            </div>
            <dl>
              <div>
                <dt>{t('firstRun.summary.music')}</dt>
                <dd>{musicFolderPath ?? t('firstRun.summary.addLater')}</dd>
              </div>
              <div>
                <dt>{t('firstRun.summary.scan')}</dt>
                <dd>{scanNow && musicFolderPath ? t('firstRun.summary.scanWithFolder', { mode: scanModeLabel }) : scanModeLabel}</dd>
              </div>
              <div>
                <dt>{t('firstRun.summary.cache')}</dt>
                <dd>{cacheDirectoryLabel}</dd>
              </div>
              <div>
                <dt>{t('firstRun.summary.output')}</dt>
                <dd>{outputModeLabel}</dd>
              </div>
              <div>
                <dt>{t('firstRun.summary.features')}</dt>
                <dd>{featureSummaryLabel}</dd>
              </div>
              <div>
                <dt>{t('firstRun.summary.theme')}</dt>
                <dd>{t('firstRun.summary.themeValue', { mode: appearanceThemeLabel, preset: appearancePresetLabel })}</dd>
              </div>
              <div>
                <dt>{t('firstRun.summary.accounts')}</dt>
                <dd>{t('firstRun.summary.accountsLater')}</dd>
              </div>
            </dl>
            <p>{t('firstRun.summary.noFileMove')}</p>
            <button className="first-run-doc-card" type="button" title={t('firstRun.docs.description')} onClick={openDocumentation}>
              <BookOpen size={16} />
              <span>
                <strong>{t('firstRun.docs.title')}</strong>
              </span>
              <ArrowRight size={15} />
            </button>
          </aside>
        </div>

        {error ? <p className="settings-inline-error">{error}</p> : null}
        {message ? <p className="settings-inline-note">{message}</p> : null}

        <footer className="first-run-actions">
          <button className="settings-action-button" type="button" disabled={busy !== null} onClick={() => void skip()}>
            {t('firstRun.action.skip')}
          </button>
          <div className="first-run-action-cluster">
            <button className="settings-action-button" type="button" disabled={busy !== null || activeStepIndex === 0} onClick={goToPreviousStep}>
              <ArrowLeft size={15} />
              {t('firstRun.action.previous')}
            </button>
            {isFinalStep ? (
              <button className="settings-action-button first-run-primary" type="button" disabled={busy !== null} onClick={() => void finish()}>
                {busy === 'finish' ? <Loader2 className="spinning-icon" size={15} /> : <CheckCircle2 size={15} />}
                {t('firstRun.action.finish')}
              </button>
            ) : (
              <button className="settings-action-button first-run-primary" type="button" disabled={busy !== null} onClick={goToNextStep}>
                {t('firstRun.action.next')}
                <ArrowRight size={15} />
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
};
