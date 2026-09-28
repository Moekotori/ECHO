// General song downloads stay unavailable. The dedicated osu! workflow is separate.
export const musicDownloadsEnabled = false;
export const musicDownloadsDisabledMessage = '歌曲下载功能已关闭';

export const assertMusicDownloadsEnabled = (): void => {
  if (!musicDownloadsEnabled) {
    throw new Error(musicDownloadsDisabledMessage);
  }
};
