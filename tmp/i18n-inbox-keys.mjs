import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpenCC = require('opencc-js');
const toTw = OpenCC.Converter({ from: 'cn', to: 'twp' });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'src/renderer/i18n/locales');

const entries = {
  'inboxPage.reason.missing_cover': { zh: '缺封面', en: 'Missing cover', ja: 'ジャケット不足' },
  'inboxPage.reason.missing_title': { zh: '缺标题', en: 'Missing title', ja: 'タイトル不足' },
  'inboxPage.reason.missing_artist': { zh: '缺艺人', en: 'Missing artist', ja: 'アーティスト不足' },
  'inboxPage.reason.missing_album': { zh: '缺专辑', en: 'Missing album', ja: 'アルバム不足' },
  'inboxPage.reason.missing_album_artist': { zh: '缺专辑艺人', en: 'Missing album artist', ja: 'アルバムアーティスト不足' },
  'inboxPage.reason.missing_track_no': { zh: '缺音轨号', en: 'Missing track number', ja: 'トラック番号不足' },
  'inboxPage.reason.missing_disc_no': { zh: '缺碟号', en: 'Missing disc number', ja: 'ディスク番号不足' },
  'inboxPage.reason.missing_year': { zh: '缺年份', en: 'Missing year', ja: '年不足' },
  'inboxPage.reason.missing_genre': { zh: '缺流派', en: 'Missing genre', ja: 'ジャンル不足' },
  'inboxPage.reason.unknown_artist': { zh: '未知艺人', en: 'Unknown artist', ja: '不明なアーティスト' },
  'inboxPage.reason.filename_fallback': { zh: '文件名回退', en: 'Filename fallback', ja: 'ファイル名フォールバック' },
  'inboxPage.reason.unknown_field': { zh: '未知字段', en: 'Unknown field', ja: '不明なフィールド' },
  'inboxPage.reason.metadata_fallback': { zh: '元数据回退', en: 'Metadata fallback', ja: 'メタデータフォールバック' },
  'inboxPage.reason.unknown_album': { zh: '未知专辑', en: 'Unknown album', ja: '不明なアルバム' },
  'inboxPage.reason.embedded_metadata_error': { zh: '内嵌标签读取失败', en: 'Embedded tag read failed', ja: '埋め込みタグの読み取り失敗' },
  'inboxPage.reason.embedded_cover_error': { zh: '内嵌封面读取失败', en: 'Embedded cover read failed', ja: '埋め込みジャケットの読み取り失敗' },
  'inboxPage.reason.network_metadata_candidate': { zh: '网络元数据候选', en: 'Network metadata candidate', ja: 'ネットワークメタデータ候補' },
  'inboxPage.reason.network_cover_candidate': { zh: '网络封面候选', en: 'Network cover candidate', ja: 'ネットワークジャケット候補' },
  'inboxPage.reason.suspicious_file': { zh: '疑似异常', en: 'Suspicious file', ja: '疑わしいファイル' },
  'inboxPage.error.desktopBridgePlaylist': { zh: '桌面桥接暂不可用，无法生成歌单。', en: 'Desktop bridge unavailable; cannot create a playlist.', ja: 'デスクトップブリッジを利用できないため、プレイリストを作成できません。' },
  'inboxPage.error.desktopBridgeQueue': { zh: '桌面桥接暂不可用，无法加入队列。', en: 'Desktop bridge unavailable; cannot add to queue.', ja: 'デスクトップブリッジを利用できないため、キューに追加できません。' },
  'inboxPage.error.desktopBridgeState': { zh: '桌面桥接暂不可用，无法更新收件箱状态。', en: 'Desktop bridge unavailable; cannot update inbox status.', ja: 'デスクトップブリッジを利用できないため、受信箱の状態を更新できません。' },
  'inboxPage.error.desktopBridgeLocate': { zh: '桌面桥接暂不可用，无法定位歌曲。', en: 'Desktop bridge unavailable; cannot locate the track.', ja: 'デスクトップブリッジを利用できないため、曲を特定できません。' },
  'inboxPage.error.noLocalTracks': { zh: '当前筛选没有可加入队列的本地歌曲。', en: 'No local tracks in the current filter can be added to the queue.', ja: '現在の絞り込みにはキューに追加できるローカル曲がありません。' },
  'inboxPage.playlist.name': { zh: '新歌待听清单', en: 'New tracks to listen', ja: '新曲リスニングリスト' },
  'inboxPage.message.playlistCreated': { zh: '已生成歌单「{name}」，加入 {count} 首。', en: 'Created playlist “{name}” with {count} tracks.', ja: 'プレイリスト「{name}」を作成し、{count} 曲を追加しました。' },
  'inboxPage.message.playlistCreatedTruncated': { zh: '已生成歌单「{name}」，加入 {count} 首，已按性能保护加入前 {limit} 首。', en: 'Created playlist “{name}” with {count} tracks (performance limit: first {limit}).', ja: 'プレイリスト「{name}」を作成し {count} 曲を追加しました（性能保護のため先頭 {limit} 曲）。' },
  'inboxPage.message.queueAdded': { zh: '已加入队列 {count} 首。', en: 'Added {count} tracks to the queue.', ja: 'キューに {count} 曲を追加しました。' },
  'inboxPage.message.queueAddedTruncated': { zh: '已加入队列 {count} 首，已按性能保护加入前 {limit} 首。', en: 'Added {count} tracks to the queue (performance limit: first {limit}).', ja: 'キューに {count} 曲を追加しました（性能保護のため先頭 {limit} 曲）。' },
  'inboxPage.source.label': { zh: '新歌收件箱', en: 'New track inbox', ja: '新曲受信箱' },
  'inboxPage.bulk.aria': { zh: '收件箱批量操作', en: 'Inbox bulk actions', ja: '受信箱の一括操作' },
  'inboxPage.bulk.selectPage': { zh: '选择本页', en: 'Select page', ja: 'このページを選択' },
  'inboxPage.bulk.deselectPage': { zh: '取消本页选择', en: 'Clear page selection', ja: 'このページの選択を解除' },
  'inboxPage.bulk.selectedCount': { zh: '已选 {count} 首', en: '{count} selected', ja: '{count} 曲を選択中' },
  'inboxPage.bulk.filterCount': { zh: '当前筛选 {count} 首', en: '{count} in current filter', ja: '現在の絞り込み {count} 曲' },
  'inboxPage.action.locateFile': { zh: '定位文件', en: 'Locate file', ja: 'ファイルを特定' },
  'inboxPage.action.markProcessed': { zh: '标记已处理', en: 'Mark processed', ja: '処理済みにする' },
  'inboxPage.action.ignore': { zh: '忽略问题', en: 'Ignore issues', ja: '問題を無視' },
  'inboxPage.action.setPending': { zh: '设为待处理', en: 'Set pending', ja: '未処理にする' },
  'inboxPage.action.locateTrack': { zh: '定位歌曲', en: 'Locate track', ja: '曲を特定' },
  'inboxPage.list.aria': { zh: '新歌列表', en: 'New tracks list', ja: '新曲リスト' },
  'inboxPage.albumWall.aria': { zh: '新增专辑墙', en: 'New albums wall', ja: '新しいアルバムウォール' },
  'inboxPage.albumWall.title': { zh: '新增专辑墙', en: 'New albums', ja: '新しいアルバム' },
  'inboxPage.albumWall.trackCount': { zh: '{count} 首 · {duration}', en: '{count} tracks · {duration}', ja: '{count} 曲 · {duration}' },
  'inboxPage.list.moreReasons': { zh: '还有 {count} 项', en: '{count} more', ja: 'ほか {count} 件' },
  'inboxPage.loadMore': { zh: '继续加载 {visible}/{total}', en: 'Load more {visible}/{total}', ja: '続きを読み込む {visible}/{total}' },
  'inboxPage.loadingShort': { zh: '正在读取...', en: 'Loading...', ja: '読み込み中...' },
  // Playlists page errors
  'playlists.error.streamingOnlyDownload': { zh: '只有网络歌单中的流媒体歌曲可以直接下载。', en: 'Only streaming tracks from online playlists can be downloaded directly.', ja: 'オンラインプレイリスト内のストリーム曲のみ直接ダウンロードできます。' },
  'playlists.error.spotifyNoDownload': { zh: 'Spotify 由官方播放器播放，下载功能不适用于 Spotify。', en: 'Spotify plays through the official player; downloads are not available.', ja: 'Spotify は公式プレイヤー経由で再生され、ダウンロードには対応していません。' },
  'playlists.error.providerNoDownload': { zh: '这个平台暂不支持从网络歌单直接下载。', en: 'This provider does not support direct downloads from online playlists yet.', ja: 'このプラットフォームはオンラインプレイリストからの直接ダウンロードに未対応です。' },
  'playlists.error.downloadService': { zh: '桌面下载服务不可用。', en: 'Desktop download service is unavailable.', ja: 'デスクトップのダウンロードサービスを利用できません。' },
  'playlists.error.streamingService': { zh: '桌面流媒体服务不可用，无法解析下载地址。', en: 'Desktop streaming service is unavailable; cannot resolve the download URL.', ja: 'デスクトップのストリームサービスを利用できないため、ダウンロード URL を解決できません。' },
  'playlists.error.playlistService': { zh: '桌面歌单服务不可用。', en: 'Desktop playlist service is unavailable.', ja: 'デスクトップのプレイリストサービスを利用できません。' },
};

function escapeTs(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function insert(file, locale) {
  let text = readFileSync(file, 'utf8');
  const missing = Object.entries(entries).filter(([k]) => !text.includes(`'${k}'`));
  if (!missing.length) {
    console.log(locale, 0);
    return 0;
  }
  const block = missing
    .map(([k, v]) => {
      const value = locale === 'en' ? v.en : locale === 'ja' ? v.ja : locale === 'tw' ? toTw(v.zh) : v.zh;
      return `  '${k}': '${escapeTs(value)}',`;
    })
    .join('\n');
  const idx = text.lastIndexOf('\n};');
  writeFileSync(file, `${text.slice(0, idx)}\n  // --- inbox/playlists batch ---\n${block}${text.slice(idx)}`, 'utf8');
  console.log(locale, missing.length);
  return missing.length;
}

for (const [f, loc] of [
  ['zhCN.ts', 'zh'],
  ['enUS.ts', 'en'],
  ['zhTW.ts', 'tw'],
  ['jaJP.ts', 'ja'],
]) {
  insert(join(localesDir, f), loc);
}

let localesTs = readFileSync(join(root, 'src/renderer/i18n/locales.ts'), 'utf8');
const toAdd = Object.keys(entries).filter((k) => !localesTs.includes(`'${k}'`));
if (toAdd.length) {
  // FlexibleSettingsTranslationKey includes historyPage/mediaLibrary etc but inbox is not flexible - need explicit keys
  // Check if inbox is flexible - from earlier: FlexibleSettings includes historyPage, mediaLibrary, likedPage, settings.about, settings.danger, settings.integrations, songs
  // inboxPage is NOT flexible - must be in TranslationKey union
  const union = toAdd.map((k) => `  | '${k}'`).join('\n');
  if (!localesTs.includes("| 'error.code.opraUnavailable';")) {
    throw new Error('insert point missing');
  }
  localesTs = localesTs.replace("| 'error.code.opraUnavailable';", `| 'error.code.opraUnavailable'\n${union};`);
  writeFileSync(join(root, 'src/renderer/i18n/locales.ts'), localesTs, 'utf8');
  console.log('TranslationKey +', toAdd.length);
}
