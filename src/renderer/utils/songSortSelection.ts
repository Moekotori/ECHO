import type { LibrarySort } from '../../shared/types/library';

export const directionalSortFamilies: LibrarySort[][] = [
  ['artist', 'artistDesc'],
  ['album', 'albumDesc'],
  ['titleAsc', 'titleDesc'],
  ['yearAsc', 'yearDesc'],
  ['playCountAsc', 'playCountDesc'],
  ['bpmAsc', 'bpmDesc'],
  ['audioSpecAsc', 'audioSpecDesc'],
  ['qualityAsc', 'qualityDesc'],
  ['codecAsc', 'codecDesc'],
  ['bitrateAsc', 'bitrateDesc'],
  ['durationAsc', 'durationDesc'],
  ['createdAsc', 'createdDesc'],
  ['fileModifiedAsc', 'fileModifiedDesc'],
];

const standaloneSorts = new Set<LibrarySort>(['default', 'random']);
const artistAlbumRelatedSorts = new Set<LibrarySort>([
  'artist',
  'artistDesc',
  'album',
  'albumDesc',
  'artistAlbum',
]);

export const toggleSongMultiSort = (current: LibrarySort[], selected: LibrarySort): LibrarySort[] => {
  if (standaloneSorts.has(selected)) {
    return current.length === 1 && current[0] === selected ? ['default'] : [selected];
  }

  const withoutStandalone = current.filter((sort) => !standaloneSorts.has(sort));
  const selectedIndex = withoutStandalone.indexOf(selected);
  if (selectedIndex >= 0) {
    const next = withoutStandalone.filter((_, index) => index !== selectedIndex);
    return next.length > 0 ? next : ['default'];
  }

  const family = directionalSortFamilies.find((values) => values.includes(selected));
  const oppositeIndex = family
    ? withoutStandalone.findIndex((sort) => family.includes(sort))
    : -1;
  const next = oppositeIndex >= 0
    ? withoutStandalone.map((sort, index) => index === oppositeIndex ? selected : sort)
    : [...withoutStandalone, selected];

  if (selected === 'artistAlbum') {
    return next.filter((sort) => sort === 'artistAlbum' || !artistAlbumRelatedSorts.has(sort));
  }

  if (artistAlbumRelatedSorts.has(selected)) {
    const withoutComposite = next.filter((sort) => sort !== 'artistAlbum');
    return withoutComposite.length > 0 ? withoutComposite : [selected];
  }

  return next;
};
