import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ListMusic, Monitor, Moon, SlidersHorizontal } from 'lucide-react';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { PlayerControlIcon } from './PlayerControlIcon';

type Props = {
  children: ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenQueue?: () => void;
  sleepPanel?: (isVisible: boolean) => ReactNode;
  windowControls: ReactNode;
};

type Pane = 'controls' | 'sleep' | 'tools';

/** Presents existing host-backed controls in the Steam player's compact tabbed shell. */
export const PlayerUtilitiesPopover = ({ children, isOpen, onOpenChange, onOpenQueue, sleepPanel, windowControls }: Props): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [activePane, setActivePane] = useState<Pane>('controls');
  const [sleepPanelMounted, setSleepPanelMounted] = useState(false);
  const label = t('app.toolbar.quickActions');
  const panes = [
    { id: 'controls' as const, label: t('settings.nav.playback.label'), Icon: SlidersHorizontal },
    ...(sleepPanel ? [{ id: 'sleep' as const, label: t('settings.appearance.playerBarButtons.sleepTimer'), Icon: Moon }] : []),
    { id: 'tools' as const, label, Icon: Monitor },
  ];
  const selectedPane = panes.some((pane) => pane.id === activePane) ? activePane : 'controls';

  useEffect(() => {
    if (isOpen && selectedPane === 'sleep') setSleepPanelMounted(true);
  }, [isOpen, selectedPane]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      buttonRef.current?.focus();
    };
    window.addEventListener('pointerdown', closeOutside);
    // Capture before the app's Escape navigation handler can leave the current page.
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [isOpen, onOpenChange]);

  return (
    <div className="player-utilities" ref={rootRef}>
      <button ref={buttonRef} className="icon-button" type="button" aria-label={label} title={label}
        aria-haspopup="dialog" aria-expanded={isOpen} aria-controls={panelId}
        onClick={() => onOpenChange(!isOpen)}>
        <PlayerControlIcon name="controls" />
      </button>
      <div id={panelId} className="player-utilities-panel" role="dialog" aria-label={label} hidden={!isOpen}>
        <div className="player-utilities-tabs" role="tablist" aria-label={label}>
          {panes.map(({ id, label: paneLabel, Icon }, index) => (
            <button key={id} id={`${panelId}-${id}-tab`} role="tab" type="button"
              aria-selected={selectedPane === id} aria-controls={`${panelId}-${id}`} tabIndex={selectedPane === id ? 0 : -1}
              onClick={() => setActivePane(id)} onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? panes.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + panes.length) % panes.length;
                setActivePane(panes[next].id);
                document.getElementById(`${panelId}-${panes[next].id}-tab`)?.focus();
              }}>
              <Icon size={14} /><span>{paneLabel}</span>
            </button>
          ))}
        </div>
        <div className="player-utilities-pane player-utilities-controls" id={`${panelId}-controls`} role="tabpanel"
          aria-labelledby={`${panelId}-controls-tab`} hidden={selectedPane !== 'controls'}>{children}</div>
        {sleepPanel ? <div className="player-utilities-pane" id={`${panelId}-sleep`} role="tabpanel"
          aria-labelledby={`${panelId}-sleep-tab`} hidden={selectedPane !== 'sleep'}>
          {sleepPanelMounted || (isOpen && selectedPane === 'sleep') ? sleepPanel(isOpen && selectedPane === 'sleep') : null}
        </div> : null}
        <div className="player-utilities-pane player-utilities-tools" id={`${panelId}-tools`} role="tabpanel"
          aria-labelledby={`${panelId}-tools-tab`} hidden={selectedPane !== 'tools'}>
          {windowControls}
          {onOpenQueue ? <button className="player-utility-action" type="button" onClick={() => { onOpenChange(false); onOpenQueue(); }}>
            <ListMusic size={17} /><span>{t('playerTransport.action.queue')}</span>
          </button> : null}
        </div>
      </div>
    </div>
  );
};
