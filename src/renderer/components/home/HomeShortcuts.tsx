import { useEffect, useState } from 'react';
import { Check, Pin, Plus, Search } from 'lucide-react';
import type { LibraryAlbum } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { useImeAwareDebouncedSearch } from '../../utils/imeInput';
import { requestArtistDetailNavigation } from '../../utils/artistNavigation';
import { HomeArtwork, homeArtworkUrl } from './HomeArtwork';
import { loadShortcutSuggestions, readShortcutRefs, resolveShortcuts, shortcutKey, writeShortcutRefs,
  type HomeShortcut, type HomeShortcutRef } from './homeShortcutData';
import './home-shortcuts.css';

export function HomeShortcuts({ enabled, onOpenAlbum }: { enabled: boolean; onOpenAlbum: (album: LibraryAlbum) => void }): JSX.Element {
  const { t } = useI18n();
  const [refs, setRefs] = useState(readShortcutRefs);
  const [visible, setVisible] = useState<HomeShortcut[]>([]);
  const [suggestions, setSuggestions] = useState<HomeShortcut[]>([]);
  const [results, setResults] = useState<HomeShortcut[]>([]);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { search, searchInputProps, setSearchInput, setSearch } = useImeAwareDebouncedSearch(250);

  useEffect(() => {
    if (!enabled || !window.echo?.library?.getLikedAlbums) return;
    const library = window.echo.library;
    const controller = new AbortController();
    const run = async (): Promise<void> => {
      let resolutionFailed = false;
      let resolutionError: unknown;
      const resolved = refs ? await resolveShortcuts(library, refs, controller.signal).catch(failure => {
        controller.signal.throwIfAborted();
        resolutionFailed = true;
        resolutionError = failure;
        return null;
      }) : null;
      if (resolved) setVisible(resolved);
      const candidates = await loadShortcutSuggestions(library, controller.signal);
      setSuggestions(candidates);
      if (!refs) setVisible(candidates.slice(0, 6));
      if (resolutionFailed) throw resolutionError;
      setError(null);
    };
    void run().catch(failure => { if (!controller.signal.aborted) setError(String(failure instanceof Error ? failure.message : failure)); });
    return () => controller.abort();
  }, [enabled, refs, revision]);

  useEffect(() => {
    if (!enabled) return;
    const changed = (): void => setRevision(current => current + 1);
    window.addEventListener('library:playlists-changed', changed);
    window.addEventListener('liked:albums-changed', changed);
    window.addEventListener('library:changed', changed);
    return () => {
      window.removeEventListener('library:playlists-changed', changed);
      window.removeEventListener('liked:albums-changed', changed);
      window.removeEventListener('library:changed', changed);
    };
  }, [enabled]);

  useEffect(() => {
    const library = window.echo?.library;
    if (!editing || !library?.getArtists || !library.getAlbums) return;
    let disposed = false;
    setResults([]);
    void Promise.all([
      library.getAlbums({ page: 1, pageSize: 6, search, sourceProvider: 'local', excludeOsuAlbums: true }),
      library.getArtists({ page: 1, pageSize: 6, search, sourceProvider: 'local' }),
    ]).then(([albums, artists]) => {
      if (!disposed) setResults([
        ...albums.items.map(item => ({ kind: 'album' as const, id: item.id, item })),
        ...artists.items.map(item => ({ kind: 'artist' as const, id: item.id, item })),
      ]);
    }).catch(failure => { if (!disposed) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { disposed = true; };
  }, [editing, search]);

  const toggle = (item: HomeShortcut): void => {
    const current: HomeShortcutRef[] = refs ?? visible.map(({ kind, id }) => ({ kind, id }));
    const exists = current.some(ref => shortcutKey(ref) === shortcutKey(item));
    if (!exists && current.length >= 6) return;
    const next = exists ? current.filter(ref => shortcutKey(ref) !== shortcutKey(item)) : [...current, { kind: item.kind, id: item.id }];
    try { writeShortcutRefs(next); setRefs(next); setError(null); } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const open = (shortcut: HomeShortcut): void => {
    if (shortcut.kind === 'album') onOpenAlbum(shortcut.item);
    else requestArtistDetailNavigation(shortcut.item, { returnTo: 'home' });
  };
  const title = (shortcut: HomeShortcut): string => shortcut.kind === 'album' ? shortcut.item.title : shortcut.item.name;
  const candidates = [...new Map([...visible, ...suggestions, ...results].map(item => [shortcutKey(item), item])).values()];
  const selected = new Set((refs ?? visible).map(shortcutKey));

  return <section className="home-panel home-discovery-shortcuts" aria-label={t('home.discovery.shortcuts')}>
    <header className="home-section-header"><h2>{t('home.discovery.shortcuts')}</h2>
      <button type="button" aria-expanded={editing} onClick={() => setEditing(current => !current)}>
        {editing ? <Check size={15} /> : <Pin size={15} />}{t(editing ? 'home.discovery.done' : 'home.discovery.manage')}
      </button>
    </header>
    {!editing && (visible.length ? <div className="home-discovery-shortcut-grid">{visible.map(shortcut =>
      <button type="button" className="home-discovery-shortcut" key={shortcutKey(shortcut)} onClick={() => open(shortcut)}>
        <HomeArtwork coverThumb={homeArtworkUrl(shortcut.item, 'thumb')} title={title(shortcut)} size={88} />
        <span><strong>{title(shortcut)}</strong><small>{t(`home.discovery.kind.${shortcut.kind}`)}</small></span>
      </button>)}
    </div> : <div className="home-discovery-empty"><Pin size={24} strokeWidth={1.35} aria-hidden="true" />
      <p>{t('home.discovery.shortcutsEmpty')}</p></div>)}
    {editing ? <div className="home-discovery-shortcut-editor">
      <div className="home-shortcut-editor-toolbar">
        <label className="echo-search-field home-discovery-search"><Search size={17} aria-hidden="true" />
          <input {...searchInputProps} type="search" maxLength={200} autoFocus
            aria-label={t('home.discovery.search')} placeholder={t('home.discovery.search')} />
          {searchInputProps.value ? <button type="button" onClick={() => { setSearchInput(''); setSearch(''); }}>{t('home.discovery.clear')}</button> : null}
        </label>
        <span className="home-shortcut-selection-count" role="status" aria-live="polite">
          <Pin size={14} aria-hidden="true" /><span>{selected.size} / 6</span>
        </span>
      </div>
      <div className="home-discovery-pin-options">{candidates.map(shortcut => {
        const pinned = selected.has(shortcutKey(shortcut));
        return <button type="button" key={shortcutKey(shortcut)} aria-pressed={pinned}
          title={title(shortcut)}
          disabled={!pinned && selected.size >= 6} onClick={() => toggle(shortcut)}>
          <HomeArtwork coverThumb={homeArtworkUrl(shortcut.item, 'thumb')} title={title(shortcut)} size={40} />
          <span className="home-shortcut-option-copy"><strong>{title(shortcut)}</strong>
            <small>{[t(`home.discovery.kind.${shortcut.kind}`), shortcut.kind === 'album' ? shortcut.item.albumArtist : null].filter(Boolean).join(' · ')}</small>
          </span>
          {pinned ? <Check className="home-shortcut-option-state" size={17} aria-hidden="true" />
            : <Plus className="home-shortcut-option-state" size={17} aria-hidden="true" />}
        </button>;
      })}</div>
    </div> : null}
    {error ? <p className="home-discovery-error" role="alert">{error}<button type="button" onClick={() => setRevision(current => current + 1)}>{t('home.discovery.retry')}</button></p> : null}
  </section>;
}
