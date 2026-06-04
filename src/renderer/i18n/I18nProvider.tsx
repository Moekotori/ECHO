import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Context } from 'react';
import type { PropsWithChildren } from 'react';
import { getAppBridge } from '../utils/echoBridge';
import { isLocale, localeOptions, translations } from './locales';
import type { Locale, TranslationKey } from './locales';

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
  const text = translations[fallbackLocale][key] ?? key;
  return interpolate(text, options);
};

export const translateCurrentLocale = (key: TranslationKey, options?: TranslateOptions): string => {
  const locale = readInitialLocale();
  const text = translations[locale][key] ?? translations[fallbackLocale][key] ?? key;
  return interpolate(text, options);
};

export const I18nProvider = ({ children }: PropsWithChildren): JSX.Element => {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

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
          setLocaleState(nextLocale);
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
  }, []);

  const setLocale = useCallback((nextLocale: Locale): void => {
    setLocaleState(nextLocale);
    window.localStorage.setItem(storageKey, nextLocale);
    void getAppBridge()?.setSettings({ locale: nextLocale }).catch(() => undefined);
  }, []);

  const t = useCallback(
    (key: TranslationKey, options?: TranslateOptions): string => {
      const text = translations[locale][key] ?? translations[fallbackLocale][key] ?? key;
      return interpolate(text, options);
    },
    [locale],
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
