import crypto from 'node:crypto'
import axios from 'axios'

const LASTFM_BASE_URL = 'https://ws.audioscrobbler.com/2.0/'
const MSG_MISSING_CREDENTIALS = '\u8bf7\u8f93\u5165\u7528\u6237\u540d\u548c\u5bc6\u7801'
const MSG_LOGIN_FAILED = '\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7528\u6237\u540d\u548c\u5bc6\u7801'
const MSG_LOGIN_TIMEOUT = '\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5'
const MSG_NETWORK_FAILED = '\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u8fde\u63a5'
const MSG_INVALID_API_KEY = 'Last.fm API Key \u65e0\u6548\uff0c\u8bf7\u68c0\u67e5\u5e94\u7528\u914d\u7f6e'

export class LastFmClient {
  constructor() {
    this.apiKey = 'c9badea6f4f4d280800653b9458d3dbd'
    this.apiSecret = '0f6494a849ea09829817963350eab8e7'
    this.sessionKey = null
    this.username = null
  }

  _sign(params) {
    const base = Object.keys(params)
      .filter((key) => key !== 'format' && params[key] != null && params[key] !== '')
      .sort((a, b) => a.localeCompare(b))
      .map((key) => `${key}${params[key]}`)
      .join('')
    return crypto.createHash('md5').update(`${base}${this.apiSecret}`, 'utf8').digest('hex')
  }

  async _post(params) {
    const body = new URLSearchParams({ ...params, format: 'json' })
    const response = await axios.post(LASTFM_BASE_URL, body.toString(), {
      timeout: 8000,
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
    return response?.data || {}
  }

  async authenticate(username, password) {
    try {
      const normalizedUsername = String(username || '').trim()
      const normalizedPassword = String(password || '')
      if (!normalizedUsername || !normalizedPassword) {
        return { ok: false, error: MSG_MISSING_CREDENTIALS }
      }

      const params = {
        method: 'auth.getMobileSession',
        username: normalizedUsername,
        password: normalizedPassword,
        api_key: this.apiKey
      }
      const data = await this._post({
        ...params,
        api_sig: this._sign(params)
      })

      if (data?.session?.key) {
        this.sessionKey = data.session.key
        this.username = data.session.name || normalizedUsername
        return {
          ok: true,
          username: this.username,
          sessionKey: this.sessionKey
        }
      }

      if (data?.error === 10 || String(data?.message || '').includes('Invalid API key')) {
        return { ok: false, error: MSG_INVALID_API_KEY }
      }
      return { ok: false, error: data?.message || MSG_LOGIN_FAILED }
    } catch (error) {
      const timeoutMessage = error?.code === 'ECONNABORTED' ? MSG_LOGIN_TIMEOUT : ''
      return {
        ok: false,
        error: timeoutMessage || error?.response?.data?.message || MSG_NETWORK_FAILED
      }
    }
  }

  async nowPlaying(artist, track, album, durationSec) {
    if (!this.sessionKey) return { ok: false, skipped: true }
    try {
      const params = {
        method: 'track.updateNowPlaying',
        artist: String(artist || '').trim(),
        track: String(track || '').trim(),
        api_key: this.apiKey,
        sk: this.sessionKey
      }
      if (album) params.album = String(album).trim()
      if (Number(durationSec) > 0) params.duration = String(Math.round(Number(durationSec)))
      if (!params.artist || !params.track) return { ok: false, skipped: true }
      await this._post({
        ...params,
        api_sig: this._sign(params)
      })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  async scrobble(artist, track, album, startedAt, durationSec) {
    if (!this.sessionKey) return { ok: false, skipped: true }
    try {
      const timestampSec = Math.max(1, Math.floor(Number(startedAt || Date.now()) / 1000))
      const params = {
        method: 'track.scrobble',
        artist: String(artist || '').trim(),
        track: String(track || '').trim(),
        timestamp: String(timestampSec),
        api_key: this.apiKey,
        sk: this.sessionKey
      }
      if (album) params.album = String(album).trim()
      if (Number(durationSec) > 0) params.duration = String(Math.round(Number(durationSec)))
      if (!params.artist || !params.track) return { ok: false, skipped: true }
      await this._post({
        ...params,
        api_sig: this._sign(params)
      })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  setSession(sessionKey, username) {
    this.sessionKey = sessionKey || null
    this.username = username || null
  }

  clearSession() {
    this.sessionKey = null
    this.username = null
  }
}

export const lastFmClient = new LastFmClient()
