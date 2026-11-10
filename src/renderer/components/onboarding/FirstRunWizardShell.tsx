import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Moon, Sun } from 'lucide-react';
import type { AppThemeMode } from '../../../shared/types/appSettings';
import { applyThemeToneOverride, resolveThemeMode } from '../../preferences/themePreferences';
import { mergeThemeToneValues } from '../../pages/settings/appearance/themeSettingsModel';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { FirstRunCommunityLinks } from './FirstRunCommunityLinks';
import { firstRunPhases, firstRunSteps } from './firstRunSteps';
import type { FirstRunStep, FirstRunStepId } from './firstRunSteps';
import '../../styles/first-run-immersive.css';
import '../../styles/first-run-layout.css';
import '../../styles/first-run-calm.css';
import '../../styles/first-run-motion.css';

const appIconUrl = new URL('../../../../build-resources/icons/logo.png', import.meta.url).href;

const firstRunStepNotes: Record<FirstRunStepId, TranslationKey[]> = {
  language: ['firstRun.detail.language.applyNow', 'firstRun.detail.language.changeLater'],
  audio: ['firstRun.detail.audio.shared', 'firstRun.detail.audio.advanced'],
  appearance: ['firstRun.detail.appearance.preview', 'firstRun.detail.appearance.system'],
  daily: [],
  summary: ['firstRun.detail.summary.save'],
};

type FirstRunWizardShellProps = {
  activeStep: FirstRunStep;
  activeStepIndex: number;
  title: string;
  description: string;
  presentationState: 'open' | 'closing';
  theme: AppThemeMode;
  onThemeChange: (theme: AppThemeMode) => void;
  busy: string | null;
  error: string | null;
  message: string | null;
  onStepChange: (step: FirstRunStepId) => void;
  onSkip: () => void;
  onFinish: () => void;
  onError: (message: string | null) => void;
  children: ReactNode;
};

/** Presentation only: the wizard continues to own all choices and save actions. */
export const FirstRunWizardShell = ({ activeStep, activeStepIndex, title, description,
  presentationState, theme, onThemeChange, busy, error, message, onStepChange, onSkip, onFinish, onError,
  children }: FirstRunWizardShellProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useDialogFocus(dialogRef, presentationState === 'open');
  useLayoutEffect(() => {
    const backdrop = backdropRef.current!;
    const apply = (): void => {
      const tone = resolveThemeMode(theme);
      // Scope the draft to onboarding; the desktop and saved preferences stay
      // under their existing owner until the wizard successfully completes.
      applyThemeToneOverride(backdrop, tone, mergeThemeToneValues('classic', tone, {}));
      backdrop.style.colorScheme = tone;
    };
    apply();
    if (theme !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    // Focus and scroll reset immediately; the entrance animation never gates input.
    if (stageRef.current) stageRef.current.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, [activeStep.id]);
  const isFinalStep = activeStep.id === 'summary';
  const nextStep = firstRunSteps[Math.min(firstRunSteps.length - 1, activeStepIndex + 1)]!;
  const progressPercent = Math.round(((activeStepIndex + 1) / firstRunSteps.length) * 100);

  const ActiveIcon = activeStep.icon;
  const activeStepNotes = firstRunStepNotes[activeStep.id];
  const activePhaseIndex = Math.max(0, firstRunPhases.findIndex((phase) => phase.stepIds.includes(activeStep.id)));
  const activePhase = firstRunPhases[activePhaseIndex] ?? firstRunPhases[0]!;
  const activeSubStepIndex = Math.max(0, activePhase.stepIds.indexOf(activeStep.id));

  // Shell-level acrylic and wallpaper tokens must not tint onboarding controls.
  return createPortal(
    <div ref={backdropRef} className="first-run-backdrop first-run-backdrop--immersive" data-state={presentationState}>
      <section className="first-run-immersive-shell" ref={dialogRef} tabIndex={-1} aria-busy={busy !== null}
        data-state={presentationState}
        role="dialog" aria-modal="true" aria-labelledby="first-run-title" aria-describedby="first-run-description">
        <aside className="first-run-immersive-journey">
          <div className="first-run-journey-brand" aria-label="ECHO">
            <img src={appIconUrl} width="38" height="38" alt="" />
            <strong>ECHO</strong>
          </div>
          <div className="first-run-journey-copy">
            <h2 id="first-run-title">{t('firstRun.title')}</h2>
            <p id="first-run-description">{t('firstRun.description')}</p>
          </div>
          <nav className="first-run-phase-nav" aria-label={t('firstRun.aria.steps')}>
            {firstRunPhases.map((phase, phaseIndex) => {
              const PhaseIcon = phase.icon;
              const isActive = phase.id === activePhase.id;
              const isDone = phaseIndex < activePhaseIndex;
              return (
                <button
                  className={`${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`.trim()}
                  key={phase.id}
                  type="button"
                  aria-current={isActive ? 'step' : undefined}
                  disabled={busy !== null}
                  onClick={() => onStepChange(phase.stepIds[0]!)}
                >
                  <span className="first-run-phase-marker">
                    {isDone ? <CheckCircle2 size={17} /> : <PhaseIcon size={16} />}
                  </span>
                  <span className="first-run-phase-copy">
                    <strong>{t(phase.labelKey)}</strong>
                    {phase.subtitleKeys?.length ? <small>{phase.subtitleKeys.map((key) => t(key)).join(' / ')}</small> : null}
                  </span>
                  {isActive ? <ArrowRight className="first-run-phase-arrow" size={14} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </nav>
          <FirstRunCommunityLinks onError={onError} />
        </aside>

        <main className="first-run-immersive-workspace" data-has-substeps={activePhase.stepIds.length > 1 ? 'true' : 'false'}>
          <header className="first-run-workspace-header">
            <div>
              <span>{t(activePhase.labelKey)}</span>
              <strong>{activePhaseIndex + 1} / {firstRunPhases.length}</strong>
            </div>
            <div className="first-run-header-tools">
              <div className="first-run-theme-toggle" role="group" aria-label={t('firstRun.theme.modeTitle')}>
                <button type="button" aria-pressed={theme === 'light'} disabled={busy !== null} onClick={() => onThemeChange('light')}>
                  <Sun size={14} aria-hidden="true" /><span>{t('settings.appearance.theme.light')}</span>
                </button>
                <button type="button" aria-pressed={theme === 'dark'} disabled={busy !== null} onClick={() => onThemeChange('dark')}>
                  <Moon size={14} aria-hidden="true" /><span>{t('settings.appearance.theme.dark')}</span>
                </button>
              </div>
              <div
                className="first-run-progress-candy"
                role="progressbar"
                aria-label={t('firstRun.aria.steps')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
              >
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          </header>

          {activePhase.stepIds.length > 1 ? (
            <div className="first-run-substep-slot">
              <nav
                className="first-run-substep-nav"
                aria-label={t('firstRun.aria.steps')}
                style={{ gridTemplateColumns: `repeat(${activePhase.stepIds.length}, minmax(0, 1fr))` }}
              >
                {activePhase.stepIds.map((stepId, index) => {
                  const step = firstRunSteps.find((item) => item.id === stepId)!;
                  const isActive = stepId === activeStep.id;
                  const isDone = index < activeSubStepIndex;
                  return (
                    <button
                      className={`${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`.trim()}
                      key={stepId}
                      type="button"
                      aria-current={isActive ? 'step' : undefined}
                      disabled={busy !== null}
                      onClick={() => onStepChange(stepId)}
                    >
                      <span>{isDone ? <CheckCircle2 size={13} /> : index + 1}</span>
                      <strong>{t(step.labelKey)}</strong>
                    </button>
                  );
                })}
              </nav>
            </div>
          ) : null}

          <section className="first-run-immersive-stage" data-step={activeStep.id} key={activeStep.id} ref={stageRef}>
            <div className="first-run-immersive-stage-heading">
              <div className="first-run-immersive-stage-icon"><ActiveIcon size={22} /></div>
              <div>
                <h3 ref={headingRef} tabIndex={-1} data-dialog-autofocus="true">{title}</h3>
                <p>{description}</p>
              </div>
            </div>
            {activeStep.id !== 'summary' ? (
              <div className="first-run-step-notes" aria-label={t('firstRun.aria.stepNotes')}>
                {activeStepNotes.map((noteKey) => (
                  <span key={noteKey}>
                    <CheckCircle2 size={12} />
                    {t(noteKey)}
                  </span>
                ))}
              </div>
            ) : null}
            {children}
            {error ? <p className="settings-inline-error first-run-workspace-message" role="alert">{error}</p> : null}
            {message ? <p className="settings-inline-note first-run-workspace-message" role="status">{message}</p> : null}
          </section>

          <footer className="first-run-immersive-actions">
            <button className="settings-action-button first-run-skip-button" type="button" disabled={busy !== null} onClick={onSkip}>
              {t('firstRun.action.skip')}
            </button>
            <div className="first-run-action-cluster">
              <button className="settings-action-button" type="button" disabled={busy !== null || activeStepIndex === 0} onClick={() => onStepChange(firstRunSteps[Math.max(0, activeStepIndex - 1)]!.id)}>
                <ArrowLeft size={15} />
                {t('firstRun.action.previous')}
              </button>
              {isFinalStep ? (
                <button className="settings-action-button first-run-primary" type="button" disabled={busy !== null} onClick={onFinish}>
                  {busy === 'finish' ? <Loader2 className="spinning-icon" size={15} /> : <CheckCircle2 size={15} />}
                  {t('firstRun.action.finish')}
                </button>
              ) : (
                <button className="settings-action-button first-run-primary" type="button" disabled={busy !== null} onClick={() => onStepChange(nextStep.id)}>
                  <span>{t('firstRun.action.next')}</span>
                  <small>{t(nextStep.labelKey)}</small>
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          </footer>
        </main>
      </section>
    </div>,
    document.body,
  );
};
