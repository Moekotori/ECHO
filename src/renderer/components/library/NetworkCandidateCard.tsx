import { Check, ShieldCheck, X } from 'lucide-react';
import type { LibraryTrack, NetworkMetadataCandidate } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';

type Props = {
  candidate: NetworkMetadataCandidate;
  feedback?: {
    tone: 'success' | 'info' | 'warning';
    text: string;
  };
  track: LibraryTrack;
  onApplyMissingOnly: (candidateId: string) => void;
  onApplySelected: (candidateId: string) => void;
  onReject: (candidateId: string) => void;
};

const fieldPairs: Array<['title' | 'artist' | 'album' | 'albumArtist' | 'year' | 'genre' | 'trackNo' | 'discNo', string]> = [
  ['title', '标题'],
  ['artist', '歌手'],
  ['album', '专辑'],
  ['albumArtist', '专辑艺人'],
  ['year', '年份'],
  ['genre', '流派'],
  ['trackNo', '音轨号'],
  ['discNo', '碟号'],
];

const providerLabels: Record<string, string> = {
  mock: 'Mock',
  'netease-cloud-music': '网易云音乐',
  'qq-music': 'QQ 音乐',
  musicbrainz: 'MusicBrainz',
  'cover-art-archive': 'Cover Art Archive',
};

const valueText = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '缺失';
  }

  return String(value);
};

const sourceLabels: Record<string, string> = {
  manual: '手动编辑',
  embedded: '内嵌标签',
  sidecar: '旁车文件',
  folder_structure: '文件夹结构',
  network: '网络补全',
  filename_fallback: '文件名猜测',
  artist_fallback: '歌手兜底',
  unknown: '未知',
};

const sourceText = (value: unknown): string => {
  const source = typeof value === 'string' && value ? value : 'unknown';
  return sourceLabels[source] ?? source;
};

export const NetworkCandidateCard = ({ candidate, feedback, track, onApplyMissingOnly, onApplySelected, onReject }: Props): JSX.Element => {
  const { t } = useI18n();
  const visibleFields = fieldPairs.filter(([key]) => candidate[key] !== null || track[key] !== null);
  const candidateCoverUrl = candidate.coverUrl;

  return (
    <article className="network-candidate-card">
      <header>
        <div>
          <strong>{candidate.title ?? track.title}</strong>
          <span>{providerLabels[candidate.provider] ?? candidate.provider}</span>
        </div>
        <em>{candidate.score.toFixed(3)}</em>
      </header>
      <div className="network-candidate-main">
        <div className="network-candidate-cover" data-empty={!candidateCoverUrl}>
          {candidateCoverUrl ? <img alt="" src={candidateCoverUrl} /> : <span>无候选封面</span>}
        </div>
        <div className="network-candidate-summary">
          <span>
            <em>来源编号</em>
            <strong>{candidate.providerItemId}</strong>
          </span>
          <span>
            <em>候选封面</em>
            <strong>{candidateCoverUrl ? '可应用' : '缺失'}</strong>
          </span>
          <span>
            <em>当前来源</em>
            <strong>
              标题:{sourceText(track.fieldSources.title)} / 歌手:{sourceText(track.fieldSources.artist)}
            </strong>
          </span>
        </div>
      </div>
      <div className="network-diff-grid">
        {visibleFields.map(([key, label]) => (
          <span key={key}>
            <em>{label}</em>
            <small>本地：{valueText(track[key])}</small>
            <b>候选：{valueText(candidate[key])}</b>
            <strong>当前来源：{sourceText(track.fieldSources[key])}</strong>
          </span>
        ))}
      </div>
      <footer>
        <button type="button" className="settings-action-button" onClick={() => onApplyMissingOnly(candidate.id)}>
          <ShieldCheck size={15} />
          {t('settings.library.networkPanel.applyMissingOnly')}
        </button>
        <button type="button" className="settings-action-button" onClick={() => onApplySelected(candidate.id)}>
          <Check size={15} />
          {t('settings.library.networkPanel.applySelected')}
        </button>
        <button type="button" className="settings-danger-button" onClick={() => onReject(candidate.id)}>
          <X size={15} />
          {t('settings.library.networkPanel.reject')}
        </button>
      </footer>
      {feedback ? (
        <p className="network-candidate-feedback" data-tone={feedback.tone} role="status">
          {feedback.text}
        </p>
      ) : null}
    </article>
  );
};
