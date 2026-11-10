import { Music2 } from 'lucide-react';
import type { PlaybackStatsTrack } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { HomeArtwork, homeArtworkUrl } from './HomeArtwork';
import { formatCompactNumber, formatShortDate } from './homeFormatters';

const topTrackLimit = 6;

type HomeTopTracksProps = {
  currentTrackId: string | null;
  onPlayTrack: (track: PlaybackStatsTrack) => void;
  tracks: PlaybackStatsTrack[];
};

export const HomeTopTracks = ({ currentTrackId, onPlayTrack, tracks }: HomeTopTracksProps): JSX.Element => {
  const { locale, t } = useI18n();
  const visibleTracks = tracks
    .filter((track) => track.trackId && track.title.trim().length > 0)
    .slice(0, topTrackLimit);

  if (visibleTracks.length === 0) {
    return (
      <div className="home-top-tracks-empty" role="status">
        <Music2 size={18} />
        <span>
          <strong>{t('home.topTracks.emptyTitle')}</strong>
        </span>
      </div>
    );
  }

  return (
    <ol className="home-top-tracks" aria-label={t('home.topTracks.aria')}>
      {visibleTracks.map((track, index) => {
        const isCurrent = currentTrackId !== null && track.trackId === currentTrackId;
        const artist = track.artist.trim() || t('queue.unknownArtist');

        return (
          <li className="home-top-track-item" key={track.id}>
            <button
              className="home-top-track-row"
              type="button"
              aria-label={t('home.topTracks.playAria', { title: track.title })}
              data-current={isCurrent ? 'true' : undefined}
              disabled={!track.trackId}
              onClick={() => onPlayTrack(track)}
            >
              <span className="home-top-track-rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="home-top-track-art">
                <HomeArtwork coverThumb={homeArtworkUrl(track, 'thumb')} title={track.title} size={84} />
              </span>
              <span className="home-top-track-copy">
                <strong>{track.title}</strong>
                <small>
                  {artist}
                  {track.album.trim() ? ` · ${track.album.trim()}` : ''}
                </small>
              </span>
              <span className="home-top-track-meta">
                <strong>{t('home.artistLeaderboard.playCount', { count: formatCompactNumber(track.playCount) })}</strong>
                <small>{t('home.topTracks.lastPlayed', { date: formatShortDate(track.lastPlayedAt, t, locale) })}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};
