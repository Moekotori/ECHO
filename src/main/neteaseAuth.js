import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const NETEASE_COOKIE_DOMAINS = [
  '.music.163.com',
  'music.163.com',
  '.interface.music.163.com',
  'interface.music.163.com'
]

const NETEASE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function getNcmApi() {
  return require('@neteasecloudmusicapienhanced/api')
}

function getProxyOption() {
  const proxy = process.env.ECHOES_NETEASE_PROXY?.trim()
  return proxy ? { proxy } : {}
}

function uniqueCookiePairs(pairs) {
  const map = new Map()
  for (const [name, value] of pairs) {
    if (!name || !value) continue
    map.set(name, value)
  }
  return Array.from(map.entries())
}

export function parseCookieString(cookie) {
  return uniqueCookiePairs(
    String(cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf('=')
        if (idx <= 0) return ['', '']
        return [part.slice(0, idx).trim(), part.slice(idx + 1).trim()]
      })
  )
}

export function stringifyCookiePairs(pairs) {
  return uniqueCookiePairs(pairs)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

export async function getNeteaseCookieFromSession(electronSession) {
  if (!electronSession?.cookies?.get) return ''
  const pairs = []
  for (const domain of NETEASE_COOKIE_DOMAINS) {
    let cookies = []
    try {
      cookies = await electronSession.cookies.get({ domain })
    } catch {
      cookies = []
    }
    for (const cookie of cookies) {
      pairs.push([cookie?.name, cookie?.value])
    }
  }
  return stringifyCookiePairs(pairs)
}

export function buildNcmRequestOptions(cookie) {
  const opts = { ...getProxyOption() }
  const trimmed = String(cookie || '').trim()
  if (trimmed) opts.cookie = trimmed
  return opts
}

export function buildNeteaseHeaderArgs(cookie) {
  const trimmed = String(cookie || '').trim()
  if (!trimmed) return []
  return [
    '--add-header',
    `Cookie:${trimmed}`,
    '--add-header',
    'Referer:https://music.163.com/',
    '--add-header',
    'Origin:https://music.163.com',
    '--add-header',
    `User-Agent:${NETEASE_UA}`
  ]
}

export async function validateNeteaseCookie(cookie) {
  const trimmed = String(cookie || '').trim()
  const pairs = parseCookieString(trimmed)
  const map = new Map(pairs)
  const hasMusicU = Boolean(map.get('MUSIC_U'))
  const hasMusicA = Boolean(map.get('MUSIC_A'))

  if (!trimmed || (!hasMusicU && !hasMusicA)) {
    return {
      checked: true,
      valid: false,
      signedIn: false,
      cookie: trimmed,
      hasMusicU,
      hasMusicA,
      account: null,
      profile: null,
      isVip: false
    }
  }

  try {
    const ncm = getNcmApi()
    const res = await ncm.login_status({
      timestamp: Date.now(),
      ...buildNcmRequestOptions(trimmed)
    })
    const data = res?.body?.data || res?.body || {}
    const account = data.account || null
    const profile = data.profile || null
    const valid = Boolean(account || profile)
    const vipType = Number(profile?.vipType ?? account?.vipType ?? 0)
    return {
      checked: true,
      valid,
      signedIn: valid,
      cookie: trimmed,
      hasMusicU,
      hasMusicA,
      account,
      profile,
      vipType,
      isVip: vipType > 0
    }
  } catch (error) {
    return {
      checked: false,
      valid: false,
      signedIn: false,
      cookie: trimmed,
      hasMusicU,
      hasMusicA,
      account: null,
      profile: null,
      isVip: false,
      error: error?.body?.msg || error?.body?.message || error?.message || String(error)
    }
  }
}
