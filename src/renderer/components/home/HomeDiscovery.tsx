import { useEffect, useRef, useState } from 'react';
import { Album, ChevronLeft, ChevronRight, Play, RefreshCw } from 'lucide-react';
import type { LibraryAlbum, LibraryTrack } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { HomeArtwork, homeArtworkUrl } from './HomeArtwork';
import { formatDuration } from './homeFormatters';
import { HomeShortcuts } from './HomeShortcuts';
import { HomeDiscoveryAlbumShelf } from './HomeDiscoveryShelves';
import { useHomeDiscovery } from './useHomeDiscovery';
import { loadDiscoveryAlbumTracks } from './homeDiscoveryData';
import { HomeDailyTrackCard } from './HomeDailyTrackCard';
import '../../styles/home-discovery.css';

export function HomeDiscovery({ onOpenAlbum }: { onOpenAlbum: (album: LibraryAlbum) => void }): JSX.Element {
  const { t } = useI18n();
  const queue = usePlaybackQueue();
  const root = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState(false);
  const playbackRequest = useRef<AbortController | null>(null);
  const data = useHomeDiscovery(enabled, queue.continuousPlayPreferences);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setEnabled(true); observer.disconnect(); }
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => playbackRequest.current?.abort(), []);

  const play = async (tracks: LibraryTrack[], start = tracks[0]): Promise<void> => {
    if (!start || playbackRequest.current) return;
    const controller = new AbortController();
    playbackRequest.current = controller;
    setPending(true);
    setPlayError(null);
    try {
      const playableTracks = tracks.filter(track => !track.unavailable);
      const current = playableTracks.find(track => track.id === start.id);
      if (!current) throw new Error(t('home.error.trackNotFound', { title: start.title }));
      await queue.playTrack(current, { replaceQueueWith: playableTracks,
        source: { type: 'manual', label: t('home.discovery.daily') } });
    } catch (failure) {
      if (!controller.signal.aborted) setPlayError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (!controller.signal.aborted) setPending(false);
      if (playbackRequest.current === controller) playbackRequest.current = null;
    }
  };
  const playAlbum = async (album: LibraryAlbum): Promise<void> => {
    if (playbackRequest.current || !window.echo?.library) return;
    const controller = new AbortController();
    playbackRequest.current = controller;
    setPending(true);
    setPlayError(null);
    try {
      const tracks = await loadDiscoveryAlbumTracks(window.echo.library, album.id, controller.signal);
      if (!tracks[0]) throw new Error(t('library.albums.error.noPlayableTracks'));
      await queue.playTrack(tracks[0], { replaceQueueWith: tracks,
        source: { type: 'album', label: album.title, albumId: album.id } });
    } catch (failure) {
      if (!controller.signal.aborted) setPlayError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (!controller.signal.aborted) setPending(false);
      if (playbackRequest.current === controller) playbackRequest.current = null;
    }
  };
  const featured = data.albums[0] ?? null;
  const empty = (key: 'home.discovery.noTracks' | 'home.discovery.unplayedEmpty' | 'home.discovery.noAlbums' | 'home.discovery.yearEmpty'): JSX.Element =>
    <div className="home-discovery-empty"><Album size={24} strokeWidth={1.35} aria-hidden="true" />
      <p>{t(data.loading || !enabled ? 'home.discovery.loading' : key)}</p></div>;

  return <div className="home-discovery" ref={root}>
    <section className="home-panel home-discovery-daily" aria-label={t('home.discovery.daily')}>
      <header className="home-section-header"><h2>{t('home.discovery.daily')}</h2><div className="home-discovery-actions">
        <button type="button" disabled={!enabled || data.loading || pending} onClick={data.refreshDaily}><RefreshCw size={15} />{t('home.discovery.refresh')}</button>
        <button className="home-discovery-play" type="button" disabled={!data.daily.length || pending} onClick={() => void play(data.daily)}><Play size={14} fill="currentColor" />{t('home.discovery.play')}</button>
      </div></header>
      {data.daily.length ? <div className="home-discovery-track-grid">{data.daily.map((track, index) =>
        <HomeDailyTrackCard key={track.id} track={track} index={index} disabled={pending} current={queue.currentTrack?.id === track.id}
          onPlay={selected => void play(data.daily, selected)}
          onFeedback={() => { setPlayError(null); setFeedbackNotice(true); }} />)}
      </div> : empty('home.discovery.noTracks')}
    </section>
    {feedbackNotice ? <p className="home-discovery-feedback-status" role="status">{t('home.discovery.feedbackSaved')}</p> : null}
    <HomeShortcuts enabled={enabled} onOpenAlbum={onOpenAlbum} />
    <section className="home-panel home-discovery-unplayed" aria-label={t('home.discovery.unplayed')}>
      <header className="home-section-header"><h2>{t('home.discovery.unplayed')}</h2></header>
      {data.unplayed.length ? <HomeDiscoveryAlbumShelf albums={data.unplayed} onOpenAlbum={onOpenAlbum} /> : empty('home.discovery.unplayedEmpty')}
    </section>
    <section className="home-panel home-discovery-album" aria-label={t('home.discovery.fullAlbum')}>
      <header className="home-section-header"><h2>{t('home.discovery.fullAlbum')}</h2></header>
      {featured ? <div className="home-discovery-featured">
        <button className="home-discovery-featured-art" type="button" onClick={() => onOpenAlbum(featured)}>
          <HomeArtwork coverThumb={homeArtworkUrl(featured, 'album')} title={featured.title} size={240} />
        </button>
        <div className="home-discovery-featured-copy"><button type="button" className="home-discovery-album-title" onClick={() => onOpenAlbum(featured)}>{featured.title}</button>
          <span>{featured.albumArtist || t('queue.unknownArtist')}</span>
          <span>{[featured.year, t('home.count.tracks', { count: featured.trackCount }), formatDuration(featured.duration, t)].filter(Boolean).join(' · ')}</span>
          <button className="home-secondary-action home-discovery-play" type="button" disabled={pending} onClick={() => void playAlbum(featured)}><Play size={14} fill="currentColor" />{t('home.discovery.playAlbum')}</button>
        </div>
      </div> : empty('home.discovery.noAlbums')}
    </section>
    <section className="home-panel home-discovery-year" aria-label={t('home.discovery.year')}>
      <header className="home-section-header"><h2>{data.year ? t('home.discovery.backToYear', { year: data.year }) : t('home.discovery.year')}</h2>
        <div className="home-discovery-year-controls" role="group" aria-label={t('home.discovery.year')}>
          <button type="button" disabled={!data.year || data.year <= 1000} aria-label={t('home.discovery.previousYear')} onClick={() => data.setYear(year => year ? year - 1 : year)}><ChevronLeft size={16} /></button>
          <input key={data.year ?? 'no-year'} type="number" min={1000} max={9999} aria-label={t('home.discovery.year')}
            placeholder={t('albumTagEditor.field.year')} defaultValue={data.year ?? ''}
            onBlur={event => {
              const year = Number(event.currentTarget.value);
              if (Number.isInteger(year) && year >= 1000 && year <= 9999) data.setYear(year);
              else event.currentTarget.value = String(data.year ?? '');
            }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          <button type="button" disabled={!data.year || data.year >= 9999} aria-label={t('home.discovery.nextYear')} onClick={() => data.setYear(year => year ? year + 1 : year)}><ChevronRight size={16} /></button>
        </div>
      </header>
      {data.yearAlbums.length ? <HomeDiscoveryAlbumShelf albums={data.yearAlbums} onOpenAlbum={onOpenAlbum} /> : empty('home.discovery.yearEmpty')}
    </section>
    {data.error || playError ? <p className="home-discovery-error" role="alert">{playError ?? data.error}
      {data.error ? <button type="button" disabled={data.loading} onClick={data.retry}>{t('home.discovery.retry')}</button> : null}</p> : null}
  </div>;
}
