import axios from 'axios'
import { parseCookieString, stringifyCookiePairs } from './neteaseAuth.js'

const QQ_MUSIC_COOKIE_DOMAINS = ['.qq.com', 'qq.com', '.y.qq.com', 'y.qq.com']

export const QQ_MUSIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export function getQqMusicCookiePairs(cookie) {
  return parseCookieString(cookie)
}

export function getQqMusicUin(cookie) {
  const map = new Map(getQqMusicCookiePairs(cookie))
  const raw =
    map.get('uin') ||
    map.get('qqmusic_uin') ||
    map.get('p_uin') ||
    map.get('wxuin') ||
    map.get('openid') ||
    ''
  const digits = String(raw).replace(/\D/g, '')
  return digits || '0'
}

export async function getQqMusicCookieFromSession(electronSession) {
  if (!electronSession?.cookies?.get) return ''
  const pairs = []
  for (const domain of QQ_MUSIC_COOKIE_DOMAINS) {
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

export function buildQqMusicHeaders(cookie = '') {
  const headers = {
    Referer: 'https://y.qq.com/',
    Origin: 'https://y.qq.com',
    'User-Agent': QQ_MUSIC_UA
  }
  const trimmed = String(cookie || '').trim()
  if (trimmed) headers.Cookie = trimmed
  return headers
}

export function buildQqMusicDownloadHeaders(cookie = '') {
  const headers = {
    Referer: 'https://y.qq.com/',
    'User-Agent': QQ_MUSIC_UA
  }
  const trimmed = String(cookie || '').trim()
  if (trimmed) headers.Cookie = trimmed
  return headers
}

export async function validateQqMusicCookie(cookie) {
  const trimmed = String(cookie || '').trim()
  const pairs = getQqMusicCookiePairs(trimmed)
  const map = new Map(pairs)
  const uin = getQqMusicUin(trimmed)
  const hasStrongToken = Boolean(map.get('qm_keyst') || map.get('qqmusic_key'))
  const hasWeakToken = Boolean(map.get('p_skey') || map.get('skey'))
  const hasLoginToken = hasStrongToken || hasWeakToken

  if (!trimmed || !hasLoginToken) {
    return {
      checked: true,
      valid: false,
      signedIn: false,
      cookie: trimmed,
      uin,
      profile: null,
      isVip: false
    }
  }

  if (hasStrongToken) {
    return {
      checked: true,
      valid: true,
      signedIn: true,
      cookie: trimmed,
      uin,
      profile: null,
      isVip: false,
      tokenOnly: true
    }
  }

  try {
    const res = await axios.get('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg', {
      params: {
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        uin
      },
      headers: buildQqMusicHeaders(trimmed),
      timeout: 10000
    })
    const data = res?.data || {}
    const profile = data?.data || data?.creator || null
    const valid = data?.code === 0 || Boolean(profile)
    return {
      checked: true,
      valid,
      signedIn: valid,
      cookie: trimmed,
      uin,
      profile,
      isVip: false
    }
  } catch (error) {
    return {
      checked: false,
      valid: hasLoginToken,
      signedIn: hasLoginToken,
      cookie: trimmed,
      uin,
      profile: null,
      isVip: false,
      error: error?.response?.data?.message || error?.message || String(error)
    }
  }
}
