import type { StreamingAccountPlaylist, StreamingLikedSongsSyncProviderResult } from '../../../shared/types/streaming';

type StreamingBridge = Pick<NonNullable<Window['echo']['streaming']>, 'listAccountPlaylists' | 'importPlaylistFromUrl' | 'syncLikedSongs'>;

export type NeteaseAccountSyncReport = {
  syncedPlaylists: number;
  failedPlaylists: number;
  syncedTracks: number;
  liked: StreamingLikedSongsSyncProviderResult | null;
  errors: string[];
};

/** Pulls account data into ECHO through the existing import APIs. Never writes to the account. */
export const syncNeteaseAccountPlaylists = async (
  streaming: StreamingBridge,
  onProgress: (completed: number, total: number) => void,
): Promise<NeteaseAccountSyncReport> => {
  if (!streaming.listAccountPlaylists || !streaming.importPlaylistFromUrl || !streaming.syncLikedSongs) {
    throw new Error('网易云账号同步不可用，请更新后重试。');
  }

  const report: NeteaseAccountSyncReport = { syncedPlaylists: 0, failedPlaylists: 0, syncedTracks: 0, liked: null, errors: [] };
  const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

  const syncLikes = async (): Promise<void> => {
    try {
      const result = await streaming.syncLikedSongs('netease');
      const liked = result.providers.find((item) => item.provider === 'netease');
      if (!liked?.success) throw new Error(liked?.error ?? '网易云“我喜欢”同步失败。');
      report.liked = liked;
    } catch (error) {
      report.errors.push(`我喜欢：${message(error)}`);
    }
  };

  const syncPlaylists = async (): Promise<void> => {
    let playlists: StreamingAccountPlaylist[];
    try {
      const result = await streaming.listAccountPlaylists!('netease');
      const seen = new Set<string>();
      playlists = result.playlists.filter((playlist) => {
        if (playlist.provider !== 'netease' || !playlist.webUrl.trim() || seen.has(playlist.providerPlaylistId)) return false;
        seen.add(playlist.providerPlaylistId);
        return true;
      });
    } catch (error) {
      report.errors.push(`账号歌单：${message(error)}`);
      return;
    }

    let nextIndex = 0;
    let completed = 0;
    onProgress(0, playlists.length);
    const worker = async (): Promise<void> => {
      for (;;) {
        const playlist = playlists[nextIndex++];
        if (!playlist) return;
        try {
          const imported = await streaming.importPlaylistFromUrl(playlist.webUrl);
          report.syncedPlaylists += 1;
          report.syncedTracks += imported.importedCount;
        } catch (error) {
          report.failedPlaylists += 1;
          report.errors.push(`${playlist.title}：${message(error)}`);
        } finally {
          onProgress(++completed, playlists.length);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, playlists.length) }, () => worker()));
  };

  await Promise.all([syncPlaylists(), syncLikes()]);
  return report;
};
