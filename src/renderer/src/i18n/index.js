import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import zh from '../locales/zh.json'
import ja from '../locales/ja.json'
import { inferUiLocaleFromNavigator, normalizeUiLocale } from '../utils/uiLocale'

function initialLng() {
  try {
    const raw = localStorage.getItem('nc_config')
    if (raw) {
      const p = JSON.parse(raw)
      if (p && typeof p.uiLocale === 'string') {
        return normalizeUiLocale(p.uiLocale)
      }
    }
  } catch (_) {}
  return inferUiLocaleFromNavigator()
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    ja: { translation: ja }
  },
  lng: initialLng(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n
