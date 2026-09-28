import { createContext, useContext, useId, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SettingsNavKey } from '../settingsTypes';
import { SettingHelpTooltip } from './SettingHelpTooltip';

// Keep destructive-action warnings visible, including in extracted sections.
const CompactSettingsHelp = createContext(true);
const SettingTitleId = createContext<string | undefined>(undefined);

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
  descriptionInline?: boolean;
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
    <CompactSettingsHelp.Provider value={id !== 'danger'}>
      <section className="settings-section settings-section--panel" id={`settings-sec-${id}`} data-visible={isActive}>
        {!hideHeader ? (
          <div className="section-title">
            <span className="section-title-icon">
              <Icon size={18} />
            </span>
            <div className="section-title-copy">
              {context ? <span className="section-title-context">{context}</span> : null}
              <div className="setting-info-heading">
                <h2>{title}</h2>
                {description && id !== 'danger' ? <SettingHelpTooltip label={title}>{description}</SettingHelpTooltip> : null}
              </div>
              {description && id === 'danger' ? <p>{description}</p> : null}
            </div>
            {actions ? <div className="section-title-actions">{actions}</div> : null}
          </div>
        ) : null}
        {isActive ? children : null}
      </section>
    </CompactSettingsHelp.Provider>
  );
};

export const SettingRow = ({
  className,
  highlighted,
  id,
  leadingIcon: LeadingIcon,
  title,
  description,
  descriptionInline = false,
  children,
}: SettingRowProps): JSX.Element => {
  const compact = useContext(CompactSettingsHelp);
  const titleId = useId();
  // Rich descriptions can contain live warnings or interactive content.
  const useHelp = compact && !descriptionInline && typeof description === 'string' && Boolean(description);
  return (
    <div className={`setting-row ${className ?? ''}`.trim()} id={id} data-search-highlight={highlighted ? 'true' : undefined}>
      <div className="setting-info">
        {LeadingIcon ? (
          <span className="setting-info-icon" aria-hidden="true">
            <LeadingIcon size={15} />
          </span>
        ) : null}
        <div className="setting-info-copy">
          <div className="setting-info-heading">
            <h3 id={titleId}>{title}</h3>
            {useHelp ? <SettingHelpTooltip label={typeof title === 'string' ? title : description as string}>{description}</SettingHelpTooltip> : null}
          </div>
          {!useHelp && description ? <p>{description}</p> : null}
        </div>
      </div>
      <SettingTitleId.Provider value={titleId}>{children}</SettingTitleId.Provider>
    </div>
  );
};

export const SettingSubsectionTitle = ({ id, title, description }: SettingSubsectionTitleProps): JSX.Element => {
  const compact = useContext(CompactSettingsHelp);
  return (
    <div className="settings-subsection-title" id={id}>
      <span>{title}</span>
      {description ? compact ? <SettingHelpTooltip label={title}>{description}</SettingHelpTooltip> : <small>{description}</small> : null}
    </div>
  );
};

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
  active = false,
  ariaLabel,
  disabled,
  onClick,
}: {
  active?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  onClick?: () => void;
}): JSX.Element => {
  const titleId = useContext(SettingTitleId);
  return (
    <button className={`toggle-btn ${active ? 'active' : ''}`} type="button" aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : titleId} aria-pressed={active} disabled={disabled} onClick={onClick}>
      <span />
    </button>
  );
};

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
