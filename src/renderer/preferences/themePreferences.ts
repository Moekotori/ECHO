import type { AppSettings, AppThemeCustomTheme, AppThemeMode, AppThemePreset, AppThemePresetOverride, AppThemePresetOverrides, AppThemeToneOverride } from '../../shared/types/appSettings';
import { getAppBridge } from '../utils/echoBridge';
import { applyAppearancePreferences, readAppearancePreferences } from './appearancePreferences';

export type EffectiveTheme = 'light' | 'dark';
export type ThemeApplyOptions = {
  animate?: boolean;
  customThemeId?: string | null;
  customThemes?: AppThemeCustomTheme[];
};

const storageKey = 'echo-next:appearance-theme';
const presetStorageKey = 'echo-next:appearance-theme-preset';
const presetOverridesStorageKey = 'echo-next:appearance-theme-preset-overrides';
const customThemesStorageKey = 'echo-next:appearance-custom-themes';
const customThemeIdStorageKey = 'echo-next:appearance-theme-custom-id';
const systemThemeQuery = '(prefers-color-scheme: dark)';
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const validThemeModes: AppThemeMode[] = ['light', 'dark', 'system'];
const validThemePresets: AppThemePreset[] = [
  'classic',
  'echoTwilight',
  'sakuraMilk',
  'peachSoda',
  'mintCandy',
  'berryDream',
  'matchaCream',
  'lemonMochi',
  'cottonCloud',
  'melonCream',
  'seaSaltJelly',
  'caramelPudding',
  'neonCandy',
  'nyanCat',
  'childrenDoodle',
  'wisteriaBubble',
  'strawberryCookie',
  'graphiteAurora',
  'amberNoir',
  'oceanStudio',
  'rosewoodVinyl',
  'darkSideMoon',
  'shibuyaNight',
  'kyotoKurenai',
  'ukiyoIndigo',
  'fujiSnow',
  'matsuriLantern',
  'ginzaNoir',
  'frostJazz',
  'FINAL',
];
const themeTransitionMs = 140;
const defaultScheduleDarkAt = '19:00';
const defaultScheduleLightAt = '07:00';
const themeOverrideColorKeys: Array<keyof Pick<
  AppThemeToneOverride,
  | 'appBg'
  | 'appBg2'
  | 'appBg3'
  | 'panel'
  | 'panelSoft'
  | 'accent'
  | 'accentStrong'
  | 'secondary'
  | 'heading'
  | 'text'
  | 'muted'
  | 'border'
  | 'onAccent'
  | 'buttonText'
  | 'titlebar'
  | 'sidebar'
  | 'player'
  | 'field'
  | 'row'
  | 'rowHover'
  | 'rowActive'
  | 'chip'
  | 'focus'
  | 'danger'
  | 'success'
  | 'warning'
>> = [
  'appBg',
  'appBg2',
  'appBg3',
  'panel',
  'panelSoft',
  'accent',
  'accentStrong',
  'secondary',
  'heading',
  'text',
  'muted',
  'border',
  'onAccent',
  'buttonText',
  'titlebar',
  'sidebar',
  'player',
  'field',
  'row',
  'rowHover',
  'rowActive',
  'chip',
  'focus',
  'danger',
  'success',
  'warning',
];
const maxCustomThemes = 24;
const fallbackCustomThemeTimestamp = '1970-01-01T00:00:00.000Z';

const customThemeStyleProperties = [
  '--preset-app-bg',
  '--preset-app-bg-2',
  '--preset-app-bg-3',
  '--preset-panel-rgb',
  '--preset-soft-rgb',
  '--preset-border-rgb',
  '--preset-shadow-rgb',
  '--preset-text',
  '--preset-heading',
  '--preset-muted',
  '--preset-subtle',
  '--preset-accent',
  '--preset-accent-strong',
  '--preset-accent-rgb',
  '--preset-secondary',
  '--preset-secondary-rgb',
  '--preset-success-text',
  '--preset-on-accent',
  '--color-bg',
  '--color-bg-elevated',
  '--color-bg-soft',
  '--color-surface',
  '--color-surface-strong',
  '--color-border',
  '--color-border-strong',
  '--color-text',
  '--color-muted',
  '--color-subtle',
  '--echo-heading-text',
  '--color-accent',
  '--color-accent-soft',
  '--color-accent-strong',
  '--color-teal',
  '--color-blue',
  '--color-blue-soft',
  '--theme-app-bg',
  '--theme-page-bg',
  '--theme-page-text',
  '--theme-heading-text',
  '--theme-muted-text',
  '--theme-subtle-text',
  '--theme-panel-bg',
  '--theme-panel-bg-strong',
  '--theme-panel-bg-muted',
  '--theme-panel-border',
  '--theme-panel-border-strong',
  '--theme-field-bg',
  '--theme-field-bg-strong',
  '--theme-field-border',
  '--theme-field-placeholder',
  '--theme-button-bg',
  '--theme-button-bg-hover',
  '--theme-button-border',
  '--theme-button-text',
  '--theme-button-muted-bg',
  '--theme-button-muted-text',
  '--theme-list-row-bg',
  '--theme-list-row-bg-hover',
  '--theme-list-row-bg-active',
  '--theme-list-row-border',
  '--theme-chip-bg',
  '--theme-chip-bg-active',
  '--theme-chip-text',
  '--theme-player-bg',
  '--theme-player-border',
  '--theme-control-bg',
  '--theme-control-bg-hover',
  '--theme-control-bg-active',
  '--theme-focus-ring',
  '--theme-accent-bg',
  '--theme-accent-bg-strong',
  '--theme-accent-border',
  '--theme-accent-solid-bg',
  '--theme-accent-text',
  '--theme-accent-text-strong',
  '--theme-on-accent',
  '--theme-scrollbar-thumb',
  '--theme-scrollbar-thumb-hover',
  '--theme-shadow-soft',
  '--theme-shadow-panel',
  '--echo-polish-app-bg',
  '--echo-polish-app-bg-layer',
  '--echo-polish-titlebar-bg',
  '--echo-polish-sidebar-bg',
  '--echo-polish-page-bg',
  '--echo-polish-player-bg',
  '--echo-polish-surface',
  '--echo-polish-surface-strong',
  '--echo-polish-surface-muted',
  '--echo-polish-field-bg',
  '--echo-polish-button-bg',
  '--echo-polish-button-bg-hover',
  '--echo-polish-row-bg',
  '--echo-polish-row-bg-hover',
  '--echo-polish-row-bg-active',
  '--echo-polish-border',
  '--echo-polish-border-strong',
  '--echo-polish-hairline',
  '--echo-polish-accent-text',
  '--echo-polish-accent-bg',
  '--echo-polish-on-accent',
  '--echo-polish-active-bg',
  '--echo-polish-active-border',
  '--echo-polish-play-bg',
  '--echo-polish-shadow-soft',
  '--echo-polish-shadow-panel',
  '--echo-polish-shadow-row',
  '--echo-polish-shadow-player',
  '--theme-success',
  '--theme-success-bg',
  '--theme-warning',
  '--theme-warning-bg',
  '--theme-danger',
  '--theme-danger-bg',
  '--theme-corner-radius',
  '--theme-panel-blur',
  '--theme-saturation',
  '--theme-motion-enabled',
  '--theme-motion-speed',
  '--theme-motion-intensity',
  '--echo-polish-radius',
  '--echo-polish-panel-blur',
  '--echo-polish-saturation',
];

const fallbackToneDefaults: Record<EffectiveTheme, {
  appBg: string;
  appBg2: string;
  appBg3: string;
  panelRgb: string;
  panelSoftRgb: string;
  borderRgb: string;
  shadowRgb: string;
  text: string;
  heading: string;
  muted: string;
  subtle: string;
  accent: string;
  accentStrong: string;
  accentRgb: string;
  secondary: string;
  secondaryRgb: string;
  onAccent: string;
}> = {
  light: {
    appBg: '#f6f6f7',
    appBg2: '#edeef0',
    appBg3: '#e6e7ea',
    panelRgb: '255 255 255',
    panelSoftRgb: '239 240 242',
    borderRgb: '38 40 46',
    shadowRgb: '36 39 48',
    text: '#2d3036',
    heading: '#1e2025',
    muted: '#6c7179',
    subtle: '#a0a4aa',
    accent: '#4b55e8',
    accentStrong: '#3239c7',
    accentRgb: '75 85 232',
    secondary: '#727987',
    secondaryRgb: '114 121 135',
    onAccent: '#ffffff',
  },
  dark: {
    appBg: '#101318',
    appBg2: '#151a22',
    appBg3: '#111827',
    panelRgb: '28 34 43',
    panelSoftRgb: '22 27 35',
    borderRgb: '100 124 150',
    shadowRgb: '0 0 0',
    text: '#d8e0ea',
    heading: '#f8fbff',
    muted: '#a8b5c4',
    subtle: '#7f8b9a',
    accent: '#75b7ff',
    accentStrong: '#cce6ff',
    accentRgb: '117 183 255',
    secondary: '#7dd7cb',
    secondaryRgb: '125 215 203',
    onAccent: '#0f1720',
  },
};

export const defaultThemeMode: AppThemeMode = 'light';
export const defaultThemePreset: AppThemePreset = 'classic';

export const normalizeThemeMode = (value: unknown): AppThemeMode =>
  validThemeModes.includes(value as AppThemeMode) ? (value as AppThemeMode) : defaultThemeMode;

export const normalizeThemeScheduleTime = (value: unknown, fallback = defaultScheduleDarkAt): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  return match ? `${match[1]}:${match[2]}` : fallback;
};

export const normalizeThemePreset = (value: unknown): AppThemePreset =>
  validThemePresets.includes(value as AppThemePreset) ? (value as AppThemePreset) : defaultThemePreset;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const normalizeThemeHexColor = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : undefined;
};

const normalizeOverrideNumber = (value: unknown, min: number, max: number, decimals = 0): number | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const factor = 10 ** decimals;
  return Math.round(clamp(numeric, min, max) * factor) / factor;
};

const normalizeOverridePercent = (value: unknown, min: number, max: number): number | undefined => {
  const normalized = normalizeOverrideNumber(value, min, max);
  return normalized === undefined ? undefined : Math.round(normalized);
};

export const normalizeThemeToneOverride = (value: unknown): AppThemeToneOverride | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Partial<AppThemeToneOverride>;
  const output: AppThemeToneOverride = {};

  for (const key of themeOverrideColorKeys) {
    const color = normalizeThemeHexColor(input[key]);
    if (color) {
      output[key] = color;
    }
  }

  const panelOpacityPercent = normalizeOverridePercent(input.panelOpacityPercent, 40, 100);
  const glassPercent = normalizeOverridePercent(input.glassPercent, 0, 80);
  const shadowPercent = normalizeOverridePercent(input.shadowPercent, 0, 100);
  const cornerRadiusPx = normalizeOverridePercent(input.cornerRadiusPx, 0, 28);
  const panelBlurPx = normalizeOverridePercent(input.panelBlurPx, 0, 32);
  const saturationPercent = normalizeOverridePercent(input.saturationPercent, 60, 140);
  const motionSpeedSeconds = normalizeOverrideNumber(input.motionSpeedSeconds, 0.12, 8, 2);
  const motionIntensityPercent = normalizeOverridePercent(input.motionIntensityPercent, 0, 160);

  if (panelOpacityPercent !== undefined) {
    output.panelOpacityPercent = panelOpacityPercent;
  }
  if (glassPercent !== undefined) {
    output.glassPercent = glassPercent;
  }
  if (shadowPercent !== undefined) {
    output.shadowPercent = shadowPercent;
  }
  if (cornerRadiusPx !== undefined) {
    output.cornerRadiusPx = cornerRadiusPx;
  }
  if (panelBlurPx !== undefined) {
    output.panelBlurPx = panelBlurPx;
  }
  if (saturationPercent !== undefined) {
    output.saturationPercent = saturationPercent;
  }
  if (typeof input.motionEnabled === 'boolean') {
    output.motionEnabled = input.motionEnabled;
  }
  if (motionSpeedSeconds !== undefined) {
    output.motionSpeedSeconds = motionSpeedSeconds;
  }
  if (motionIntensityPercent !== undefined) {
    output.motionIntensityPercent = motionIntensityPercent;
  }

  return Object.keys(output).length > 0 ? output : undefined;
};

export const normalizeThemePresetOverride = (value: unknown): AppThemePresetOverride | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Partial<AppThemePresetOverride>;
  const light = normalizeThemeToneOverride(input.light);
  const dark = normalizeThemeToneOverride(input.dark);
  const output: AppThemePresetOverride = {};

  if (light) {
    output.light = light;
  }
  if (dark) {
    output.dark = dark;
  }

  return Object.keys(output).length > 0 ? output : undefined;
};

export const normalizeThemePresetOverrides = (value: unknown): AppThemePresetOverrides => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Partial<Record<string, unknown>>;
  const output: AppThemePresetOverrides = {};

  for (const preset of validThemePresets) {
    const override = normalizeThemePresetOverride(input[preset]);
    if (override) {
      output[preset] = override;
    }
  }

  return output;
};

const normalizeThemeCustomIdValue = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return /^[a-zA-Z0-9_.:-]{1,80}$/.test(normalized) ? normalized : null;
};

const normalizeThemeCustomName = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '我的主题';
  }

  const normalized = value.replace(/[\r\n;]/g, '').trim();
  return (normalized || '我的主题').slice(0, 48);
};

const normalizeThemeCustomTimestamp = (value: unknown): string => {
  if (typeof value !== 'string') {
    return fallbackCustomThemeTimestamp;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 64) : fallbackCustomThemeTimestamp;
};

export const normalizeThemeCustomTheme = (value: unknown): AppThemeCustomTheme | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Partial<AppThemeCustomTheme>;
  const id = normalizeThemeCustomIdValue(input.id);
  if (!id) {
    return undefined;
  }

  const light = normalizeThemeToneOverride(input.light);
  const dark = normalizeThemeToneOverride(input.dark);
  const output: AppThemeCustomTheme = {
    id,
    name: normalizeThemeCustomName(input.name),
    basePreset: normalizeThemePreset(input.basePreset),
    createdAt: normalizeThemeCustomTimestamp(input.createdAt),
    updatedAt: normalizeThemeCustomTimestamp(input.updatedAt),
  };

  if (light) {
    output.light = light;
  }
  if (dark) {
    output.dark = dark;
  }

  return output;
};

export const normalizeThemeCustomThemes = (value: unknown): AppThemeCustomTheme[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const output: AppThemeCustomTheme[] = [];
  const seenIds = new Set<string>();

  for (const item of value) {
    if (output.length >= maxCustomThemes) {
      break;
    }

    const theme = normalizeThemeCustomTheme(item);
    if (!theme || seenIds.has(theme.id)) {
      continue;
    }

    output.push(theme);
    seenIds.add(theme.id);
  }

  return output;
};

export const normalizeThemeCustomId = (value: unknown, themes: AppThemeCustomTheme[]): string | null => {
  const id = normalizeThemeCustomIdValue(value);
  return id && themes.some((theme) => theme.id === id) ? id : null;
};

const hexToRgbTriplet = (value: string): string => {
  const normalized = normalizeThemeHexColor(value);
  if (!normalized) {
    return '0 0 0';
  }

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ].join(' ');
};

const rgb = (triplet: string, alpha: number): string => `rgb(${triplet} / ${clamp(alpha, 0, 1).toFixed(3)})`;

const readCssVariable = (root: HTMLElement, property: string): string => {
  try {
    return window.getComputedStyle(root).getPropertyValue(property).trim();
  } catch {
    return '';
  }
};

const clearCustomThemeProperties = (root: HTMLElement): void => {
  for (const property of customThemeStyleProperties) {
    root.style.removeProperty(property);
  }
};

const applyThemeToneOverride = (root: HTMLElement, tone: EffectiveTheme, override: AppThemeToneOverride): void => {
  const fallback = fallbackToneDefaults[tone];
  const readColor = (key: keyof AppThemeToneOverride, property: string, fallbackValue: string): string => {
    const cssValue = readCssVariable(root, property) || fallbackValue;
    return normalizeThemeHexColor(override[key]) ?? cssValue;
  };
  const readTriplet = (key: keyof AppThemeToneOverride, property: string, fallbackValue: string): string => {
    const color = normalizeThemeHexColor(override[key]);
    return color ? hexToRgbTriplet(color) : readCssVariable(root, property) || fallbackValue;
  };

  const appBg = readColor('appBg', '--preset-app-bg', fallback.appBg);
  const appBg2 = readColor('appBg2', '--preset-app-bg-2', fallback.appBg2);
  const appBg3 = readColor('appBg3', '--preset-app-bg-3', fallback.appBg3);
  const panelRgb = readTriplet('panel', '--preset-panel-rgb', fallback.panelRgb);
  const panelSoftRgb = readTriplet('panelSoft', '--preset-soft-rgb', fallback.panelSoftRgb);
  const borderRgb = readTriplet('border', '--preset-border-rgb', fallback.borderRgb);
  const accent = readColor('accent', '--preset-accent', fallback.accent);
  const accentStrong = readColor('accentStrong', '--preset-accent-strong', fallback.accentStrong);
  const normalizedAccent = normalizeThemeHexColor(override.accent);
  const accentRgb = normalizedAccent ? hexToRgbTriplet(normalizedAccent) : readCssVariable(root, '--preset-accent-rgb') || fallback.accentRgb;
  const secondary = readColor('secondary', '--preset-secondary', fallback.secondary);
  const normalizedSecondary = normalizeThemeHexColor(override.secondary);
  const secondaryRgb = normalizedSecondary ? hexToRgbTriplet(normalizedSecondary) : readCssVariable(root, '--preset-secondary-rgb') || fallback.secondaryRgb;
  const text = readColor('text', '--preset-text', fallback.text);
  const heading = readColor('heading', '--preset-heading', fallback.heading);
  const muted = readColor('muted', '--preset-muted', fallback.muted);
  const subtle = readCssVariable(root, '--preset-subtle') || fallback.subtle;
  const onAccent = readColor('onAccent', '--preset-on-accent', fallback.onAccent);
  const buttonText = normalizeThemeHexColor(override.buttonText) ?? text;
  const titlebarRgb = readTriplet('titlebar', '--preset-panel-rgb', panelRgb);
  const sidebarRgb = readTriplet('sidebar', '--preset-soft-rgb', panelSoftRgb);
  const playerRgb = readTriplet('player', '--preset-panel-rgb', panelRgb);
  const fieldRgb = readTriplet('field', '--preset-panel-rgb', panelRgb);
  const rowRgb = readTriplet('row', '--preset-panel-rgb', panelRgb);
  const rowHoverRgb = readTriplet('rowHover', '--preset-panel-rgb', panelRgb);
  const rowActiveRgb = readTriplet('rowActive', '--preset-accent-rgb', accentRgb);
  const chipRgb = readTriplet('chip', '--preset-panel-rgb', panelRgb);
  const focusRgb = readTriplet('focus', '--preset-accent-rgb', accentRgb);
  const danger = readColor('danger', '--theme-danger', '#d64545');
  const dangerRgb = hexToRgbTriplet(danger);
  const success = readColor('success', '--theme-success', secondary);
  const successRgb = hexToRgbTriplet(success);
  const warning = readColor('warning', '--theme-warning', '#c98a16');
  const warningRgb = hexToRgbTriplet(warning);
  const panelAlpha = (override.panelOpacityPercent ?? 72) / 100;
  const glassAlpha = (override.glassPercent ?? 18) / 100;
  const shadowScale = (override.shadowPercent ?? 100) / 100;
  const cornerRadiusPx = override.cornerRadiusPx ?? 14;
  const panelBlurPx = override.panelBlurPx ?? Math.round(12 + glassAlpha * 18);
  const saturationPercent = override.saturationPercent ?? 100;
  const motionEnabled = override.motionEnabled !== false;
  const motionSpeedSeconds = override.motionSpeedSeconds ?? 0.22;
  const motionIntensityPercent = override.motionIntensityPercent ?? 100;
  const panelStrongAlpha = Math.min(0.98, panelAlpha + 0.18);
  const panelMutedAlpha = Math.min(0.92, panelAlpha + 0.02);
  const fieldAlpha = Math.min(0.96, panelAlpha + 0.06);
  const buttonAlpha = Math.min(0.96, Math.max(0.48, panelAlpha - 0.02));
  const shadowSoftAlpha = 0.12 * shadowScale;
  const shadowPanelAlpha = 0.08 * shadowScale;
  const shadowRowAlpha = 0.075 * shadowScale;
  const shadowPlayerAlpha = 0.1 * shadowScale;

  root.style.setProperty('--preset-app-bg', appBg);
  root.style.setProperty('--preset-app-bg-2', appBg2);
  root.style.setProperty('--preset-app-bg-3', appBg3);
  root.style.setProperty('--preset-panel-rgb', panelRgb);
  root.style.setProperty('--preset-soft-rgb', panelSoftRgb);
  root.style.setProperty('--preset-border-rgb', borderRgb);
  root.style.setProperty('--preset-text', text);
  root.style.setProperty('--preset-heading', heading);
  root.style.setProperty('--preset-muted', muted);
  root.style.setProperty('--preset-subtle', subtle);
  root.style.setProperty('--preset-accent', accent);
  root.style.setProperty('--preset-accent-strong', accentStrong);
  root.style.setProperty('--preset-accent-rgb', accentRgb);
  root.style.setProperty('--preset-secondary', secondary);
  root.style.setProperty('--preset-secondary-rgb', secondaryRgb);
  root.style.setProperty('--preset-on-accent', onAccent);

  root.style.setProperty('--color-bg', appBg);
  root.style.setProperty('--color-bg-elevated', rgb(panelRgb, panelStrongAlpha));
  root.style.setProperty('--color-bg-soft', rgb(panelSoftRgb, panelMutedAlpha));
  root.style.setProperty('--color-surface', rgb(panelRgb, panelAlpha));
  root.style.setProperty('--color-surface-strong', rgb(panelRgb, panelStrongAlpha));
  root.style.setProperty('--color-border', rgb(borderRgb, 0.15 + glassAlpha * 0.12));
  root.style.setProperty('--color-border-strong', rgb(borderRgb, 0.24 + glassAlpha * 0.12));
  root.style.setProperty('--color-text', text);
  root.style.setProperty('--color-muted', muted);
  root.style.setProperty('--color-subtle', subtle);
  root.style.setProperty('--echo-heading-text', heading);
  root.style.setProperty('--color-accent', accent);
  root.style.setProperty('--color-accent-soft', rgb(accentRgb, 0.13 + glassAlpha * 0.08));
  root.style.setProperty('--color-accent-strong', accentStrong);
  root.style.setProperty('--color-teal', secondary);
  root.style.setProperty('--color-blue', accent);
  root.style.setProperty('--color-blue-soft', rgb(secondaryRgb, 0.18 + glassAlpha * 0.08));

  root.style.setProperty('--theme-app-bg', appBg);
  root.style.setProperty(
    '--theme-page-bg',
    `radial-gradient(circle at 14% 10%, ${rgb(accentRgb, 0.12 + glassAlpha * 0.12)}, transparent 32%), radial-gradient(circle at 84% 6%, ${rgb(secondaryRgb, 0.11 + glassAlpha * 0.1)}, transparent 30%), linear-gradient(135deg, ${appBg} 0%, ${appBg2} 52%, ${appBg3} 100%)`,
  );
  root.style.setProperty('--theme-page-text', text);
  root.style.setProperty('--theme-heading-text', heading);
  root.style.setProperty('--theme-muted-text', muted);
  root.style.setProperty('--theme-subtle-text', subtle);
  root.style.setProperty('--theme-panel-bg', rgb(panelRgb, panelAlpha));
  root.style.setProperty('--theme-panel-bg-strong', rgb(panelRgb, panelStrongAlpha));
  root.style.setProperty('--theme-panel-bg-muted', rgb(panelSoftRgb, panelMutedAlpha));
  root.style.setProperty('--theme-panel-border', rgb(borderRgb, 0.14 + glassAlpha * 0.12));
  root.style.setProperty('--theme-panel-border-strong', rgb(borderRgb, 0.24 + glassAlpha * 0.14));
  root.style.setProperty('--theme-field-bg', rgb(fieldRgb, fieldAlpha));
  root.style.setProperty('--theme-field-bg-strong', rgb(fieldRgb, panelStrongAlpha));
  root.style.setProperty('--theme-field-border', rgb(borderRgb, 0.16 + glassAlpha * 0.12));
  root.style.setProperty('--theme-field-placeholder', subtle);
  root.style.setProperty('--theme-button-bg', rgb(panelRgb, buttonAlpha));
  root.style.setProperty('--theme-button-bg-hover', rgb(panelRgb, panelStrongAlpha));
  root.style.setProperty('--theme-button-border', rgb(borderRgb, 0.14 + glassAlpha * 0.12));
  root.style.setProperty('--theme-button-text', buttonText);
  root.style.setProperty('--theme-button-muted-bg', rgb(panelSoftRgb, panelMutedAlpha));
  root.style.setProperty('--theme-button-muted-text', muted);
  root.style.setProperty('--theme-list-row-bg', rgb(rowRgb, Math.max(0.42, panelAlpha - 0.12)));
  root.style.setProperty('--theme-list-row-bg-hover', rgb(rowHoverRgb, Math.min(0.9, panelAlpha + 0.1)));
  root.style.setProperty('--theme-list-row-bg-active', rgb(rowActiveRgb, 0.16 + glassAlpha * 0.06));
  root.style.setProperty('--theme-list-row-border', rgb(borderRgb, 0.11 + glassAlpha * 0.08));
  root.style.setProperty('--theme-chip-bg', rgb(chipRgb, buttonAlpha));
  root.style.setProperty('--theme-chip-bg-active', rgb(accentRgb, 0.17 + glassAlpha * 0.06));
  root.style.setProperty('--theme-chip-text', muted);
  root.style.setProperty('--theme-player-bg', rgb(playerRgb, Math.min(0.98, panelAlpha + 0.19)));
  root.style.setProperty('--theme-player-border', rgb(borderRgb, 0.18 + glassAlpha * 0.12));
  root.style.setProperty('--theme-control-bg', rgb(borderRgb, 0.12 + glassAlpha * 0.08));
  root.style.setProperty('--theme-control-bg-hover', rgb(borderRgb, 0.18 + glassAlpha * 0.1));
  root.style.setProperty('--theme-control-bg-active', rgb(accentRgb, 0.18 + glassAlpha * 0.08));
  root.style.setProperty('--theme-focus-ring', rgb(focusRgb, 0.32));
  root.style.setProperty('--theme-accent-bg', rgb(accentRgb, 0.13 + glassAlpha * 0.06));
  root.style.setProperty('--theme-accent-bg-strong', rgb(accentRgb, 0.22 + glassAlpha * 0.08));
  root.style.setProperty('--theme-accent-border', rgb(accentRgb, 0.3 + glassAlpha * 0.1));
  root.style.setProperty('--theme-accent-solid-bg', accent);
  root.style.setProperty('--theme-accent-text', accentStrong);
  root.style.setProperty('--theme-accent-text-strong', accentStrong);
  root.style.setProperty('--theme-on-accent', onAccent);
  root.style.setProperty('--theme-scrollbar-thumb', rgb(accentRgb, 0.35 + glassAlpha * 0.08));
  root.style.setProperty('--theme-scrollbar-thumb-hover', rgb(accentRgb, 0.5 + glassAlpha * 0.08));
  root.style.setProperty('--theme-shadow-soft', `0 22px 60px rgb(${fallback.shadowRgb} / ${shadowSoftAlpha.toFixed(3)})`);
  root.style.setProperty('--theme-shadow-panel', `0 12px 30px rgb(${fallback.shadowRgb} / ${shadowPanelAlpha.toFixed(3)})`);
  root.style.setProperty('--theme-success', success);
  root.style.setProperty('--theme-success-bg', rgb(successRgb, 0.14 + glassAlpha * 0.06));
  root.style.setProperty('--theme-warning', warning);
  root.style.setProperty('--theme-warning-bg', rgb(warningRgb, 0.14 + glassAlpha * 0.06));
  root.style.setProperty('--theme-danger', danger);
  root.style.setProperty('--theme-danger-bg', rgb(dangerRgb, 0.14 + glassAlpha * 0.06));
  root.style.setProperty('--theme-corner-radius', `${cornerRadiusPx}px`);
  root.style.setProperty('--theme-panel-blur', `${panelBlurPx}px`);
  root.style.setProperty('--theme-saturation', `${saturationPercent}%`);
  root.style.setProperty('--theme-motion-enabled', motionEnabled ? '1' : '0');
  root.style.setProperty('--theme-motion-speed', `${motionSpeedSeconds}s`);
  root.style.setProperty('--theme-motion-intensity', `${motionIntensityPercent}%`);

  root.style.setProperty('--echo-polish-app-bg', appBg);
  root.style.setProperty(
    '--echo-polish-app-bg-layer',
    `radial-gradient(circle at 13% 8%, ${rgb(accentRgb, 0.11 + glassAlpha * 0.13)}, transparent 31%), radial-gradient(circle at 88% 3%, ${rgb(secondaryRgb, 0.1 + glassAlpha * 0.12)}, transparent 32%), linear-gradient(135deg, ${appBg} 0%, ${appBg2} 50%, ${appBg3} 100%)`,
  );
  root.style.setProperty('--echo-polish-titlebar-bg', rgb(titlebarRgb, Math.min(0.96, panelAlpha + 0.08)));
  root.style.setProperty('--echo-polish-sidebar-bg', `linear-gradient(180deg, ${rgb(sidebarRgb, panelAlpha)}, ${rgb(panelSoftRgb, panelMutedAlpha)} 58%, ${rgb(panelRgb, panelStrongAlpha)})`);
  root.style.setProperty('--echo-polish-page-bg', `radial-gradient(circle at 18% 0%, ${rgb(accentRgb, 0.08 + glassAlpha * 0.08)}, transparent 34%), linear-gradient(180deg, ${rgb(panelRgb, Math.max(0.32, panelAlpha - 0.22))}, ${rgb(panelSoftRgb, panelMutedAlpha)} 54%, ${rgb(panelRgb, panelStrongAlpha)})`);
  root.style.setProperty('--echo-polish-player-bg', `linear-gradient(180deg, ${rgb(playerRgb, panelStrongAlpha)}, ${rgb(panelSoftRgb, Math.min(0.96, panelMutedAlpha + 0.14))})`);
  root.style.setProperty('--echo-polish-surface', rgb(panelRgb, Math.max(0.48, panelAlpha - 0.06)));
  root.style.setProperty('--echo-polish-surface-strong', rgb(panelRgb, panelStrongAlpha));
  root.style.setProperty('--echo-polish-surface-muted', rgb(panelSoftRgb, Math.min(0.92, panelMutedAlpha + 0.1)));
  root.style.setProperty('--echo-polish-field-bg', rgb(fieldRgb, fieldAlpha));
  root.style.setProperty('--echo-polish-button-bg', rgb(panelRgb, buttonAlpha));
  root.style.setProperty('--echo-polish-button-bg-hover', rgb(panelRgb, panelStrongAlpha));
  root.style.setProperty('--echo-polish-row-bg', rgb(rowRgb, Math.max(0.4, panelAlpha - 0.16)));
  root.style.setProperty('--echo-polish-row-bg-hover', rgb(rowHoverRgb, Math.min(0.9, panelAlpha + 0.12)));
  root.style.setProperty('--echo-polish-row-bg-active', rgb(rowActiveRgb, 0.17 + glassAlpha * 0.06));
  root.style.setProperty('--echo-polish-border', rgb(borderRgb, 0.14 + glassAlpha * 0.12));
  root.style.setProperty('--echo-polish-border-strong', rgb(borderRgb, 0.24 + glassAlpha * 0.14));
  root.style.setProperty('--echo-polish-hairline', rgb(panelRgb, panelStrongAlpha));
  root.style.setProperty('--echo-polish-accent-text', accentStrong);
  root.style.setProperty('--echo-polish-accent-bg', rgb(accentRgb, 0.13 + glassAlpha * 0.06));
  root.style.setProperty('--echo-polish-on-accent', onAccent);
  root.style.setProperty('--echo-polish-active-bg', rgb(accentRgb, 0.14 + glassAlpha * 0.06));
  root.style.setProperty('--echo-polish-active-border', rgb(accentRgb, 0.28 + glassAlpha * 0.1));
  root.style.setProperty('--echo-polish-play-bg', `linear-gradient(180deg, ${accent}, ${accentStrong})`);
  root.style.setProperty('--echo-polish-shadow-soft', `0 24px 68px rgb(${fallback.shadowRgb} / ${(0.13 * shadowScale).toFixed(3)})`);
  root.style.setProperty('--echo-polish-shadow-panel', `0 14px 34px rgb(${fallback.shadowRgb} / ${shadowPanelAlpha.toFixed(3)})`);
  root.style.setProperty('--echo-polish-shadow-row', `0 9px 22px rgb(${fallback.shadowRgb} / ${shadowRowAlpha.toFixed(3)})`);
  root.style.setProperty('--echo-polish-shadow-player', `0 -18px 46px rgb(${fallback.shadowRgb} / ${shadowPlayerAlpha.toFixed(3)})`);
  root.style.setProperty('--echo-polish-radius', `${cornerRadiusPx}px`);
  root.style.setProperty('--echo-polish-panel-blur', `${panelBlurPx}px`);
  root.style.setProperty('--echo-polish-saturation', `${saturationPercent}%`);
};

export const readThemeMode = (): AppThemeMode => {
  try {
    return normalizeThemeMode(window.localStorage.getItem(storageKey));
  } catch {
    return defaultThemeMode;
  }
};

export const readThemePreset = (): AppThemePreset => {
  try {
    return normalizeThemePreset(window.localStorage.getItem(presetStorageKey));
  } catch {
    return defaultThemePreset;
  }
};

export const readThemePresetOverrides = (): AppThemePresetOverrides => {
  try {
    const raw = window.localStorage.getItem(presetOverridesStorageKey);
    return raw ? normalizeThemePresetOverrides(JSON.parse(raw) as unknown) : {};
  } catch {
    return {};
  }
};

export const writeThemeMode = (mode: AppThemeMode): AppThemeMode => {
  const normalized = normalizeThemeMode(mode);

  try {
    window.localStorage.setItem(storageKey, normalized);
  } catch {
    return normalized;
  }

  return normalized;
};

export const writeThemePreset = (preset: AppThemePreset): AppThemePreset => {
  const normalized = normalizeThemePreset(preset);

  try {
    window.localStorage.setItem(presetStorageKey, normalized);
  } catch {
    return normalized;
  }

  return normalized;
};

export const writeThemePresetOverrides = (overrides: AppThemePresetOverrides): AppThemePresetOverrides => {
  const normalized = normalizeThemePresetOverrides(overrides);

  try {
    window.localStorage.setItem(presetOverridesStorageKey, JSON.stringify(normalized));
  } catch {
    return normalized;
  }

  return normalized;
};

export const readThemeCustomThemes = (): AppThemeCustomTheme[] => {
  try {
    const raw = window.localStorage.getItem(customThemesStorageKey);
    return raw ? normalizeThemeCustomThemes(JSON.parse(raw) as unknown) : [];
  } catch {
    return [];
  }
};

export const writeThemeCustomThemes = (themes: AppThemeCustomTheme[]): AppThemeCustomTheme[] => {
  const normalized = normalizeThemeCustomThemes(themes);

  try {
    window.localStorage.setItem(customThemesStorageKey, JSON.stringify(normalized));
  } catch {
    return normalized;
  }

  return normalized;
};

export const readThemeCustomId = (): string | null => {
  try {
    return normalizeThemeCustomId(window.localStorage.getItem(customThemeIdStorageKey), readThemeCustomThemes());
  } catch {
    return null;
  }
};

export const writeThemeCustomId = (id: string | null, themes: AppThemeCustomTheme[] = readThemeCustomThemes()): string | null => {
  const normalized = normalizeThemeCustomId(id, themes);

  try {
    if (normalized) {
      window.localStorage.setItem(customThemeIdStorageKey, normalized);
    } else {
      window.localStorage.removeItem(customThemeIdStorageKey);
    }
  } catch {
    return normalized;
  }

  return normalized;
};

export const resolveThemeMode = (mode: AppThemeMode): EffectiveTheme => {
  const normalized = normalizeThemeMode(mode);

  if (normalized === 'dark') {
    return 'dark';
  }

  if (normalized === 'system' && typeof window.matchMedia === 'function') {
    return window.matchMedia(systemThemeQuery).matches ? 'dark' : 'light';
  }

  return 'light';
};

const timeToMinutes = (value: string): number => {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
};

const isMinuteInRange = (minute: number, start: number, end: number): boolean => {
  if (start === end) {
    return false;
  }
  if (start < end) {
    return minute >= start && minute < end;
  }
  return minute >= start || minute < end;
};

export const resolveThemeModeForSchedule = (
  settings: Pick<Partial<AppSettings>, 'appearanceTheme' | 'appearanceThemeScheduleEnabled' | 'appearanceThemeScheduleDarkAt' | 'appearanceThemeScheduleLightAt'>,
  now = new Date(),
): AppThemeMode => {
  const baseTheme = normalizeThemeMode(settings.appearanceTheme);

  if (settings.appearanceThemeScheduleEnabled !== true) {
    return baseTheme;
  }

  const darkAt = normalizeThemeScheduleTime(settings.appearanceThemeScheduleDarkAt, defaultScheduleDarkAt);
  const lightAt = normalizeThemeScheduleTime(settings.appearanceThemeScheduleLightAt, defaultScheduleLightAt);
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  return isMinuteInRange(currentMinute, timeToMinutes(darkAt), timeToMinutes(lightAt)) ? 'dark' : 'light';
};

export const applyThemeSettings = (settings: Partial<AppSettings>, options: ThemeApplyOptions = {}): EffectiveTheme =>
  applyThemeMode(
    resolveThemeModeForSchedule(settings),
    settings.appearanceThemePreset ?? readThemePreset(),
    settings.appearanceThemePresetOverrides ?? readThemePresetOverrides(),
    {
      ...options,
      customThemeId: Object.prototype.hasOwnProperty.call(settings, 'appearanceThemeCustomId') ? settings.appearanceThemeCustomId ?? null : options.customThemeId,
      customThemes: settings.appearanceCustomThemes ?? options.customThemes,
    },
  );

const prefersReducedMotion = (): boolean => {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(reducedMotionQuery).matches;
  } catch {
    return false;
  }
};

const runThemeTransition = (callback: () => void, options: ThemeApplyOptions = {}): void => {
  if (!options.animate || prefersReducedMotion()) {
    callback();
    return;
  }

  const root = document.documentElement;
  const clearTransitionState = (): void => {
    window.setTimeout(() => {
      delete root.dataset.themeTransition;
    }, themeTransitionMs);
  };

  root.dataset.themeTransition = 'true';
  callback();
  clearTransitionState();
};

const applyThemeModeNow = (
  mode: AppThemeMode,
  preset: AppThemePreset,
  overrides: AppThemePresetOverrides,
  customThemes: AppThemeCustomTheme[] = readThemeCustomThemes(),
  customThemeId: string | null = readThemeCustomId(),
): EffectiveTheme => {
  const normalized = normalizeThemeMode(mode);
  const normalizedPreset = normalizeThemePreset(preset);
  const normalizedOverrides = normalizeThemePresetOverrides(overrides);
  const normalizedCustomThemes = normalizeThemeCustomThemes(customThemes);
  const normalizedCustomThemeId = normalizeThemeCustomId(customThemeId, normalizedCustomThemes);
  const activeCustomTheme = normalizedCustomThemes.find((theme) => theme.id === normalizedCustomThemeId);
  const effectivePreset = activeCustomTheme?.basePreset ?? normalizedPreset;
  const effectiveTheme = resolveThemeMode(normalized);
  const root = document.documentElement;
  const toneOverride = activeCustomTheme?.[effectiveTheme] ?? normalizedOverrides[effectivePreset]?.[effectiveTheme];

  clearCustomThemeProperties(root);
  root.dataset.themeMode = normalized;
  root.dataset.themePreset = effectivePreset;
  root.dataset.theme = effectiveTheme;
  if (activeCustomTheme || toneOverride) {
    root.dataset.themeCustom = 'true';
  } else {
    delete root.dataset.themeCustom;
  }
  if (activeCustomTheme) {
    root.dataset.themeCustomId = activeCustomTheme.id;
  } else {
    delete root.dataset.themeCustomId;
  }
  root.style.colorScheme = effectiveTheme;
  applyAppearancePreferences(readAppearancePreferences());
  if (toneOverride) {
    applyThemeToneOverride(root, effectiveTheme, toneOverride);
  }

  return effectiveTheme;
};

export const applyThemeMode = (
  mode: AppThemeMode,
  preset: AppThemePreset = readThemePreset(),
  overrides: AppThemePresetOverrides = readThemePresetOverrides(),
  options: ThemeApplyOptions = {},
): EffectiveTheme => {
  const normalized = normalizeThemeMode(mode);
  const normalizedPreset = normalizeThemePreset(preset);
  const normalizedOverrides = normalizeThemePresetOverrides(overrides);
  const normalizedCustomThemes = normalizeThemeCustomThemes(options.customThemes ?? readThemeCustomThemes());
  const normalizedCustomThemeId = normalizeThemeCustomId(options.customThemeId ?? readThemeCustomId(), normalizedCustomThemes);
  let effectiveTheme = resolveThemeMode(normalized);

  runThemeTransition(() => {
    effectiveTheme = applyThemeModeNow(normalized, normalizedPreset, normalizedOverrides, normalizedCustomThemes, normalizedCustomThemeId);
  }, options);

  return effectiveTheme;
};

export const updateThemeMode = (mode: AppThemeMode, options: ThemeApplyOptions = {}): AppThemeMode => {
  const normalized = writeThemeMode(mode);
  applyThemeMode(normalized, readThemePreset(), readThemePresetOverrides(), options);
  return normalized;
};

export const updateThemePreset = (preset: AppThemePreset, options: ThemeApplyOptions = {}): AppThemePreset => {
  const normalized = writeThemePreset(preset);
  const customThemes = options.customThemes ?? readThemeCustomThemes();
  const customThemeId = Object.prototype.hasOwnProperty.call(options, 'customThemeId') ? options.customThemeId ?? null : readThemeCustomId();
  writeThemeCustomId(customThemeId, customThemes);
  applyThemeMode(readThemeMode(), normalized, readThemePresetOverrides(), { ...options, customThemeId, customThemes });
  return normalized;
};

export const updateThemePresetOverrides = (
  overrides: AppThemePresetOverrides,
  mode: AppThemeMode = readThemeMode(),
  preset: AppThemePreset = readThemePreset(),
  options: ThemeApplyOptions = {},
): AppThemePresetOverrides => {
  const normalizedOverrides = writeThemePresetOverrides(overrides);
  applyThemeMode(mode, preset, normalizedOverrides, options);
  return normalizedOverrides;
};

export const updateThemePreferences = (
  mode: AppThemeMode,
  preset: AppThemePreset,
  overrides: AppThemePresetOverrides = readThemePresetOverrides(),
  options: ThemeApplyOptions = {},
): AppThemeMode => {
  const normalizedMode = writeThemeMode(mode);
  const normalizedPreset = writeThemePreset(preset);
  const normalizedOverrides = writeThemePresetOverrides(overrides);
  const normalizedCustomThemes = writeThemeCustomThemes(options.customThemes ?? readThemeCustomThemes());
  const normalizedCustomThemeId = writeThemeCustomId(
    Object.prototype.hasOwnProperty.call(options, 'customThemeId') ? options.customThemeId ?? null : readThemeCustomId(),
    normalizedCustomThemes,
  );
  applyThemeMode(normalizedMode, normalizedPreset, normalizedOverrides, {
    ...options,
    customThemeId: normalizedCustomThemeId,
    customThemes: normalizedCustomThemes,
  });
  return normalizedMode;
};

export const loadPersistedThemeMode = async (): Promise<AppThemeMode> => {
  const appBridge = getAppBridge();

  if (!appBridge) {
    const localThemeMode = readThemeMode();
    applyThemeMode(localThemeMode, readThemePreset(), readThemePresetOverrides(), {
      customThemeId: readThemeCustomId(),
      customThemes: readThemeCustomThemes(),
    });
    return localThemeMode;
  }

  const settings = await appBridge.getSettings();
  const themeMode = writeThemeMode(settings.appearanceTheme ?? defaultThemeMode);
  writeThemePreset(settings.appearanceThemePreset ?? defaultThemePreset);
  writeThemePresetOverrides(settings.appearanceThemePresetOverrides ?? {});
  const customThemes = writeThemeCustomThemes(settings.appearanceCustomThemes ?? []);
  const customThemeId = writeThemeCustomId(settings.appearanceThemeCustomId ?? null, customThemes);
  applyThemeSettings(settings, { customThemeId, customThemes });
  return themeMode;
};

export const watchThemeSettings = (loadSettings: () => Promise<Partial<AppSettings> | null | undefined>): (() => void) => {
  let disposed = false;
  let latestSettings: Partial<AppSettings> | null = null;

  const applyLatestSettings = (options: ThemeApplyOptions = {}): void => {
    if (!latestSettings) {
      return;
    }
    applyThemeSettings(latestSettings, options);
  };

  const refreshSettings = async (): Promise<void> => {
    try {
      const settings = await loadSettings();
      if (!disposed && settings) {
        latestSettings = settings;
        applyLatestSettings();
      }
    } catch {
      // Theme scheduling is best-effort; keep the last known theme if settings are temporarily unavailable.
    }
  };

  const handleSettingsChanged = (event: Event): void => {
    const patch = (event as CustomEvent<Partial<AppSettings>>).detail;
    if (!patch || typeof patch !== 'object') {
      return;
    }
    latestSettings = { ...(latestSettings ?? {}), ...patch };
    applyLatestSettings({ animate: true });
  };

  window.addEventListener('settings:changed', handleSettingsChanged);
  const intervalId = window.setInterval(() => {
    if (latestSettings) {
      applyLatestSettings();
    } else {
      void refreshSettings();
    }
  }, 30_000);
  void refreshSettings();

  let stopSystemWatcher = (): void => undefined;
  if (typeof window.matchMedia === 'function') {
    stopSystemWatcher = watchSystemThemeMode(() => resolveThemeModeForSchedule(latestSettings ?? { appearanceTheme: readThemeMode() }));
  }

  return () => {
    disposed = true;
    window.removeEventListener('settings:changed', handleSettingsChanged);
    window.clearInterval(intervalId);
    stopSystemWatcher();
  };
};

export const watchSystemThemeMode = (getThemeMode: () => AppThemeMode = readThemeMode): (() => void) => {
  if (typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const mediaQuery = window.matchMedia(systemThemeQuery);
  const handleChange = (): void => {
    applyThemeMode(getThemeMode(), readThemePreset(), readThemePresetOverrides(), {
      customThemeId: readThemeCustomId(),
      customThemes: readThemeCustomThemes(),
    });
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }

  mediaQuery.addListener(handleChange);
  return () => mediaQuery.removeListener(handleChange);
};
