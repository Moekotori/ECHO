import type { CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';
import type { PlaybackStatsBreakdownItem, PlaybackStatsDashboard } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { formatDuration } from './homeFormatters';

const qualitySegmentLimit = 5;

type QualitySegment = {
  id: string;
  label: string;
  share: number;
};

const buildQualitySegments = (items: PlaybackStatsBreakdownItem[] | undefined): QualitySegment[] => {
  const weighted = (items ?? [])
    .map((item) => ({ ...item, weight: item.playedSeconds > 0 ? item.playedSeconds : item.playCount }))
    .filter((item) => item.weight > 0)
    .sort((left, right) => right.weight - left.weight);
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);

  if (total <= 0) {
    return [];
  }

  return weighted.slice(0, qualitySegmentLimit).map((item) => ({
    id: item.id,
    label: item.label,
    share: item.weight / total,
  }));
};

const formatPercent = (share: number): string => `${Math.round(share * 100)}%`;

type HomeListeningProfileProps = {
  stats: PlaybackStatsDashboard | null;
};

export const HomeListeningProfile = ({ stats }: HomeListeningProfileProps): JSX.Element => {
  const { t } = useI18n();
  const segments = buildQualitySegments(stats?.qualityBreakdown);

  if (segments.length === 0) {
    return (
      <div className="home-profile-empty" role="status">
        <Sparkles size={18} />
        <span>
          <strong>{t('home.profile.emptyTitle')}</strong>
        </span>
      </div>
    );
  }

  return (
    <div className="home-profile">
      {segments.length > 0 ? (
        <section className="home-profile-block" aria-label={t('home.profile.qualityMix')}>
          <h3>{t('home.profile.qualityMix')}</h3>
          <div className="home-profile-mix" aria-hidden="true">
            {segments.map((segment, index) => (
              <i
                key={segment.id}
                style={{ '--home-mix-share': segment.share, '--home-mix-color': `var(--home-mix-${index + 1})` } as CSSProperties}
              />
            ))}
          </div>
          <ul className="home-profile-legend">
            {segments.map((segment, index) => (
              <li key={segment.id} style={{ '--home-mix-color': `var(--home-mix-${index + 1})` } as CSSProperties}>
                <span>{segment.label}</span>
                <em>{formatPercent(segment.share)}</em>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};
