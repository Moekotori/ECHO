import { Code2, ExternalLink, FileText, FolderOpen } from 'lucide-react';
import type { TranslationKey } from '../../../i18n/locales';
import {
  SettingRow,
  SettingSection,
  SettingSubsectionTitle,
  type SettingSubsectionTitleProps,
} from '../components/SettingsPrimitives';
import { pluginsDocumentationUrl } from '../settingsNavigation';
import type { SettingsNavKey } from '../settingsTypes';

type PluginsSubsection = 'pluginsLocal' | 'pluginsTools';

type PluginsSettingsSectionProps = {
  activeKey: SettingsNavKey;
  getSubsection: (key: PluginsSubsection) => SettingSubsectionTitleProps;
  highlightedSettingId: string | null;
  message: string | null;
  onCreatePlaybackPanelExample: () => void | Promise<void>;
  onOpenDirectory: () => void | Promise<void>;
  onOpenExternalUrl: (url: string) => void | Promise<void>;
  onOpenPage: () => void;
  t: (
    key: TranslationKey,
    options?: Record<string, string | number>,
  ) => string;
};

export const PluginsSettingsSection = ({
  activeKey,
  getSubsection,
  highlightedSettingId,
  message,
  onCreatePlaybackPanelExample,
  onOpenDirectory,
  onOpenExternalUrl,
  onOpenPage,
  t,
}: PluginsSettingsSectionProps): JSX.Element => {
  const toolsSubsection = getSubsection('pluginsTools');

  return (
    <SettingSection
      activeKey={activeKey}
      icon={Code2}
      id="plugins"
      title={t('settings.nav.plugins.label')}
    >
      <SettingSubsectionTitle {...getSubsection('pluginsLocal')} />
      <SettingRow
        className="setting-row--full setting-row--compact-panel"
        id="settings-row-plugins"
        highlighted={highlightedSettingId === 'settings-row-plugins'}
        title={t('settings.plugins.card.title')}
        description={t('settings.plugins.card.description')}
      >
        <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--plugins">
          <div className="settings-status-grid">
            <span>
              <em>{t('settings.plugins.meta.runtime')}</em>
              <strong>{t('settings.plugins.meta.runtimeValue')}</strong>
            </span>
            <span>
              <em>{t('settings.plugins.meta.defaultState')}</em>
              <strong>{t('settings.plugins.meta.defaultStateValue')}</strong>
            </span>
            <span>
              <em>{t('settings.plugins.meta.permissions')}</em>
              <strong>{t('settings.plugins.meta.permissionsValue')}</strong>
            </span>
            <span>
              <em>{t('settings.plugins.meta.playbackSafety')}</em>
              <strong>{t('settings.plugins.meta.playbackSafetyValue')}</strong>
            </span>
          </div>
        </div>
      </SettingRow>
      <SettingSubsectionTitle {...toolsSubsection} />
      <SettingRow
        className="setting-row--full setting-row--compact-panel"
        title={toolsSubsection.title}
        description={t('settings.plugins.note')}
      >
        <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--plugins">
          <div className="settings-chip-row settings-chip-row--left">
            <button className="settings-action-button" type="button" onClick={onOpenPage}>
              <Code2 size={15} />
              {t('settings.plugins.action.openPage')}
            </button>
            <button
              className="settings-action-button"
              type="button"
              onClick={() => void onOpenDirectory()}
            >
              <FolderOpen size={15} />
              {t('settings.plugins.action.openDirectory')}
            </button>
            <button
              className="settings-action-button"
              type="button"
              onClick={() => void onCreatePlaybackPanelExample()}
            >
              <FileText size={15} />
              {t('settings.plugins.action.createExample')}
            </button>
            <button
              className="settings-action-button"
              type="button"
              onClick={() => void onOpenExternalUrl(pluginsDocumentationUrl)}
            >
              <ExternalLink size={15} />
              {t('settings.plugins.action.openDocs')}
            </button>
          </div>
          <p className="settings-inline-note">{t('settings.plugins.note')}</p>
          {message ? <p className="settings-inline-note">{message}</p> : null}
        </div>
      </SettingRow>
    </SettingSection>
  );
};
