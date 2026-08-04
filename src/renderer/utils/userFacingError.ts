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

const defaultFallbackByContext: Record<UserFacingErrorContext, string> = {
  audio: '播放没有成功。ECHO 已保留详细诊断；可以先重试播放，或在“设置 > 播放”里临时切换到兼容输出。',
  downloads: '下载操作没有成功。请检查链接、网络和下载目录后再试。',
  folders: '文件夹操作没有成功。请检查路径是否存在，以及 ECHO 是否有访问权限。',
  generic: '操作没有成功。ECHO 已保留详细信息；可以稍后重试，或打开诊断报告排查。',
  library: '曲库操作没有成功。请稍后重试；如果反复出现，可以到设置里运行曲库诊断。',
  mv: 'MV 操作没有成功。请检查网络或账号状态后再试。',
  plugins: '插件操作没有成功。请检查插件状态、权限或日志后再试。',
  settings: '设置没有保存成功。请稍后重试；如果反复出现，可以重启 ECHO 后再试。',
  streaming: '流媒体服务暂时不可用。请检查网络、账号登录状态或稍后再试。',
};

const fallbackForContext = (context: UserFacingErrorContext, fallback?: string): string =>
  fallback?.trim() || defaultFallbackByContext[context];

const looksLikeRawTechnicalError = (message: string): boolean =>
  /^(Error invoking remote method|Unhandled|TypeError|ReferenceError|SyntaxError|AggregateError)\b/iu.test(message) ||
  /\b(ipc|bridge|electron|node|stack|stderr|stdout|spawn|runtime_error|ENOENT|EACCES|EPERM|SQLITE_|0x[0-9a-f]{6,})\b/iu.test(message);

const looksLikeEntitlementError = (message: string): boolean =>
  /\b(?:echo_authorization_required|echo_pro_required|echo_pro_private_overlay_unavailable|connect_donator_unlock_required|connect_hwid_not_allowed|downloads_plugin_unlock_required)\b/iu.test(message) ||
  /\becho_pro_(?:license|package)_[a-z0-9_-]+\b/iu.test(message);

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
    return '需要授权。请登录或激活 ECHO Pro 后再试。';
  }

  if (
    normalized.includes('desktop bridge unavailable') ||
    normalized.includes('bridge unavailable') ||
    normalized.includes('ipc unavailable') ||
    normalized.includes('error invoking remote method')
  ) {
    return '桌面桥接暂不可用。请在 ECHO Next 桌面端重试，或重启应用后再试。';
  }

  if (
    upper.includes('SQLITE_CORRUPT') ||
    upper.includes('DATABASEHEALTHERROR') ||
    normalized.includes('file is not a database') ||
    normalized.includes('database disk image is malformed')
  ) {
    return '曲库数据库可能已损坏。请到“设置 > 诊断”运行数据库修复，ECHO 会尽量保留你的音乐文件和配置。';
  }

  if (upper.includes('ENOENT')) {
    return '找不到对应的文件或文件夹。请确认路径还存在，再重新选择一次。';
  }

  if (upper.includes('ENOTDIR')) {
    return '选择的路径不是文件夹。请重新选择一个有效文件夹。';
  }

  if (upper.includes('EACCES') || upper.includes('EPERM')) {
    return 'ECHO 没有权限访问这个位置。请换一个目录，或检查系统权限后再试。';
  }

  if (upper.includes('ENOSPC') || normalized.includes('no space left')) {
    return '磁盘空间不足。请清理一些空间，或换一个下载/缓存目录后再试。';
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
      ? '下载服务连接失败。请检查网络、代理或链接是否可访问，然后再试。'
      : '网络连接暂时失败。请检查网络、代理或账号状态后再试。';
  }

  if (
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('cookie') ||
    normalized.includes('sessdata') ||
    /\b(401|403)\b/u.test(raw)
  ) {
    return '账号授权已失效或权限不足。请重新登录相关服务，或刷新 Cookie 后再试。';
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
