import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpenCC = require('opencc-js');
const toTw = OpenCC.Converter({ from: 'cn', to: 'twp' });

const entries = {
  'settings.remote.ux.date.never': { zh: '尚未执行', en: 'Not run yet', ja: '未実行' },
  'settings.remote.ux.noData': { zh: '暂无数据', en: 'No data yet', ja: 'データなし' },
  'settings.remote.ux.operationFailed': { zh: '操作失败。', en: 'Operation failed.', ja: '操作に失敗しました。' },
  'settings.remote.ux.unavailableFallback': { zh: '这个来源暂时不可用。', en: 'This source is temporarily unavailable.', ja: 'このソースは一時的に利用できません。' },
  'settings.remote.ux.error.timeout.title': { zh: '服务器响应有点慢', en: 'The server is responding slowly', ja: 'サーバーの応答が遅いです' },
  'settings.remote.ux.error.timeout.description': {
    zh: '现有索引和缓存不会消失。可以稍后重试，或先确认服务器地址与端口仍能访问。',
    en: 'Existing indexes and caches stay intact. Retry later, or confirm the server address and port are still reachable.',
    ja: '既存のインデックスとキャッシュは残ります。後で再試行するか、サーバーのアドレスとポートを確認してください。',
  },
  'settings.remote.ux.error.dns.title': { zh: '暂时找不到这个服务器', en: 'This server could not be found', ja: 'このサーバーが見つかりません' },
  'settings.remote.ux.error.dns.description': {
    zh: '请检查域名、家庭网络或 VPN。网络恢复后，ECHO 会自动做一次轻量重连。',
    en: 'Check the domain, home network, or VPN. When the network returns, ECHO will attempt a light reconnect.',
    ja: 'ドメイン、家庭ネットワーク、または VPN を確認してください。ネットワーク復帰後、ECHO は軽量な再接続を試みます。',
  },
  'settings.remote.ux.error.network.title': { zh: '现在连接不上', en: 'Cannot connect right now', ja: '現在接続できません' },
  'settings.remote.ux.error.network.description': {
    zh: '音乐索引会继续保留。请确认服务正在运行；恢复联网时 ECHO 会自动测试一次。',
    en: 'The music index is kept. Confirm the service is running; ECHO will test once when the network returns.',
    ja: '音楽インデックスは保持されます。サービス稼働を確認してください。ネットワーク復帰時に ECHO が一度テストします。',
  },
  'settings.remote.ux.error.auth.title': { zh: '需要重新验证身份', en: 'Re-authentication required', ja: '再認証が必要です' },
  'settings.remote.ux.error.auth.description': {
    zh: '用户名、密码或 token 可能已变化。更新凭据不会删除现有索引和收藏。',
    en: 'Username, password, or token may have changed. Updating credentials will not delete existing indexes or likes.',
    ja: 'ユーザー名、パスワード、または token が変わった可能性があります。資格情報の更新で既存インデックスやお気に入りは消えません。',
  },
  'settings.remote.ux.error.path.title': { zh: '音乐目录搬家了', en: 'The music folder may have moved', ja: '音楽フォルダーが移動した可能性があります' },
  'settings.remote.ux.error.path.description': {
    zh: '请检查根目录设置。ECHO 会保留现有记录，不会因为一次找不到目录就清空曲库。',
    en: 'Check the root path setting. ECHO keeps existing records and will not clear the library after one missing path.',
    ja: 'ルートパス設定を確認してください。ECHO は既存記録を保持し、一度見つからなくてもライブラリを消しません。',
  },
  'settings.remote.ux.error.generic.title': { zh: '这个来源暂时不可用', en: 'This source is temporarily unavailable', ja: 'このソースは一時的に利用できません' },
  'settings.remote.ux.error.generic.description': {
    zh: '现有索引仍会保留。可以重新连接；如果问题持续，再查看高级详情。',
    en: 'Existing indexes remain. Reconnect; if it continues, check advanced details.',
    ja: '既存インデックスは残ります。再接続し、続く場合は詳細を確認してください。',
  },
  'settings.remote.ux.error.rawReason': { zh: '原始原因：{message}', en: 'Raw reason: {message}', ja: '元の理由: {message}' },
  'settings.remote.ux.health.reconnecting.title': { zh: '正在恢复连接', en: 'Restoring connection', ja: '接続を復旧中' },
  'settings.remote.ux.health.reconnecting.description': {
    zh: '只进行一次轻量测试，不会启动同步。',
    en: 'Runs one light test without starting a sync.',
    ja: '同期は開始せず、軽いテストを 1 回だけ行います。',
  },
  'settings.remote.ux.health.syncing.title': { zh: '正在同步', en: 'Syncing', ja: '同期中' },
  'settings.remote.ux.health.syncing.description': {
    zh: '已发现 {count} 首，播放时会自动降低后台负载。',
    en: 'Found {count} tracks. Background load is reduced during playback.',
    ja: '{count} 曲を発見。再生中はバックグラウンド負荷を自動で下げます。',
  },
  'settings.remote.ux.health.paused.title': { zh: '已暂停', en: 'Paused', ja: '一時停止' },
  'settings.remote.ux.health.paused.description': {
    zh: '连接信息仍保留，重新启用后可以继续同步。',
    en: 'Connection details are kept. Re-enable to continue syncing.',
    ja: '接続情報は保持されます。再有効化すると同期を続けられます。',
  },
  'settings.remote.ux.health.issues.title': { zh: '{count} 项需要留意', en: '{count} items need attention', ja: '{count} 件の注意点' },
  'settings.remote.ux.health.issues.description': {
    zh: '歌曲仍可使用；可以在来源详情中查看缺失文件或元数据问题。',
    en: 'Tracks remain usable. Check missing files or metadata issues in source details.',
    ja: '曲は引き続き利用できます。ソース詳細で不足ファイルやメタデータ問題を確認してください。',
  },
  'settings.remote.ux.health.neverSynced.title': { zh: '还没有同步', en: 'Not synced yet', ja: 'まだ同期していません' },
  'settings.remote.ux.health.neverSynced.description': {
    zh: '先预览变化，确认后再建立本地索引。',
    en: 'Preview changes first, then build the local index.',
    ja: '先に変更をプレビューし、確認してからローカルインデックスを作成してください。',
  },
  'settings.remote.ux.health.stale.title': { zh: '一周没有同步', en: 'No sync for a week', ja: '1 週間同期がありません' },
  'settings.remote.ux.health.stale.description': {
    zh: '上次成功同步：{date}。建议先预览变化。',
    en: 'Last successful sync: {date}. Preview changes first.',
    ja: '前回の成功同期: {date}。先に変更をプレビューすることをおすすめします。',
  },
  'settings.remote.ux.health.healthy.title': { zh: '一切正常', en: 'All good', ja: '問題なし' },
  'settings.remote.ux.health.healthy.description': {
    zh: '上次成功同步：{date}。',
    en: 'Last successful sync: {date}.',
    ja: '前回の成功同期: {date}。',
  },
  'settings.remote.ux.issue.missing': { zh: '缺失文件', en: 'Missing files', ja: '不足ファイル' },
  'settings.remote.ux.source.enabled': { zh: '已启用', en: 'Enabled', ja: '有効' },
  'settings.remote.ux.source.disabled': { zh: '已禁用', en: 'Disabled', ja: '無効' },
  'settings.remote.ux.source.error': { zh: '异常', en: 'Error', ja: '異常' },
  'settings.remote.ux.cover.progress': {
    zh: '已加载 {processed} / {total} · 还剩 {pending} · 运行 {running}',
    en: 'Loaded {processed} / {total} · {pending} left · {running} running',
    ja: '読み込み済み {processed} / {total} · 残り {pending} · 実行中 {running}',
  },
  'settings.remote.ux.cover.none': { zh: '暂无封面任务', en: 'No cover jobs yet', ja: 'ジャケットタスクはまだありません' },
  'settings.remote.ux.completion': { zh: '{done}/{total} · {percent}%', en: '{done}/{total} · {percent}%', ja: '{done}/{total} · {percent}%' },
  'settings.remote.ux.browser.filter.all': { zh: '全部', en: 'All', ja: 'すべて' },
  'settings.remote.ux.browser.filter.audio': { zh: '音频', en: 'Audio', ja: '音声' },
  'settings.remote.ux.browser.filter.unindexed': { zh: '未索引', en: 'Unindexed', ja: '未インデックス' },
  'settings.remote.ux.browser.filter.indexed': { zh: '已入库', en: 'Indexed', ja: 'インデックス済み' },
  'settings.remote.ux.task.pending': { zh: '待处理', en: 'Pending', ja: '未処理' },
  'settings.remote.ux.task.searching': { zh: '处理中', en: 'Processing', ja: '処理中' },
  'settings.remote.ux.task.partial': { zh: '部分', en: 'Partial', ja: '一部' },
  'settings.remote.ux.task.ok': { zh: '完成', en: 'Done', ja: '完了' },
  'settings.remote.ux.task.notFound': { zh: '未找到', en: 'Not found', ja: '未検出' },
  'settings.remote.ux.task.error': { zh: '异常', en: 'Error', ja: '異常' },
  'settings.remote.ux.browser.root': { zh: '根目录', en: 'Root', ja: 'ルート' },
  'settings.remote.ux.auth.none': { zh: '无需认证', en: 'No auth required', ja: '認証不要' },
  'settings.remote.ux.auth.password': { zh: '用户名密码', en: 'Username and password', ja: 'ユーザー名とパスワード' },
  'settings.remote.ux.auth.generic': { zh: '认证', en: 'Authentication', ja: '認証' },
  'settings.remote.ux.recommend.metadata': {
    zh: '有 {count} 首元数据异常，建议先只重试元数据/时长。',
    en: '{count} tracks have metadata issues. Retry metadata/duration first.',
    ja: '{count} 曲にメタデータ異常があります。先にメタデータ/再生時間だけ再試行してください。',
  },
  'settings.remote.ux.recommend.cover': {
    zh: '有 {count} 首封面异常，可单独重试封面补齐。',
    en: '{count} tracks have cover issues. Retry cover fill alone.',
    ja: '{count} 曲にジャケット異常があります。ジャケット補完だけ再試行できます。',
  },
  'settings.remote.ux.recommend.lyrics': {
    zh: '有 {count} 首歌词异常，可单独重试歌词补齐。',
    en: '{count} tracks have lyrics issues. Retry lyrics fill alone.',
    ja: '{count} 曲に歌詞異常があります。歌詞補完だけ再試行できます。',
  },
  'settings.remote.ux.recommend.missing': {
    zh: '有 {count} 个缺失文件，建议检查服务器目录或重新同步。',
    en: '{count} missing files. Check the server folder or resync.',
    ja: '不足ファイルが {count} 件あります。サーバーフォルダーを確認するか再同期してください。',
  },
  'settings.remote.ux.recommend.mv': {
    zh: '有 {count} 首 MV 异常，可单独重试 MV 补齐。',
    en: '{count} tracks have MV issues. Retry MV fill alone.',
    ja: '{count} 曲に MV 異常があります。MV 補完だけ再試行できます。',
  },
  'settings.remote.ux.sync.discovering': { zh: '正在发现音乐', en: 'Discovering music', ja: '音楽を検出中' },
  // streaming search quick
  'streaming.error.desktopBridge': {
    zh: '桌面桥接不可用，请在 ECHO Next 客户端中使用流媒体。',
    en: 'Desktop bridge unavailable. Use streaming in the ECHO Next desktop app.',
    ja: 'デスクトップブリッジを利用できません。ECHO Next デスクトップでストリームを使ってください。',
  },
  'streaming.error.serviceUnavailable': { zh: '流媒体服务暂时不可用', en: 'Streaming is temporarily unavailable', ja: 'ストリームは一時的に利用できません' },
  'streaming.error.albumDetailUnavailable': { zh: '专辑详情暂时不可用', en: 'Album details are temporarily unavailable', ja: 'アルバム詳細は一時的に利用できません' },
  'streaming.error.artistDetailUnavailable': { zh: '艺人详情暂时不可用', en: 'Artist details are temporarily unavailable', ja: 'アーティスト詳細は一時的に利用できません' },
  'streaming.error.trackUnplayable': { zh: '这首歌暂时不可播放', en: 'This track is temporarily unplayable', ja: 'この曲は一時的に再生できません' },
  'streaming.message.addedToQueue': { zh: '已加入队列', en: 'Added to queue', ja: 'キューに追加しました' },
  'streaming.message.favorited': { zh: '已收藏：{title}', en: 'Liked: {title}', ja: 'お気に入りに追加: {title}' },
  'streaming.message.unfavorited': { zh: '已取消收藏：{title}', en: 'Unliked: {title}', ja: 'お気に入りを解除: {title}' },
  'streaming.error.favoriteFailed': { zh: '收藏操作没有成功', en: 'Like action failed', ja: 'お気に入り操作に失敗しました' },
  'streaming.error.platformStreamOnly': {
    zh: '这个平台在 ECHO Next 中仅支持流播放，不提供下载任务。',
    en: 'This platform only supports streaming playback in ECHO Next, not download jobs.',
    ja: 'このプラットフォームは ECHO Next ではストリーム再生のみ対応で、ダウンロードはできません。',
  },
  'streaming.error.noDirectDownload': {
    zh: '这个平台暂不支持从流媒体结果直接下载。',
    en: 'This platform does not support direct download from streaming results yet.',
    ja: 'このプラットフォームはストリーム結果からの直接ダウンロードに未対応です。',
  },
  'streaming.error.downloadService': { zh: '桌面下载服务不可用。', en: 'Desktop download service is unavailable.', ja: 'デスクトップのダウンロードサービスを利用できません。' },
  'streaming.message.downloadQueued': { zh: '已加入下载队列：{title}', en: 'Queued download: {title}', ja: 'ダウンロードキューに追加: {title}' },
  'streaming.error.downloadJobFailed': { zh: '添加下载任务失败', en: 'Failed to create download job', ja: 'ダウンロードタスクの作成に失敗しました' },
  'streaming.message.downloadCompleted': { zh: '下载成功：{title}', en: 'Download complete: {title}', ja: 'ダウンロード完了: {title}' },
  'streaming.error.downloadServiceDesktop': {
    zh: '下载服务不可用：请在 ECHO Next 桌面端使用。',
    en: 'Download service unavailable. Use the ECHO Next desktop app.',
    ja: 'ダウンロードサービスを利用できません。ECHO Next デスクトップを使ってください。',
  },
  'streaming.error.albumNoDownloadable': {
    zh: '这张流媒体专辑没有可下载的歌曲。',
    en: 'This streaming album has no downloadable tracks.',
    ja: 'このストリームアルバムにはダウンロード可能な曲がありません。',
  },
  'streaming.message.albumDownloadFailed': { zh: '无法下载专辑：{title}', en: 'Cannot download album: {title}', ja: 'アルバムをダウンロードできません: {title}' },
  'streaming.message.albumDownloadPrepare': {
    zh: '准备下载专辑：{title}（0/{total}）',
    en: 'Preparing album download: {title} (0/{total})',
    ja: 'アルバムダウンロード準備中: {title}（0/{total}）',
  },
  'streaming.message.albumDownloadProgress': {
    zh: '专辑下载中：{title}，{done}/{total} · {progress}%',
    en: 'Album downloading: {title}, {done}/{total} · {progress}%',
    ja: 'アルバムダウンロード中: {title}、{done}/{total} · {progress}%',
  },
  'streaming.message.albumDownloadDone': {
    zh: '专辑下载完成：{title}（{total}/{total}）',
    en: 'Album download complete: {title} ({total}/{total})',
    ja: 'アルバムダウンロード完了: {title}（{total}/{total}）',
  },
  'streaming.message.albumDownloadFinishedPartial': {
    zh: '专辑下载结束：{title}，完成 {done}/{total}，失败 {failed}',
    en: 'Album download finished: {title}, {done}/{total} completed, {failed} failed',
    ja: 'アルバムダウンロード終了: {title}、完了 {done}/{total}、失敗 {failed}',
  },
};

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function insert(file, locale) {
  let t = readFileSync(file, 'utf8');
  let n = 0;
  for (const [k, v] of Object.entries(entries)) {
    if (t.includes(`'${k}'`)) continue;
    const val = locale === 'en' ? v.en : locale === 'ja' ? v.ja : locale === 'tw' ? toTw(v.zh) : v.zh;
    const line = `  '${k}': '${esc(val)}',`;
    const idx = t.lastIndexOf('\n};');
    t = `${t.slice(0, idx)}\n${line}${t.slice(idx)}`;
    n += 1;
  }
  if (n) writeFileSync(file, t);
  return n;
}

for (const [f, l] of [
  ['zhCN', 'zh'],
  ['enUS', 'en'],
  ['zhTW', 'tw'],
  ['jaJP', 'ja'],
]) {
  console.log(l, insert(`src/renderer/i18n/locales/${f}.ts`, l));
}

let locales = readFileSync('src/renderer/i18n/locales.ts', 'utf8');
const keys = Object.keys(entries).filter((k) => !locales.includes(`'${k}'`));
if (keys.length) {
  // settings.remote.* might partially be flexible? Flexible is settings.about/danger/integrations only.
  // streaming.* is not flexible either.
  const union = keys.map((k) => `  | '${k}'`).join('\n');
  const point = "| 'playlists.error.playlistDownloadJobFailed';";
  if (!locales.includes(point)) throw new Error('insert point missing');
  locales = locales.replace(point, `${point}\n${union};`);
  writeFileSync('src/renderer/i18n/locales.ts', locales);
  console.log('TranslationKey +', keys.length);
}
