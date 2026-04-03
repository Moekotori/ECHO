import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const resources = {
  zh: {
    translation: {
      nav: { home: '首页', download: '下载', changelog: '更新日志', faq: 'FAQ' },
      hero: {
        badge: '持续更新中',
        title1: '听你想听的',
        title2: '纯粹之声',
        desc: 'ECHO 是一款面向本地音乐与高品质播放的桌面播放器。HiFi 输出、歌词与 MV、EQ 与插件扩展，把听歌这件事做得更顺手。<br/>界面清爽，信息清楚，专注音乐本身。',
        dlBtn: '立即下载获取',
        githubBtn: '在 GitHub 上查看'
      },
      features: {
        f1Title: '格式全能',
        f1Desc: '完美支持 FLAC, WAV, MP3 等高质量无损格式，保留最还原的声音细节。',
        f2Title: '极致体验',
        f2Desc: '告别广告与臃肿。重新聚焦音乐本身，拥有如诗般流滑与敏捷的操作感受。',
        f3Title: '歌词与扩展',
        f3Desc: '歌词与 MV 体验持续优化，并支持插件扩展，让播放器随你的习惯成长。'
      },
      footer: { tag1: 'HiFi · 歌词 · MV', tag2: 'Windows 桌面端' },
      lang: { zh: '中文', en: 'English', ja: '日本語', ko: '한국어' }
    }
  },
  en: {
    translation: {
      nav: { home: 'Home', download: 'Download', changelog: 'Changelog', faq: 'FAQ' },
      hero: {
        badge: 'Updated regularly',
        title1: 'Listen to what you want',
        title2: 'Pure Sound',
        desc: 'ECHO is a desktop music player focused on local libraries and high-quality playback—HiFi output, lyrics & MV, EQ, and plugins.<br/>Clean UI, clear hierarchy, music first.',
        dlBtn: 'Download Now',
        githubBtn: 'View on GitHub'
      },
      features: {
        f1Title: 'All Formats',
        f1Desc: 'Perfectly supports FLAC, WAV, MP3 and other high-res lossless formats, preserving every detail.',
        f2Title: 'Ultimate Experience',
        f2Desc: 'Say goodbye to ads and bloat. Refocus on the music with a silky smooth and agile interface.',
        f3Title: 'Lyrics & Extensions',
        f3Desc: 'Lyrics and MV experience keeps improving, with a plugin system that grows with your workflow.'
      },
      footer: { tag1: 'HiFi · Lyrics · MV', tag2: 'Windows desktop' },
      lang: { zh: '中文', en: 'English', ja: '日本語', ko: '한국어' }
    }
  },
  ja: {
    translation: {
      nav: { home: 'ホーム', download: 'ダウンロード', changelog: '更新履歴', faq: 'FAQ' },
      hero: {
        badge: '継続アップデート',
        title1: '聴きたいものを聴く',
        title2: '純粋な音',
        desc: 'ECHO はローカル音楽と高音質再生にフォーカスしたデスクトッププレーヤーです。HiFi 出力、歌詞と MV、EQ、プラグイン拡張で、毎日の再生を快適に。<br/>すっきりした UI と分かりやすい情報設計。',
        dlBtn: '今すぐダウンロード',
        githubBtn: 'GitHubで見る'
      },
      features: {
        f1Title: '全フォーマット対応',
        f1Desc: 'FLAC、WAV、MP3などの可逆圧縮フォーマットを完全にサポートし、音の細部まで保ちます。',
        f2Title: '最高の体験',
        f2Desc: '広告や肥大化にさようなら。シルクのように滑らかで軽快な操作感で音楽に集中できます。',
        f3Title: '歌詞・拡張',
        f3Desc: '歌詞と MV の体験を磨きつつ、プラグインで自分好みに広げられます。'
      },
      footer: { tag1: 'HiFi · 歌詞 · MV', tag2: 'Windows 版' },
      lang: { zh: '中文', en: 'English', ja: '日本語', ko: '한국어' }
    }
  },
  ko: {
    translation: {
      nav: { home: '홈', download: '다운로드', changelog: '변경 로그', faq: 'FAQ' },
      hero: {
        badge: '지속 업데이트',
        title1: '듣고 싶은 것을',
        title2: '순수한 소리로',
        desc: 'ECHO는 로컬 음악과 고음질 재생에 초점을 맞춘 데스크톱 플레이어입니다. HiFi 출력, 가사·MV, EQ, 플러그인으로 매일의 감상을 편하게.<br/>깔끔한 UI와 명확한 정보 구조.',
        dlBtn: '지금 다운로드',
        githubBtn: 'GitHub에서 보기'
      },
      features: {
        f1Title: '모든 포맷 지원',
        f1Desc: 'FLAC, WAV, MP3 등 고해상도 무손실 포맷을 완벽하게 지원하여 사운드의 모든 디테일을 유지합니다.',
        f2Title: '최고의 경험',
        f2Desc: '광고와 무거움은 이제 안녕. 부드럽고 민첩한 조작감으로 음악에만 집중하세요.',
        f3Title: '가사·확장',
        f3Desc: '가사와 MV 경험을 다듬고, 플러그인으로 원하는 기능을 더할 수 있습니다.'
      },
      footer: { tag1: 'HiFi · 가사 · MV', tag2: 'Windows' },
      lang: { zh: '中文', en: 'English', ja: '日本語', ko: '한국어' }
    }
  }
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'zh',
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false // React already does escaping
    }
  })

export default i18n
