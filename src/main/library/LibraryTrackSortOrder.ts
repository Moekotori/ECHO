import type { LibrarySort } from '../../shared/types/library';
const libraryTextOrderSql = (column: string, direction: 'ASC' | 'DESC'): string => `${column} COLLATE NOCASE ${direction}`;

const qualifyColumn = (column: string, tablePrefix: string): string =>
  tablePrefix ? `${tablePrefix}${column}` : column;

const clausesForSort = (sort: LibrarySort, tablePrefix: string): string[] => {
  const column = (name: string): string => qualifyColumn(name, tablePrefix);

  switch (sort) {
    case 'artist':
      return [libraryTextOrderSql(column('artist'), 'ASC')];
    case 'artistDesc':
      return [libraryTextOrderSql(column('artist'), 'DESC')];
    case 'artistAlbum':
      return [
        libraryTextOrderSql(column('artist'), 'ASC'),
        libraryTextOrderSql(column('album'), 'ASC'),
        `COALESCE(${column('disc_no')}, 0) ASC`,
        `COALESCE(${column('track_no')}, 999999) ASC`,
      ];
    case 'album':
      return [
        libraryTextOrderSql(column('album'), 'ASC'),
        `COALESCE(${column('disc_no')}, 0) ASC`,
        `COALESCE(${column('track_no')}, 999999) ASC`,
      ];
    case 'albumDesc':
      return [
        libraryTextOrderSql(column('album'), 'DESC'),
        `COALESCE(${column('disc_no')}, 0) ASC`,
        `COALESCE(${column('track_no')}, 999999) ASC`,
      ];
    case 'recent':
      return [`${column('updated_at')} DESC`];
    case 'lastPlayed':
      return [`(${column('last_played_at')} IS NULL) ASC`, `${column('last_played_at')} DESC`];
    case 'playCountAsc':
      return [`COALESCE(${column('play_count')}, 0) ASC`];
    case 'playCountDesc':
    case 'frequent':
      return [`COALESCE(${column('play_count')}, 0) DESC`];
    case 'yearAsc':
      return [`(${column('year')} IS NULL) ASC`, `${column('year')} ASC`];
    case 'yearDesc':
      return [`(${column('year')} IS NULL) ASC`, `${column('year')} DESC`];
    case 'createdAsc':
      return [`${column('created_at')} ASC`];
    case 'createdDesc':
      return [`${column('created_at')} DESC`];
    case 'titleDesc':
      return [libraryTextOrderSql(column('title'), 'DESC')];
    case 'durationAsc':
      return [`${column('duration')} ASC`];
    case 'durationDesc':
      return [`${column('duration')} DESC`];
    case 'fileModifiedAsc':
      return [`${column('mtime_ms')} ASC`];
    case 'fileModifiedDesc':
      return [`${column('mtime_ms')} DESC`];
    case 'qualityAsc':
      return [`COALESCE(${column('bitrate')}, 0) ASC`, `${column('size_bytes')} ASC`];
    case 'qualityDesc':
      return [`COALESCE(${column('bitrate')}, 0) DESC`, `${column('size_bytes')} DESC`];
    case 'codecAsc':
      return [`COALESCE(${column('codec')}, '') COLLATE NOCASE ASC`];
    case 'codecDesc':
      return [`COALESCE(${column('codec')}, '') COLLATE NOCASE DESC`];
    case 'audioSpecAsc':
      return [
        `(${column('sample_rate')} IS NULL OR ${column('sample_rate')} <= 0) ASC`,
        `${column('sample_rate')} ASC`,
        `(${column('bit_depth')} IS NULL OR ${column('bit_depth')} <= 0) ASC`,
        `${column('bit_depth')} ASC`,
      ];
    case 'audioSpecDesc':
      return [
        `(${column('sample_rate')} IS NULL OR ${column('sample_rate')} <= 0) ASC`,
        `${column('sample_rate')} DESC`,
        `(${column('bit_depth')} IS NULL OR ${column('bit_depth')} <= 0) ASC`,
        `${column('bit_depth')} DESC`,
      ];
    case 'bitrateAsc':
      return [`COALESCE(${column('bitrate')}, 0) ASC`];
    case 'bitrateDesc':
      return [`COALESCE(${column('bitrate')}, 0) DESC`];
    case 'bpmAsc':
      return [`(${column('bpm')} IS NULL OR ${column('bpm')} <= 0) ASC`, `${column('bpm')} ASC`];
    case 'bpmDesc':
      return [`(${column('bpm')} IS NULL OR ${column('bpm')} <= 0) ASC`, `${column('bpm')} DESC`];
    case 'trackNumber':
      return [
        `(${column('track_no')} IS NULL) ASC`,
        `COALESCE(${column('disc_no')}, 1) ASC`,
        `COALESCE(${column('track_no')}, 0) ASC`,
      ];
    case 'random':
      return ['RANDOM()'];
    case 'titleAsc':
    case 'title':
    case 'default':
    default:
      return [libraryTextOrderSql(column('title'), 'ASC')];
  }
};

const stableClausesForPrimarySort = (sort: LibrarySort, tablePrefix: string): string[] => {
  const column = (name: string): string => qualifyColumn(name, tablePrefix);

  switch (sort) {
    case 'playCountAsc':
    case 'playCountDesc':
    case 'frequent':
      return [`${column('last_played_at')} DESC`];
    case 'titleDesc':
      return [libraryTextOrderSql(column('artist'), 'ASC')];
    case 'trackNumber':
      return [libraryTextOrderSql(column('title'), 'ASC'), `${column('path')} COLLATE NOCASE ASC`];
    default:
      return [];
  }
};

export const unifiedTrackOrderSql = (sorts: LibrarySort[], searchActive = false, tablePrefix = ''): string => {
  const activeSorts: LibrarySort[] = sorts.length > 0 ? sorts : ['default'];
  if (activeSorts[0] === 'random') {
    return 'ORDER BY RANDOM()';
  }

  const clauses = activeSorts.flatMap((sort) => clausesForSort(sort, tablePrefix));
  if (searchActive && activeSorts[0] === 'default') {
    clauses.unshift('search_rank ASC');
  }
  clauses.push(
    ...stableClausesForPrimarySort(activeSorts[0], tablePrefix),
    libraryTextOrderSql(qualifyColumn('title', tablePrefix), 'ASC'),
    libraryTextOrderSql(qualifyColumn('artist', tablePrefix), 'ASC'),
    `${qualifyColumn('id', tablePrefix)} ASC`,
  );

  return `ORDER BY ${Array.from(new Set(clauses)).join(', ')}`;
};
