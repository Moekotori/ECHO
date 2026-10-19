import type { TranslationKey } from '../../i18n/locales';
import type { LibraryAudioFormatFilter, LibraryFileFormatFilter } from '../../../shared/types/library';

export const audioFormatFilterOptions: Array<{ value: LibraryAudioFormatFilter; labelKey: TranslationKey }> = [
  { value: 'all', labelKey: 'songs.filter.sampleRate.all' },
  { value: 'sampleRate44100', labelKey: 'songs.filter.audioFormat.sampleRate44100' },
  { value: 'sampleRate48000', labelKey: 'songs.filter.audioFormat.sampleRate48000' },
  { value: 'sampleRate88200', labelKey: 'songs.filter.audioFormat.sampleRate88200' },
  { value: 'sampleRate96000', labelKey: 'songs.filter.audioFormat.sampleRate96000' },
  { value: 'sampleRate176400', labelKey: 'songs.filter.audioFormat.sampleRate176400' },
  { value: 'sampleRate192000', labelKey: 'songs.filter.audioFormat.sampleRate192000' },
  { value: 'sampleRate352800', labelKey: 'songs.filter.audioFormat.sampleRate352800' },
  { value: 'sampleRate384000', labelKey: 'songs.filter.audioFormat.sampleRate384000' },
  { value: 'dsd', labelKey: 'songs.filter.audioFormat.dsd' },
  { value: 'otherSampleRate', labelKey: 'songs.filter.audioFormat.otherSampleRate' },
];

export const fileFormatFilterOptions: Array<{ value: LibraryFileFormatFilter; labelKey: TranslationKey }> = [
  { value: 'all', labelKey: 'songs.filter.audioFormat.all' },
  { value: 'flac', labelKey: 'songs.filter.audioFormat.flac' },
  { value: 'wav', labelKey: 'songs.filter.audioFormat.wav' },
  { value: 'aiff', labelKey: 'songs.filter.audioFormat.aiff' },
  { value: 'alac', labelKey: 'songs.filter.audioFormat.alac' },
  { value: 'dsd', labelKey: 'songs.filter.audioFormat.dsd' },
  { value: 'mp3', labelKey: 'songs.filter.audioFormat.mp3' },
  { value: 'aac', labelKey: 'songs.filter.audioFormat.aac' },
  { value: 'ogg', labelKey: 'songs.filter.audioFormat.ogg' },
  { value: 'opus', labelKey: 'songs.filter.audioFormat.opus' },
  { value: 'other', labelKey: 'songs.filter.audioFormat.other' },
];

export const audioFormatFilterGroups: Array<{
  id: 'standard' | 'hiRes' | 'other';
  labelKey: TranslationKey;
  values: Array<Exclude<LibraryAudioFormatFilter, 'all'>>;
}> = [
  {
    id: 'standard',
    labelKey: 'songs.filter.sampleRate.group.standard',
    values: ['sampleRate44100', 'sampleRate48000'],
  },
  {
    id: 'hiRes',
    labelKey: 'songs.filter.sampleRate.group.hiRes',
    values: ['sampleRate88200', 'sampleRate96000', 'sampleRate176400', 'sampleRate192000', 'sampleRate352800', 'sampleRate384000'],
  },
  {
    id: 'other',
    labelKey: 'songs.filter.sampleRate.group.other',
    values: ['dsd', 'otherSampleRate'],
  },
];

export const audioFormatFilterLabelKey = (value: LibraryAudioFormatFilter): TranslationKey =>
  audioFormatFilterOptions.find((option) => option.value === value)?.labelKey ?? 'songs.filter.sampleRate.all';

export const fileFormatFilterLabelKey = (value: LibraryFileFormatFilter): TranslationKey =>
  fileFormatFilterOptions.find((option) => option.value === value)?.labelKey ?? 'songs.filter.audioFormat.all';

export const SONGS_FILTER_YEAR_MIN = 1920;
export const SONGS_FILTER_GENRE_PAGE_SIZE = 128;
export const SONGS_FILTER_GENRE_MAX_PAGES = 2;

export const songsFilterYearValues = (
  selectedYear: number | null,
  nowYear = new Date().getFullYear(),
): number[] => {
  const maxYear = Math.max(nowYear + 1, 2026);
  const years: number[] = [];
  for (let year = maxYear; year >= SONGS_FILTER_YEAR_MIN; year -= 1) {
    years.push(year);
  }
  if (selectedYear != null && !years.includes(selectedYear)) {
    years.push(selectedYear);
    years.sort((left, right) => right - left);
  }
  return years;
};

export const mergeSongsFilterGenreNames = (
  names: readonly string[],
  selectedGenre: string,
  locale: string,
): string[] => {
  const unique = new Map<string, string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLocaleLowerCase(locale);
    if (!unique.has(key)) {
      unique.set(key, trimmed);
    }
  }

  const selected = selectedGenre.trim();
  if (selected) {
    const key = selected.toLocaleLowerCase(locale);
    if (!unique.has(key)) {
      unique.set(key, selected);
    }
  }

  return Array.from(unique.values()).sort((left, right) => left.localeCompare(right, locale));
};
