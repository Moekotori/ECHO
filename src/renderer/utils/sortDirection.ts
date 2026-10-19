import { directionalSortFamilies } from './songSortSelection';

/** Each pair is ascending, descending. Only pairs present in a menu are enabled. */
export type SortDirectionPairs = ReadonlyArray<readonly string[]>;
export const librarySortDirectionPairs: SortDirectionPairs = [
  ...directionalSortFamilies,
  ['trackCountAsc', 'trackCountDesc'],
];
export const likedSortDirectionPairs: SortDirectionPairs = [
  ...librarySortDirectionPairs,
  ['addedAsc', 'recent'],
];
export const artistSortDirectionPairs: SortDirectionPairs = [
  ...librarySortDirectionPairs,
  ['trackCountAsc', 'frequent'],
];
export const genreSortDirectionPairs: SortDirectionPairs = [
  ['titleAsc', 'titleDesc'],
  ['trackCountAsc', 'default'],
];
export const playlistSortDirectionPairs: SortDirectionPairs = [
  ['addedAsc', 'addedDesc'],
  ['titleAsc', 'titleDesc'],
  ['artistAsc', 'artistDesc'],
  ['album', 'albumDesc'],
  ['durationAsc', 'durationDesc'],
];
export const smartPlaylistSortDirectionPairs: SortDirectionPairs = [['leastPlayed', 'mostPlayed']];

export const groupDirectionalSortOptions = <T extends { value: string; group?: string }>(
  options: readonly T[], pairs: SortDirectionPairs,
): T[][] => {
  const rows: T[][] = [];
  for (const option of options) {
    if (rows.some((row) => row.includes(option))) continue;
    const opposite = options.find((candidate) => candidate !== option && candidate.group === option.group
      && pairs.some((pair) => pair.includes(option.value) && pair.includes(candidate.value)));
    rows.push(opposite ? [option, opposite] : [option]);
  }
  return rows;
};

export const isDescendingSort = (value: string, pairs: SortDirectionPairs): boolean =>
  pairs.some((pair) => pair[1] === value);
