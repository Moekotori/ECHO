import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SettingsNavKey } from '../settingsTypes';

export type SettingSubsectionTitleProps = {
  id?: string;
  title: string;
  description?: string;
};

type SettingSectionProps = {
  id: SettingsNavKey;
  activeKey: SettingsNavKey;
  icon: LucideIcon;
  title: string;
  hideHeader?: boolean;
  context?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

type SettingRowProps = {
  className?: string;
  id?: string;
  highlighted?: boolean;
  leadingIcon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
};

export const SettingSection = ({
  id,
  activeKey,
  icon: Icon,
  title,
  hideHeader = false,
  context,
  description,
  actions,
  children,
}: SettingSectionProps): JSX.Element => {
  const isActive = activeKey === id;

  return (
    <section className="settings-section settings-section--panel" id={`settings-sec-${id}`} data-visible={isActive}>
      {!hideHeader ? (
        <div className="section-title">
          <span className="section-title-icon">
            <Icon size={18} />
          </span>
          <div className="section-title-copy">
            {context ? <span className="section-title-context">{context}</span> : null}
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="section-title-actions">{actions}</div> : null}
        </div>
      ) : null}
      {isActive ? children : null}
    </section>
  );
};

export const SettingRow = ({
  className,
  highlighted,
  id,
  leadingIcon: LeadingIcon,
  title,
  description,
  children,
}: SettingRowProps): JSX.Element => (
  <div className={`setting-row ${className ?? ''}`.trim()} id={id} data-search-highlight={highlighted ? 'true' : undefined}>
    <div className="setting-info">
      {LeadingIcon ? (
        <span className="setting-info-icon" aria-hidden="true">
          <LeadingIcon size={15} />
        </span>
      ) : null}
      <div className="setting-info-copy">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
    </div>
    {children}
  </div>
);

export const SettingSubsectionTitle = ({ id, title, description }: SettingSubsectionTitleProps): JSX.Element => (
  <div className="settings-subsection-title" id={id}>
    <span>{title}</span>
    {description ? <small>{description}</small> : null}
  </div>
);

export const ChipButton = ({
  active,
  children,
  disabled,
  onClick,
  title,
}: {
  active?: boolean;
  children: string;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}): JSX.Element => (
  <button className={`list-filter-chip ${active ? 'active' : ''}`} type="button" aria-pressed={active} disabled={disabled} title={title} onClick={onClick}>
    {children}
    {active ? <Check size={13} /> : null}
  </button>
);

export const StatusText = ({
  children,
  tone = 'neutral',
}: {
  children: string;
  tone?: 'neutral' | 'good' | 'muted';
}): JSX.Element => <span className={`settings-status-text settings-status-text--${tone}`}>{children}</span>;

export const ToggleButton = ({
  active,
  ariaLabel,
  disabled,
  onClick,
}: {
  active?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  onClick?: () => void;
}): JSX.Element => (
  <button className={`toggle-btn ${active ? 'active' : ''}`} type="button" aria-label={ariaLabel} aria-pressed={active} disabled={disabled} onClick={onClick}>
    <span />
  </button>
);

export const NumberRangeField = ({
  disabled = false,
  max,
  min,
  onChange,
  step,
  suffix,
  value,
}: {
  disabled?: boolean;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix: string;
  value: number;
}): JSX.Element => (
  <label className="settings-range-field">
    <input disabled={disabled} min={min} max={max} step={step} type="range" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    <span>
      {value}
      {suffix}
    </span>
  </label>
);
