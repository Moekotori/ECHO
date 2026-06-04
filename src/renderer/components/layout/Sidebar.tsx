import type { AppRoute, AppRouteId } from '../../app/routes';
import { useI18n } from '../../i18n/I18nProvider';

type SidebarProps = {
  routes: AppRoute[];
  activeRouteId: AppRouteId;
  onRouteChange: (routeId: AppRouteId) => void;
  onOpenAudioSettings: () => void;
  onOpenLyricsSettings: () => void;
  onImportFolder: () => void;
  onImportFile: () => void;
};

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
}: SidebarProps): JSX.Element => {
  const { t } = useI18n();
  const visibleRoutes = routes.filter((route) => !route.hideFromSidebar);
  const mainRoutes = visibleRoutes.filter((route) => route.placement === 'main');
  const utilityRoutes = visibleRoutes.filter((route) => route.placement === 'utility');
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

  return (
    <aside className="sidebar" aria-label={t('app.navigation.main')}>
      <nav className="nav-list">
        {mainRoutes.map((route) => {
          const Icon = route.icon;
          const isActive = route.id === activeRouteId;
          const label = route.labelKey ? t(route.labelKey) : route.label;

          return (
            <button
              className="nav-item"
              data-active={isActive}
              key={route.id}
              onClick={() => onRouteChange(route.id)}
              type="button"
              title={label}
            >
              {renderNavIcon(Icon, 21)}
              <span className="nav-item-label">{label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-spacer" aria-hidden="true" />
      <nav className="nav-list utility-nav" aria-label={t('app.navigation.utility')}>
        {utilityRoutes.map((route) => {
          const Icon = route.icon;
          const isActive = route.id === activeRouteId;
          const isAudioSettings = route.id === 'audio-settings';
          const isLyricsSettings = route.id === 'lyrics-settings';
          const isImportFolder = route.id === 'import-folder';
          const isImportFile = route.id === 'import-file';
          const isDirectAction = isAudioSettings || isLyricsSettings || isImportFolder || isImportFile;
          const label = route.labelKey ? t(route.labelKey) : route.label;

          return (
            <button
              className="nav-item"
              data-active={isDirectAction ? false : isActive}
              key={route.id}
              onClick={() => handleUtilityRouteClick(route.id)}
              type="button"
              title={label}
              aria-label={label}
            >
              {renderNavIcon(Icon, 21)}
              <span className="nav-item-label">{label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
};
