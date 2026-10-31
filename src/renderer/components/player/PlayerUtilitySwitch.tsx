import type { MouseEventHandler, ReactNode } from 'react';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';

type Props = {
  label: string;
  icon: ReactNode;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  onContextMenu?: MouseEventHandler<HTMLButtonElement>;
};

export const PlayerUtilitySwitch = ({ label, icon, checked, disabled, title, onClick, onContextMenu }: Props): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  return (
    <button className="player-utility-action player-utility-toggle" type="button" role="switch"
      aria-label={label} aria-checked={checked} disabled={disabled} title={title ?? label}
      onClick={onClick} onContextMenu={onContextMenu}>
      {icon}
      <span className="player-utility-toggle-label">{label}</span>
      <span className="player-utility-toggle-status">{t(checked ? 'firstRun.feature.enabled' : 'settings.about.updates.state.disabled')}</span>
      <span className="player-utility-toggle-track" aria-hidden="true"><span className="player-utility-toggle-thumb" /></span>
    </button>
  );
};
