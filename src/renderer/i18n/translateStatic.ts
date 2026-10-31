import {
  fallbackTranslations,
  getLoadedTranslations,
  isLocale,
  type TranslationKey,
} from './locales';

const storageKey = 'echo-next.locale';

type TranslateOptions = Record<string, string | number>;

const interpolate = (text: string, options?: TranslateOptions): string => {
  if (!options) {
    return text;
  }

  return Object.entries(options).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, String(value)),
    text,
  );
};

const readStoredLocale = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
};

/**
 * Locale-aware translate for non-React / error paths.
 * Avoids importing I18nProvider so bridge utilities cannot form circular deps.
 */
export const translateStatic = (key: TranslationKey, options?: TranslateOptions): string => {
  const stored = readStoredLocale();
  const locale = isLocale(stored) ? stored : 'zh-CN';
  const text = getLoadedTranslations(locale)?.[key] ?? fallbackTranslations[key] ?? key;
  return interpolate(text, options);
};
