import { ExternalLink, LogIn, QrCode, RefreshCw, Save, X } from 'lucide-react';
import type {
  AccountBrowser,
  AccountProvider,
  AccountStatus,
  YouTubeBrowser,
} from '../../../../shared/types/accounts';
import { useI18n } from '../../../i18n/I18nProvider';
import type { TranslationKey } from '../../../i18n/locales';
import type { AccountBusyAction, NeteaseQrLoginUiState } from '../settingsTypes';

export const accountProviderLabels: Record<AccountProvider, string> = {
  kugou: '酷狗音乐',
  netease: '网易云音乐',
  qqmusic: 'QQ 音乐',
  bilibili: 'Bilibili',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  tidal: 'TIDAL',
  qobuz: 'Qobuz',
  osu: 'osu!',
};

export const buildYouTubeBrowserOptions = (
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): Array<{ value: YouTubeBrowser; label: string }> => [
  { value: 'edge', label: 'Edge' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'none', label: t('settings.integrations.accounts.youtube.browserNone') },
];

export const getAccountStatusLabel = (t: ReturnType<typeof useI18n>['t'], status: AccountStatus | undefined): string => {
  if (!status) {
    return t('settings.integrations.accounts.status.checking');
  }

  if (status.connected && status.error) {
    return t('settings.integrations.accounts.status.expired');
  }

  return status.connected ? t('settings.integrations.accounts.status.loggedIn') : t('settings.integrations.accounts.status.loggedOut');
};

export const getAccountBadgeClass = (status: AccountStatus | undefined): string => {
  if (!status || !status.connected) {
    return 'list-filter-chip';
  }

  return status.error ? 'list-filter-chip settings-account-badge-error active' : 'list-filter-chip active';
};

const renderAccountStatusBadge = (
  t: ReturnType<typeof useI18n>['t'],
  status: AccountStatus | undefined,
  onOpenLogin: () => void,
): JSX.Element => {
  if (status && !status.connected) {
    return (
      <button className={`${getAccountBadgeClass(status)} settings-account-status-link`} type="button" onClick={onOpenLogin}>
        {t('settings.integrations.accounts.clickToLogin')}
      </button>
    );
  }

  return <span className={getAccountBadgeClass(status)}>{getAccountStatusLabel(t, status)}</span>;
};

export const NeteaseQrLoginDialog = ({
  onClose,
  onRetry,
  state,
}: {
  onClose: () => void;
  onRetry: () => void;
  state: NeteaseQrLoginUiState;
}): JSX.Element | null => {
  const { t } = useI18n();
  if (!state.open) {
    return null;
  }

  const canRetry = state.state === 'expired' || state.state === 'failed';
  const statusText = state.error ?? state.message ?? t('settings.integrations.accounts.neteaseQr.waiting');

  return (
    <div className="settings-qr-login-backdrop">
      <section
        className="settings-qr-login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-netease-qr-title"
        data-state={state.state}
      >
        <header className="settings-qr-login-header">
          <div>
            <h3 id="settings-netease-qr-title">{t('settings.integrations.accounts.neteaseQr.title')}</h3>
            <p>{t('settings.integrations.accounts.neteaseQr.subtitle')}</p>
          </div>
          <button
            className="settings-icon-button settings-qr-login-close"
            type="button"
            aria-label={t('settings.integrations.accounts.neteaseQr.close')}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="settings-qr-login-code" data-empty={!state.qrDataUrl}>
          {state.qrDataUrl ? (
            <img src={state.qrDataUrl} alt={t('settings.integrations.accounts.neteaseQr.title')} draggable={false} />
          ) : (
            <QrCode size={46} aria-hidden="true" />
          )}
        </div>
        <p className="settings-qr-login-status">{statusText}</p>
        <div className="settings-qr-login-actions">
          {canRetry ? (
            <button className="settings-action-button" type="button" onClick={onRetry}>
              <RefreshCw size={15} />
              {t('settings.integrations.accounts.neteaseQr.retry')}
            </button>
          ) : null}
          <button className="settings-action-button" type="button" onClick={onClose}>
            {t('settings.integrations.accounts.neteaseQr.close')}
          </button>
        </div>
      </section>
    </div>
  );
};

export const AccountCookieCard = ({
  browser,
  busyAction,
  cookieValue,
  error,
  message,
  onBrowserChange,
  onChangeCookie,
  onCheck,
  onClear,
  onOpenLogin,
  onOpenQrLogin,
  onSave,
  provider,
  status,
}: {
  browser?: AccountBrowser;
  busyAction?: AccountBusyAction;
  cookieValue: string;
  error?: string | null;
  message?: string | null;
  onBrowserChange?: (browser: AccountBrowser) => void;
  onChangeCookie: (value: string) => void;
  onCheck: () => void;
  onClear: () => void;
  onOpenLogin: () => void;
  onOpenQrLogin?: () => void;
  onSave: () => void;
  provider: AccountProvider;
  status?: AccountStatus;
}): JSX.Element => {
  const { t } = useI18n();
  const browserOptions = buildYouTubeBrowserOptions(t);
  const showQrLogin = provider === 'netease' && typeof onOpenQrLogin === 'function';
  const loginBusy = busyAction === 'login' || busyAction === 'browser';
  const browserLoginLabel = loginBusy
    ? t('settings.integrations.accounts.loginBusy')
    : showQrLogin
      ? t('settings.integrations.accounts.neteaseQr.webLogin')
      : t('settings.integrations.accounts.saveBrowser');
  const qrLoginLabel = loginBusy
    ? t('settings.integrations.accounts.neteaseQr.starting')
    : t('settings.integrations.accounts.neteaseQr.action');

  return (
    <article className="settings-account-row" aria-label={accountProviderLabels[provider]}>
      <div className="settings-account-summary">
        {renderAccountStatusBadge(t, status, onOpenLogin)}
        <div>
          <h3>{accountProviderLabels[provider]}</h3>
          <p>{provider === 'bilibili' ? t('settings.integrations.accounts.description.bilibili') : t('settings.integrations.accounts.description.default')}</p>
        </div>
      </div>
      <label className="settings-account-cookie-field">
        <input
          type="password"
          value={cookieValue}
          placeholder={t('settings.integrations.accounts.cookiePlaceholder')}
          onChange={(event) => onChangeCookie(event.target.value)}
          autoComplete="off"
        />
      </label>
      {provider === 'soundcloud' && browser && onBrowserChange ? (
        <label className="settings-select-field settings-account-browser-field">
          <span>{t('settings.integrations.accounts.youtube.browser')}</span>
          <select value={browser} onChange={(event) => onBrowserChange(event.target.value as AccountBrowser)} disabled={busyAction === 'browser'}>
            {browserOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="settings-account-actions">
        <button className="settings-action-button" type="button" disabled={busyAction === 'save' || cookieValue.trim().length === 0} onClick={onSave}>
          <Save size={15} />
          {busyAction === 'save' ? t('settings.integrations.accounts.manualSaveBusy') : t('settings.integrations.accounts.manualSave')}
        </button>
        <button className="settings-action-button" type="button" disabled={busyAction === 'check'} onClick={onCheck}>
          {busyAction === 'check' ? t('settings.integrations.accounts.checkBusy') : t('settings.integrations.accounts.check')}
        </button>
        <button
          className="settings-action-button settings-account-login-button"
          type="button"
          disabled={loginBusy}
          onClick={onOpenLogin}
        >
          <LogIn size={15} />
          {browserLoginLabel}
        </button>
        {showQrLogin ? (
          <button
            className="settings-action-button settings-account-login-button"
            type="button"
            disabled={loginBusy}
            onClick={() => {
              onOpenQrLogin?.();
            }}
          >
            <QrCode size={15} />
            {qrLoginLabel}
          </button>
        ) : null}
        <button className="settings-danger-button" type="button" disabled={busyAction === 'clear'} onClick={onClear}>
          {busyAction === 'clear' ? t('settings.integrations.accounts.logoutBusy') : t('settings.integrations.accounts.logout')}
        </button>
      </div>
      <div className="settings-account-meta">
        <span>{t('settings.integrations.accounts.cookieFallback')}</span>
        <span>{t('settings.integrations.accounts.loginMeta', { loginAt: status?.lastLoginAt ?? 'n/a', checkedAt: status?.lastCheckedAt ?? 'n/a' })}</span>
      </div>
      {provider === 'soundcloud' ? <p className="settings-inline-note settings-account-note">{t('settings.integrations.accounts.soundcloudNote')}</p> : null}
      {provider === 'osu' ? <p className="settings-inline-note settings-account-note">{t('settings.integrations.accounts.osuNote')}</p> : null}
      {message ? <p className="settings-inline-note settings-account-note">{message}</p> : null}
      {error ? <p className="settings-inline-error settings-account-note">{error}</p> : null}
    </article>
  );
};

export const YouTubeAccountCard = ({
  browser,
  busyAction,
  error,
  message,
  onBrowserChange,
  onCheck,
  onClear,
  onOpenLogin,
  status,
}: {
  browser: YouTubeBrowser;
  busyAction?: AccountBusyAction;
  error?: string | null;
  message?: string | null;
  onBrowserChange: (browser: YouTubeBrowser) => void;
  onCheck: () => void;
  onClear: () => void;
  onOpenLogin: () => void;
  status?: AccountStatus;
}): JSX.Element => {
  const { t } = useI18n();
  const youtubeBrowserOptions = buildYouTubeBrowserOptions(t);

  return (
    <article className="settings-account-row" aria-label="YouTube">
      <div className="settings-account-summary">
        {renderAccountStatusBadge(t, status, onOpenLogin)}
        <div>
          <h3>YouTube</h3>
          <p>{t('settings.integrations.accounts.youtube.description')}</p>
        </div>
      </div>
      <label className="settings-select-field settings-account-browser-field">
        <span>{t('settings.integrations.accounts.youtube.browser')}</span>
        <select value={browser} onChange={(event) => onBrowserChange(event.target.value as YouTubeBrowser)} disabled={busyAction === 'browser'}>
          {youtubeBrowserOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-account-actions">
        <button className="settings-action-button" type="button" disabled={busyAction === 'check'} onClick={onCheck}>
          {busyAction === 'check' ? t('settings.integrations.accounts.checkBusy') : t('settings.integrations.accounts.check')}
        </button>
        <button className="settings-action-button settings-account-login-button" type="button" disabled={busyAction === 'login' || busyAction === 'browser'} onClick={onOpenLogin}>
          <ExternalLink size={15} />
          {busyAction === 'login' || busyAction === 'browser' ? t('settings.integrations.accounts.loginBusy') : t('settings.integrations.accounts.openBrowserLogin')}
        </button>
        <button className="settings-danger-button" type="button" disabled={busyAction === 'clear'} onClick={onClear}>
          {busyAction === 'clear' ? t('settings.integrations.accounts.logoutBusy') : t('settings.integrations.accounts.logout')}
        </button>
      </div>
      <div className="settings-account-meta">
        <span>{status?.displayName ?? t('settings.integrations.accounts.youtube.savedStatus')}</span>
        <span>{t('settings.integrations.accounts.check')} {status?.lastCheckedAt ?? 'n/a'}</span>
      </div>
      {message ? <p className="settings-inline-note settings-account-note">{message}</p> : null}
      {error ? <p className="settings-inline-error settings-account-note">{error}</p> : null}
    </article>
  );
};

type OAuthAccountCardProps = {
  busyAction?: AccountBusyAction;
  error?: string | null;
  message?: string | null;
  onCheck: () => void;
  onClear: () => void;
  onOpenDashboard: () => void;
  onOpenLogin: () => void;
  status?: AccountStatus;
};

export const SpotifyAccountCard = ({
  busyAction,
  error,
  message,
  onCheck,
  onClear,
  onOpenDashboard,
  onOpenLogin,
  status,
}: OAuthAccountCardProps): JSX.Element => {
  const { t } = useI18n();

  return (
    <article className="settings-account-row" aria-label="Spotify">
      <div className="settings-account-summary">
        {renderAccountStatusBadge(t, status, onOpenLogin)}
        <div>
          <h3>Spotify</h3>
          <p>{t('settings.integrations.accounts.spotify.description')}</p>
        </div>
      </div>
      <div className="settings-account-actions">
        <button className="settings-action-button" type="button" onClick={onOpenDashboard}>
          <ExternalLink size={15} />
          {t('settings.integrations.common.openDashboard', { service: 'Spotify' })}
        </button>
        <button className="settings-action-button" type="button" disabled={busyAction === 'check'} onClick={onCheck}>
          {busyAction === 'check' ? t('settings.integrations.accounts.checkBusy') : t('settings.integrations.accounts.check')}
        </button>
        <button className="settings-action-button settings-account-login-button" type="button" disabled={busyAction === 'login'} onClick={onOpenLogin}>
          <ExternalLink size={15} />
          {busyAction === 'login' ? t('settings.integrations.accounts.spotify.loginBusy') : t('settings.integrations.accounts.spotify.login')}
        </button>
        <button className="settings-danger-button" type="button" disabled={busyAction === 'clear'} onClick={onClear}>
          {busyAction === 'clear' ? t('settings.integrations.accounts.logoutBusy') : t('settings.integrations.accounts.logout')}
        </button>
      </div>
      <div className="settings-account-meta">
        <span>{status?.displayName ?? status?.username ?? t('settings.integrations.accounts.spotify.savedStatus')}</span>
        <span>{t('settings.integrations.accounts.loginMeta', { loginAt: status?.lastLoginAt ?? 'n/a', checkedAt: status?.lastCheckedAt ?? 'n/a' })}</span>
      </div>
      {message ? <p className="settings-inline-note settings-account-note">{message}</p> : null}
      {error ? <p className="settings-inline-error settings-account-note">{error}</p> : null}
    </article>
  );
};

export const TidalAccountCard = ({
  busyAction,
  error,
  message,
  onCheck,
  onClear,
  onOpenDashboard,
  onOpenLogin,
  status,
}: OAuthAccountCardProps): JSX.Element => {
  const { t } = useI18n();

  return (
    <article className="settings-account-row" aria-label="TIDAL">
      <div className="settings-account-summary">
        {renderAccountStatusBadge(t, status, onOpenLogin)}
        <div>
          <h3>TIDAL</h3>
          <p>{t('settings.integrations.accounts.tidal.description')}</p>
        </div>
      </div>
      <div className="settings-account-actions">
        <button className="settings-action-button" type="button" onClick={onOpenDashboard}>
          <ExternalLink size={15} />
          {t('settings.integrations.common.openDashboard', { service: 'TIDAL' })}
        </button>
        <button className="settings-action-button" type="button" disabled={busyAction === 'check'} onClick={onCheck}>
          {busyAction === 'check' ? t('settings.integrations.accounts.checkBusy') : t('settings.integrations.accounts.check')}
        </button>
        <button className="settings-action-button settings-account-login-button" type="button" disabled={busyAction === 'login'} onClick={onOpenLogin}>
          <ExternalLink size={15} />
          {busyAction === 'login' ? t('settings.integrations.accounts.tidal.loginBusy') : t('settings.integrations.accounts.tidal.login')}
        </button>
        <button className="settings-danger-button" type="button" disabled={busyAction === 'clear'} onClick={onClear}>
          {busyAction === 'clear' ? t('settings.integrations.accounts.logoutBusy') : t('settings.integrations.accounts.logout')}
        </button>
      </div>
      <div className="settings-account-meta">
        <span>{status?.displayName ?? status?.username ?? t('settings.integrations.accounts.tidal.savedStatus')}</span>
        <span>{t('settings.integrations.accounts.loginMeta', { loginAt: status?.lastLoginAt ?? 'n/a', checkedAt: status?.lastCheckedAt ?? 'n/a' })}</span>
      </div>
      <p className="settings-inline-note settings-account-note">
        {t('settings.integrations.accounts.tidal.callbackNote')}
      </p>
      {message ? <p className="settings-inline-note settings-account-note">{message}</p> : null}
      {error ? <p className="settings-inline-error settings-account-note">{error}</p> : null}
    </article>
  );
};

export const QobuzAccountCard = ({
  busyAction,
  error,
  message,
  onCheck,
  onClear,
  onLogin,
  status,
  tokenValue,
  onTokenChange,
}: {
  busyAction?: AccountBusyAction;
  error?: string | null;
  message?: string | null;
  onCheck: () => void;
  onClear: () => void;
  onLogin: () => void;
  status?: AccountStatus;
  tokenValue: string;
  onTokenChange: (value: string) => void;
}): JSX.Element => {
  const { t } = useI18n();
  const connected = status?.connected === true;
  const displayName = status?.displayName ?? status?.username;

  return (
    <article className="settings-account-row" aria-label="Qobuz">
      <div className="settings-account-summary">
        {renderAccountStatusBadge(t, status, onLogin)}
        <div>
          <h3>Qobuz</h3>
          <p>{t('settings.integrations.accounts.qobuz.description')}</p>
        </div>
      </div>
      {!connected ? (
        <>
          <label className="settings-account-cookie-field">
            <input
              type="password"
              value={tokenValue}
              placeholder={t('settings.integrations.accounts.qobuz.tokenPlaceholder')}
              onChange={(event) => onTokenChange(event.target.value)}
              autoComplete="off"
            />
          </label>
          <p className="settings-inline-note settings-account-note">{t('settings.integrations.accounts.qobuz.tokenHint')}</p>
        </>
      ) : null}
      <div className="settings-account-actions">
        <button className="settings-action-button" type="button" disabled={busyAction === 'check'} onClick={onCheck}>
          {busyAction === 'check' ? t('settings.integrations.accounts.checkBusy') : t('settings.integrations.accounts.check')}
        </button>
        {!connected ? (
          <button className="settings-action-button settings-account-login-button" type="button" disabled={busyAction === 'login' || !tokenValue.trim()} onClick={onLogin}>
            {busyAction === 'login' ? t('settings.integrations.accounts.qobuz.loginBusy') : t('settings.integrations.accounts.qobuz.login')}
          </button>
        ) : null}
        <button className="settings-danger-button" type="button" disabled={busyAction === 'clear'} onClick={onClear}>
          {busyAction === 'clear' ? t('settings.integrations.accounts.logoutBusy') : t('settings.integrations.accounts.logout')}
        </button>
      </div>
      {connected ? (
        <div className="settings-account-meta">
          <span>{displayName ?? t('settings.integrations.accounts.qobuz.connected')}</span>
          <span>{t('settings.integrations.accounts.loginMeta', { loginAt: status?.lastLoginAt ?? 'n/a', checkedAt: status?.lastCheckedAt ?? 'n/a' })}</span>
        </div>
      ) : null}
      {message ? <p className="settings-inline-note settings-account-note">{message}</p> : null}
      {error ? <p className="settings-inline-error settings-account-note">{error}</p> : null}
    </article>
  );
};
