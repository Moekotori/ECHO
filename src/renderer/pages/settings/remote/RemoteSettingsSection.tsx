import { Globe2 } from 'lucide-react';
import { RemoteSourcesPanel } from '../../../components/settings/RemoteSourcesPanel';
import type { TranslationKey } from '../../../i18n/locales';
import {
  SettingSection,
  SettingSubsectionTitle,
  type SettingSubsectionTitleProps,
} from '../components/SettingsPrimitives';
import type { SettingsNavKey } from '../settingsTypes';

type RemoteSettingsSectionProps = {
  activeKey: SettingsNavKey;
  getSubsection: (key: 'remoteSources') => SettingSubsectionTitleProps;
  t: (key: TranslationKey) => string;
};

export const RemoteSettingsSection = ({
  activeKey,
  getSubsection,
  t,
}: RemoteSettingsSectionProps): JSX.Element => (
  <SettingSection
    activeKey={activeKey}
    icon={Globe2}
    id="remote"
    title={t('settings.nav.remote.label')}
  >
    <SettingSubsectionTitle {...getSubsection('remoteSources')} />
    <RemoteSourcesPanel />
  </SettingSection>
);
