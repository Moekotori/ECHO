/**
 * Inject audio/error translation keys into all locales + TranslationKey union.
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
  // Audio host errors
  'audioError.generic': {
    zh: '播放没有成功。ECHO 已保留详细诊断；你可以先重试播放，或在“设置 > 播放”里临时切换到兼容输出。',
    en: 'Playback did not succeed. ECHO kept detailed diagnostics; retry playback, or temporarily switch to compatible output in Settings > Playback.',
    ja: '再生に失敗しました。ECHO は詳細な診断を保持しています。再生を再試行するか、「設定 > 再生」で一時的に互換出力へ切り替えてください。',
  },
  'audioError.corruptFile': {
    zh: '这首音频文件可能已经损坏或不完整，ECHO 已停止播放它。建议重新获取这份文件后再导入。',
    en: 'This audio file may be damaged or incomplete. ECHO stopped playing it. Re-acquire the file and import it again.',
    ja: 'この音声ファイルは破損または不完全の可能性があります。ECHO は再生を停止しました。ファイルを再取得してからインポートしてください。',
  },
  'audioError.decodeFailed': {
    zh: '这首歌暂时解码失败。可以先重试播放；如果只在这首歌上稳定复现，再检查文件完整性或重新导入。',
    en: 'This track failed to decode for now. Retry playback; if it only fails on this track, check file integrity or re-import.',
    ja: 'この曲のデコードに一時的に失敗しました。再生を再試行し、この曲だけで再現する場合はファイルの完全性を確認するか再インポートしてください。',
  },
  'audioError.seekUnsupported': {
    zh: '当前位置暂时跳不过去，可能是文件或网络来源不支持拖动。',
    en: 'Seeking to this position failed for now. The file or network source may not support scrubbing.',
    ja: 'この位置へのシークは一時的にできません。ファイルまたはネットワークソースがドラッグ操作に対応していない可能性があります。',
  },
  'audioError.systemPlaybackFailed': {
    zh: '系统播放器没有成功播放这首歌。可以重试一次，或切换到兼容输出后再播放。',
    en: 'The system player could not play this track. Retry once, or switch to compatible output and try again.',
    ja: 'システムプレイヤーはこの曲を再生できませんでした。再試行するか、互換出力に切り替えてから再生してください。',
  },
  'audioError.exclusiveFailed': {
    zh: 'WASAPI 独占输出没有成功。可能是设备不支持当前格式，或正被其他应用占用；可以先切回 WASAPI Shared 再播放。',
    en: 'WASAPI exclusive output failed. The device may not support the current format, or another app is using it. Switch back to WASAPI Shared and try again.',
    ja: 'WASAPI 排他出力に失敗しました。デバイスが現在の形式に非対応か、他アプリが使用中の可能性があります。WASAPI Shared に戻してから再生してください。',
  },
  'audioError.deviceInitFailed': {
    zh: '音频设备初始化失败。请确认输出设备仍在线；如果刚插拔过 DAC，可以先重启音频引擎或降低采样率/缓冲设置。',
    en: 'Audio device initialization failed. Confirm the output device is still online; after plugging a DAC, restart the audio engine or lower sample-rate/buffer settings.',
    ja: 'オーディオデバイスの初期化に失敗しました。出力デバイスがオンラインか確認し、DAC を挿抜した直後ならオーディオエンジンを再起動するか、サンプルレート/バッファを下げてください。',
  },
  'audioError.deviceTimeout': {
    zh: '音频设备响应太慢，可能是 USB DAC 或驱动暂时卡住。建议重新插拔 USB，或在设置里重启音频引擎。',
    en: 'The audio device responded too slowly. A USB DAC or driver may be stuck. Replug USB, or restart the audio engine in Settings.',
    ja: 'オーディオデバイスの応答が遅すぎます。USB DAC またはドライバが一時的に固まっている可能性があります。USB を挿し直すか、設定でオーディオエンジンを再起動してください。',
  },
  'audioError.hostReadyTimeout': {
    zh: '音频输出启动超时。通常是驱动初始化太慢、设备被占用，或当前采样率/缓冲设置被设备拒绝。',
    en: 'Audio output startup timed out. Drivers may be slow, the device busy, or the sample-rate/buffer settings were rejected.',
    ja: 'オーディオ出力の起動がタイムアウトしました。ドライバ初期化が遅い、デバイス使用中、または現在のサンプルレート/バッファが拒否された可能性があります。',
  },
  'audioError.hostSpawnFailed': {
    zh: '音频引擎无法启动。请检查 native host 是否存在，或是否被安全软件拦截。',
    en: 'The audio engine could not start. Check that the native host exists and is not blocked by security software.',
    ja: 'オーディオエンジンを起動できません。native host が存在するか、セキュリティソフトに遮断されていないか確認してください。',
  },
  'audioError.hostInvalidExe': {
    zh: '音频引擎无法启动：程序文件不是有效的 Windows 可执行文件。建议重新安装或重新打包，避免 echo-audio-host.exe / ffmpeg.exe 被损坏或替换。',
    en: 'The audio engine could not start: the program file is not a valid Windows executable. Reinstall or rebuild, and make sure echo-audio-host.exe / ffmpeg.exe were not damaged or replaced.',
    ja: 'オーディオエンジンを起動できません。プログラムが有効な Windows 実行ファイルではありません。再インストールまたは再パッケージし、echo-audio-host.exe / ffmpeg.exe が破損・置換されていないか確認してください。',
  },
  'audioError.hostAccessViolation': {
    zh: '音频引擎在启动 Windows 输出时崩溃。可以先重启音频引擎或 Windows 音频服务；仍复现时，临时切到 DirectSound 兼容输出。',
    en: 'The audio engine crashed while starting Windows output. Restart the audio engine or Windows Audio service; if it keeps happening, temporarily switch to DirectSound compatible output.',
    ja: 'Windows 出力の起動中にオーディオエンジンがクラッシュしました。オーディオエンジンまたは Windows オーディオサービスを再起動し、再発する場合は一時的に DirectSound 互換出力へ切り替えてください。',
  },
  'audioError.hostExitFailed': {
    zh: '音频输出设备启动失败，可能是设备拒绝了当前输出模式、采样率或缓冲设置。',
    en: 'The audio output device failed to start. It may have rejected the current output mode, sample rate, or buffer settings.',
    ja: 'オーディオ出力デバイスの起動に失敗しました。現在の出力モード、サンプルレート、またはバッファ設定を拒否した可能性があります。',
  },

  // Bridge / environment
  'error.bridge.desktop': {
    zh: '桌面桥接不可用。请在 ECHO Next 桌面端重试，或重启应用后再试。',
    en: 'Desktop bridge is unavailable. Retry in the ECHO Next desktop app, or restart the app.',
    ja: 'デスクトップブリッジを利用できません。ECHO Next デスクトップで再試行するか、アプリを再起動してください。',
  },
  'error.bridge.desktopShort': {
    zh: '桌面桥接不可用',
    en: 'Desktop bridge unavailable',
    ja: 'デスクトップブリッジを利用できません',
  },
  'error.bridge.streamingSearch': {
    zh: '桌面桥接不可用，请在 ECHO Next 客户端窗口中搜索流媒体。',
    en: 'Desktop bridge unavailable. Search streaming sources in the ECHO Next desktop window.',
    ja: 'デスクトップブリッジを利用できません。ECHO Next クライアントでストリームを検索してください。',
  },
  'error.bridge.streamingTrack': {
    zh: '桌面桥接不可用，请在 ECHO Next 客户端窗口中读取流媒体歌曲。',
    en: 'Desktop bridge unavailable. Open streaming tracks in the ECHO Next desktop window.',
    ja: 'デスクトップブリッジを利用できません。ECHO Next クライアントでストリーム曲を読み取ってください。',
  },
  'error.bridge.streamingAlbum': {
    zh: '桌面桥接不可用，请在 ECHO Next 客户端窗口中读取流媒体专辑。',
    en: 'Desktop bridge unavailable. Open streaming albums in the ECHO Next desktop window.',
    ja: 'デスクトップブリッジを利用できません。ECHO Next クライアントでストリームアルバムを読み取ってください。',
  },
  'error.bridge.streamingArtist': {
    zh: '桌面桥接不可用，请在 ECHO Next 客户端窗口中读取流媒体艺人。',
    en: 'Desktop bridge unavailable. Open streaming artists in the ECHO Next desktop window.',
    ja: 'デスクトップブリッジを利用できません。ECHO Next クライアントでストリームアーティストを読み取ってください。',
  },
  'error.bridge.streamingPlayback': {
    zh: '桌面桥接不可用，请在 ECHO Next 客户端窗口中播放流媒体。',
    en: 'Desktop bridge unavailable. Play streaming audio in the ECHO Next desktop window.',
    ja: 'デスクトップブリッジを利用できません。ECHO Next クライアントでストリームを再生してください。',
  },
  'error.bridge.streamingBpm': {
    zh: '桌面桥接不可用，请在 ECHO Next 客户端窗口中分析流媒体 BPM。',
    en: 'Desktop bridge unavailable. Analyze streaming BPM in the ECHO Next desktop window.',
    ja: 'デスクトップブリッジを利用できません。ECHO Next クライアントでストリーム BPM を解析してください。',
  },
  'error.bridge.streamingLyrics': {
    zh: '桌面桥接不可用，请在 ECHO Next 客户端窗口中读取歌词。',
    en: 'Desktop bridge unavailable. Load lyrics in the ECHO Next desktop window.',
    ja: 'デスクトップブリッジを利用できません。ECHO Next クライアントで歌詞を読み取ってください。',
  },
  'error.bridge.streamingMv': {
    zh: '桌面桥接不可用，请在 ECHO Next 客户端窗口中读取 MV。',
    en: 'Desktop bridge unavailable. Load MVs in the ECHO Next desktop window.',
    ja: 'デスクトップブリッジを利用できません。ECHO Next クライアントで MV を読み取ってください。',
  },
  'error.bridge.streamingFavorites': {
    zh: '桌面桥接不可用，请在 ECHO Next 客户端窗口中导入流媒体收藏。',
    en: 'Desktop bridge unavailable. Import streaming favorites in the ECHO Next desktop window.',
    ja: 'デスクトップブリッジを利用できません。ECHO Next クライアントでストリームのお気に入りをインポートしてください。',
  },
  'error.bridge.streamingDownloadResolve': {
    zh: '桌面桥接不可用，无法解析流媒体下载地址。',
    en: 'Desktop bridge unavailable; cannot resolve the streaming download URL.',
    ja: 'デスクトップブリッジを利用できないため、ストリームのダウンロード URL を解決できません。',
  },
  'error.bridge.locateAlbum': {
    zh: '桌面桥接不可用，请在 ECHO Next 桌面端定位这张专辑。',
    en: 'Desktop bridge unavailable. Open ECHO Next in Electron to locate this album.',
    ja: 'デスクトップブリッジを利用できません。このアルバムを探すには ECHO Next デスクトップを開いてください。',
  },
  'error.bridge.locateArtist': {
    zh: '桌面桥接不可用，请在 ECHO Next 桌面端定位这位艺人。',
    en: 'Desktop bridge unavailable. Open ECHO Next in Electron to locate this artist.',
    ja: 'デスクトップブリッジを利用できません。このアーティストを探すには ECHO Next デスクトップを開いてください。',
  },
  'error.bridge.likeTracks': {
    zh: '桌面桥接不可用，请在 ECHO Next 桌面端收藏歌曲。',
    en: 'Desktop bridge unavailable. Open ECHO Next in Electron to like tracks.',
    ja: 'デスクトップブリッジを利用できません。曲をお気に入りにするには ECHO Next デスクトップを開いてください。',
  },
  'error.bridge.likeAlbums': {
    zh: '桌面桥接不可用，请在 ECHO Next 桌面端收藏专辑。',
    en: 'Desktop bridge unavailable. Open ECHO Next in Electron to like albums.',
    ja: 'デスクトップブリッジを利用できません。アルバムをお気に入りにするには ECHO Next デスクトップを開いてください。',
  },
  'error.bridge.exportMarkdown': {
    zh: '桌面桥接不可用，无法导出 Markdown。',
    en: 'Desktop bridge unavailable; cannot export Markdown.',
    ja: 'デスクトップブリッジを利用できないため、Markdown を書き出せません。',
  },
  'error.bridge.diagnosticsZipUnsupported': {
    zh: '当前桌面桥接不支持安全诊断包导出，请重启 ECHO Next 后再试。',
    en: 'This desktop bridge does not support safe diagnostics zip export. Restart ECHO Next and try again.',
    ja: '現在のデスクトップブリッジは安全な診断パッケージ書き出しに対応していません。ECHO Next を再起動してから再試行してください。',
  },
  'error.bridge.openAudioReport': {
    zh: '桌面桥接不可用，无法打开音频报告。',
    en: 'Desktop bridge unavailable; cannot open the audio report.',
    ja: 'デスクトップブリッジを利用できないため、オーディオレポートを開けません。',
  },
  'error.bridge.openLogDir': {
    zh: '桌面桥接不可用，无法打开日志目录。',
    en: 'Desktop bridge unavailable; cannot open the log directory.',
    ja: 'デスクトップブリッジを利用できないため、ログディレクトリを開けません。',
  },
  'error.bridge.downloadService': {
    zh: '桌面下载服务不可用。',
    en: 'Desktop download service is unavailable.',
    ja: 'デスクトップのダウンロードサービスを利用できません。',
  },
  'error.bridge.streamingService': {
    zh: '桌面流媒体服务不可用，无法解析下载地址。',
    en: 'Desktop streaming service is unavailable; cannot resolve the download URL.',
    ja: 'デスクトップのストリームサービスを利用できないため、ダウンロード URL を解決できません。',
  },
  'error.bridge.playlistService': {
    zh: '桌面歌单服务不可用。',
    en: 'Desktop playlist service is unavailable.',
    ja: 'デスクトップのプレイリストサービスを利用できません。',
  },
  'error.bridge.spotify': {
    zh: 'Spotify 桌面桥接不可用，请在 ECHO Next 桌面端打开。',
    en: 'Spotify desktop bridge is unavailable. Open ECHO Next in Electron.',
    ja: 'Spotify デスクトップブリッジを利用できません。ECHO Next デスクトップを開いてください。',
  },

  // Dev API
  'error.devApi.unavailable.playlist': {
    zh: '本地开发接口未启动，请重启 npm run dev 后再添加歌单。',
    en: 'Local development API is unavailable. Restart npm run dev before adding playlists.',
    ja: 'ローカル開発 API が起動していません。プレイリスト追加前に npm run dev を再起動してください。',
  },
  'error.devApi.unavailable.dailyRecommend': {
    zh: '本地开发接口未启动，请重启 npm run dev 后再刷新每日推荐。',
    en: 'Local development API is unavailable. Restart npm run dev before refreshing daily recommendations.',
    ja: 'ローカル開発 API が起動していません。デイリーレコメンド更新前に npm run dev を再起動してください。',
  },
  'error.devApi.unavailable.likedSongs': {
    zh: '本地开发接口未启动，请重启 npm run dev 后再同步喜欢歌单。',
    en: 'Local development API is unavailable. Restart npm run dev before syncing liked songs.',
    ja: 'ローカル開発 API が起動していません。お気に入り同期前に npm run dev を再起動してください。',
  },
  'error.devApi.unavailable.likedTrack': {
    zh: '本地开发接口未启动，请重启 npm run dev 后再同步喜欢状态。',
    en: 'Local development API is unavailable. Restart npm run dev before syncing liked tracks.',
    ja: 'ローカル開発 API が起動していません。お気に入り状態の同期前に npm run dev を再起動してください。',
  },
  'error.devApi.importPlaylistFailed': {
    zh: '添加流媒体歌单失败',
    en: 'Failed to add streaming playlist',
    ja: 'ストリームプレイリストの追加に失敗しました',
  },
  'error.devApi.dailyRecommendFailed': {
    zh: '刷新网易云每日推荐失败。',
    en: 'Failed to refresh NetEase daily recommendations.',
    ja: 'NetEase デイリーレコメンドの更新に失敗しました。',
  },
  'error.devApi.syncLikedFailed': {
    zh: '同步在线喜欢歌单失败。',
    en: 'Failed to sync online liked songs.',
    ja: 'オンラインお気に入りプレイリストの同期に失敗しました。',
  },
  'error.devApi.syncLikedTrackFailed': {
    zh: '同步喜欢状态失败。',
    en: 'Failed to sync liked track.',
    ja: 'お気に入り状態の同期に失敗しました。',
  },

  // Feature / domain errors
  'error.streaming.playlistOnlyDownload': {
    zh: '只有网络歌单中的流媒体歌曲可以直接下载。',
    en: 'Only streaming tracks from online playlists can be downloaded directly.',
    ja: 'オンラインプレイリスト内のストリーム曲のみ直接ダウンロードできます。',
  },
  'error.streaming.spotifyNoDownload': {
    zh: 'Spotify 由官方播放器播放，下载功能不适用于 Spotify。',
    en: 'Spotify plays through the official player; downloads are not available for Spotify.',
    ja: 'Spotify は公式プレイヤー経由で再生され、ダウンロードには対応していません。',
  },
  'error.streaming.providerNoDownload': {
    zh: '这个平台暂不支持从网络歌单直接下载。',
    en: 'This provider does not support direct downloads from online playlists yet.',
    ja: 'このプラットフォームはオンラインプレイリストからの直接ダウンロードにまだ対応していません。',
  },
  'error.streaming.localPlaylistOnly': {
    zh: '流媒体歌曲不能加入本地歌单，请在流媒体歌单中单独管理。',
    en: 'Streaming tracks cannot be added to local playlists; manage them in streaming playlists.',
    ja: 'ストリーム曲はローカルプレイリストに追加できません。ストリーム側のプレイリストで管理してください。',
  },
  'error.connect.remoteSeekUnavailable': {
    zh: 'Connect 投送中，远端 seek 不可用。',
    en: 'Remote seek is unavailable while Connect casting is active.',
    ja: 'Connect 配信中はリモートシークを利用できません。',
  },
  'error.hqPlayer.channelUnavailable': {
    zh: 'HQPlayer 接管不可用：没有可用的 HQPlayer Connect 通道。',
    en: 'HQPlayer takeover is unavailable: no HQPlayer Connect channel is available.',
    ja: 'HQPlayer テイクオーバーを利用できません。利用可能な HQPlayer Connect チャネルがありません。',
  },
  'error.plugin.systemUnavailable': {
    zh: '插件系统当前不可用。',
    en: 'The plugin system is currently unavailable.',
    ja: 'プラグインシステムは現在利用できません。',
  },
  'error.artist.avatarUnsupported': {
    zh: '当前运行环境不支持设置艺术家头像。',
    en: 'This environment does not support setting artist avatars.',
    ja: 'この実行環境ではアーティストアバターの設定に対応していません。',
  },
  'error.artist.avatarChooseUnsupported': {
    zh: '当前运行环境不支持选择艺术家头像。',
    en: 'This environment does not support choosing artist avatars.',
    ja: 'この実行環境ではアーティストアバターの選択に対応していません。',
  },
  'error.artist.avatarNetworkUnsupported': {
    zh: '当前运行环境不支持从网络设置艺术家头像。',
    en: 'This environment does not support setting artist avatars from the network.',
    ja: 'この実行環境ではネットワークからのアーティストアバター設定に対応していません。',
  },
  'error.artist.avatarResetUnsupported': {
    zh: '当前运行环境不支持恢复自动头像。',
    en: 'This environment does not support restoring automatic avatars.',
    ja: 'この実行環境では自動アバターの復元に対応していません。',
  },
  'error.downloads.osuAccountUnavailable': {
    zh: '当前运行环境无法读取 osu! 账号数据。',
    en: 'This environment cannot read osu! account data.',
    ja: 'この実行環境では osu! アカウントデータを読み取れません。',
  },
  'error.downloads.folderRequired': {
    zh: '请选择下载文件夹',
    en: 'Please choose a download folder',
    ja: 'ダウンロードフォルダーを選択してください',
  },
  'error.export.localOnly': {
    zh: '当前导出只支持本地音频文件。流媒体请使用下载功能。',
    en: 'Export currently supports local audio files only. Use downloads for streaming tracks.',
    ja: '現在の書き出しはローカル音声ファイルのみ対応です。ストリームはダウンロード機能を使ってください。',
  },
  'error.export.fileMissing': {
    zh: '当前音频文件不存在，无法导出。',
    en: 'The current audio file does not exist and cannot be exported.',
    ja: '現在の音声ファイルが存在しないため書き出せません。',
  },
  'error.export.nothingToExport': {
    zh: '没有可导出的音频文件。',
    en: 'There is no audio file to export.',
    ja: '書き出せる音声ファイルがありません。',
  },
  'error.export.targetExists': {
    zh: '导出目标已存在。请换一个文件名，避免静默覆盖。',
    en: 'The export target already exists. Choose another file name to avoid silent overwrite.',
    ja: '書き出し先が既に存在します。静かに上書きしないよう、別のファイル名を選んでください。',
  },
  'error.export.cannotOverwriteSource': {
    zh: '导出目标不能覆盖当前播放的源文件，请选择另一个文件名。',
    en: 'Export cannot overwrite the currently playing source file. Choose another file name.',
    ja: '書き出し先は現在再生中のソースファイルを上書きできません。別のファイル名を選んでください。',
  },
  'error.backup.missingManifest': {
    zh: '备份文件缺少 manifest.json。',
    en: 'The backup file is missing manifest.json.',
    ja: 'バックアップに manifest.json がありません。',
  },
  'error.backup.unsupported': {
    zh: '选中的文件不是受支持的 ECHO Next 数据备份。',
    en: 'The selected file is not a supported ECHO Next data backup.',
    ja: '選択したファイルはサポートされる ECHO Next データバックアップではありません。',
  },
  'error.backup.missingSettings': {
    zh: '备份文件缺少设置文件。',
    en: 'The backup file is missing settings.',
    ja: 'バックアップに設定ファイルがありません。',
  },
  'error.backup.scanRunning': {
    zh: '曲库扫描运行中，暂时不能导入备份。',
    en: 'A library scan is running; backup import is temporarily unavailable.',
    ja: 'ライブラリスキャン実行中のため、バックアップのインポートは一時的にできません。',
  },
  'error.backup.chooseDirectory': {
    zh: '请先选择自动备份目录。',
    en: 'Choose an automatic backup directory first.',
    ja: '先に自動バックアップディレクトリを選択してください。',
  },
  'error.database.unhealthySnapshot': {
    zh: '曲库数据库当前不健康，已拒绝创建新的健康快照。',
    en: 'The library database is unhealthy; creating a new healthy snapshot was rejected.',
    ja: 'ライブラリデータベースが不健全なため、新しい健全スナップショットの作成を拒否しました。',
  },
  'error.database.snapshotMissing': {
    zh: '找不到这个曲库数据库快照，已拒绝恢复。',
    en: 'That library database snapshot was not found; restore was rejected.',
    ja: 'そのライブラリデータベースのスナップショットが見つからないため、復元を拒否しました。',
  },
  'error.database.snapshotNotRestorable': {
    zh: '这个快照不是可恢复的健康曲库数据库快照。',
    en: 'This snapshot is not a restorable healthy library database snapshot.',
    ja: 'このスナップショットは復元可能な健全なライブラリデータベーススナップショットではありません。',
  },
  'error.database.snapshotCopyFailed': {
    zh: '快照复制失败，曲库数据库文件没有恢复。',
    en: 'Snapshot copy failed; the library database file was not restored.',
    ja: 'スナップショットのコピーに失敗し、ライブラリデータベースは復元されませんでした。',
  },
  'error.database.quarantineMissing': {
    zh: '找不到可修复的隔离曲库数据库。',
    en: 'No repairable quarantined library database was found.',
    ja: '修復可能な隔離ライブラリデータベースが見つかりません。',
  },
  'error.database.quarantineCopyFailed': {
    zh: '隔离曲库副本复制失败，已拒绝修复。',
    en: 'Copying the quarantined library copy failed; repair was rejected.',
    ja: '隔離ライブラリのコピーに失敗したため、修復を拒否しました。',
  },
  'error.spotify.premiumRequired': {
    zh: 'Spotify Premium 才支持播放。',
    en: 'Spotify Premium is required for playback.',
    ja: '再生には Spotify Premium が必要です。',
  },
  'error.spotify.signInExpired': {
    zh: 'Spotify 登录已失效，请在设置中重新登录。',
    en: 'Spotify sign-in expired. Sign in again from Settings.',
    ja: 'Spotify のサインイン期限が切れました。設定から再度サインインしてください。',
  },
  'error.spotify.deviceNotReady': {
    zh: 'Spotify 播放设备尚未就绪，请稍后再试。',
    en: 'Spotify playback device is not ready yet. Try again in a moment.',
    ja: 'Spotify 再生デバイスの準備ができていません。しばらくしてから再試行してください。',
  },
  'error.spotify.sdkTimeout': {
    zh: 'Spotify Web Playback SDK 加载超时。',
    en: 'Spotify Web Playback SDK load timed out.',
    ja: 'Spotify Web Playback SDK の読み込みがタイムアウトしました。',
  },
  'error.spotify.sdkLoadFailed': {
    zh: '无法加载 Spotify Web Playback SDK，请检查网络连接。',
    en: 'Unable to load Spotify Web Playback SDK. Check the network connection.',
    ja: 'Spotify Web Playback SDK を読み込めません。ネットワーク接続を確認してください。',
  },
  'error.spotify.sdkNotReady': {
    zh: 'Spotify Web Playback SDK 尚未就绪。',
    en: 'Spotify Web Playback SDK is not ready.',
    ja: 'Spotify Web Playback SDK の準備ができていません。',
  },
  'error.spotify.notPlayableTrack': {
    zh: '当前曲目不是可播放的 Spotify 曲目。',
    en: 'The current track is not a playable Spotify track.',
    ja: '現在の曲は再生可能な Spotify 曲ではありません。',
  },
  'error.spotify.stayedPaused': {
    zh: 'Spotify 已接受命令，但官方播放器仍处于暂停{device}。',
    en: 'Spotify accepted the command, but the official player stayed paused{device}.',
    ja: 'Spotify はコマンドを受け付けましたが、公式プレイヤーは一時停止のままです{device}。',
  },
  'error.spotify.didNotSwitch': {
    zh: 'Spotify 没有切换到请求的曲目{device}。请稍后再试。',
    en: 'Spotify did not switch to the requested track{device}. Try again in a moment.',
    ja: 'Spotify は要求された曲に切り替わりませんでした{device}。しばらくしてから再試行してください。',
  },
  'error.spotify.clientIdRequired': {
    zh: '请先在设置 > 集成 > Spotify OAuth 配置中填写你自己的 Spotify Client ID，然后重新登录 Spotify。',
    en: 'Enter your own Spotify Client ID in Settings > Integrations > Spotify OAuth, then sign in to Spotify again.',
    ja: '設定 > 連携 > Spotify OAuth に自分の Spotify Client ID を入力してから、Spotify に再度サインインしてください。',
  },

  // Technical code maps used by userFacingError
  'error.code.eqPresetNotFound': {
    zh: '找不到这个 EQ 预设。',
    en: 'That EQ preset was not found.',
    ja: 'その EQ プリセットが見つかりません。',
  },
  'error.code.eqProfileNotFound': {
    zh: '找不到这个 EQ 配置档。',
    en: 'That EQ profile was not found.',
    ja: 'その EQ プロファイルが見つかりません。',
  },
  'error.code.invalidEqPreset': {
    zh: 'EQ 预设无效。',
    en: 'The EQ preset is invalid.',
    ja: 'EQ プリセットが無効です。',
  },
  'error.code.cannotOverwriteBuiltinEq': {
    zh: '不能覆盖内置 EQ 预设。',
    en: 'Built-in EQ presets cannot be overwritten.',
    ja: '内蔵 EQ プリセットは上書きできません。',
  },
  'error.code.cannotDeleteBuiltinEq': {
    zh: '不能删除内置 EQ 预设。',
    en: 'Built-in EQ presets cannot be deleted.',
    ja: '内蔵 EQ プリセットは削除できません。',
  },
  'error.code.invalidEqImport': {
    zh: 'EQ 预设导入无效。',
    en: 'The EQ preset import is invalid.',
    ja: 'EQ プリセットのインポートが無効です。',
  },
  'error.code.opraUnavailable': {
    zh: 'OPRA 桥接不可用。',
    en: 'OPRA bridge is unavailable.',
    ja: 'OPRA ブリッジを利用できません。',
  },
};

function escapeTs(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
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
  writeFileSync(file, `${text.slice(0, idx)}\n  // --- error / audio error i18n ---\n${block}${text.slice(idx)}`, 'utf8');
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
  const union = toAdd.map((k) => `  | '${k}'`).join('\n');
  if (!localesTs.includes("| 'queue.page.undo.playNext';")) {
    throw new Error('insert point missing');
  }
  localesTs = localesTs.replace("| 'queue.page.undo.playNext';", `| 'queue.page.undo.playNext'\n${union};`);
  writeFileSync(join(root, 'src/renderer/i18n/locales.ts'), localesTs, 'utf8');
  console.log('TranslationKey +', toAdd.length);
}
