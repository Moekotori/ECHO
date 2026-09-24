import type { Locale } from '../../i18n/locales';

export const settingsSubsectionCopy = {
  generalPerformance: {
    title: { 'zh-CN': '性能与资源占用', 'zh-TW': '效能與資源佔用', 'ja-JP': '性能とリソース使用量', 'en-US': 'Performance And Resource Usage', 'ko-KR': '성능 및 리소스 사용' },
    description: { 'zh-CN': '为低配置设备提供安全、可恢复的一键降载。', 'zh-TW': '為低配置裝置提供安全、可還原的一鍵降載。', 'ja-JP': '低スペック端末向けに、安全で元に戻せる負荷軽減を提供します。', 'en-US': 'A safe, reversible one-click load reduction for lower-end devices.', 'ko-KR': '저사양 기기를 위한 안전하고 되돌릴 수 있는 원클릭 부하 감소.' },
  },
  generalBasics: {
    title: { 'zh-CN': '语言、引导与 Pro', 'zh-TW': '語言、引導與 Pro', 'ja-JP': '言語、ガイド、Pro', 'en-US': 'Language, Guide, Pro', 'ko-KR': '언어, 가이드, Pro' },
    description: { 'zh-CN': '首次使用和激活入口放在最前面。', 'zh-TW': '首次使用和啟用入口放在最前面。', 'ja-JP': '初回ガイドと Pro の入口を先頭にまとめます。', 'en-US': 'First-run and Pro entry points stay up front.', 'ko-KR': '최초 실행과 Pro 진입점을 맨 앞에 둡니다.' },
  },
  generalWindow: {
    title: { 'zh-CN': '窗口与启动', 'zh-TW': '視窗與啟動', 'ja-JP': 'ウィンドウと起動', 'en-US': 'Window And Startup', 'ko-KR': '창 및 시작' },
  },
  generalFeatures: {
    title: { 'zh-CN': '功能入口', 'zh-TW': '功能入口', 'ja-JP': '機能入口', 'en-US': 'Feature Entry Points', 'ko-KR': '기능 진입점' },
  },
  generalAdvancedCustom: {
    title: { 'zh-CN': '高级自定义', 'zh-TW': '進階自訂', 'ja-JP': '高度なカスタマイズ', 'en-US': 'Advanced Customization', 'ko-KR': '고급 사용자 지정' },
    description: {
    'zh-CN': '低频使用、调试取向或会改变界面密度的开关集中放在这里。',
    'zh-TW': '低頻使用、偏調試或會改變介面密度的開關集中放在這裡。',
    'ja-JP': '使用頻度が低い項目、調整向けの項目、画面密度を変える項目をここにまとめます。',
    'en-US': 'Low-frequency, tuning-oriented, or interface-density switches are grouped here.',
    'ko-KR': 'Low-frequency, tuning-oriented, or interface-density switches are grouped here.',
  },
  },
  experimentalVisual: {
    title: { 'zh-CN': '窗口与视觉', 'zh-TW': '視窗與視覺', 'ja-JP': 'ウィンドウと表示', 'en-US': 'Window And Visuals', 'ko-KR': '창 및 시각 효과' },
  },
  experimentalPerformance: {
    title: { 'zh-CN': '性能与播放', 'zh-TW': '效能與播放', 'ja-JP': '性能と再生', 'en-US': 'Performance And Playback', 'ko-KR': '성능 및 재생' },
  },
  experimentalFeatures: {
    title: { 'zh-CN': '试验性功能', 'zh-TW': '試驗性功能', 'ja-JP': '実験機能', 'en-US': 'Experimental Features', 'ko-KR': '실험 기능' },
  },
  advancedInterface: {
    title: { 'zh-CN': '界面与操作密度', 'zh-TW': '介面與操作密度', 'ja-JP': '画面と操作密度', 'en-US': 'Interface And Interaction Density', 'ko-KR': '인터페이스 및 조작 밀도' },
  },
  advancedPerformance: {
    title: { 'zh-CN': '扫描与资源策略', 'zh-TW': '掃描與資源策略', 'ja-JP': 'スキャンとリソース方針', 'en-US': 'Scan And Resource Strategy', 'ko-KR': '스캔 및 리소스 전략' },
  },
  advancedVisuals: {
    title: { 'zh-CN': '窗口、可视化与图形保护', 'zh-TW': '視窗、視覺化與圖形保護', 'ja-JP': 'ウィンドウ、可視化、描画保護', 'en-US': 'Window, Visuals, And Graphics Protection', 'ko-KR': '창, 시각 효과 및 그래픽 보호' },
  },
  advancedFeedback: {
    title: { 'zh-CN': '通知、提示与启动', 'zh-TW': '通知、提示與啟動', 'ja-JP': '通知、案内、起動', 'en-US': 'Notifications, Guidance, And Startup', 'ko-KR': '알림, 안내 및 시작' },
  },
  advancedSafety: {
    title: { 'zh-CN': '数据保护与分析功能', 'zh-TW': '資料保護與分析功能', 'ja-JP': 'データ保護と解析機能', 'en-US': 'Data Protection And Analysis', 'ko-KR': '데이터 보호 및 분석' },
  },
  generalData: {
    title: { 'zh-CN': '数据与备份', 'zh-TW': '資料與備份', 'ja-JP': 'データとバックアップ', 'en-US': 'Data And Backups', 'ko-KR': '데이터 및 백업' },
  },
  playbackOutput: {
    title: { 'zh-CN': '快速设置与输出设备', 'zh-TW': '快速設定與輸出裝置', 'ja-JP': 'クイック設定と出力デバイス', 'en-US': 'Quick Setup And Output Devices', 'ko-KR': '빠른 설정 및 출력 장치' },
    description: { 'zh-CN': '选择输出模式、后端和设备，并提供无声问题的快速入口。', 'zh-TW': '選擇輸出模式、後端和裝置，並提供無聲問題的快速入口。', 'ja-JP': '出力モード、バックエンド、デバイスを選び、無音問題をすばやく確認します。', 'en-US': 'Choose the output mode, backend, and device, with quick access to no-sound help.', 'ko-KR': '출력 모드, 백엔드, 장치를 선택하고 무음 문제 도움말로 빠르게 이동할 수 있습니다.' },
  },
  playbackPerformance: {
    title: { 'zh-CN': '性能与低负载策略', 'zh-TW': '效能與低負載策略', 'ja-JP': '性能と低負荷設定', 'en-US': 'Performance And Low-Load Strategy', 'ko-KR': '성능 및 저부하 전략' },
  },
  playbackMore: {
    title: { 'zh-CN': '更多播放设置', 'zh-TW': '更多播放設定', 'ja-JP': 'その他の再生設定', 'en-US': 'More Playback Settings', 'ko-KR': '추가 재생 설정' },
    description: { 'zh-CN': '故障恢复、兼容性和精细播放控制默认收起。', 'zh-TW': '故障復原、相容性和精細播放控制預設收合。', 'ja-JP': '復旧、互換性、詳細な再生制御は既定で折りたたまれます。', 'en-US': 'Recovery, compatibility, and fine playback controls stay collapsed by default.', 'ko-KR': '복구, 호환성, 세부 재생 제어는 기본적으로 접혀 있습니다.' },
  },
  playbackRecovery: {
    title: { 'zh-CN': '故障恢复', 'zh-TW': '故障復原', 'ja-JP': 'トラブル復旧', 'en-US': 'Troubleshooting And Recovery', 'ko-KR': '문제 해결 및 복구' },
    description: { 'zh-CN': '重置音频引擎、重启系统音频服务并记录异常。', 'zh-TW': '重設音訊引擎、重新啟動系統音訊服務並記錄異常。', 'ja-JP': 'オーディオエンジンやシステム音声を復旧し、問題を記録します。', 'en-US': 'Recover the audio engine or system service and capture issue diagnostics.', 'ko-KR': '오디오 엔진·시스템 서비스를 복구하고 문제 진단을 기록합니다.' },
  },
  playbackCompatibility: {
    title: { 'zh-CN': '格式与设备兼容性', 'zh-TW': '格式與裝置相容性', 'ja-JP': '形式とデバイス互換性', 'en-US': 'Format And Device Compatibility', 'ko-KR': '형식 및 장치 호환성' },
  },
  playbackControls: {
    title: { 'zh-CN': '速度、音量与导出', 'zh-TW': '速度、音量與匯出', 'ja-JP': '速度、音量、書き出し', 'en-US': 'Speed, Volume, And Export', 'ko-KR': 'Speed, Volume, And Export' },
  },
  playbackInterface: {
    title: { 'zh-CN': '迷你播放器', 'zh-TW': '迷你播放器', 'ja-JP': 'ミニプレーヤー', 'en-US': 'Mini Player', 'ko-KR': 'Mini Player' },
  },
  playbackTransitions: {
    title: { 'zh-CN': '队列衔接与播放顺序', 'zh-TW': '佇列銜接與播放順序', 'ja-JP': 'キュー遷移と再生順序', 'en-US': 'Queue Transitions And Play Order', 'ko-KR': 'Queue Transitions And Play Order' },
    description: { 'zh-CN': '管理区间循环、智能过渡、无缝播放和随机策略。', 'zh-TW': '管理區間循環、智慧過渡、無縫播放和隨機策略。', 'ja-JP': '区間リピート、スマートトランジション、ギャップレス、シャッフル方針を管理します。', 'en-US': 'Manage segment loops, Smart Transition, gapless playback, and shuffle behavior.', 'ko-KR': 'Manage segment loops, Smart Transition, gapless playback, and shuffle behavior.' },
  },
  playbackLoudness: {
    title: { 'zh-CN': '响度与声道', 'zh-TW': '響度與聲道', 'ja-JP': 'ラウドネスとチャンネル', 'en-US': 'Loudness And Channels', 'ko-KR': 'Loudness And Channels' },
  },
  playbackDiagnostics: {
    title: { 'zh-CN': '当前音频状态', 'zh-TW': '目前音訊狀態', 'ja-JP': '現在のオーディオ状態', 'en-US': 'Current Audio Status', 'ko-KR': '현재 오디오 상태' },
  },
  shortcutsMain: {
    title: { 'zh-CN': '快捷键方案', 'zh-TW': '快捷鍵方案', 'ja-JP': 'ショートカット設定', 'en-US': 'Shortcut Profiles', 'ko-KR': '단축키 프로필' },
  },
  shortcutsBindings: {
    title: { 'zh-CN': '功能按键绑定', 'zh-TW': '功能按鍵綁定', 'ja-JP': '機能キーの割り当て', 'en-US': 'Function Key Bindings', 'ko-KR': '기능 키 바인딩' },
    description: { 'zh-CN': '分别设置应用内快捷键和系统级全局快捷键。', 'zh-TW': '分別設定應用程式內快捷鍵和系統級全域快捷鍵。', 'ja-JP': 'アプリ内とシステム全体のショートカットを個別に設定します。', 'en-US': 'Configure in-app and system-wide shortcuts separately.', 'ko-KR': '앱 내부와 시스템 전역 단축키를 각각 설정합니다.' },
  },
  lyricsMain: {
    title: { 'zh-CN': '歌词显示与行为', 'zh-TW': '歌詞顯示與行為', 'ja-JP': '歌詞表示と動作', 'en-US': 'Lyrics Display And Behavior', 'ko-KR': '가사 표시 및 동작' },
  },
  mvOverview: {
    title: { 'zh-CN': 'MV 基础体验', 'zh-TW': 'MV 基礎體驗', 'ja-JP': 'MV 基本体験', 'en-US': 'MV Basics', 'ko-KR': 'MV 기본' },
  },
  mvNetwork: {
    title: { 'zh-CN': '网络匹配与沉浸背景', 'zh-TW': '網路匹配與沉浸背景', 'ja-JP': 'ネットワーク照合と没入背景', 'en-US': 'Network Match And Immersive Background', 'ko-KR': '네트워크 매칭 및 몰입형 배경' },
  },
  integrationsNetwork: {
    title: { 'zh-CN': '网络代理', 'zh-TW': '網路代理', 'ja-JP': 'ネットワークプロキシ', 'en-US': 'Network Proxy', 'ko-KR': '네트워크 프록시' },
  },
  integrationsAdvanced: {
    title: { 'zh-CN': '高级账号与凭据', 'zh-TW': '進階帳號與憑證', 'ja-JP': '詳細なアカウントと認証情報', 'en-US': 'Advanced Accounts And Credentials', 'ko-KR': '고급 계정 및 자격 증명' },
    description: { 'zh-CN': '第三方密钥、开发者应用和服务登录默认收起。', 'zh-TW': '第三方金鑰、開發者應用程式和服務登入預設收合。', 'ja-JP': '外部キー、開発者アプリ、サービスログインは既定で折りたたまれます。', 'en-US': 'Third-party keys, developer apps, and service sign-ins stay collapsed by default.', 'ko-KR': '타사 키, 개발자 앱, 서비스 로그인은 기본적으로 접혀 있습니다.' },
  },
  integrationsMetadata: {
    title: { 'zh-CN': '在线专辑与艺术家资料', 'zh-TW': '線上專輯與藝人資料', 'ja-JP': 'オンラインのアルバムとアーティスト情報', 'en-US': 'Online Album And Artist Metadata', 'ko-KR': '온라인 앨범 및 아티스트 메타데이터' },
  },
  integrationsExternal: {
    title: { 'zh-CN': '状态展示与直播输出', 'zh-TW': '狀態展示與直播輸出', 'ja-JP': 'ステータス表示と配信出力', 'en-US': 'Presence And Broadcast Output', 'ko-KR': '상태 표시 및 방송 출력' },
    description: { 'zh-CN': '将播放状态发送到 Discord、OBS 或舞台接口。', 'zh-TW': '將播放狀態傳送到 Discord、OBS 或舞台介面。', 'ja-JP': '再生状態を Discord、OBS、ステージ API に送信します。', 'en-US': 'Send playback state to Discord, OBS, or the stage API.', 'ko-KR': '재생 상태를 Discord, OBS 또는 스테이지 API로 보냅니다.' },
  },
  integrationsWindows: {
    title: { 'zh-CN': 'Windows 媒体与任务栏', 'zh-TW': 'Windows 媒體與工作列', 'ja-JP': 'Windows メディアとタスクバー', 'en-US': 'Windows Media And Taskbar', 'ko-KR': 'Windows 미디어 및 작업 표시줄' },
  },
  integrationsLastFm: {
    title: { 'zh-CN': 'Last.fm 记录', 'zh-TW': 'Last.fm 記錄', 'ja-JP': 'Last.fm 記録', 'en-US': 'Last.fm Scrobbling', 'ko-KR': 'Last.fm 스크로블' },
  },
  integrationsAutomation: {
    title: { 'zh-CN': '账号启动行为', 'zh-TW': '帳號啟動行為', 'ja-JP': 'アカウント起動動作', 'en-US': 'Account Startup Behavior', 'ko-KR': '계정 시작 동작' },
  },
  integrationsAccounts: {
    title: { 'zh-CN': '开发者应用凭据', 'zh-TW': '開發者應用程式憑證', 'ja-JP': '開発者アプリ認証情報', 'en-US': 'Developer App Credentials', 'ko-KR': '개발자 앱 자격 증명' },
  },
  integrationsServiceAccounts: {
    title: { 'zh-CN': '音乐服务账号', 'zh-TW': '音樂服務帳號', 'ja-JP': '音楽サービスアカウント', 'en-US': 'Music Service Accounts', 'ko-KR': '음악 서비스 계정' },
  },
  integrationsMobile: {
    title: { 'zh-CN': '移动设备联动', 'zh-TW': '行動裝置聯動', 'ja-JP': 'モバイルデバイス連携', 'en-US': 'Mobile Device Integration', 'ko-KR': '모바일 기기 연동' },
  },
  pluginsLocal: {
    title: { 'zh-CN': '运行状态与安全边界', 'zh-TW': '執行狀態與安全邊界', 'ja-JP': '実行状態と安全境界', 'en-US': 'Runtime Status And Safety Boundaries', 'ko-KR': '런타임 상태 및 안전 경계' },
  },
  pluginsTools: {
    title: { 'zh-CN': '管理与开发工具', 'zh-TW': '管理與開發工具', 'ja-JP': '管理と開発ツール', 'en-US': 'Management And Developer Tools', 'ko-KR': '관리 및 개발 도구' },
  },
  remoteSources: {
    title: { 'zh-CN': '远程音乐源', 'zh-TW': '遠端音樂來源', 'ja-JP': 'リモート音楽ソース', 'en-US': 'Remote Music Sources', 'ko-KR': '원격 음악 소스' },
  },
  eqWorkbench: {
    title: { 'zh-CN': '音效处理入口', 'zh-TW': '音效處理入口', 'ja-JP': '音響処理入口', 'en-US': 'Audio Processing Entry', 'ko-KR': '오디오 처리 진입점' },
  },
  appearanceTheme: {
    title: { 'zh-CN': '主题与布局', 'zh-TW': '主題與佈局', 'ja-JP': 'テーマとレイアウト', 'en-US': 'Theme And Layout', 'ko-KR': '테마 및 레이아웃' },
  },
  appearanceWindow: {
    title: { 'zh-CN': '播放栏', 'zh-TW': '播放列', 'ja-JP': 'プレイヤーバー', 'en-US': 'Player Bar', 'ko-KR': '플레이어 바' },
  },
  appearanceWallpaper: {
    title: { 'zh-CN': '背景与封面', 'zh-TW': '背景與封面', 'ja-JP': '背景とカバー', 'en-US': 'Wallpaper And Covers', 'ko-KR': '배경화면 및 커버' },
  },
  libraryImport: {
    title: { 'zh-CN': '导入与扫描', 'zh-TW': '匯入與掃描', 'ja-JP': '取り込みとスキャン', 'en-US': 'Import And Scan', 'ko-KR': '가져오기 및 스캔' },
  },
  libraryQuality: {
    title: { 'zh-CN': '质量、补全与健康', 'zh-TW': '品質、補全與健康', 'ja-JP': '品質、補完、ヘルス', 'en-US': 'Quality, Backfill, Health', 'ko-KR': '품질, 보완, 상태' },
  },
  libraryMaintenance: {
    title: { 'zh-CN': '整理与缓存', 'zh-TW': '整理與快取', 'ja-JP': '整理とキャッシュ', 'en-US': 'Organization And Cache', 'ko-KR': '정리 및 캐시' },
  },
  libraryMetadata: {
    title: { 'zh-CN': '网络元数据', 'zh-TW': '網路中繼資料', 'ja-JP': 'ネットワークメタデータ', 'en-US': 'Network Metadata', 'ko-KR': '네트워크 메타데이터' },
  },
  aboutVersion: {
    title: { 'zh-CN': '版本与更新', 'zh-TW': '版本與更新', 'ja-JP': 'バージョンと更新', 'en-US': 'Version And Updates', 'ko-KR': '버전 및 업데이트' },
  },
  aboutDiagnostics: {
    title: { 'zh-CN': '诊断与安全模式', 'zh-TW': '診斷與安全模式', 'ja-JP': '診断とセーフモード', 'en-US': 'Diagnostics And Safe Mode', 'ko-KR': '진단 및 안전 모드' },
  },
  dangerRecovery: {
    title: { 'zh-CN': '数据库恢复', 'zh-TW': '資料庫復原', 'ja-JP': 'データベース復旧', 'en-US': 'Database Recovery', 'ko-KR': '데이터베이스 복구' },
  },
  dangerCleanup: {
    title: { 'zh-CN': '清理与重置', 'zh-TW': '清理與重設', 'ja-JP': 'クリーンアップとリセット', 'en-US': 'Cleanup And Reset', 'ko-KR': '정리 및 재설정' },
  },
} as const satisfies Record<string, { title: Record<Locale, string>; description?: Record<Locale, string> }>;

export type SettingsSubsectionCopyKey = keyof typeof settingsSubsectionCopy;

export const settingsLocaleCopy = (locale: Locale, copy: Record<Locale, string>): string => copy[locale] ?? copy['en-US'];

export const experimentalLabCopy = {
  windowAcrylicDescription: {
    'zh-CN': '下次启动时使用系统亚克力材质，让桌面背景从窗口后方透出。',
    'zh-TW': '下次啟動時使用系統壓克力材質，讓桌面背景從視窗後方透出。',
    'ja-JP': '次回起動時にシステムのアクリル素材を使い、デスクトップ背景を透過表示します。',
    'en-US': 'Use the system acrylic material after the next launch so the desktop can show through.',
    'ko-KR': '다음 실행부터 시스템 아크릴 재질을 사용해 바탕 화면이 비치도록 합니다.',
  },
  lowLoadDescription: {
    'zh-CN': '播放期间减少实时频谱、频繁刷新、分析与预热任务。',
    'zh-TW': '播放期間減少即時頻譜、頻繁重新整理、分析與預熱工作。',
    'ja-JP': '再生中のリアルタイム表示、頻繁な更新、解析、先読み処理を減らします。',
    'en-US': 'Reduce live visuals, frequent refreshes, analysis, and preloading while music is playing.',
    'ko-KR': '음악 재생 중 실시간 시각 효과, 잦은 새로고침, 분석, 미리 로드를 줄입니다.',
  },
  albumWallTitle: {
    'zh-CN': '专辑墙虚拟化',
    'zh-TW': '專輯牆虛擬化',
    'ja-JP': 'アルバムウォールの仮想化',
    'en-US': 'Album Wall Virtualization',
    'ko-KR': '앨범 벽 가상화',
  },
  albumWallDescription: {
    'zh-CN': '大型媒体库仅渲染可见专辑，降低封面解码与页面占用。',
    'zh-TW': '大型媒體庫僅算繪可見專輯，降低封面解碼與頁面占用。',
    'ja-JP': '大規模ライブラリでは表示中のアルバムだけを描画し、画像デコードと画面負荷を抑えます。',
    'en-US': 'Render only visible albums in large libraries to reduce cover decoding and page load.',
    'ko-KR': '대규모 라이브러리에서는 보이는 앨범만 렌더링해 커버 디코딩과 페이지 부하를 줄입니다.',
  },
  nativeDirectTitle: {
    'zh-CN': '本地直读播放',
    'zh-TW': '本機直讀播放',
    'ja-JP': 'ローカル直接再生',
    'en-US': 'Direct Local Playback',
    'ko-KR': '로컬 직접 재생',
  },
  nativeDirectDescription: {
    'zh-CN': '由原生 host 直读本地音频，支持 EQ 与播放速度；失败时自动回退。',
    'zh-TW': '由原生 host 直讀本機音訊，支援 EQ 與播放速度；失敗時自動回退。',
    'ja-JP': 'ネイティブ host がローカル音源を直接読み込み、EQ と再生速度に対応し、失敗時は自動で戻します。',
    'en-US': 'Let the native host read local audio directly with EQ and speed support, falling back on failure.',
    'ko-KR': '네이티브 host가 로컬 오디오를 직접 읽고 EQ·재생 속도를 지원하며, 실패 시 자동 폴백합니다.',
  },
  nativeFileScannerDescription: {
    'zh-CN': '使用 C++ 独立进程发现音频文件；不读取元数据、不提取封面、不写数据库。',
    'zh-TW': '使用 C++ 獨立程序尋找音訊檔案；不讀取中繼資料、不擷取封面、不寫入資料庫。',
    'ja-JP': 'C++ の独立プロセスで音源を検出し、メタデータ・カバー・データベースには触れません。',
    'en-US': 'Find audio with an isolated C++ process without reading metadata, extracting covers, or writing the database.',
    'ko-KR': '독립 C++ 프로세스로 오디오를 찾으며 메타데이터·커버·데이터베이스에는 쓰지 않습니다.',
  },
  nativeMetadataReaderDescription: {
    'zh-CN': '使用 C++ 独立进程读取常见格式的基础标签；仅在调用方需要时返回嵌入封面，不写数据库。',
    'zh-TW': '使用 C++ 獨立程序讀取常見格式的基礎標籤；僅在呼叫端需要時回傳嵌入封面，不寫入資料庫。',
    'ja-JP': 'C++ の独立プロセスで一般的な形式の基本タグを読み、呼び出し側が必要とする場合だけ埋め込みカバーを返します。データベースには書き込みません。',
    'en-US': 'Read basic tags for common formats in an isolated C++ process, returning embedded covers only when requested and never writing the database.',
    'ko-KR': '독립 C++ 프로세스로 일반 형식의 기본 태그를 읽고, 요청 시에만 임베디드 커버를 반환하며 데이터베이스에는 쓰지 않습니다.',
  },
} as const satisfies Record<string, Record<Locale, string>>;

export const settingsSearchSubsectionByTargetId: Partial<Record<string, SettingsSubsectionCopyKey>> = {
  'settings-row-low-spec-mode': 'generalPerformance',
  'settings-row-first-run-wizard': 'generalBasics',
  'settings-row-home-random-hero-title': 'generalBasics',
  'settings-row-echo-pro-activation': 'generalBasics',
  'settings-row-echo-pro-account': 'generalBasics',
  'settings-row-close-to-tray': 'generalWindow',
  'settings-row-launch-at-login': 'generalWindow',
  'settings-row-sidebar-auto-hide': 'generalWindow',
  'settings-row-sidebar-icon-only': 'generalWindow',
  'settings-row-streaming-feature': 'generalFeatures',
  'settings-row-track-context-menu-extra-actions': 'generalAdvancedCustom',
  'settings-row-sqlite-balanced-durability': 'generalFeatures',
  'settings-row-sidebar-layout': 'generalFeatures',
  'settings-row-player-waveform-progress': 'generalFeatures',
  'settings-row-artist-streaming-albums': 'generalFeatures',
  'settings-row-artist-online-info-sources': 'generalFeatures',
  'settings-row-data-backup': 'generalData',
  'settings-row-output-device': 'playbackOutput',
  'settings-row-no-sound-guide': 'playbackOutput',
  'settings-row-low-load-playback-enhancements': 'playbackPerformance',
  'settings-row-audio-status': 'playbackDiagnostics',
  'settings-row-automix': 'playbackTransitions',
  'settings-row-segment-loop': 'playbackTransitions',
  'settings-row-fixed-volume': 'playbackControls',
  'settings-row-prevent-sleep-while-playing': 'playbackControls',
  'settings-row-auto-play-on-startup': 'playbackControls',
  'settings-row-transport-fade': 'playbackControls',
  'settings-row-mini-player': 'playbackInterface',
  'settings-row-gapless-playback': 'playbackTransitions',
  'settings-row-shuffle-credibility': 'playbackTransitions',
  'settings-row-volume-balance': 'playbackLoudness',
  'settings-row-mono-audio': 'playbackLoudness',
  'settings-row-soxr-fallback': 'playbackCompatibility',
  'settings-row-network-proxy': 'integrationsNetwork',
  'settings-row-discord-presence': 'integrationsExternal',
  'settings-row-smtc': 'integrationsWindows',
  'settings-row-smtc-lyrics': 'integrationsWindows',
  'settings-row-obs-browser-source': 'integrationsExternal',
  'settings-row-stage-api': 'integrationsExternal',
  'settings-row-taskbar-mini-player': 'integrationsWindows',
  'settings-row-taskbar-playback': 'integrationsWindows',
  'settings-row-lastfm': 'integrationsLastFm',
  'settings-row-lastfm-connection': 'integrationsLastFm',
  'settings-row-lastfm-now-playing': 'integrationsLastFm',
  'settings-row-lastfm-scrobbling': 'integrationsLastFm',
  'settings-row-account-startup-refresh': 'integrationsAutomation',
  'settings-row-spotify-auth-config': 'integrationsAccounts',
  'settings-row-tidal-auth-config': 'integrationsAccounts',
  'settings-row-online-album-info': 'integrationsMetadata',
  'settings-row-online-artist-info': 'integrationsMetadata',
  'settings-row-theme': 'appearanceTheme',
  'settings-row-now-playing-cover-color': 'appearanceWindow',
  'settings-row-wallpaper': 'appearanceWallpaper',
  'settings-row-album-cover-shape': 'appearanceWallpaper',
  'settings-row-library-folders': 'libraryImport',
  'settings-row-live-library-updates': 'libraryImport',
  'settings-row-scan-performance': 'experimentalPerformance',
  'settings-row-native-file-scanner': 'experimentalPerformance',
  'settings-row-native-metadata-reader': 'experimentalPerformance',
  'settings-row-library-quality': 'libraryQuality',
  'settings-row-library-lyrics-backfill': 'libraryQuality',
  'settings-row-library-health-report': 'libraryQuality',
  'settings-row-library-performance-diagnostics': 'libraryQuality',
  'settings-row-artist-wall-artwork': 'libraryMaintenance',
  'settings-row-artist-avatars': 'libraryMaintenance',
  'settings-row-library-merge-strategy': 'libraryMaintenance',
  'settings-row-safe-mode': 'aboutDiagnostics',
  'settings-row-dev-console': 'aboutDiagnostics',
  'settings-row-settings-export': 'generalData',
  'settings-row-diagnostics-assistant': 'aboutDiagnostics',
  'settings-row-diagnostics': 'aboutDiagnostics',
};

