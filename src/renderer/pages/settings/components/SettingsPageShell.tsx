import { ChevronLeft, ChevronRight } from 'lucide-react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
} from 'react';
import type { Locale, TranslationKey } from '../../../i18n/locales';
import type { SettingsNavGroup, SettingsNavItem } from '../settingsNavigation';
import type { SettingsSearchResult } from '../settingsSearch';
import { settingsLocaleCopy } from '../settingsSubsections';
import type { SettingsNavKey } from '../settingsTypes';
import { SettingHelpTooltip } from './SettingHelpTooltip';
import { SettingsSearchBox } from './SettingsSearchBox';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type SettingsHeaderProps = {
  activeNavItem: SettingsNavItem;
  activeResultIndex: number;
  inputRef: MutableRefObject<HTMLInputElement | null>;
  onActiveResultIndexChange: (index: number) => void;
  onQueryChange: (query: string) => void;
  onResultSelect: (result: SettingsSearchResult) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  query: string;
  searchResults: SettingsSearchResult[];
  t: Translate;
  visibleSearchResults: SettingsSearchResult[];
};

export const SettingsHeader = ({
  activeNavItem,
  activeResultIndex,
  inputRef,
  onActiveResultIndexChange,
  onQueryChange,
  onResultSelect,
  onSearchKeyDown,
  query,
  t,
  visibleSearchResults,
}: SettingsHeaderProps): JSX.Element => {
  const ActiveNavIcon = activeNavItem.icon;

  return (
    <header className="settings-header">
      <div className="settings-header-copy">
        <h1>{t('route.settings.label')}</h1>
        <div className="settings-header-context">
          <span className="settings-header-context-icon">
            <ActiveNavIcon size={14} aria-hidden="true" />
          </span>
          <span>{t(activeNavItem.labelKey)}</span>
          <SettingHelpTooltip key={activeNavItem.key} label={t(activeNavItem.labelKey)}>
            {t(activeNavItem.descriptionKey)}
          </SettingHelpTooltip>
        </div>
      </div>
      <SettingsSearchBox
        activeResultIndex={activeResultIndex}
        inputRef={inputRef}
        onActiveResultIndexChange={onActiveResultIndexChange}
        onQueryChange={onQueryChange}
        onResultSelect={onResultSelect}
        onSearchKeyDown={onSearchKeyDown}
        query={query}
        t={t}
        visibleSearchResults={visibleSearchResults}
      />
    </header>
  );
};

export type SettingsNavViewGroup = SettingsNavGroup & {
  items: SettingsNavItem[];
};

type SettingsNavigationProps = {
  activeSection: SettingsNavKey;
  groups: SettingsNavViewGroup[];
  locale: Locale;
  onNavigate: (key: SettingsNavKey) => void;
  t: Translate;
};

export const SettingsNavigation = ({
  activeSection,
  groups,
  locale,
  onNavigate,
  t,
}: SettingsNavigationProps): JSX.Element => (
  <nav className="settings-nav" aria-label={t('route.settings.label')}>
    {groups.map((group) => (
      <div className="settings-nav-group" key={group.id}>
        <span className="settings-nav-group-label">
          {settingsLocaleCopy(locale, group.label)}
        </span>
        {group.items.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.key;
          const isDanger = item.key === 'danger';

          return (
            <button
              className={`settings-nav-item ${isActive ? 'active' : ''} ${isDanger ? 'is-danger' : ''}`}
              key={item.key}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onNavigate(item.key)}
            >
              <span className="settings-nav-icon">
                <Icon size={17} />
              </span>
              <span className="settings-nav-copy">
                <span className="settings-nav-label">{t(item.labelKey)}</span>
                <span className="settings-nav-desc">{t(item.descriptionKey)}</span>
              </span>
            </button>
          );
        })}
      </div>
    ))}
  </nav>
);

type SettingsHorizontalPagerProps = {
  canLeft: boolean;
  canRight: boolean;
  onScroll: (direction: -1 | 1) => void;
};

export const SettingsHorizontalPager = ({
  canLeft,
  canRight,
  onScroll,
}: SettingsHorizontalPagerProps): JSX.Element => (
  <>
    <button
      className="settings-horizontal-pager settings-horizontal-pager--left"
      type="button"
      aria-label="向左翻动设置内容"
      disabled={!canLeft}
      onClick={() => onScroll(-1)}
    >
      <ChevronLeft size={18} aria-hidden="true" />
    </button>
    <button
      className="settings-horizontal-pager settings-horizontal-pager--right"
      type="button"
      aria-label="向右翻动设置内容"
      disabled={!canRight}
      onClick={() => onScroll(1)}
    >
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  </>
);

export type SettingsSectionIndexItem = {
  id: string;
  label: string;
};

type SettingsSectionIndexProps = {
  activeId: string | null;
  ariaLabel: string;
  items: SettingsSectionIndexItem[];
  onSelect: (id: string) => void;
};

export const SettingsSectionIndex = ({
  activeId,
  ariaLabel,
  items,
  onSelect,
}: SettingsSectionIndexProps): JSX.Element => (
  <aside className="settings-section-index" aria-label={ariaLabel}>
    {items.map((item) => (
      <button
        className="settings-section-index-item"
        aria-current={item.id === activeId ? 'location' : undefined}
        data-active={item.id === activeId ? 'true' : undefined}
        key={item.id}
        title={item.label}
        type="button"
        onClick={() => onSelect(item.id)}
      >
        <span aria-hidden="true" />
        {item.label}
      </button>
    ))}
  </aside>
);
