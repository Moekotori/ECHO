export type AlbumWallLayoutPreference = { columns: number | null; rows: number | null };
export const defaultAlbumWallLayout: AlbumWallLayoutPreference = { columns: null, rows: null };
export const albumWallMaxColumns = 12;
export const albumWallMaxRows = 6;
const storageKey = 'echo.albums.layout';

const validDimension = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max ? value : null;

export const readAlbumWallLayoutPreference = (): AlbumWallLayoutPreference => {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null');
    if (!stored || typeof stored !== 'object') return defaultAlbumWallLayout;
    const value = stored as Record<string, unknown>;
    return { columns: validDimension(value.columns, albumWallMaxColumns), rows: validDimension(value.rows, albumWallMaxRows) };
  } catch {
    return defaultAlbumWallLayout;
  }
};

export const writeAlbumWallLayoutPreference = (value: AlbumWallLayoutPreference): void => {
  try {
    if (value.columns === null && value.rows === null) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // A view preference must not block browsing when storage is unavailable.
  }
};
