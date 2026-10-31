import type { TranslationKey } from '../i18n/locales';
import { translateStatic } from '../i18n/translateStatic';
import { formatAudioHostError } from '../components/player/audioErrorFormat';

export type UserFacingErrorContext =
  | 'audio'
  | 'downloads'
  | 'folders'
  | 'library'
  | 'mv'
  | 'plugins'
  | 'settings'
  | 'streaming'
  | 'generic';

export type UserFacingErrorOptions = {
  context?: UserFacingErrorContext;
  fallback?: string;
};

export const getRawErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error === null || error === undefined) {
    return '';
  }

  try {
    return String(error);
  } catch {
    return '';
  }
};

const tError = (key: TranslationKey, options?: Record<string, string | number>): string =>
  translateStatic(key, options);

const fallbackKeyByContext: Record<UserFacingErrorContext, TranslationKey> = {
  audio: 'userFacingError.fallback.audio',
  downloads: 'userFacingError.fallback.downloads',
  folders: 'userFacingError.fallback.folders',
  generic: 'userFacingError.fallback.generic',
  library: 'userFacingError.fallback.library',
  mv: 'userFacingError.fallback.mv',
  plugins: 'userFacingError.fallback.plugins',
  settings: 'userFacingError.fallback.settings',
  streaming: 'userFacingError.fallback.streaming',
};

const fallbackForContext = (context: UserFacingErrorContext, fallback?: string): string =>
  fallback?.trim() || tError(fallbackKeyByContext[context]);

const looksLikeRawTechnicalError = (message: string): boolean =>
  /^(Error invoking remote method|Unhandled|TypeError|ReferenceError|SyntaxError|AggregateError)\b/iu.test(message) ||
  /\b(ipc|bridge|electron|node|stack|stderr|stdout|spawn|runtime_error|ENOENT|EACCES|EPERM|SQLITE_|0x[0-9a-f]{6,})\b/iu.test(message);

const looksLikeEntitlementError = (message: string): boolean =>
  /\b(?:echo_authorization_required|echo_pro_required|echo_pro_private_overlay_unavailable|connect_donator_unlock_required|connect_hwid_not_allowed|downloads_plugin_unlock_required)\b/iu.test(message) ||
  /\becho_pro_(?:license|package)_[a-z0-9_-]+\b/iu.test(message);

/** Stable error codes and well-known message fingerprints → i18n keys. */
const knownErrorMatchers: Array<{ test: RegExp; key: TranslationKey }> = [
  { test: /\beq_preset_not_found\b/iu, key: 'error.code.eqPresetNotFound' },
  { test: /\beq_profile_not_found\b/iu, key: 'error.code.eqProfileNotFound' },
  { test: /\binvalid_eq_preset_import\b/iu, key: 'error.code.invalidEqImport' },
  { test: /\binvalid_eq_preset\b/iu, key: 'error.code.invalidEqPreset' },
  { test: /\bcannot_overwrite_builtin_eq_preset\b/iu, key: 'error.code.cannotOverwriteBuiltinEq' },
  { test: /\bcannot_delete_builtin_eq_preset\b/iu, key: 'error.code.cannotDeleteBuiltinEq' },
  { test: /\bopra_bridge_unavailable\b/iu, key: 'error.code.opraUnavailable' },
  { test: /请选择下载文件夹|Please choose a download folder|ダウンロードフォルダーを選択/iu, key: 'error.downloads.folderRequired' },
  { test: /请先设置下载目录/iu, key: 'error.downloads.folderRequired' },
  { test: /备份文件缺少 manifest\.json/iu, key: 'error.backup.missingManifest' },
  { test: /不是受支持的 ECHO Next 数据备份/iu, key: 'error.backup.unsupported' },
  { test: /备份文件缺少设置文件/iu, key: 'error.backup.missingSettings' },
  { test: /曲库扫描运行中，暂时不能导入备份/iu, key: 'error.backup.scanRunning' },
  { test: /请先选择自动备份目录/iu, key: 'error.backup.chooseDirectory' },
  { test: /曲库数据库当前不健康，已拒绝创建新的健康快照/iu, key: 'error.database.unhealthySnapshot' },
  { test: /找不到这个曲库数据库快照/iu, key: 'error.database.snapshotMissing' },
  { test: /不是可恢复的健康曲库数据库快照/iu, key: 'error.database.snapshotNotRestorable' },
  { test: /快照复制失败，曲库数据库文件没有恢复/iu, key: 'error.database.snapshotCopyFailed' },
  { test: /找不到可修复的隔离曲库数据库/iu, key: 'error.database.quarantineMissing' },
  { test: /隔离曲库副本复制失败/iu, key: 'error.database.quarantineCopyFailed' },
  { test: /当前导出只支持本地音频文件/iu, key: 'error.export.localOnly' },
  { test: /当前音频文件不存在，无法导出/iu, key: 'error.export.fileMissing' },
  { test: /没有可导出的音频文件/iu, key: 'error.export.nothingToExport' },
  { test: /导出目标已存在/iu, key: 'error.export.targetExists' },
  { test: /导出目标不能覆盖当前播放的源文件/iu, key: 'error.export.cannotOverwriteSource' },
  { test: /Spotify Premium is required|Spotify Premium 才支持播放/iu, key: 'error.spotify.premiumRequired' },
  { test: /Spotify sign-in expired|Spotify 登录已失效/iu, key: 'error.spotify.signInExpired' },
  { test: /Spotify playback device is not ready|Spotify 播放设备尚未就绪/iu, key: 'error.spotify.deviceNotReady' },
  { test: /Spotify Web Playback SDK load timed out|Spotify Web Playback SDK 加载超时/iu, key: 'error.spotify.sdkTimeout' },
  { test: /Unable to load Spotify Web Playback SDK|无法加载 Spotify Web Playback SDK/iu, key: 'error.spotify.sdkLoadFailed' },
  { test: /Spotify Web Playback SDK is not ready|Spotify Web Playback SDK 尚未就绪/iu, key: 'error.spotify.sdkNotReady' },
  { test: /not a playable Spotify track|不是可播放的 Spotify 曲目/iu, key: 'error.spotify.notPlayableTrack' },
  { test: /Spotify Client ID/iu, key: 'error.spotify.clientIdRequired' },
  { test: /流媒体歌曲不能加入本地歌单/iu, key: 'error.streaming.localPlaylistOnly' },
  { test: /只有网络歌单中的流媒体歌曲可以直接下载/iu, key: 'error.streaming.playlistOnlyDownload' },
  { test: /下载功能不适用于 Spotify|Spotify 由官方播放器播放，下载/iu, key: 'error.streaming.spotifyNoDownload' },
  { test: /暂不支持从网络歌单直接下载/iu, key: 'error.streaming.providerNoDownload' },
  { test: /Connect 投送中，远端 seek 不可用|Remote seek is unavailable while Connect/iu, key: 'error.connect.remoteSeekUnavailable' },
  { test: /HQPlayer 接管不可用|HQPlayer takeover is unavailable/iu, key: 'error.hqPlayer.channelUnavailable' },
  { test: /插件系统当前不可用|plugin system is currently unavailable/iu, key: 'error.plugin.systemUnavailable' },
  { test: /不支持设置艺术家头像|does not support setting artist avatars(?! from)/iu, key: 'error.artist.avatarUnsupported' },
  { test: /不支持选择艺术家头像|does not support choosing artist avatars/iu, key: 'error.artist.avatarChooseUnsupported' },
  { test: /不支持从网络设置艺术家头像|setting artist avatars from the network/iu, key: 'error.artist.avatarNetworkUnsupported' },
  { test: /不支持恢复自动头像|restoring automatic avatars/iu, key: 'error.artist.avatarResetUnsupported' },
  { test: /无法读取 osu! 账号数据|cannot read osu! account data/iu, key: 'error.downloads.osuAccountUnavailable' },
  { test: /桌面下载服务不可用|Desktop download service is unavailable/iu, key: 'error.bridge.downloadService' },
  { test: /桌面流媒体服务不可用|Desktop streaming service is unavailable/iu, key: 'error.bridge.streamingService' },
  { test: /桌面歌单服务不可用|Desktop playlist service is unavailable/iu, key: 'error.bridge.playlistService' },
  { test: /无法导出 Markdown|cannot export Markdown/iu, key: 'error.bridge.exportMarkdown' },
  { test: /不支持安全诊断包导出|does not support safe diagnostics zip/iu, key: 'error.bridge.diagnosticsZipUnsupported' },
  { test: /无法打开音频报告|cannot open the audio report/iu, key: 'error.bridge.openAudioReport' },
  { test: /无法打开日志目录|cannot open the log directory/iu, key: 'error.bridge.openLogDir' },
  { test: /无法解析流媒体下载地址|cannot resolve the streaming download URL/iu, key: 'error.bridge.streamingDownloadResolve' },
  { test: /本地开发接口未启动.*添加歌单|Restart npm run dev before adding playlists/iu, key: 'error.devApi.unavailable.playlist' },
  { test: /本地开发接口未启动.*每日推荐|Restart npm run dev before refreshing daily/iu, key: 'error.devApi.unavailable.dailyRecommend' },
  { test: /本地开发接口未启动.*同步喜欢歌单|Restart npm run dev before syncing liked songs/iu, key: 'error.devApi.unavailable.likedSongs' },
  { test: /Local development API is unavailable\. Restart npm run dev before syncing liked tracks/iu, key: 'error.devApi.unavailable.likedTrack' },
  { test: /添加流媒体歌单失败|Failed to add streaming playlist/iu, key: 'error.devApi.importPlaylistFailed' },
  { test: /刷新网易云每日推荐失败|Failed to refresh NetEase daily/iu, key: 'error.devApi.dailyRecommendFailed' },
  { test: /同步在线喜欢歌单失败|Failed to sync online liked songs/iu, key: 'error.devApi.syncLikedFailed' },
  { test: /Failed to sync liked track/iu, key: 'error.devApi.syncLikedTrackFailed' },
];

const matchKnownError = (message: string): string | null => {
  for (const { test, key } of knownErrorMatchers) {
    if (test.test(message)) {
      return tError(key);
    }
  }
  return null;
};

export const formatUserFacingError = (error: unknown, options: UserFacingErrorOptions = {}): string => {
  const context = options.context ?? 'generic';
  const fallback = fallbackForContext(context, options.fallback);
  const raw = getRawErrorMessage(error).replace(/\s+/gu, ' ').trim();
  const normalized = raw.toLowerCase();
  const upper = raw.toUpperCase();

  if (!raw) {
    return fallback;
  }

  if (looksLikeEntitlementError(raw)) {
    return tError('userFacingError.entitlement');
  }

  if (
    normalized.includes('desktop bridge unavailable') ||
    normalized.includes('bridge unavailable') ||
    normalized.includes('ipc unavailable') ||
    normalized.includes('no handler registered for') ||
    normalized.includes('object has been destroyed') ||
    normalized.includes('render frame was disposed') ||
    /桌面桥接/u.test(raw)
  ) {
    return tError('userFacingError.desktopBridge');
  }

  if (
    upper.includes('SQLITE_CORRUPT') ||
    upper.includes('DATABASEHEALTHERROR') ||
    normalized.includes('file is not a database') ||
    normalized.includes('database disk image is malformed')
  ) {
    return tError('userFacingError.databaseCorrupt');
  }

  if (upper.includes('ENOENT')) {
    return tError('userFacingError.fileNotFound');
  }

  if (upper.includes('ENOTDIR')) {
    return tError('userFacingError.notDirectory');
  }

  if (upper.includes('EACCES') || upper.includes('EPERM')) {
    return tError('userFacingError.permission');
  }

  if (upper.includes('ENOSPC') || normalized.includes('no space left')) {
    return tError('userFacingError.diskFull');
  }

  if (
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('network') ||
    normalized.includes('fetch failed') ||
    upper.includes('ECONNRESET') ||
    upper.includes('ECONNREFUSED') ||
    upper.includes('ENOTFOUND') ||
    upper.includes('EAI_AGAIN')
  ) {
    return context === 'downloads'
      ? tError('userFacingError.network.downloads')
      : tError('userFacingError.network.generic');
  }

  if (
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('cookie') ||
    normalized.includes('sessdata') ||
    /\b(401|403)\b/u.test(raw)
  ) {
    return tError('userFacingError.auth');
  }

  const known = matchKnownError(raw);
  if (known) {
    return known;
  }

  // Playback/audio host codes often bubble as plain strings.
  if (context === 'audio' || context === 'generic') {
    const audioFormatted = formatAudioHostError(raw);
    if (audioFormatted) {
      return audioFormatted;
    }
  }

  if (context === 'plugins' && looksLikeRawTechnicalError(raw)) {
    return fallback;
  }

  if (context === 'streaming' && looksLikeRawTechnicalError(raw)) {
    return fallback;
  }

  if (looksLikeRawTechnicalError(raw)) {
    return fallback;
  }

  return raw.length > 220 ? `${raw.slice(0, 217)}...` : raw;
};
