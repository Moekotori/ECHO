// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyThemeMode,
  applyThemeSettings,
  readThemeMode,
  readThemeCustomId,
  readThemeCustomThemes,
  readThemePreset,
  readThemePresetOverrides,
  resolveThemeModeForSchedule,
  updateThemeMode,
  updateThemePreset,
  updateThemePresetOverrides,
  updateThemePreferences,
  watchSystemThemeMode,
} from './themePreferences';

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeMode;
  delete document.documentElement.dataset.themePreset;
  delete document.documentElement.dataset.themeCustom;
  delete document.documentElement.dataset.themeCustomId;
  delete document.documentElement.dataset.themeTransition;
  document.documentElement.removeAttribute('style');
  document.documentElement.style.colorScheme = '';
  vi.restoreAllMocks();
});

describe('theme preferences', () => {
  it('applies and caches explicit theme modes', () => {
    updateThemeMode('dark');

    expect(readThemeMode()).toBe('dark');
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themePreset).toBe('classic');

    updateThemeMode('light');

    expect(readThemeMode()).toBe('light');
    expect(document.documentElement.dataset.themeMode).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themePreset).toBe('classic');
  });

  it('applies and caches independent theme presets', () => {
    updateThemeMode('light');
    updateThemePreset('echoTwilight');

    expect(readThemeMode()).toBe('light');
    expect(readThemePreset()).toBe('echoTwilight');
    expect(document.documentElement.dataset.themeMode).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themePreset).toBe('echoTwilight');

    updateThemePreferences('dark', 'mintCandy');

    expect(readThemeMode()).toBe('dark');
    expect(readThemePreset()).toBe('mintCandy');
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themePreset).toBe('mintCandy');

    updateThemePreset('neonCandy');

    expect(readThemePreset()).toBe('neonCandy');
    expect(document.documentElement.dataset.themePreset).toBe('neonCandy');

    updateThemePreset('amberNoir');

    expect(readThemePreset()).toBe('amberNoir');
    expect(document.documentElement.dataset.themePreset).toBe('amberNoir');

    updateThemePreset('shibuyaNight');

    expect(readThemePreset()).toBe('shibuyaNight');
    expect(document.documentElement.dataset.themePreset).toBe('shibuyaNight');

    updateThemePreset('darkSideMoon');

    expect(readThemePreset()).toBe('darkSideMoon');
    expect(document.documentElement.dataset.themePreset).toBe('darkSideMoon');
  });

  it('applies and caches theme preset overrides', () => {
    updateThemePreferences('light', 'echoTwilight', {
      echoTwilight: {
        light: {
          appBg: '#fff0ee',
          accent: '#df6b5f',
          text: '#352321',
          onAccent: '#ffffff',
          panelOpacityPercent: 84,
        },
      },
    });

    expect(readThemePresetOverrides()).toEqual({
      echoTwilight: {
        light: {
          appBg: '#fff0ee',
          accent: '#df6b5f',
          text: '#352321',
          onAccent: '#ffffff',
          panelOpacityPercent: 84,
        },
      },
    });
    expect(document.documentElement.dataset.themeCustom).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--preset-app-bg')).toBe('#fff0ee');
    expect(document.documentElement.style.getPropertyValue('--theme-accent-solid-bg')).toBe('#df6b5f');

    updateThemePresetOverrides({});
    expect(document.documentElement.dataset.themeCustom).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue('--preset-app-bg')).toBe('');
  });

  it('applies a selected custom theme on top of its base preset with CSS motion variables', () => {
    const customThemes = [
      {
        id: 'theme-safe',
        name: 'Safe Theme',
        basePreset: 'nyanCat' as const,
        light: {
          appBg: '#101820',
          titlebar: '#203040',
          accent: '#ff66aa',
          motionEnabled: false,
          motionSpeedSeconds: 0.35,
          motionIntensityPercent: 42,
        },
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
    ];
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const rafSpy = vi.fn(() => 1);
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: rafSpy,
    });

    updateThemePreferences(
      'light',
      'classic',
      {
        classic: {
          light: {
            appBg: '#ffffff',
            accent: '#111111',
          },
        },
      },
      { customThemeId: 'theme-safe', customThemes },
    );

    expect(readThemeCustomThemes()).toEqual(customThemes);
    expect(readThemeCustomId()).toBe('theme-safe');
    expect(document.documentElement.dataset.themePreset).toBe('nyanCat');
    expect(document.documentElement.dataset.themeCustom).toBe('true');
    expect(document.documentElement.dataset.themeCustomId).toBe('theme-safe');
    expect(document.documentElement.style.getPropertyValue('--preset-app-bg')).toBe('#101820');
    expect(document.documentElement.style.getPropertyValue('--theme-accent-solid-bg')).toBe('#ff66aa');
    expect(document.documentElement.style.getPropertyValue('--theme-motion-enabled')).toBe('0');
    expect(document.documentElement.style.getPropertyValue('--theme-motion-speed')).toBe('0.35s');
    expect(document.documentElement.style.getPropertyValue('--theme-motion-intensity')).toBe('42%');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('uses lightweight CSS theme transitions for interactive changes', () => {
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });

    updateThemePreset('lemonMochi', { animate: true });

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.themeTransition).toBe('true');
    expect(document.documentElement.dataset.themePreset).toBe('lemonMochi');
  });

  it('skips animated transitions when reduced motion is requested', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });

    updateThemeMode('dark', { animate: true });

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.themeTransition).toBeUndefined();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('resolves system theme mode from matchMedia and updates on system changes', () => {
    let matches = false;
    const changeListeners: Array<() => void> = [];
    const mediaQuery = {
      get matches() {
        return matches;
      },
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn((_event: 'change', listener: () => void) => {
        changeListeners.push(listener);
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => mediaQuery),
    });

    updateThemeMode('system');
    expect(document.documentElement.dataset.themeMode).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');

    const stopWatching = watchSystemThemeMode(() => 'system');
    matches = true;
    expect(changeListeners).toHaveLength(1);
    changeListeners[0]();

    expect(document.documentElement.dataset.themeMode).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');

    stopWatching();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('resolves scheduled dark mode across midnight without rewriting the saved mode', () => {
    const settings = {
      appearanceTheme: 'system' as const,
      appearanceThemeScheduleEnabled: true,
      appearanceThemeScheduleDarkAt: '20:00',
      appearanceThemeScheduleLightAt: '07:00',
      appearanceThemePreset: 'classic' as const,
    };

    expect(resolveThemeModeForSchedule(settings, new Date('2026-05-29T21:15:00'))).toBe('dark');
    expect(resolveThemeModeForSchedule(settings, new Date('2026-05-29T06:59:00'))).toBe('dark');
    expect(resolveThemeModeForSchedule(settings, new Date('2026-05-29T07:00:00'))).toBe('light');
    expect(resolveThemeModeForSchedule(settings, new Date('2026-05-29T14:00:00'))).toBe('light');

    const current = new Date();
    const currentMinute = current.getHours() * 60 + current.getMinutes();
    const nextMinute = (currentMinute + 1) % (24 * 60);
    const formatMinute = (minute: number): string =>
      `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;

    updateThemeMode('system');
    applyThemeSettings({
      ...settings,
      appearanceThemeScheduleDarkAt: formatMinute(currentMinute),
      appearanceThemeScheduleLightAt: formatMinute(nextMinute),
    }, { animate: true });

    expect(readThemeMode()).toBe('system');
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to light for invalid theme values', () => {
    applyThemeMode('sepia' as never);

    expect(document.documentElement.dataset.themeMode).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themePreset).toBe('classic');
  });

  it('falls back to classic for invalid theme presets', () => {
    updateThemePreset('neon' as never);

    expect(readThemePreset()).toBe('classic');
    expect(document.documentElement.dataset.themePreset).toBe('classic');
  });
});
