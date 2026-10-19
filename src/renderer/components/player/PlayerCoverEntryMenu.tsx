import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Captions, Check, Clapperboard } from 'lucide-react';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';

export type PlayerCoverEntryMenuProps = {
  position: { x: number; y: number };
  opensMv: boolean;
  onClose: () => void;
};

/** Changes only the cover shortcut; playback and the current page stay untouched. */
export const PlayerCoverEntryMenu = ({ position, opensMv, onClose }: PlayerCoverEntryMenuProps): JSX.Element => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? translateFallback;
  const menuRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(position);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setOffset({
      x: Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8)),
    });
    menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [position]);

  useEffect(() => {
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const select = async (playerBarCoverOpensMv: boolean): Promise<void> => {
    if (saving) return;
    if (playerBarCoverOpensMv === opensMv) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await window.echo.app.setSettings({ playerBarCoverOpensMv });
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: { playerBarCoverOpensMv } }));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  };

  return createPortal(
    <div className="album-menu-layer" role="presentation" onMouseDown={onClose}>
      <div
        ref={menuRef}
        className="album-context-menu"
        role="menu"
        aria-label={t('settings.appearance.playerBarCoverOpensMv.title')}
        style={{ left: offset.x, top: offset.y }}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            event.stopPropagation();
            onClose();
          } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + 1) % buttons.length]?.focus();
          }
        }}
      >
        {[false, true].map((mv) => {
          const Icon = mv ? Clapperboard : Captions;
          return (
            <button
              key={String(mv)}
              className="album-menu-item"
              style={{ gridTemplateColumns: '20px minmax(0, 1fr) 16px' }}
              type="button"
              role="menuitemradio"
              aria-checked={opensMv === mv}
              disabled={saving}
              onClick={() => void select(mv)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{t(mv ? 'playerBar.aria.openMv' : 'playerBar.aria.openLyrics')}</span>
              {opensMv === mv ? <Check size={16} aria-hidden="true" /> : null}
            </button>
          );
        })}
        {error ? <div role="alert">{error}</div> : null}
      </div>
    </div>,
    document.body,
  );
};
