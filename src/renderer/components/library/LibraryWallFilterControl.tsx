import { ChevronDown, ListFilter } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LibraryFolder } from '../../../shared/types/library';
import type { RemoteSource } from '../../../shared/types/remoteSources';
import { useI18n } from '../../i18n/I18nProvider';
import type { LibrarySourceMode } from '../../utils/librarySourceMode';
import { LibrarySourceFilterPanel } from './LibrarySourceFilterPanel';
import '../../styles/songs-filter.css';

type Props = {
  sourceMode: LibrarySourceMode; remoteSources: RemoteSource[]; remoteSourceId: string | null;
  selectedFolderId: string; onSourceModeChange: (mode: LibrarySourceMode) => void;
  onRemoteSourceChange: (id: string | null) => void; onFolderChange: (id: string) => void;
};
export function LibraryWallFilterControl(props: Props): JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props); propsRef.current = props;
  useEffect(() => {
    const invalidate = (): void => { setLoaded(false); setRevision((value) => value + 1); };
    window.addEventListener('library:changed', invalidate);
    return () => window.removeEventListener('library:changed', invalidate);
  }, []);
  useEffect(() => {
    if (!isOpen || props.sourceMode !== 'local' || loaded) return;
    let cancelled = false;
    const getFolders = window.echo?.library?.getFolders;
    if (!getFolders) { setLoaded(true); return; }
    void getFolders().then((items) => {
      if (cancelled) return;
      const active = items.filter((folder) => folder.status === 'active');
      setFolders(active); setLoaded(true);
      const current = propsRef.current;
      if (current.selectedFolderId && !active.some((folder) => folder.id === current.selectedFolderId)) current.onFolderChange('');
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [isOpen, loaded, props.sourceMode, revision]);
  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Element;
      if (!target.closest?.('[data-songs-filter-floating="true"]') && !rootRef.current?.contains(target)) setIsOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) { setIsOpen(false); rootRef.current?.querySelector('button')?.focus(); }
    };
    window.addEventListener('pointerdown', onPointer); window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onPointer); window.removeEventListener('keydown', onKey); };
  }, [isOpen]);
  const count = props.sourceMode === 'remote' ? 1 + Number(Boolean(props.remoteSourceId)) : Number(Boolean(props.selectedFolderId));
  const name = props.sourceMode === 'remote'
    ? props.remoteSources.find((source) => source.id === props.remoteSourceId)?.displayName ?? t('library.source.remote')
    : folders.find((folder) => folder.id === props.selectedFolderId)?.name ?? props.selectedFolderId;
  const title = count ? `${t('songs.filter.button')} · ${name}` : t('songs.filter.button');
  return <div className="sort-select" ref={rootRef}>
    <button className="sort-button" type="button" aria-haspopup="dialog" aria-expanded={isOpen}
      aria-label={title} title={title} onClick={() => setIsOpen((value) => !value)}>
      <ListFilter size={16} className={count ? 'sort-button-icon sort-button-icon--active' : 'sort-button-icon'} />
      <span className="sort-button-label">{t('songs.filter.button')}</span>
      {count ? <span className="sort-button-filter-count">{count}</span> : null}<ChevronDown size={15} />
    </button>
    {isOpen ? <LibrarySourceFilterPanel dialogRef={dialogRef} {...props} folders={folders} foldersLoaded={loaded}
      onReset={() => { props.onFolderChange(''); props.onRemoteSourceChange(null); props.onSourceModeChange('local'); }} /> : null}
  </div>;
}
