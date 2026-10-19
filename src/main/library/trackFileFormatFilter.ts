import type { LibraryFileFormatFilter } from '../../shared/types/library';
type FormatColumns = { codec: string; sampleRate: string; path: string };
const dsdAudioFormatSql = (columns: FormatColumns): string =>
  `(UPPER(COALESCE(${columns.codec}, '')) IN ('DSF', 'DFF', 'DSD') OR COALESCE(${columns.sampleRate}, 0) >= 1000000)`;

const fileFormatSql = (columns: FormatColumns, filter: Exclude<LibraryFileFormatFilter, 'all' | 'other' | 'dsd'>): string => {
  const path = `LOWER(COALESCE(${columns.path}, ''))`;
  const codec = `UPPER(TRIM(COALESCE(${columns.codec}, '')))`;
  const codecRaw = `UPPER(COALESCE(${columns.codec}, ''))`;
  switch (filter) {
    case 'flac':
      return `(${codec} = 'FLAC' OR ${path} LIKE '%.flac')`;
    case 'mp3':
      return `(${codec} = 'MP3' OR ${codecRaw} LIKE 'MPEG%LAYER 3%' OR ${codecRaw} LIKE 'MPEG%LAYER III%' OR ${path} LIKE '%.mp3')`;
    case 'wav':
      return `(${codec} IN ('WAV', 'WAVE') OR ${path} LIKE '%.wav')`;
    case 'aiff':
      return `(${codec} IN ('AIFF', 'AIF', 'AIFC') OR ${path} LIKE '%.aiff' OR ${path} LIKE '%.aif' OR ${path} LIKE '%.aifc')`;
    case 'alac':
      return `(${codec} IN ('ALAC', 'APPLE LOSSLESS') OR ${path} LIKE '%.alac')`;
    case 'aac':
      return `(${codec} IN ('AAC', 'MP4A') OR ${codecRaw} LIKE 'AAC %' OR ${path} LIKE '%.aac')`;
    case 'ogg':
      return `(${codec} = 'OGG' OR ${codecRaw} LIKE '%VORBIS%' OR ${path} LIKE '%.ogg')`;
    case 'opus':
      return `(${codec} = 'OPUS' OR ${path} LIKE '%.opus')`;
  }
};

const knownFileFormatSql = (columns: FormatColumns): string =>
  [
    fileFormatSql(columns, 'flac'),
    fileFormatSql(columns, 'mp3'),
    fileFormatSql(columns, 'wav'),
    fileFormatSql(columns, 'aiff'),
    fileFormatSql(columns, 'alac'),
    fileFormatSql(columns, 'aac'),
    fileFormatSql(columns, 'ogg'),
    fileFormatSql(columns, 'opus'),
    dsdAudioFormatSql(columns),
  ].join(' OR ');

export const unifiedTrackFileFormatFilterSql = (
  filter: LibraryFileFormatFilter | undefined,
  columns: FormatColumns,
): string => {
  switch (filter) {
    case 'flac':
    case 'mp3':
    case 'wav':
    case 'aiff':
    case 'alac':
    case 'aac':
    case 'ogg':
    case 'opus':
      return fileFormatSql(columns, filter);
    case 'dsd':
      return dsdAudioFormatSql(columns);
    case 'other':
      return `NOT (${knownFileFormatSql(columns)})`;
    case 'all':
    default:
      return '';
  }
};
