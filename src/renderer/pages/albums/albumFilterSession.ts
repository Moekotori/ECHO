import { isLibrarySourceMode, type LibrarySourceMode } from '../../utils/librarySourceMode';

type AlbumFilterSession = {
  sourceMode: LibrarySourceMode;
  selectedFolderId: string;
  remoteSourceId: string | null;
  searchInput: string;
};

const storageKey = 'echo-next.albums.filters';
const maxSearchLength = 4096;
const maxIdLength = 512;
const boundedString = (value: unknown, limit: number): string =>
  typeof value === 'string' && value.length <= limit ? value : '';

export const readAlbumFilterSession = (): AlbumFilterSession | null => {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw || raw.length > 32768) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const session = value as Partial<AlbumFilterSession>;
    if (!isLibrarySourceMode(session.sourceMode)) return null;
    return {
      sourceMode: session.sourceMode,
      selectedFolderId: boundedString(session.selectedFolderId, maxIdLength),
      remoteSourceId: boundedString(session.remoteSourceId, maxIdLength) || null,
      searchInput: boundedString(session.searchInput, maxSearchLength),
    };
  } catch {
    return null;
  }
};

export const writeAlbumFilterSession = (session: AlbumFilterSession): void => {
  try {
    // One small record per window; never retain album rows, covers or facets.
    window.sessionStorage.setItem(storageKey, JSON.stringify({
      sourceMode: session.sourceMode,
      selectedFolderId: boundedString(session.selectedFolderId, maxIdLength),
      remoteSourceId: boundedString(session.remoteSourceId, maxIdLength) || null,
      searchInput: boundedString(session.searchInput, maxSearchLength),
    }));
  } catch {
    // Storage failure must not prevent filtering the current page.
  }
};
