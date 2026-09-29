import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, ChevronsLeft, Eye, EyeOff, GripVertical, LockKeyhole, SlidersHorizontal, X } from 'lucide-react';
import { preloadAppRoute, type AppRoute, type AppRouteId } from '../../app/routes';
import { useI18n } from '../../i18n/I18nProvider';
import { isSidebarRouteId, lockedVisibleSidebarRouteIds, type SidebarRouteId } from '../../../shared/types/sidebar';
import { pendingSettingsSectionStorageKey, settingsSectionNavigationEvent } from '../../pages/settings/settingsNavigation';

type SidebarProps = {
  routes: AppRoute[];
  activeRouteId: AppRouteId;
  onRouteChange: (routeId: AppRouteId) => void;
  onOpenAudioSettings: () => void;
  onOpenLyricsSettings: () => void;
  onImportFolder: () => void;
  onImportFile: () => void;
  iconOnly?: boolean;
  hiddenRouteIds?: SidebarRouteId[];
  onToggleIconOnly?: () => void;
  onHideRoute?: (routeId: SidebarRouteId) => void;
  onShowRoute?: (routeId: SidebarRouteId) => void;
  onReorderRoutes?: (routeIds: SidebarRouteId[], placement: AppRoute['placement']) => void;
};

type SidebarMenuState = {
  routeId: SidebarRouteId;
  label: string;
  position: { x: number; y: number };
};

type SidebarGroupId = 'library' | 'sources' | 'playback' | 'preferences';

type SidebarGroup = {
  id: SidebarGroupId;
  labelKey: 'sidebar.group.library' | 'sidebar.group.sources' | 'sidebar.group.playback' | 'sidebar.group.preferences';
  routes: AppRoute[];
  utility?: boolean;
};

const libraryRouteIds = new Set<AppRouteId>([
  'home',
  'songs',
  'downloads',
  'osu-downloader',
  'albums',
  'artists',
  'folders',
  'audio-cd',
]);
const sourceRouteIds = new Set<AppRouteId>(['remote', 'connect', 'dsp', 'streaming']);
const lockedVisibleRouteIdSet = new Set<SidebarRouteId>(lockedVisibleSidebarRouteIds);

const resolveMainGroupId = (routeId: AppRouteId): Exclude<SidebarGroupId, 'preferences'> => {
  if (libraryRouteIds.has(routeId)) {
    return 'library';
  }

  if (sourceRouteIds.has(routeId)) {
    return 'sources';
  }

  return 'playback';
};

const viewportPadding = 8;
const pointerOffset = 6;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

const renderNavIcon = (Icon: AppRoute['icon'], size: number): JSX.Element => (
  <span className="nav-icon-shell" aria-hidden="true">
    <Icon size={size} strokeWidth={1.55} aria-hidden="true" focusable="false" />
  </span>
);

export const Sidebar = ({
  routes,
  activeRouteId,
  onRouteChange,
  onOpenAudioSettings,
  onOpenLyricsSettings,
  onImportFolder,
  onImportFile,
  iconOnly = false,
  hiddenRouteIds = [],
  onToggleIconOnly,
  onHideRoute,
  onShowRoute,
  onReorderRoutes,
}: SidebarProps): JSX.Element => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuState, setMenuState] = useState<SidebarMenuState | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isEditing, setIsEditing] = useState(false);
  const [draggingRouteId, setDraggingRouteId] = useState<SidebarRouteId | null>(null);
  const hiddenRouteIdSet = useMemo(() => new Set(hiddenRouteIds), [hiddenRouteIds]);
  const renderedRoutes = routes.filter(
    (route) => !route.hideFromSidebar || (isEditing && isSidebarRouteId(route.id) && hiddenRouteIdSet.has(route.id)),
  );
  const mainRoutes = renderedRoutes.filter((route) => route.placement === 'main');
  const utilityRoutes = renderedRoutes.filter((route) => route.placement === 'utility');
  const groups = useMemo<SidebarGroup[]>(() => {
    const groupedMainRoutes: Record<Exclude<SidebarGroupId, 'preferences'>, AppRoute[]> = {
      library: [],
      sources: [],
      playback: [],
    };

    for (const route of mainRoutes) {
      groupedMainRoutes[resolveMainGroupId(route.id)].push(route);
    }

    const nextGroups: SidebarGroup[] = [
      { id: 'library', labelKey: 'sidebar.group.library', routes: groupedMainRoutes.library },
      { id: 'sources', labelKey: 'sidebar.group.sources', routes: groupedMainRoutes.sources },
      { id: 'playback', labelKey: 'sidebar.group.playback', routes: groupedMainRoutes.playback },
      { id: 'preferences', labelKey: 'sidebar.group.preferences', routes: utilityRoutes, utility: true },
    ];

    return nextGroups.filter((group) => group.routes.length > 0);
  }, [mainRoutes, utilityRoutes]);
  const routeById = useMemo(() => new Map(renderedRoutes.map((route) => [route.id, route])), [renderedRoutes]);
  const handleUtilityRouteClick = (routeId: AppRouteId): void => {
    if (routeId === 'audio-settings') {
      onOpenAudioSettings();
      return;
    }

    if (routeId === 'lyrics-settings') {
      onOpenLyricsSettings();
      return;
    }

    if (routeId === 'import-folder') {
      onImportFolder();
      return;
    }

    if (routeId === 'import-file') {
      onImportFile();
      return;
    }

    onRouteChange(routeId);
  };

  const openSteamSection = (): void => {
    try {
      window.sessionStorage.setItem(pendingSettingsSectionStorageKey, 'steam');
    } catch {
      // The navigation event still works when Settings is already mounted.
    }
    onRouteChange('settings');
    window.dispatchEvent(new CustomEvent(settingsSectionNavigationEvent, { detail: { section: 'steam' } }));
  };

  const closeMenu = (): void => setMenuState(null);

  useLayoutEffect(() => {
    if (!menuState || !menuRef.current) {
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    setMenuPosition({
      x: clamp(menuState.position.x + pointerOffset, viewportPadding, window.innerWidth - rect.width - viewportPadding),
      y: clamp(menuState.position.y + pointerOffset, viewportPadding, window.innerHeight - rect.height - viewportPadding),
    });
  }, [menuState]);

  useEffect(() => {
    if (!menuState) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    document.addEventListener('pointerdown', closeMenu);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      document.removeEventListener('pointerdown', closeMenu);
    };
  }, [menuState]);

  const openRouteMenu = (event: ReactMouseEvent<HTMLButtonElement>, route: AppRoute, label: string): void => {
    if (!isSidebarRouteId(route.id)) {
      return;
    }

    event.preventDefault();
    setMenuState({
      routeId: route.id,
      label,
      position: { x: event.clientX, y: event.clientY },
    });
  };

  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>, routeId: AppRouteId): void => {
    if (!isEditing || !isSidebarRouteId(routeId)) {
      event.preventDefault();
      return;
    }

    setDraggingRouteId(routeId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', routeId);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLButtonElement>): void => {
    if (!isEditing) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (event: ReactDragEvent<HTMLButtonElement>, targetRoute: AppRoute): void => {
    if (!isEditing || !isSidebarRouteId(targetRoute.id)) {
      return;
    }

    event.preventDefault();
    const draggedRouteId = (event.dataTransfer.getData('text/plain') || draggingRouteId) as SidebarRouteId | null;
    setDraggingRouteId(null);
    if (!draggedRouteId || draggedRouteId === targetRoute.id) {
      return;
    }

    const draggedRoute = routeById.get(draggedRouteId);
    if (!draggedRoute || draggedRoute.placement !== targetRoute.placement) {
      return;
    }

    const groupIds = renderedRoutes
      .filter((route) => route.placement === targetRoute.placement && isSidebarRouteId(route.id))
      .map((route) => route.id as SidebarRouteId);
    const draggedIndex = groupIds.indexOf(draggedRouteId);
    const targetIndex = groupIds.indexOf(targetRoute.id);
    if (draggedIndex < 0 || targetIndex < 0) {
      return;
    }

    const targetBounds = event.currentTarget.getBoundingClientRect();
    const insertAfterTarget = event.clientY > targetBounds.top + targetBounds.height / 2;
    let targetInsertIndex = targetIndex + (insertAfterTarget ? 1 : 0);
    const nextGroupIds = groupIds.filter((id) => id !== draggedRouteId);
    if (draggedIndex < targetInsertIndex) {
      targetInsertIndex -= 1;
    }
    if (targetInsertIndex === draggedIndex) {
      return;
    }

    nextGroupIds.splice(targetInsertIndex, 0, draggedRouteId);
    onReorderRoutes?.(nextGroupIds, targetRoute.placement);
  };

  const renderRouteButton = (route: AppRoute, isUtilityRoute = false): JSX.Element => {
    const Icon = route.icon;
    const isActive = route.id === activeRouteId;
    const isAudioSettings = route.id === 'audio-settings';
    const isLyricsSettings = route.id === 'lyrics-settings';
    const isImportFolder = route.id === 'import-folder';
    const isImportFile = route.id === 'import-file';
    const isDirectAction = isAudioSettings || isLyricsSettings || isImportFolder || isImportFile;
    const label = route.labelKey ? t(route.labelKey) : route.label;
    const isDragging = isSidebarRouteId(route.id) && draggingRouteId === route.id;
    const isHidden = isSidebarRouteId(route.id) && hiddenRouteIdSet.has(route.id);
    const visibilityLocked = isSidebarRouteId(route.id) && lockedVisibleRouteIdSet.has(route.id);
    const editActionLabel = visibilityLocked ? `${label}（固定显示）` : `${isHidden ? '显示' : '隐藏'}${label}`;

    return (
      <button
        className="nav-item"
        data-active={isUtilityRoute && isDirectAction ? false : isActive}
        data-dragging={isDragging ? 'true' : undefined}
        data-editing={isEditing ? 'true' : undefined}
        data-hidden={isHidden ? 'true' : undefined}
        data-visibility-locked={visibilityLocked ? 'true' : undefined}
        draggable={isEditing && isSidebarRouteId(route.id)}
        key={route.id}
        onClick={() => {
          if (isEditing) {
            if (isSidebarRouteId(route.id) && !visibilityLocked) {
              if (isHidden) {
                onShowRoute?.(route.id);
              } else {
                onHideRoute?.(route.id);
              }
            }
            return;
          }

          if (isUtilityRoute) {
            handleUtilityRouteClick(route.id);
            return;
          }

          onRouteChange(route.id);
        }}
        onContextMenu={(event) => openRouteMenu(event, route, label)}
        onDragEnd={() => setDraggingRouteId(null)}
        onDragOver={handleDragOver}
        onDragStart={(event) => handleDragStart(event, route.id)}
        onDrop={(event) => handleDrop(event, route)}
        onFocus={() => void preloadAppRoute(route.id)}
        onPointerEnter={() => void preloadAppRoute(route.id)}
        type="button"
        title={isEditing ? editActionLabel : label}
        aria-label={isEditing ? editActionLabel : label}
      >
        {isEditing && isSidebarRouteId(route.id) ? (
          <span className="nav-drag-handle" aria-hidden="true">
            <GripVertical size={15} />
          </span>
        ) : null}
        {renderNavIcon(Icon, 21)}
        <span className="nav-item-label">{label}</span>
        {isEditing && isSidebarRouteId(route.id) ? (
          <span className="nav-visibility-indicator" aria-hidden="true">
            {visibilityLocked ? <LockKeyhole size={15} /> : isHidden ? <EyeOff size={16} /> : <Eye size={16} />}
            {visibilityLocked ? <span>固定</span> : isHidden ? <span>已关闭</span> : null}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <aside className="sidebar" aria-label={t('app.navigation.main')} data-icon-only={iconOnly ? 'true' : undefined}>
      <div className="sidebar-header">
        <span className="sidebar-header-label">{t('sidebar.group.library')}</span>
        <button
          className="sidebar-collapse-button"
          type="button"
          aria-label={t(iconOnly ? 'settings.appearance.sidebar.expand' : 'settings.appearance.sidebar.collapse')}
          title={t(iconOnly ? 'settings.appearance.sidebar.expand' : 'settings.appearance.sidebar.collapse')}
          onClick={onToggleIconOnly}
        >
          <span className="sidebar-collapse-icon" aria-hidden="true">
            <ChevronsLeft size={16} />
          </span>
        </button>
      </div>
      {isEditing ? (
        <div className="sidebar-edit-bar">
          <GripVertical size={15} aria-hidden="true" />
          <span>排序与显示</span>
          <button type="button" onClick={() => setIsEditing(false)}>
            <X size={14} aria-hidden="true" />
            退出
          </button>
        </div>
      ) : null}
      <div className="sidebar-groups">
        {groups.map((group, index) => (
          <section
            className={`sidebar-group${group.utility ? ' sidebar-group--utility' : ''}`}
            data-group={group.id}
            key={group.id}
          >
            {index === 0 ? null : <h2 className="sidebar-group-label">{t(group.labelKey)}</h2>}
            <nav className={`nav-list${group.utility ? ' utility-nav' : ''}`} aria-label={group.utility ? t('app.navigation.utility') : t(group.labelKey)}>
              {group.routes.map((route) => renderRouteButton(route, group.utility))}
              {group.utility && !isEditing ? (
                <button className="nav-item" type="button" title={t('settings.nav.steam.label')} aria-label={t('settings.nav.steam.label')} onClick={openSteamSection}>
                  {renderNavIcon(AudioLines, 21)}
                  <span className="nav-item-label">{t('settings.nav.steam.label')}</span>
                </button>
              ) : null}
            </nav>
          </section>
        ))}
      </div>
      {menuState
        ? createPortal(
            <div className="sidebar-context-menu-layer" role="presentation">
              <div
                ref={menuRef}
                className="sidebar-context-menu"
                role="menu"
                aria-label={`${menuState.label} 菜单`}
                style={{ left: menuPosition.x, top: menuPosition.y }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onHideRoute?.(menuState.routeId);
                    closeMenu();
                  }}
                >
                  <EyeOff size={16} aria-hidden="true" />
                  <span>隐藏</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (iconOnly) {
                      onToggleIconOnly?.();
                    }
                    setIsEditing(true);
                    closeMenu();
                  }}
                >
                  <SlidersHorizontal size={16} aria-hidden="true" />
                  <span>进入编辑模式</span>
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
};
