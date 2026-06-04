import type { AppearancePreferences } from '../../shared/types/appSettings';
import { getAppBridge } from '../utils/echoBridge';

export type { AppearancePreferences } from '../../shared/types/appSettings';

export type AppearanceFontSlot = 'main' | 'chinese' | 'fallback' | 'lyrics' | 'desktopLyrics';

export type AppearanceFontFile = {
  path: string;
  family: string;
  dataUrl: string;
};

const storageKey = 'echo-next:appearance-preferences';

export const defaultAppearancePreferences: AppearancePreferences = {
  mainFontFamily: 'Outfit',
  mainFontFilePath: null,
  chineseFontFamily: 'Microsoft YaHei',
  chineseFontFilePath: null,
  fallbackFontFamily: 'Noto Sans SC',
  fallbackFontFilePath: null,
  baseFontSize: 14,
  lineHeight: 1.35,
  textDepth: 62,
  albumCoverShape: 'rounded',
};

const childrenDoodleDefaultFontPreferences = {
  mainFontFamily: 'Monocraft',
  chineseFontFamily: 'ZCOOL Happy',
  fallbackFontFamily: defaultAppearancePreferences.fallbackFontFamily,
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeFontName = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.replace(/[\r\n;]/g, '').trim();
  return normalized || fallback;
};

const normalizeFontPath = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/[\r\n]/g, '').trim();
  return normalized || null;
};

const normalizeAlbumCoverShape = (value: unknown): AppearancePreferences['albumCoverShape'] =>
  value === 'square' ? 'square' : 'rounded';

const normalizePreferences = (value: Partial<AppearancePreferences>): AppearancePreferences => ({
  mainFontFamily: normalizeFontName(value.mainFontFamily, defaultAppearancePreferences.mainFontFamily),
  mainFontFilePath: normalizeFontPath(value.mainFontFilePath),
  chineseFontFamily: normalizeFontName(value.chineseFontFamily, defaultAppearancePreferences.chineseFontFamily),
  chineseFontFilePath: normalizeFontPath(value.chineseFontFilePath),
  fallbackFontFamily: normalizeFontName(value.fallbackFontFamily, defaultAppearancePreferences.fallbackFontFamily),
  fallbackFontFilePath: normalizeFontPath(value.fallbackFontFilePath),
  baseFontSize: clamp(Number(value.baseFontSize) || defaultAppearancePreferences.baseFontSize, 12, 18),
  lineHeight: clamp(Number(value.lineHeight) || defaultAppearancePreferences.lineHeight, 1.1, 1.8),
  textDepth: clamp(Number(value.textDepth) || defaultAppearancePreferences.textDepth, 35, 100),
  albumCoverShape: normalizeAlbumCoverShape(value.albumCoverShape),
});

const hasDefaultFontPreferences = (preferences: AppearancePreferences): boolean =>
  preferences.mainFontFamily === defaultAppearancePreferences.mainFontFamily &&
  preferences.mainFontFilePath === defaultAppearancePreferences.mainFontFilePath &&
  preferences.chineseFontFamily === defaultAppearancePreferences.chineseFontFamily &&
  preferences.chineseFontFilePath === defaultAppearancePreferences.chineseFontFilePath &&
  preferences.fallbackFontFamily === defaultAppearancePreferences.fallbackFontFamily &&
  preferences.fallbackFontFilePath === defaultAppearancePreferences.fallbackFontFilePath;

export const serializeFontList = (value: string): string => {
  const families = value
    .split(',')
    .map((family) => family.trim())
    .filter(Boolean);

  return families.length ? families.map((family) => JSON.stringify(family.replace(/^["']|["']$/g, ''))).join(', ') : JSON.stringify(value);
};

export const readAppearancePreferences = (): AppearancePreferences => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return defaultAppearancePreferences;
    }

    return normalizePreferences(JSON.parse(raw) as Partial<AppearancePreferences>);
  } catch {
    return defaultAppearancePreferences;
  }
};

export const writeAppearancePreferences = (preferences: AppearancePreferences): AppearancePreferences => {
  const normalized = normalizePreferences(preferences);
  window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
};

export const loadPersistedAppearancePreferences = async (): Promise<AppearancePreferences> => {
  const appBridge = getAppBridge();
  const localPreferences = readAppearancePreferences();

  if (!appBridge) {
    return localPreferences;
  }

  const settings = await appBridge.getSettings();
  const shouldMigrateLocalPreferences =
    (settings.appMemoryVersion ?? 0) < 1 && JSON.stringify(localPreferences) !== JSON.stringify(defaultAppearancePreferences);
  const preferences = shouldMigrateLocalPreferences
    ? localPreferences
    : normalizePreferences(settings.appearancePreferences ?? defaultAppearancePreferences);

  writeAppearancePreferences(preferences);

  if (shouldMigrateLocalPreferences) {
    void appBridge.setSettings({ appearancePreferences: preferences }).catch(() => undefined);
  }

  return preferences;
};

export const applyAppearancePreferences = (preferences: AppearancePreferences): void => {
  const normalized = normalizePreferences(preferences);
  const root = document.documentElement;
  const isDarkTheme = root.dataset.theme === 'dark';
  const shouldUseChildrenDoodleDefaultFonts = root.dataset.themePreset === 'childrenDoodle' && hasDefaultFontPreferences(normalized);
  const effectiveMainFontFamily = shouldUseChildrenDoodleDefaultFonts
    ? childrenDoodleDefaultFontPreferences.mainFontFamily
    : normalized.mainFontFamily;
  const effectiveChineseFontFamily = shouldUseChildrenDoodleDefaultFonts
    ? childrenDoodleDefaultFontPreferences.chineseFontFamily
    : normalized.chineseFontFamily;
  const effectiveFallbackFontFamily = shouldUseChildrenDoodleDefaultFonts
    ? childrenDoodleDefaultFontPreferences.fallbackFontFamily
    : normalized.fallbackFontFamily;
  const textLightness = isDarkTheme
    ? clamp(66 + normalized.textDepth * 0.28, 78, 94)
    : clamp(54 - normalized.textDepth * 0.42, 12, 40);
  const mutedLightness = isDarkTheme ? clamp(textLightness - 18, 58, 76) : clamp(textLightness + 20, 38, 62);
  const subtleLightness = isDarkTheme ? clamp(textLightness - 34, 42, 58) : clamp(textLightness + 34, 52, 74);
  const fontStack = [
    serializeFontList(effectiveMainFontFamily),
    serializeFontList(effectiveChineseFontFamily),
    serializeFontList(effectiveFallbackFontFamily),
    'ui-sans-serif',
    'system-ui',
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    '"PingFang SC"',
    '"Hiragino Sans"',
    '"Yu Gothic"',
    'sans-serif',
  ].join(', ');

  root.dataset.albumCoverShape = normalized.albumCoverShape;
  root.style.setProperty('--echo-font-family', fontStack);
  root.style.setProperty('--echo-base-font-size', `${normalized.baseFontSize}px`);
  root.style.setProperty('--echo-ui-line-height', normalized.lineHeight.toFixed(2));
  root.style.setProperty('--echo-album-cover-radius', normalized.albumCoverShape === 'square' ? '0px' : '12px');
  root.style.setProperty('--color-text', `hsl(214 ${isDarkTheme ? 24 : 30}% ${textLightness.toFixed(1)}%)`);
  root.style.setProperty('--color-muted', `hsl(214 ${isDarkTheme ? 14 : 18}% ${mutedLightness.toFixed(1)}%)`);
  root.style.setProperty('--color-subtle', `hsl(214 ${isDarkTheme ? 10 : 14}% ${subtleLightness.toFixed(1)}%)`);
  root.style.setProperty(
    '--echo-heading-text',
    `hsl(214 ${isDarkTheme ? 28 : 30}% ${(isDarkTheme ? Math.min(textLightness + 6, 96) : Math.max(textLightness - 3, 12)).toFixed(1)}%)`,
  );
};

const loadedFontFaces = new Map<AppearanceFontSlot, FontFace>();

export const registerAppearanceFontFile = async (slot: AppearanceFontSlot, fontFile: AppearanceFontFile): Promise<string> => {
  const fallbackFamily =
    slot === 'main'
      ? defaultAppearancePreferences.mainFontFamily
      : slot === 'chinese'
        ? defaultAppearancePreferences.chineseFontFamily
        : slot === 'fallback'
          ? defaultAppearancePreferences.fallbackFontFamily
          : slot === 'lyrics'
            ? 'Microsoft YaHei'
            : defaultAppearancePreferences.mainFontFamily;
  const family = normalizeFontName(fontFile.family, fallbackFamily);
  const fontFace = new FontFace(family, `url("${fontFile.dataUrl}")`);
  const loadedFontFace = await fontFace.load();
  const previousFontFace = loadedFontFaces.get(slot);

  if (previousFontFace) {
    document.fonts.delete(previousFontFace);
  }

  document.fonts.add(loadedFontFace);
  loadedFontFaces.set(slot, loadedFontFace);
  return family;
};

export const updateAppearancePreferences = (preferences: AppearancePreferences): AppearancePreferences => {
  const normalized = writeAppearancePreferences(preferences);
  applyAppearancePreferences(normalized);
  void getAppBridge()?.setSettings({ appearancePreferences: normalized }).catch(() => undefined);
  return normalized;
};
