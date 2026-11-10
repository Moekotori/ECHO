import type { LibraryAlbum } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { HomeArtwork, homeArtworkUrl } from './HomeArtwork';

export function HomeDiscoveryAlbumShelf({ albums, onOpenAlbum }: { albums: LibraryAlbum[]; onOpenAlbum: (album: LibraryAlbum) => void }): JSX.Element {
  const { t } = useI18n();
  return <div className="home-discovery-album-grid">{albums.map(album =>
    <button className="home-cover-card" type="button" key={album.id} onClick={() => onOpenAlbum(album)}>
      <HomeArtwork coverThumb={homeArtworkUrl(album, 'album')} title={album.title} size={156} />
      <strong>{album.title}</strong><span>{album.albumArtist || t('queue.unknownArtist')}</span>
    </button>)}
  </div>;
}
