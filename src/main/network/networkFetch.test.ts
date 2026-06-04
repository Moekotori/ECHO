import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithNetworkProxy } from './networkFetch';

const electronNetFetchMock = vi.hoisted(() => vi.fn());
const electronReadyMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('electron', () => ({
  app: {
    isReady: electronReadyMock,
  },
  net: {
    fetch: electronNetFetchMock,
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  electronReadyMock.mockReset();
  electronReadyMock.mockReturnValue(true);
  electronNetFetchMock.mockReset();
});

describe('fetchWithNetworkProxy', () => {
  it('drops cross-origin Referer before calling Electron net.fetch', async () => {
    vi.stubEnv('VITEST', 'false');
    electronNetFetchMock.mockResolvedValue(new Response('{}'));

    await fetchWithNetworkProxy('https://api.bilibili.com/x/web-interface/view?bvid=BV1echo', {
      headers: {
        Accept: 'application/json',
        Referer: 'https://www.bilibili.com/video/BV1echo',
        'User-Agent': 'ECHO test',
      },
    });

    expect(electronNetFetchMock).toHaveBeenCalledTimes(1);
    const init = electronNetFetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(init.referrer).toBeUndefined();
    expect(init.referrerPolicy).toBeUndefined();
    expect(headers.get('referer')).toBeNull();
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('user-agent')).toBe('ECHO test');
  });

  it('passes same-origin Referer as a referrer option instead of a forbidden header', async () => {
    vi.stubEnv('VITEST', 'false');
    electronNetFetchMock.mockResolvedValue(new Response('{}'));

    await fetchWithNetworkProxy('https://api.bilibili.com/x/web-interface/nav', {
      headers: {
        Referer: 'https://api.bilibili.com/x/web-interface/nav',
      },
    });

    const init = electronNetFetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(init.referrer).toBe('https://api.bilibili.com/x/web-interface/nav');
    expect(init.referrerPolicy).toBe('unsafe-url');
    expect(headers.get('referer')).toBeNull();
  });

  it('drops cross-origin explicit referrer even when no headers are supplied', async () => {
    vi.stubEnv('VITEST', 'false');
    electronNetFetchMock.mockResolvedValue(new Response('{}'));

    await fetchWithNetworkProxy('https://api.bilibili.com/x/web-interface/search/all/v2?keyword=echo', {
      referrer: 'https://search.bilibili.com/all?keyword=echo',
    });

    const init = electronNetFetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.referrer).toBeUndefined();
    expect(init.referrerPolicy).toBeUndefined();
  });
});
