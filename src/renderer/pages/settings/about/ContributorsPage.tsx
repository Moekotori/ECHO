import { ArrowLeft } from 'lucide-react';
import type { Locale } from '../../../i18n/locales';
import '../../../styles/settings-contributors.css';
import { settingsLocaleCopy } from '../settingsSubsections';
import { contributorIds } from './contributors';

const contributorsOrbitLight = new URL('../../../assets/contributors-orbit-light.png', import.meta.url).href;

type ContributorsPageProps = {
  locale: Locale;
  onBack: () => void;
};

const copy = {
  back: {
    'zh-CN': '返回关于',
    'zh-TW': '返回關於',
    'ja-JP': '「このアプリについて」に戻る',
    'en-US': 'Back to About',
    'ko-KR': '정보로 돌아가기',
  },
  title: {
    'zh-CN': '贡献者',
    'zh-TW': '貢獻者',
    'ja-JP': 'コントリビューター',
    'en-US': 'Contributors',
    'ko-KR': '기여자',
  },
  description: {
    'zh-CN': '感谢每一位让 ECHO 发出回声的人。',
    'zh-TW': '感謝每一位讓 ECHO 發出回聲的人。',
    'ja-JP': 'ECHO に響きを与えてくれた、すべての人へ。',
    'en-US': 'Thank you to everyone who helps ECHO resonate.',
    'ko-KR': 'ECHO가 울려 퍼지도록 도와주신 모든 분께 감사드립니다.',
  },
  listLabel: {
    'zh-CN': 'ECHO 贡献者名单',
    'zh-TW': 'ECHO 貢獻者名單',
    'ja-JP': 'ECHO コントリビューター一覧',
    'en-US': 'ECHO contributor list',
    'ko-KR': 'ECHO 기여자 목록',
  },
} as const satisfies Record<string, Record<Locale, string>>;

export const ContributorsPage = ({ locale, onBack }: ContributorsPageProps): JSX.Element => {
  const countLabel = settingsLocaleCopy(locale, {
    'zh-CN': `${contributorIds.length} 位贡献者`,
    'zh-TW': `${contributorIds.length} 位貢獻者`,
    'ja-JP': `${contributorIds.length} 人のコントリビューター`,
    'en-US': `${contributorIds.length} contributors`,
    'ko-KR': `기여자 ${contributorIds.length}명`,
  });

  return (
    <div className="contributors-page">
      <button className="contributors-back" type="button" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" />
        {settingsLocaleCopy(locale, copy.back)}
      </button>

      <header className="contributors-header">
        <h2>{settingsLocaleCopy(locale, copy.title)}</h2>
        <p>{settingsLocaleCopy(locale, copy.description)}</p>
        <span>{countLabel}</span>
      </header>

      <div className="contributors-stage">
        <img className="contributors-orbit" src={contributorsOrbitLight} alt="" aria-hidden="true" />
        <ul
          className="contributors-grid"
          aria-label={settingsLocaleCopy(locale, copy.listLabel)}
        >
          {contributorIds.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};
