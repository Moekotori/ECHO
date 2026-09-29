// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranslationKey } from '../../../i18n/locales';
import { defaultAppearancePreferences } from '../../../preferences/appearancePreferences';
import { ThemeModeSettings } from './ThemeModeSettings';
import { TypographySettings } from './TypographySettings';

const translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
): string => {
  if (!options) {
    return key;
  }
  return `${key}:${JSON.stringify(options)}`;
};

describe('extracted appearance settings panels', () => {
  afterEach(cleanup);

  it('keeps theme mode and schedule actions connected to the page handlers', () => {
    const onModeChange = vi.fn();
    const onScheduleChange = vi.fn();

    render(
      <ThemeModeSettings
        currentMode="light"
        darkAt="19:00"
        getSubsection={() => ({ title: 'Theme' })}
        highlighted={false}
        lightAt="07:00"
        onModeChange={onModeChange}
        onScheduleChange={onScheduleChange}
        scheduleEnabled={false}
        scheduleStatus="Disabled"
        t={translate}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'settings.appearance.theme.dark' }),
    );
    expect(onModeChange).toHaveBeenCalledWith('dark');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.appearance.themeSchedule.toggleAria',
      }),
    );
    expect(onScheduleChange).toHaveBeenCalledWith({
      appearanceThemeScheduleEnabled: true,
    });
  });

  it('keeps typography, font picker, and album shape actions connected', () => {
    const onChange = vi.fn();
    const onFontPickerOpen = vi.fn();

    render(
      <TypographySettings
        highlightedAlbumCoverShape={false}
        onChange={onChange}
        onFontPickerOpen={onFontPickerOpen}
        onOpenChange={vi.fn()}
        onReset={vi.fn()}
        open
        preferences={defaultAppearancePreferences}
        t={translate}
      />,
    );

    fireEvent.click(
      screen.getByText(defaultAppearancePreferences.mainFontFamily).closest('button')!,
    );
    expect(onFontPickerOpen).toHaveBeenCalledWith('main');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.appearance.albumCoverShape.square',
      }),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...defaultAppearancePreferences,
      albumCoverShape: 'square',
    });
  });
});
