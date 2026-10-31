import {
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  RotateCcw,
} from 'lucide-react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { PlayerBarButtonId } from '../../../../shared/types/appSettings';
import type { SidebarRouteId } from '../../../../shared/types/sidebar';
import type { TranslationKey } from '../../../i18n/locales';
import { SettingRow } from '../components/SettingsPrimitives';
import {
  lockedHiddenSidebarRouteIdSet,
  lockedVisibleSidebarRouteIdSet,
  playerBarButtonSettingsCopy,
  playerBarButtonSettingsItems,
  sidebarSettingsCopy,
  type SidebarSettingsRouteItem,
} from './navigationCustomizationModel';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type SidebarSettingsGroups = Record<
  SidebarSettingsRouteItem['placement'],
  SidebarSettingsRouteItem[]
>;

type SidebarLayoutSettingsProps = {
  available: boolean;
  connectProLocked: boolean;
  draggingRouteId: SidebarRouteId | null;
  expanded: boolean;
  groups: SidebarSettingsGroups;
  hiddenRouteIds: ReadonlySet<SidebarRouteId>;
  highlighted: boolean;
  onDragEnd: () => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragStart: (
    event: ReactDragEvent<HTMLDivElement>,
    routeId: SidebarRouteId,
  ) => void;
  onDrop: (
    event: ReactDragEvent<HTMLDivElement>,
    routeId: SidebarRouteId,
    placement: SidebarSettingsRouteItem['placement'],
  ) => void;
  onExpandedToggle: () => void;
  onReset: () => void;
  onVisibilityToggle: (routeId: SidebarRouteId) => void;
  summary: string;
  t: Translate;
};

export const SidebarLayoutSettings = ({
  available,
  connectProLocked,
  draggingRouteId,
  expanded,
  groups,
  hiddenRouteIds,
  highlighted,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onExpandedToggle,
  onReset,
  onVisibilityToggle,
  summary,
  t,
}: SidebarLayoutSettingsProps): JSX.Element => {
  const text = {
    title: t(sidebarSettingsCopy.titleKey),
    description: t(sidebarSettingsCopy.descriptionKey),
    mainGroup: t(sidebarSettingsCopy.mainGroupKey),
    utilityGroup: t(sidebarSettingsCopy.utilityGroupKey),
    reset: t(sidebarSettingsCopy.resetKey),
    expand: t(sidebarSettingsCopy.expandKey),
    collapse: t(sidebarSettingsCopy.collapseKey),
    visible: t(sidebarSettingsCopy.visibleKey),
    hidden: t(sidebarSettingsCopy.hiddenKey),
    fixed: t(sidebarSettingsCopy.fixedKey),
    proLocked: t(sidebarSettingsCopy.proLockedKey),
    noItems: t(sidebarSettingsCopy.noItemsKey),
  };

  return (
    <SettingRow
      className="setting-row--full"
      id="settings-row-sidebar-layout"
      highlighted={highlighted}
      title={text.title}
      description={text.description}
    >
      <div className="settings-sidebar-layout-panel">
        <div className="settings-sidebar-layout-toolbar">
          <button
            aria-expanded={expanded}
            className="settings-sidebar-layout-toggle"
            type="button"
            disabled={!available}
            onClick={onExpandedToggle}
          >
            <ChevronDown size={16} />
            <span>{summary}</span>
            <em>{expanded ? text.collapse : text.expand}</em>
          </button>
          <button
            className="settings-action-button"
            type="button"
            disabled={!available}
            onClick={onReset}
          >
            <RotateCcw size={15} />
            {text.reset}
          </button>
        </div>
        {expanded
          ? (['main', 'utility'] as const).map((placement) => {
              const groupItems = groups[placement];

              return (
                <section className="settings-sidebar-layout-group" key={placement}>
                  <div className="settings-sidebar-layout-group-title">
                    <strong>{placement === 'main' ? text.mainGroup : text.utilityGroup}</strong>
                    <span>
                      {t('settings.appearance.sidebar.count', { count: groupItems.length })}
                    </span>
                  </div>
                  <div className="settings-sidebar-route-list">
                    {groupItems.length > 0 ? (
                      groupItems.map((item) => {
                        const label = t(item.labelKey);
                        const isLockedVisible = lockedVisibleSidebarRouteIdSet.has(item.id);
                        const isLockedHidden = lockedHiddenSidebarRouteIdSet.has(item.id);
                        const isProLocked = item.id === 'connect' && connectProLocked;
                        const isVisible =
                          isLockedVisible ||
                          (!isLockedHidden && !hiddenRouteIds.has(item.id));
                        const isEffectivelyVisible = isVisible && !isProLocked;
                        const isFixed = isLockedVisible || isLockedHidden || isProLocked;
                        const statusLabel = isProLocked
                          ? text.proLocked
                          : isFixed
                            ? text.fixed
                            : isVisible
                              ? text.visible
                              : text.hidden;
                        const visibilityAriaLabel = isProLocked
                          ? t('settings.appearance.sidebar.proLockedAria', { label })
                          : isVisible
                            ? t('settings.appearance.sidebar.hideAria', { label })
                            : t('settings.appearance.sidebar.showAria', { label });

                        return (
                          <div
                            className="settings-sidebar-route-item"
                            data-dragging={draggingRouteId === item.id ? 'true' : undefined}
                            data-hidden={isEffectivelyVisible ? undefined : 'true'}
                            draggable={available}
                            key={item.id}
                            onDragEnd={onDragEnd}
                            onDragOver={onDragOver}
                            onDragStart={(event) => onDragStart(event, item.id)}
                            onDrop={(event) => onDrop(event, item.id, placement)}
                          >
                            <span
                              className="settings-sidebar-route-drag-handle"
                              aria-hidden="true"
                            >
                              <GripVertical size={15} />
                            </span>
                            <span className="settings-sidebar-route-copy">
                              <strong>{label}</strong>
                              <em>{statusLabel}</em>
                            </span>
                            <span className="settings-sidebar-route-actions">
                              <button
                                aria-label={visibilityAriaLabel}
                                aria-pressed={isEffectivelyVisible}
                                className="settings-icon-button settings-sidebar-visibility-button"
                                disabled={!available || isFixed}
                                title={statusLabel}
                                type="button"
                                onClick={() => onVisibilityToggle(item.id)}
                              >
                                {isProLocked ? (
                                  <Lock size={15} />
                                ) : isVisible ? (
                                  <Eye size={15} />
                                ) : (
                                  <EyeOff size={15} />
                                )}
                              </button>
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <p className="settings-sidebar-layout-empty">{text.noItems}</p>
                    )}
                  </div>
                </section>
              );
            })
          : null}
      </div>
    </SettingRow>
  );
};

type PlayerBarButtonSettingsProps = {
  available: boolean;
  hiddenButtonIds: ReadonlySet<PlayerBarButtonId>;
  highlighted: boolean;
  onReset: () => void;
  onVisibilityToggle: (buttonId: PlayerBarButtonId) => void;
  t: Translate;
};

export const PlayerBarButtonSettings = ({
  available,
  hiddenButtonIds,
  highlighted,
  onReset,
  onVisibilityToggle,
  t,
}: PlayerBarButtonSettingsProps): JSX.Element => {
  const visibleCount = playerBarButtonSettingsItems.length - hiddenButtonIds.size;
  const text = {
    title: t(playerBarButtonSettingsCopy.titleKey),
    description: t(playerBarButtonSettingsCopy.descriptionKey),
    count: t(playerBarButtonSettingsCopy.countKey, { count: visibleCount }),
    reset: t(playerBarButtonSettingsCopy.resetKey),
    visible: t(playerBarButtonSettingsCopy.visibleKey),
    hidden: t(playerBarButtonSettingsCopy.hiddenKey),
  };

  return (
    <SettingRow
      className="setting-row--full setting-row--compact-panel"
      id="settings-row-player-bar-buttons"
      highlighted={highlighted}
      title={text.title}
      description={text.description}
    >
      <div className="settings-sidebar-layout-editor">
        <div className="settings-sidebar-layout-toolbar">
          <span className="settings-inline-note">{text.count}</span>
          <button
            className="settings-action-button"
            type="button"
            disabled={!available}
            onClick={onReset}
          >
            <RotateCcw size={15} />
            {text.reset}
          </button>
        </div>
        <div className="settings-sidebar-route-list">
          {playerBarButtonSettingsItems.map((item) => {
            const label = t(item.labelKey);
            const isVisible = !hiddenButtonIds.has(item.id);
            const Icon = item.icon;

            return (
              <div
                className="settings-sidebar-route-item"
                data-hidden={isVisible ? undefined : 'true'}
                key={item.id}
              >
                <span className="settings-sidebar-route-drag-handle" aria-hidden="true">
                  <Icon size={15} />
                </span>
                <span className="settings-sidebar-route-copy">
                  <strong>{label}</strong>
                  <em>{t(item.descriptionKey)}</em>
                </span>
                <span className="settings-sidebar-route-actions">
                  <button
                    aria-label={`${label} ${isVisible ? text.visible : text.hidden}`}
                    aria-pressed={isVisible}
                    className="settings-icon-button settings-sidebar-visibility-button"
                    disabled={!available}
                    title={isVisible ? text.visible : text.hidden}
                    type="button"
                    onClick={() => onVisibilityToggle(item.id)}
                  >
                    {isVisible ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </SettingRow>
  );
};
