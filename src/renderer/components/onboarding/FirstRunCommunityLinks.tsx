import { MessageSquare } from 'lucide-react';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { discordInviteUrl, qqGroupUrl } from '../../pages/settings/general/generalSettingsModel';
import '../../styles/first-run-community.css';

type FirstRunCommunityLinksProps = {
  onError: (message: string | null) => void;
};

export const FirstRunCommunityLinks = ({ onError }: FirstRunCommunityLinksProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const openLink = async (url: string): Promise<void> => {
    onError(null);
    try {
      const openExternalUrl = window.echo?.app?.openExternalUrl;
      if (!openExternalUrl) throw new Error('external-url-bridge-unavailable');
      await openExternalUrl(url);
    } catch {
      onError(t('firstRun.error.openCommunityLink'));
    }
  };

  return (
    <div className="first-run-community-links">
      <button type="button" onClick={() => void openLink(qqGroupUrl)}>
        <MessageSquare size={15} aria-hidden="true" />
        {t('settings.about.updates.action.qq')}
      </button>
      <button type="button" onClick={() => void openLink(discordInviteUrl)}>
        <MessageSquare size={15} aria-hidden="true" />
        {t('settings.about.updates.action.discord')}
      </button>
    </div>
  );
};
