export type LibrarySourceMode = 'local' | 'remote';

const librarySourceModeStorageKey = 'echo-next.library.source-mode';

export const isLibrarySourceMode = (value: unknown): value is LibrarySourceMode => value === 'local' || value === 'remote';

export const readStoredLibrarySourceMode = (): LibrarySourceMode => {
  try {
    const value = window.localStorage.getItem(librarySourceModeStorageKey);
    return isLibrarySourceMode(value) ? value : 'local';
  } catch {
    return 'local';
  }
};

export const writeStoredLibrarySourceMode = (mode: LibrarySourceMode): void => {
  try {
    window.localStorage.setItem(librarySourceModeStorageKey, mode);
  } catch {
    // Source mode memory is a convenience only.
  }
};
