import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, FolderOpen, HardDrive, Headphones, Loader2, LogIn, Palette, ScanLine, Sparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioOutputMode } from '../../../shared/types/audio';
import type { AppSettings, AppThemeMode, AppThemePreset, ScanPerformanceMode } from '../../../shared/types/appSettings';
import { detectRendererPlatform, isAdvancedNativeOutputPlatform, isNativeSharedOutputPlatform } from '../../../shared/utils/audioPlatformCapabilities';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { updateThemePreferences } from '../../preferences/themePreferences';
import { rememberLibraryScanStatus } from '../../stores/libraryScanSession';

type FirstRunWizardProps = {
  initialSettings: AppSettings | null;
  onClose: () => void;
  onCompleted: (settings: AppSettings | null) => void;
};

type FirstRunStepId = 'library' | 'cache' | 'scan' | 'audio' | 'appearance' | 'accounts' | 'summary';

type FirstRunStep = {
  id: FirstRunStepId;
  labelKey: TranslationKey;
  eyebrowKey: TranslationKey;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
};

type FirstRunOption<T extends string> = {
  mode: T;
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
  { mode: 'system', labelKey: 'firstRun.audio.system.label', descriptionKey: 'firstRun.audio.system.description', hintKey: 'firstRun.audio.system.hint' },
  { mode: 'shared', labelKey: 'firstRun.audio.shared.label', descriptionKey: 'firstRun.audio.shared.description', hintKey: 'firstRun.audio.shared.hint' },
  { mode: 'exclusive', labelKey: 'firstRun.audio.exclusive.label', descriptionKey: 'firstRun.audio.exclusive.description', hintKey: 'firstRun.audio.exclusive.hint' },
  { mode: 'asio', labelKey: 'firstRun.audio.asio.label', descriptionKey: 'firstRun.audio.asio.description', hintKey: 'firstRun.audio.asio.hint' },
];

const themeModes: Array<FirstRunOption<AppThemeMode>> = [
  { mode: 'light', labelKey: 'settings.appearance.theme.light', descriptionKey: 'firstRun.theme.light.description', hintKey: 'firstRun.theme.light.hint' },
  { mode: 'dark', labelKey: 'settings.appearance.theme.dark', descriptionKey: 'firstRun.theme.dark.description', hintKey: 'firstRun.theme.dark.hint' },
  { mode: 'system', labelKey: 'settings.appearance.theme.followSystem', descriptionKey: 'firstRun.theme.system.description', hintKey: 'firstRun.theme.system.hint' },
];

const themePresets: Array<{ preset: AppThemePreset; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { preset: 'classic', labelKey: 'settings.appearance.themePreset.classic', descriptionKey: 'settings.appearance.themePreset.classic.description' },
  { preset: 'sakuraMilk', labelKey: 'settings.appearance.themePreset.sakuraMilk', descriptionKey: 'settings.appearance.themePreset.sakuraMilk.description' },
  { preset: 'mintCandy', labelKey: 'settings.appearance.themePreset.mintCandy', descriptionKey: 'settings.appearance.themePreset.mintCandy.description' },
  { preset: 'echoTwilight', labelKey: 'settings.appearance.themePreset.echoTwilight', descriptionKey: 'settings.appearance.themePreset.echoTwilight.description' },
  { preset: 'graphiteAurora', labelKey: 'settings.appearance.themePreset.graphiteAurora', descriptionKey: 'settings.appearance.themePreset.graphiteAurora.description' },
  { preset: 'darkSideMoon', labelKey: 'settings.appearance.themePreset.darkSideMoon', descriptionKey: 'settings.appearance.themePreset.darkSideMoon.description' },
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

export const FirstRunWizard = ({ initialSettings, onClose, onCompleted }: FirstRunWizardProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [rendererPlatform] = useState<NodeJS.Platform | 'unknown'>(() => detectFirstRunPlatform());
  const firstRunOutputModes = useMemo(() => getSupportedFirstRunOutputModes(rendererPlatform), [rendererPlatform]);
  const [activeStepId, setActiveStepId] = useState<FirstRunStepId>('library');
  const [musicFolderPath, setMusicFolderPath] = useState<string | null>(null);
  const [cacheDirectory, setCacheDirectory] = useState<string | null | undefined>(undefined);
  const [scanMode, setScanMode] = useState<ScanPerformanceMode>(initialSettings?.scanPerformanceMode ?? 'balanced');
  const [appearanceTheme, setAppearanceTheme] = useState<AppThemeMode>(initialSettings?.appearanceTheme ?? 'light');
  const [appearanceThemePreset, setAppearanceThemePreset] = useState<AppThemePreset>(initialSettings?.appearanceThemePreset ?? 'classic');
  const [outputMode, setOutputMode] = useState<AudioOutputMode>(() => {
    const rememberedMode = initialSettings?.rememberedAudioOutput?.outputMode ?? 'system';
    return getSupportedFirstRunOutputModes(rendererPlatform).some((item) => item.mode === rememberedMode) ? rememberedMode : 'system';
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

  const cacheDirectoryLabel = useMemo(() => {
    if (cacheDirectory === undefined) {
      return initialSettings?.coverCacheDir ?? t('firstRun.defaultLocation');
    }
    return cacheDirectory ?? t('firstRun.defaultLocation');
  }, [cacheDirectory, initialSettings?.coverCacheDir, t]);

  const scanModeLabel = t(scanModes.find((item) => item.mode === scanMode)?.labelKey ?? 'firstRun.scan.balanced.label');
  const outputModeLabel = t(firstRunOutputModes.find((item) => item.mode === outputMode)?.labelKey ?? 'firstRun.audio.system.label');
  const appearanceThemeLabel = t(themeModes.find((item) => item.mode === appearanceTheme)?.labelKey ?? 'settings.appearance.theme.light');
  const appearancePresetLabel = t(themePresets.find((item) => item.preset === appearanceThemePreset)?.labelKey ?? 'settings.appearance.themePreset.classic');

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
        appearanceThemePreset,
        scanPerformanceMode: scanMode,
        rememberedAudioOutput,
      });
      updateThemePreferences(appearanceTheme, appearanceThemePreset, nextSettings.appearanceThemePresetOverrides ?? {}, {
        animate: true,
        customThemeId: null,
        customThemes: nextSettings.appearanceCustomThemes ?? [],
      });

      await window.echo?.audio?.setOutput?.({ outputMode }).catch(() => undefined);

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
  }, [appearanceTheme, appearanceThemePreset, cacheDirectory, initialSettings, musicFolderPath, onClose, onCompleted, outputMode, scanMode, scanNow, t]);

  const goToPreviousStep = (): void => {
    setActiveStepId(firstRunSteps[Math.max(0, activeStepIndex - 1)]!.id);
  };

  const goToNextStep = (): void => {
    setActiveStepId(firstRunSteps[Math.min(firstRunSteps.length - 1, activeStepIndex + 1)]!.id);
  };

  const renderStepBody = (): JSX.Element => {
    switch (activeStep.id) {
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
              <label className="settings-inline-toggle">
                <span>{t('firstRun.library.scanAfterFinish')}</span>
                <input type="checkbox" checked={scanNow} onChange={(event) => setScanNow(event.target.checked)} />
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
              <div className="first-run-theme-presets">
                {themePresets.map((item) => (
                  <button
                    className={appearanceThemePreset === item.preset ? 'is-active' : undefined}
                    key={item.preset}
                    type="button"
                    aria-pressed={appearanceThemePreset === item.preset}
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
          <div className="first-run-final-card">
            <Sparkles size={24} aria-hidden="true" />
            <div>
              <h3>{t('firstRun.summary.readyTitle')}</h3>
              <p>{t('firstRun.summary.readyDescription')}</p>
            </div>
          </div>
        );
      default:
        return <div />;
    }
  };

  return (
    <div className="first-run-backdrop" role="dialog" aria-modal="true" aria-labelledby="first-run-title" aria-describedby="first-run-description">
      <section className="first-run-panel">
        <header className="first-run-header">
          <div>
            <span className="section-kicker">ECHO Next</span>
            <h2 id="first-run-title">{t('firstRun.title')}</h2>
            <p id="first-run-description">{t('firstRun.description')}</p>
          </div>
          <button className="queue-icon-button" type="button" aria-label={t('firstRun.action.skipWizard')} title={t('firstRun.action.skipWizard')} disabled={busy !== null} onClick={() => void skip()}>
            <X size={17} />
          </button>
        </header>

        <div className="first-run-progress" aria-hidden="true">
          <span style={{ width: `${progressPercent}%` }} />
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
          <main className="first-run-stage" key={activeStep.id}>
            <div className="first-run-stage-icon">
              <ActiveIcon size={26} />
            </div>
            <div className="first-run-stage-copy">
              <span>{t(activeStep.eyebrowKey)}</span>
              <h3>{t(activeStep.titleKey)}</h3>
              <p>{t(activeStep.descriptionKey)}</p>
            </div>
            {renderStepBody()}
          </main>

          <aside className="first-run-summary" aria-label={t('firstRun.aria.summary')}>
            <span className="first-run-summary-kicker">{t('firstRun.summary.kicker')}</span>
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
                <dt>{t('firstRun.summary.theme')}</dt>
                <dd>{t('firstRun.summary.themeValue', { mode: appearanceThemeLabel, preset: appearancePresetLabel })}</dd>
              </div>
              <div>
                <dt>{t('firstRun.summary.accounts')}</dt>
                <dd>{t('firstRun.summary.accountsLater')}</dd>
              </div>
            </dl>
            <p>{t('firstRun.summary.noFileMove')}</p>
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
