import { useMemo } from 'react';
import type { LibraryTrack, PlaybackHistoryEntry, PlaybackStatsAlbum } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { HomeArtwork, homeArtworkUrl } from './HomeArtwork';
import { formatShortDate } from './homeFormatters';
import { selectRediscoveryAlbums } from './homeRediscoverySelection';
import '../../styles/home-rediscovery.css';

export const HomeRediscovery = ({ albums, recentHistory, currentTrack, onOpenAlbum }: {
  albums: PlaybackStatsAlbum[];
  recentHistory: PlaybackHistoryEntry[];
  currentTrack: LibraryTrack | null;
  onOpenAlbum: (album: PlaybackStatsAlbum, target: EventTarget) => void;
}): JSX.Element | null => {
  const { t, locale } = useI18n();
  const visible = useMemo(() => selectRediscoveryAlbums(albums, recentHistory, currentTrack),
    [albums, recentHistory, currentTrack]);
  if (!visible.length) return null;

  return (
    <section className="home-panel home-rediscovery" aria-label={t('home.rediscovery.title')}>
      <header className="home-section-header"><h2>{t('home.rediscovery.title')}</h2></header>
      <div className="home-rediscovery-grid">
        {visible.map((album) => (
          <button className="home-rediscovery-album" type="button" key={album.albumId}
            onClick={(event) => onOpenAlbum(album, event.currentTarget)}>
            <HomeArtwork coverThumb={homeArtworkUrl(album, 'thumb')} title={album.title} size={156} />
            <strong>{album.title}</strong>
            <span>{album.albumArtist || t('queue.unknownArtist')}</span>
            <small>{t('home.rediscovery.lastPlayed', { date: formatShortDate(album.lastPlayedAt, t, locale) })}</small>
          </button>
        ))}
      </div>
    </section>
  );
};
