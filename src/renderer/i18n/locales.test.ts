import { describe, expect, it } from 'vitest';
import { fallbackTranslations, getLoadedTranslations, loadTranslations } from './locales';

describe('locale loading', () => {
  it('keeps the Simplified Chinese fallback available synchronously', () => {
    expect(fallbackTranslations['app.window.restore']).toBeTruthy();
    expect(getLoadedTranslations('zh-CN')).toBe(fallbackTranslations);
  });

  it('loads non-default dictionaries on demand and caches them', async () => {
    const translations = await loadTranslations('en-US');

    expect(translations['app.window.restore']).toBe('Restore');
    expect(getLoadedTranslations('en-US')).toBe(translations);
    await expect(loadTranslations('en-US')).resolves.toBe(translations);
  });

  it('loads Korean dictionary with first-run description', async () => {
    const translations = await loadTranslations('ko-KR');

    expect(translations['firstRun.language.ko-KR.description']).toContain('한국어');
    expect(getLoadedTranslations('ko-KR')).toBe(translations);
  });
});
