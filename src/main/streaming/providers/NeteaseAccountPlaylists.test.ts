import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeteaseStreamingProvider, setNeteaseApiForTests } from './NeteaseStreamingProvider';

const mocks = vi.hoisted(() => ({ cookie: 'test-cookie', fetch: vi.fn() }));
vi.mock('../../accounts/AccountService', () => ({
  getAccountService: () => ({ getCredentials: () => ({ cookie: mocks.cookie }), getStatus: () => ({ connected: true }) }),
}));
vi.mock('../../network/networkFetch', () => ({ fetchWithNetworkProxy: vi.fn() }));
vi.mock('./chinaStreamingUtils', async (importOriginal) => ({
  ...await importOriginal<typeof import('./chinaStreamingUtils')>(), jsonFetch: mocks.fetch,
}));

const row = (id: number, extra = {}) => ({ id, name: `Mix ${id}`, creator: { userId: 42 }, trackCount: 2, ...extra });
const api = (user_playlist: (request: Record<string, unknown>) => Promise<{ body?: unknown }>) => ({
  login_status: vi.fn().mockResolvedValue({ body: { profile: { userId: 42 } } }), user_playlist,
});
afterEach(() => { setNeteaseApiForTests(undefined); mocks.cookie = 'test-cookie'; mocks.fetch.mockReset(); });

describe('NetEase account playlists', () => {
  it('reads every page and retains the liked playlist and subscribed playlists', async () => {
    const userPlaylist = vi.fn()
      .mockResolvedValueOnce({ body: { code: 200, playlist: [row(1, { specialType: 5 }), row(2)], more: true } })
      .mockResolvedValueOnce({ body: { code: 200, playlist: [row(2), row(3, { creator: { userId: 99 }, subscribed: true })], more: false } });
    setNeteaseApiForTests(api(userPlaylist));
    const result = await new NeteaseStreamingProvider().listAccountPlaylists();
    expect(result.map(p => [p.providerPlaylistId, p.ownership])).toEqual([['1', 'created'], ['2', 'created'], ['3', 'favorited']]);
    expect(userPlaylist.mock.calls.map(([request]) => request.offset)).toEqual([0, 1000]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('retries all pages through the fallback endpoint when the SDK fails', async () => {
    setNeteaseApiForTests(api(vi.fn().mockRejectedValue(new Error('SDK unavailable'))));
    mocks.fetch.mockResolvedValueOnce({ code: 200, playlist: [row(1)], more: true })
      .mockResolvedValueOnce({ code: 200, playlist: [row(2)], more: false });
    expect(await new NeteaseStreamingProvider().listAccountPlaylists()).toHaveLength(2);
    expect(mocks.fetch.mock.calls.map(([url]) => new URL(url).searchParams.get('offset'))).toEqual(['0', '1000']);
  });

  it('reports an expired session instead of treating it as an empty account', async () => {
    setNeteaseApiForTests(api(vi.fn().mockResolvedValue({ body: { code: 301, message: '登录已失效' } })));
    mocks.fetch.mockResolvedValue({ code: 301, message: '登录已失效' });
    await expect(new NeteaseStreamingProvider().listAccountPlaylists()).rejects.toThrow('登录已失效');
  });

  it('rejects a repeated page instead of looping or claiming a complete sync', async () => {
    setNeteaseApiForTests(api(vi.fn().mockRejectedValue(new Error('SDK unavailable'))));
    mocks.fetch.mockResolvedValue({ code: 200, playlist: [row(1)], more: true });
    await expect(new NeteaseStreamingProvider().listAccountPlaylists()).rejects.toThrow('分页未返回新内容');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('requires a signed-in account', async () => {
    mocks.cookie = '';
    await expect(new NeteaseStreamingProvider().listAccountPlaylists()).rejects.toThrow('登录网易云');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
