import type { LibraryAlbum, LibraryArtist } from '../../../shared/types/library';
import type { HomeDiscoveryLibrary } from './homeDiscoveryData';

export type HomeShortcutRef = { kind: 'album' | 'artist'; id: string };
export type HomeShortcut =
  | { kind: 'album'; id: string; item: LibraryAlbum }
  | { kind: 'artist'; id: string; item: LibraryArtist };
const storageKey = 'echo.home-shortcuts.v1';
export const shortcutKey = (item: HomeShortcutRef): string => `${item.kind}:${item.id}`;

export function readShortcutRefs(): HomeShortcutRef[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw || raw.length > 8192) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((ref): ref is HomeShortcutRef => ref && typeof ref.id === 'string' && ref.id.length < 256
      && ['album', 'artist'].includes(ref.kind)).slice(0, 6);
  } catch { return null; }
}

export function writeShortcutRefs(refs: HomeShortcutRef[]): void {
  window.localStorage.setItem(storageKey, JSON.stringify(refs.slice(0, 6).map(({ kind, id }) => ({ kind, id }))));
}

export async function loadShortcutSuggestions(library: HomeDiscoveryLibrary, signal: AbortSignal): Promise<HomeShortcut[]> {
  const shortcuts: HomeShortcut[] = [];
  const liked = await library.getLikedAlbums({ page: 1, pageSize: 6 });
  signal.throwIfAborted();
  for (const row of liked.items) {
    if (row.album && !row.unavailable) shortcuts.push({ kind: 'album', id: row.album.id, item: row.album });
  }
  return shortcuts;
}

export async function resolveShortcuts(library: HomeDiscoveryLibrary, refs: HomeShortcutRef[], signal: AbortSignal): Promise<HomeShortcut[]> {
  const shortcuts: HomeShortcut[] = [];
  for (const ref of refs.slice(0, 6)) {
    signal.throwIfAborted();
    if (ref.kind === 'album') {
      const item = await library.getAlbum(ref.id);
      if (item) shortcuts.push({ ...ref, kind: 'album', item });
    } else if (ref.kind === 'artist') {
      const item = await library.getArtist(ref.id);
      if (item) shortcuts.push({ ...ref, kind: 'artist', item });
    }
    signal.throwIfAborted();
  }
  return shortcuts;
}
