import type { NetworkProxyMode } from '../../../../shared/types/appSettings';
import type { TranslationKey } from '../../../i18n/locales';

export const defaultSpotifyRedirectUri = 'http://127.0.0.1:43879/spotify/callback';
export const defaultTidalRedirectUri = 'http://127.0.0.1:43880/tidal/callback';
export const spotifyDeveloperDashboardUrl = 'https://developer.spotify.com/dashboard';
export const tidalDeveloperDashboardUrl = 'https://developer.tidal.com/dashboard';
export const discogsDeveloperSettingsUrl = 'https://www.discogs.com/settings/developers';
export const integrationsCredentialPanelExpandedStorageKey =
  'echo:settings:integrations:credential-panel-expanded';

const integrationCredentialSettingIds = new Set([
  'settings-row-spotify-auth-config',
  'settings-row-tidal-auth-config',
  'settings-row-online-album-info',
  'settings-row-online-artist-info',
  'settings-row-lastfm',
  'settings-row-lastfm-connection',
  'settings-row-lastfm-now-playing',
  'settings-row-lastfm-scrobbling',
]);

export const isIntegrationCredentialSettingId = (value: string | null | undefined): boolean =>
  typeof value === 'string' && integrationCredentialSettingIds.has(value);

export const isSpotifyClientIdInputValid = (value: string): boolean => {
  const trimmed = value.trim();
  return /^[A-Za-z0-9]{8,128}$/u.test(trimmed);
};

export const isSpotifyRedirectUriInputValid = (value: string): boolean => {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    const port = Number.parseInt(url.port, 10);
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65535 &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
};

export const isTidalClientIdInputValid = (value: string): boolean =>
  /^[A-Za-z0-9_-]{8,128}$/u.test(value.trim());

export const isTidalClientSecretInputValid = (value: string): boolean =>
  /^[A-Za-z0-9._~+/=-]{8,256}$/u.test(value.trim());

export const isTidalCountryCodeInputValid = (value: string): boolean =>
  /^[A-Za-z]{2}$/u.test(value.trim());

export const defaultNetworkProxyBypassRules =
  '<local>;localhost;127.0.0.1;::1;*.local;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*';

export const buildNetworkProxyModeOptions = (
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): Array<{ value: NetworkProxyMode; label: string }> => [
  { value: 'off', label: t('settings.integrations.networkProxy.mode.off') },
  { value: 'system', label: t('settings.integrations.networkProxy.mode.system') },
  { value: 'manual', label: t('settings.integrations.networkProxy.mode.manual') },
  { value: 'pac', label: 'PAC' },
];
