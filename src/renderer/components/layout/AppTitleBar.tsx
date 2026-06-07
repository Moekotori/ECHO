import {
  Captions,
  Copy,
  Download,
  Film,
  Headphones,
  Maximize2,
  Minus,
  Minimize2,
  Settings,
  Square,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppRouteId } from '../../app/routes';
import { useI18n } from '../../i18n/I18nProvider';
import type { UpdateStatus } from '../../../shared/types/updates';

type AppTitleBarProps = {
  activeRouteId: AppRouteId;
  isAudioSettingsOpen?: boolean;
  isLyricsSettingsOpen?: boolean;
  isMvSettingsOpen?: boolean;
  updateStatus?: UpdateStatus | null;
  onRouteChange: (routeId: AppRouteId) => void;
  onOpenUpdateSettings?: () => void;
  onOpenAudioSettings: () => void;
  onOpenLyricsSettings?: () => void;
  onOpenMvSettings?: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onToggleFullscreen?: () => void;
  isWindowMaximized?: boolean;
  isWindowFullscreen?: boolean;
  onClose: () => void;
};

type TitleBarAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
};

export const AppTitleBar = ({
  activeRouteId,
  isAudioSettingsOpen = false,
  isLyricsSettingsOpen = false,
  isMvSettingsOpen = false,
  updateStatus = null,
  onRouteChange,
  onOpenUpdateSettings = () => undefined,
  onOpenAudioSettings,
  onOpenLyricsSettings = () => undefined,
  onOpenMvSettings = () => undefined,
  onMinimize,
  onToggleMaximize,
  onToggleFullscreen = () => undefined,
  isWindowMaximized = false,
  isWindowFullscreen = false,
  onClose,
}: AppTitleBarProps): JSX.Element => {
  const { t } = useI18n();
  const maximizeLabel = t(isWindowMaximized ? 'app.window.restore' : 'app.window.maximize');
  const MaximizeIcon = isWindowMaximized ? Copy : Square;
  const fullscreenLabel = t(isWindowFullscreen ? 'app.window.exitFullscreen' : 'app.window.fullscreen');
  const FullscreenIcon = isWindowFullscreen ? Minimize2 : Maximize2;
  const updateVersion = updateStatus?.latestVersion ?? updateStatus?.releaseName ?? null;
  const updateNoticeLabel = updateStatus?.state === 'downloaded'
    ? (updateVersion ? t('notice.updateDownloadedVersion', { version: updateVersion }) : t('notice.updateDownloaded'))
    : (updateVersion ? t('notice.updateAvailableVersion', { version: updateVersion }) : t('notice.updateAvailable'));
  const actions: TitleBarAction[] = [
    {
      id: 'audio-settings',
      label: t('route.audioSettings.label'),
      icon: Headphones,
      active: isAudioSettingsOpen,
      onClick: onOpenAudioSettings,
    },
    {
      id: 'lyrics-settings',
      label: t('route.lyricsSettings.label'),
      icon: Captions,
      active: isLyricsSettingsOpen,
      onClick: onOpenLyricsSettings,
    },
    {
      id: 'mv-settings',
      label: t('route.mvSettings.label'),
      icon: Film,
      active: isMvSettingsOpen,
      onClick: onOpenMvSettings,
    },
    {
      id: 'settings',
      label: t('route.settings.label'),
      icon: Settings,
      active: activeRouteId === 'settings',
      onClick: () => onRouteChange('settings'),
    },
  ];

  return (
    <header className="app-titlebar" aria-label="ECHO Next">
      <div className="app-titlebar-brand">
        <strong>ECHO</strong>
        <span>Next</span>
        {updateStatus ? (
          <button
            className="app-titlebar-update"
            type="button"
            aria-label={updateNoticeLabel}
            title={updateNoticeLabel}
            onClick={onOpenUpdateSettings}
          >
            <Download size={13} />
            <span>{updateVersion ?? 'Update'}</span>
          </button>
        ) : null}
      </div>

      <div className="app-titlebar-actions" aria-label={t('app.toolbar.quickActions')}>
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              className="titlebar-action"
              data-active={action.active ? 'true' : 'false'}
              data-drawer-trigger={action.id === 'audio-settings' || action.id === 'lyrics-settings' || action.id === 'mv-settings' ? 'true' : 'false'}
              data-drawer-open={
                (action.id === 'audio-settings' && isAudioSettingsOpen) ||
                (action.id === 'lyrics-settings' && isLyricsSettingsOpen) ||
                (action.id === 'mv-settings' && isMvSettingsOpen)
                  ? 'true'
                  : 'false'
              }
              key={action.id}
              type="button"
              aria-label={action.label}
              title={action.label}
              onClick={action.onClick}
            >
              <Icon size={17} />
            </button>
          );
        })}
      </div>

      <div className="window-controls" aria-label={t('app.toolbar.windowControls')}>
        <button
          className="window-control window-control--fullscreen"
          type="button"
          aria-label={fullscreenLabel}
          aria-pressed={isWindowFullscreen}
          title={fullscreenLabel}
          data-fullscreen={isWindowFullscreen ? 'true' : 'false'}
          onClick={onToggleFullscreen}
        >
          <FullscreenIcon size={15} strokeWidth={2.15} />
        </button>
        <button className="window-control" type="button" aria-label={t('app.window.minimize')} title={t('app.window.minimize')} onClick={onMinimize}>
          <Minus size={16} />
        </button>
        <button
          className="window-control"
          type="button"
          aria-label={maximizeLabel}
          title={maximizeLabel}
          data-window-maximized={isWindowMaximized ? 'true' : 'false'}
          onClick={onToggleMaximize}
        >
          <MaximizeIcon size={isWindowMaximized ? 15 : 14} />
        </button>
        <button className="window-control window-control--close" type="button" aria-label={t('app.window.close')} title={t('app.window.close')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </header>
  );
};
