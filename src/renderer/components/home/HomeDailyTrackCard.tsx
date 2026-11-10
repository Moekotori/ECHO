import { useRef } from 'react';
import { Ellipsis, Play } from 'lucide-react';
import type { LibraryTrack } from '../../../shared/types/library';
import type { TranslationKey } from '../../i18n/locales';
import { useI18n } from '../../i18n/I18nProvider';
import { usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { HomeArtwork, homeArtworkUrl } from './HomeArtwork';
import type { HomeDailyTrack } from './homeDailyRecommendations';
import './home-daily-track.css';

export const HomeDailyTrackCard = ({ track, index, disabled, current, onPlay, onFeedback }: {
  track: HomeDailyTrack; index: number; disabled: boolean; current: boolean;
  onPlay: (track: LibraryTrack) => void; onFeedback: () => void;
}): JSX.Element => {
  const { t } = useI18n();
  const { reduceContinuousPlayFrequency } = usePlaybackQueue();
  const menu = useRef<HTMLDetailsElement>(null);
  const artist = track.artist || track.albumArtist;
  const reasons = track.discoveryReasons?.map(reason =>
    t(`queue.continuousPlay.reason.${reason.code}` as TranslationKey, { value: reason.value ?? '' })).join(' · ');

  const feedback = (): void => {
    reduceContinuousPlayFrequency('artist', artist);
    if (menu.current) menu.current.open = false;
    onFeedback();
  };

  return <article className="home-daily-track-row" data-current={current || undefined}>
    <button className="home-discovery-track" type="button" disabled={disabled}
      data-current={current || undefined} onClick={() => onPlay(track)}>
      <span className="home-discovery-track-number">{String(index + 1).padStart(2, '0')}</span>
      <HomeArtwork coverThumb={homeArtworkUrl(track, 'thumb')} title={track.title} size={56} />
      <span className="home-discovery-track-copy"><strong>{track.title}</strong><small>{artist || t('queue.unknownArtist')}</small>
      </span>
      <Play className="home-discovery-track-play" size={14} fill="currentColor" aria-hidden="true" />
    </button>
    <details className="home-daily-track-feedback" ref={menu}>
      <summary aria-label={`${t('home.discovery.reason')}: ${track.title}`} title={t('home.discovery.reason')}><Ellipsis size={17} /></summary>
      <div className="home-daily-track-menu">
        {track.discoverySeedTitle ? <p>{t('home.discovery.basedOn', { value: track.discoverySeedTitle })}</p> : null}
        {reasons ? <p>{reasons}</p> : null}
        <button type="button" disabled={!artist || disabled} onClick={feedback}>{t('queue.continuousPlay.reduce.artist')}</button>
      </div>
    </details>
  </article>;
};
