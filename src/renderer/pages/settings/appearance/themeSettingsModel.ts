import { echoProUnlockPluginId, proOnlyThemePresets } from '../../../../shared/constants/featureUnlocks';
import type {
  AppThemeCustomTheme,
  AppThemeMode,
  AppThemePreset,
  AppThemePresetOverrides,
  AppThemeToneOverride,
} from '../../../../shared/types/appSettings';
import type { PluginSummary, PluginThemePresetContribution } from '../../../../shared/types/plugins';
import type { TranslationKey } from '../../../i18n/locales';
import {
  normalizeThemeCustomThemes,
  normalizeThemeHexColor,
  normalizeThemePreset,
} from '../../../preferences/themePreferences';

export const themeModeOptions: Array<{ mode: AppThemeMode; labelKey: TranslationKey }> = [
  { mode: 'light', labelKey: 'settings.appearance.theme.light' },
  { mode: 'dark', labelKey: 'settings.appearance.theme.dark' },
  { mode: 'system', labelKey: 'settings.appearance.theme.followSystem' },
  { mode: 'ambient', labelKey: 'settings.appearance.theme.ambient' },
];

export const defaultThemeScheduleDarkAt = '19:00';
export const defaultThemeScheduleLightAt = '07:00';

export const themePresetOptions: Array<{
  preset: AppThemePreset;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  preview: string;
  swatches: string[];
}> = [
  {
    preset: 'classic',
    labelKey: 'settings.appearance.themePreset.classic',
    descriptionKey: 'settings.appearance.themePreset.classic.description',
    preview: 'linear-gradient(135deg, #ffffff 0%, #f6f6f7 52%, #e6e7ea 100%)',
    swatches: ['#f6f6f7', '#4b55e8', '#727987'],
  },
  {
    preset: 'echoTwilight',
    labelKey: 'settings.appearance.themePreset.echoTwilight',
    descriptionKey: 'settings.appearance.themePreset.echoTwilight.description',
    preview: 'linear-gradient(135deg, #fff4ef 0%, #f3d7cf 48%, #efe5f2 100%)',
    swatches: ['#fff4ef', '#df6b5f', '#8ccfc8'],
  },
  {
    preset: 'sakuraMilk',
    labelKey: 'settings.appearance.themePreset.sakuraMilk',
    descriptionKey: 'settings.appearance.themePreset.sakuraMilk.description',
    preview: 'linear-gradient(135deg, #fff6f9 0%, #f7d9e7 48%, #f0eefc 100%)',
    swatches: ['#fff6f9', '#cf5d7d', '#7fc8d6'],
  },
  {
    preset: 'peachSoda',
    labelKey: 'settings.appearance.themePreset.peachSoda',
    descriptionKey: 'settings.appearance.themePreset.peachSoda.description',
    preview: 'linear-gradient(135deg, #fff2e8 0%, #ffd6bd 44%, #d7f4ee 100%)',
    swatches: ['#fff2e8', '#d96d4c', '#5eb9ad'],
  },
  {
    preset: 'mintCandy',
    labelKey: 'settings.appearance.themePreset.mintCandy',
    descriptionKey: 'settings.appearance.themePreset.mintCandy.description',
    preview: 'linear-gradient(135deg, #f6fff8 0%, #d7f2df 46%, #ffe5ec 100%)',
    swatches: ['#f6fff8', '#3f9274', '#dd6e86'],
  },
  {
    preset: 'berryDream',
    labelKey: 'settings.appearance.themePreset.berryDream',
    descriptionKey: 'settings.appearance.themePreset.berryDream.description',
    preview: 'linear-gradient(135deg, #f8f5ff 0%, #e2d9fb 46%, #ffddec 100%)',
    swatches: ['#f8f5ff', '#7657b8', '#cf5f95'],
  },
  {
    preset: 'matchaCream',
    labelKey: 'settings.appearance.themePreset.matchaCream',
    descriptionKey: 'settings.appearance.themePreset.matchaCream.description',
    preview: 'linear-gradient(135deg, #fbfaeb 0%, #e1edc9 48%, #f6d9d7 100%)',
    swatches: ['#fbfaeb', '#6e8f49', '#c8757a'],
  },
  {
    preset: 'lemonMochi',
    labelKey: 'settings.appearance.themePreset.lemonMochi',
    descriptionKey: 'settings.appearance.themePreset.lemonMochi.description',
    preview: 'linear-gradient(135deg, #fffbe6 0%, #f6e7ad 48%, #eaf4fb 100%)',
    swatches: ['#fffbe6', '#c99a26', '#86bdd4'],
  },
  {
    preset: 'cottonCloud',
    labelKey: 'settings.appearance.themePreset.cottonCloud',
    descriptionKey: 'settings.appearance.themePreset.cottonCloud.description',
    preview: 'linear-gradient(135deg, #f8fbff 0%, #dfe9ff 48%, #ffe5f0 100%)',
    swatches: ['#f8fbff', '#6c88d8', '#dc6f9b'],
  },
  {
    preset: 'melonCream',
    labelKey: 'settings.appearance.themePreset.melonCream',
    descriptionKey: 'settings.appearance.themePreset.melonCream.description',
    preview: 'linear-gradient(135deg, #f8fff0 0%, #dff0c9 48%, #ffe2d8 100%)',
    swatches: ['#f8fff0', '#6ca344', '#db7b62'],
  },
  {
    preset: 'seaSaltJelly',
    labelKey: 'settings.appearance.themePreset.seaSaltJelly',
    descriptionKey: 'settings.appearance.themePreset.seaSaltJelly.description',
    preview: 'linear-gradient(135deg, #f1fffb 0%, #cfeeea 48%, #ffe3dd 100%)',
    swatches: ['#f1fffb', '#3c9a92', '#d66d5e'],
  },
  {
    preset: 'caramelPudding',
    labelKey: 'settings.appearance.themePreset.caramelPudding',
    descriptionKey: 'settings.appearance.themePreset.caramelPudding.description',
    preview: 'linear-gradient(135deg, #fff7e8 0%, #f5d29b 46%, #ffdce6 100%)',
    swatches: ['#fff7e8', '#b7772f', '#d56f86'],
  },
  {
    preset: 'neonCandy',
    labelKey: 'settings.appearance.themePreset.neonCandy',
    descriptionKey: 'settings.appearance.themePreset.neonCandy.description',
    preview: 'linear-gradient(135deg, #f6f7ff 0%, #e7dcff 45%, #d8fff7 100%)',
    swatches: ['#f6f7ff', '#8b5cf6', '#ff6fb1'],
  },
  {
    preset: 'nyanCat',
    labelKey: 'settings.appearance.themePreset.nyanCat',
    descriptionKey: 'settings.appearance.themePreset.nyanCat.description',
    preview: 'linear-gradient(135deg, #fff7fb 0%, #d7f3ff 24%, #ffe6a8 44%, #d9ffd8 64%, #eadcff 84%, #ffd7ee 100%)',
    swatches: ['#fff7fb', '#ff5f93', '#ffd84f', '#44c765', '#28b8f0'],
  },
  {
    preset: 'childrenDoodle',
    labelKey: 'settings.appearance.themePreset.childrenDoodle',
    descriptionKey: 'settings.appearance.themePreset.childrenDoodle.description',
    preview: 'linear-gradient(135deg, #fff4dc 0%, #ffd9ec 26%, #d6f7ff 50%, #ede0ff 73%, #fff1a8 100%)',
    swatches: ['#fff4dc', '#ff6fa8', '#566fda', '#66cdb7', '#f4c746'],
  },
  {
    preset: 'wisteriaBubble',
    labelKey: 'settings.appearance.themePreset.wisteriaBubble',
    descriptionKey: 'settings.appearance.themePreset.wisteriaBubble.description',
    preview: 'linear-gradient(135deg, #fbf7ff 0%, #e8d9ff 46%, #dcfff4 100%)',
    swatches: ['#fbf7ff', '#8f6ed5', '#67cdb3'],
  },
  {
    preset: 'strawberryCookie',
    labelKey: 'settings.appearance.themePreset.strawberryCookie',
    descriptionKey: 'settings.appearance.themePreset.strawberryCookie.description',
    preview: 'linear-gradient(135deg, #fff8f0 0%, #f7dcc6 46%, #ffe3ee 100%)',
    swatches: ['#fff8f0', '#d75a72', '#c5924f'],
  },
  {
    preset: 'graphiteAurora',
    labelKey: 'settings.appearance.themePreset.graphiteAurora',
    descriptionKey: 'settings.appearance.themePreset.graphiteAurora.description',
    preview: 'linear-gradient(135deg, #f5f7f8 0%, #dfe6e8 48%, #d8f3ec 100%)',
    swatches: ['#f5f7f8', '#2f7f73', '#496a9f'],
  },
  {
    preset: 'amberNoir',
    labelKey: 'settings.appearance.themePreset.amberNoir',
    descriptionKey: 'settings.appearance.themePreset.amberNoir.description',
    preview: 'linear-gradient(135deg, #fbf7ee 0%, #ead9bb 48%, #f3e7d4 100%)',
    swatches: ['#fbf7ee', '#9a6a24', '#37302b'],
  },
  {
    preset: 'oceanStudio',
    labelKey: 'settings.appearance.themePreset.oceanStudio',
    descriptionKey: 'settings.appearance.themePreset.oceanStudio.description',
    preview: 'linear-gradient(135deg, #f4f8fb 0%, #d8e8ef 48%, #dce3f2 100%)',
    swatches: ['#f4f8fb', '#2f7390', '#596b9a'],
  },
  {
    preset: 'rosewoodVinyl',
    labelKey: 'settings.appearance.themePreset.rosewoodVinyl',
    descriptionKey: 'settings.appearance.themePreset.rosewoodVinyl.description',
    preview: 'linear-gradient(135deg, #fbf3ee 0%, #ead3c7 48%, #f0dfe7 100%)',
    swatches: ['#fbf3ee', '#8f4d48', '#6d4f2c'],
  },
  {
    preset: 'darkSideMoon',
    labelKey: 'settings.appearance.themePreset.darkSideMoon',
    descriptionKey: 'settings.appearance.themePreset.darkSideMoon.description',
    preview: 'linear-gradient(135deg, #10111a 0%, #202638 42%, #f6f0d8 49%, #ed2f3b 55%, #f68e20 62%, #ffd84f 69%, #44c765 76%, #28b8f0 84%, #8d63c7 100%)',
    swatches: ['#10111a', '#f6f0d8', '#ed2f3b', '#ffd84f', '#28b8f0'],
  },
  {
    preset: 'shibuyaNight',
    labelKey: 'settings.appearance.themePreset.shibuyaNight',
    descriptionKey: 'settings.appearance.themePreset.shibuyaNight.description',
    preview: 'linear-gradient(135deg, #1b0d2b 0%, #3a185e 46%, #073449 100%)',
    swatches: ['#1b0d2b', '#ff3b9d', '#23d0ee'],
  },
  {
    preset: 'kyotoKurenai',
    labelKey: 'settings.appearance.themePreset.kyotoKurenai',
    descriptionKey: 'settings.appearance.themePreset.kyotoKurenai.description',
    preview: 'linear-gradient(135deg, #fff1df 0%, #e8b99b 48%, #f7d989 100%)',
    swatches: ['#fff1df', '#a92f26', '#c08a1e'],
  },
  {
    preset: 'ukiyoIndigo',
    labelKey: 'settings.appearance.themePreset.ukiyoIndigo',
    descriptionKey: 'settings.appearance.themePreset.ukiyoIndigo.description',
    preview: 'linear-gradient(135deg, #eaf1ed 0%, #9fbccb 48%, #d8c094 100%)',
    swatches: ['#eaf1ed', '#174f7f', '#b06d1f'],
  },
  {
    preset: 'fujiSnow',
    labelKey: 'settings.appearance.themePreset.fujiSnow',
    descriptionKey: 'settings.appearance.themePreset.fujiSnow.description',
    preview: 'linear-gradient(135deg, #edf8ff 0%, #badcff 48%, #f5d1e6 100%)',
    swatches: ['#edf8ff', '#246fc8', '#c74786'],
  },
  {
    preset: 'matsuriLantern',
    labelKey: 'settings.appearance.themePreset.matsuriLantern',
    descriptionKey: 'settings.appearance.themePreset.matsuriLantern.description',
    preview: 'linear-gradient(135deg, #fff0d8 0%, #efae67 48%, #ffd35f 100%)',
    swatches: ['#fff0d8', '#c23c28', '#d88409'],
  },
  {
    preset: 'ginzaNoir',
    labelKey: 'settings.appearance.themePreset.ginzaNoir',
    descriptionKey: 'settings.appearance.themePreset.ginzaNoir.description',
    preview: 'linear-gradient(135deg, #090a0d 0%, #111219 48%, #1b1712 100%)',
    swatches: ['#090a0d', '#d6b158', '#66a8d4'],
  },
  {
    preset: 'frostJazz',
    labelKey: 'settings.appearance.themePreset.frostJazz',
    descriptionKey: 'settings.appearance.themePreset.frostJazz.description',
    preview: 'linear-gradient(135deg, #eaf2fb 0%, #aac2df 48%, #d4c0dc 100%)',
    swatches: ['#eaf2fb', '#245f9e', '#7f3e70'],
  },
  {
    preset: 'FINAL',
    labelKey: 'settings.appearance.themePreset.FINAL',
    descriptionKey: 'settings.appearance.themePreset.FINAL.description',
    preview: 'repeating-linear-gradient(90deg, rgb(124 133 136 / 0.22) 0 1px, transparent 1px 22px), linear-gradient(135deg, #f4f5f4 0%, #dde0df 46%, #101214 47%, #30363a 100%)',
    swatches: ['#f4f5f4', '#30363a', '#7c8588', '#b08a56'],
  },
];

export const randomThemePresetOption = {
  labelKey: 'settings.appearance.themePreset.random',
  descriptionKey: 'settings.appearance.themePreset.random.description',
  preview: 'linear-gradient(135deg, #f7f8fb 0%, #e4ecea 44%, #f2e2d8 100%)',
  swatches: ['#f7f8fb', '#3f6f9e', '#6f9a8d', '#b47b68'],
} satisfies {
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  preview: string;
  swatches: string[];
};

export type GeneratedRandomThemeDraft = {
  dark: AppThemeToneOverride;
  light: AppThemeToneOverride;
};

export type PluginThemeOption = PluginThemePresetContribution & {
  pluginId: string;
  pluginName: string;
  pluginVersion: string;
  customThemeId: string;
};

const pluginThemeStableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0').slice(0, 8);
};

const pluginThemeCustomId = (pluginId: string, themeId: string): string => {
  const readableThemeId = themeId.replace(/[^a-zA-Z0-9_.:-]/g, '-').slice(0, 40) || 'theme';
  return `plugin:${pluginThemeStableHash(`${pluginId}:${themeId}`)}:${readableThemeId}`;
};

export const collectPluginThemeOptions = (plugins: PluginSummary[]): PluginThemeOption[] =>
  plugins.flatMap((plugin) => {
    if (!plugin.enabled || plugin.disabledByHost || plugin.error) {
      return [];
    }

    return (plugin.contributes.themePresets ?? [])
      .filter((theme) => theme.basePreset !== 'FINAL')
      .map((theme) => ({
        ...theme,
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginVersion: plugin.version,
        customThemeId: pluginThemeCustomId(plugin.id, theme.id),
      }));
  });

export const isEchoProUnlockPluginActive = (plugin: Pick<PluginSummary, 'id' | 'enabled' | 'status' | 'disabledByHost'>): boolean =>
  plugin.id === echoProUnlockPluginId && plugin.enabled === true && plugin.disabledByHost !== true && plugin.status !== 'error';

const proOnlyThemePresetSet = new Set<AppThemePreset>(proOnlyThemePresets);

export const isProOnlyThemePreset = (preset: AppThemePreset): boolean => proOnlyThemePresetSet.has(preset);

export type ThemeTone = 'light' | 'dark';
export type ThemeColorField = keyof Pick<
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
>;
export type ThemeNumberField = keyof Pick<
  AppThemeToneOverride,
  'panelOpacityPercent' | 'glassPercent' | 'shadowPercent' | 'cornerRadiusPx' | 'panelBlurPx' | 'saturationPercent' | 'motionSpeedSeconds' | 'motionIntensityPercent'
>;
type ThemeBooleanField = keyof Pick<AppThemeToneOverride, 'motionEnabled'>;
export type ThemeEditorDefaults = Required<Pick<AppThemeToneOverride, ThemeColorField | ThemeNumberField | ThemeBooleanField>>;
type ThemeLegacyExportPayload = {
  exportedAt: string;
  overrides: AppThemePresetOverrides;
  preset: AppThemePreset;
  schema: 'echo-next.theme-preset';
  version: 1;
};
type ThemeCustomExportPayload = {
  exportedAt: string;
  schema: 'echo-next.custom-theme';
  theme: AppThemeCustomTheme;
  version: 2;
};
type ThemeExportPayload = ThemeLegacyExportPayload | ThemeCustomExportPayload;

const baseThemeEditorDefaults: Record<ThemeTone, ThemeEditorDefaults> = {
  light: {
    appBg: '#f6f6f7',
    appBg2: '#edeef0',
    appBg3: '#e6e7ea',
    panel: '#ffffff',
    panelSoft: '#eff0f2',
    accent: '#4b55e8',
    accentStrong: '#3239c7',
    secondary: '#727987',
    heading: '#1e2025',
    text: '#2d3036',
    muted: '#6c7179',
    border: '#26282e',
    onAccent: '#ffffff',
    buttonText: '#3c4048',
    titlebar: '#ffffff',
    sidebar: '#eff0f2',
    player: '#fafafb',
    field: '#ffffff',
    row: '#ffffff',
    rowHover: '#f8f8f9',
    rowActive: '#eceeff',
    chip: '#ffffff',
    focus: '#4b55e8',
    danger: '#d64545',
    success: '#2f8f72',
    warning: '#c98a16',
    panelOpacityPercent: 72,
    glassPercent: 18,
    shadowPercent: 100,
    cornerRadiusPx: 14,
    panelBlurPx: 15,
    saturationPercent: 100,
    motionEnabled: true,
    motionSpeedSeconds: 0.22,
    motionIntensityPercent: 100,
  },
  dark: {
    appBg: '#101318',
    appBg2: '#151a22',
    appBg3: '#111827',
    panel: '#1c222b',
    panelSoft: '#161b23',
    accent: '#75b7ff',
    accentStrong: '#cce6ff',
    secondary: '#7dd7cb',
    heading: '#f8fbff',
    text: '#d8e0ea',
    muted: '#a8b5c4',
    border: '#647c96',
    onAccent: '#0f1720',
    buttonText: '#d8e0ea',
    titlebar: '#1c222b',
    sidebar: '#161b23',
    player: '#1c222b',
    field: '#1c222b',
    row: '#1c222b',
    rowHover: '#253040',
    rowActive: '#75b7ff',
    chip: '#1c222b',
    focus: '#75b7ff',
    danger: '#ff7575',
    success: '#7dd7a4',
    warning: '#f0b84a',
    panelOpacityPercent: 86,
    glassPercent: 22,
    shadowPercent: 100,
    cornerRadiusPx: 14,
    panelBlurPx: 16,
    saturationPercent: 100,
    motionEnabled: true,
    motionSpeedSeconds: 0.22,
    motionIntensityPercent: 100,
  },
};

const themeEditorDefaults: Record<AppThemePreset, Record<ThemeTone, Partial<ThemeEditorDefaults>>> = {
  classic: {
    light: {
      appBg: '#f6f6f7',
      appBg2: '#edeef0',
      appBg3: '#e6e7ea',
      panel: '#ffffff',
      panelSoft: '#eff0f2',
      accent: '#4b55e8',
      accentStrong: '#3239c7',
      secondary: '#727987',
      heading: '#1e2025',
      text: '#2d3036',
      muted: '#6c7179',
      border: '#26282e',
      onAccent: '#ffffff',
      buttonText: '#344540',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#101318',
      appBg2: '#151a22',
      appBg3: '#111827',
      panel: '#1c222b',
      panelSoft: '#161b23',
      accent: '#75b7ff',
      accentStrong: '#cce6ff',
      secondary: '#7dd7cb',
      heading: '#f8fbff',
      text: '#d8e0ea',
      muted: '#a8b5c4',
      border: '#647c96',
      onAccent: '#0f1720',
      buttonText: '#d8e0ea',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  echoTwilight: {
    light: {
      appBg: '#fff4ef',
      appBg2: '#f3d7cf',
      appBg3: '#efe5f2',
      panel: '#fffcf9',
      panelSoft: '#fbe9e4',
      accent: '#df6b5f',
      accentStrong: '#a83e37',
      secondary: '#8ccfc8',
      heading: '#352321',
      text: '#4f3833',
      muted: '#765d57',
      border: '#b87065',
      onAccent: '#ffffff',
      buttonText: '#4f3833',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#151012',
      appBg2: '#211719',
      appBg3: '#171320',
      panel: '#271e21',
      panelSoft: '#1f181b',
      accent: '#e2776d',
      accentStrong: '#ffd0ca',
      secondary: '#8fd4ce',
      heading: '#fff7f4',
      text: '#f3e3de',
      muted: '#d2b9b2',
      border: '#df8479',
      onAccent: '#2b1513',
      buttonText: '#f3e3de',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  sakuraMilk: {
    light: {
      appBg: '#fff6f9',
      appBg2: '#f7d9e7',
      appBg3: '#f0eefc',
      panel: '#fffdfe',
      panelSoft: '#fce8f0',
      accent: '#cf5d7d',
      accentStrong: '#9a3157',
      secondary: '#7fc8d6',
      heading: '#361f29',
      text: '#55333f',
      muted: '#765b66',
      border: '#b05d7c',
      onAccent: '#ffffff',
      buttonText: '#55333f',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#151015',
      appBg2: '#231722',
      appBg3: '#171627',
      panel: '#271e26',
      panelSoft: '#201820',
      accent: '#e17599',
      accentStrong: '#ffd0df',
      secondary: '#8acdda',
      heading: '#fff6fb',
      text: '#f4e2ea',
      muted: '#d4b7c3',
      border: '#da7797',
      onAccent: '#2c131d',
      buttonText: '#f4e2ea',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  peachSoda: {
    light: {
      appBg: '#fff2e8',
      appBg2: '#ffd6bd',
      appBg3: '#d7f4ee',
      panel: '#fffdf9',
      panelSoft: '#faeadc',
      accent: '#d96d4c',
      accentStrong: '#9c3e26',
      secondary: '#5eb9ad',
      heading: '#33231d',
      text: '#50392f',
      muted: '#745d54',
      border: '#b3684c',
      onAccent: '#ffffff',
      buttonText: '#50392f',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#15110f',
      appBg2: '#241915',
      appBg3: '#10201f',
      panel: '#271f1b',
      panelSoft: '#201916',
      accent: '#e27b58',
      accentStrong: '#ffd2c1',
      secondary: '#78c9be',
      heading: '#fff5ef',
      text: '#f4e3d8',
      muted: '#d2b8ac',
      border: '#da7e56',
      onAccent: '#2c1710',
      buttonText: '#f4e3d8',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  mintCandy: {
    light: {
      appBg: '#f6fff8',
      appBg2: '#d7f2df',
      appBg3: '#ffe5ec',
      panel: '#fdfffa',
      panelSoft: '#e6f5e6',
      accent: '#3f9274',
      accentStrong: '#27664f',
      secondary: '#dd6e86',
      heading: '#1f3029',
      text: '#33493e',
      muted: '#556f63',
      border: '#5c896f',
      onAccent: '#ffffff',
      buttonText: '#33493e',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#101512',
      appBg2: '#17231c',
      appBg3: '#23151b',
      panel: '#1d2721',
      panelSoft: '#17201b',
      accent: '#6bc09b',
      accentStrong: '#c3f5df',
      secondary: '#e28aa0',
      heading: '#f5fff8',
      text: '#e0f0e7',
      muted: '#b7d0c3',
      border: '#61b991',
      onAccent: '#10261c',
      buttonText: '#e0f0e7',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  berryDream: {
    light: {
      appBg: '#f8f5ff',
      appBg2: '#e2d9fb',
      appBg3: '#ffddec',
      panel: '#fffdff',
      panelSoft: '#efe8fa',
      accent: '#7657b8',
      accentStrong: '#563995',
      secondary: '#cf5f95',
      heading: '#2d2440',
      text: '#45395b',
      muted: '#655878',
      border: '#725ba6',
      onAccent: '#ffffff',
      buttonText: '#45395b',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#11101a',
      appBg2: '#1b1730',
      appBg3: '#241421',
      panel: '#201d2e',
      panelSoft: '#1a1726',
      accent: '#9a79dd',
      accentStrong: '#ddd0ff',
      secondary: '#e48ab5',
      heading: '#fbf8ff',
      text: '#e9e4f7',
      muted: '#c4badd',
      border: '#9277d4',
      onAccent: '#1d1233',
      buttonText: '#e9e4f7',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  matchaCream: {
    light: {
      appBg: '#fbfaeb',
      appBg2: '#e1edc9',
      appBg3: '#f6d9d7',
      panel: '#fffef6',
      panelSoft: '#ecefd4',
      accent: '#6e8f49',
      accentStrong: '#4d6b2f',
      secondary: '#c8757a',
      heading: '#2b301d',
      text: '#42452d',
      muted: '#62664a',
      border: '#7c8e4f',
      onAccent: '#ffffff',
      buttonText: '#42452d',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#12140e',
      appBg2: '#1d2215',
      appBg3: '#241716',
      panel: '#22261c',
      panelSoft: '#1c2017',
      accent: '#95b766',
      accentStrong: '#e5f5bd',
      secondary: '#dd8d91',
      heading: '#fbffe9',
      text: '#e8eddb',
      muted: '#c6d0ad',
      border: '#8ba658',
      onAccent: '#1d250f',
      buttonText: '#e8eddb',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  lemonMochi: {
    light: {
      appBg: '#fffbe6',
      appBg2: '#f6e7ad',
      appBg3: '#eaf4fb',
      panel: '#fffef5',
      panelSoft: '#f7eecb',
      accent: '#c99a26',
      accentStrong: '#8a6113',
      secondary: '#86bdd4',
      heading: '#332a10',
      text: '#4c3f1c',
      muted: '#706133',
      border: '#b28d37',
      onAccent: '#241800',
      buttonText: '#4c3f1c',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#15140f',
      appBg2: '#221f13',
      appBg3: '#111b23',
      panel: '#262319',
      panelSoft: '#201d15',
      accent: '#d5aa3a',
      accentStrong: '#ffe59a',
      secondary: '#8bc8df',
      heading: '#fff9df',
      text: '#f5eed2',
      muted: '#d5c99a',
      border: '#cfa93f',
      onAccent: '#2a1d05',
      buttonText: '#f5eed2',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  cottonCloud: {
    light: {
      appBg: '#f8fbff',
      appBg2: '#dfe9ff',
      appBg3: '#ffe5f0',
      panel: '#fdfeff',
      panelSoft: '#e7eefd',
      accent: '#6c88d8',
      accentStrong: '#3f5fb5',
      secondary: '#dc6f9b',
      heading: '#20283c',
      text: '#3a435c',
      muted: '#5c6680',
      border: '#6980bc',
      onAccent: '#ffffff',
      buttonText: '#3a435c',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#10131d',
      appBg2: '#171d31',
      appBg3: '#241521',
      panel: '#1d2231',
      panelSoft: '#171c2a',
      accent: '#8ba5f0',
      accentStrong: '#dae3ff',
      secondary: '#e58db3',
      heading: '#fbfdff',
      text: '#e8eefc',
      muted: '#c2cce8',
      border: '#7e96e4',
      onAccent: '#11192c',
      buttonText: '#e8eefc',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  melonCream: {
    light: {
      appBg: '#f8fff0',
      appBg2: '#dff0c9',
      appBg3: '#ffe2d8',
      panel: '#fdfff8',
      panelSoft: '#e7f1d8',
      accent: '#6ca344',
      accentStrong: '#47752a',
      secondary: '#db7b62',
      heading: '#213218',
      text: '#354827',
      muted: '#596f45',
      border: '#6d9348',
      onAccent: '#ffffff',
      buttonText: '#354827',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#10160f',
      appBg2: '#172415',
      appBg3: '#251814',
      panel: '#1d281c',
      panelSoft: '#172116',
      accent: '#8cc76a',
      accentStrong: '#d8f6bf',
      secondary: '#e18d78',
      heading: '#f8ffe9',
      text: '#e8f3dc',
      muted: '#c3d8ad',
      border: '#7bb852',
      onAccent: '#14270e',
      buttonText: '#e8f3dc',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  seaSaltJelly: {
    light: {
      appBg: '#f1fffb',
      appBg2: '#cfeeea',
      appBg3: '#ffe3dd',
      panel: '#fafffd',
      panelSoft: '#dbf1ee',
      accent: '#3c9a92',
      accentStrong: '#226f68',
      secondary: '#d66d5e',
      heading: '#183633',
      text: '#2b4d49',
      muted: '#4f716d',
      border: '#48948d',
      onAccent: '#ffffff',
      buttonText: '#2b4d49',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#0f1718',
      appBg2: '#152525',
      appBg3: '#241714',
      panel: '#1a292a',
      panelSoft: '#152223',
      accent: '#67c9c0',
      accentStrong: '#c2f5ef',
      secondary: '#e28b7d',
      heading: '#f2fffc',
      text: '#dcf1ee',
      muted: '#b1d8d2',
      border: '#50bdb5',
      onAccent: '#0d2826',
      buttonText: '#dcf1ee',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  caramelPudding: {
    light: {
      appBg: '#fff7e8',
      appBg2: '#f5d29b',
      appBg3: '#ffdce6',
      panel: '#fffaf0',
      panelSoft: '#f4dfb8',
      accent: '#b7772f',
      accentStrong: '#7f4b18',
      secondary: '#d56f86',
      heading: '#3a2511',
      text: '#5a3a20',
      muted: '#7a5940',
      border: '#b98245',
      onAccent: '#ffffff',
      buttonText: '#5a3a20',
      panelOpacityPercent: 74,
      glassPercent: 16,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#18110b',
      appBg2: '#2a1b10',
      appBg3: '#2a1019',
      panel: '#2b1c12',
      panelSoft: '#21160f',
      accent: '#e0a45c',
      accentStrong: '#ffd79a',
      secondary: '#f18aa7',
      heading: '#fff3db',
      text: '#f1d8b7',
      muted: '#d5b58a',
      border: '#d68f45',
      onAccent: '#29170a',
      buttonText: '#f1d8b7',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  neonCandy: {
    light: {
      appBg: '#f6f7ff',
      appBg2: '#e7dcff',
      appBg3: '#d8fff7',
      panel: '#ffffff',
      panelSoft: '#efe9ff',
      accent: '#8b5cf6',
      accentStrong: '#5b39b4',
      secondary: '#ff6fb1',
      heading: '#241a3f',
      text: '#46385f',
      muted: '#6a5a82',
      border: '#9275e8',
      onAccent: '#ffffff',
      buttonText: '#46385f',
      panelOpacityPercent: 72,
      glassPercent: 20,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#101021',
      appBg2: '#1b1640',
      appBg3: '#102b2b',
      panel: '#1f1b39',
      panelSoft: '#16162b',
      accent: '#a989ff',
      accentStrong: '#e1d7ff',
      secondary: '#ff84be',
      heading: '#f7f2ff',
      text: '#e7dcff',
      muted: '#c4b5e8',
      border: '#9b7cff',
      onAccent: '#181033',
      buttonText: '#e7dcff',
      panelOpacityPercent: 86,
      glassPercent: 24,
      shadowPercent: 100,
    },
  },
  nyanCat: {
    light: {
      appBg: '#fff7fb',
      appBg2: '#d7f3ff',
      appBg3: '#eadcff',
      panel: '#ffffff',
      panelSoft: '#eef8ff',
      accent: '#ff5f93',
      accentStrong: '#cf3f75',
      secondary: '#28b8f0',
      heading: '#2b2f5f',
      text: '#475072',
      muted: '#697392',
      border: '#7aa7d9',
      onAccent: '#ffffff',
      buttonText: '#475072',
      panelOpacityPercent: 76,
      glassPercent: 24,
      shadowPercent: 90,
    },
    dark: {
      appBg: '#11132d',
      appBg2: '#172959',
      appBg3: '#35164b',
      panel: '#1d2348',
      panelSoft: '#161a38',
      accent: '#ff7fb0',
      accentStrong: '#ffd1e5',
      secondary: '#59d9ff',
      heading: '#fff6fb',
      text: '#eaf1ff',
      muted: '#bfc9ee',
      border: '#7aa7ff',
      onAccent: '#2b0f24',
      buttonText: '#eaf1ff',
      panelOpacityPercent: 88,
      glassPercent: 28,
      shadowPercent: 100,
    },
  },
  childrenDoodle: {
    light: {
      appBg: '#fff4dc',
      appBg2: '#ffd9ec',
      appBg3: '#d6f7ff',
      panel: '#fffaf0',
      panelSoft: '#f9e7d0',
      accent: '#566fda',
      accentStrong: '#244caa',
      secondary: '#ff6fa8',
      heading: '#203f83',
      text: '#42537a',
      muted: '#6f7897',
      border: '#5f82c6',
      onAccent: '#ffffff',
      buttonText: '#42537a',
      panelOpacityPercent: 82,
      glassPercent: 10,
      shadowPercent: 56,
      cornerRadiusPx: 8,
      panelBlurPx: 4,
      saturationPercent: 112,
      motionSpeedSeconds: 0.18,
      motionIntensityPercent: 78,
    },
    dark: {
      appBg: '#17142a',
      appBg2: '#241f42',
      appBg3: '#12313a',
      panel: '#292540',
      panelSoft: '#1f1b34',
      accent: '#ff8dbc',
      accentStrong: '#ffd2e4',
      secondary: '#7be5d1',
      heading: '#fff4fb',
      text: '#eee5ff',
      muted: '#cbbfe6',
      border: '#a68cf1',
      onAccent: '#321020',
      buttonText: '#eee5ff',
      panelOpacityPercent: 88,
      glassPercent: 14,
      shadowPercent: 72,
      cornerRadiusPx: 8,
      panelBlurPx: 6,
      saturationPercent: 118,
      motionSpeedSeconds: 0.18,
      motionIntensityPercent: 78,
    },
  },
  wisteriaBubble: {
    light: {
      appBg: '#fbf7ff',
      appBg2: '#e8d9ff',
      appBg3: '#dcfff4',
      panel: '#fffaff',
      panelSoft: '#eee2ff',
      accent: '#8f6ed5',
      accentStrong: '#6043a6',
      secondary: '#67cdb3',
      heading: '#2c2144',
      text: '#4c3c68',
      muted: '#6f5f8c',
      border: '#9c82df',
      onAccent: '#ffffff',
      buttonText: '#4c3c68',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#13101d',
      appBg2: '#211a36',
      appBg3: '#10251f',
      panel: '#211a32',
      panelSoft: '#171423',
      accent: '#b99cff',
      accentStrong: '#eee6ff',
      secondary: '#7be0c5',
      heading: '#fbf7ff',
      text: '#e7dcfb',
      muted: '#c9b9e8',
      border: '#a88aff',
      onAccent: '#1c1230',
      buttonText: '#e7dcfb',
      panelOpacityPercent: 86,
      glassPercent: 24,
      shadowPercent: 100,
    },
  },
  strawberryCookie: {
    light: {
      appBg: '#fff8f0',
      appBg2: '#f7dcc6',
      appBg3: '#ffe3ee',
      panel: '#fffaf4',
      panelSoft: '#f4dfcf',
      accent: '#d75a72',
      accentStrong: '#9f3449',
      secondary: '#c5924f',
      heading: '#3b211c',
      text: '#5b3a32',
      muted: '#7c5d52',
      border: '#c9798a',
      onAccent: '#ffffff',
      buttonText: '#5b3a32',
      panelOpacityPercent: 74,
      glassPercent: 16,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#19100f',
      appBg2: '#2a1915',
      appBg3: '#291018',
      panel: '#2b1b18',
      panelSoft: '#211412',
      accent: '#f08aa0',
      accentStrong: '#ffd0da',
      secondary: '#e0b66c',
      heading: '#fff0e8',
      text: '#f1d2c9',
      muted: '#d9b2a4',
      border: '#e18196',
      onAccent: '#321017',
      buttonText: '#f1d2c9',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  graphiteAurora: {
    light: {
      appBg: '#f5f7f8',
      appBg2: '#dfe6e8',
      appBg3: '#d8f3ec',
      panel: '#fbfcfc',
      panelSoft: '#e8eef0',
      accent: '#2f7f73',
      accentStrong: '#1f5d55',
      secondary: '#496a9f',
      heading: '#1f292b',
      text: '#3f5053',
      muted: '#637174',
      border: '#7a9698',
      onAccent: '#ffffff',
      buttonText: '#3f5053',
      panelOpacityPercent: 76,
      glassPercent: 18,
      shadowPercent: 80,
    },
    dark: {
      appBg: '#101416',
      appBg2: '#182123',
      appBg3: '#10241f',
      panel: '#20292b',
      panelSoft: '#171f21',
      accent: '#5ec4b5',
      accentStrong: '#b2efe6',
      secondary: '#86a8e7',
      heading: '#edf6f5',
      text: '#d4e3e1',
      muted: '#a8bcba',
      border: '#5fb4aa',
      onAccent: '#0b2824',
      buttonText: '#d4e3e1',
      panelOpacityPercent: 88,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  amberNoir: {
    light: {
      appBg: '#fbf7ee',
      appBg2: '#ead9bb',
      appBg3: '#f3e7d4',
      panel: '#fffaf1',
      panelSoft: '#efe1c9',
      accent: '#9a6a24',
      accentStrong: '#624015',
      secondary: '#6a4b3a',
      heading: '#33291e',
      text: '#584737',
      muted: '#7a6a59',
      border: '#b99662',
      onAccent: '#ffffff',
      buttonText: '#584737',
      panelOpacityPercent: 76,
      glassPercent: 14,
      shadowPercent: 90,
    },
    dark: {
      appBg: '#11100e',
      appBg2: '#211a12',
      appBg3: '#2a2118',
      panel: '#2a241c',
      panelSoft: '#1d1914',
      accent: '#d4a64c',
      accentStrong: '#f5d78f',
      secondary: '#b88763',
      heading: '#fff3d8',
      text: '#ead9bd',
      muted: '#c3ad8d',
      border: '#c89a4b',
      onAccent: '#221405',
      buttonText: '#ead9bd',
      panelOpacityPercent: 88,
      glassPercent: 20,
      shadowPercent: 100,
    },
  },
  oceanStudio: {
    light: {
      appBg: '#f4f8fb',
      appBg2: '#d8e8ef',
      appBg3: '#dce3f2',
      panel: '#fbfdff',
      panelSoft: '#e5eef4',
      accent: '#2f7390',
      accentStrong: '#1d526a',
      secondary: '#596b9a',
      heading: '#202d3a',
      text: '#415363',
      muted: '#607486',
      border: '#7da3b7',
      onAccent: '#ffffff',
      buttonText: '#415363',
      panelOpacityPercent: 78,
      glassPercent: 20,
      shadowPercent: 80,
    },
    dark: {
      appBg: '#0f151b',
      appBg2: '#132332',
      appBg3: '#17203a',
      panel: '#1e2a34',
      panelSoft: '#16212b',
      accent: '#68b4d4',
      accentStrong: '#c2eaff',
      secondary: '#9aa7e8',
      heading: '#edf7ff',
      text: '#d4e5ef',
      muted: '#a9bfce',
      border: '#6cb1cf',
      onAccent: '#0c2531',
      buttonText: '#d4e5ef',
      panelOpacityPercent: 88,
      glassPercent: 24,
      shadowPercent: 100,
    },
  },
  rosewoodVinyl: {
    light: {
      appBg: '#fbf3ee',
      appBg2: '#ead3c7',
      appBg3: '#f0dfe7',
      panel: '#fff8f4',
      panelSoft: '#efdcd3',
      accent: '#8f4d48',
      accentStrong: '#66312d',
      secondary: '#8b6a3e',
      heading: '#35211f',
      text: '#5c4240',
      muted: '#7e6662',
      border: '#b27a73',
      onAccent: '#ffffff',
      buttonText: '#5c4240',
      panelOpacityPercent: 76,
      glassPercent: 16,
      shadowPercent: 90,
    },
    dark: {
      appBg: '#140f10',
      appBg2: '#251717',
      appBg3: '#201821',
      panel: '#2a1d1d',
      panelSoft: '#1e1516',
      accent: '#d4827b',
      accentStrong: '#f3b8ae',
      secondary: '#d2a45c',
      heading: '#fff0eb',
      text: '#ebd1cb',
      muted: '#c7aaa3',
      border: '#d18279',
      onAccent: '#2f1210',
      buttonText: '#ebd1cb',
      panelOpacityPercent: 88,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  darkSideMoon: {
    light: {
      appBg: '#171722',
      appBg2: '#202638',
      appBg3: '#151827',
      panel: '#232635',
      panelSoft: '#181b28',
      accent: '#f6f0d8',
      accentStrong: '#8fdcff',
      secondary: '#ffd84f',
      heading: '#fff7df',
      text: '#eef2fb',
      muted: '#cad4e7',
      border: '#c5d2e8',
      onAccent: '#121521',
      buttonText: '#eef2fb',
      panelOpacityPercent: 88,
      glassPercent: 24,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#10111a',
      appBg2: '#181d2b',
      appBg3: '#202337',
      panel: '#1e212f',
      panelSoft: '#131622',
      accent: '#f7f1dc',
      accentStrong: '#93dcff',
      secondary: '#28b8f0',
      heading: '#fff8df',
      text: '#eef3ff',
      muted: '#cbd7ec',
      border: '#cddaf0',
      onAccent: '#10131d',
      buttonText: '#eef3ff',
      panelOpacityPercent: 92,
      glassPercent: 28,
      shadowPercent: 100,
    },
  },
  shibuyaNight: {
    light: {
      appBg: '#1b0d2b',
      appBg2: '#3a185e',
      appBg3: '#073449',
      panel: '#2a1f3a',
      panelSoft: '#1d142d',
      accent: '#ff3b9d',
      accentStrong: '#ffd4ee',
      secondary: '#23d0ee',
      heading: '#fff6ff',
      text: '#f1e8ff',
      muted: '#cdbde8',
      border: '#da3796',
      onAccent: '#26001a',
      buttonText: '#f1e8ff',
      panelOpacityPercent: 90,
      glassPercent: 30,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#070411',
      appBg2: '#120824',
      appBg3: '#061a24',
      panel: '#170f26',
      panelSoft: '#10091c',
      accent: '#ff2f98',
      accentStrong: '#ffd3ed',
      secondary: '#18d5f4',
      heading: '#fff4ff',
      text: '#f0e5ff',
      muted: '#c7b5e4',
      border: '#f03aa4',
      onAccent: '#240018',
      buttonText: '#f0e5ff',
      panelOpacityPercent: 92,
      glassPercent: 30,
      shadowPercent: 100,
    },
  },
  kyotoKurenai: {
    light: {
      appBg: '#fff1df',
      appBg2: '#e8b99b',
      appBg3: '#f7d989',
      panel: '#fff8ed',
      panelSoft: '#f0d5b7',
      accent: '#a92f26',
      accentStrong: '#6e1d17',
      secondary: '#c08a1e',
      heading: '#30170f',
      text: '#543124',
      muted: '#755040',
      border: '#a64d36',
      onAccent: '#ffffff',
      buttonText: '#543124',
      panelOpacityPercent: 76,
      glassPercent: 16,
      shadowPercent: 90,
    },
    dark: {
      appBg: '#120807',
      appBg2: '#27100d',
      appBg3: '#241806',
      panel: '#2a1914',
      panelSoft: '#1d100d',
      accent: '#ff5f4a',
      accentStrong: '#ffd2c4',
      secondary: '#e3b23c',
      heading: '#fff4e8',
      text: '#f4d8c6',
      muted: '#d5b39b',
      border: '#e6644f',
      onAccent: '#310b06',
      buttonText: '#f4d8c6',
      panelOpacityPercent: 88,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  ukiyoIndigo: {
    light: {
      appBg: '#eaf1ed',
      appBg2: '#9fbccb',
      appBg3: '#d8c094',
      panel: '#fbfbf3',
      panelSoft: '#d6e1df',
      accent: '#174f7f',
      accentStrong: '#0d3659',
      secondary: '#b06d1f',
      heading: '#10283a',
      text: '#314655',
      muted: '#536b78',
      border: '#4f7893',
      onAccent: '#ffffff',
      buttonText: '#314655',
      panelOpacityPercent: 78,
      glassPercent: 18,
      shadowPercent: 82,
    },
    dark: {
      appBg: '#07101a',
      appBg2: '#0a2540',
      appBg3: '#211d15',
      panel: '#172b40',
      panelSoft: '#0d1d2e',
      accent: '#4aa6dd',
      accentStrong: '#c5e7ff',
      secondary: '#d59b43',
      heading: '#edf8ff',
      text: '#d8e8f4',
      muted: '#abc1d1',
      border: '#5eb3e2',
      onAccent: '#041b2f',
      buttonText: '#d8e8f4',
      panelOpacityPercent: 88,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  fujiSnow: {
    light: {
      appBg: '#edf8ff',
      appBg2: '#badcff',
      appBg3: '#f5d1e6',
      panel: '#fbfdff',
      panelSoft: '#d8ecff',
      accent: '#246fc8',
      accentStrong: '#174b90',
      secondary: '#c74786',
      heading: '#12233d',
      text: '#344860',
      muted: '#536983',
      border: '#5b89d0',
      onAccent: '#ffffff',
      buttonText: '#344860',
      panelOpacityPercent: 76,
      glassPercent: 20,
      shadowPercent: 82,
    },
    dark: {
      appBg: '#08111f',
      appBg2: '#10244a',
      appBg3: '#2a1430',
      panel: '#182438',
      panelSoft: '#0f192b',
      accent: '#6b9beb',
      accentStrong: '#d7e7ff',
      secondary: '#f07db7',
      heading: '#f8fbff',
      text: '#e2ecff',
      muted: '#b7c9e6',
      border: '#6b9beb',
      onAccent: '#071936',
      buttonText: '#e2ecff',
      panelOpacityPercent: 88,
      glassPercent: 24,
      shadowPercent: 100,
    },
  },
  matsuriLantern: {
    light: {
      appBg: '#fff0d8',
      appBg2: '#efae67',
      appBg3: '#ffd35f',
      panel: '#fff7e9',
      panelSoft: '#f2d4a7',
      accent: '#c23c28',
      accentStrong: '#842116',
      secondary: '#d88409',
      heading: '#35180d',
      text: '#553323',
      muted: '#77513d',
      border: '#b75a2f',
      onAccent: '#ffffff',
      buttonText: '#553323',
      panelOpacityPercent: 76,
      glassPercent: 16,
      shadowPercent: 94,
    },
    dark: {
      appBg: '#120706',
      appBg2: '#2d100b',
      appBg3: '#2a1a05',
      panel: '#311c15',
      panelSoft: '#21100c',
      accent: '#ff5a3c',
      accentStrong: '#ffd0bf',
      secondary: '#ffb72e',
      heading: '#fff1e2',
      text: '#f5d5c2',
      muted: '#d8ad91',
      border: '#f67c48',
      onAccent: '#340c05',
      buttonText: '#f5d5c2',
      panelOpacityPercent: 88,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  ginzaNoir: {
    light: {
      appBg: '#ebe5da',
      appBg2: '#c7bca8',
      appBg3: '#c2cbd5',
      panel: '#faf7ef',
      panelSoft: '#e0d8c7',
      accent: '#72530e',
      accentStrong: '#4a3507',
      secondary: '#2f668e',
      heading: '#1c1c1d',
      text: '#413b33',
      muted: '#665d50',
      border: '#8a7650',
      onAccent: '#ffffff',
      buttonText: '#413b33',
      panelOpacityPercent: 78,
      glassPercent: 20,
      shadowPercent: 86,
    },
    dark: {
      appBg: '#090a0d',
      appBg2: '#111219',
      appBg3: '#1b1712',
      panel: '#1d1d24',
      panelSoft: '#111218',
      accent: '#d6b158',
      accentStrong: '#ffe1a0',
      secondary: '#66a8d4',
      heading: '#fff5e5',
      text: '#e8dfce',
      muted: '#c2b5a1',
      border: '#d6b158',
      onAccent: '#1f1604',
      buttonText: '#e8dfce',
      panelOpacityPercent: 92,
      glassPercent: 30,
      shadowPercent: 100,
    },
  },
  frostJazz: {
    light: {
      appBg: '#eaf2fb',
      appBg2: '#aac2df',
      appBg3: '#d4c0dc',
      panel: '#fbfdff',
      panelSoft: '#d9e5f2',
      accent: '#245f9e',
      accentStrong: '#163f70',
      secondary: '#7f3e70',
      heading: '#142234',
      text: '#34495f',
      muted: '#546a80',
      border: '#5c7da9',
      onAccent: '#ffffff',
      buttonText: '#34495f',
      panelOpacityPercent: 78,
      glassPercent: 20,
      shadowPercent: 82,
    },
    dark: {
      appBg: '#080d15',
      appBg2: '#101b2c',
      appBg3: '#201426',
      panel: '#182434',
      panelSoft: '#0e1724',
      accent: '#5c8fd3',
      accentStrong: '#d1e4ff',
      secondary: '#c06a9e',
      heading: '#f5f9ff',
      text: '#deebfb',
      muted: '#b1c4dc',
      border: '#5c8fd3',
      onAccent: '#07182d',
      buttonText: '#deebfb',
      panelOpacityPercent: 88,
      glassPercent: 24,
      shadowPercent: 100,
    },
  },
  FINAL: {
    light: {
      appBg: '#f4f5f4',
      appBg2: '#dde0df',
      appBg3: '#fbfbf8',
      panel: '#fcfcf9',
      panelSoft: '#e8eae8',
      accent: '#30363a',
      accentStrong: '#121416',
      secondary: '#7c8588',
      heading: '#101214',
      text: '#333638',
      muted: '#62686a',
      border: '#81898b',
      onAccent: '#f8f8f3',
      buttonText: '#333638',
      panelOpacityPercent: 82,
      glassPercent: 12,
      shadowPercent: 62,
      cornerRadiusPx: 8,
      panelBlurPx: 10,
      saturationPercent: 96,
      motionSpeedSeconds: 0.18,
      motionIntensityPercent: 64,
    },
    dark: {
      appBg: '#08090a',
      appBg2: '#111315',
      appBg3: '#171819',
      panel: '#181a1c',
      panelSoft: '#101214',
      accent: '#c3c7c3',
      accentStrong: '#f1f2ee',
      secondary: '#89969b',
      heading: '#fbfbf8',
      text: '#dce1e1',
      muted: '#aeb7b9',
      border: '#767f84',
      onAccent: '#08090a',
      buttonText: '#dce1e1',
      panelOpacityPercent: 90,
      glassPercent: 18,
      shadowPercent: 92,
      cornerRadiusPx: 8,
      panelBlurPx: 12,
      saturationPercent: 96,
      motionSpeedSeconds: 0.18,
      motionIntensityPercent: 64,
    },
  },
};

export const coreThemeColorFields: Array<{ field: ThemeColorField; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { field: 'appBg', labelKey: 'settings.appearance.themeCustom.field.appBg', descriptionKey: 'settings.appearance.themeCustom.field.appBg.description' },
  { field: 'accent', labelKey: 'settings.appearance.themeCustom.field.accent', descriptionKey: 'settings.appearance.themeCustom.field.accent.description' },
  { field: 'accentStrong', labelKey: 'settings.appearance.themeCustom.field.accentStrong', descriptionKey: 'settings.appearance.themeCustom.field.accentStrong.description' },
  { field: 'secondary', labelKey: 'settings.appearance.themeCustom.field.secondary', descriptionKey: 'settings.appearance.themeCustom.field.secondary.description' },
  { field: 'heading', labelKey: 'settings.appearance.themeCustom.field.heading', descriptionKey: 'settings.appearance.themeCustom.field.heading.description' },
  { field: 'muted', labelKey: 'settings.appearance.themeCustom.field.muted', descriptionKey: 'settings.appearance.themeCustom.field.muted.description' },
  { field: 'panel', labelKey: 'settings.appearance.themeCustom.field.panel', descriptionKey: 'settings.appearance.themeCustom.field.panel.description' },
];

export const gradientThemeColorFields: Array<{ field: ThemeColorField; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { field: 'appBg2', labelKey: 'settings.appearance.themeCustom.field.appBg2', descriptionKey: 'settings.appearance.themeCustom.field.appBg2.description' },
  { field: 'appBg3', labelKey: 'settings.appearance.themeCustom.field.appBg3', descriptionKey: 'settings.appearance.themeCustom.field.appBg3.description' },
];

export const advancedThemeColorFields: Array<{ field: ThemeColorField; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { field: 'panelSoft', labelKey: 'settings.appearance.themeCustom.field.panelSoft', descriptionKey: 'settings.appearance.themeCustom.field.panelSoft.description' },
  { field: 'text', labelKey: 'settings.appearance.themeCustom.field.text', descriptionKey: 'settings.appearance.themeCustom.field.text.description' },
  { field: 'border', labelKey: 'settings.appearance.themeCustom.field.border', descriptionKey: 'settings.appearance.themeCustom.field.border.description' },
  { field: 'onAccent', labelKey: 'settings.appearance.themeCustom.field.onAccent', descriptionKey: 'settings.appearance.themeCustom.field.onAccent.description' },
  { field: 'buttonText', labelKey: 'settings.appearance.themeCustom.field.buttonText', descriptionKey: 'settings.appearance.themeCustom.field.buttonText.description' },
];

export const surfaceThemeColorFields: Array<{ field: ThemeColorField; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { field: 'titlebar', labelKey: 'settings.appearance.themeCustom.field.titlebar', descriptionKey: 'settings.appearance.themeCustom.field.titlebar.description' },
  { field: 'sidebar', labelKey: 'settings.appearance.themeCustom.field.sidebar', descriptionKey: 'settings.appearance.themeCustom.field.sidebar.description' },
  { field: 'player', labelKey: 'settings.appearance.themeCustom.field.player', descriptionKey: 'settings.appearance.themeCustom.field.player.description' },
  { field: 'field', labelKey: 'settings.appearance.themeCustom.field.field', descriptionKey: 'settings.appearance.themeCustom.field.field.description' },
  { field: 'row', labelKey: 'settings.appearance.themeCustom.field.row', descriptionKey: 'settings.appearance.themeCustom.field.row.description' },
  { field: 'rowHover', labelKey: 'settings.appearance.themeCustom.field.rowHover', descriptionKey: 'settings.appearance.themeCustom.field.rowHover.description' },
  { field: 'rowActive', labelKey: 'settings.appearance.themeCustom.field.rowActive', descriptionKey: 'settings.appearance.themeCustom.field.rowActive.description' },
  { field: 'chip', labelKey: 'settings.appearance.themeCustom.field.chip', descriptionKey: 'settings.appearance.themeCustom.field.chip.description' },
];

export const stateThemeColorFields: Array<{ field: ThemeColorField; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { field: 'success', labelKey: 'settings.appearance.themeCustom.field.success', descriptionKey: 'settings.appearance.themeCustom.field.success.description' },
  { field: 'warning', labelKey: 'settings.appearance.themeCustom.field.warning', descriptionKey: 'settings.appearance.themeCustom.field.warning.description' },
  { field: 'danger', labelKey: 'settings.appearance.themeCustom.field.danger', descriptionKey: 'settings.appearance.themeCustom.field.danger.description' },
  { field: 'focus', labelKey: 'settings.appearance.themeCustom.field.focus', descriptionKey: 'settings.appearance.themeCustom.field.focus.description' },
];

export const numberThemeFields: Array<{ field: ThemeNumberField; labelKey: TranslationKey; descriptionKey: TranslationKey; min: number; max: number; step?: number; suffix: string }> = [
  { field: 'panelOpacityPercent', labelKey: 'settings.appearance.themeCustom.field.panelOpacity', descriptionKey: 'settings.appearance.themeCustom.field.panelOpacity.description', min: 40, max: 100, suffix: '%' },
  { field: 'glassPercent', labelKey: 'settings.appearance.themeCustom.field.glass', descriptionKey: 'settings.appearance.themeCustom.field.glass.description', min: 0, max: 80, suffix: '%' },
  { field: 'shadowPercent', labelKey: 'settings.appearance.themeCustom.field.shadow', descriptionKey: 'settings.appearance.themeCustom.field.shadow.description', min: 0, max: 100, suffix: '%' },
  { field: 'cornerRadiusPx', labelKey: 'settings.appearance.themeCustom.field.cornerRadius', descriptionKey: 'settings.appearance.themeCustom.field.cornerRadius.description', min: 0, max: 28, suffix: 'px' },
  { field: 'panelBlurPx', labelKey: 'settings.appearance.themeCustom.field.panelBlur', descriptionKey: 'settings.appearance.themeCustom.field.panelBlur.description', min: 0, max: 32, suffix: 'px' },
  { field: 'saturationPercent', labelKey: 'settings.appearance.themeCustom.field.saturation', descriptionKey: 'settings.appearance.themeCustom.field.saturation.description', min: 60, max: 140, suffix: '%' },
  { field: 'motionSpeedSeconds', labelKey: 'settings.appearance.themeCustom.field.motionSpeed', descriptionKey: 'settings.appearance.themeCustom.field.motionSpeed.description', min: 0.12, max: 8, step: 0.01, suffix: 's' },
  { field: 'motionIntensityPercent', labelKey: 'settings.appearance.themeCustom.field.motionIntensity', descriptionKey: 'settings.appearance.themeCustom.field.motionIntensity.description', min: 0, max: 160, suffix: '%' },
];

const hexToRgb = (value: string): { r: number; g: number; b: number } | null => {
  const color = normalizeThemeHexColor(value);
  if (!color) {
    return null;
  }

  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
  };
};

export const getRelativeLuminance = (value: string): number => {
  const rgb = hexToRgb(value);
  if (!rgb) {
    return 0;
  }

  const channel = (component: number): number => {
    const normalized = component / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return channel(rgb.r) * 0.2126 + channel(rgb.g) * 0.7152 + channel(rgb.b) * 0.0722;
};

const getContrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

export const bestReadableColor = (background: string): string => (getContrastRatio('#ffffff', background) >= getContrastRatio('#241a17', background) ? '#ffffff' : '#241a17');

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const randomNumber = (min: number, max: number): number => min + Math.random() * (max - min);

const randomInteger = (min: number, max: number): number => Math.round(randomNumber(min, max));

const hslToHex = (hue: number, saturation: number, lightness: number): string => {
  const normalizedHue = (((hue % 360) + 360) % 360) / 360;
  const normalizedSaturation = clampNumber(saturation, 0, 100) / 100;
  const normalizedLightness = clampNumber(lightness, 0, 100) / 100;

  const hueToRgb = (p: number, q: number, t: number): number => {
    let nextT = t;
    if (nextT < 0) {
      nextT += 1;
    }
    if (nextT > 1) {
      nextT -= 1;
    }
    if (nextT < 1 / 6) {
      return p + (q - p) * 6 * nextT;
    }
    if (nextT < 1 / 2) {
      return q;
    }
    if (nextT < 2 / 3) {
      return p + (q - p) * (2 / 3 - nextT) * 6;
    }
    return p;
  };

  const q = normalizedLightness < 0.5
    ? normalizedLightness * (1 + normalizedSaturation)
    : normalizedLightness + normalizedSaturation - normalizedLightness * normalizedSaturation;
  const p = 2 * normalizedLightness - q;
  const channels = normalizedSaturation === 0
    ? [normalizedLightness, normalizedLightness, normalizedLightness]
    : [
        hueToRgb(p, q, normalizedHue + 1 / 3),
        hueToRgb(p, q, normalizedHue),
        hueToRgb(p, q, normalizedHue - 1 / 3),
      ];

  return `#${channels.map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;
};

const readableCandidate = (background: string, candidates: string[], minimumRatio: number): string => {
  const ranked = candidates
    .map((color) => ({ color, ratio: getContrastRatio(color, background) }))
    .sort((left, right) => right.ratio - left.ratio);

  return ranked.find((item) => item.ratio >= minimumRatio)?.color ?? ranked[0]?.color ?? bestReadableColor(background);
};

const buildRandomThemeTone = (tone: ThemeTone, hue: number, secondaryHue: number, warmHue: number): AppThemeToneOverride => {
  const tertiaryHue = secondaryHue + randomInteger(42, 86);

  if (tone === 'dark') {
    const appBg = hslToHex(hue, randomInteger(16, 30), randomInteger(8, 12));
    const appBg2 = hslToHex(secondaryHue, randomInteger(18, 34), randomInteger(13, 17));
    const appBg3 = hslToHex(tertiaryHue, randomInteger(16, 30), randomInteger(11, 15));
    const panel = hslToHex(hue, randomInteger(14, 24), randomInteger(17, 21));
    const panelSoft = hslToHex(hue, randomInteger(12, 22), randomInteger(13, 17));
    const accent = hslToHex(hue, randomInteger(46, 60), randomInteger(58, 66));
    const accentStrong = hslToHex(hue, randomInteger(38, 54), randomInteger(74, 82));
    const secondary = hslToHex(secondaryHue, randomInteger(38, 54), randomInteger(56, 66));
    const text = readableCandidate(appBg, ['#eef4ff', '#f8fbff', '#e6edf7'], 4.5);
    const heading = readableCandidate(appBg, ['#ffffff', '#f8fbff', text], 4.5);
    const buttonText = readableCandidate(panel, [text, heading, '#ffffff'], 4.5);

    return {
      appBg,
      appBg2,
      appBg3,
      panel,
      panelSoft,
      accent,
      accentStrong,
      secondary,
      heading,
      text,
      muted: readableCandidate(appBg, ['#b8c5d6', '#c5cfdd', '#d2d9e6'], 4.5),
      border: hslToHex(hue, randomInteger(36, 56), randomInteger(46, 56)),
      onAccent: readableCandidate(accent, ['#101318', '#ffffff'], 3),
      buttonText,
      titlebar: panel,
      sidebar: panelSoft,
      player: panel,
      field: panel,
      row: panel,
      rowHover: hslToHex(hue, randomInteger(16, 28), randomInteger(22, 27)),
      rowActive: hslToHex(hue, randomInteger(34, 48), randomInteger(26, 32)),
      chip: panel,
      focus: accent,
      danger: '#ff7676',
      success: secondary,
      warning: hslToHex(warmHue, randomInteger(52, 66), randomInteger(60, 68)),
      panelOpacityPercent: randomInteger(86, 92),
      glassPercent: randomInteger(16, 24),
      shadowPercent: randomInteger(82, 100),
      cornerRadiusPx: randomInteger(8, 14),
      panelBlurPx: randomInteger(10, 18),
      saturationPercent: randomInteger(88, 106),
      motionEnabled: true,
      motionSpeedSeconds: Math.round(randomNumber(0.2, 0.36) * 100) / 100,
      motionIntensityPercent: randomInteger(54, 88),
    };
  }

  const appBg = hslToHex(hue, randomInteger(18, 34), randomInteger(94, 97));
  const appBg2 = hslToHex(secondaryHue, randomInteger(20, 38), randomInteger(86, 91));
  const appBg3 = hslToHex(tertiaryHue, randomInteger(18, 34), randomInteger(88, 93));
  const panel = hslToHex(hue, randomInteger(10, 22), randomInteger(98, 100));
  const panelSoft = hslToHex(secondaryHue, randomInteger(16, 30), randomInteger(91, 95));
  const accent = hslToHex(hue, randomInteger(42, 58), randomInteger(36, 44));
  const accentStrong = hslToHex(hue, randomInteger(46, 62), randomInteger(26, 34));
  const secondary = hslToHex(secondaryHue, randomInteger(34, 50), randomInteger(36, 46));
  const text = readableCandidate(appBg, ['#26313f', '#1e2430', '#343846'], 4.5);
  const heading = readableCandidate(appBg, ['#101722', '#1d2430', text], 4.5);
  const buttonText = readableCandidate(panel, [text, heading, '#111827'], 4.5);

  return {
    appBg,
    appBg2,
    appBg3,
    panel,
    panelSoft,
    accent,
    accentStrong,
    secondary,
    heading,
    text,
    muted: readableCandidate(appBg, ['#566171', '#626b78', '#4b5563'], 4.5),
    border: hslToHex(hue, randomInteger(30, 48), randomInteger(52, 62)),
    onAccent: readableCandidate(accent, ['#ffffff', '#101318'], 3),
    buttonText,
    titlebar: panel,
    sidebar: panelSoft,
    player: panel,
    field: panel,
    row: panel,
    rowHover: hslToHex(hue, randomInteger(12, 24), randomInteger(95, 98)),
    rowActive: hslToHex(hue, randomInteger(26, 40), randomInteger(89, 93)),
    chip: panel,
    focus: accent,
    danger: '#d64545',
    success: secondary,
    warning: hslToHex(warmHue, randomInteger(44, 60), randomInteger(38, 48)),
    panelOpacityPercent: randomInteger(72, 82),
    glassPercent: randomInteger(12, 20),
    shadowPercent: randomInteger(70, 100),
    cornerRadiusPx: randomInteger(8, 14),
    panelBlurPx: randomInteger(10, 18),
    saturationPercent: randomInteger(88, 104),
    motionEnabled: true,
    motionSpeedSeconds: Math.round(randomNumber(0.2, 0.36) * 100) / 100,
    motionIntensityPercent: randomInteger(50, 84),
  };
};

export const buildRandomThemeDraft = (): GeneratedRandomThemeDraft => {
  const hue = randomInteger(0, 359);
  const secondaryHue = hue + randomInteger(82, 148);
  const warmHue = hue + randomInteger(24, 52);

  return {
    light: buildRandomThemeTone('light', hue, secondaryHue, warmHue),
    dark: buildRandomThemeTone('dark', hue + randomInteger(8, 28), secondaryHue, warmHue),
  };
};

export const getThemeEditorDefaults = (preset: AppThemePreset, tone: ThemeTone): ThemeEditorDefaults => ({
  ...baseThemeEditorDefaults[tone],
  ...(themeEditorDefaults[preset]?.[tone] ?? {}),
});

export const mergeThemeToneValues = (preset: AppThemePreset, tone: ThemeTone, draft: AppThemeToneOverride): ThemeEditorDefaults => ({
  ...getThemeEditorDefaults(preset, tone),
  ...draft,
});

export const buildThemePresetOverrides = (
  current: AppThemePresetOverrides,
  preset: AppThemePreset,
  tone: ThemeTone,
  draft: AppThemeToneOverride | null,
): AppThemePresetOverrides => {
  const next: AppThemePresetOverrides = { ...current };
  const currentPresetOverride = { ...(next[preset] ?? {}) };

  if (!draft || Object.keys(draft).length === 0) {
    delete currentPresetOverride[tone];
  } else {
    currentPresetOverride[tone] = draft;
  }

  if (currentPresetOverride.light || currentPresetOverride.dark) {
    next[preset] = currentPresetOverride;
  } else {
    delete next[preset];
  }

  return next;
};

export const isThemeExportPayload = (value: unknown): value is Partial<ThemeExportPayload> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const readThemeExportPreset = (value: unknown): AppThemePreset | null => {
  if (value === 'FINAL') {
    return null;
  }
  if (!themePresetOptions.some((option) => option.preset === value)) {
    return null;
  }
  return normalizeThemePreset(value);
};

export const createThemeCustomId = (): string => `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const getNextThemeCustomName = (themes: AppThemeCustomTheme[]): string => {
  const usedNames = new Set(themes.map((theme) => theme.name));
  let index = themes.length + 1;
  while (usedNames.has(`我的主题 ${index}`)) {
    index += 1;
  }
  return `我的主题 ${index}`;
};

export const buildThemeCustomTheme = (
  themes: AppThemeCustomTheme[],
  basePreset: AppThemePreset,
  tone: ThemeTone,
  draft: AppThemeToneOverride = {},
  name = getNextThemeCustomName(themes),
): AppThemeCustomTheme => {
  const timestamp = new Date().toISOString();
  const theme: AppThemeCustomTheme = {
    id: createThemeCustomId(),
    name,
    basePreset,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (Object.keys(draft).length > 0) {
    theme[tone] = draft;
  }

  return theme;
};

export const buildPluginThemeCustomTheme = (pluginTheme: PluginThemeOption, existing?: AppThemeCustomTheme): AppThemeCustomTheme => {
  const timestamp = new Date().toISOString();
  const theme: AppThemeCustomTheme = {
    id: pluginTheme.customThemeId,
    name: `${pluginTheme.title} · ${pluginTheme.pluginName}`.slice(0, 48),
    basePreset: pluginTheme.basePreset,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  if (pluginTheme.light) {
    theme.light = { ...pluginTheme.light };
  }
  if (pluginTheme.dark) {
    theme.dark = { ...pluginTheme.dark };
  }

  return theme;
};

export const updateThemeCustomThemeTone = (
  themes: AppThemeCustomTheme[],
  themeId: string,
  tone: ThemeTone,
  draft: AppThemeToneOverride | null,
): AppThemeCustomTheme[] => {
  const timestamp = new Date().toISOString();
  return normalizeThemeCustomThemes(
    themes.map((theme) => {
      if (theme.id !== themeId) {
        return theme;
      }

      const next: AppThemeCustomTheme = { ...theme, updatedAt: timestamp };
      if (!draft || Object.keys(draft).length === 0) {
        delete next[tone];
      } else {
        next[tone] = draft;
      }
      return next;
    }),
  );
};

export const renameThemeCustomTheme = (themes: AppThemeCustomTheme[], themeId: string, name: string): AppThemeCustomTheme[] => {
  const normalized = name.replace(/[\r\n;]/g, '').trim().slice(0, 48);
  if (!normalized) {
    return themes;
  }

  const timestamp = new Date().toISOString();
  return normalizeThemeCustomThemes(themes.map((theme) => (theme.id === themeId ? { ...theme, name: normalized, updatedAt: timestamp } : theme)));
};

export const duplicateThemeCustomTheme = (themes: AppThemeCustomTheme[], themeId: string): AppThemeCustomTheme[] => {
  const source = themes.find((theme) => theme.id === themeId);
  if (!source) {
    return themes;
  }

  const timestamp = new Date().toISOString();
  return normalizeThemeCustomThemes([
    ...themes,
    {
      ...source,
      id: createThemeCustomId(),
      name: `${source.name} Copy`.slice(0, 48),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
};

export const createThemeExportPayload = (
  themes: AppThemeCustomTheme[],
  selectedTheme: AppThemeCustomTheme | undefined,
  selectedPreset: AppThemePreset,
  tone: ThemeTone,
  draft: AppThemeToneOverride,
): ThemeCustomExportPayload => {
  const theme = selectedTheme ?? buildThemeCustomTheme(themes, selectedPreset, tone, draft, getNextThemeCustomName(themes));
  return {
    exportedAt: new Date().toISOString(),
    schema: 'echo-next.custom-theme',
    theme,
    version: 2,
  };
};

export const downloadTextFile = (filename: string, content: string): void => {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const getThemeContrastWarnings = (values: ThemeEditorDefaults): string[] => {
  const warnings: string[] = [];

  if (getContrastRatio(values.text, values.appBg) < 4.5) {
    warnings.push('body');
  }
  if (getContrastRatio(values.heading, values.appBg) < 4.5) {
    warnings.push('heading');
  }
  if (getContrastRatio(values.buttonText, values.panel) < 4.5) {
    warnings.push('button');
  }
  if (getContrastRatio(values.onAccent, values.accent) < 3) {
    warnings.push('accent');
  }

  return warnings;
};

