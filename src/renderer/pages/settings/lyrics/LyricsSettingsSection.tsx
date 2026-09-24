import { Captions } from 'lucide-react';
import { LyricsSettingsPanel } from '../../../components/lyrics/LyricsSettingsDrawer';
import type { TranslationKey } from '../../../i18n/locales';
import {
  SettingSection,
  SettingSubsectionTitle,
  type SettingSubsectionTitleProps,
} from '../components/SettingsPrimitives';
import type { SettingsNavKey } from '../settingsTypes';

type LyricsSettingsSectionProps = {
  activeKey: SettingsNavKey;
  getSubsection: (key: 'lyricsMain') => SettingSubsectionTitleProps;
  highlightedSettingId: string | null;
  t: (key: TranslationKey) => string;
};

export const LyricsSettingsSection = ({
  activeKey,
  getSubsection,
  highlightedSettingId,
  t,
}: LyricsSettingsSectionProps): JSX.Element => (
  <SettingSection
    activeKey={activeKey}
    icon={Captions}
    id="lyrics"
    title={t('route.lyricsSettings.label')}
  >
    <SettingSubsectionTitle {...getSubsection('lyricsMain')} />
    <LyricsSettingsPanel
      className="settings-lyrics-panel"
      highlightedSettingId={highlightedSettingId}
      variant="settings"
    />
  </SettingSection>
);
