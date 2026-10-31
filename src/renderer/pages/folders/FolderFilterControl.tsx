import type { LibraryFolderInsight } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { LibraryFilterSelect } from '../../components/ui/LibraryFilterSelect';
import '../../styles/songs-filter.css';
import './folder-filters.css';
export const folderInsights: readonly LibraryFolderInsight[] = ['recentlyAdded', 'unplayed', 'lossless', 'hiRes', 'missingCover', 'missingLyrics', 'duplicates'];
export function FolderFilterControl({ value, hideDuplicates, busy, onChange, onToggleDuplicates }: {
  value: LibraryFolderInsight | null; hideDuplicates: boolean; busy: boolean;
  onChange: (value: LibraryFolderInsight | null) => void; onToggleDuplicates: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return <div className="folder-filter-controls">
    <LibraryFilterSelect value={value ?? ''} label={t('library.folderFilter.label')}
      disabled={busy} emptyLabel={t('songs.search.empty')}
      options={[{ value: '', label: t('songs.filter.condition.all') }, ...folderInsights.map((id) => ({ value: id, label: t(`library.folderFilter.${id}`) }))]}
      onChange={(next) => onChange(next ? next as LibraryFolderInsight : null)} />
    <button className="folder-toggle" type="button" aria-pressed={hideDuplicates} disabled={busy} onClick={onToggleDuplicates}>
      {busy ? t('library.folderFilter.loading') : t('library.folderFilter.hideDuplicates')}
    </button>
    {value === 'missingLyrics' ? <small className="folder-filter-note">{t('library.folderFilter.lyricsHint')}</small> : null}
  </div>;
}
