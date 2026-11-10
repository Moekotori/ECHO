let selectedPath: string | null = null;

export const setAppWallpaperPreviewPath = (path: string): void => {
  selectedPath = path;
};

export const resolveAppWallpaperPreviewPath = (requestedPath: string | null): string | null =>
  requestedPath === selectedPath ? selectedPath : null;
