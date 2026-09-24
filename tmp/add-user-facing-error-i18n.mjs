import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'src/renderer/i18n/locales');

const keys = [
  'userFacingError.fallback.audio',
  'userFacingError.fallback.downloads',
  'userFacingError.fallback.folders',
  'userFacingError.fallback.generic',
  'userFacingError.fallback.library',
  'userFacingError.fallback.mv',
  'userFacingError.fallback.plugins',
  'userFacingError.fallback.settings',
  'userFacingError.fallback.streaming',
  'userFacingError.entitlement',
  'userFacingError.desktopBridge',
  'userFacingError.databaseCorrupt',
  'userFacingError.fileNotFound',
  'userFacingError.notDirectory',
  'userFacingError.permission',
  'userFacingError.diskFull',
  'userFacingError.network.downloads',
  'userFacingError.network.generic',
  'userFacingError.auth',
];

const translations = {
  'zh-CN': {
    'userFacingError.fallback.audio': '播放没有成功。ECHO 已保留详细诊断；可以先重试播放，或在“设置 > 播放”里临时切换到兼容输出。',
    'userFacingError.fallback.downloads': '下载操作没有成功。请检查链接、网络和下载目录后再试。',
    'userFacingError.fallback.folders': '文件夹操作没有成功。请检查路径是否存在，以及 ECHO 是否有访问权限。',
    'userFacingError.fallback.generic': '操作没有成功。ECHO 已保留详细信息；可以稍后重试，或打开诊断报告排查。',
    'userFacingError.fallback.library': '曲库操作没有成功。请稍后重试；如果反复出现，可以到设置里运行曲库诊断。',
    'userFacingError.fallback.mv': 'MV 操作没有成功。请检查网络或账号状态后再试。',
    'userFacingError.fallback.plugins': '插件操作没有成功。请检查插件状态、权限或日志后再试。',
    'userFacingError.fallback.settings': '设置没有保存成功。请稍后重试；如果反复出现，可以重启 ECHO 后再试。',
    'userFacingError.fallback.streaming': '流媒体服务暂时不可用。请检查网络、账号登录状态或稍后再试。',
    'userFacingError.entitlement': '需要授权。请登录或激活 ECHO Pro 后再试。',
    'userFacingError.desktopBridge': '桌面桥接暂不可用。请在 ECHO Next 桌面端重试，或重启应用后再试。',
    'userFacingError.databaseCorrupt': '曲库数据库可能已损坏。请到“设置 > 诊断”运行数据库修复，ECHO 会尽量保留你的音乐文件和配置。',
    'userFacingError.fileNotFound': '找不到对应的文件或文件夹。请确认路径还存在，再重新选择一次。',
    'userFacingError.notDirectory': '选择的路径不是文件夹。请重新选择一个有效文件夹。',
    'userFacingError.permission': 'ECHO 没有权限访问这个位置。请换一个目录，或检查系统权限后再试。',
    'userFacingError.diskFull': '磁盘空间不足。请清理一些空间，或换一个下载/缓存目录后再试。',
    'userFacingError.network.downloads': '下载服务连接失败。请检查网络、代理或链接是否可访问，然后再试。',
    'userFacingError.network.generic': '网络连接暂时失败。请检查网络、代理或账号状态后再试。',
    'userFacingError.auth': '账号授权已失效或权限不足。请重新登录相关服务，或刷新 Cookie 后再试。',
  },
  'zh-TW': {
    'userFacingError.fallback.audio': '播放沒有成功。ECHO 已保留詳細診斷；可以先重試播放，或在「設定 > 播放」裡暫時切換到相容輸出。',
    'userFacingError.fallback.downloads': '下載操作沒有成功。請檢查連結、網路和下載目錄後再試。',
    'userFacingError.fallback.folders': '資料夾操作沒有成功。請檢查路徑是否存在，以及 ECHO 是否有存取權限。',
    'userFacingError.fallback.generic': '操作沒有成功。ECHO 已保留詳細資訊；可以稍後重試，或開啟診斷報告排查。',
    'userFacingError.fallback.library': '曲庫操作沒有成功。請稍後重試；如果反覆出現，可以到設定裡執行曲庫診斷。',
    'userFacingError.fallback.mv': 'MV 操作沒有成功。請檢查網路或帳號狀態後再試。',
    'userFacingError.fallback.plugins': '外掛操作沒有成功。請檢查外掛狀態、權限或日誌後再試。',
    'userFacingError.fallback.settings': '設定沒有儲存成功。請稍後重試；如果反覆出現，可以重啟 ECHO 後再試。',
    'userFacingError.fallback.streaming': '串流服務暫時不可用。請檢查網路、帳號登入狀態或稍後再試。',
    'userFacingError.entitlement': '需要授權。請登入或啟用 ECHO Pro 後再試。',
    'userFacingError.desktopBridge': '桌面橋接暫不可用。請在 ECHO Next 桌面端重試，或重啟應用程式後再試。',
    'userFacingError.databaseCorrupt': '曲庫資料庫可能已損壞。請到「設定 > 診斷」執行資料庫修復，ECHO 會盡量保留你的音樂檔案和設定。',
    'userFacingError.fileNotFound': '找不到對應的檔案或資料夾。請確認路徑還存在，再重新選擇一次。',
    'userFacingError.notDirectory': '選擇的路徑不是資料夾。請重新選擇一個有效資料夾。',
    'userFacingError.permission': 'ECHO 沒有權限存取這個位置。請換一個目錄，或檢查系統權限後再試。',
    'userFacingError.diskFull': '磁碟空間不足。請清理一些空間，或換一個下載/快取目錄後再試。',
    'userFacingError.network.downloads': '下載服務連線失敗。請檢查網路、代理或連結是否可存取，然後再試。',
    'userFacingError.network.generic': '網路連線暫時失敗。請檢查網路、代理或帳號狀態後再試。',
    'userFacingError.auth': '帳號授權已失效或權限不足。請重新登入相關服務，或重新整理 Cookie 後再試。',
  },
  'en-US': {
    'userFacingError.fallback.audio': 'Playback did not succeed. ECHO kept detailed diagnostics; retry playback, or temporarily switch to compatible output in Settings > Playback.',
    'userFacingError.fallback.downloads': 'The download operation did not succeed. Check the link, network, and download folder, then try again.',
    'userFacingError.fallback.folders': 'The folder operation did not succeed. Check that the path exists and that ECHO has access.',
    'userFacingError.fallback.generic': 'The operation did not succeed. ECHO kept details; retry later, or open a diagnostics report.',
    'userFacingError.fallback.library': 'The library operation did not succeed. Retry later; if it keeps happening, run library diagnostics in Settings.',
    'userFacingError.fallback.mv': 'The MV operation did not succeed. Check the network or account status, then try again.',
    'userFacingError.fallback.plugins': 'The plugin operation did not succeed. Check the plugin status, permissions, or logs, then try again.',
    'userFacingError.fallback.settings': 'Settings could not be saved. Retry later; if it keeps happening, restart ECHO and try again.',
    'userFacingError.fallback.streaming': 'The streaming service is temporarily unavailable. Check the network, account sign-in, or try again later.',
    'userFacingError.entitlement': 'Authorization required. Sign in or activate ECHO Pro, then try again.',
    'userFacingError.desktopBridge': 'Desktop bridge is temporarily unavailable. Retry in the ECHO Next desktop app, or restart the app.',
    'userFacingError.databaseCorrupt': 'The library database may be corrupted. Run database repair in Settings > Diagnostics. ECHO will try to keep your music files and configuration.',
    'userFacingError.fileNotFound': 'The file or folder could not be found. Confirm the path still exists, then choose it again.',
    'userFacingError.notDirectory': 'The selected path is not a folder. Choose a valid folder again.',
    'userFacingError.permission': 'ECHO does not have permission to access this location. Choose another folder, or check system permissions.',
    'userFacingError.diskFull': 'There is not enough disk space. Free some space, or choose another download/cache folder.',
    'userFacingError.network.downloads': 'Could not connect to the download service. Check the network, proxy, or link availability, then try again.',
    'userFacingError.network.generic': 'The network connection failed temporarily. Check the network, proxy, or account status, then try again.',
    'userFacingError.auth': 'Account authorization expired or lacks permission. Sign in to the service again, or refresh the cookie.',
  },
  'ja-JP': {
    'userFacingError.fallback.audio': '再生に失敗しました。ECHO は詳細な診断を保持しています。再生を再試行するか、「設定 > 再生」で一時的に互換出力へ切り替えてください。',
    'userFacingError.fallback.downloads': 'ダウンロード操作に失敗しました。リンク、ネットワーク、ダウンロードフォルダーを確認してから再試行してください。',
    'userFacingError.fallback.folders': 'フォルダー操作に失敗しました。パスが存在するか、ECHO にアクセス権があるかを確認してください。',
    'userFacingError.fallback.generic': '操作に失敗しました。ECHO は詳細を保持しています。後で再試行するか、診断レポートを開いてください。',
    'userFacingError.fallback.library': 'ライブラリ操作に失敗しました。後で再試行してください。繰り返す場合は設定でライブラリ診断を実行してください。',
    'userFacingError.fallback.mv': 'MV 操作に失敗しました。ネットワークまたはアカウント状態を確認してから再試行してください。',
    'userFacingError.fallback.plugins': 'プラグイン操作に失敗しました。プラグインの状態、権限、またはログを確認してから再試行してください。',
    'userFacingError.fallback.settings': '設定を保存できませんでした。後で再試行してください。繰り返す場合は ECHO を再起動してから試してください。',
    'userFacingError.fallback.streaming': 'ストリーミングサービスは一時的に利用できません。ネットワーク、アカウントのサインイン、または後でもう一度お試しください。',
    'userFacingError.entitlement': '認可が必要です。サインインするか ECHO Pro を有効にしてから再試行してください。',
    'userFacingError.desktopBridge': 'デスクトップブリッジは一時的に利用できません。ECHO Next デスクトップで再試行するか、アプリを再起動してください。',
    'userFacingError.databaseCorrupt': 'ライブラリデータベースが破損している可能性があります。「設定 > 診断」でデータベース修復を実行してください。ECHO は音楽ファイルと設定の保持に努めます。',
    'userFacingError.fileNotFound': '対応するファイルまたはフォルダーが見つかりません。パスがまだ存在するか確認してから、もう一度選択してください。',
    'userFacingError.notDirectory': '選択したパスはフォルダーではありません。有効なフォルダーを選び直してください。',
    'userFacingError.permission': 'ECHO はこの場所にアクセスする権限がありません。別のフォルダーを選ぶか、システム権限を確認してください。',
    'userFacingError.diskFull': 'ディスク容量が不足しています。空き容量を増やすか、別のダウンロード/キャッシュフォルダーを選んでください。',
    'userFacingError.network.downloads': 'ダウンロードサービスへ接続できませんでした。ネットワーク、プロキシ、リンクの可用性を確認してから再試行してください。',
    'userFacingError.network.generic': 'ネットワーク接続が一時的に失敗しました。ネットワーク、プロキシ、またはアカウント状態を確認してから再試行してください。',
    'userFacingError.auth': 'アカウント認可の期限切れ、または権限不足です。関連サービスに再度サインインするか、Cookie を更新してください。',
  },
};

const fileMap = {
  'zh-CN': 'zhCN.ts',
  'zh-TW': 'zhTW.ts',
  'en-US': 'enUS.ts',
  'ja-JP': 'jaJP.ts',
};

function escapeTsString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function insert(filePath, locale) {
  let text = readFileSync(filePath, 'utf8');
  if (text.includes("'userFacingError.fallback.audio'")) {
    console.log('skip already present', filePath);
    return;
  }
  const block = keys
    .map((k) => `  '${k}': '${escapeTsString(translations[locale][k])}',`)
    .join('\n');
  const closingIdx = text.lastIndexOf('\n};');
  text = `${text.slice(0, closingIdx)}\n  // --- user-facing error messages ---\n${block}${text.slice(closingIdx)}`;
  writeFileSync(filePath, text, 'utf8');
  console.log('inserted', locale, keys.length);
}

for (const [locale, file] of Object.entries(fileMap)) {
  insert(join(localesDir, file), locale);
}

// Update TranslationKey union in locales.ts
const localesTsPath = join(root, 'src/renderer/i18n/locales.ts');
let localesTs = readFileSync(localesTsPath, 'utf8');
if (!localesTs.includes("'userFacingError.fallback.audio'")) {
  const insertPoint = "  | 'spotifyPlayback.error.noDrmKeysystem';";
  const keyUnion = keys.map((k) => `  | '${k}'`).join('\n');
  if (!localesTs.includes(insertPoint)) {
    throw new Error('Could not find insert point in locales.ts');
  }
  localesTs = localesTs.replace(
    insertPoint,
    `${insertPoint}\n${keyUnion}`,
  );
  writeFileSync(localesTsPath, localesTs, 'utf8');
  console.log('updated TranslationKey union');
} else {
  console.log('TranslationKey already has userFacingError keys');
}
