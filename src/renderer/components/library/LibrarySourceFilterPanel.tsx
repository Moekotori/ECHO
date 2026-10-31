import type { ReactNode, Ref } from 'react';
import type { LibraryFolder } from '../../../shared/types/library';
import type { RemoteSource } from '../../../shared/types/remoteSources';
import { LibrarySourceSwitch } from './LibrarySourceSwitch';
import { RemoteSourceFilter } from './RemoteSourceFilter';
import { useI18n } from '../../i18n/I18nProvider';
import type { LibrarySourceMode } from '../../utils/librarySourceMode';
import { LibraryFilterSelect, type LibraryFilterSelectOption } from '../ui/LibraryFilterSelect';

type LibrarySourceFilterPanelProps = {
  dialogRef: Ref<HTMLDivElement>;
  sourceMode: LibrarySourceMode;
  remoteSources: RemoteSource[];
  remoteSourceId: string | null;
  folders: LibraryFolder[];
  foldersLoaded: boolean;
  selectedFolderId: string;
  onSourceModeChange: (mode: LibrarySourceMode) => void;
  onRemoteSourceChange: (sourceId: string | null) => void;
  onFolderChange: (folderId: string) => void;
  onReset: () => void;
  layoutControl?: ReactNode;
};

export const LibrarySourceFilterPanel = ({
  dialogRef,
  sourceMode,
  remoteSources,
  remoteSourceId,
  folders,
  foldersLoaded,
  selectedFolderId,
  onSourceModeChange,
  onRemoteSourceChange,
  onFolderChange,
  onReset,
  layoutControl,
}: LibrarySourceFilterPanelProps): JSX.Element => {
  const { t } = useI18n();
  const activeFilterCount = sourceMode === 'remote'
    ? 1 + (remoteSourceId ? 1 : 0)
    : Number(Boolean(selectedFolderId));
  const options: LibraryFilterSelectOption[] = [
    { value: '', label: t('songs.filter.folder.all') },
    ...folders.map((folder) => ({ value: folder.id, label: folder.name, title: folder.path })),
    ...(selectedFolderId && !folders.some((folder) => folder.id === selectedFolderId)
      ? [{ value: selectedFolderId, label: selectedFolderId }]
      : []),
  ];

  return (
    <div
      ref={dialogRef}
      className="sort-menu songs-filter-menu"
      role="dialog"
      aria-label={t('songs.filter.section')}
      data-state="open"
      tabIndex={-1}
    >
      <div className="songs-filter-menu-toolbar">
        <div className="songs-filter-menu-heading">
          <strong>{t('songs.filter.section')}</strong>
          {activeFilterCount > 0 ? (
            <span className="songs-filter-active-count">{t('songs.filter.activeCount', { count: activeFilterCount })}</span>
          ) : (
            <small>{t('songs.filter.hint')}</small>
          )}
        </div>
        <button className="songs-filter-reset" type="button" disabled={activeFilterCount === 0} onClick={onReset}>
          {t('songs.filter.reset')}
        </button>
      </div>

      <div className="songs-filter-panel-body">
        <div className="songs-filter-field albums-filter-source-field">
          <span className="songs-filter-field-label">{t('library.source.aria')}</span>
          <LibrarySourceSwitch value={sourceMode} onChange={onSourceModeChange} />
        </div>

        {sourceMode === 'local' ? (
          <>
            {folders.length === 0 ? (
              <div className="songs-filter-field">
                <span>{t('songs.filter.folder')}</span>
                <small className="songs-filter-folder-empty">
                  {foldersLoaded ? t('songs.filter.folder.empty') : t('songs.filter.folder.loading')}
                </small>
              </div>
            ) : (
              <LibraryFilterSelect
                value={selectedFolderId}
                label={t('songs.filter.folder')}
                options={options}
                searchable={folders.length > 7}
                emptyLabel={t('songs.search.empty')}
                onChange={onFolderChange}
              />
            )}
          </>
        ) : (
          <div className="songs-filter-field">
            <span className="songs-filter-field-label">{t('library.source.allRemote')}</span>
            <RemoteSourceFilter sources={remoteSources} value={remoteSourceId} onChange={onRemoteSourceChange} />
          </div>
        )}
        {layoutControl}
      </div>
    </div>
  );
};
