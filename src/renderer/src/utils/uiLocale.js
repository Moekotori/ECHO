/** Supported UI locale codes persisted in config */
export const UI_LOCALES = ['en', 'zh', 'zh-tw', 'ja']

export function inferUiLocaleFromNavigator() {
  if (typeof navigator === 'undefined') return 'en'
  const lang = (navigator.language || 'en').toLowerCase()
  if (
    lang === 'zh-tw' ||
    lang === 'zh-hk' ||
    lang === 'zh-mo' ||
    lang === 'zh-hant' ||
    lang.startsWith('zh-hant-')
  ) {
    return 'zh-tw'
  }
  if (lang.startsWith('zh')) return 'zh'
  if (lang.startsWith('ja')) return 'ja'
  return 'en'
}

export function normalizeUiLocale(value) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : value
  if (normalized === 'zh' || normalized === 'zh-tw' || normalized === 'ja' || normalized === 'en') {
    return normalized
  }
  return 'en'
}

export function bcp47ForUiLocale(ui) {
  if (ui === 'zh') return 'zh-CN'
  if (ui === 'zh-tw') return 'zh-TW'
  if (ui === 'ja') return 'ja'
  return 'en'
}
