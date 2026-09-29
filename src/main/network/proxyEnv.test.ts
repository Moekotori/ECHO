import { describe, expect, it } from 'vitest';
import { buildNetworkProxyEnv, buildYtDlpProxyArgs } from './proxyEnv';

describe('network proxy process helpers', () => {
  it('builds child-process proxy environment for manual proxy settings', () => {
    const env = buildNetworkProxyEnv(
      {
        networkProxyMode: 'manual',
        networkProxyUrl: 'http://127.0.0.1:7890/',
        networkProxyBypassRules: '<local>;localhost;127.0.0.1;*.local',
      },
      { PATH: 'test-path' },
    );

    expect(env).toMatchObject({
      PATH: 'test-path',
      HTTP_PROXY: 'http://127.0.0.1:7890/',
      HTTPS_PROXY: 'http://127.0.0.1:7890/',
      ALL_PROXY: 'http://127.0.0.1:7890/',
      http_proxy: 'http://127.0.0.1:7890/',
      https_proxy: 'http://127.0.0.1:7890/',
      all_proxy: 'http://127.0.0.1:7890/',
      NO_PROXY: 'localhost,127.0.0.1,.local',
      no_proxy: 'localhost,127.0.0.1,.local',
    });
  });

  it('returns yt-dlp proxy arguments only for valid manual settings', () => {
    expect(buildYtDlpProxyArgs({
      networkProxyMode: 'manual',
      networkProxyUrl: 'socks5://127.0.0.1:7890/',
      networkProxyBypassRules: null,
    })).toEqual(['--proxy', 'socks5://127.0.0.1:7890/']);

    expect(buildYtDlpProxyArgs({
      networkProxyMode: 'system',
      networkProxyUrl: 'http://127.0.0.1:7890/',
      networkProxyBypassRules: null,
    })).toEqual([]);
  });
});
