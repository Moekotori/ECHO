import { describe, expect, it, vi } from 'vitest';

const nativeThemeMock = { themeSource: 'system' as 'system' | 'light' | 'dark' };

vi.mock('electron', () => ({
  nativeTheme: nativeThemeMock,
}));

describe('nativeThemePreference', () => {
  it('maps app theme modes onto Electron native theme sources', async () => {
    const { resolveNativeThemeSource } = await import('./nativeThemePreference');

    expect(resolveNativeThemeSource('system')).toBe('system');
    expect(resolveNativeThemeSource('dark')).toBe('dark');
    expect(resolveNativeThemeSource('ambient')).toBe('dark');
    expect(resolveNativeThemeSource('light')).toBe('light');
    expect(resolveNativeThemeSource(undefined)).toBe('light');
  });

  it('updates Electron nativeTheme.themeSource', async () => {
    const { syncNativeThemeSource } = await import('./nativeThemePreference');

    expect(syncNativeThemeSource({ appearanceTheme: 'system' })).toBe('system');
    expect(nativeThemeMock.themeSource).toBe('system');

    expect(syncNativeThemeSource({ appearanceTheme: 'ambient' })).toBe('dark');
    expect(nativeThemeMock.themeSource).toBe('dark');
  });
});
