import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TranslationKey } from '../../../i18n/locales';
import { playbackNoSoundGuideSteps } from './playbackSettingsModel';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type PlaybackNoSoundGuideDialogProps = {
  activeStepIndex: number;
  control: ReactNode;
  onClose: () => void;
  onStepChange: (index: number) => void;
  open: boolean;
  t: Translate;
};

export const PlaybackNoSoundGuideDialog = ({
  activeStepIndex,
  control,
  onClose,
  onStepChange,
  open,
  t,
}: PlaybackNoSoundGuideDialogProps): JSX.Element | null => {
  if (!open) {
    return null;
  }

  const stepCount = playbackNoSoundGuideSteps.length;
  const activeStep =
    playbackNoSoundGuideSteps[activeStepIndex] ?? playbackNoSoundGuideSteps[0]!;
  const ActiveStepIcon = activeStep.icon;
  const progressLabel = `${activeStepIndex + 1} / ${stepCount}`;
  const progressPercent = Math.round(((activeStepIndex + 1) / stepCount) * 100);
  const isLastStep = activeStepIndex >= stepCount - 1;

  return (
    <div
      className="settings-no-sound-wizard-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-no-sound-wizard-title"
      aria-describedby="settings-no-sound-wizard-description"
    >
      <section className="settings-no-sound-wizard">
        <header className="settings-no-sound-wizard__header">
          <div>
            <span className="section-kicker">ECHO Next</span>
            <h3 id="settings-no-sound-wizard-title">
              {t('settings.playback.noSoundGuide.title')}
            </h3>
            <p id="settings-no-sound-wizard-description">
              {t('settings.playback.noSoundGuide.description')}
            </p>
          </div>
          <button
            className="queue-icon-button"
            type="button"
            aria-label={t('settings.playback.noSoundGuide.actionCollapse')}
            title={t('settings.playback.noSoundGuide.actionCollapse')}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="settings-no-sound-wizard__progress" aria-hidden="true">
          <div>
            <span>{progressLabel}</span>
            <strong>{t(activeStep.titleKey)}</strong>
          </div>
          <span>
            <i style={{ width: `${progressPercent}%` }} />
          </span>
        </div>

        <nav
          className="settings-no-sound-wizard__stepper"
          aria-label={t('firstRun.aria.steps')}
        >
          {playbackNoSoundGuideSteps.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = index === activeStepIndex;
            const isDone = index < activeStepIndex;

            return (
              <button
                className={`${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`.trim()}
                key={step.id}
                type="button"
                aria-current={isActive ? 'step' : undefined}
                onClick={() => onStepChange(index)}
              >
                <span>{isDone ? <Check size={13} /> : <StepIcon size={13} />}</span>
                {t(step.titleKey)}
              </button>
            );
          })}
        </nav>

        <main className="settings-no-sound-wizard__stage" key={activeStep.id}>
          <div className="settings-no-sound-wizard__stage-icon">
            <ActiveStepIcon size={24} />
          </div>
          <div className="settings-no-sound-wizard__stage-copy">
            <span>{progressLabel}</span>
            <h4>{t(activeStep.titleKey)}</h4>
            <p>{t(activeStep.bodyKey)}</p>
            {control}
          </div>
        </main>

        <footer className="settings-no-sound-wizard__actions">
          <button
            className="settings-action-button"
            type="button"
            disabled={activeStepIndex === 0}
            onClick={() => onStepChange(Math.max(0, activeStepIndex - 1))}
          >
            <ChevronLeft size={14} />
            {t('firstRun.action.previous')}
          </button>
          <button
            className="settings-action-button"
            type="button"
            onClick={() => {
              if (isLastStep) {
                onClose();
                return;
              }
              onStepChange(Math.min(stepCount - 1, activeStepIndex + 1));
            }}
          >
            {isLastStep ? t('firstRun.action.finish') : t('firstRun.action.next')}
            {isLastStep ? <Check size={14} /> : <ChevronRight size={14} />}
          </button>
        </footer>
      </section>
    </div>
  );
};
