import { nativeTheme } from 'electron';
import type { AppThemeMode } from '../../shared/types/appSettings';

type NativeThemeSource = 'system' | 'light' | 'dark';

export const resolveNativeThemeSource = (theme: AppThemeMode | null | undefined): NativeThemeSource => {
  if (theme === 'system') {
    return 'system';
  }

  if (theme === 'dark' || theme === 'ambient') {
    return 'dark';
  }

  return 'light';
};

export const syncNativeThemeSource = (settings: { appearanceTheme?: AppThemeMode | null }): NativeThemeSource => {
  const themeSource = resolveNativeThemeSource(settings.appearanceTheme);
  nativeTheme.themeSource = themeSource;
  return themeSource;
};
