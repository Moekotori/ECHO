import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Context } from 'react';
import type { PropsWithChildren } from 'react';
import { getAppBridge } from '../utils/echoBridge';
import {
  fallbackTranslations,
  getLoadedTranslations,
  isLocale,
  loadTranslations,
  localeOptions,
} from './locales';
import type { Locale, TranslationDictionary, TranslationKey } from './locales';

const storageKey = 'echo-next.locale';
const fallbackLocale: Locale = 'zh-CN';

type TranslateOptions = Record<string, string | number>;

type I18nContextValue = {
  locale: Locale;
  localeOptions: typeof localeOptions;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, options?: TranslateOptions) => string;
};

declare global {
  interface Window {
    __echoNextI18nContext?: Context<I18nContextValue | null>;
  }
}

const getI18nContext = (): Context<I18nContextValue | null> => {
  if (typeof window === 'undefined') {
    return createContext<I18nContextValue | null>(null);
  }

  window.__echoNextI18nContext ??= createContext<I18nContextValue | null>(null);
  return window.__echoNextI18nContext;
};

const I18nContext = getI18nContext();

const readInitialLocale = (): Locale => {
  if (typeof window === 'undefined') {
    return fallbackLocale;
  }

  const stored = window.localStorage.getItem(storageKey);

  if (isLocale(stored)) {
    return stored;
  }

  const browserLocale = window.navigator.language;

  if (browserLocale.startsWith('zh-TW') || browserLocale.startsWith('zh-HK') || browserLocale.startsWith('zh-MO')) {
    return 'zh-TW';
  }

  if (browserLocale.startsWith('ja')) {
    return 'ja-JP';
  }

  if (browserLocale.startsWith('ko')) {
    return 'ko-KR';
  }

  if (browserLocale.startsWith('en')) {
    return 'en-US';
  }

  return fallbackLocale;
};

const interpolate = (text: string, options?: TranslateOptions): string => {
  if (!options) {
    return text;
  }

  return Object.entries(options).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, String(value)),
    text,
  );
};

export const translateFallback = (key: TranslationKey, options?: TranslateOptions): string => {
  const text = fallbackTranslations[key] ?? key;
  return interpolate(text, options);
};

export const translateCurrentLocale = (key: TranslationKey, options?: TranslateOptions): string => {
  const locale = readInitialLocale();
  const text = getLoadedTranslations(locale)?.[key] ?? fallbackTranslations[key] ?? key;
  return interpolate(text, options);
};

type LocaleState = {
  locale: Locale;
  translations: TranslationDictionary;
};

export const I18nProvider = ({ children }: PropsWithChildren): JSX.Element => {
  const [localeState, setLocaleState] = useState<LocaleState>(() => {
    const locale = readInitialLocale();
    return {
      locale,
      translations: getLoadedTranslations(locale) ?? fallbackTranslations,
    };
  });
  const { locale, translations } = localeState;

  const applyLocale = useCallback((nextLocale: Locale): void => {
    setLocaleState({
      locale: nextLocale,
      translations: getLoadedTranslations(nextLocale) ?? fallbackTranslations,
    });
  }, []);

  useEffect(() => {
    let isCurrent = true;
    void loadTranslations(locale)
      .then((loadedTranslations) => {
        if (!isCurrent) {
          return;
        }
        setLocaleState((current) => current.locale === locale
          ? { locale, translations: loadedTranslations }
          : current);
      })
      .catch(() => undefined);

    return () => {
      isCurrent = false;
    };
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(storageKey, locale);
  }, [locale]);

  useEffect(() => {
    let isMounted = true;
    const appBridge = getAppBridge();

    if (!appBridge) {
      return () => {
        isMounted = false;
      };
    }

    if (typeof appBridge.getSettings !== 'function') {
      return () => {
        isMounted = false;
      };
    }

    void appBridge
      .getSettings()
      .then((settings) => {
        if (!isMounted) {
          return;
        }

        const localLocale = readInitialLocale();
        const shouldMigrateLocalLocale = (settings.appMemoryVersion ?? 0) < 1 && isLocale(localLocale);
        const nextLocale = shouldMigrateLocalLocale ? localLocale : (settings.locale ?? fallbackLocale);

        if (isLocale(nextLocale)) {
          applyLocale(nextLocale);
          window.localStorage.setItem(storageKey, nextLocale);
        }

        if (shouldMigrateLocalLocale) {
          void appBridge.setSettings({ locale: localLocale }).catch(() => undefined);
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [applyLocale]);

  const setLocale = useCallback((nextLocale: Locale): void => {
    applyLocale(nextLocale);
    window.localStorage.setItem(storageKey, nextLocale);
    void getAppBridge()?.setSettings({ locale: nextLocale }).catch(() => undefined);
  }, [applyLocale]);

  const t = useCallback(
    (key: TranslationKey, options?: TranslateOptions): string => {
      const text = translations[key] ?? fallbackTranslations[key] ?? key;
      return interpolate(text, options);
    },
    [translations],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      localeOptions,
      setLocale,
      t,
    }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useOptionalI18n = (): I18nContextValue | null => useContext(I18nContext);

export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider');
  }

  return context;
};
