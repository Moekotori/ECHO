import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { LibraryAudioFormatFilter, LibraryFileFormatFilter, LibraryFolder } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import type { LibrarySourceMode } from '../../utils/librarySourceMode';
import {
  audioFormatFilterOptions,
  fileFormatFilterOptions,
  mergeSongsFilterGenreNames,
  songsFilterYearValues,
} from './songsFilterOptions';
import { parseFilterYearDraft } from './songsFilterSearch';
import { LibraryFilterSelect, type LibraryFilterSelectOption } from '../../components/ui/LibraryFilterSelect';

type SongsFilterPanelProps = {
  dialogRef?: Ref<HTMLDivElement>;
  sourceMode: LibrarySourceMode;
  showDuplicatesOnly: boolean;
  showOsuOnly: boolean;
  onToggleOsu: () => void;
  audioFormatFilter: LibraryAudioFormatFilter;
  fileFormatFilter: LibraryFileFormatFilter;
  folders: LibraryFolder[];
  foldersLoaded: boolean;
  selectedFolderIds: string[];
  filterYear: number | null;
  filterGenre: string;
  activeFilterCount: number;
  onToggleDuplicates: () => void;
  onAudioFormatChange: (value: LibraryAudioFormatFilter) => void;
  onFileFormatChange: (value: LibraryFileFormatFilter) => void;
  onFolderIdsChange: (folderIds: string[]) => void;
  onYearChange: (year: number | null) => void;
  onGenreChange: (genre: string) => void;
  onReset: () => void;
};

const genreNamesCache = new Map<LibrarySourceMode, readonly string[]>();
const genreNamesCachedAt = new Map<LibrarySourceMode, number>();
const genreNamesRequestCache = new Map<LibrarySourceMode, Promise<readonly string[]>>();

const readGenreNames = async (sourceMode: LibrarySourceMode): Promise<readonly string[]> => {
  const cached = genreNamesCache.get(sourceMode);
  if (cached && Date.now() - (genreNamesCachedAt.get(sourceMode) ?? 0) < 60_000) {
    return cached;
  }

  const pending = genreNamesRequestCache.get(sourceMode);
  if (pending) {
    return pending;
  }

  const request = (async (): Promise<readonly string[]> => {
    const getGenres = window.echo?.library?.getSongFilterGenres;
    if (!getGenres) return [];
    const boundedNames = (await getGenres(sourceMode)).slice(0, 256);
    genreNamesCache.set(sourceMode, boundedNames);
    genreNamesCachedAt.set(sourceMode, Date.now());
    return boundedNames;
  })();

  genreNamesRequestCache.set(sourceMode, request);
  try {
    return await request;
  } finally {
    genreNamesRequestCache.delete(sourceMode);
  }
};

export const SongsFilterPanel = ({
  dialogRef,
  sourceMode,
  showDuplicatesOnly,
  showOsuOnly,
  onToggleOsu,
  audioFormatFilter,
  fileFormatFilter,
  folders,
  foldersLoaded,
  selectedFolderIds,
  filterYear,
  filterGenre,
  activeFilterCount,
  onToggleDuplicates,
  onAudioFormatChange,
  onFileFormatChange,
  onFolderIdsChange,
  onYearChange,
  onGenreChange,
  onReset,
}: SongsFilterPanelProps): JSX.Element => {
  const { locale, t } = useI18n();
  const [loadedGenreNames, setLoadedGenreNames] = useState<readonly string[]>(() => genreNamesCache.get(sourceMode) ?? []);
  const [genresLoading, setGenresLoading] = useState(false);
  const requestGeneration = useRef(0);
  useEffect(() => () => { requestGeneration.current += 1; }, [sourceMode]);

  useEffect(() => {
    setLoadedGenreNames(genreNamesCache.get(sourceMode) ?? []);
    setGenresLoading(false);
  }, [sourceMode]);

  const loadGenres = useCallback((): void => {
    if ((genreNamesCache.has(sourceMode) && Date.now() - (genreNamesCachedAt.get(sourceMode) ?? 0) < 60_000) || genresLoading) {
      return;
    }

    const generation = requestGeneration.current;
    setGenresLoading(true);
    void readGenreNames(sourceMode)
      .then((names) => {
        if (generation === requestGeneration.current) setLoadedGenreNames(names);
      })
      .catch(() => {
        if (generation === requestGeneration.current) setLoadedGenreNames([]);
      })
      .finally(() => {
        if (generation === requestGeneration.current) setGenresLoading(false);
      });
  }, [genresLoading, sourceMode]);

  const selectedFolderId = selectedFolderIds[0] ?? '';
  const yearOptions = useMemo(() => songsFilterYearValues(filterYear), [filterYear]);
  const genreOptions = useMemo(
    () => mergeSongsFilterGenreNames(loadedGenreNames, filterGenre, locale),
    [filterGenre, loadedGenreNames, locale],
  );
  const emptyLabel = t('songs.search.empty');
  const conditionOptions = useMemo<readonly LibraryFilterSelectOption[]>(() => [
    { value: 'all', label: t('songs.filter.condition.all') },
    { value: 'duplicates', label: t('songs.duplicatesOnly') },
    { value: 'osu', label: t('songs.osuOnly') },
  ], [t]);
  const folderOptions = useMemo<readonly LibraryFilterSelectOption[]>(() => [
    { value: '', label: t('songs.filter.folder.all') },
    ...folders.map((folder) => ({ value: folder.id, label: folder.name, title: folder.path })),
    ...(selectedFolderId && !folders.some((folder) => folder.id === selectedFolderId)
      ? [{ value: selectedFolderId, label: selectedFolderId }]
      : []),
  ], [folders, selectedFolderId, t]);
  const formatOptions = useMemo<readonly LibraryFilterSelectOption[]>(
    () => fileFormatFilterOptions.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [t],
  );
  const sampleRateOptions = useMemo<readonly LibraryFilterSelectOption[]>(
    () => audioFormatFilterOptions.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [t],
  );
  const releaseYearOptions = useMemo<readonly LibraryFilterSelectOption[]>(() => [
    { value: '', label: t('songs.filter.year.all') },
    ...yearOptions.map((year) => ({ value: String(year), label: String(year) })),
  ], [t, yearOptions]);
  const genreSelectOptions = useMemo<readonly LibraryFilterSelectOption[]>(() => [
    { value: '', label: t('songs.filter.genre.all') },
    ...genreOptions.map((genre) => ({ value: genre, label: genre })),
  ], [genreOptions, t]);

  return (
    <div
      ref={dialogRef}
      className="sort-menu songs-filter-menu"
      role="dialog"
      aria-label={t('songs.filter.menuAria')}
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
        <button
          className="songs-filter-reset"
          type="button"
          disabled={activeFilterCount === 0}
          onClick={onReset}
        >
          {t('songs.filter.reset')}
        </button>
      </div>

      <div className="songs-filter-panel-body">
        <LibraryFilterSelect
          value={showOsuOnly ? 'osu' : showDuplicatesOnly ? 'duplicates' : 'all'}
          label={t('songs.filter.condition')}
          options={conditionOptions}
          emptyLabel={emptyLabel}
          onChange={(value) => {
            if ((value === 'osu') !== showOsuOnly) onToggleOsu();
            const nextDuplicatesOnly = value === 'duplicates';
            if (nextDuplicatesOnly !== showDuplicatesOnly) {
              onToggleDuplicates();
            }
          }}
        />

        {sourceMode === 'local' ? (
          folders.length === 0 ? (
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
              options={folderOptions}
              searchable={folders.length > 7}
              emptyLabel={emptyLabel}
              onChange={(folderId) => onFolderIdsChange(folderId ? [folderId] : [])}
            />
          )
        ) : null}

        <LibraryFilterSelect
          value={fileFormatFilter}
          label={t('songs.filter.audioFormat')}
          options={formatOptions}
          emptyLabel={emptyLabel}
          onChange={(value) => onFileFormatChange(value as LibraryFileFormatFilter)}
        />

        <LibraryFilterSelect
          value={audioFormatFilter}
          label={t('songs.filter.sampleRate')}
          options={sampleRateOptions}
          emptyLabel={emptyLabel}
          onChange={(value) => onAudioFormatChange(value as LibraryAudioFormatFilter)}
        />

        <LibraryFilterSelect
          value={filterYear == null ? '' : String(filterYear)}
          label={t('songs.filter.year')}
          ariaLabel={t('songs.filter.year.aria')}
          options={releaseYearOptions}
          searchable
          emptyLabel={emptyLabel}
          onChange={(value) => {
            const parsed = parseFilterYearDraft(value);
            if (parsed === undefined || parsed === filterYear) {
              return;
            }
            onYearChange(parsed);
          }}
        />

        <LibraryFilterSelect
          value={filterGenre}
          label={t('songs.filter.genre')}
          ariaLabel={t('songs.filter.genre.aria')}
          options={genreSelectOptions}
          loading={genresLoading}
          searchable
          emptyLabel={emptyLabel}
          onOpen={loadGenres}
          onChange={(value) => {
            if (value !== filterGenre) {
              onGenreChange(value);
            }
          }}
        />
      </div>

    </div>
  );
};
