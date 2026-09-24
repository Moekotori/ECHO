/**
 * Batch 2: player bar, queue feedback/source, crash guard keys.
 * Adds to zhCN/enUS/zhTW/jaJP + TranslationKey union.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpenCC = require('opencc-js');
const toTw = OpenCC.Converter({ from: 'cn', to: 'twp' });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'src/renderer/i18n/locales');

/** @type {Record<string, { zh: string, en: string, ja: string }>} */
const entries = {
  // Player bar – download status
  'playerBar.download.status.queued': { zh: '排队中', en: 'Queued', ja: '待機中' },
  'playerBar.download.status.probing': { zh: '解析链接', en: 'Resolving link', ja: 'リンク解析中' },
  'playerBar.download.status.downloading': { zh: '下载中', en: 'Downloading', ja: 'ダウンロード中' },
  'playerBar.download.status.extracting_audio': { zh: '提取音频', en: 'Extracting audio', ja: '音声抽出中' },
  'playerBar.download.status.importing': { zh: '导入曲库', en: 'Importing', ja: 'ライブラリへ取り込み中' },
  'playerBar.download.status.binding_mv': { zh: '绑定 MV', en: 'Binding MV', ja: 'MV を関連付け中' },
  'playerBar.download.status.completed': { zh: '下载完成', en: 'Download complete', ja: 'ダウンロード完了' },
  'playerBar.download.status.failed': { zh: '下载失败', en: 'Download failed', ja: 'ダウンロード失敗' },
  'playerBar.download.status.cancelled': { zh: '已取消', en: 'Cancelled', ja: 'キャンセル済み' },
  'playerBar.download.currentStreaming': { zh: '当前流媒体', en: 'Current stream', ja: '現在のストリーム' },
  'playerBar.download.savedToFolder': { zh: '已保存到下载文件夹', en: 'Saved to the download folder', ja: 'ダウンロードフォルダーに保存しました' },
  'playerBar.download.retryLater': { zh: '请稍后重试', en: 'Please try again later', ja: '後でもう一度お試しください' },
  'playerBar.download.taskStopped': { zh: '任务已停止', en: 'Task stopped', ja: 'タスクを停止しました' },
  'playerBar.download.notice.completed': { zh: '下载完成：{title}', en: 'Download complete: {title}', ja: 'ダウンロード完了: {title}' },
  'playerBar.download.notice.failed': { zh: '下载失败：{title}', en: 'Download failed: {title}', ja: 'ダウンロード失敗: {title}' },
  'playerBar.download.notice.cancelled': { zh: '下载已取消：{title}', en: 'Download cancelled: {title}', ja: 'ダウンロードをキャンセルしました: {title}' },
  'playerBar.download.notice.progress': { zh: '正在下载：{title}', en: 'Downloading: {title}', ja: 'ダウンロード中: {title}' },
  'playerBar.download.notice.preparing': { zh: '准备下载：{title}', en: 'Preparing download: {title}', ja: 'ダウンロード準備中: {title}' },
  'playerBar.download.notice.resolving': { zh: '正在解析流媒体地址...', en: 'Resolving stream URL...', ja: 'ストリーム URL を解決しています...' },
  'playerBar.download.unsupportedPlatform': { zh: '当前平台不支持下载', en: 'Downloads are not supported for this platform', ja: 'このプラットフォームではダウンロードに対応していません' },
  'playerBar.download.spotifyDetail': { zh: 'Spotify 由官方播放器播放，不提供可下载音频 URL。', en: 'Spotify plays through the official player and does not provide a downloadable audio URL.', ja: 'Spotify は公式プレイヤー経由で再生され、ダウンロード可能な音声 URL を提供しません。' },
  'playerBar.download.mockDetail': { zh: 'Mock 流媒体用于开发预览，不写入下载任务。', en: 'Mock streaming is for development previews and does not create download jobs.', ja: 'Mock ストリームは開発プレビュー用で、ダウンロードタスクは作成しません。' },
  'playerBar.download.serviceUnavailable': { zh: '下载服务不可用', en: 'Download service unavailable', ja: 'ダウンロードサービスを利用できません' },
  'playerBar.download.serviceDetail': { zh: '请在 ECHO Next 桌面端中使用下载功能。', en: 'Use downloads in the ECHO Next desktop app.', ja: 'ECHO Next デスクトップアプリでダウンロード機能を使ってください。' },
  'playerBar.download.ariaProgress': { zh: '流媒体下载进度', en: 'Streaming download progress', ja: 'ストリームのダウンロード進捗' },
  'playerBar.download.ariaDownload': { zh: '下载当前流媒体', en: 'Download current stream', ja: '現在のストリームをダウンロード' },
  'playerBar.download.title.preparing': { zh: '正在准备或下载', en: 'Preparing or downloading', ja: '準備またはダウンロード中' },
  'playerBar.download.title.download': { zh: '下载当前流媒体', en: 'Download current stream', ja: '現在のストリームをダウンロード' },
  'playerBar.download.title.spotifyUnsupported': { zh: 'Spotify 不支持下载', en: 'Spotify downloads are not supported', ja: 'Spotify はダウンロード非対応' },
  'playerBar.download.title.sourceUnsupported': { zh: '当前流媒体源不支持下载', en: 'This streaming source does not support downloads', ja: 'このストリームソースはダウンロード非対応' },

  // Player bar – loading / export / chrome
  'playerBar.loading.streaming': { zh: '正在加载流媒体', en: 'Loading stream', ja: 'ストリームを読み込み中' },
  'playerBar.loading.remote': { zh: '正在加载网盘音频', en: 'Loading remote audio', ja: 'リモート音声を読み込み中' },
  'playerBar.loading.preparing': { zh: '正在准备音频', en: 'Preparing audio', ja: '音声を準備中' },
  'playerBar.loading.short': { zh: '加载中', en: 'Loading', ja: '読み込み中' },
  'playerBar.export.noLocalFile': { zh: '没有可导出的本地文件', en: 'No local file to export', ja: 'エクスポートできるローカルファイルがありません' },
  'playerBar.export.sourceUnsupported': { zh: '当前来源不支持文件导出', en: 'Current source does not support file export', ja: '現在のソースはファイル書き出しに対応していません' },
  'playerBar.export.exporting': { zh: '正在导出当前文件', en: 'Exporting current file', ja: '現在のファイルを書き出し中' },
  'playerBar.export.exportAs': { zh: '导出当前文件为 {format}（{rate}）', en: 'Export current file as {format} ({rate})', ja: '現在のファイルを {format}（{rate}）で書き出し' },
  'playerBar.export.cannotExport': { zh: '无法导出当前文件', en: 'Cannot export the current file', ja: '現在のファイルを書き出せません' },
  'playerBar.export.notLocal': { zh: '当前来源不是本地音频文件。', en: 'The current source is not a local audio file.', ja: '現在のソースはローカル音声ファイルではありません。' },
  'playerBar.export.noPlayingLocal': { zh: '还没有正在播放的本地音频文件。', en: 'No local audio file is currently playing.', ja: '再生中のローカル音声ファイルがありません。' },
  'playerBar.export.serviceUnavailable': { zh: '导出服务不可用', en: 'Export service unavailable', ja: '書き出しサービスを利用できません' },
  'playerBar.export.serviceDetail': { zh: '请在 ECHO Next 桌面端中导出音频文件。', en: 'Export audio files in the ECHO Next desktop app.', ja: 'ECHO Next デスクトップアプリで音声ファイルを書き出してください。' },
  'playerBar.export.preparing': { zh: '准备导出：{title}', en: 'Preparing export: {title}', ja: '書き出し準備中: {title}' },
  'playerBar.aria.playbackControls': { zh: '播放控制', en: 'Playback controls', ja: '再生コントロール' },
  'playerBar.aria.openLyrics': { zh: '打开歌词', en: 'Open lyrics', ja: '歌詞を開く' },
  'playerBar.aria.hideDesktopLyrics': { zh: '隐藏桌面歌词', en: 'Hide desktop lyrics', ja: 'デスクトップ歌詞を隠す' },
  'playerBar.aria.showDesktopLyrics': { zh: '显示桌面歌词', en: 'Show desktop lyrics', ja: 'デスクトップ歌詞を表示' },
  'playerBar.title.hideDesktopLyrics': { zh: '隐藏桌面歌词，右键自动解锁并常驻或隐藏设置栏', en: 'Hide desktop lyrics. Right-click to unlock and pin or hide the settings bar.', ja: 'デスクトップ歌詞を隠します。右クリックで設定バーのロック解除と常駐/非表示を切り替えます。' },
  'playerBar.title.showDesktopLyrics': { zh: '显示桌面歌词，右键自动解锁并常驻或隐藏设置栏', en: 'Show desktop lyrics. Right-click to unlock and pin or hide the settings bar.', ja: 'デスクトップ歌詞を表示します。右クリックで設定バーのロック解除と常駐/非表示を切り替えます。' },
  'playerBar.aria.hideMiniPlayer': { zh: '隐藏迷你播放器', en: 'Hide mini player', ja: 'ミニプレーヤーを隠す' },
  'playerBar.aria.showMiniPlayer': { zh: '显示迷你播放器', en: 'Show mini player', ja: 'ミニプレーヤーを表示' },
  'playerBar.openArtistDetail': { zh: '打开艺人详情：{name}', en: 'Open artist details: {name}', ja: 'アーティスト詳細を開く: {name}' },

  // Queue source labels
  'queue.source.playlist.current': { zh: '当前播放列表：{label}', en: 'Current playlist: {label}', ja: '現在のプレイリスト: {label}' },
  'queue.source.playlist.default': { zh: '播放列表', en: 'Playlist', ja: 'プレイリスト' },
  'queue.source.manual': { zh: '手动队列', en: 'Manual queue', ja: '手動キュー' },
  'queue.source.songs.random': { zh: '全曲库随机', en: 'Library shuffle', ja: 'ライブラリ全体シャッフル' },
  'queue.source.songs.list': { zh: '歌曲列表：{label}', en: 'Song list: {label}', ja: '曲リスト: {label}' },
  'queue.source.folder.random': { zh: '当前文件夹随机：{label}', en: 'Folder shuffle: {label}', ja: 'フォルダーシャッフル: {label}' },
  'queue.source.folder.list': { zh: '文件夹：{label}', en: 'Folder: {label}', ja: 'フォルダー: {label}' },
  'queue.source.liked': { zh: '我喜欢：{label}', en: 'Liked: {label}', ja: 'お気に入り: {label}' },
  'queue.source.album': { zh: '专辑：{label}', en: 'Album: {label}', ja: 'アルバム: {label}' },
  'queue.source.artist': { zh: '艺术家：{label}', en: 'Artist: {label}', ja: 'アーティスト: {label}' },
  'queue.source.streaming': { zh: '在线来源：{label}', en: 'Online source: {label}', ja: 'オンラインソース: {label}' },
  'queue.source.localFile': { zh: '本地文件：{label}', en: 'Local file: {label}', ja: 'ローカルファイル: {label}' },

  // Queue feedback
  'queue.feedback.addedToTail': { zh: '已加入队尾', en: 'Added to end of queue', ja: 'キューの末尾に追加しました' },
  'queue.feedback.addedCount': { zh: '已加入 {count} 首', en: 'Added {count} tracks', ja: '{count} 曲を追加しました' },
  'queue.feedback.addedNext': { zh: '已加入下一首', en: 'Queued next', ja: '次に再生する曲に追加しました' },
  'queue.feedback.addedNextCount': { zh: '已加入下一首播放：{count} 首', en: 'Queued next: {count} tracks', ja: '次に再生: {count} 曲' },
  'queue.feedback.trackDetail': { zh: '{title} · {source}', en: '{title} · {source}', ja: '{title} · {source}' },
  'queue.feedback.sourceTail': { zh: '{source} · 队尾', en: '{source} · end of queue', ja: '{source} · 末尾' },
  'queue.feedback.shuffleOn': { zh: '随机播放已开启：{scope}', en: 'Shuffle on: {scope}', ja: 'シャッフルオン: {scope}' },
  'queue.feedback.avoidRecent': { zh: '避开最近 {count} 首', en: 'Avoid last {count} tracks', ja: '直近 {count} 曲を避ける' },
  'queue.feedback.fillEnough': { zh: '队列已足够', en: 'Queue is full enough', ja: 'キューは十分です' },
  'queue.feedback.fillEnoughDetail': { zh: '当前已有 {count} 首', en: 'Already has {count} tracks', ja: 'すでに {count} 曲あります' },
  'queue.feedback.fillEmpty': { zh: '没有可补全的歌曲', en: 'No tracks available to fill', ja: '補完できる曲がありません' },
  'queue.feedback.fillEmptyDetail': { zh: '已避开最近 {count} 首和当前队列', en: 'Avoided last {count} tracks and the current queue', ja: '直近 {count} 曲と現在のキューを避けました' },
  'queue.feedback.filledCount': { zh: '已补全 {count} 首', en: 'Filled {count} tracks', ja: '{count} 曲を補完しました' },
  'queue.feedback.noHqPlayerTrack': { zh: '没有可交给 HQPlayer 的当前歌曲。', en: 'No current track available for HQPlayer.', ja: 'HQPlayer に渡せる現在の曲がありません。' },

  // Queue page – high-traffic action notices
  'queue.page.notice.removedPlayed': { zh: '已移除播放完成的队列项', en: 'Removed finished queue items', ja: '再生済みのキュー項目を削除しました' },
  'queue.page.error.emptySave': { zh: '当前队列为空，暂时没有可保存的内容。', en: 'The queue is empty; nothing to save right now.', ja: 'キューが空のため、保存できる内容がありません。' },
  'queue.page.notice.savedQueue': { zh: '已保存队列', en: 'Queue saved', ja: 'キューを保存しました' },
  'queue.page.error.emptySnapshot': { zh: '这个队列快照没有可恢复的歌曲。', en: 'This queue snapshot has no tracks to restore.', ja: 'このキューのスナップショットには復元できる曲がありません。' },
  'queue.page.notice.restoredQueue': { zh: '已恢复队列', en: 'Queue restored', ja: 'キューを復元しました' },
  'queue.page.notice.deletedSnapshot': { zh: '已删除队列快照', en: 'Queue snapshot deleted', ja: 'キューのスナップショットを削除しました' },
  'queue.page.notice.undone': { zh: '已撤销', en: 'Undone', ja: '元に戻しました' },
  'queue.page.notice.canUndo': { zh: '可撤销', en: 'Can undo', ja: '元に戻せます' },
  'queue.page.notice.removedFromQueue': { zh: '已从队列移除', en: 'Removed from queue', ja: 'キューから削除しました' },
  'queue.page.notice.movedAfterCurrent': { zh: '已经排到当前播放后面', en: 'Moved after the current track', ja: '現在の再生の直後に移動しました' },
  'queue.page.notice.unmarkedAfterPlay': { zh: '已取消播放后移除', en: 'Cleared remove-after-play', ja: '再生後削除を解除しました' },
  'queue.page.notice.markedAfterPlay': { zh: '已标记 {count} 首播放后移除', en: 'Marked {count} tracks to remove after play', ja: '{count} 曲を再生後削除に設定しました' },
  'queue.page.error.bridgePlaylist': { zh: '桌面桥接不可用，暂时不能保存为歌单。', en: 'Desktop bridge unavailable; cannot save as a playlist right now.', ja: 'デスクトップブリッジを利用できないため、プレイリストとして保存できません。' },
  'queue.page.error.noLibraryTracks': { zh: '当前队列没有可保存到本地歌单的已入库歌曲。', en: 'No library tracks in the queue can be saved to a local playlist.', ja: 'キューにローカルプレイリストへ保存できるライブラリ曲がありません。' },
  'queue.page.playlist.description': { zh: '从播放队列保存。', en: 'Saved from the playback queue.', ja: '再生キューから保存。' },
  'queue.page.error.noneWritten': { zh: '没有歌曲被写入歌单。', en: 'No tracks were written to the playlist.', ja: 'プレイリストに書き込まれた曲がありません。' },
  'queue.page.notice.savedPlaylist': { zh: '已保存为歌单', en: 'Saved as playlist', ja: 'プレイリストとして保存しました' },
  'queue.page.notice.savedPlaylistDetail': { zh: '{name}（{count} 首）', en: '{name} ({count} tracks)', ja: '{name}（{count} 曲）' },
  'queue.page.error.streamingPlaylist': { zh: '流媒体歌曲不能加入本地歌单，请在流媒体歌单中单独管理。', en: 'Streaming tracks cannot be added to local playlists; manage them in streaming playlists.', ja: 'ストリーム曲はローカルプレイリストに追加できません。ストリーム側のプレイリストで管理してください。' },
  'queue.page.notice.playNext': { zh: '已插到下一首', en: 'Inserted as next', ja: '次の曲として挿入しました' },
  'queue.page.selection.aria': { zh: '队列批量操作', en: 'Queue bulk actions', ja: 'キュー一括操作' },
  'queue.page.selection.selectList': { zh: '选择列表', en: 'Select list', ja: 'リストを選択' },
  'queue.page.selection.deselectList': { zh: '取消选择列表', en: 'Clear list selection', ja: 'リスト選択を解除' },
  'queue.page.selection.selectAll': { zh: '全选列表', en: 'Select all', ja: 'すべて選択' },
  'queue.page.selection.selectedCount': { zh: '已选择 {count} 首', en: '{count} selected', ja: '{count} 曲を選択中' },
  'queue.page.selection.noneSelected': { zh: '未选择歌曲', en: 'No tracks selected', ja: '曲が選択されていません' },
  'queue.page.selection.clearAfterPlay': { zh: '取消播完移除', en: 'Clear remove-after-play', ja: '再生後削除を解除' },
  'queue.page.selection.markAfterPlay': { zh: '播放后移除', en: 'Remove after play', ja: '再生後に削除' },
  'queue.page.selection.done': { zh: '完成', en: 'Done', ja: '完了' },
  'queue.page.selection.select': { zh: '选择', en: 'Select', ja: '選択' },
  'queue.page.receipt.affectedTracks': { zh: '受影响歌曲', en: 'Affected tracks', ja: '影響を受けた曲' },
  'queue.page.receipt.closeAria': { zh: '关闭队列操作回执', en: 'Close queue action receipt', ja: 'キュー操作の回執を閉じる' },
  'queue.page.receipt.close': { zh: '关闭', en: 'Close', ja: '閉じる' },
  'queue.page.saved.aria': { zh: '已保存队列', en: 'Saved queues', ja: '保存済みキュー' },
  'queue.page.saved.deleteAria': { zh: '删除队列快照 {name}', en: 'Delete queue snapshot {name}', ja: 'キューのスナップショット {name} を削除' },
  'queue.page.saved.deleteTitle': { zh: '删除队列快照', en: 'Delete queue snapshot', ja: 'キューのスナップショットを削除' },
  'queue.page.unit.tracks': { zh: '首', en: 'tracks', ja: '曲' },

  // Crash guard
  'crashGuard.step.export.title': { zh: '先导出诊断包', en: 'Export a diagnostics pack first', ja: 'まず診断パッケージを書き出す' },
  'crashGuard.step.export.description': { zh: '保留日志、窗口状态和错误栈，后续排查最有用。', en: 'Keep logs, window state, and the error stack for later debugging.', ja: 'ログ、ウィンドウ状態、エラースタックを残すと、あとからの調査に最も役立ちます。' },
  'crashGuard.step.report.title': { zh: '再打开崩溃报告', en: 'Then open the crash report', ja: '次にクラッシュレポートを開く' },
  'crashGuard.step.report.description': { zh: '把报告给开发者或 AI 看，通常比反复重启更快定位。', en: 'Share the report with a developer or AI; that is usually faster than restarting over and over.', ja: 'レポートを開発者や AI に見せると、何度も再起動するより早く原因を特定できることが多いです。' },
  'crashGuard.step.reload.title': { zh: '最后再重载或重启', en: 'Reload or restart last', ja: '最後に再読み込みまたは再起動' },
  'crashGuard.step.reload.description': { zh: '如果只是一次临时状态抖动，重载界面可能就能恢复。', en: 'If this was only a temporary UI glitch, reloading the interface may restore it.', ja: '一時的な状態のゆらぎなら、画面の再読み込みだけで復旧することがあります。' },
  'crashGuard.action.exporting': { zh: '正在准备诊断包...', en: 'Preparing diagnostics pack...', ja: '診断パッケージを準備しています...' },
  'crashGuard.action.exported': { zh: '诊断包已导出: {path}', en: 'Diagnostics pack exported: {path}', ja: '診断パッケージを書き出しました: {path}' },
  'crashGuard.action.exportCancelled': { zh: '已取消导出。', en: 'Export cancelled.', ja: '書き出しをキャンセルしました。' },
  'crashGuard.action.openingReport': { zh: '正在打开崩溃报告...', en: 'Opening crash report...', ja: 'クラッシュレポートを開いています...' },
  'crashGuard.action.openedReport': { zh: '已打开崩溃报告: {path}', en: 'Opened crash report: {path}', ja: 'クラッシュレポートを開きました: {path}' },
  'crashGuard.action.reportMissing': { zh: '未找到崩溃报告。', en: 'No crash report found.', ja: 'クラッシュレポートが見つかりません。' },
  'crashGuard.action.restartRequested': { zh: '已请求重启 ECHO。若再次回到这里，请优先导出诊断包。', en: 'ECHO restart requested. If you land here again, export a diagnostics pack first.', ja: 'ECHO の再起動を要求しました。再びここに来た場合は、まず診断パッケージを書き出してください。' },
  'crashGuard.action.quitting': { zh: '正在关闭 ECHO...', en: 'Closing ECHO...', ja: 'ECHO を終了しています...' },
  'crashGuard.bridge.online': { zh: '诊断桥在线', en: 'Diagnostics bridge online', ja: '診断ブリッジはオンライン' },
  'crashGuard.bridge.offline': { zh: '诊断桥不可用', en: 'Diagnostics bridge unavailable', ja: '診断ブリッジを利用できません' },
  'crashGuard.bridge.hintOnline': { zh: '可以导出诊断包', en: 'Diagnostics pack can be exported', ja: '診断パッケージを書き出せます' },
  'crashGuard.bridge.hintOffline': { zh: '请先截图或手动重启', en: 'Take a screenshot or restart manually', ja: 'まずスクリーンショットを撮るか、手動で再起動してください' },
  'crashGuard.status.defaultOnline': { zh: '建议先导出诊断包，再打开报告；这些信息不会自动上传。', en: 'Export a diagnostics pack first, then open the report. Nothing is uploaded automatically.', ja: 'まず診断パッケージを書き出し、その後レポートを開いてください。これらは自動ではアップロードされません。' },
  'crashGuard.status.defaultOffline': { zh: '诊断桥不可用，请先截图保留这一页，再手动重启 ECHO。', en: 'Diagnostics bridge unavailable. Screenshot this page, then restart ECHO manually.', ja: '診断ブリッジを利用できません。このページのスクリーンショットを残してから、ECHO を手動で再起動してください。' },
  'crashGuard.window.main': { zh: '主窗口', en: 'Main window', ja: 'メインウィンドウ' },
  'crashGuard.window.miniPlayer': { zh: '迷你播放器', en: 'Mini player', ja: 'ミニプレーヤー' },
  'crashGuard.window.desktopLyrics': { zh: '桌面歌词', en: 'Desktop lyrics', ja: 'デスクトップ歌詞' },
  'crashGuard.brandTitle': { zh: '界面保护模式', en: 'UI protection mode', ja: 'UI 保護モード' },
  'crashGuard.rail.kicker': { zh: '已拦截一次界面错误', en: 'A UI error was intercepted', ja: 'UI エラーを 1 件捕捉しました' },
  'crashGuard.rail.title': { zh: 'ECHO 还在，先把现场留下来。', en: 'ECHO is still here. Preserve the scene first.', ja: 'ECHO はまだ動いています。まず現場を残しましょう。' },
  'crashGuard.meta.window': { zh: '窗口', en: 'Window', ja: 'ウィンドウ' },
  'crashGuard.meta.diagnostics': { zh: '诊断', en: 'Diagnostics', ja: '診断' },
  'crashGuard.meta.type': { zh: '类型', en: 'Type', ja: '種類' },
  'crashGuard.meta.renderError': { zh: 'React 渲染错误', en: 'React render error', ja: 'React レンダーエラー' },
  'crashGuard.sectionLabel': { zh: '界面保护已启动', en: 'UI protection is active', ja: 'UI 保護が有効です' },
  'crashGuard.title': { zh: 'ECHO 的界面刚刚出错了。', en: 'ECHO’s interface just failed.', ja: 'ECHO の画面でエラーが発生しました。' },
  'crashGuard.lead': { zh: '这通常是当前窗口的界面渲染失败，不一定代表播放核心或音乐文件损坏。请先按下面顺序保留信息，再决定重载或重启。', en: 'This is usually a render failure in the current window, not necessarily a broken playback core or music files. Preserve information in the order below, then reload or restart.', ja: 'これは多くの場合、現在のウィンドウの描画失敗であり、再生コアや音楽ファイルの破損を意味するとは限りません。下の順で情報を残してから、再読み込みまたは再起動を決めてください。' },
  'crashGuard.action.export': { zh: '导出诊断包', en: 'Export diagnostics', ja: '診断を書き出す' },
  'crashGuard.action.exportTitle': { zh: '导出当前诊断信息和崩溃线索', en: 'Export current diagnostics and crash clues', ja: '現在の診断情報とクラッシュの手がかりを書き出す' },
  'crashGuard.action.openReport': { zh: '打开报告', en: 'Open report', ja: 'レポートを開く' },
  'crashGuard.action.openReportTitle': { zh: '打开最近一次崩溃报告', en: 'Open the latest crash report', ja: '最新のクラッシュレポートを開く' },
  'crashGuard.action.reload': { zh: '重载界面', en: 'Reload UI', ja: 'UI を再読み込み' },
  'crashGuard.action.reloadTitle': { zh: '只刷新当前渲染窗口', en: 'Refresh only the current render window', ja: '現在のレンダーウィンドウだけを更新' },
  'crashGuard.action.restart': { zh: '重启 ECHO', en: 'Restart ECHO', ja: 'ECHO を再起動' },
  'crashGuard.action.restartTitle': { zh: '重新启动 ECHO Next', en: 'Relaunch ECHO Next', ja: 'ECHO Next を再起動' },
  'crashGuard.action.quit': { zh: '关闭 ECHO', en: 'Quit ECHO', ja: 'ECHO を終了' },
  'crashGuard.action.quitTitle': { zh: '退出 ECHO Next', en: 'Exit ECHO Next', ja: 'ECHO Next を終了' },
  'crashGuard.summary': { zh: '开发者错误摘要', en: 'Developer error summary', ja: '開発者向けエラー要約' },
};

function escapeTs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function insertKeys(filePath, locale) {
  let text = readFileSync(filePath, 'utf8');
  const existing = new Set();
  for (const key of Object.keys(entries)) {
    if (text.includes(`'${key}'`)) existing.add(key);
  }
  const missing = Object.entries(entries).filter(([k]) => !existing.has(k));
  if (missing.length === 0) {
    console.log(locale, 'already complete');
    return 0;
  }
  const block = missing
    .map(([key, val]) => {
      let value = val.zh;
      if (locale === 'en') value = val.en;
      else if (locale === 'ja') value = val.ja;
      else if (locale === 'tw') value = toTw(val.zh);
      return `  '${key}': '${escapeTs(value)}',`;
    })
    .join('\n');
  const idx = text.lastIndexOf('\n};');
  if (idx < 0) throw new Error(`no closing in ${filePath}`);
  text = `${text.slice(0, idx)}\n  // --- i18n batch2 player/queue/crash ---\n${block}${text.slice(idx)}`;
  writeFileSync(filePath, text, 'utf8');
  console.log(locale, '+', missing.length);
  return missing.length;
}

insertKeys(join(localesDir, 'zhCN.ts'), 'zh');
insertKeys(join(localesDir, 'enUS.ts'), 'en');
insertKeys(join(localesDir, 'zhTW.ts'), 'tw');
insertKeys(join(localesDir, 'jaJP.ts'), 'ja');

// Update TranslationKey union
const localesTsPath = join(root, 'src/renderer/i18n/locales.ts');
let localesTs = readFileSync(localesTsPath, 'utf8');
const keys = Object.keys(entries);
const already = keys.filter((k) => localesTs.includes(`'${k}'`));
const toAdd = keys.filter((k) => !localesTs.includes(`'${k}'`));
if (toAdd.length) {
  if (!localesTs.includes("| 'userFacingError.auth';")) {
    throw new Error('insert point missing');
  }
  const union = toAdd.map((k) => `  | '${k}'`).join('\n');
  localesTs = localesTs.replace("| 'userFacingError.auth';", `| 'userFacingError.auth'\n${union};`);
  // fix double semicolon risk
  localesTs = localesTs.replace("| 'userFacingError.auth'\n", "| 'userFacingError.auth'\n");
  // The replace might leave `';` then new keys ending with `;` - check last key
  writeFileSync(localesTsPath, localesTs, 'utf8');
  console.log('TranslationKey +', toAdd.length, 'already', already.length);
} else {
  console.log('TranslationKey already has all keys');
}
