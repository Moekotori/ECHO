import { describe, expect, it, vi } from 'vitest';
import type { StreamingAccountPlaylist } from '../../../shared/types/streaming';
import { syncNeteaseAccountPlaylists } from './syncNeteaseAccountPlaylists';

const accountPlaylist = (id: string, ownership: StreamingAccountPlaylist['ownership'] = 'created'): StreamingAccountPlaylist => ({
  id, provider: 'netease', providerPlaylistId: id, title: `Mix ${id}`, ownership,
  description: null, creator: null, coverUrl: null, coverThumb: null, trackCount: 3,
  webUrl: `https://music.163.com/#/playlist?id=${id}`,
});
const bridge = (playlists: StreamingAccountPlaylist[] = []) => ({
  listAccountPlaylists: vi.fn().mockResolvedValue({ provider: 'netease', playlists, fetchedAt: '' }),
  importPlaylistFromUrl: vi.fn().mockResolvedValue({ playlistId: 'imported', importedCount: 3 }),
  syncLikedSongs: vi.fn().mockResolvedValue({ providers: [{ provider: 'netease', success: true, importedCount: 5, addedCount: 2, total: 5 }] }),
});

describe('syncNeteaseAccountPlaylists', () => {
  it('syncs created, collected and liked playlists once, plus liked songs', async () => {
    const api = bridge([accountPlaylist('1'), accountPlaylist('2', 'favorited'), accountPlaylist('liked'), accountPlaylist('1')]);
    const progress = vi.fn();
    const result = await syncNeteaseAccountPlaylists(api, progress);
    expect(api.listAccountPlaylists).toHaveBeenCalledWith('netease');
    expect(api.syncLikedSongs).toHaveBeenCalledWith('netease');
    expect(api.importPlaylistFromUrl.mock.calls.map(([url]) => url)).toEqual(['1', '2', 'liked'].map(id => accountPlaylist(id).webUrl));
    expect(result).toMatchObject({ syncedPlaylists: 3, syncedTracks: 9, failedPlaylists: 0, errors: [], liked: { importedCount: 5 } });
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });

  it('still imports liked songs if account playlist listing fails', async () => {
    const api = bridge();
    api.listAccountPlaylists.mockRejectedValue(new Error('请先登录网易云音乐账号。'));
    const result = await syncNeteaseAccountPlaylists(api, vi.fn());
    expect(result.liked?.success).toBe(true);
    expect(result.errors).toEqual(['账号歌单：请先登录网易云音乐账号。']);
  });

  it('still syncs likes when no playlists are returned', async () => {
    const api = bridge();
    const result = await syncNeteaseAccountPlaylists(api, vi.fn());
    expect(result).toMatchObject({ syncedPlaylists: 0, errors: [], liked: { importedCount: 5 } });
  });

  it('preserves successful playlist imports and reports failed imports and liked sync', async () => {
    const api = bridge([accountPlaylist('1'), accountPlaylist('2'), accountPlaylist('3')]);
    api.importPlaylistFromUrl.mockRejectedValueOnce(new Error('歌单读取失败'));
    api.syncLikedSongs.mockResolvedValue({ providers: [{ provider: 'netease', success: false, importedCount: 0, addedCount: 0, total: 0, error: '登录已失效' }] });
    const result = await syncNeteaseAccountPlaylists(api, vi.fn());
    expect(result).toMatchObject({ syncedPlaylists: 2, syncedTracks: 6, failedPlaylists: 1, liked: null });
    expect(result.errors).toEqual(expect.arrayContaining(['Mix 1：歌单读取失败', '我喜欢：登录已失效']));
  });

  it('requires the full sync bridge before starting any imports', async () => {
    const api = bridge();
    await expect(syncNeteaseAccountPlaylists({ ...api, syncLikedSongs: undefined } as unknown as Parameters<typeof syncNeteaseAccountPlaylists>[0], vi.fn())).rejects.toThrow('同步不可用');
    expect(api.importPlaylistFromUrl).not.toHaveBeenCalled();
  });
});
