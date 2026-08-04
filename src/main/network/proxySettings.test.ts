import { describe, expect, it, vi } from 'vitest';

const setProxyMock = vi.fn();
const resolveProxyMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      fetch: fetchMock,
      setProxy: setProxyMock,
      resolveProxy: resolveProxyMock,
    },
  },
}));

describe('network proxy settings', () => {
  it('builds direct, system, manual, and PAC proxy configs', async () => {
    const { buildElectronProxyConfig } = await import('./proxySettings');

    expect(buildElectronProxyConfig({ networkProxyMode: 'off' })).toEqual({ mode: 'direct' });
    expect(buildElectronProxyConfig({ networkProxyMode: 'system' })).toEqual({ mode: 'system' });
    expect(
      buildElectronProxyConfig({
        networkProxyMode: 'manual',
        networkProxyUrl: 'http://127.0.0.1:7890/',
        networkProxyBypassRules: '<local>;localhost',
      }),
    ).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: '<local>;localhost',
    });
    expect(
      buildElectronProxyConfig({
        networkProxyMode: 'pac',
        networkProxyPacUrl: 'https://example.com/proxy.pac',
        networkProxyBypassRules: '<local>',
      }),
    ).toEqual({
      mode: 'pac_script',
      pacScript: 'https://example.com/proxy.pac',
      proxyBypassRules: '<local>',
    });
  });

  it('applies the built config to the default session', async () => {
    const { applyNetworkProxySettings } = await import('./proxySettings');

    await applyNetworkProxySettings({ networkProxyMode: 'manual', networkProxyUrl: 'socks5://127.0.0.1:7890/' });

    expect(setProxyMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'fixed_servers',
      proxyRules: 'socks5://127.0.0.1:7890',
    }));
  });

  it('returns a compact connection test result', async () => {
    const { testNetworkProxyConnection } = await import('./proxySettings');
    setProxyMock.mockResolvedValue(undefined);
    resolveProxyMock.mockResolvedValue('PROXY 127.0.0.1:7890');
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    const result = await testNetworkProxyConnection({ networkProxyMode: 'system' });

    expect(result).toMatchObject({
      ok: true,
      mode: 'system',
      resolvedProxy: 'PROXY 127.0.0.1:7890',
      status: 204,
    });
  });

  it('flags manual proxy tests that still resolve to direct', async () => {
    const { testNetworkProxyConnection } = await import('./proxySettings');
    setProxyMock.mockResolvedValue(undefined);
    resolveProxyMock.mockResolvedValue('DIRECT');
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    const result = await testNetworkProxyConnection({ networkProxyMode: 'manual', networkProxyUrl: 'http://127.0.0.1:7890/' });

    expect(result).toMatchObject({
      ok: false,
      mode: 'manual',
      message: '代理未生效，测试地址仍为直连',
      resolvedProxy: 'DIRECT',
      status: 204,
    });
  });
});
