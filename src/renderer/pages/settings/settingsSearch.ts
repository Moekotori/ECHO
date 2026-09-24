import type { SettingsNavKey } from './settingsTypes';

export type SettingsSearchResult = {
  id: string;
  sectionKey: SettingsNavKey;
  title: string;
  path: string;
  description: string;
  targetId?: string;
  score: number;
};

export const settingsSearchAliases: Record<SettingsNavKey, string[]> = {
  accessibility: ['accessibility', 'a11y', 'screen reader', 'keyboard focus', 'high contrast', 'reduce motion', 'ui scale', '无障碍', '读屏', '键盘焦点', '高对比度', '减少动画', '界面缩放'],
  general: ['general', 'language', 'locale', 'tray', 'window size', 'backup', 'settings backup', 'data backup', 'auto backup', 'restore backup', 'random title', 'home random title', '通用', '语言', '简繁', '繁简', '托盘', '窗口尺寸', '备份', '自动备份', '数据备份', '导入备份', '首页随机标题', '首頁隨機標題'],
  experimental: [
    'experimental',
    'experiments',
    'lab',
    '实验室',
    '實驗室',
    'feature flags',
    'performance',
    'bug',
    'low load',
    'album wall virtualization',
    'osu downloader',
    'native direct',
    'local direct read',
    '实验性功能',
    '实验功能',
    '低负载播放',
    '专辑墙虚拟化',
    '本地直读',
  ],
  advancedCustom: [
    'advanced custom',
    'advanced customization',
    'customization',
    'low frequency',
    'window size',
    'signal path',
    'home waveform',
    'lyrics mv graphics',
    'feature comments',
    'notifications',
    'upcoming track',
    'fast startup',
    'data protection',
    'visual spectrum',
    '高级自定义',
    '進階自訂',
    '低频开关',
    '低頻開關',
    '记住窗口尺寸',
    '信号路径',
    '主頁波形圖',
    '主页波形图',
    '歌词 MV 图形',
    '关闭所有通知',
    '下一首预告',
    '快速启动',
    '关闭数据保护',
    '实时频谱分析',
  ],
  playback: [
    'playback',
    'audio',
    'output',
    'device',
    'wasapi',
    'exclusive',
    'juce',
    'dsd',
    'dop',
    'soxr',
    'speed',
    'hqplayer',
    'hq player',
    'network audio adapter',
    'external playback',
    'naa',
    '播放',
    '音频',
    '输出',
    '设备',
    '独占',
    '采样率',
    '重启音频',
    '变速',
    '当前播放',
  ],
  shortcuts: ['shortcuts', 'hotkeys', 'keyboard', 'local shortcut', 'global shortcut', 'record shortcut', '快捷键', '热键', '键盘', '普通快捷键', '局部快捷键', '全局快捷键'],
  lyrics: [
    'lyrics',
    'lrc',
    'karaoke',
    'offset',
    'provider',
    'romaji',
    'utaten',
    'UtaTen',
    'kana',
    'furigana',
    '假名',
    'ふりがな',
    '注音',
    'translation',
    'translate',
    'translated lyrics',
    'bilingual lyrics',
    'font',
    'lyrics font',
    'custom font',
    '字体',
    '歌词字体',
    '自定义字体',
    '歌词',
    '逐字',
    '偏移',
    '音译',
    '罗马音',
    '歌词源',
    '翻译',
    '译文',
    '中文翻译',
    '双语歌词',
    '歌詞',
    '翻譯',
    '譯文',
    '雙語歌詞',
  ],
  mv: ['mv', 'music video', 'video', 'bilibili', 'youtube', 'auto search', 'preload', 'quality', 'immersive', 'background'],
  integrations: [
    'integrations',
    'discord',
    'smtc',
    '集成',
    '联动',
    '連動',
    '外部设备',
    '状态展示',
    '直播输出',
  ],
  accounts: [
    'accounts',
    'account',
    'credentials',
    'developer credentials',
    'login',
    'last.fm',
    'youtube',
    'spotify',
    'tidal',
    'qobuz',
    'bilibili',
    'netease',
    'qq music',
    '账号',
    '账户',
    '凭据',
    '高级账号与凭据',
    '音乐服务账号',
    '登录',
    '网易云',
    'QQ 音乐',
    '哔哩哔哩',
    '会员',
  ],
  plugins: ['插件', 'plugin', 'plugins', '扩展', '脚本', 'manifest', '权限', '本地插件', '开发者', 'developer', 'sandbox', 'echo.plugin.json'],
  remote: ['remote', 'webdav', 'baidu', 'subsonic', 'jellyfin', 'emby', 'navidrome', 'server', '远程', '网盘', '百度网盘', '服务器', '媒体库', '云端'],
  eq: ['eq', 'equalizer', 'balance', 'preamp', 'channel', '均衡器', '均衡', '声道', '平衡', '预放大'],
  appearance: [
    'appearance',
    'theme',
    'dark',
    'light',
    'system',
    'wallpaper',
    'font',
    'sidebar',
    'side bar',
    'left sidebar',
    'navigation order',
    'hide navigation',
    'artist avatar',
    'artist image',
    'cover',
    'transparent',
    '\u5de6\u4fa7\u680f',
    '\u4fa7\u680f',
    '\u5bfc\u822a\u6392\u5e8f',
    '\u9690\u85cf\u680f\u76ee',
    '外观',
    '主题',
    '深色',
    '浅色',
    '跟随系统',
    '壁纸',
    '字体',
    '密度',
    '艺术家头像',
    '艺术家封面',
    '封面',
    '透明',
    '背景',
  ],
  library: [
    'library',
    'folder',
    'scan',
    'cache',
    'download',
    'metadata',
    'duplicate',
    'bpm',
    'embedded tags',
    'artist images',
    '曲库',
    '资料库',
    '文件夹',
    '扫描',
    '缓存',
    '下载',
    '元数据',
    '重复歌曲',
    '内嵌标签',
    'BPM',
    '\u7f13\u5b58',
    '\u6062\u590d',
    '\u6570\u636e\u5e93',
    '\u7f51\u76d8',
    '\u5b9e\u65f6\u66f4\u65b0',
    '\u6b4c\u8bcd',
    'MV',
    '\u66f2\u5e93\u4f53\u68c0',
    '\u5065\u5eb7\u62a5\u544a',
    '\u5bfc\u51fa\u62a5\u544a',
    'health report',
    'library health',
  ],
  about: ['about', 'version', 'update', 'diagnostics', 'crash', 'repository', 'safe mode', 'startup', '关于', '版本', '更新', '诊断', '崩溃', '仓库', '慢启动'],
  danger: ['danger', 'reset', 'clear cache', 'delete cache', 'restore defaults', 'rebuild database', 'repair database', 'delete database', 'database recovery', 'database snapshot', 'database health', 'duplicate cleanup', 'duplicate songs', '危险', '重置', '清空缓存', '恢复默认', '重建数据库', '修复数据库', '删除数据库', '数据库恢复', '曲库恢复', '健康快照', '重复歌曲', '清理重复', '重复清理'],
};

export const normalizeSettingsSearchText = (value: string): string => value.trim().toLocaleLowerCase();

export const compactSettingsSearchText = (value: string): string => normalizeSettingsSearchText(value).replace(/\s+/gu, '');

const settingsSearchKeywordAliases: Record<string, string[]> = {
  status: ['state', 'connected', 'connection', 'presence', 'running', 'enabled', 'disabled', 'error', 'login', '健康', '状态', '狀態', '连接', '連線', '在线', '启用', '啟用'],
  状态: ['status', 'state', 'presence', 'connected', 'connection', 'running', 'enabled', 'disabled', 'error', '狀態', '连接', '在线', '启用'],
  狀態: ['status', 'state', 'presence', 'connected', 'connection', 'running', 'enabled', 'disabled', 'error', '状态', '連線', '在線', '啟用'],
  presence: ['discord', 'rich presence', 'status', '状态', '狀態'],
};

export const expandSettingsSearchQuery = (query: string): string[] => {
  const normalized = normalizeSettingsSearchText(query);
  const compact = compactSettingsSearchText(query);
  const expansions = new Set([normalized, compact]);

  [normalized, compact].forEach((token) => {
    settingsSearchKeywordAliases[token]?.forEach((alias) => {
      expansions.add(normalizeSettingsSearchText(alias));
      expansions.add(compactSettingsSearchText(alias));
    });
  });

  return [...expansions].filter(Boolean);
};

export const rankSettingsSearch = (query: string, terms: string[]): number => {
  const queries = expandSettingsSearchQuery(query);
  const normalizedTerms = terms.flatMap((term) => [normalizeSettingsSearchText(term), compactSettingsSearchText(term)]).filter(Boolean);

  let bestScore = 0;
  queries.forEach((candidateQuery, queryIndex) => {
    normalizedTerms.forEach((term, termIndex) => {
      if (!candidateQuery || !term) {
        return;
      }

      const aliasPenalty = queryIndex === 0 ? 0 : 8;
      const termPenalty = Math.min(termIndex, 8);
      if (term === candidateQuery) {
        bestScore = Math.max(bestScore, 120 - aliasPenalty - termPenalty);
      } else if (term.startsWith(candidateQuery)) {
        bestScore = Math.max(bestScore, 95 - aliasPenalty - termPenalty);
      } else if (term.includes(candidateQuery)) {
        bestScore = Math.max(bestScore, 75 - aliasPenalty - termPenalty);
      } else if (candidateQuery.length >= 2 && candidateQuery.includes(term)) {
        bestScore = Math.max(bestScore, 45 - aliasPenalty - termPenalty);
      }
    });
  });

  return bestScore;
};

