import type { AppSettings, AppWallpaperFitMode } from '../../../../shared/types/appSettings';
import type { TranslationKey } from '../../../i18n/locales';

export const appWallpaperFitModes = ['fit', 'fill', 'stretch', 'tile', 'center'] satisfies Array<
  NonNullable<AppSettings['appWallpaperFitMode']>
>;

export const appWallpaperFitModeLabels: Record<
  NonNullable<AppSettings['appWallpaperFitMode']>,
  TranslationKey
> = {
  fit: 'settings.appearance.wallpaper.mode.fit',
  fill: 'settings.appearance.wallpaper.mode.fill',
  stretch: 'settings.appearance.wallpaper.mode.stretch',
  tile: 'settings.appearance.wallpaper.mode.tile',
  center: 'settings.appearance.wallpaper.mode.center',
};

export type { AppWallpaperFitMode };

export const appVideoWallpaperPauseModes = ['smart', 'minimized', 'never'] satisfies Array<
  NonNullable<AppSettings['appVideoWallpaperPauseMode']>
>;

export const appVideoWallpaperPauseModeLabels: Record<
  NonNullable<AppSettings['appVideoWallpaperPauseMode']>,
  TranslationKey
> = {
  smart: 'settings.appearance.wallpaper.videoPause.smart',
  minimized: 'settings.appearance.wallpaper.videoPause.minimized',
  never: 'settings.appearance.wallpaper.videoPause.never',
};

type AppWallpaperEffectPresetId = 'balanced' | 'soft' | 'immersive';

type AppWallpaperEffectPatch = Pick<
  AppSettings,
  | 'appWallpaperScalePercent'
  | 'appWallpaperBlurPx'
  | 'appWallpaperBrightnessPercent'
  | 'appWallpaperUiOpacityPercent'
  | 'appWallpaperVisualProtectionEnabled'
  | 'appWallpaperUnifiedOpacityEnabled'
>;

export const appWallpaperEffectPresets: Array<{
  id: AppWallpaperEffectPresetId;
  labelKey: TranslationKey;
  patch: AppWallpaperEffectPatch;
}> = [
  {
    id: 'balanced',
    labelKey: 'settings.appearance.wallpaper.effect.balanced',
    patch: {
      appWallpaperScalePercent: 100,
      appWallpaperBlurPx: 0,
      appWallpaperBrightnessPercent: 92,
      appWallpaperUiOpacityPercent: 76,
      appWallpaperVisualProtectionEnabled: true,
      appWallpaperUnifiedOpacityEnabled: false,
    },
  },
  {
    id: 'soft',
    labelKey: 'settings.appearance.wallpaper.effect.soft',
    patch: {
      appWallpaperScalePercent: 106,
      appWallpaperBlurPx: 8,
      appWallpaperBrightnessPercent: 84,
      appWallpaperUiOpacityPercent: 70,
      appWallpaperVisualProtectionEnabled: true,
      appWallpaperUnifiedOpacityEnabled: false,
    },
  },
  {
    id: 'immersive',
    labelKey: 'settings.appearance.wallpaper.effect.immersive',
    patch: {
      appWallpaperScalePercent: 102,
      appWallpaperBlurPx: 2,
      appWallpaperBrightnessPercent: 90,
      appWallpaperUiOpacityPercent: 56,
      appWallpaperVisualProtectionEnabled: true,
      appWallpaperUnifiedOpacityEnabled: false,
    },
  },
];

export const appWallpaperDisplayName = (filePath: string): string =>
  filePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? filePath;

export const matchesAppWallpaperEffectPreset = (
  settings: AppSettings,
  preset: AppWallpaperEffectPatch,
): boolean =>
  settings.appWallpaperScalePercent === preset.appWallpaperScalePercent &&
  settings.appWallpaperBlurPx === preset.appWallpaperBlurPx &&
  settings.appWallpaperBrightnessPercent === preset.appWallpaperBrightnessPercent &&
  settings.appWallpaperUiOpacityPercent === preset.appWallpaperUiOpacityPercent &&
  settings.appWallpaperVisualProtectionEnabled === preset.appWallpaperVisualProtectionEnabled &&
  settings.appWallpaperUnifiedOpacityEnabled === preset.appWallpaperUnifiedOpacityEnabled;

export const inferAppWallpaperMediaType = (
  filePath: string,
): NonNullable<AppSettings['appWallpaperMediaType']> =>
  /\.(?:mp4|m4v|webm)$/iu.test(filePath.trim()) ? 'video' : 'image';
