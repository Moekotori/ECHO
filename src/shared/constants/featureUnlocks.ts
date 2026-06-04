export const downloadFeatureUnlockCode = 'RUNIT19ORVhUX0RPV05MT0FEU19VTkxPQ0tfMjAyNg==';
export const downloadFeatureUnlockPassphrase = 'genshin impact';
export const finalThemeUnlockCode = 'finalaudio';

export const isDownloadFeatureUnlockCode = (value: string): boolean =>
  value.trim() === downloadFeatureUnlockCode ||
  value.trim().toLowerCase() === downloadFeatureUnlockPassphrase;

export const isFinalThemeUnlockCode = (value: string): boolean =>
  value.trim().toLowerCase() === finalThemeUnlockCode;
