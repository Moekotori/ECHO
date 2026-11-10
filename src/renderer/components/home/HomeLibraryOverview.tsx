import { Disc3, FolderOpen, UsersRound } from 'lucide-react';
import type { LibrarySummary } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';

import { EchoSongsIcon } from '../layout/NavIcons';
import './home-library-overview.css';

type LibraryRoute = 'artists' | 'albums' | 'songs' | 'folders';

export function HomeLibraryOverview({ summary, onNavigate }: {
  summary: LibrarySummary;
  onNavigate: (route: LibraryRoute) => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const formatter = new Intl.NumberFormat(locale);
  const tiles = [
    { id: 'artists', icon: UsersRound, label: t('home.metric.artists'), count: summary.artistCount },
    { id: 'albums', icon: Disc3, label: t('home.metric.albums'), count: summary.albumCount },
    { id: 'songs', icon: EchoSongsIcon, label: t('home.metric.songs'), count: summary.songCount },
    { id: 'folders', icon: FolderOpen, label: t('home.metric.folders'), count: summary.folderCount },
  ] as const;

  return (
    <section className="home-library-overview" aria-label={t('home.hero.statsAria')}>
      {tiles.map(({ id, icon: Icon, label, count }) => {
        const content = <>
          <Icon
            className="home-library-overview-icon"
            // The navigation glyph has more internal padding than the Lucide icons.
            viewBox={id === 'songs' ? '2.5 3.5 17 17' : '0 0 24 24'}
            strokeWidth={id === 'songs' ? 0.96 : 1.35}
            aria-hidden="true"
          />
          <span className="home-library-overview-copy">
            <strong>{formatter.format(count)}</strong>
            <span>{label}</span>
          </span>
        </>;
        return <button className="home-library-overview-tile" key={id} type="button"
              aria-label={t('home.metric.openAria', { label })} onClick={() => onNavigate(id)}>{content}</button>;
      })}
    </section>
  );
}
