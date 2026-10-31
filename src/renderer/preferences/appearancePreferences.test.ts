// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyAppearancePreferences,
  defaultAppearancePreferences,
  registerAppearanceFontFile,
  serializeAppearanceFontList,
} from './appearancePreferences';

afterEach(() => {
  document.documentElement.removeAttribute('style');
  vi.unstubAllGlobals();
});

describe('imported appearance fonts', () => {
  it('isolates a lyrics font from an identically named UI font', async () => {
    const addedFaces: Array<{ family: string }> = [];
    const MockFontFace = class {
      constructor(public family: string) {}
      async load() { return this; }
    };
    vi.stubGlobal('FontFace', MockFontFace);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: (face: { family: string }) => addedFaces.push(face), delete: () => true },
    });

    expect(await registerAppearanceFontFile('lyrics', {
      path: 'lyrics.ttf',
      family: 'Outfit',
      dataUrl: 'data:font/ttf;base64,AA==',
    })).toBe('Outfit');
    expect(addedFaces[0].family).toBe('ECHO Imported Font lyrics');
    expect(serializeAppearanceFontList('lyrics', 'Outfit', 'lyrics.ttf'))
      .toBe('"ECHO Imported Font lyrics", "Outfit"');

    applyAppearancePreferences(defaultAppearancePreferences);
    expect(document.documentElement.style.getPropertyValue('--echo-font-family'))
      .not.toContain('ECHO Imported Font lyrics');
  });

  it('uses each imported font only in its selected UI slot', () => {
    applyAppearancePreferences({ ...defaultAppearancePreferences, mainFontFilePath: 'main.ttf' });
    const fontStack = document.documentElement.style.getPropertyValue('--echo-font-family');
    expect(fontStack).toContain('"ECHO Imported Font main", "Outfit"');
    expect(fontStack).not.toContain('ECHO Imported Font lyrics');
    expect(serializeAppearanceFontList('lyrics', 'Outfit', null)).toBe('"Outfit"');
  });
});
