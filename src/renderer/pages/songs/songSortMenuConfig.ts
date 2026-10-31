import type { LibrarySort } from '../../../shared/types/library';
import type { TranslationKey } from '../../i18n/locales';

export type SongSortOption = { value: LibrarySort; labelKey: TranslationKey };
export const songSortOptionLabel = (
  option: SongSortOption | undefined,
  translate: (key: TranslationKey) => string,
): string => translate(option?.labelKey ?? 'songs.sort.default');
export const sortGroups: Array<{ labelKey: TranslationKey; options: SongSortOption[] }> = [
  {
    labelKey: 'songs.sort.group.browse',
    options: [
      { value: 'default', labelKey: 'songs.sort.default' },
      { value: 'titleAsc', labelKey: 'songs.sort.titleAsc' },
      { value: 'titleDesc', labelKey: 'songs.sort.titleDesc' },
      { value: 'artist', labelKey: 'songs.sort.artist' },
      { value: 'artistDesc', labelKey: 'songs.sort.artistDesc' },
      { value: 'artistAlbum', labelKey: 'songs.sort.artistAlbum' },
      { value: 'album', labelKey: 'songs.sort.album' },
      { value: 'albumDesc', labelKey: 'songs.sort.albumDesc' },
      { value: 'trackNumber', labelKey: 'folders.sort.trackNumber' },
      { value: 'yearDesc', labelKey: 'songs.sort.yearDesc' },
      { value: 'yearAsc', labelKey: 'songs.sort.yearAsc' },
    ],
  },
  {
    labelKey: 'songs.sort.group.listening',
    options: [
      { value: 'lastPlayed', labelKey: 'songs.sort.lastPlayed' },
      { value: 'playCountDesc', labelKey: 'songs.sort.playCountDesc' },
      { value: 'playCountAsc', labelKey: 'songs.sort.playCountAsc' },
      { value: 'bpmAsc', labelKey: 'songs.sort.bpmAsc' },
      { value: 'bpmDesc', labelKey: 'songs.sort.bpmDesc' },
      { value: 'random', labelKey: 'songs.sort.random' },
    ],
  },
  {
    labelKey: 'songs.sort.group.audio',
    options: [
      { value: 'audioSpecDesc', labelKey: 'songs.sort.audioSpecDesc' },
      { value: 'audioSpecAsc', labelKey: 'songs.sort.audioSpecAsc' },
      { value: 'qualityDesc', labelKey: 'songs.sort.qualityDesc' },
      { value: 'qualityAsc', labelKey: 'songs.sort.qualityAsc' },
      { value: 'codecAsc', labelKey: 'songs.sort.codecAsc' },
      { value: 'codecDesc', labelKey: 'songs.sort.codecDesc' },
      { value: 'durationAsc', labelKey: 'songs.sort.durationAsc' },
      { value: 'durationDesc', labelKey: 'songs.sort.durationDesc' },
      { value: 'bitrateDesc', labelKey: 'songs.sort.bitrateDesc' },
      { value: 'bitrateAsc', labelKey: 'songs.sort.bitrateAsc' },
    ],
  },
  {
    labelKey: 'songs.sort.group.library',
    options: [
      { value: 'createdDesc', labelKey: 'library.sort.createdDesc' },
      { value: 'createdAsc', labelKey: 'library.sort.createdAsc' },
      { value: 'recent', labelKey: 'songs.sort.recent' },
      { value: 'fileModifiedDesc', labelKey: 'library.sort.fileModifiedDesc' },
      { value: 'fileModifiedAsc', labelKey: 'library.sort.fileModifiedAsc' },
    ],
  },
];
export const sortOptions = sortGroups.flatMap((group) => group.options);
