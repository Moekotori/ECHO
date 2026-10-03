import { ArrowUpRight, AudioLines, Cloud, Cpu, Gauge, Puzzle } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import type { Locale } from '../../i18n/locales';
import '../../styles/steam-edition-overview.css';

const steamStoreUrl = 'https://store.steampowered.com/app/5105090/ECHO/';

type PromoCopy = {
  eyebrow: string;
  store: string;
  dialogTitle: string;
  dialogIntro: string;
  optimizationTitle: string;
  optimizationBody: string;
  featuresTitle: string;
  featuresBody: string;
  performanceTitle: string;
  performanceBody: string;
  communityTitle: string;
  communityBody: string;
  note: string;
};

const copy: Record<Locale, PromoCopy> = {
  'zh-CN': {
    eyebrow: 'ECHO · STEAM', store: '前往 Steam',
    dialogTitle: 'Steam 版的区别', dialogIntro: '社区版永久免费，源码开放。Steam 版沿着同一套本地听歌体验往前走：更好的优化，更多功能，更好的性能。',
    optimizationTitle: '更好的优化', optimizationBody: '扫描、元数据和后台任务分开处理。大曲库分页、低配置模式和后台降载更完整，打开、切歌和长时间播放更从容。',
    featuresTitle: '更多功能', featuresBody: '本地曲库、歌词和声音调整之外，还有自动更新、部分设置的 Cloud 同步、成就、好友状态，以及主题、歌词场景、可视化与扩展的创意工坊。',
    performanceTitle: '更好的性能', performanceBody: '播放由 Audio Core 与原生宿主负责，界面只做控制与展示。公开快照里，16,813 首曲目播放时约 589 MB 内存、1.1% CPU。实际占用仍视设备和设置而定。',
    communityTitle: '社区版继续免费', communityBody: '从官网或 GitHub 获取，走独立更新通道，源码可以查看和学习。创意工坊与 Steamworks 只在 Steam 版提供。',
    note: 'Steam Cloud 不同步音乐文件、完整曲库或歌单。',
  },
  'zh-TW': {
    eyebrow: 'ECHO · STEAM', store: '前往 Steam',
    dialogTitle: 'Steam 版的差別', dialogIntro: '社群版永久免費，原始碼開放。Steam 版沿著同一套本機聽音樂體驗往前走：更好的最佳化，更多功能，更好的效能。',
    optimizationTitle: '更好的最佳化', optimizationBody: '掃描、詮釋資料與背景工作分開處理。大型曲庫分頁、低配置模式和背景降載更完整，開啟、切歌和長時間播放更從容。',
    featuresTitle: '更多功能', featuresBody: '本機曲庫、歌詞與聲音調整之外，還有自動更新、部分設定的 Cloud 同步、成就、好友狀態，以及主題、歌詞場景、視覺化與擴充的創意工坊。',
    performanceTitle: '更好的效能', performanceBody: '播放由 Audio Core 與原生宿主負責，介面只做控制與顯示。公開快照中，16,813 首曲目播放時約 589 MB 記憶體、1.1% CPU。實際占用仍視裝置與設定而定。',
    communityTitle: '社群版繼續免費', communityBody: '從官網或 GitHub 取得，走獨立更新管道，原始碼可以檢視與學習。創意工坊與 Steamworks 只在 Steam 版提供。',
    note: 'Steam Cloud 不同步音樂檔案、完整曲庫或播放清單。',
  },
  'en-US': {
    eyebrow: 'ECHO · STEAM', store: 'View on Steam',
    dialogTitle: 'How Steam is different', dialogIntro: 'The community edition stays free, with source you can read. Steam follows the same local listening experience further: tighter optimization, more features, and stronger performance.',
    optimizationTitle: 'Tighter optimization', optimizationBody: 'Scanning, metadata, and background work stay separated. Large-library paging, low-spec mode, and quieter background tasks are more complete, so opening, skipping, and long sessions stay comfortable.',
    featuresTitle: 'More features', featuresBody: 'Beyond the local library, lyrics, and sound adjustments: automatic updates, Cloud sync for selected settings, achievements, friend presence, and a Workshop of themes, lyric scenes, visualizers, and extensions.',
    performanceTitle: 'Stronger performance', performanceBody: 'Audio Core and the native host own playback. The interface only controls and displays. A published snapshot shows 16,813 tracks playing at about 589 MB and 1.1% CPU. Actual use still depends on your device and settings.',
    communityTitle: 'The community edition stays free', communityBody: 'Get it from the website or GitHub, on its own update channel, with source you can inspect and study. Workshop and Steamworks features ship with Steam only.',
    note: 'Steam Cloud does not sync music files, the full library, or playlists.',
  },
  'ja-JP': {
    eyebrow: 'ECHO · STEAM', store: 'Steam で見る',
    dialogTitle: 'Steam 版の違い', dialogIntro: 'コミュニティ版は永久無料で、ソースコードも公開されています。Steam 版は同じローカル再生の先へ進みます。より良い最適化、より多くの機能、より高い性能です。',
    optimizationTitle: 'より良い最適化', optimizationBody: 'スキャン、メタデータ、バックグラウンド処理を分けて扱います。大規模ライブラリのページ分割、低スペックモード、負荷抑制がより行き届き、起動、曲送り、長時間再生が落ち着きます。',
    featuresTitle: 'より多くの機能', featuresBody: 'ローカルライブラリ、歌詞、音質調整に加え、自動更新、一部設定の Cloud 同期、実績、フレンド表示、そしてテーマ・歌詞シーン・ビジュアライザー・拡張のワークショップがあります。',
    performanceTitle: 'より高い性能', performanceBody: '再生は Audio Core とネイティブホストが担い、画面は操作と表示に専念します。公開スナップショットでは 16,813 曲の再生時に約 589 MB、CPU 1.1% でした。実際の使用量は機器と設定により異なります。',
    communityTitle: 'コミュニティ版は無料のまま', communityBody: '公式サイトか GitHub から入手し、独立した更新経路を使います。ソースコードは閲覧・学習できます。ワークショップと Steamworks は Steam 版のみです。',
    note: 'Steam Cloud は音楽ファイル、ライブラリ全体、プレイリストを同期しません。',
  },
  'ko-KR': {
    eyebrow: 'ECHO · STEAM', store: 'Steam에서 보기',
    dialogTitle: 'Steam 버전의 차이', dialogIntro: '커뮤니티 버전은 계속 무료이고 소스 코드를 볼 수 있습니다. Steam 버전은 같은 로컬 감상에서 더 나아갑니다. 더 나은 최적화, 더 많은 기능, 더 좋은 성능입니다.',
    optimizationTitle: '더 나은 최적화', optimizationBody: '스캔, 메타데이터, 백그라운드 작업을 나누어 처리합니다. 대형 라이브러리 페이지 나누기, 저사양 모드, 백그라운드 부하 완화가 더 완전해서 열기, 곡 넘기기, 오래 듣기가 여유롭습니다.',
    featuresTitle: '더 많은 기능', featuresBody: '로컬 라이브러리, 가사, 사운드 조정 외에 자동 업데이트, 일부 설정의 Cloud 동기화, 도전 과제, 친구 상태, 그리고 테마·가사 장면·시각화·확장 콘텐츠를 위한 창작마당이 있습니다.',
    performanceTitle: '더 좋은 성능', performanceBody: '재생은 Audio Core와 네이티브 호스트가 맡고, 화면은 조작과 표시만 합니다. 공개된 스냅샷에서 16,813곡 재생 시 약 589 MB, CPU 1.1%였습니다. 실제 사용량은 기기와 설정에 따라 달라집니다.',
    communityTitle: '커뮤니티 버전은 계속 무료', communityBody: '공식 사이트나 GitHub에서 받고 별도의 업데이트 경로를 사용합니다. 소스 코드를 살펴보고 학습할 수 있습니다. 창작마당과 Steamworks는 Steam 버전에만 있습니다.',
    note: 'Steam Cloud는 음악 파일, 전체 라이브러리, 재생목록을 동기화하지 않습니다.',
  },
};

const openSteamStore = async (): Promise<void> => {
  if (window.echo?.app?.openExternalUrl) {
    try {
      await window.echo.app.openExternalUrl(steamStoreUrl);
      return;
    } catch {
      // Browser preview can still open the link if the desktop bridge is unavailable.
    }
  }
  window.open(steamStoreUrl, '_blank', 'noopener,noreferrer');
};

export const SteamEditionOverview = (): JSX.Element => {
  const { locale } = useI18n();
  const c = copy[locale];

  return (
    <div className="steam-edition-overview">
      <div className="steam-edition-overview__lead">
        <span className="steam-edition-overview__eyebrow"><AudioLines size={17} aria-hidden="true" />{c.eyebrow}</span>
        <h3>{c.dialogTitle}</h3>
        <p>{c.dialogIntro}</p>
        <button type="button" className="steam-edition-overview__store" onClick={() => void openSteamStore()}>
          {c.store}<ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="steam-edition-overview__grid">
        {[
          { icon: Gauge, title: c.optimizationTitle, body: c.optimizationBody },
          { icon: Puzzle, title: c.featuresTitle, body: c.featuresBody },
          { icon: Cpu, title: c.performanceTitle, body: c.performanceBody },
          { icon: Cloud, title: c.communityTitle, body: c.communityBody },
        ].map(({ icon: Icon, title, body }) => (
          <div className="steam-edition-overview__item" key={title}>
            <Icon size={19} aria-hidden="true" />
            <div><h4>{title}</h4><p>{body}</p></div>
          </div>
        ))}
      </div>
      <p className="steam-edition-overview__note">{c.note}</p>
    </div>
  );
};
