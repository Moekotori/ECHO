import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { SteamEditionOverview } from '../common/SteamEditionOverview';
import { useI18n } from '../../i18n/I18nProvider';
import type { Locale } from '../../i18n/locales';
import '../../styles/steam-edition-welcome.css';

// A one-time Steam introduction for existing community-edition installations.
const promoStorageKey = 'echo:steam-edition-promo:2026-09';

const copy: Record<Locale, { label: string; close: string }> = {
  'zh-CN': { label: 'ECHO Steam 版介绍', close: '关闭 Steam 版介绍' },
  'zh-TW': { label: 'ECHO Steam 版介紹', close: '關閉 Steam 版介紹' },
  'en-US': { label: 'ECHO Steam edition introduction', close: 'Close Steam edition introduction' },
  'ja-JP': { label: 'ECHO Steam 版の紹介', close: 'Steam 版の紹介を閉じる' },
  'ko-KR': { label: 'ECHO Steam 버전 소개', close: 'Steam 버전 소개 닫기' },
};

export const SteamEditionWelcome = (): JSX.Element | null => {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const app = window.echo?.app;
    if (!app?.getSettings || !app.getVersion) return;
    let cancelled = false;

    void Promise.all([app.getSettings(), app.getVersion()])
      .then(([settings, version]) => {
        if (cancelled || !version || typeof settings?.onboardingCompleted !== 'boolean') return;
        try {
          if (window.localStorage.getItem(promoStorageKey)) return;
          if (!settings.onboardingCompleted) {
            // New users have the first-run wizard. Do not interrupt them after setup.
            window.localStorage.setItem(promoStorageKey, 'seen');
            return;
          }
          setOpen(true);
        } catch {
          // Avoid a promotion that would repeat on every launch.
        }
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        dismiss();
      } else if (event.key === 'Tab') {
        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        const first = buttons?.[0];
        const last = buttons?.[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const dismiss = (): void => {
    try { window.localStorage.setItem(promoStorageKey, 'seen'); } catch { /* Storage can be unavailable. */ }
    setOpen(false);
  };

  if (!open) return null;
  const c = copy[locale];
  return (
    <div className="steam-edition-welcome-backdrop" role="presentation" onMouseDown={dismiss}>
      <section ref={dialogRef} className="steam-edition-welcome" role="dialog" aria-modal="true" aria-label={c.label} onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeButtonRef} className="steam-edition-welcome__close" type="button" aria-label={c.close} onClick={dismiss}><X size={18} aria-hidden="true" /></button>
        <SteamEditionOverview />
      </section>
    </div>
  );
};
