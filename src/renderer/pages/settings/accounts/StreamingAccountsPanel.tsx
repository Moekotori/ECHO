import type { Dispatch, SetStateAction } from 'react';
import { ChevronRight, Music2 } from 'lucide-react';
import type { AccountBrowser, AccountProvider, AccountStatus, YouTubeBrowser } from '../../../../shared/types/accounts';
import type { AccountBusyAction } from '../settingsTypes';
import { useI18n } from '../../../i18n/I18nProvider';
import { AccountCookieCard, YouTubeAccountCard, SpotifyAccountCard, TidalAccountCard, QobuzAccountCard, accountProviderLabels, getAccountStatusLabel, getAccountBadgeClass } from '../components/AccountCards';
import { cookieAccountProviders, settingsAccountProviders, accountProviderLogoUrls } from './accountSettingsModel';

const spotifyDeveloperDashboardUrl = 'https://developer.spotify.com/dashboard';
const tidalDeveloperDashboardUrl = 'https://developer.tidal.com/dashboard';

type Props = {
  selectedAccountProvider: AccountProvider;
  setSelectedAccountProvider: (provider: AccountProvider) => void;
  accountStatusByProvider: Partial<Record<AccountProvider, AccountStatus>>;
  accountCookies: Record<AccountProvider, string>;
  setAccountCookies: Dispatch<SetStateAction<Record<AccountProvider, string>>>;
  accountBusy: Partial<Record<AccountProvider, AccountBusyAction>>;
  accountErrors: Partial<Record<AccountProvider, string | null>>;
  accountMessages: Partial<Record<AccountProvider, string | null>>;
  soundCloudBrowser: AccountBrowser;
  youtubeBrowser: YouTubeBrowser;
  qobuzTokenValue: string;
  setQobuzTokenValue: (value: string) => void;
  handleAccountSaveCookie: (provider: AccountProvider) => Promise<void>;
  handleAccountCheck: (provider: AccountProvider) => Promise<void>;
  handleAccountOpenLogin: (provider: AccountProvider) => Promise<void>;
  handleAccountClear: (provider: AccountProvider) => Promise<void>;
  handleNeteaseQrLogin: () => Promise<void>;
  handleSoundCloudBrowserChange: (browser: AccountBrowser) => Promise<void>;
  handleYouTubeBrowserChange: (browser: YouTubeBrowser) => Promise<void>;
  handleOpenExternalUrl: (url: string) => Promise<void>;
};

export const StreamingAccountsPanel = ({ selectedAccountProvider, setSelectedAccountProvider, accountStatusByProvider, accountCookies, setAccountCookies, accountBusy, accountErrors, accountMessages, soundCloudBrowser, youtubeBrowser, qobuzTokenValue, setQobuzTokenValue, handleAccountSaveCookie, handleAccountCheck, handleAccountOpenLogin, handleAccountClear, handleNeteaseQrLogin, handleSoundCloudBrowserChange, handleYouTubeBrowserChange, handleOpenExternalUrl }: Props): JSX.Element => {
  const { t } = useI18n();
  return (
                <div className="settings-account-workspace">
                  <nav className="settings-account-service-list" aria-label={t('settings.integrations.accountPanel.title')}>
                    {settingsAccountProviders.map((provider) => {
                      const status = accountStatusByProvider[provider];
                      const active = provider === selectedAccountProvider;
                      const state = !status ? 'checking' : status.connected ? (status.error ? 'expired' : 'connected') : 'disconnected';
                      return (
                        <button
                          className={`settings-account-service-button${active ? ' is-active' : ''}`}
                          type="button"
                          key={provider}
                          aria-current={active ? 'page' : undefined}
                          onClick={() => setSelectedAccountProvider(provider)}
                        >
                          <span className="settings-account-service-logo">
                            <>{accountProviderLogoUrls[provider] ? <img src={accountProviderLogoUrls[provider]} alt="" draggable={false} /> : <Music2 size={24} aria-hidden="true" />}</>
                          </span>
                          <span className="settings-account-service-copy">
                            <strong>{accountProviderLabels[provider]}</strong>
                            <span className={`settings-account-service-state is-${state}`}>
                              {getAccountStatusLabel(t, status)}
                            </span>
                          </span>
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      );
                    })}
                  </nav>
                  <section id={`settings-row-${selectedAccountProvider}-account`} className="settings-account-detail" aria-label={accountProviderLabels[selectedAccountProvider]}>
                    <header className="settings-account-detail-header">
                      <span className="settings-account-detail-logo">
                        <>{accountProviderLogoUrls[selectedAccountProvider] ? <img src={accountProviderLogoUrls[selectedAccountProvider]} alt="" draggable={false} /> : <Music2 size={32} aria-hidden="true" />}</>
                      </span>
                      <div>
                        <h3>{accountProviderLabels[selectedAccountProvider]}</h3>
                        <span className={getAccountBadgeClass(accountStatusByProvider[selectedAccountProvider])}>
                          {getAccountStatusLabel(t, accountStatusByProvider[selectedAccountProvider])}
                        </span>
                      </div>
                    </header>
                    <div className="settings-account-detail-body">
                      {cookieAccountProviders.includes(selectedAccountProvider) ? (
                        <AccountCookieCard
                          provider={selectedAccountProvider}
                          status={accountStatusByProvider[selectedAccountProvider]}
                          browser={selectedAccountProvider === 'soundcloud' ? soundCloudBrowser : undefined}
                          cookieValue={accountCookies[selectedAccountProvider]}
                          busyAction={accountBusy[selectedAccountProvider]}
                          error={accountErrors[selectedAccountProvider]}
                          message={accountMessages[selectedAccountProvider]}
                          onBrowserChange={selectedAccountProvider === 'soundcloud' ? (browser) => void handleSoundCloudBrowserChange(browser) : undefined}
                          onChangeCookie={(value) => setAccountCookies((current) => ({ ...current, [selectedAccountProvider]: value }))}
                          onSave={() => void handleAccountSaveCookie(selectedAccountProvider)}
                          onCheck={() => void handleAccountCheck(selectedAccountProvider)}
                          onOpenLogin={() => void handleAccountOpenLogin(selectedAccountProvider)}
                          onOpenQrLogin={selectedAccountProvider === 'netease' ? () => void handleNeteaseQrLogin() : undefined}
                          onClear={() => void handleAccountClear(selectedAccountProvider)}
                        />
                      ) : selectedAccountProvider === 'youtube' ? (
                        <YouTubeAccountCard
                          status={accountStatusByProvider.youtube}
                          browser={youtubeBrowser}
                          busyAction={accountBusy.youtube}
                          error={accountErrors.youtube}
                          message={accountMessages.youtube}
                          onBrowserChange={(browser) => void handleYouTubeBrowserChange(browser)}
                          onCheck={() => void handleAccountCheck('youtube')}
                          onOpenLogin={() => void handleAccountOpenLogin('youtube')}
                          onClear={() => void handleAccountClear('youtube')}
                        />
                      ) : selectedAccountProvider === 'spotify' ? (
                        <SpotifyAccountCard
                          status={accountStatusByProvider.spotify}
                          busyAction={accountBusy.spotify}
                          error={accountErrors.spotify}
                          message={accountMessages.spotify}
                          onCheck={() => void handleAccountCheck('spotify')}
                          onOpenDashboard={() => void handleOpenExternalUrl(spotifyDeveloperDashboardUrl)}
                          onOpenLogin={() => void handleAccountOpenLogin('spotify')}
                          onClear={() => void handleAccountClear('spotify')}
                        />
                      ) : selectedAccountProvider === 'tidal' ? (
                        <TidalAccountCard
                          status={accountStatusByProvider.tidal}
                          busyAction={accountBusy.tidal}
                          error={accountErrors.tidal}
                          message={accountMessages.tidal}
                          onCheck={() => void handleAccountCheck('tidal')}
                          onOpenDashboard={() => void handleOpenExternalUrl(tidalDeveloperDashboardUrl)}
                          onOpenLogin={() => void handleAccountOpenLogin('tidal')}
                          onClear={() => void handleAccountClear('tidal')}
                        />
                      ) : selectedAccountProvider === 'qobuz' ? (
                        <QobuzAccountCard
                          status={accountStatusByProvider.qobuz}
                          busyAction={accountBusy.qobuz}
                          error={accountErrors.qobuz}
                          message={accountMessages.qobuz}
                          onCheck={() => void handleAccountCheck('qobuz')}
                          onLogin={() => void handleAccountOpenLogin('qobuz')}
                          onClear={() => void handleAccountClear('qobuz')}
                          tokenValue={qobuzTokenValue}
                          onTokenChange={setQobuzTokenValue}
                        />
                      ) : null}
                    </div>
                  </section>
                </div>
  );
};
