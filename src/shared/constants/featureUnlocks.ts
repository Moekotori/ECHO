export const downloadFeatureUnlockCode = 'RUNIT19ORVhUX0RPV05MT0FEU19VTkxPQ0tfMjAyNg==';
export const downloadFeatureUnlockPassphrase = 'genshin impact';
export const finalThemeUnlockPluginId = 'echo.final-theme-unlock';
export const finalThemeUnlockVersion = `plugin:${finalThemeUnlockPluginId}:v1`;

export const isDownloadFeatureUnlockCode = (value: string): boolean =>
  value.trim() === downloadFeatureUnlockCode ||
  value.trim().toLowerCase() === downloadFeatureUnlockPassphrase;

export const isFinalThemeUnlockCode = (_value: string): boolean => false;
