import type { AppSettings } from '../../shared/types/appSettings';

export type NetworkProxyProcessSettings = Pick<
  AppSettings,
  'networkProxyMode' | 'networkProxyUrl' | 'networkProxyBypassRules'
>;

const proxyEnvKeys = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
] as const;

const normalizeManualProxyUrl = (settings: NetworkProxyProcessSettings): string | null => {
  if (settings.networkProxyMode !== 'manual' || !settings.networkProxyUrl) {
    return null;
  }

  try {
    const url = new URL(settings.networkProxyUrl);
    if (
      url.protocol !== 'http:' &&
      url.protocol !== 'https:' &&
      url.protocol !== 'socks:' &&
      url.protocol !== 'socks4:' &&
      url.protocol !== 'socks5:'
    ) {
      return null;
    }
    if (!url.hostname || !url.port) {
      return null;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

const normalizeNoProxy = (bypassRules: string | null | undefined): string | null => {
  if (!bypassRules) {
    return null;
  }

  const rules = bypassRules
    .split(/[;,]/u)
    .map((rule) => rule.trim())
    .filter(Boolean)
    .filter((rule) => rule !== '<local>')
    .map((rule) => (rule.startsWith('*.') ? rule.slice(1) : rule));

  return rules.length ? rules.join(',') : null;
};

export const buildNetworkProxyEnv = (
  settings: NetworkProxyProcessSettings,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv | undefined => {
  const proxyUrl = normalizeManualProxyUrl(settings);
  if (!proxyUrl) {
    return undefined;
  }

  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of proxyEnvKeys) {
    env[key] = proxyUrl;
  }

  const noProxy = normalizeNoProxy(settings.networkProxyBypassRules);
  if (noProxy) {
    env.NO_PROXY = noProxy;
    env.no_proxy = noProxy;
  }

  return env;
};

export const buildYtDlpProxyArgs = (settings: NetworkProxyProcessSettings): string[] => {
  const proxyUrl = normalizeManualProxyUrl(settings);
  return proxyUrl ? ['--proxy', proxyUrl] : [];
};
