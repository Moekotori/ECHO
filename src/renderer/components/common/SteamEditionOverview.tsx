import { ArrowUpRight, AudioLines, Cloud, Gauge, Puzzle } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import type { Locale } from '../../i18n/locales';
import '../../styles/steam-edition-overview.css';

const steamStoreUrl = 'https://store.steampowered.com/app/5105090/ECHO/';

type PromoCopy = {
  eyebrow: string;
  store: string;
  dialogTitle: string;
  dialogIntro: string;
  sharedTitle: string;
  sharedBody: string;
  performanceTitle: string;
  performanceBody: string;
  steamTitle: string;
  steamBody: string;
  communityTitle: string;
  communityBody: string;
  note: string;
};

const copy: Record<Locale, PromoCopy> = {
  'zh-CN': {
    eyebrow: 'ECHO · STEAM', store: '前往 Steam',
    dialogTitle: '社区版与 Steam 版', dialogIntro: '同一条 ECHO 产品线，两种获取方式。性能和音频重构是共同方向；Steam 版另外接入 Steam 生态。',
    sharedTitle: '共同的播放基础', sharedBody: '都以本地曲库和稳定播放为核心。大曲库分页、后台任务降载和低配置模式，帮助日常使用保持流畅。',
    performanceTitle: '持续重构的音频链路', performanceBody: '播放状态由 Audio Core 与原生宿主负责，界面专注控制和展示。实际体验取决于设备、设置与安装版本。',
    steamTitle: 'Steam 版多出的生态', steamBody: 'Steam 自动更新、部分设置的 Cloud 同步、好友状态、成就，以及可订阅主题、歌词场景、可视化和扩展的创意工坊。',
    communityTitle: '社区版的方式', communityBody: '从官网或 GitHub 获取，使用独立更新通道；源码可供查看与学习。Steam 创意工坊与 Steamworks 功能不在社区版中。',
    note: 'Steam Cloud 不同步音乐文件、完整曲库或歌单。ECHO Pro 为另行购买的可选权益，两版授权不互通。',
  },
  'zh-TW': {
    eyebrow: 'ECHO · STEAM', store: '前往 Steam',
    dialogTitle: '社群版與 Steam 版', dialogIntro: '同一條 ECHO 產品線，兩種取得方式。效能與音訊重構是共同方向；Steam 版另外接入 Steam 生態。',
    sharedTitle: '共同的播放基礎', sharedBody: '都以本機曲庫和穩定播放為核心。大型曲庫分頁、背景工作降載與低配置模式，協助日常使用保持流暢。',
    performanceTitle: '持續重構的音訊鏈路', performanceBody: '播放狀態由 Audio Core 與原生宿主負責，介面專注控制與顯示。實際體驗視裝置、設定與安裝版本而定。',
    steamTitle: 'Steam 版多出的生態', steamBody: 'Steam 自動更新、部分設定的 Cloud 同步、好友狀態、成就，以及可訂閱主題、歌詞場景、視覺化與擴充的創意工坊。',
    communityTitle: '社群版的方式', communityBody: '從官網或 GitHub 取得，使用獨立更新管道；原始碼可供檢視與學習。Steam 創意工坊與 Steamworks 功能不在社群版中。',
    note: 'Steam Cloud 不同步音樂檔案、完整曲庫或播放清單。ECHO Pro 是另購的可選權益，兩版授權不互通。',
  },
  'en-US': {
    eyebrow: 'ECHO · STEAM', store: 'View on Steam',
    dialogTitle: 'Community and Steam editions', dialogIntro: 'One ECHO product line, two ways to get it. Performance and audio refactoring benefit both; Steam adds its own ecosystem.',
    sharedTitle: 'Shared playback foundation', sharedBody: 'Both center on your local library and reliable playback. Paginated libraries, lighter background work, and low spec mode help daily use stay responsive.',
    performanceTitle: 'An evolving audio architecture', performanceBody: 'Audio Core and the native host own playback state while the interface handles control and display. Results depend on your device, settings, and installed version.',
    steamTitle: 'What Steam adds', steamBody: 'Steam updates, Cloud sync for selected settings, friend presence, achievements, and a Workshop for themes, lyric scenes, visualizers, and extensions.',
    communityTitle: 'How the community edition works', communityBody: 'Get it from the website or GitHub and use its separate update channel. Its source is available to inspect and study. Steamworks features are exclusive to Steam.',
    note: 'Steam Cloud does not sync music files, the full library, or playlists. ECHO Pro is optional and sold separately; entitlements do not transfer between editions.',
  },
  'ja-JP': {
    eyebrow: 'ECHO · STEAM', store: 'Steam で見る',
    dialogTitle: 'コミュニティ版と Steam 版', dialogIntro: '同じ ECHO 製品ラインの二つの入手方法です。性能改善と音声設計の再構築は共通で、Steam 版には独自のエコシステムがあります。',
    sharedTitle: '共通の再生基盤', sharedBody: 'どちらもローカルライブラリと安定した再生が中心です。ページ分割、バックグラウンド処理の軽量化、低スペックモードに対応します。',
    performanceTitle: '進化する音声アーキテクチャ', performanceBody: '再生状態は Audio Core とネイティブホストが管理し、画面は操作と表示を担当します。体験は機器、設定、バージョンによって異なります。',
    steamTitle: 'Steam 版で加わるもの', steamBody: '自動更新、一部設定の Cloud 同期、フレンド表示、実績、そしてテーマ・歌詞シーン・ビジュアライザー・拡張を探せるワークショップ。',
    communityTitle: 'コミュニティ版', communityBody: '公式サイトか GitHub から入手し、独立した更新経路を使います。ソースコードは閲覧・学習できます。Steamworks 機能は含まれません。',
    note: 'Steam Cloud は音楽ファイル、ライブラリ全体、プレイリストを同期しません。ECHO Pro は別売りで、権利は版をまたいで移行できません。',
  },
  'ko-KR': {
    eyebrow: 'ECHO · STEAM', store: 'Steam에서 보기',
    dialogTitle: '커뮤니티 버전과 Steam 버전', dialogIntro: '하나의 ECHO 제품군을 이용하는 두 방법입니다. 성능 개선과 오디오 구조 개편은 공통이며 Steam 버전에는 별도의 생태계가 추가됩니다.',
    sharedTitle: '공통 재생 기반', sharedBody: '두 버전 모두 로컬 음악 라이브러리와 안정적인 재생에 집중합니다. 페이지 나누기, 백그라운드 작업 경량화, 저사양 모드를 제공합니다.',
    performanceTitle: '발전하는 오디오 구조', performanceBody: 'Audio Core와 네이티브 호스트가 재생 상태를 관리하고 화면은 제어와 표시에 집중합니다. 실제 경험은 기기, 설정, 버전에 따라 달라집니다.',
    steamTitle: 'Steam 버전에 추가되는 것', steamBody: '자동 업데이트, 일부 설정의 Cloud 동기화, 친구 상태, 도전 과제, 테마·가사 장면·시각화·확장 콘텐츠를 위한 창작마당.',
    communityTitle: '커뮤니티 버전', communityBody: '공식 사이트나 GitHub에서 받고 별도의 업데이트 경로를 사용합니다. 소스 코드를 살펴보고 학습할 수 있습니다. Steamworks 기능은 포함되지 않습니다.',
    note: 'Steam Cloud는 음악 파일, 전체 라이브러리, 재생목록을 동기화하지 않습니다. ECHO Pro는 별도 선택 구매이며 버전 간 권한은 이전되지 않습니다.',
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
          { icon: AudioLines, title: c.sharedTitle, body: c.sharedBody },
          { icon: Gauge, title: c.performanceTitle, body: c.performanceBody },
          { icon: Puzzle, title: c.steamTitle, body: c.steamBody },
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
