import type { LibrarySort } from '../../shared/types/library';

export const readStoredLibrarySort = (
  storageKey: string,
  validSortValues: ReadonlySet<LibrarySort>,
  fallback: LibrarySort = 'default',
): LibrarySort => {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored && validSortValues.has(stored as LibrarySort) ? (stored as LibrarySort) : fallback;
  } catch {
    return fallback;
  }
};

export const writeStoredLibrarySort = (storageKey: string, sort: LibrarySort): void => {
  try {
    window.localStorage.setItem(storageKey, sort);
  } catch {
    // Sort memory is only a view preference and must not block library browsing.
  }
};
