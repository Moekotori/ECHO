import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Feather, FolderOpen, HardDrive, Loader2, X } from 'lucide-react';
import type { AudioDeviceInfo, AudioOutputMode } from '../../../shared/types/audio';
import type { AppSettings, AppThemeMode, AppThemePreset, LyricsPageStyle, RememberedAudioOutput, ScanPerformanceMode } from '../../../shared/types/appSettings';
import { defaultLyricsPageStyle } from '../../../shared/types/appSettings';
import { detectRendererPlatform, isAdvancedNativeOutputPlatform, isExclusiveNativeOutputPlatform, isNativeSharedOutputPlatform } from '../../../shared/utils/audioPlatformCapabilities';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { localeOptions } from '../../i18n/locales';
import type { Locale, TranslationKey } from '../../i18n/locales';
import { StyledSelect } from '../ui/StyledSelect';
import { FirstRunWizardShell } from './FirstRunWizardShell';
import { firstRunSteps } from './firstRunSteps';
import type { FirstRunStepId } from './firstRunSteps';
import { FirstRunAppearanceStep } from './FirstRunAppearanceStep';
import { FirstRunEverydayStep } from './FirstRunEverydayStep';
import { firstRunThemeModes, firstRunThemePresets } from './firstRunAppearanceModel';
import { appWallpaperDisplayName, appWallpaperEffectPresets, inferAppWallpaperMediaType } from '../../pages/settings/appearance/wallpaperSettingsModel';
import type { AppWallpaperEffectPresetId } from '../../pages/settings/appearance/wallpaperSettingsModel';
import { updateThemePreferences } from '../../preferences/themePreferences';
import { rememberLibraryScanStatus } from '../../stores/libraryScanSession';

type FirstRunWizardProps = {
  initialSettings: AppSettings | null;
  onClose: () => void;
  onCompleted: (settings: AppSettings | null) => void;
  presentationState?: 'open' | 'closing';
};

/* Each language introduces itself in its own words, so readers can recognise
   theirs before the interface locale is switched. Intentionally untranslated. */
const localeNativeDescriptions: Record<Locale, string> = {
  'zh-CN': '菜单、教程和设置使用简体中文。',
  'zh-TW': '選單、教學與設定使用繁體中文。',
  'ja-JP': 'メニュー、ガイド、設定を日本語で表示します。',
  'en-US': 'Menus, guides and settings in English.',
  'ko-KR': '메뉴, 가이드, 설정을 한국어로 표시합니다.',
};

type FirstRunOption<T extends string> = {
  mode: T;
  labelKey: TranslationKey;
  label?: string;
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
  { mode: 'asio', labelKey: 'firstRun.audio.asio.label', descriptionKey: 'firstRun.audio.asio.description', hintKey: 'firstRun.audio.asio.hint' },
];

const detectFirstRunPlatform = (): NodeJS.Platform | 'unknown' =>
  typeof window !== 'undefined' ? detectRendererPlatform(window.navigator) : 'unknown';

export const getSupportedFirstRunOutputModes = (
  platform: NodeJS.Platform | 'unknown',
): Array<FirstRunOption<AudioOutputMode>> =>
  outputModes
    .filter((item) => {
      if (item.mode === 'system') {
        return platform !== 'darwin';
      }

      if (item.mode === 'shared') {
        return isNativeSharedOutputPlatform(platform);
      }

      if (item.mode === 'asio') {
        return isAdvancedNativeOutputPlatform(platform);
      }

      return isExclusiveNativeOutputPlatform(platform);
    })
    .map((item) =>
      platform === 'linux' && item.mode === 'shared'
        ? {
            ...item,
            labelKey: 'firstRun.audio.linuxShared.label',
            descriptionKey: 'firstRun.audio.linuxShared.description',
            hintKey: 'firstRun.audio.linuxShared.hint',
          }
        : platform === 'darwin' && item.mode !== 'system'
          ? {
              ...item,
              label: item.mode === 'exclusive' ? 'CoreAudio Exclusive' : 'CoreAudio Shared',
            }
          : item,
    );

export const FirstRunWizard = ({ initialSettings, onClose, onCompleted, presentationState = 'open' }: FirstRunWizardProps): JSX.Element => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? translateFallback;
  const activeLocale = i18n?.locale ?? (initialSettings?.locale as Locale | undefined) ?? 'zh-CN';
  const setLocale = i18n?.setLocale;
  const [rendererPlatform] = useState<NodeJS.Platform | 'unknown'>(() => detectFirstRunPlatform());
  const firstRunOutputModes = useMemo(() => getSupportedFirstRunOutputModes(rendererPlatform), [rendererPlatform]);
  const [activeStepId, setActiveStepId] = useState<FirstRunStepId>('language');
  const [hideToTray, setHideToTray] = useState<boolean | null>(null);
  const [musicFolderPaths, setMusicFolderPaths] = useState<string[]>([]);
  const [cacheDirectory, setCacheDirectory] = useState<string | null | undefined>(undefined);
  const [scanMode, setScanMode] = useState<ScanPerformanceMode>(initialSettings?.scanPerformanceMode ?? 'balanced');
  const [appearanceThemeDraft, setAppearanceTheme] = useState<AppThemeMode | null>(null);
  const [lyricsStyleDraft, setLyricsStyle] = useState<LyricsPageStyle | null>(null);
  const appearanceTheme = appearanceThemeDraft ?? initialSettings?.appearanceTheme ?? 'light';
  const [appearancePresetDraft, setAppearanceThemePreset] = useState<AppThemePreset | null>(null);
  const initialPreset = initialSettings?.appearanceThemePreset ?? 'classic';
  const appearanceThemePreset = appearancePresetDraft
    ?? (firstRunThemePresets.some((item) => item.preset === initialPreset) ? initialPreset : 'classic');
  const [wallpaperPath, setWallpaperPath] = useState<string | null>(null);
  const [wallpaperEffectId, setWallpaperEffectId] = useState<AppWallpaperEffectPresetId>('balanced');
  // Ultralight is recommended but remains opt-in. Preserve an existing user
  // choice when the wizard is reopened without enabling it for new profiles.
  const [ultraLightEnabled, setUltraLightEnabled] = useState(
    initialSettings?.ultraLightOnMinimizeOrTrayEnabled === true,
  );
  const [outputMode, setOutputMode] = useState<AudioOutputMode>(() => {
    const supportedModes = getSupportedFirstRunOutputModes(rendererPlatform);
    const fallbackMode = supportedModes.some((item) => item.mode === 'shared') ? 'shared' : 'system';
    const rememberedMode = initialSettings?.rememberedAudioOutput?.outputMode ?? fallbackMode;
    return supportedModes.some((item) => item.mode === rememberedMode) ? rememberedMode : fallbackMode;
  });
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);
  // null preserves the existing output; 'auto' explicitly follows the host default.
  const [audioDeviceKey, setAudioDeviceKey] = useState<string | null>(null);
  const [scanNow, setScanNow] = useState(true);
  const [busy, setBusy] = useState<'folder' | 'cache' | 'wallpaper' | 'finish' | 'skip' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.echo?.audio?.listDevices?.()
      .then((devices) => {
        if (!cancelled && Array.isArray(devices)) {
          setAudioDevices(devices);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const activeStepIndex = Math.max(0, firstRunSteps.findIndex((step) => step.id === activeStepId));
  const activeStep = firstRunSteps[activeStepIndex] ?? firstRunSteps[0]!;
  const activeStepTitle = activeStep.id === 'summary'
      ? t('firstRun.summary.readyTitle')
      : t(activeStep.titleKey);
  const activeStepDescription = activeStep.id === 'summary'
      ? t('firstRun.summary.readyDescription')
      : t(activeStep.descriptionKey);

  const cacheDirectoryLabel = useMemo(() => {
    if (cacheDirectory === undefined) {
      return initialSettings?.coverCacheDir ?? t('firstRun.defaultLocation');
    }
    return cacheDirectory ?? t('firstRun.defaultLocation');
  }, [cacheDirectory, initialSettings?.coverCacheDir, t]);

  const scanModeLabel = t(scanModes.find((item) => item.mode === scanMode)?.labelKey ?? 'firstRun.scan.balanced.label');
  const selectedOutputMode = firstRunOutputModes.find((item) => item.mode === outputMode);
  const outputModeLabel = selectedOutputMode?.label
    ?? t(selectedOutputMode?.labelKey ?? 'firstRun.audio.system.label');
  const outputModeDevices = useMemo(
    () => (outputMode === 'system' ? [] : audioDevices.filter((device) => device.outputMode === outputMode)),
    [audioDevices, outputMode],
  );
  const selectedAudioDevice = audioDeviceKey === null
    ? outputModeDevices.find((device) => initialSettings?.rememberedAudioOutput?.deviceName
      ? device.name === initialSettings.rememberedAudioOutput.deviceName
      : device.index === initialSettings?.rememberedAudioOutput?.deviceIndex)
    : audioDeviceKey === 'auto'
    ? undefined
    : outputModeDevices.find((device) => device.id === audioDeviceKey);
  const audioDeviceLabel = selectedAudioDevice?.name ?? t('firstRun.audio.device.auto');
  const appearanceThemeLabel = t(firstRunThemeModes.find((item) => item.mode === appearanceTheme)?.labelKey ?? 'settings.appearance.theme.light');
  const ambientThemeSelected = appearanceTheme === 'ambient';
  const effectiveAppearanceThemePreset = ambientThemeSelected ? 'classic' : appearanceThemePreset;
  const appearancePresetLabel = ambientThemeSelected
    ? t('settings.appearance.theme.ambient')
    : t(firstRunThemePresets.find((item) => item.preset === appearanceThemePreset)?.labelKey ?? 'settings.appearance.themePreset.classic');
  const wallpaperEffectPreset = appWallpaperEffectPresets.find((preset) => preset.id === wallpaperEffectId) ?? appWallpaperEffectPresets[0]!;
  const wallpaperEffectLabel = t(wallpaperEffectPreset.labelKey);
  const wallpaperMediaType = wallpaperPath ? inferAppWallpaperMediaType(wallpaperPath) : 'image';
  const wallpaperPreviewUrl = wallpaperPath
    ? `echo-wallpaper://app/preview?path=${encodeURIComponent(wallpaperPath)}`
    : null;
  /* Approximate the chosen effect inside the small preview: scaled-down blur, real
     brightness/zoom, and the UI-opacity value drives the fake player chip below. */
  const wallpaperPreviewMediaStyle = {
    filter: `blur(${Math.min(10, (wallpaperEffectPreset.patch.appWallpaperBlurPx ?? 0) * 0.45)}px) brightness(${(wallpaperEffectPreset.patch.appWallpaperBrightnessPercent ?? 100) / 100})`,
    transform: `scale(${Math.max(1, (wallpaperEffectPreset.patch.appWallpaperScalePercent ?? 100) / 100)})`,
  };
  const wallpaperPreviewUiAlpha = (wallpaperEffectPreset.patch.appWallpaperUiOpacityPercent ?? 100) / 100;

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
        setMusicFolderPaths((current) => current.includes(chosen) ? current : [...current, chosen]);
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

  const chooseWallpaper = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.chooseAppWallpaper) {
      return;
    }

    try {
      setBusy('wallpaper');
      setError(null);
      const chosen = await app.chooseAppWallpaper();
      if (chosen) {
        setWallpaperPath(chosen);
      }
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError));
    } finally {
      setBusy(null);
    }
  }, []);

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
      const applyOutput = audioDeviceKey !== null || !currentSettings?.rememberedAudioOutput;
      const chosenAudioDevice = outputMode === 'system' || audioDeviceKey === 'auto'
        ? undefined
        : audioDevices.find((device) => device.outputMode === outputMode && device.id === audioDeviceKey);
      const rememberedAudioOutput: RememberedAudioOutput = {
        ...(currentSettings?.rememberedAudioOutput ?? initialSettings?.rememberedAudioOutput),
        enabled: true,
        outputMode,
      };
      // Drop any stale remembered device before applying the wizard's choice.
      delete rememberedAudioOutput.deviceIndex;
      delete rememberedAudioOutput.deviceName;
      if (chosenAudioDevice) {
        rememberedAudioOutput.deviceIndex = chosenAudioDevice.index;
        rememberedAudioOutput.deviceName = chosenAudioDevice.name;
      }
      // A failed host command must not save the new output or complete setup.
      if (applyOutput) {
        await window.echo?.audio?.setOutput?.({
          outputMode,
          ...(chosenAudioDevice ? { deviceIndex: chosenAudioDevice.index, deviceName: chosenAudioDevice.name } : {}),
        });
      }
      const themePatch = {
        ...(appearanceThemeDraft !== null || !currentSettings?.appearanceTheme ? { appearanceTheme } : {}),
        ...(appearancePresetDraft !== null || appearanceThemeDraft === 'ambient' || !currentSettings?.appearanceThemePreset
          ? { appearanceThemePreset: effectiveAppearanceThemePreset } : {}),
        ...(appearancePresetDraft !== null || appearanceThemeDraft === 'ambient' ? { appearanceThemeCustomId: null } : {}),
      };
      const wallpaperEffectPatch = appWallpaperEffectPresets.find((preset) => preset.id === wallpaperEffectId)?.patch;
      const nextSettings = await app.setSettings({
        ...(hideToTray === null ? {} : { hideToTrayOnClose: hideToTray }),
        ...themePatch,
        ...(lyricsStyleDraft === null ? {} : { lyricsPageStyle: lyricsStyleDraft }),
        ...(wallpaperPath
          ? {
              appCustomWallpaperEnabled: true,
              appCustomWallpaperPath: wallpaperPath,
              appWallpaperMediaType: inferAppWallpaperMediaType(wallpaperPath),
              ...wallpaperEffectPatch,
            }
          : {}),
        scanPerformanceMode: scanMode,
        ultraLightOnMinimizeOrTrayEnabled: ultraLightEnabled,
        ...(applyOutput ? { rememberedAudioOutput } : {}),
      });
      if (Object.keys(themePatch).length > 0) {
        updateThemePreferences(nextSettings.appearanceTheme, nextSettings.appearanceThemePreset ?? 'classic', nextSettings.appearanceThemePresetOverrides ?? {}, {
          animate: true,
          customThemeId: nextSettings.appearanceThemeCustomId,
          customThemes: nextSettings.appearanceCustomThemes ?? [],
        });
      }

      if (musicFolderPaths.length && library) {
        for (const folderPath of musicFolderPaths) {
          const folder = await library.addFolder(folderPath);
          if (scanNow && library.scanFolder) {
            rememberLibraryScanStatus(await library.scanFolder(folder.id));
          }
        }
        window.dispatchEvent(new Event('library:changed'));
      }

      const completedSettings = await app.setSettings({ onboardingCompleted: true });
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: completedSettings }));
      setMessage(t('firstRun.message.saved'));
      onCompleted(completedSettings);
      onClose();
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : String(finishError));
    } finally {
      setBusy(null);
    }
  }, [
    appearanceTheme,
    appearanceThemeDraft,
    appearancePresetDraft,
    audioDeviceKey,
    audioDevices,
    cacheDirectory,
    effectiveAppearanceThemePreset,
    initialSettings,
    lyricsStyleDraft,
    hideToTray,
    musicFolderPaths,
    onClose,
    onCompleted,
    outputMode,
    scanMode,
    scanNow,
    t,
    ultraLightEnabled,
    wallpaperEffectId,
    wallpaperPath,
  ]);

  const renderStepBody = (): JSX.Element => {
    switch (activeStep.id) {
      case 'language':
        return (
          <>
            <section className="first-run-edition-notice" aria-labelledby="first-run-edition-title">
              <h4 id="first-run-edition-title">{t('firstRun.communityEdition.title')}</h4>
              <p>{t('firstRun.communityEdition.description')}</p>
              <p>{t('firstRun.communityEdition.feedback')}</p>
            </section>
            <div className="first-run-options first-run-options--cards first-run-options--compact first-run-language-options" role="listbox" aria-label={t('firstRun.step.language.label')}>
              {localeOptions.map((option) => {
                const selected = activeLocale === option.locale;
                return (
                  <button
                    className={selected ? 'is-active' : undefined}
                    key={option.locale}
                    lang={option.locale}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => setLocale?.(option.locale)}
                  >
                    <strong>{option.label}</strong>
                  </button>
                );
              })}
            </div>
            <p className="first-run-language-note">{activeLocale in localeNativeDescriptions ? localeNativeDescriptions[activeLocale as Locale] : localeNativeDescriptions['zh-CN']}</p>
            <div className="first-run-basics-grid first-run-library-grid">
              <section className="first-run-appearance-section first-run-basics-section">
                <header>
                  <div>
                    <span>{t('firstRun.summary.music')}</span>
                  </div>
                </header>
                {musicFolderPaths.length ? (
                  <ul className="first-run-folder-list">
                    {musicFolderPaths.map((path) => (
                      <li key={path}>
                        <span title={path}>{path}</span>
                        <button
                          type="button"
                          aria-label={`${t('firstRun.library.removeFolder')}: ${path}`}
                          disabled={busy !== null}
                          onClick={() => setMusicFolderPaths((current) => current.filter((item) => item !== path))}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="first-run-path-preview">{t('firstRun.library.noneSelected')}</div>
                )}
                <div className="settings-chip-row settings-chip-row--left">
                  <button className="settings-action-button" type="button" disabled={busy !== null} onClick={() => void chooseMusicFolder()}>
                    {busy === 'folder' ? <Loader2 className="spinning-icon" size={15} /> : <FolderOpen size={15} />}
                    {musicFolderPaths.length ? t('firstRun.library.addMoreFolders') : t('firstRun.library.chooseFolder')}
                  </button>
                  <label className="first-run-scan-toggle">
                    <input type="checkbox" checked={scanNow} onChange={(event) => setScanNow(event.target.checked)} />
                    <span className="first-run-scan-switch" aria-hidden="true" />
                    <span>{t('firstRun.library.scanAfterFinish')}</span>
                  </label>
                </div>
              </section>
              <section className="first-run-appearance-section first-run-basics-section">
                <header>
                  <div>
                    <span>{t('firstRun.step.cache.title')}</span>
                  </div>
                </header>
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
                <p className="first-run-basics-hint">{t('firstRun.step.cache.description')}</p>
              </section>
            </div>
            <div className="first-run-preferences-grid">
              <section className="first-run-appearance-section first-run-basics-section first-run-library-scan-section">
                <header>
                  <div>
                    <span>{t('firstRun.step.scan.title')}</span>
                    <strong>{scanModeLabel}</strong>
                  </div>
                </header>
                <StyledSelect<ScanPerformanceMode>
                  className="first-run-scan-select"
                  value={scanMode}
                  options={scanModes.map((item) => ({
                    value: item.mode,
                    label: `${t(item.labelKey)} · ${t(item.hintKey)}`,
                  }))}
                  onChange={(value) => setScanMode(value)}
                  ariaLabel={t('firstRun.step.scan.title')}
                  triggerAriaLabel={`${t('firstRun.step.scan.title')}: ${scanModeLabel}`}
                  showFilterIcon={false}
                />
                <p className="first-run-basics-hint">{t(scanModes.find((item) => item.mode === scanMode)?.descriptionKey ?? 'firstRun.scan.balanced.description')}</p>
              </section>
              <section className="first-run-ultralight-card">
                <div className="first-run-ultralight-icon" aria-hidden="true">
                  <Feather size={19} />
                </div>
                <div className="first-run-ultralight-copy">
                  <header>
                    <strong>ECHO Ultralight</strong>
                    <em>{t('firstRun.ultralight.recommended')}</em>
                  </header>
                  <p>{t('firstRun.ultralight.description')}</p>
                </div>
                <label className="first-run-scan-toggle first-run-ultralight-toggle">
                  <input type="checkbox" checked={ultraLightEnabled} onChange={(event) => setUltraLightEnabled(event.target.checked)} />
                  <span className="first-run-scan-switch" aria-hidden="true" />
                  <span>{ultraLightEnabled ? t('firstRun.ultralight.on') : t('firstRun.ultralight.off')}</span>
                </label>
              </section>
            </div>
          </>
        );
      case 'audio':
        return (
          <>
            <div className="first-run-options first-run-options--cards first-run-options--compact">
              {firstRunOutputModes.map((item) => (
                <button
                  className={outputMode === item.mode ? 'is-active' : undefined}
                  key={item.mode}
                  type="button"
                  aria-pressed={outputMode === item.mode}
                  onClick={() => {
                    setOutputMode(item.mode);
                    if (item.mode !== outputMode) {
                      setAudioDeviceKey('auto');
                    }
                  }}
                >
                  <strong>{item.label ?? t(item.labelKey)}</strong>
                  <span>{t(item.descriptionKey)}</span>
                  <em>{t(item.hintKey)}</em>
                </button>
              ))}
            </div>
            {outputMode !== 'system' ? (
              <section className="first-run-appearance-section first-run-basics-section first-run-audio-device-section">
                <header>
                  <div>
                    <span>{t('firstRun.audio.device.title')}</span>
                    <strong>{audioDeviceLabel}</strong>
                  </div>
                </header>
                <StyledSelect<string>
                  className="first-run-scan-select"
                  value={selectedAudioDevice?.id ?? 'auto'}
                  options={[
                    { value: 'auto', label: t('firstRun.audio.device.auto') },
                    ...outputModeDevices.map((device) => ({
                      value: device.id,
                      label: device.isDefault ? `${device.name} · ${t('firstRun.frameRate.default')}` : device.name,
                    })),
                  ]}
                  onChange={(value) => setAudioDeviceKey(value)}
                  ariaLabel={t('firstRun.audio.device.title')}
                  triggerAriaLabel={`${t('firstRun.audio.device.title')}: ${audioDeviceLabel}`}
                  showFilterIcon={false}
                />
                <p className="first-run-basics-hint">
                  {outputModeDevices.length ? t('firstRun.audio.device.hint') : t('firstRun.audio.device.empty')}
                </p>
              </section>
            ) : null}
          </>
        );
      case 'appearance':
        return <FirstRunAppearanceStep
          theme={appearanceTheme} preset={appearanceThemePreset}
          lyricsStyle={lyricsStyleDraft ?? initialSettings?.lyricsPageStyle ?? defaultLyricsPageStyle}
          onLyricsStyleChange={setLyricsStyle}
          presetOverrides={initialSettings?.appearanceThemePresetOverrides}
          onThemeChange={setAppearanceTheme} onPresetChange={setAppearanceThemePreset}
          wallpaperPath={wallpaperPath} wallpaperPreviewUrl={wallpaperPreviewUrl}
          wallpaperMediaType={wallpaperMediaType} wallpaperMediaStyle={wallpaperPreviewMediaStyle}
          wallpaperUiAlpha={wallpaperPreviewUiAlpha} effectId={wallpaperEffectId}
          onEffectChange={setWallpaperEffectId} onChooseWallpaper={() => void chooseWallpaper()}
          onClearWallpaper={() => setWallpaperPath(null)} busy={busy}
        />;
      case 'daily':
        return <FirstRunEverydayStep settings={initialSettings} platform={rendererPlatform}
          hideToTray={hideToTray ?? initialSettings?.hideToTrayOnClose === true} onHideToTrayChange={setHideToTray} />;
      case 'summary':
        return (
          <div className="first-run-summary-review">
            <div className="first-run-summary-launch-grid">
              <section className="first-run-summary-after">
                <header>
                  <span>{`${activeStepIndex + 1} / ${firstRunSteps.length}`}</span>
                  <strong>{t('firstRun.summary.afterTitle')}</strong>
                </header>
                <ol>
                  <li>
                    <span>1</span>
                    <strong>{t('firstRun.summary.after.save')}</strong>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>{t('firstRun.summary.music')}</strong>
                      <small>{musicFolderPaths.length === 0
                        ? t('firstRun.summary.addLater')
                        : scanNow
                          ? t('firstRun.summary.scanWithFolder', { mode: scanModeLabel })
                          : `${t('firstRun.summary.scan')} · ${t('common.disabled')}`}</small>
                    </div>
                  </li>
                  <li className="is-final">
                    <span><ArrowRight size={15} aria-hidden="true" /></span>
                    <strong>{t('firstRun.summary.after.enter')}</strong>
                  </li>
                </ol>
              </section>
              <section className="first-run-summary-configuration">
                <header>
                  <strong>{t('firstRun.summary.configurationTitle')}</strong>
                  <CheckCircle2 size={17} aria-hidden="true" />
                </header>
                <dl>
                  <div>
                    <dt>{t('firstRun.summary.music')}</dt>
                    <dd title={musicFolderPaths.length > 1 ? musicFolderPaths.join('\n') : undefined}>
                      {musicFolderPaths.length === 0
                        ? t('firstRun.summary.addLater')
                        : musicFolderPaths.length === 1
                          ? musicFolderPaths[0]
                          : t('firstRun.summary.musicMultiple', { count: musicFolderPaths.length })}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('firstRun.summary.cache')}</dt>
                    <dd title={cacheDirectoryLabel}>{cacheDirectoryLabel}</dd>
                  </div>
                  <div>
                    <dt>{t('firstRun.summary.scan')}</dt>
                    <dd>{musicFolderPaths.length === 0
                      ? t('firstRun.summary.addLater')
                      : scanNow
                        ? t('firstRun.summary.scanWithFolder', { mode: scanModeLabel })
                        : t('common.disabled')}</dd>
                  </div>
                  <div>
                    <dt>{t('firstRun.summary.output')}</dt>
                    <dd>{selectedAudioDevice ? `${outputModeLabel} · ${selectedAudioDevice.name}` : outputModeLabel}</dd>
                  </div>
                  <div>
                    <dt>{t('firstRun.summary.theme')}</dt>
                    <dd>{t('firstRun.summary.themeValue', { mode: appearanceThemeLabel, preset: appearancePresetLabel })}</dd>
                  </div>
                  <div>
                    <dt>{t('firstRun.summary.background')}</dt>
                    <dd>{wallpaperPath ? `${appWallpaperDisplayName(wallpaperPath)} · ${wallpaperEffectLabel}` : t('firstRun.summary.backgroundDefault')}</dd>
                  </div>
                  <div>
                    <dt>ECHO Ultralight</dt>
                    <dd>{t(ultraLightEnabled ? 'firstRun.ultralight.on' : 'firstRun.ultralight.off')}</dd>
                  </div>
                </dl>
              </section>
            </div>
            <div className="first-run-summary-support">
              <span><CheckCircle2 size={14} />{t('firstRun.summary.noFileMove')}</span>
            </div>
          </div>
        );
      default:
        return <div />;
    }
  };

  return (
    <FirstRunWizardShell
      activeStep={activeStep}
      activeStepIndex={activeStepIndex}
      title={activeStepTitle}
      description={activeStepDescription}
      presentationState={presentationState}
      theme={appearanceTheme}
      onThemeChange={setAppearanceTheme}
      busy={busy}
      error={error}
      message={message}
      onStepChange={setActiveStepId}
      onSkip={() => void skip()}
      onFinish={() => void finish()}
      onError={setError}
    >
      {renderStepBody()}
    </FirstRunWizardShell>
  );
};
