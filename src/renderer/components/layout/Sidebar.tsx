import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { EyeOff, GripVertical, SlidersHorizontal, X } from 'lucide-react';
import type { AppRoute, AppRouteId } from '../../app/routes';
import { useI18n } from '../../i18n/I18nProvider';
import { isSidebarRouteId, type SidebarRouteId } from '../../../shared/types/sidebar';

type SidebarProps = {
  routes: AppRoute[];
  activeRouteId: AppRouteId;
  onRouteChange: (routeId: AppRouteId) => void;
  onOpenAudioSettings: () => void;
  onOpenLyricsSettings: () => void;
  onImportFolder: () => void;
  onImportFile: () => void;
  iconOnly?: boolean;
  onHideRoute?: (routeId: SidebarRouteId) => void;
  onReorderRoutes?: (routeIds: SidebarRouteId[], placement: AppRoute['placement']) => void;
};

type SidebarMenuState = {
  routeId: SidebarRouteId;
  label: string;
  position: { x: number; y: number };
};

const viewportPadding = 8;
const pointerOffset = 6;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

const renderNavIcon = (Icon: AppRoute['icon'], size: number): JSX.Element => (
  <span className="nav-icon-shell" aria-hidden="true">
    <Icon size={size} strokeWidth={1.35} aria-hidden="true" focusable="false" />
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
  onHideRoute,
  onReorderRoutes,
}: SidebarProps): JSX.Element => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuState, setMenuState] = useState<SidebarMenuState | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isEditing, setIsEditing] = useState(false);
  const [draggingRouteId, setDraggingRouteId] = useState<SidebarRouteId | null>(null);
  const visibleRoutes = routes.filter((route) => !route.hideFromSidebar);
  const mainRoutes = visibleRoutes.filter((route) => route.placement === 'main');
  const utilityRoutes = visibleRoutes.filter((route) => route.placement === 'utility');
  const routeById = useMemo(() => new Map(visibleRoutes.map((route) => [route.id, route])), [visibleRoutes]);
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

    const groupIds = visibleRoutes
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

    return (
      <button
        className="nav-item"
        data-active={isUtilityRoute && isDirectAction ? false : isActive}
        data-dragging={isDragging ? 'true' : undefined}
        data-editing={isEditing ? 'true' : undefined}
        draggable={isEditing && isSidebarRouteId(route.id)}
        key={route.id}
        onClick={() => {
          if (isEditing) {
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
        type="button"
        title={label}
        aria-label={label}
      >
        {isEditing && isSidebarRouteId(route.id) ? (
          <span className="nav-drag-handle" aria-hidden="true">
            <GripVertical size={15} />
          </span>
        ) : null}
        {renderNavIcon(Icon, 21)}
        <span className="nav-item-label">{label}</span>
      </button>
    );
  };

  return (
    <aside className="sidebar" aria-label={t('app.navigation.main')} data-icon-only={iconOnly ? 'true' : undefined}>
      {isEditing ? (
        <div className="sidebar-edit-bar">
          <GripVertical size={15} aria-hidden="true" />
          <span>拖动排序</span>
          <button type="button" onClick={() => setIsEditing(false)}>
            <X size={14} aria-hidden="true" />
            退出
          </button>
        </div>
      ) : null}
      <nav className="nav-list">
        {mainRoutes.map((route) => renderRouteButton(route))}
      </nav>
      <div className="sidebar-spacer" aria-hidden="true" />
      <nav className="nav-list utility-nav" aria-label={t('app.navigation.utility')}>
        {utilityRoutes.map((route) => renderRouteButton(route, true))}
      </nav>
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
