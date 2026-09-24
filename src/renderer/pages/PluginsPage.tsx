import { type DragEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ChevronDown, Code2, Download, Eye, FolderOpen, LockKeyhole, PackagePlus, Play, Power, RefreshCw, ScrollText, ShieldCheck, ShoppingBag, TerminalSquare, Trash2, Upload } from 'lucide-react';
import { echoProUnlockPluginId } from '../../shared/constants/featureUnlocks';
import { pluginPermissionDescriptors } from '../../shared/types/plugins';
import type {
  PluginCreateExampleKind,
  PluginLogEntry,
  PluginMarketEntry,
  PluginPermission,
  PluginPermissionAvailability,
  PluginPermissionRisk,
  PluginSettingsPatch,
  PluginSummary,
} from '../../shared/types/plugins';
import { PluginCommandPalette } from '../components/plugins/PluginCommandPalette';
import { PluginPanelFrame } from '../components/plugins/PluginPanelFrame';
import { EmptyState } from '../components/ui/EmptyState';
import { useOptionalI18n } from '../i18n/I18nProvider';
import type { Locale } from '../i18n/locales';
import { getPluginsBridge } from '../utils/echoBridge';
import { formatUserFacingError } from '../utils/userFacingError';

const pluginPageTextZhCN = {
  'action.create': '新建',
  'action.createExamplePlugin': '创建示例',
  'action.delete': '删除插件',
  'action.disable': '停用',
  'action.enable': '启用',
  'action.exportPackage': '导出插件包',
  'action.importPackage': '导入插件包',
  'action.importEchoPackage': '导入 .echo',
  'action.openDirectory': '打开目录',
  'action.openCommandPalette': '打开命令面板',
  'action.openPluginDirectory': '打开插件目录',
  'action.refresh': '刷新',
  'action.refreshLogs': '刷新日志',
  'action.reload': '重载',
  'action.saveSettings': '保存设置',
  'activity.command': '命令执行',
  'activity.error': '错误',
  'activity.event': '事件接收',
  'activity.settingsWrite': '设置写入',
  'activity.storageWrite': '插件存储写入',
  'availability.active': '已开放',
  'availability.limited': '受限',
  'availability.reserved': '预留',
  'confirm.delete': '删除插件“{name}”？\n\n这会停用插件并删除插件目录：\n{directory}\n\n此操作不会删除音乐文件。',
  'confirm.enable': '启用插件「{name}」？\n\n请求权限：\n{permissions}{highRisk}{reserved}\n\n插件会在主进程受控沙盒和面板 iframe 沙盒中运行，连续启动失败会自动隔离。',
  'confirm.enable.highRisk': '\n\n包含高风险权限，请确认插件来源可信。',
  'confirm.enable.reserved': '\n\n部分权限在 v1 只是预留或受限能力，启用不会额外开放 Node、Electron、SQLite、主界面 DOM 或音频热路径。',
  'empty.noPlugins.description': '新建一个示例插件，或把插件文件夹放进插件目录。',
  'empty.noPlugins.title': '还没有插件',
  'empty.noSelection.description': '选择左侧插件查看权限、命令、日志和面板。',
  'empty.noSelection.title': '选择插件',
  'empty.unavailable.description': '请在 ECHO Next 桌面端打开插件管理。',
  'empty.unavailable.title': '插件系统不可用',
  'error.disabledByHost': '这个插件连续启动失败，ECHO 已自动隔离。修复插件文件后可手动重新启用。',
  'error.echoProMachineMismatch': '检测到版本升级前的旧设备标识。请回到“设置 → 账号与 Pro”，保持原订单或 Pro Key 不变并重新联网激活；服务器会安全替换旧绑定，不会额外占用设备槽位。',
  'example.command.description': '注册一个手动执行的工具命令。',
  'example.command.label': '命令工具',
  'example.library.description': '读取曲库摘要，适合整理类脚本起步。',
  'example.library.label': '曲库脚本',
  'example.playback.description': '监听播放状态，带一个可编辑面板。',
  'example.playback.label': '播放状态面板',
  'example.source.description': '返回搜索候选，并在用户触发时解析音频 URL。',
  'example.source.label': '自定义音源',
  'example.theme.description': '贡献可导入的高自定义主题参数。',
  'example.theme.label': '主题预设',
  'fallback.error': '插件操作失败',
  'header.description': '插件默认关闭。启用后可按授权读取曲库、控制播放、管理自身设置并扩展界面，但不会进入音频热路径。',
  'header.kicker': '本地插件',
  'header.title': '插件',
  'label.api': 'API v{version}',
  'label.apiWithMin': 'API v{version} / 最低 ECHO {minVersion}',
  'label.coverProviders': '封面提供器',
  'label.lyricsProviders': '歌词提供器',
  'label.metadataProviders': '元数据提供器',
  'label.networkOff': '网络 API 关闭',
  'label.networkOn': '网络 API 已开启',
  'label.noLogs': '暂无日志。',
  'label.none': '暂无',
  'label.panelSandboxed': '面板沙盒隔离',
  'label.noPanelScript': '无面板脚本',
  'label.pluginSettings': '插件设置',
  'label.panelTitle': '{name} 面板',
  'label.sourceProviders': '音源提供器',
  'label.themePresets': '主题预设',
  'message.cancelledExport': '已取消导出。',
  'message.cancelledImport': '已取消导入。',
  'message.commandRan': '命令已执行，详情可查看日志。',
  'message.createdExample': '已创建示例插件，可打开目录编辑。',
  'message.deleted': '已删除插件 {name}',
  'message.disabled': '已停用 {name}',
  'message.enabled': '已启用 {name}',
  'message.exported': '已导出插件包：{target}',
  'message.imported': '已导入插件包：{pluginId}',
  'message.invalidDrop': '请拖入 .echo 插件包。',
  'message.refreshed': '插件列表已刷新。',
  'message.reloaded': '已重载 {name}',
  'message.settingsSaved': '插件设置已保存。',
  'overlay.dropPackage': '释放导入 .echo 插件包',
  'permission.audioAnalyze.description': '允许宿主按曲目 ID 执行受控音质和 DSD 置信度分析。',
  'permission.audioAnalyze.label': '音频分析',
  'permission.fsPlugin.description': 'v1 仅通过 storage API 读写插件自身存储，不开放任意文件 API。',
  'permission.fsPlugin.label': '插件目录文件（受限）',
  'permission.libraryRead.description': '可分页读取曲库摘要和公开曲目信息。',
  'permission.libraryRead.label': '读取曲库',
  'permission.libraryWrite.description': '预留给未来曲库写入能力；v1 不提供实际写入 API。',
  'permission.libraryWrite.label': '修改曲库（预留）',
  'permission.network.description': '通过宿主受控 API 访问 http/https；v2 起生效，受超时、大小、方法和 header 限制。',
  'permission.network.label': '访问网络',
  'permission.playbackControl.description': '可触发播放、暂停、停止和跳转位置。',
  'permission.playbackControl.label': '控制播放',
  'permission.playbackRead.description': '可读取当前播放状态、曲目 id、进度和音频状态快照。',
  'permission.playbackRead.label': '读取播放状态',
  'permission.settingsRead.description': '可读取应用设置快照。',
  'permission.settingsRead.label': '读取设置',
  'permission.settingsWrite.description': '可写入小型设置 patch，属于高风险能力。',
  'permission.settingsWrite.label': '修改设置',
  'permission.sourcesProvide.description': '可注册用户自定义音源候选，并在用户触发播放时返回显式音频 URL。',
  'permission.sourcesProvide.label': '提供自定义音源',
  'permissions.none': '无需额外权限',
  'permissions.trusted': '已信任',
  'permissions.untrusted': '未信任',
  'risk.high': '高风险',
  'risk.low': '低风险',
  'risk.medium': '中风险',
  'section.activity': '这个插件干了什么',
  'section.commands': '命令',
  'section.commands.empty': '这个插件还没有注册命令。',
  'section.examples': '示例插件',
  'section.logs': '日志',
  'section.panelPreview': '面板预览',
  'section.pluginDetail': '插件详情',
  'section.pluginList': '插件列表',
  'section.security': '安全边界',
  'security.commandCount': '{count} 个命令',
  'security.coverAndLyricsProviders': '{lyrics} 个歌词 / {cover} 个封面提供器',
  'security.highRisk.none': '无高风险权限',
  'security.highRisk.some': '{count} 个高风险权限',
  'security.limited.none': '无受限权限',
  'security.limited.some': '{count} 个受限权限',
  'security.metadataProviders': '{count} 个元数据提供器',
  'security.permissionTrust': '{trusted}/{requested} 权限已信任',
  'security.pluginSettings': '{count} 个插件设置',
  'security.reserved.none': '无预留权限',
  'security.reserved.some': '{count} 个预留权限',
  'security.sourceProviders': '{count} 个音源提供器',
  'security.themePresets': '{count} 个主题预设',
  'status.disabled': '未启用',
  'status.error': '异常',
  'status.enabled': '已启用',
  'status.isolated': '已隔离',
  'status.running': '运行中',
  'time.none': '暂无',
} as const;

type PluginPageTextKey = keyof typeof pluginPageTextZhCN;
type PluginPageTranslateOptions = Record<string, string | number>;
type PluginPageTranslate = (key: PluginPageTextKey, options?: PluginPageTranslateOptions) => string;

const pluginPageTextEnUS: Record<PluginPageTextKey, string> = {
  'action.create': 'Create',
  'action.createExamplePlugin': 'Create example',
  'action.delete': 'Delete plugin',
  'action.disable': 'Disable',
  'action.enable': 'Enable',
  'action.exportPackage': 'Export package',
  'action.importPackage': 'Import package',
  'action.importEchoPackage': 'Import .echo',
  'action.openDirectory': 'Open folder',
  'action.openCommandPalette': 'Open command palette',
  'action.openPluginDirectory': 'Open plugin folder',
  'action.refresh': 'Refresh',
  'action.refreshLogs': 'Refresh logs',
  'action.reload': 'Reload',
  'action.saveSettings': 'Save settings',
  'activity.command': 'Command runs',
  'activity.error': 'Errors',
  'activity.event': 'Events received',
  'activity.settingsWrite': 'Settings writes',
  'activity.storageWrite': 'Plugin storage writes',
  'availability.active': 'Active',
  'availability.limited': 'Limited',
  'availability.reserved': 'Reserved',
  'confirm.delete': 'Delete plugin "{name}"?\n\nThis disables the plugin and deletes its plugin directory:\n{directory}\n\nMusic files will not be deleted.',
  'confirm.enable': 'Enable plugin "{name}"?\n\nRequested permissions:\n{permissions}{highRisk}{reserved}\n\nThe plugin runs in a controlled main-process sandbox and sandboxed panel iframe. Repeated startup failures are isolated automatically.',
  'confirm.enable.highRisk': '\n\nHigh-risk permissions are included. Confirm the plugin source is trusted.',
  'confirm.enable.reserved': '\n\nSome permissions are reserved or limited in v1. Enabling them does not grant Node, Electron, SQLite, main-window DOM, or audio hot-path access.',
  'empty.noPlugins.description': 'Create an example plugin, or place a plugin folder in the plugin directory.',
  'empty.noPlugins.title': 'No plugins yet',
  'empty.noSelection.description': 'Select a plugin on the left to view permissions, commands, logs, and panel.',
  'empty.noSelection.title': 'Select a plugin',
  'empty.unavailable.description': 'Open plugin management in the ECHO Next desktop app.',
  'empty.unavailable.title': 'Plugin system unavailable',
  'error.disabledByHost': 'This plugin failed to start repeatedly, so ECHO isolated it automatically. Fix the plugin files, then enable it again manually.',
  'error.echoProMachineMismatch': 'A device identity from before the update was detected. Open Settings → Account & Pro and activate again with the same order or Pro Key. The server will replace the stale binding without consuming another device slot.',
  'example.command.description': 'Register a manually executed tool command.',
  'example.command.label': 'Command tool',
  'example.library.description': 'Read library summaries, useful for organizer scripts.',
  'example.library.label': 'Library script',
  'example.playback.description': 'Listen to playback state and show an editable panel.',
  'example.playback.label': 'Playback status panel',
  'example.source.description': 'Return search candidates and resolve audio URLs on user action.',
  'example.source.label': 'Custom source',
  'example.theme.description': 'Contribute importable high-customization theme parameters.',
  'example.theme.label': 'Theme preset',
  'fallback.error': 'Plugin operation failed',
  'header.description': 'Plugins are off by default. Once enabled, trusted capabilities can read the library, control playback, manage plugin-owned settings, and extend the UI without entering the audio hot path.',
  'header.kicker': 'Local plugins',
  'header.title': 'Plugins',
  'label.api': 'API v{version}',
  'label.apiWithMin': 'API v{version} / min ECHO {minVersion}',
  'label.coverProviders': 'cover providers',
  'label.lyricsProviders': 'lyrics providers',
  'label.metadataProviders': 'metadata providers',
  'label.networkOff': 'Network API off',
  'label.networkOn': 'Network API on',
  'label.noLogs': 'No logs yet.',
  'label.none': 'None',
  'label.panelSandboxed': 'Panel sandboxed',
  'label.noPanelScript': 'No panel script',
  'label.pluginSettings': 'Plugin settings',
  'label.panelTitle': '{name} panel',
  'label.sourceProviders': 'source providers',
  'label.themePresets': 'theme presets',
  'message.cancelledExport': 'Export cancelled.',
  'message.cancelledImport': 'Import cancelled.',
  'message.commandRan': 'Command ran. Check logs for details.',
  'message.createdExample': 'Example plugin created. Open the folder to edit it.',
  'message.deleted': 'Deleted plugin {name}',
  'message.disabled': 'Disabled {name}',
  'message.enabled': 'Enabled {name}',
  'message.exported': 'Exported plugin package: {target}',
  'message.imported': 'Imported plugin package: {pluginId}',
  'message.invalidDrop': 'Drop a .echo plugin package.',
  'message.refreshed': 'Plugin list refreshed.',
  'message.reloaded': 'Reloaded {name}',
  'message.settingsSaved': 'Plugin settings saved.',
  'overlay.dropPackage': 'Release to import .echo plugin package',
  'permission.audioAnalyze.description': 'Allows host-controlled quality and DSD confidence analysis for library tracks by track ID.',
  'permission.audioAnalyze.label': 'Audio analysis',
  'permission.fsPlugin.description': 'In v1, only the storage API can read and write plugin-owned storage. Arbitrary file APIs are not exposed.',
  'permission.fsPlugin.label': 'Plugin directory files (limited)',
  'permission.libraryRead.description': 'Can page through library summaries and public track information.',
  'permission.libraryRead.label': 'Read library',
  'permission.libraryWrite.description': 'Reserved for future library write capabilities; v1 does not provide an actual write API.',
  'permission.libraryWrite.label': 'Modify library (reserved)',
  'permission.network.description': 'Access http/https through host-controlled APIs starting in v2, with timeout, size, method, and header limits.',
  'permission.network.label': 'Network access',
  'permission.playbackControl.description': 'Can trigger play, pause, stop, and seek.',
  'permission.playbackControl.label': 'Control playback',
  'permission.playbackRead.description': 'Can read current playback state, track ID, progress, and audio status snapshots.',
  'permission.playbackRead.label': 'Read playback state',
  'permission.settingsRead.description': 'Can read an app settings snapshot.',
  'permission.settingsRead.label': 'Read settings',
  'permission.settingsWrite.description': 'Can write small settings patches; this is a high-risk capability.',
  'permission.settingsWrite.label': 'Modify settings',
  'permission.sourcesProvide.description': 'Can register custom source candidates and return explicit audio URLs when the user starts playback.',
  'permission.sourcesProvide.label': 'Provide custom sources',
  'permissions.none': 'No extra permissions',
  'permissions.trusted': 'Trusted',
  'permissions.untrusted': 'Untrusted',
  'risk.high': 'High risk',
  'risk.low': 'Low risk',
  'risk.medium': 'Medium risk',
  'section.activity': 'Plugin activity',
  'section.commands': 'Commands',
  'section.commands.empty': 'This plugin has not registered any commands.',
  'section.examples': 'Example plugins',
  'section.logs': 'Logs',
  'section.panelPreview': 'Panel preview',
  'section.pluginDetail': 'Plugin details',
  'section.pluginList': 'Plugin list',
  'section.security': 'Security boundary',
  'security.commandCount': '{count} commands',
  'security.coverAndLyricsProviders': '{lyrics} lyrics / {cover} cover providers',
  'security.highRisk.none': 'No high-risk permissions',
  'security.highRisk.some': '{count} high-risk permissions',
  'security.limited.none': 'No limited permissions',
  'security.limited.some': '{count} limited permissions',
  'security.metadataProviders': '{count} metadata providers',
  'security.permissionTrust': '{trusted}/{requested} permissions trusted',
  'security.pluginSettings': '{count} plugin settings',
  'security.reserved.none': 'No reserved permissions',
  'security.reserved.some': '{count} reserved permissions',
  'security.sourceProviders': '{count} source providers',
  'security.themePresets': '{count} theme presets',
  'status.disabled': 'Disabled',
  'status.error': 'Error',
  'status.enabled': 'Enabled',
  'status.isolated': 'Isolated',
  'status.running': 'Running',
  'time.none': 'None',
}

const pluginPageTextZhTW: Record<PluginPageTextKey, string> = {
  // Traditional Chinese
  'action.create': '新建',
  'action.createExamplePlugin': '建立示例',
  'action.delete': '刪除外掛',
  'action.disable': '停用',
  'action.enable': '啟用',
  'action.exportPackage': '匯出外掛包',
  'action.importPackage': '匯入外掛包',
  'action.importEchoPackage': '匯入 .echo',
  'action.openDirectory': '開啟目錄',
  'action.openCommandPalette': '開啟命令面板',
  'action.openPluginDirectory': '開啟外掛目錄',
  'action.refresh': '重新整理',
  'action.refreshLogs': '重新整理日誌',
  'action.reload': '過載',
  'action.saveSettings': '儲存設定',
  'activity.command': '命令執行',
  'activity.error': '錯誤',
  'activity.event': '事件接收',
  'activity.settingsWrite': '設定寫入',
  'activity.storageWrite': '外掛儲存寫入',
  'availability.active': '已開放',
  'availability.limited': '受限',
  'availability.reserved': '預留',
  'confirm.delete': '刪除外掛“{name}”？\\n\\n這會停用外掛並刪除外掛目錄：\\n{directory}\\n\\n此操作不會刪除音樂檔案。',
  'confirm.enable': '啟用外掛「{name}」？\\n\\n請求許可權：\\n{permissions}{highRisk}{reserved}\\n\\n外掛會在主程序受控沙盒和麵板 iframe 沙盒中執行，連續啟動失敗會自動隔離。',
  'confirm.enable.highRisk': '\\n\\n包含高風險許可權，請確認外掛來源可信。',
  'confirm.enable.reserved': '\\n\\n部分許可權在 v1 只是預留或受限能力，啟用不會額外開放 Node、Electron、SQLite、主介面 DOM 或音訊熱路徑。',
  'empty.noPlugins.description': '新建一個示例外掛，或把外掛資料夾放進外掛目錄。',
  'empty.noPlugins.title': '還沒有外掛',
  'empty.noSelection.description': '選擇左側外掛檢視許可權、命令、日誌和麵板。',
  'empty.noSelection.title': '選擇外掛',
  'empty.unavailable.description': '請在 ECHO Next 桌面端開啟外掛管理。',
  'empty.unavailable.title': '外掛系統不可用',
  'error.disabledByHost': '這個外掛連續啟動失敗，ECHO 已自動隔離。修復外掛檔案後可手動重新啟用。',
  'error.echoProMachineMismatch': '檢測到版本升級前的舊裝置標識。請回到“設定 → 賬號與 Pro”，保持原訂單或 Pro Key 不變並重新聯網啟用；伺服器會安全替換舊繫結，不會額外佔用裝置槽位。',
  'example.command.description': '註冊一個手動執行的工具命令。',
  'example.command.label': '命令工具',
  'example.library.description': '讀取曲庫摘要，適合整理類指令碼起步。',
  'example.library.label': '曲庫指令碼',
  'example.playback.description': '監聽播放狀態，帶一個可編輯面板。',
  'example.playback.label': '播放狀態面板',
  'example.source.description': '返回搜尋候選，並在使用者觸發時解析音訊 URL。',
  'example.source.label': '自定義音源',
  'example.theme.description': '貢獻可匯入的高自定義主題引數。',
  'example.theme.label': '主題預設',
  'fallback.error': '外掛操作失敗',
  'header.description': '外掛預設關閉。啟用後可依授權讀取曲庫、控制播放、管理自身設定並擴充介面，但不會進入音訊熱路徑。',
  'header.kicker': '本地外掛',
  'header.title': '外掛',
  'label.api': 'API v{version}',
  'label.apiWithMin': 'API v{version} / 最低 ECHO {minVersion}',
  'label.coverProviders': '封面提供器',
  'label.lyricsProviders': '歌詞提供器',
  'label.metadataProviders': '後設資料提供器',
  'label.networkOff': '網路 API 關閉',
  'label.networkOn': '網路 API 已開啟',
  'label.noLogs': '暫無日誌。',
  'label.none': '暫無',
  'label.panelSandboxed': '面板沙盒隔離',
  'label.noPanelScript': '無面板指令碼',
  'label.pluginSettings': '外掛設定',
  'label.panelTitle': '{name} 面板',
  'label.sourceProviders': '音源提供器',
  'label.themePresets': '主題預設',
  'message.cancelledExport': '已取消匯出。',
  'message.cancelledImport': '已取消匯入。',
  'message.commandRan': '命令已執行，詳情可檢視日誌。',
  'message.createdExample': '已建立示例外掛，可開啟目錄編輯。',
  'message.deleted': '已刪除外掛 {name}',
  'message.disabled': '已停用 {name}',
  'message.enabled': '已啟用 {name}',
  'message.exported': '已匯出外掛包：{target}',
  'message.imported': '已匯入外掛包：{pluginId}',
  'message.invalidDrop': '請拖入 .echo 外掛包。',
  'message.refreshed': '外掛列表已重新整理。',
  'message.reloaded': '已過載 {name}',
  'message.settingsSaved': '外掛設定已儲存。',
  'overlay.dropPackage': '釋放匯入 .echo 外掛包',
  'permission.audioAnalyze.description': '允許宿主按曲目 ID 執行受控音質和 DSD 置信度分析。',
  'permission.audioAnalyze.label': '音訊分析',
  'permission.fsPlugin.description': 'v1 僅通過 storage API 讀寫外掛自身儲存，不開放任意檔案 API。',
  'permission.fsPlugin.label': '外掛目錄檔案（受限）',
  'permission.libraryRead.description': '可分頁讀取曲庫摘要和公開曲目資訊。',
  'permission.libraryRead.label': '讀取曲庫',
  'permission.libraryWrite.description': '預留給未來曲庫寫入能力；v1 不提供實際寫入 API。',
  'permission.libraryWrite.label': '修改曲庫（預留）',
  'permission.network.description': '通過宿主受控 API 訪問 http/https；v2 起生效，受超時、大小、方法和 header 限制。',
  'permission.network.label': '訪問網路',
  'permission.playbackControl.description': '可觸發播放、暫停、停止和跳轉位置。',
  'permission.playbackControl.label': '控制播放',
  'permission.playbackRead.description': '可讀取當前播放狀態、曲目 id、進度和音訊狀態快照。',
  'permission.playbackRead.label': '讀取播放狀態',
  'permission.settingsRead.description': '可讀取應用設定快照。',
  'permission.settingsRead.label': '讀取設定',
  'permission.settingsWrite.description': '可寫入小型設定 patch，屬於高風險能力。',
  'permission.settingsWrite.label': '修改設定',
  'permission.sourcesProvide.description': '可註冊使用者自定義音源候選，並在使用者觸發播放時返回顯式音訊 URL。',
  'permission.sourcesProvide.label': '提供自定義音源',
  'permissions.none': '無需額外許可權',
  'permissions.trusted': '已信任',
  'permissions.untrusted': '未信任',
  'risk.high': '高風險',
  'risk.low': '低風險',
  'risk.medium': '中風險',
  'section.activity': '這個外掛幹了什麼',
  'section.commands': '命令',
  'section.commands.empty': '這個外掛還沒有註冊命令。',
  'section.examples': '示例外掛',
  'section.logs': '日誌',
  'section.panelPreview': '面板預覽',
  'section.pluginDetail': '外掛詳情',
  'section.pluginList': '外掛列表',
  'section.security': '安全邊界',
  'security.commandCount': '{count} 個命令',
  'security.coverAndLyricsProviders': '{lyrics} 個歌詞 / {cover} 個封面提供器',
  'security.highRisk.none': '無高風險許可權',
  'security.highRisk.some': '{count} 個高風險許可權',
  'security.limited.none': '無受限許可權',
  'security.limited.some': '{count} 個受限許可權',
  'security.metadataProviders': '{count} 個後設資料提供器',
  'security.permissionTrust': '{trusted}/{requested} 許可權已信任',
  'security.pluginSettings': '{count} 個外掛設定',
  'security.reserved.none': '無預留許可權',
  'security.reserved.some': '{count} 個預留許可權',
  'security.sourceProviders': '{count} 個音源提供器',
  'security.themePresets': '{count} 個主題預設',
  'status.disabled': '未啟用',
  'status.error': '異常',
  'status.enabled': '已啟用',
  'status.isolated': '已隔離',
  'status.running': '執行中',
  'time.none': '暫無',
};

const pluginPageTextJaJP: Record<PluginPageTextKey, string> = {
  // Japanese
  'action.create': 'Create',
  'action.createExamplePlugin': 'サンプルを作成',
  'action.delete': 'プラグインを削除',
  'action.disable': 'Disable',
  'action.enable': 'Enable',
  'action.exportPackage': 'パッケージを書き出し',
  'action.importPackage': 'パッケージを取り込み',
  'action.importEchoPackage': 'Import .echo',
  'action.openDirectory': 'Open folder',
  'action.openCommandPalette': 'Open command palette',
  'action.openPluginDirectory': 'Open plugin folder',
  'action.refresh': 'Refresh',
  'action.refreshLogs': 'ログを更新',
  'action.reload': '再読み込み',
  'action.saveSettings': '設定を保存',
  'activity.command': 'Command runs',
  'activity.error': 'エラーs',
  'activity.event': 'Events received',
  'activity.settingsWrite': 'Settings writes',
  'activity.storageWrite': 'Plugin storage writes',
  'availability.active': 'Active',
  'availability.limited': '制限付き',
  'availability.reserved': 'Reserved',
  'confirm.delete': 'プラグインを削除 "{name}"?\\n\\nThis 無効化s the plugin and 削除s its plugin directory:\\n{directory}\\n\\nMusic files will not be 削除d.',
  'confirm.enable': 'Enable plugin "{name}"?\\n\\nRequested permissions:\\n{permissions}{highRisk}{reserved}\\n\\nThe plugin runs in a controlled main-process sandbox and sandboxed panel iframe. Repeated startup failures are isolated automatically.',
  'confirm.enable.highRisk': '\\n\\nHigh-risk 権限 are included. Confirm the plugin source is 信頼済み.',
  'confirm.enable.reserved': '\\n\\nSome 権限 are 予約 or 制限付き in v1. Enabling them does not grant Node, Electron, SQLite, main-window DOM, or audio hot-path access.',
  'empty.noPlugins.description': 'Create an example plugin, or place a plugin folder in the plugin directory.',
  'empty.noPlugins.title': 'プラグインはまだありません',
  'empty.noSelection.description': 'プラグインを選択 on the left to view 権限, コマンド, ログ, and panel.',
  'empty.noSelection.title': 'プラグインを選択',
  'empty.unavailable.description': 'Open plugin management in the ECHO Next desktop app.',
  'empty.unavailable.title': 'プラグインシステムを利用できません',
  'error.disabledByHost': 'This plugin failed to start repeatedly, so ECHO isolated it automatically. Fix the plugin files, then enable it again manually.',
  'error.echoProMachineMismatch': 'A device identity from before the update was detected. Open Settings → Account & Pro and activate again with the same order or Pro Key. The server will replace the stale binding without consuming another device slot.',
  'example.command.description': 'Register a manually executed tool command.',
  'example.command.label': 'Command tool',
  'example.library.description': 'Read library summaries, useful for organizer scripts.',
  'example.library.label': 'Library script',
  'example.playback.description': 'Listen to playback state and show an editable panel.',
  'example.playback.label': 'Playback status panel',
  'example.source.description': 'Return search candidates and resolve audio URLs on user action.',
  'example.source.label': 'Custom source',
  'example.theme.description': 'Contribute importable high-customization theme parameters.',
  'example.theme.label': 'Theme preset',
  'fallback.error': 'プラグイン操作に失敗しました',
  'header.description': 'Plugins are off by default. Once enabled, trusted capabilities can read the library, control playback, manage plugin-owned settings, and extend the UI without entering the audio hot path.',
  'header.kicker': 'ローカルプラグイン',
  'header.title': 'Plugins',
  'label.api': 'API v{version}',
  'label.apiWithMin': 'API v{version} / min ECHO {minVersion}',
  'label.coverProviders': 'cover providers',
  'label.lyricsProviders': 'lyrics providers',
  'label.metadataProviders': 'metadata providers',
  'label.networkOff': 'Network API off',
  'label.networkOn': 'Network API on',
  'label.noLogs': 'No ログ yet.',
  'label.none': 'なし',
  'label.panelSandboxed': 'Panel sandboxed',
  'label.noPanelScript': 'No panel script',
  'label.pluginSettings': 'Plugin settings',
  'label.panelTitle': '{name} panel',
  'label.sourceProviders': 'source providers',
  'label.themePresets': 'theme presets',
  'message.cancelledExport': 'Export cancelled.',
  'message.cancelledImport': 'Import cancelled.',
  'message.commandRan': 'Command ran. Check ログ for details.',
  'message.createdExample': 'Example plugin created. Open the folder to edit it.',
  'message.deleted': 'Deleted plugin {name}',
  'message.disabled': 'Disabled {name}',
  'message.enabled': 'Enabled {name}',
  'message.exported': 'Exported plugin package: {target}',
  'message.imported': 'Imported plugin package: {pluginId}',
  'message.invalidDrop': 'Drop a .echo plugin package.',
  'message.refreshed': 'Plugin list refreshed.',
  'message.reloaded': '再読み込みed {name}',
  'message.settingsSaved': 'Plugin settings saved.',
  'overlay.dropPackage': 'Release to import .echo plugin package',
  'permission.audioAnalyze.description': 'Allows host-controlled quality and DSD confidence analysis for library tracks by track ID.',
  'permission.audioAnalyze.label': 'Audio analysis',
  'permission.fsPlugin.description': 'In v1, only the storage API can read and write plugin-owned storage. Arbitrary file APIs are not exposed.',
  'permission.fsPlugin.label': 'Plugin directory files (制限付き)',
  'permission.libraryRead.description': 'Can page through library summaries and public track information.',
  'permission.libraryRead.label': 'Read library',
  'permission.libraryWrite.description': 'Reserved for future library write capabilities; v1 does not provide an actual write API.',
  'permission.libraryWrite.label': 'Modify library (reserved)',
  'permission.network.description': 'Access http/https through host-controlled APIs starting in v2, with timeout, size, method, and header limits.',
  'permission.network.label': 'Network access',
  'permission.playbackControl.description': 'Can trigger play, pause, stop, and seek.',
  'permission.playbackControl.label': 'Control playback',
  'permission.playbackRead.description': 'Can read current playback state, track ID, progress, and audio status snapshots.',
  'permission.playbackRead.label': 'Read playback state',
  'permission.settingsRead.description': 'Can read an app settings snapshot.',
  'permission.settingsRead.label': 'Read settings',
  'permission.settingsWrite.description': 'Can write small settings patches; this is a high-risk capability.',
  'permission.settingsWrite.label': 'Modify settings',
  'permission.sourcesProvide.description': 'Can register custom source candidates and return explicit audio URLs when the user starts playback.',
  'permission.sourcesProvide.label': 'Provide custom sources',
  'permissions.none': 'No extra permissions',
  'permissions.trusted': '信頼済み',
  'permissions.untrusted': 'Un信頼済み',
  'risk.high': '高リスク',
  'risk.low': '低リスク',
  'risk.medium': '中リスク',
  'section.activity': 'Plugin activity',
  'section.commands': 'コマンド',
  'section.commands.empty': 'This plugin has not registered any コマンド.',
  'section.examples': 'Example plugins',
  'section.logs': 'ログ',
  'section.panelPreview': 'Panel preview',
  'section.pluginDetail': 'Plugin details',
  'section.pluginList': 'Plugin list',
  'section.security': 'Security boundary',
  'security.commandCount': '{count} コマンド',
  'security.coverAndLyricsProviders': '{lyrics} lyrics / {cover} cover providers',
  'security.highRisk.none': 'No high-risk permissions',
  'security.highRisk.some': '{count} high-risk permissions',
  'security.limited.none': 'No 制限付き 権限',
  'security.limited.some': '{count} 制限付き 権限',
  'security.metadataProviders': '{count} metadata providers',
  'security.permissionTrust': '{信頼済み}/{requested} 権限 信頼済み',
  'security.pluginSettings': '{count} plugin settings',
  'security.reserved.none': 'No reserved permissions',
  'security.reserved.some': '{count} reserved permissions',
  'security.sourceProviders': '{count} source providers',
  'security.themePresets': '{count} theme presets',
  'status.disabled': 'Disabled',
  'status.error': 'エラー',
  'status.enabled': 'Enabled',
  'status.isolated': 'Isolated',
  'status.running': 'Running',
  'time.none': 'なし',
};

const pluginPageTextKoKR: Record<PluginPageTextKey, string> = {
  ...pluginPageTextEnUS,
  'action.create': '만들기',
  'action.createExamplePlugin': '예시 만들기',
  'action.delete': '플러그인 삭제',
  'action.disable': '사용 안 함',
  'action.enable': '사용',
  'action.exportPackage': '패키지 내보내기',
  'action.importPackage': '패키지 가져오기',
  'action.importEchoPackage': '.echo 가져오기',
  'action.openDirectory': '폴더 열기',
  'action.openCommandPalette': '명령 팔레트 열기',
  'action.openPluginDirectory': '플러그인 폴더 열기',
  'action.refresh': '새로고침',
  'action.refreshLogs': '로그 새로고침',
  'action.reload': '다시 로드',
  'action.saveSettings': '설정 저장',
  'activity.command': '명령 실행',
  'activity.error': '오류',
  'activity.event': '수신 이벤트',
  'activity.settingsWrite': '설정 쓰기',
  'activity.storageWrite': '플러그인 저장소 쓰기',
  'availability.active': '활성',
  'availability.limited': '제한됨',
  'availability.reserved': '예약됨',
  'empty.noPlugins.description': '예시 플러그인을 만들거나 플러그인 폴더에 플러그인을 넣으세요.',
  'empty.noPlugins.title': '아직 플러그인이 없습니다',
  'empty.noSelection.description': '왼쪽에서 플러그인을 선택해 권한, 명령, 로그, 패널을 확인하세요.',
  'empty.noSelection.title': '플러그인 선택',
  'empty.unavailable.description': 'ECHO Next 데스크톱 앱에서 플러그인 관리를 여세요.',
  'empty.unavailable.title': '플러그인 시스템을 사용할 수 없습니다',
  'fallback.error': '플러그인 작업 실패',
  'header.description': '플러그인은 기본적으로 꺼져 있습니다. 사용하면 승인된 권한으로 라이브러리 읽기, 재생 제어, 플러그인 설정 관리와 UI 확장을 수행하지만 오디오 핫 패스에는 들어가지 않습니다.',
  'header.kicker': '로컬 플러그인',
  'header.title': '플러그인',
  'label.none': '없음',
  'label.noLogs': '아직 로그가 없습니다.',
  'label.pluginSettings': '플러그인 설정',
  'message.cancelledExport': '내보내기가 취소되었습니다.',
  'message.cancelledImport': '가져오기가 취소되었습니다.',
  'message.commandRan': '명령을 실행했습니다. 자세한 내용은 로그를 확인하세요.',
  'message.createdExample': '예시 플러그인을 만들었습니다. 폴더를 열어 편집하세요.',
  'message.deleted': '플러그인 {name} 삭제됨',
  'message.disabled': '{name} 사용 안 함',
  'message.enabled': '{name} 사용',
  'message.exported': '플러그인 패키지 내보냄: {target}',
  'message.imported': '플러그인 패키지 가져옴: {pluginId}',
  'message.invalidDrop': '.echo 플러그인 패키지를 놓으세요.',
  'message.refreshed': '플러그인 목록을 새로고침했습니다.',
  'message.reloaded': '{name} 다시 로드됨',
  'message.settingsSaved': '플러그인 설정을 저장했습니다.',
  'overlay.dropPackage': '놓아서 .echo 플러그인 패키지 가져오기',
  'permissions.none': '추가 권한 없음',
  'permissions.trusted': '신뢰됨',
  'permissions.untrusted': '신뢰되지 않음',
  'risk.high': '고위험',
  'risk.low': '저위험',
  'risk.medium': '중위험',
  'section.activity': '플러그인 활동',
  'section.commands': '명령',
  'section.commands.empty': '이 플러그인은 아직 명령을 등록하지 않았습니다.',
  'section.examples': '예시 플러그인',
  'section.logs': '로그',
  'section.panelPreview': '패널 미리보기',
  'section.pluginDetail': '플러그인 세부 정보',
  'section.pluginList': '플러그인 목록',
  'section.security': '보안 경계',
  'status.disabled': '사용 안 함',
  'status.error': '오류',
  'status.enabled': '사용 중',
  'status.isolated': '격리됨',
  'status.running': '실행 중',
  'time.none': '없음',
};

const pluginPageTexts: Record<Locale, Record<PluginPageTextKey, string>> = {
  'zh-CN': pluginPageTextZhCN,
  'zh-TW': pluginPageTextZhTW,
  'ja-JP': pluginPageTextJaJP,
  'en-US': pluginPageTextEnUS,
  'ko-KR': pluginPageTextKoKR,
};

const permissionRiskLabelKeys = {
  low: 'risk.low',
  medium: 'risk.medium',
  high: 'risk.high',
} as const satisfies Record<PluginPermissionRisk, PluginPageTextKey>;

const permissionAvailabilityLabelKeys = {
  active: 'availability.active',
  reserved: 'availability.reserved',
  limited: 'availability.limited',
} as const satisfies Record<PluginPermissionAvailability, PluginPageTextKey>;

const exampleTextKeys: Array<{ kind: PluginCreateExampleKind; labelKey: PluginPageTextKey; descriptionKey: PluginPageTextKey }> = [
  { kind: 'playback-panel', labelKey: 'example.playback.label', descriptionKey: 'example.playback.description' },
  { kind: 'command-tool', labelKey: 'example.command.label', descriptionKey: 'example.command.description' },
  { kind: 'library-script', labelKey: 'example.library.label', descriptionKey: 'example.library.description' },
  { kind: 'source-provider', labelKey: 'example.source.label', descriptionKey: 'example.source.description' },
  { kind: 'theme-preset', labelKey: 'example.theme.label', descriptionKey: 'example.theme.description' },
];

const permissionTextKeys: Record<PluginPermission, { labelKey: PluginPageTextKey; descriptionKey: PluginPageTextKey }> = {
  'playback:read': { labelKey: 'permission.playbackRead.label', descriptionKey: 'permission.playbackRead.description' },
  'playback:control': { labelKey: 'permission.playbackControl.label', descriptionKey: 'permission.playbackControl.description' },
  'library:read': { labelKey: 'permission.libraryRead.label', descriptionKey: 'permission.libraryRead.description' },
  'library:write': { labelKey: 'permission.libraryWrite.label', descriptionKey: 'permission.libraryWrite.description' },
  'sources:provide': { labelKey: 'permission.sourcesProvide.label', descriptionKey: 'permission.sourcesProvide.description' },
  'settings:read': { labelKey: 'permission.settingsRead.label', descriptionKey: 'permission.settingsRead.description' },
  'settings:write': { labelKey: 'permission.settingsWrite.label', descriptionKey: 'permission.settingsWrite.description' },
  'audio:analyze': { labelKey: 'permission.audioAnalyze.label', descriptionKey: 'permission.audioAnalyze.description' },
  network: { labelKey: 'permission.network.label', descriptionKey: 'permission.network.description' },
  'fs:plugin': { labelKey: 'permission.fsPlugin.label', descriptionKey: 'permission.fsPlugin.description' },
};

const interpolatePluginText = (text: string, options?: PluginPageTranslateOptions): string => {
  if (!options) {
    return text;
  }

  return Object.entries(options).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, String(value)),
    text,
  );
};

const formatError = (error: unknown, fallback: string): string =>
  formatUserFacingError(error, { context: 'plugins', fallback });

const echoPackageExtension = '.echo';

const hasFileDrag = (dataTransfer: DataTransfer): boolean =>
  Array.from(dataTransfer.types ?? []).some((type) => type === 'Files');

const firstEchoPackageFile = (files: FileList | null | undefined): File | null =>
  Array.from(files ?? []).find((file) => file.name.toLowerCase().endsWith(echoPackageExtension)) ?? null;

const getPermissionCopy = (permission: PluginPermission, t: PluginPageTranslate): { label: string; description: string } => {
  const keys = permissionTextKeys[permission];
  const descriptor = pluginPermissionDescriptors[permission];
  return keys
    ? { label: t(keys.labelKey), description: t(keys.descriptionKey) }
    : { label: descriptor?.label ?? permission, description: descriptor?.description ?? permission };
};

const formatPermissionForConfirm = (permission: PluginPermission, t: PluginPageTranslate): string => {
  const descriptor = pluginPermissionDescriptors[permission];
  const permissionCopy = getPermissionCopy(permission, t);
  return descriptor
    ? `- ${permissionCopy.label} (${t(permissionRiskLabelKeys[descriptor.risk])}, ${t(permissionAvailabilityLabelKeys[descriptor.availability])}): ${permissionCopy.description}`
    : `- ${permission}`;
};

const formatPluginTime = (value: string | null, t: PluginPageTranslate): string => (value ? new Date(value).toLocaleString() : t('time.none'));

const StatusPill = ({ plugin, t }: { plugin: PluginSummary; t: PluginPageTranslate }): JSX.Element => {
  const label = plugin.disabledByHost
    ? t('status.isolated')
    : plugin.error
      ? t('status.error')
      : plugin.status === 'running'
        ? t('status.running')
        : plugin.enabled
          ? t('status.enabled')
          : t('status.disabled');
  return <span className="plugin-status-pill" data-status={plugin.disabledByHost ? 'isolated' : plugin.error ? 'error' : plugin.status}>{label}</span>;
};

const isEchoProMachineMismatch = (plugin: Pick<PluginSummary, 'id' | 'error'>): boolean =>
  plugin.id === echoProUnlockPluginId &&
  (plugin.error === 'echo_pro_license_machine-mismatch' || plugin.error === 'echo_pro_license_machine_mismatch');

const PermissionList = ({ plugin, t }: { plugin: PluginSummary; t: PluginPageTranslate }): JSX.Element => (
  <div className="plugin-permissions">
    {plugin.permissions.length === 0 ? (
      <span>{t('permissions.none')}</span>
    ) : (
      plugin.permissions.map((permission) => {
        const descriptor = pluginPermissionDescriptors[permission];
        const trusted = plugin.trustedPermissions.includes(permission);
        const permissionCopy = getPermissionCopy(permission, t);
        return (
          <span key={permission} data-risk={descriptor?.risk ?? 'medium'} title={permissionCopy.description}>
            {permissionCopy.label}
            <em>{descriptor ? t(permissionAvailabilityLabelKeys[descriptor.availability]) : trusted ? t('permissions.trusted') : t('permissions.untrusted')} · {trusted ? t('permissions.trusted') : t('permissions.untrusted')}</em>
          </span>
        );
      })
    )}
  </div>
);

const SecurityOverview = ({ plugin, t }: { plugin: PluginSummary; t: PluginPageTranslate }): JSX.Element => {
  const highRiskCount = plugin.security.highRiskPermissions.length;
  const reservedCount = plugin.security.reservedPermissions.length;
  const limitedCount = plugin.security.limitedPermissions.length;
  return (
    <section className="plugin-security-panel">
      <header>
        <ShieldCheck size={17} />
        <strong>{t('section.security')}</strong>
      </header>
      <div className="plugin-security-grid">
        <span>
          <LockKeyhole size={16} />
          {t('security.permissionTrust', { trusted: plugin.security.trustedPermissionCount, requested: plugin.security.requestedPermissionCount })}
        </span>
        <span data-risk={highRiskCount > 0 ? 'high' : 'low'}>
          <AlertTriangle size={16} />
          {highRiskCount > 0 ? t('security.highRisk.some', { count: highRiskCount }) : t('security.highRisk.none')}
        </span>
        <span data-risk={reservedCount > 0 ? 'medium' : 'low'}>
          <LockKeyhole size={16} />
          {reservedCount > 0 ? t('security.reserved.some', { count: reservedCount }) : t('security.reserved.none')}
        </span>
        <span data-risk={limitedCount > 0 ? 'medium' : 'low'}>
          <ShieldCheck size={16} />
          {limitedCount > 0 ? t('security.limited.some', { count: limitedCount }) : t('security.limited.none')}
        </span>
        <span>
          <Eye size={16} />
          {plugin.security.sandboxedPanel ? t('label.panelSandboxed') : t('label.noPanelScript')}
        </span>
        <span>
          <TerminalSquare size={16} />
          {t('security.commandCount', { count: plugin.security.commandCount })}
        </span>
        <span>
          <Code2 size={16} />
          {t('security.metadataProviders', { count: plugin.security.metadataProviderCount })}
        </span>
        <span>
          <Code2 size={16} />
          {t('security.sourceProviders', { count: plugin.security.sourceProviderCount })}
        </span>
        <span>
          <Code2 size={16} />
          {plugin.compatibility.minEchoVersion
            ? t('label.apiWithMin', { version: plugin.apiVersion, minVersion: plugin.compatibility.minEchoVersion })
            : t('label.api', { version: plugin.apiVersion })}
        </span>
        <span data-risk={plugin.security.networkEnabled ? 'high' : 'low'}>
          <LockKeyhole size={16} />
          {plugin.security.networkEnabled ? t('label.networkOn') : t('label.networkOff')}
        </span>
        <span>
          <Code2 size={16} />
          {t('security.coverAndLyricsProviders', { lyrics: plugin.security.lyricsProviderCount, cover: plugin.security.coverProviderCount })}
        </span>
        <span>
          <Code2 size={16} />
          {t('security.themePresets', { count: plugin.security.themePresetCount })}
        </span>
        <span>
          <Code2 size={16} />
          {t('security.pluginSettings', { count: plugin.security.settingCount })}
        </span>
      </div>
      <PermissionList plugin={plugin} t={t} />
    </section>
  );
};

const ActivityOverview = ({ plugin, t }: { plugin: PluginSummary; t: PluginPageTranslate }): JSX.Element => (
  <section className="plugin-activity-panel">
    <header>
      <Activity size={17} />
      <strong>{t('section.activity')}</strong>
    </header>
    <div className="plugin-activity-grid">
      <span>
        <strong>{plugin.activity.commandRunCount}</strong>
        {t('activity.command')}
        <em>{formatPluginTime(plugin.activity.lastCommandAt, t)}</em>
      </span>
      <span>
        <strong>{plugin.activity.eventDispatchCount}</strong>
        {t('activity.event')}
        <em>{formatPluginTime(plugin.activity.lastEventAt, t)}</em>
      </span>
      <span>
        <strong>{plugin.activity.storageWriteCount}</strong>
        {t('activity.storageWrite')}
        <em>{formatPluginTime(plugin.activity.lastStorageWriteAt, t)}</em>
      </span>
      <span>
        <strong>{plugin.activity.settingsWriteCount}</strong>
        {t('activity.settingsWrite')}
        <em>{formatPluginTime(plugin.activity.lastSettingsWriteAt, t)}</em>
      </span>
      <span data-risk={plugin.activity.errorCount > 0 ? 'high' : 'low'}>
        <strong>{plugin.activity.errorCount}</strong>
        {t('activity.error')}
        <em>{formatPluginTime(plugin.activity.lastErrorAt, t)}</em>
      </span>
    </div>
  </section>
);

export const PluginsPage = (): JSX.Element => {
  const i18n = useOptionalI18n();
  const localText = pluginPageTexts[i18n?.locale ?? 'zh-CN'] ?? pluginPageTextZhCN;
  const t = useCallback((key: PluginPageTextKey, options?: PluginPageTranslateOptions): string => {
    return interpolatePluginText(localText[key], options);
  }, [localText]);
  const pluginsApi = getPluginsBridge();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [pluginDirectory, setPluginDirectory] = useState('');
  const [logs, setLogs] = useState<PluginLogEntry[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPackageDragging, setIsPackageDragging] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<PluginSettingsPatch>({});
  const [isMarketOpen, setIsMarketOpen] = useState(false);
  const [marketPlugins, setMarketPlugins] = useState<PluginMarketEntry[]>([]);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketLoaded, setMarketLoaded] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  useEffect(() => {
    const handlePluginCommandShortcut = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !(event.ctrlKey || event.metaKey) ||
        !event.shiftKey ||
        event.key.toLocaleLowerCase() !== 'p'
      ) {
        return;
      }
      event.preventDefault();
      setIsCommandPaletteOpen((current) => !current);
    };
    window.addEventListener('keydown', handlePluginCommandShortcut);
    return () => window.removeEventListener('keydown', handlePluginCommandShortcut);
  }, []);

  const selectedPlugin = useMemo(
    () => plugins.find((plugin) => plugin.id === selectedPluginId) ?? plugins[0] ?? null,
    [plugins, selectedPluginId],
  );
  const installedPluginVersions = useMemo(() => new Map(plugins.map((plugin) => [plugin.id, plugin.version])), [plugins]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!pluginsApi) {
      return;
    }
    const result = await pluginsApi.list();
    setPlugins(result.plugins);
    setPluginDirectory(result.directory);
    setSelectedPluginId((current) => result.plugins.some((plugin) => plugin.id === current) ? current : result.plugins[0]?.id ?? null);
  }, [pluginsApi]);

  const refreshLogs = useCallback(async (pluginId?: string | null): Promise<void> => {
    if (!pluginsApi) {
      return;
    }
    setLogs(await pluginsApi.getLogs(pluginId ?? undefined));
  }, [pluginsApi]);

  const refreshMarket = useCallback(async (): Promise<void> => {
    if (!pluginsApi?.listMarket) {
      return;
    }
    setMarketError(null);
    const result = await pluginsApi.listMarket();
    setMarketPlugins(result.plugins);
    setMarketLoaded(true);
  }, [pluginsApi]);

  useEffect(() => {
    void refresh().catch((error) => setMessage(formatError(error, t('fallback.error'))));
  }, [refresh, t]);

  useEffect(() => {
    if (!isMarketOpen || marketLoaded || busyAction === 'market-refresh') {
      return;
    }
    void (async () => {
      try {
        setBusyAction('market-refresh');
        await refreshMarket();
      } catch (error) {
        setMarketError(formatError(error, '插件市场载入失败'));
      } finally {
        setBusyAction(null);
      }
    })();
  }, [busyAction, isMarketOpen, marketLoaded, refreshMarket]);

  useEffect(() => {
    void refreshLogs(selectedPlugin?.id).catch(() => undefined);
  }, [refreshLogs, selectedPlugin?.id]);

  useEffect(() => {
    if (!pluginsApi || !selectedPlugin) {
      setSettingsDraft({});
      return;
    }
    setSettingsDraft(selectedPlugin.settingsValues ?? {});
    void pluginsApi.getSettings?.(selectedPlugin.id)
      .then((result) => setSettingsDraft(result.values))
      .catch(() => undefined);
  }, [pluginsApi, selectedPlugin]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>, success: string): Promise<void> => {
      try {
        setBusyAction(key);
        setMessage(null);
        await action();
        setMessage(success);
        await refresh();
        window.dispatchEvent(new Event('plugins:changed'));
        await refreshLogs(selectedPlugin?.id);
      } catch (error) {
        setMessage(formatError(error, t('fallback.error')));
      } finally {
        setBusyAction(null);
      }
    },
    [refresh, refreshLogs, selectedPlugin?.id, t],
  );

  const importPackage = useCallback((source?: File): void => {
    if (!pluginsApi) {
      return;
    }
    void (async () => {
      try {
        setBusyAction('import-package');
        setMessage(null);
        const result = await pluginsApi.importPackage(source);
        if (!result) {
          setMessage(t('message.cancelledImport'));
          return;
        }
        try {
          await pluginsApi.enable({ pluginId: result.pluginId, trustedPermissions: [] });
        } catch {
          // Permissioned plugins still need the normal review flow after import.
        }
        setSelectedPluginId(result.pluginId);
        setMessage(t('message.imported', { pluginId: result.pluginId }));
        await refresh();
        window.dispatchEvent(new Event('plugins:changed'));
        await refreshLogs(result.pluginId);
      } catch (error) {
        setMessage(formatError(error, t('fallback.error')));
      } finally {
        setBusyAction(null);
      }
    })();
  }, [pluginsApi, refresh, refreshLogs, t]);

  const handleImportPackage = (): void => {
    importPackage();
  };

  const handleRefreshMarket = (): void => {
    if (!pluginsApi?.listMarket) {
      return;
    }
    void (async () => {
      try {
        setBusyAction('market-refresh');
        setMarketError(null);
        await refreshMarket();
      } catch (error) {
        setMarketError(formatError(error, '插件市场载入失败'));
      } finally {
        setBusyAction(null);
      }
    })();
  };

  const handleInstallMarketPlugin = (marketPlugin: PluginMarketEntry): void => {
    if (!pluginsApi?.installMarket) {
      return;
    }
    void (async () => {
      try {
        setBusyAction(`market-install:${marketPlugin.id}`);
        setMessage(null);
        const result = await pluginsApi.installMarket(marketPlugin.id);
        try {
          await pluginsApi.enable({ pluginId: result.pluginId, trustedPermissions: [] });
        } catch {
          // Permissioned plugins still need the normal review flow after install.
        }
        setSelectedPluginId(result.pluginId);
        setMessage(`已从插件市场载入 ${result.pluginId}`);
        await refresh();
        window.dispatchEvent(new Event('plugins:changed'));
        await refreshLogs(result.pluginId);
      } catch (error) {
        setMessage(formatError(error, t('fallback.error')));
      } finally {
        setBusyAction(null);
      }
    })();
  };

  const handlePackageDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!firstEchoPackageFile(event.dataTransfer.files) && !hasFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = busyAction === 'import-package' ? 'none' : 'copy';
    setIsPackageDragging(true);
  }, [busyAction]);

  const handlePackageDragLeave = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsPackageDragging(false);
  }, []);

  const handlePackageDrop = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!firstEchoPackageFile(event.dataTransfer.files) && !hasFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsPackageDragging(false);

    if (busyAction === 'import-package') {
      return;
    }

    const file = firstEchoPackageFile(event.dataTransfer.files);
    if (!file) {
      setMessage(t('message.invalidDrop'));
      return;
    }

    importPackage(file);
  }, [busyAction, importPackage, t]);

  const handleExportPackage = (plugin: PluginSummary): void => {
    if (!pluginsApi) {
      return;
    }
    void (async () => {
      try {
        setBusyAction(`export:${plugin.id}`);
        setMessage(null);
        const target = await pluginsApi.exportPackage(plugin.id);
        setMessage(target ? t('message.exported', { target }) : t('message.cancelledExport'));
        await refreshLogs(plugin.id);
      } catch (error) {
        setMessage(formatError(error, t('fallback.error')));
      } finally {
        setBusyAction(null);
      }
    })();
  };

  const handleDeletePlugin = (plugin: PluginSummary): void => {
    if (!pluginsApi?.delete) {
      return;
    }
    const confirmed = window.confirm(t('confirm.delete', { name: plugin.name, directory: plugin.directory }));
    if (!confirmed) {
      return;
    }
    void runAction(
      `delete:${plugin.id}`,
      () => pluginsApi.delete(plugin.id),
      t('message.deleted', { name: plugin.name }),
    );
  };

  const handleEnable = (plugin: PluginSummary): void => {
    if (!pluginsApi) {
      return;
    }
    const permissionText = plugin.permissions.length
      ? plugin.permissions.map((permission) => formatPermissionForConfirm(permission, t)).join('\n')
      : t('permissions.none');
    const highRiskText = plugin.security.highRiskPermissions.length > 0
      ? t('confirm.enable.highRisk')
      : '';
    const reservedText = plugin.security.reservedPermissions.length > 0 || plugin.security.limitedPermissions.length > 0
      ? t('confirm.enable.reserved')
      : '';
    const confirmed = window.confirm(t('confirm.enable', { name: plugin.name, permissions: permissionText, highRisk: highRiskText, reserved: reservedText }));
    if (!confirmed) {
      return;
    }
    void runAction(
      `enable:${plugin.id}`,
      () => pluginsApi.enable({ pluginId: plugin.id, trustedPermissions: plugin.permissions }),
      t('message.enabled', { name: plugin.name }),
    );
  };

  const handleCreateExample = (kind: PluginCreateExampleKind): void => {
    if (!pluginsApi) {
      return;
    }
    void runAction(`example:${kind}`, () => pluginsApi.createExample(kind), t('message.createdExample'));
  };

  const handleRunCommand = (plugin: PluginSummary, commandId: string): void => {
    if (!pluginsApi) {
      return;
    }
    void runAction(
      `command:${plugin.id}:${commandId}`,
      () => pluginsApi.runCommand({ pluginId: plugin.id, commandId }),
      t('message.commandRan'),
    );
  };

  const handleSavePluginSettings = (plugin: PluginSummary): void => {
    if (!pluginsApi?.setSettings) {
      return;
    }
    void runAction(
      `settings:${plugin.id}`,
      async () => {
        const result = await pluginsApi.setSettings(plugin.id, settingsDraft);
        setSettingsDraft(result.values);
      },
      t('message.settingsSaved'),
    );
  };

  if (!pluginsApi) {
    return (
      <div className="page-stack plugins-page">
        <EmptyState icon={Code2} title={t('empty.unavailable.title')} description={t('empty.unavailable.description')} />
      </div>
    );
  }

  return (
    <div
      className="page-stack plugins-page"
      data-package-dragging={isPackageDragging ? 'true' : 'false'}
      onDragLeave={handlePackageDragLeave}
      onDragOver={handlePackageDragOver}
      onDrop={handlePackageDrop}
    >
      <header className="plain-page-header plugins-header">
        <div>
          <span className="section-kicker">{t('header.kicker')}</span>
          <h1>{t('header.title')}</h1>
          <p>{t('header.description')}</p>
          {pluginDirectory ? <small title={pluginDirectory}>{pluginDirectory}</small> : null}
        </div>
        <div className="plugins-header-actions">
          <button className="settings-action-button" type="button" onClick={() => setIsCommandPaletteOpen(true)}>
            <TerminalSquare size={16} />
            {t('action.openCommandPalette')}
          </button>
          <button className="settings-action-button" type="button" onClick={() => void pluginsApi.openDirectory()}>
            <FolderOpen size={16} />
            {t('action.openPluginDirectory')}
          </button>
          <button className="settings-action-button" type="button" disabled={busyAction === 'import-package'} onClick={handleImportPackage}>
            <Upload size={16} />
            {t('action.importPackage')}
          </button>
          <button className="settings-action-button" type="button" disabled={busyAction === 'refresh'} onClick={() => void runAction('refresh', refresh, t('message.refreshed'))}>
            <RefreshCw size={16} />
            {t('action.refresh')}
          </button>
        </div>
      </header>

      {isPackageDragging ? (
        <div className="plugins-drop-overlay" aria-hidden="true">
          <Upload size={26} />
          <strong>{t('overlay.dropPackage')}</strong>
        </div>
      ) : null}

      <section className="plugin-market-panel" data-open={isMarketOpen ? 'true' : 'false'}>
        <button
          className="plugin-market-toggle"
          type="button"
          aria-expanded={isMarketOpen}
          onClick={() => setIsMarketOpen((current) => !current)}
        >
          <span>
            <ShoppingBag size={18} />
            <strong>插件市场</strong>
            <em>Pro Only · 展开后验证 Pro 并读取服务端插件</em>
          </span>
          <ChevronDown size={18} />
        </button>
        {isMarketOpen ? (
          <div className="plugin-market-body">
            <div className="plugin-market-actions">
              <span>把 .echo 插件包放到服务端市场目录后，这里会自动读取最新清单。</span>
              <button className="settings-action-button" type="button" disabled={busyAction === 'market-refresh'} onClick={handleRefreshMarket}>
                <RefreshCw size={16} />
                {t('action.refresh')}
              </button>
            </div>
            {marketError ? <p className="plugins-message plugins-message--error">{marketError}</p> : null}
            {busyAction === 'market-refresh' && !marketLoaded ? <p className="plugins-message">正在载入插件市场...</p> : null}
            {marketLoaded && marketPlugins.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="市场暂无插件" description="服务端市场目录里还没有可读取的 .echo 插件包。" />
            ) : null}
            {marketPlugins.length > 0 ? (
              <div className="plugin-market-grid">
                {marketPlugins.map((marketPlugin) => {
                  const installedVersion = installedPluginVersions.get(marketPlugin.id);
                  const isBusy = busyAction === `market-install:${marketPlugin.id}`;
                  return (
                    <article className="plugin-market-card" key={marketPlugin.id}>
                      <div>
                        <strong>{marketPlugin.name}</strong>
                        <em>{marketPlugin.id} · v{marketPlugin.version} · API v{marketPlugin.apiVersion}</em>
                        {marketPlugin.description ? <span>{marketPlugin.description}</span> : null}
                        {installedVersion ? <small>已安装 v{installedVersion}</small> : null}
                      </div>
                      <button className="settings-action-button" type="button" disabled={isBusy} onClick={() => handleInstallMarketPlugin(marketPlugin)}>
                        <Download size={16} />
                        {installedVersion ? '更新' : '安装'}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="plugin-example-grid" aria-label={t('section.examples')}>
        {exampleTextKeys.map((example) => (
          <article className="plugin-example-card" key={example.kind}>
            <PackagePlus size={18} />
            <div>
              <strong>{t(example.labelKey)}</strong>
              <span>{t(example.descriptionKey)}</span>
            </div>
            <button className="settings-action-button" type="button" disabled={busyAction === `example:${example.kind}`} onClick={() => handleCreateExample(example.kind)}>
              {t('action.create')}
            </button>
          </article>
        ))}
      </section>

      {message ? <p className="plugins-message">{message}</p> : null}

      <main className="plugins-layout">
        <section className="plugins-list" aria-label={t('section.pluginList')}>
          {plugins.length === 0 ? (
            <EmptyState icon={Code2} title={t('empty.noPlugins.title')} description={t('empty.noPlugins.description')}>
              <button className="settings-action-button" type="button" disabled={busyAction === 'import-package'} onClick={handleImportPackage}>
                <Upload size={15} />
                {t('action.importEchoPackage')}
              </button>
              <button className="settings-action-button" type="button" disabled={busyAction === 'example:playback-panel'} onClick={() => handleCreateExample('playback-panel')}>
                <PackagePlus size={15} />
                {t('action.createExamplePlugin')}
              </button>
            </EmptyState>
          ) : (
            plugins.map((plugin) => (
              <button
                className="plugin-list-item"
                type="button"
                key={plugin.id}
                data-active={selectedPlugin?.id === plugin.id}
                onClick={() => setSelectedPluginId(plugin.id)}
              >
                <span>
                  <strong>{plugin.name}</strong>
                  <em>{plugin.id}</em>
                </span>
                <StatusPill plugin={plugin} t={t} />
              </button>
            ))
          )}
        </section>

        <section className="plugin-detail" aria-label={t('section.pluginDetail')}>
          {selectedPlugin ? (
            <>
              <div className="plugin-detail-head">
                <div>
                  <h2>{selectedPlugin.name}</h2>
                  <p>{selectedPlugin.id} · v{selectedPlugin.version}</p>
                </div>
                <StatusPill plugin={selectedPlugin} t={t} />
              </div>

              {selectedPlugin.error ? (
                <p className="plugins-message plugins-message--error">
                  {isEchoProMachineMismatch(selectedPlugin) ? t('error.echoProMachineMismatch') : selectedPlugin.error}
                </p>
              ) : null}
              {selectedPlugin.disabledByHost && !isEchoProMachineMismatch(selectedPlugin) ? (
                <p className="plugins-message plugins-message--error">{t('error.disabledByHost')}</p>
              ) : null}
              {selectedPlugin.echoProLicense ? (
                <section className="plugin-activity-panel">
                  <header>
                    <LockKeyhole size={17} />
                    <strong>ECHO Pro 授权信息</strong>
                  </header>
                  <div className="settings-status-grid">
                    <span>
                      <em>QQ号</em>
                      <strong>{selectedPlugin.echoProLicense.qq ?? '未知'}</strong>
                    </span>
                    <span>
                      <em>License</em>
                      <strong>{selectedPlugin.echoProLicense.licenseId ?? '未知'}</strong>
                    </span>
                    <span>
                      <em>Activation</em>
                      <strong>{selectedPlugin.echoProLicense.activationId ?? '未知'}</strong>
                    </span>
                    <span>
                      <em>状态</em>
                      <strong>{selectedPlugin.echoProLicense.valid ? '本地有效' : '需要授权/本地无效'}</strong>
                    </span>
                    <span>
                      <em>签发时间</em>
                      <strong>{formatPluginTime(selectedPlugin.echoProLicense.issuedAt, t)}</strong>
                    </span>
                    <span>
                      <em>到期时间</em>
                      <strong>{formatPluginTime(selectedPlugin.echoProLicense.expiresAt, t)}</strong>
                    </span>
                  </div>
                </section>
              ) : null}

              <SecurityOverview plugin={selectedPlugin} t={t} />
              <ActivityOverview plugin={selectedPlugin} t={t} />

              {selectedPlugin.contributes.settings && selectedPlugin.contributes.settings.length > 0 ? (
                <section className="plugin-activity-panel">
                  <header>
                    <Code2 size={17} />
                    <strong>{t('label.pluginSettings')}</strong>
                  </header>
                  <div className="plugin-settings-list">
                    {selectedPlugin.contributes.settings.map((setting) => {
                      const value = settingsDraft[setting.id] ?? setting.defaultValue ?? (setting.type === 'boolean' ? false : '');
                      return (
                        <label className="plugin-setting-row" key={setting.id}>
                          <span>
                            <strong>{setting.title}</strong>
                            <em>{setting.description ?? setting.id}</em>
                          </span>
                          {setting.type === 'boolean' ? (
                            <input
                              type="checkbox"
                              checked={value === true}
                              onChange={(event) => setSettingsDraft((current) => ({ ...current, [setting.id]: event.target.checked }))}
                            />
                          ) : setting.type === 'select' ? (
                            <select
                              value={typeof value === 'string' ? value : ''}
                              onChange={(event) => setSettingsDraft((current) => ({ ...current, [setting.id]: event.target.value }))}
                            >
                              {(setting.options ?? []).map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={setting.type === 'number' ? 'number' : setting.type === 'secret' ? 'password' : 'text'}
                              min={setting.min}
                              max={setting.max}
                              placeholder={setting.placeholder}
                              value={typeof value === 'number' || typeof value === 'string' ? value : ''}
                              onChange={(event) => setSettingsDraft((current) => ({
                                ...current,
                                [setting.id]: setting.type === 'number' ? Number(event.target.value) : event.target.value,
                              }))}
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <button className="settings-action-button" type="button" disabled={busyAction === `settings:${selectedPlugin.id}`} onClick={() => handleSavePluginSettings(selectedPlugin)}>
                    {t('action.saveSettings')}
                  </button>
                </section>
              ) : null}

              <div className="plugin-actions">
                {selectedPlugin.enabled ? (
                  <button className="settings-action-button" type="button" disabled={busyAction === `disable:${selectedPlugin.id}`} onClick={() => void runAction(`disable:${selectedPlugin.id}`, () => pluginsApi.disable(selectedPlugin.id), t('message.disabled', { name: selectedPlugin.name }))}>
                    <Power size={16} />
                    {t('action.disable')}
                  </button>
                ) : (
                  <button className="settings-action-button" type="button" disabled={Boolean(selectedPlugin.error && !selectedPlugin.disabledByHost) || busyAction === `enable:${selectedPlugin.id}`} onClick={() => handleEnable(selectedPlugin)}>
                    <Power size={16} />
                    {t('action.enable')}
                  </button>
                )}
                <button className="settings-action-button" type="button" disabled={busyAction === `reload:${selectedPlugin.id}`} onClick={() => void runAction(`reload:${selectedPlugin.id}`, () => pluginsApi.reload(selectedPlugin.id), t('message.reloaded', { name: selectedPlugin.name }))}>
                  <RefreshCw size={16} />
                  {t('action.reload')}
                </button>
                <button className="settings-action-button" type="button" onClick={() => void pluginsApi.openDirectory(selectedPlugin.id)}>
                  <FolderOpen size={16} />
                  {t('action.openDirectory')}
                </button>
                <button className="settings-action-button" type="button" disabled={busyAction === `export:${selectedPlugin.id}`} onClick={() => handleExportPackage(selectedPlugin)}>
                  <Download size={16} />
                  {t('action.exportPackage')}
                </button>
                <button className="settings-danger-button" type="button" disabled={busyAction === `delete:${selectedPlugin.id}`} onClick={() => handleDeletePlugin(selectedPlugin)}>
                  <Trash2 size={16} />
                  {t('action.delete')}
                </button>
              </div>

              <div className="plugin-command-list">
                <header>
                  <TerminalSquare size={17} />
                  <strong>{t('section.commands')}</strong>
                </header>
                {selectedPlugin.commands.length === 0 ? (
                  <span>{t('section.commands.empty')}</span>
                ) : (
                  selectedPlugin.commands.map((command) => (
                    <button
                      className="plugin-command-row"
                      type="button"
                      key={`${command.pluginId}:${command.id}`}
                      disabled={!selectedPlugin.enabled || busyAction === `command:${selectedPlugin.id}:${command.id}`}
                      onClick={() => handleRunCommand(selectedPlugin, command.id)}
                    >
                      <Play size={15} />
                      <span>
                        <strong>{command.title}</strong>
                        <em>{command.description ?? command.id}</em>
                      </span>
                    </button>
                  ))
                )}
              </div>

              {selectedPlugin.panel ? (
                <div className="plugin-panel-preview">
                  <header>
                    <Code2 size={17} />
                    <strong>{t('section.panelPreview')}</strong>
                  </header>
                  <PluginPanelFrame
                    plugin={selectedPlugin}
                    panelPath={selectedPlugin.panel}
                    title={t('label.panelTitle', { name: selectedPlugin.name })}
                    onCommandComplete={async () => {
                      await refresh();
                      await refreshLogs(selectedPlugin.id);
                    }}
                  />
                </div>
              ) : null}

              <div className="plugin-log-list">
                <header>
                  <ScrollText size={17} />
                  <strong>{t('section.logs')}</strong>
                  <button className="settings-action-button" type="button" onClick={() => void refreshLogs(selectedPlugin.id)}>
                    {t('action.refreshLogs')}
                  </button>
                </header>
                {logs.length === 0 ? (
                  <span>{t('label.noLogs')}</span>
                ) : (
                  logs.map((log) => (
                    <p key={log.id} data-level={log.level}>
                      <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
                      <strong>{log.level}</strong>
                      <span>{log.message}</span>
                    </p>
                  ))
                )}
              </div>
            </>
          ) : (
            <EmptyState icon={Code2} title={t('empty.noSelection.title')} description={t('empty.noSelection.description')} />
          )}
        </section>
      </main>
      <PluginCommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
      />
    </div>
  );
};
