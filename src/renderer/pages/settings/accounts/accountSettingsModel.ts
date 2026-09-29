import type { AccountProvider } from '../../../../shared/types/accounts';
import type { EchoProAccountStatus } from '../../../../shared/types/privateEntitlements';

export const echoProActivationUrl = 'https://echonext.moe/zh/activate/';
export const generalEchoProActivationPanelExpandedStorageKey =
  'echo:settings:general:echo-pro-activation-panel-expanded';
export const generalEchoProAccountPanelExpandedStorageKey =
  'echo:settings:general:echo-pro-account-panel-expanded';

export type EchoProDisplayStatusSnapshot = {
  accountStatus: EchoProAccountStatus | null;
  pluginUnlocked: boolean | null;
};

let echoProDisplayStatusSnapshot: EchoProDisplayStatusSnapshot = {
  accountStatus: null,
  pluginUnlocked: null,
};

export const rememberEchoProDisplayStatus = (
  patch: Partial<EchoProDisplayStatusSnapshot>,
): EchoProDisplayStatusSnapshot => {
  echoProDisplayStatusSnapshot = {
    ...echoProDisplayStatusSnapshot,
    ...patch,
  };
  return echoProDisplayStatusSnapshot;
};

export const readEchoProDisplayStatusSnapshot = (): EchoProDisplayStatusSnapshot =>
  echoProDisplayStatusSnapshot;

export const resetEchoProDisplayStatusSnapshotForTests = (): void => {
  echoProDisplayStatusSnapshot = {
    accountStatus: null,
    pluginUnlocked: null,
  };
};

export const accountLoginUrls: Record<AccountProvider, string> = {
  netease: 'https://music.163.com/',
  qqmusic: 'https://y.qq.com/',
  kugou: 'https://www.kugou.com/',
  bilibili: 'https://www.bilibili.com/',
  youtube: 'https://www.youtube.com/',
  soundcloud: 'https://soundcloud.com/',
  spotify: 'https://accounts.spotify.com/',
  tidal: 'https://login.tidal.com/',
  qobuz: 'https://play.qobuz.com/login',
  osu: 'https://osu.ppy.sh/',
};

export const cookieAccountProviders: AccountProvider[] = [
  'netease',
  'qqmusic',
  'bilibili',
  'soundcloud',
  'osu',
];

export const settingsAccountProviders: AccountProvider[] = [
  'netease',
  'qqmusic',
  'bilibili',
  'soundcloud',
  'youtube',
  'spotify',
  'tidal',
  'qobuz',
  'osu',
];

export const accountProviderLogoUrls: Partial<Record<AccountProvider, string>> = {
  netease: new URL('../../../assets/service-logos/neteasecloudmusic.svg', import.meta.url).href,
  qqmusic: new URL('../../../assets/service-logos/qqmusic.svg', import.meta.url).href,
  bilibili: new URL('../../../assets/service-logos/bilibili.svg', import.meta.url).href,
  soundcloud: new URL('../../../assets/service-logos/soundcloud.svg', import.meta.url).href,
  youtube: new URL('../../../assets/service-logos/youtube.svg', import.meta.url).href,
  spotify: new URL('../../../assets/service-logos/spotify.svg', import.meta.url).href,
  tidal: new URL('../../../assets/service-logos/tidal.svg', import.meta.url).href,
  qobuz: new URL('../../../assets/service-logos/qobuz.jpg', import.meta.url).href,
  osu: new URL('../../../assets/service-logos/osu.svg', import.meta.url).href,
};
