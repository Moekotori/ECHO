import i18n from 'i18next'
import * as OpenCC from 'opencc-js'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import zh from '../locales/zh.json'
import ja from '../locales/ja.json'
import { inferUiLocaleFromNavigator, normalizeUiLocale } from '../utils/uiLocale'

const cnToTw = OpenCC.Converter({ from: 'cn', to: 'tw' })

function convertLocaleTree(value) {
  if (typeof value === 'string') return cnToTw(value)
  if (Array.isArray(value)) return value.map(convertLocaleTree)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convertLocaleTree(item)]))
  }
  return value
}

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
    'zh-tw': { translation: convertLocaleTree(zh) },
    ja: { translation: ja }
  },
  lng: initialLng(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n
