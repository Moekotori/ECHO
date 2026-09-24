
import type { Locale, TranslationDictionary } from './locales';
import { enUS } from './locales/enUS';
import { jaJP } from './locales/jaJP';
import { koKR } from './locales/koKR';
import { zhCN } from './locales/zhCN';
import { zhTW } from './locales/zhTW';

export { isLocale, localeOptions } from './locales';

export const translations: Record<Locale, TranslationDictionary> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'en-US': enUS,
  'ko-KR': koKR,
};
