import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import { isImeComposingKeyEvent } from '../../utils/imeInput';

type StreamingConsentNoticeModalProps = {
  consent: string;
  onCancel: () => void;
  onConfirm: () => void;
  setConsent: (value: string) => void;
};

const closeAnimationMs = 180;

export const StreamingConsentNoticeModal = ({
  consent,
  onCancel,
  onConfirm,
  setConsent,
}: StreamingConsentNoticeModalProps): JSX.Element => {
  const { t } = useI18n();
  const consentPhrase = t('streamingConsentNotice.consentPhrase');
  const canConfirm = consent.trim() === consentPhrase;
  const [isVisible, setIsVisible] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setIsVisible(true));
    return () => {
      window.cancelAnimationFrame(frameId);
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const closeWithAnimation = useCallback((afterClose: () => void): void => {
    setIsVisible(false);
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(afterClose, closeAnimationMs);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (!isImeComposingKeyEvent(event) && event.key === 'Enter' && canConfirm) {
      closeWithAnimation(onConfirm);
    }
  };

  const handleCancel = (): void => closeWithAnimation(onCancel);

  const handleConfirm = (): void => {
    if (canConfirm) {
      closeWithAnimation(onConfirm);
    }
  };

  return (
    <div
      className="settings-modal-backdrop settings-streaming-notice-backdrop"
      data-state={isVisible ? 'open' : 'closing'}
      role="presentation"
      onMouseDown={handleCancel}
    >
      <section
        className="settings-font-modal settings-streaming-notice-modal"
        data-state={isVisible ? 'open' : 'closing'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-streaming-notice-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-font-modal-header">
          <div className="settings-streaming-notice-heading">
            <ShieldAlert size={18} aria-hidden="true" />
            <h3 id="settings-streaming-notice-title">{t('streamingConsentNotice.title')}</h3>
          </div>
          <button className="settings-icon-button" type="button" onClick={onCancel} aria-label={t('streamingConsentNotice.close')}>
            <X size={15} />
          </button>
        </header>
        <div className="settings-streaming-notice-body">
          <p>{t('streamingConsentNotice.bodyIntro')}</p>
          <ul>
            <li>{t('streamingConsentNotice.license')}</li>
            <li>{t('streamingConsentNotice.platformControl')}</li>
            <li>{t('streamingConsentNotice.dmca')}</li>
            <li>{t('streamingConsentNotice.authorizedUse')}</li>
            <li>{t('streamingConsentNotice.noBypass')}</li>
            <li>{t('streamingConsentNotice.localFirst')}</li>
            <li>{t('streamingConsentNotice.uninstall')}</li>
            <li>{t('streamingConsentNotice.disclaimer')}</li>
          </ul>
          <p>{t('streamingConsentNotice.acceptance')}</p>
        </div>
        <label className="settings-danger-confirm-field settings-streaming-notice-confirm">
          <span>{t('streamingConsentNotice.inputLabel', { phrase: consentPhrase })}</span>
          <input
            value={consent}
            onChange={(event) => setConsent(event.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </label>
        <div className="settings-streaming-notice-actions">
          <button className="settings-action-button" type="button" onClick={handleCancel}>
            {t('streamingConsentNotice.cancel')}
          </button>
          <button className="settings-danger-button" type="button" disabled={!canConfirm} onClick={handleConfirm}>
            {t('streamingConsentNotice.confirm')}
          </button>
        </div>
      </section>
    </div>
  );
};
