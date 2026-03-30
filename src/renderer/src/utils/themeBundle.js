import { normalizeThemeColors } from "./themeColors";

export const THEME_BUNDLE_VERSION = 1;

/** 导入/导出时参与的字段（不含壁纸路径，避免跨机失效；见 merge） */
export function pickThemeExportSlice(config) {
  return {
    v: THEME_BUNDLE_VERSION,
    theme: config.theme,
    customColors: config.customColors
      ? normalizeThemeColors(config.customColors)
      : undefined,
    uiBgOpacity: config.uiBgOpacity,
    uiBlur: config.uiBlur,
    uiFontFamily: config.uiFontFamily,
    uiCustomFontPath: config.uiCustomFontPath || undefined,
    uiBaseFontSize: config.uiBaseFontSize,
    uiRadiusScale: config.uiRadiusScale,
    uiShadowIntensity: config.uiShadowIntensity,
    uiSaturation: config.uiSaturation,
    uiAccentBackgroundGlow: config.uiAccentBackgroundGlow,
    includeWallpaper: false,
  };
}

export function mergeThemeImport(prevConfig, bundle) {
  if (!bundle || typeof bundle !== "object") return prevConfig;
  const next = { ...prevConfig };

  if (typeof bundle.theme === "string") next.theme = bundle.theme;

  if (bundle.customColors && typeof bundle.customColors === "object") {
    next.customColors = normalizeThemeColors({
      ...(prevConfig.customColors || {}),
      ...bundle.customColors,
    });
  }

  if (bundle.uiBgOpacity !== undefined) next.uiBgOpacity = bundle.uiBgOpacity;
  if (bundle.uiBlur !== undefined) next.uiBlur = bundle.uiBlur;
  if (bundle.uiFontFamily !== undefined)
    next.uiFontFamily = bundle.uiFontFamily;
  if (bundle.uiCustomFontPath !== undefined)
    next.uiCustomFontPath = bundle.uiCustomFontPath;
  if (next.uiFontFamily !== "custom") next.uiCustomFontPath = null;
  if (bundle.uiBaseFontSize !== undefined)
    next.uiBaseFontSize = bundle.uiBaseFontSize;
  if (bundle.uiRadiusScale !== undefined)
    next.uiRadiusScale = bundle.uiRadiusScale;
  if (bundle.uiShadowIntensity !== undefined)
    next.uiShadowIntensity = bundle.uiShadowIntensity;
  if (bundle.uiSaturation !== undefined)
    next.uiSaturation = bundle.uiSaturation;
  if (bundle.uiAccentBackgroundGlow !== undefined)
    next.uiAccentBackgroundGlow = bundle.uiAccentBackgroundGlow;

  if (bundle.includeWallpaper && bundle.customBgPath !== undefined) {
    next.customBgPath = bundle.customBgPath;
  }
  if (bundle.customBgOpacity !== undefined)
    next.customBgOpacity = bundle.customBgOpacity;

  return next;
}

export function parseThemeBundleJson(text) {
  const data = JSON.parse(text);
  if (data.type === "echoes-studio-theme" && data.payload) {
    return data.payload;
  }
  if (data.theme || data.customColors) return data;
  throw new Error("Unrecognized theme file format");
}
