import os from 'os'
import http from 'http'
import { createHash } from 'crypto'
import { createRequire } from 'module'
import { PassThrough } from 'stream'
import { logLine } from '../utils/logLine.js'

const require = createRequire(import.meta.url)
const AIRPLAY_SAMPLE_RATE = 44100
const AIRPLAY_CHANNELS = 2
const VIRTUAL_INTERFACE_RE = /(vmware|virtual|veth|vethernet|loopback|tap|tun|wintun|mihomo|clash|cfw|tailscale|zerotier|docker|hyper-v)/i

function isPrivateIPv4(address) {
  const parts = String(address || '')
    .split('.')
    .map((x) => Number.parseInt(x, 10))
  if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) return false
  if (parts[0] === 10) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  return parts[0] === 192 && parts[1] === 168
}

function chooseAirplayHostIPv4() {
  const candidates = []
  const nets = os.networkInterfaces()
  for (const [name, list] of Object.entries(nets)) {
    for (const net of list || []) {
      if (!net || net.family !== 'IPv4' || net.internal) continue
      const address = String(net.address || '').trim()
      if (!address || address === '0.0.0.0' || address.startsWith('127.')) continue
      if (!isPrivateIPv4(address)) continue
      const virtual = VIRTUAL_INTERFACE_RE.test(name) || VIRTUAL_INTERFACE_RE.test(net.description || '')
      let score = virtual ? 10 : 100
      if (/wi-?fi|wlan|wireless|无线/i.test(name)) score += 30
      if (/ethernet|以太网|lan/i.test(name)) score += 20
      if (address.startsWith('192.168.')) score += 10
      candidates.push({ name, address, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0] || null
}

function getStableMacLikeId() {
  const nets = os.networkInterfaces()
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      const mac = String(net.mac || '').trim()
      if (!net.internal && mac && mac !== '00:00:00:00:00:00') return mac
    }
  }
  const h = createHash('sha1').update(os.hostname() || 'echo').digest()
  return Array.from(h.subarray(0, 6))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(':')
}

function normalizeMeta(meta = {}) {
  return {
    title: String(meta.title || '').trim(),
    artist: String(meta.artist || '').trim(),
    album: String(meta.album || '').trim(),
    cover: String(meta.cover || meta.albumArtUrl || '').trim(),
    albumArtUrl: String(meta.albumArtUrl || meta.cover || '').trim(),
    durationMs: Number.isFinite(meta.durationMs) ? meta.durationMs : 0,
    elapsedMs: Number.isFinite(meta.elapsedMs) ? meta.elapsedMs : 0
  }
}

function artworkEventToDataUrl(event = {}) {
  if (!event.data) return ''
  const bytes = Buffer.from(event.data)
  if (!bytes.length) return ''
  return `data:image/jpeg;base64,${bytes.toString('base64')}`
}

function normalizeMetadataText(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
}

function isLikelyLyricLine(value) {
  const text = normalizeMetadataText(value)
  if (!text) return false
  if (
    /^(纯音乐|純音樂|instrumental)[，,、\s]*(请欣赏|請欣賞|欣赏|欣賞|enjoy)?$/i.test(text) ||
    /^(music|audio|now playing)$/i.test(text)
  ) {
    return true
  }
  if (text.length > 48) return true

  const words = text.split(/\s+/).filter(Boolean)
  if (words.length >= 6 && !/[()[\]【】「」『』\-–—:：/]/.test(text)) return true

  const compact = text.replace(/\s+/g, '')
  if (compact.length >= 4) {
    for (let size = 1; size <= Math.floor(compact.length / 2); size += 1) {
      const unit = compact.slice(0, size)
      if (unit.repeat(Math.floor(compact.length / size)) === compact) return true
      if (compact.startsWith(unit.repeat(3))) return true
    }
  }

  const repeatedWord = text.match(/^(.{1,8})(?:\s*\1){2,}$/u)
  return !!repeatedWord
}

function loadRaopBackend() {
  try {
    return require('@lox-audioserver/node-libraop')
  } catch (e) {
    const msg = e?.message || String(e)
    const hint =
      process.platform === 'win32'
        ? 'AirPlay RAOP backend is installed as an optional native module, but it is not built for this Windows runtime. Run npm run build:airplay-raop to build the Windows RAOP backend.'
        : 'AirPlay RAOP backend is not available.'
    const err = new Error(`${hint} (${msg})`)
    err.cause = e
    throw err
  }
}

export class AirplayRaopReceiver {
  constructor({ audioEngine, getMainWindow, beforePlayHook, onCastActivity }) {
    this.audioEngine = audioEngine
    this.getMainWindow = getMainWindow
    this.beforePlayHook = beforePlayHook
    this.onCastActivity = onCastActivity
    this.name = 'ECHO AirPlay'
    this.handle = 0
    this.running = false
    this.backend = null
    this.lastError = null
    this.client = ''
    this.state = 'STOPPED'
    this.port = 0
    this.host = ''
    this.meta = normalizeMeta()
    this._pcmStream = null
    this._pcmBytes = 0
    this._pcmPumpReq = null
    this._playbackStartPromise = null
    this._acceptTitleUpdates = true
    this._titleTrusted = false
    this._localPaused = false
    this._localTakeover = false
  }

  _broadcastStatus() {
    if (this.onCastActivity) {
      this.onCastActivity()
      return
    }
    const win = this.getMainWindow?.()
    if (!win || win.isDestroyed()) return
    win.webContents.send('cast:status', this.getStatus())
  }

  async start({ friendlyName } = {}) {
    if (this.running) await this.stop()
    this.name = String(friendlyName || this.name || 'ECHO AirPlay').trim() || 'ECHO AirPlay'
    this.lastError = null
    this.client = ''
    this.state = 'STARTING'
    this.port = 0
    this.host = ''
    this.meta = normalizeMeta()
    this._acceptTitleUpdates = true
    this._titleTrusted = false
    this._localPaused = false
    this._localTakeover = false

    try {
      this.backend = loadRaopBackend()
      const hostCandidate = chooseAirplayHostIPv4()
      if (hostCandidate?.address) {
        this.host = hostCandidate.address
        logLine(`[AirPlay] using host ${hostCandidate.address} (${hostCandidate.name})`)
      } else {
        logLine('[AirPlay] no LAN IPv4 detected; falling back to 0.0.0.0')
      }
      if (typeof this.backend.setLogHandler === 'function') {
        this.backend.setLogHandler((entry) => {
          if (!entry?.line) return
          logLine(`[AirPlay] ${entry.level || 'log'} ${entry.line}`)
        }, 'info')
      }

      this.handle = this.backend.startReceiver(
        {
          name: this.name,
          model: 'ECHO-AirPlay',
          mac: getStableMacLikeId(),
          metadata: true,
          host: this.host || undefined,
          portBase: 6000,
          portRange: 100,
          latencies: '1000:0'
        },
        (event) => this._handleEvent(event)
      )
      this.running = true
      this.state = 'READY'
      logLine(`[AirPlay] receiver started: ${this.name}${this.host ? ` @ ${this.host}` : ''}`)
      this._broadcastStatus()
      return { ok: true, name: this.name, host: this.host }
    } catch (e) {
      this.running = false
      this.handle = 0
      this.backend = null
      this.state = 'ERROR'
      this.lastError = e?.message || String(e)
      logLine(`[AirPlay] start failed: ${this.lastError}`)
      this._broadcastStatus()
      return { ok: false, error: this.lastError }
    }
  }

  async stop() {
    const wasPlaying = !!this._pcmStream || this.state === 'PLAYING' || this.state === 'PAUSED_PLAYBACK'
    const handle = this.handle
    this.handle = 0
    this.running = false
    this.port = 0
    this.host = ''
    this.client = ''
    this.state = 'STOPPED'
    this.meta = normalizeMeta()
    this._acceptTitleUpdates = true
    this._titleTrusted = false
    this._localPaused = false
    this._localTakeover = false
    this._endPcmStream()
    try {
      if (handle && this.backend?.stopReceiver) this.backend.stopReceiver(handle)
    } catch (e) {
      this.lastError = e?.message || String(e)
    }
    this.backend = null
    if (wasPlaying) await this.audioEngine.stop().catch(() => {})
    this._broadcastStatus()
    return { ok: true }
  }

  async stopPlaybackOnly(options = {}) {
    const localTakeover = options?.localTakeover === true
    this._localPaused = localTakeover
    this._localTakeover = localTakeover
    this._endPcmStream()
    if (this.state === 'PLAYING' || this.state === 'PAUSED_PLAYBACK') this.state = 'STOPPED'
    await this.audioEngine.stop().catch(() => {})
    this._broadcastStatus()
  }

  sendRemoteCommand(command) {
    const normalized = String(command || '').trim().toLowerCase()
    if (normalized === 'pause') {
      this._localPaused = true
      this.state = 'PAUSED_PLAYBACK'
      this._broadcastStatus()
      return { ok: true, local: true }
    }
    if (normalized === 'play') {
      if (this._localTakeover) {
        this._broadcastStatus()
        return { ok: false, local: true, blocked: 'local_playback_active' }
      }
      this._localPaused = false
      if (this._pcmStream && !this._pcmStream.destroyed) this.state = 'PLAYING'
      this._broadcastStatus()
      return { ok: true, local: true }
    }
    if (normalized === 'stop') {
      this.stopPlaybackOnly({ localTakeover: true }).catch(() => {})
      return { ok: true, local: true }
    }
    return { ok: false, error: 'airplay_remote_unavailable' }
  }

  getStatus() {
    const st = this.audioEngine.getStatus()
    const active = this.running && (this.state === 'PLAYING' || this.state === 'PAUSED_PLAYBACK')
    return {
      airplayEnabled: this.running,
      airplayName: this.name,
      airplayState: this.state,
      airplayClient: this.client,
      airplayPort: this.port,
      airplayHost: this.host,
      airplayActive: active,
      airplayMeta: { ...this.meta },
      airplayMetadataTrusted: this._titleTrusted,
      airplayPositionSec: st.currentTime || 0,
      airplayDurationSec: this.meta.durationMs > 0 ? this.meta.durationMs / 1000 : 0,
      lastError: this.lastError
    }
  }

  _handleEvent(event = {}) {
    try {
      switch (event.type) {
        case 'stream':
          this.port = event.port || 0
          this.client = event.remote || event.client || ''
          this._localTakeover = false
          this._localPaused = false
          this.state = 'BUFFERING'
          this._ensurePcmPlayback()
          this._openNativePcmPump()
          break
        case 'play':
          if (this._localTakeover) {
            this.state = 'STOPPED'
            break
          }
          this._localPaused = false
          this.state = 'PLAYING'
          this._ensurePcmPlayback()
          this._openNativePcmPump()
          break
        case 'pause':
          this._localPaused = true
          this.state = 'PAUSED_PLAYBACK'
          break
        case 'flush':
          this._endPcmStream()
          if (this._localTakeover) {
            this.state = 'STOPPED'
            break
          }
          this.meta = normalizeMeta()
          this._acceptTitleUpdates = true
          this._titleTrusted = false
          this._localPaused = false
          this.state = 'BUFFERING'
          break
        case 'stop':
          this._endPcmStream()
          this.meta = normalizeMeta()
          this._acceptTitleUpdates = true
          this._titleTrusted = false
          this._localPaused = false
          this._localTakeover = false
          this.state = 'STOPPED'
          break
        case 'metadata':
          this._mergeMetadata(event)
          break
        case 'artwork':
          this._mergeMetadata({ ...event, cover: artworkEventToDataUrl(event) })
          break
        case 'volume':
          if (typeof event.value === 'number' && Number.isFinite(event.value)) {
            const vol = event.value > 1 ? event.value / 100 : event.value
            this.audioEngine.setVolume(Math.max(0, Math.min(1, vol)))
          }
          break
        case 'pcm':
          if (this._localTakeover || this._localPaused) break
          this._ensurePcmPlayback()
          if (event.data && this._pcmStream && !this._pcmStream.destroyed) {
            const chunk = Buffer.from(event.data)
            if (!this._pcmBytes) logLine(`[AirPlay] first PCM chunk: ${chunk.length} bytes`)
            this._pcmBytes += chunk.length
            this._pcmStream.write(chunk)
            this.state = 'PLAYING'
          }
          break
      }
    } catch (e) {
      this.lastError = e?.message || String(e)
      logLine(`[AirPlay] event error: ${this.lastError}`)
    }
    this._broadcastStatus()
  }

  _ensurePcmPlayback() {
    if (this._pcmStream && !this._pcmStream.destroyed) return
    const stream = new PassThrough({ highWaterMark: 1024 * 1024 })
    this._pcmStream = stream
    this._playbackStartPromise = Promise.resolve()
      .then(() => this.beforePlayHook?.())
      .then(() =>
        this.audioEngine.playPcmStream({
          stream,
          sampleRate: AIRPLAY_SAMPLE_RATE,
          channels: AIRPLAY_CHANNELS,
          sampleFormat: 's16le',
          label: 'AirPlay',
          metadata: this.meta
        })
      )
      .then((result) => {
        if (!result?.success) {
          this.lastError = result?.error || 'airplay_playback_failed'
          this.state = 'ERROR'
          this._endPcmStream()
          this._broadcastStatus()
        }
      })
      .catch((e) => {
        this.lastError = e?.message || String(e)
        this.state = 'ERROR'
        this._endPcmStream()
        this._broadcastStatus()
      })
  }

  _mergeMetadata(event = {}) {
    const current = this.meta || normalizeMeta()
    const incomingTitle = normalizeMetadataText(event.title)
    const incomingArtist = normalizeMetadataText(event.artist)
    const incomingAlbum = normalizeMetadataText(event.album)
    const incomingCover = normalizeMetadataText(event.cover || event.albumArtUrl)
    const trackIdentityChanged =
      (!!incomingArtist && !!current.artist && incomingArtist !== current.artist) ||
      (!!incomingAlbum && !!current.album && incomingAlbum !== current.album)
    const next = { ...current, ...event }

    if (trackIdentityChanged) {
      next.title = ''
      this._acceptTitleUpdates = true
      this._titleTrusted = false
    }

    if (incomingTitle) {
      if (isLikelyLyricLine(incomingTitle)) {
        next.title = trackIdentityChanged ? '' : current.title
        if (!next.title) this._titleTrusted = false
        logLine(`[AirPlay] ignored lyric-like title metadata: ${incomingTitle}`)
      } else if (!next.title || this._acceptTitleUpdates) {
        next.title = incomingTitle
        this._acceptTitleUpdates = false
        this._titleTrusted = true
      } else if (incomingTitle !== next.title) {
        logLine(`[AirPlay] ignored transient title metadata: ${incomingTitle}`)
      }
    }

    if (event.cover) {
      next.cover = event.cover
      next.albumArtUrl = event.cover
    }

    this.meta = normalizeMeta(next)
  }

  _endPcmStream() {
    const stream = this._pcmStream
    this._pcmStream = null
    this._pcmBytes = 0
    this._playbackStartPromise = null
    this._closeNativePcmPump()
    if (!stream) return
    try {
      stream.end()
    } catch {
      try {
        stream.destroy()
      } catch {
        /* ignore */
      }
    }
  }

  _openNativePcmPump() {
    if (!this.port || this._pcmPumpReq) return
    const req = http.get(
      {
        host: this.host || '127.0.0.1',
        port: this.port,
        path: '/',
        timeout: 5000
      },
      (res) => {
        res.on('data', () => {})
        res.on('error', () => {})
        res.on('end', () => {
          if (this._pcmPumpReq === req) this._pcmPumpReq = null
        })
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', (e) => {
      if (this._pcmPumpReq === req) this._pcmPumpReq = null
      const msg = e?.message || String(e)
      logLine(`[AirPlay] PCM pump error: ${msg}`)
    })
    this._pcmPumpReq = req
  }

  _closeNativePcmPump() {
    const req = this._pcmPumpReq
    this._pcmPumpReq = null
    if (!req) return
    try {
      req.destroy()
    } catch {
      /* ignore */
    }
  }
}

export default AirplayRaopReceiver
