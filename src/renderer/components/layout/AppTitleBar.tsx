import {
  Captions,
  Copy,
  Download,
  Film,
  Headphones,
  Image as ImageIcon,
  Maximize2,
  Minus,
  Minimize2,
  Settings,
  Square,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppRouteId } from '../../app/routes';
import { useI18n } from '../../i18n/I18nProvider';
import type { UpdateStatus } from '../../../shared/types/updates';

type AppTitleBarProps = {
  activeRouteId: AppRouteId;
  isAudioSettingsOpen?: boolean;
  isLyricsSettingsOpen?: boolean;
  isLyricsVisualSettingsOpen?: boolean;
  isMvSettingsOpen?: boolean;
  isProUnlocked?: boolean;
  updateStatus?: UpdateStatus | null;
  updateActionDisabled?: boolean;
  onRouteChange: (routeId: AppRouteId) => void;
  onPreloadSettings?: () => void;
  onUpdateAction?: () => void;
  onOpenAudioSettings: () => void;
  onOpenLyricsSettings?: () => void;
  onOpenLyricsVisualSettings?: () => void;
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
  onApproach?: () => void;
  onClick: () => void;
};

export const AppTitleBar = ({
  activeRouteId,
  isAudioSettingsOpen = false,
  isLyricsSettingsOpen = false,
  isLyricsVisualSettingsOpen = false,
  isMvSettingsOpen = false,
  isProUnlocked = false,
  updateStatus = null,
  updateActionDisabled = false,
  onRouteChange,
  onPreloadSettings = () => undefined,
  onUpdateAction = () => undefined,
  onOpenAudioSettings,
  onOpenLyricsSettings = () => undefined,
  onOpenLyricsVisualSettings = () => undefined,
  onOpenMvSettings = () => undefined,
  onMinimize,
  onToggleMaximize,
  onToggleFullscreen = () => undefined,
  isWindowMaximized = false,
  isWindowFullscreen = false,
  onClose,
}: AppTitleBarProps): JSX.Element => {
  const { t } = useI18n();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const maximizeLabel = t(isWindowMaximized ? 'app.window.restore' : 'app.window.maximize');
  const MaximizeIcon = isWindowMaximized ? Copy : Square;
  const fullscreenLabel = t(isWindowFullscreen ? 'app.window.exitFullscreen' : 'app.window.fullscreen');
  const FullscreenIcon = isWindowFullscreen ? Minimize2 : Maximize2;
  const updateVersion = updateStatus?.latestVersion ?? updateStatus?.releaseName ?? null;
  const updateNoticeLabel = updateStatus?.state === 'downloaded'
    ? (updateVersion ? t('notice.updateDownloadedVersion', { version: updateVersion }) : t('notice.updateDownloaded'))
    : (updateVersion ? t('notice.updateAvailableVersion', { version: updateVersion }) : t('notice.updateAvailable'));
  const updateButtonLabel = updateStatus?.state === 'downloading'
    ? t('settings.about.updates.progress.downloading')
    : `${updateNoticeLabel} ${t('notice.action.updateNow')}`;
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
    ...(activeRouteId === 'lyrics'
      ? [{
          id: 'lyrics-visual-settings',
          label: t('lyricsSettings.visual.title'),
          icon: ImageIcon,
          active: isLyricsVisualSettingsOpen,
          onClick: onOpenLyricsVisualSettings,
        }]
      : []),
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
      onApproach: onPreloadSettings,
      onClick: () => onRouteChange('settings'),
    },
  ];

  useEffect(() => {
    let cancelled = false;

    void window.echo?.app?.getVersion?.()
      .then((version) => {
        const normalizedVersion = version.trim();
        if (!cancelled && normalizedVersion) {
          setAppVersion(/^v/iu.test(normalizedVersion) ? normalizedVersion : `v${normalizedVersion}`);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="app-titlebar" aria-label="ECHO Next">
      <div className="app-titlebar-brand">
        <strong>ECHO</strong>
        <span>Next</span>
        {isProUnlocked ? (
          <span className="app-titlebar-pro-slot">
            <span className="app-titlebar-pro-badge" aria-label="ECHO Pro unlocked">
              Pro
            </span>
          </span>
        ) : null}
        <span
          className="app-titlebar-version"
          data-loading={appVersion ? 'false' : 'true'}
          aria-label={appVersion ? `ECHO app version ${appVersion}` : undefined}
        >
          {appVersion ?? 'v00.0.00'}
        </span>
        {updateStatus ? (
          <button
            className="app-titlebar-update"
            type="button"
            aria-label={updateButtonLabel}
            title={updateButtonLabel}
            disabled={updateActionDisabled}
            onClick={onUpdateAction}
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
              data-drawer-trigger={
                action.id === 'audio-settings' ||
                action.id === 'lyrics-settings' ||
                action.id === 'lyrics-visual-settings' ||
                action.id === 'mv-settings'
                  ? 'true'
                  : 'false'
              }
              data-drawer-open={
                (action.id === 'audio-settings' && isAudioSettingsOpen) ||
                (action.id === 'lyrics-settings' && isLyricsSettingsOpen) ||
                (action.id === 'lyrics-visual-settings' && isLyricsVisualSettingsOpen) ||
                (action.id === 'mv-settings' && isMvSettingsOpen)
                  ? 'true'
                  : 'false'
              }
              key={action.id}
              type="button"
              aria-label={action.label}
              title={action.label}
              onClick={action.onClick}
              onFocus={action.onApproach}
              onPointerEnter={action.onApproach}
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
