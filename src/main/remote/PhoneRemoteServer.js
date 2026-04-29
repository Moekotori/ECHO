import http from 'http'
import os from 'os'
import crypto from 'crypto'
import { WebSocketServer } from 'ws'
import { MOBILE_REMOTE_HTML_V2 } from './PhoneRemotePage.js'

const DEFAULT_PORT = 18888
const MAX_CLIENTS = 8
const HEARTBEAT_INTERVAL_MS = 15000
const CLIENT_TIMEOUT_MS = 60000

const MOBILE_REMOTE_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#f7f3f7" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="ECHO Remote" />
  <title>ECHO Remote</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f3f7;
      --panel: rgba(255, 255, 255, 0.78);
      --panel-strong: rgba(255, 255, 255, 0.94);
      --text: #27232d;
      --soft: #777184;
      --muted: #aaa3b3;
      --line: rgba(49, 38, 57, 0.1);
      --accent: #d96e9a;
      --accent-2: #9b8bff;
      --shadow: 0 18px 50px rgba(53, 43, 61, 0.14);
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body {
      min-height: 100dvh;
      background:
        radial-gradient(circle at 14% 7%, rgba(255, 212, 232, 0.9), transparent 34%),
        radial-gradient(circle at 86% 0%, rgba(204, 223, 255, 0.75), transparent 30%),
        linear-gradient(180deg, #fff8fb 0%, #f4f1f8 100%);
      overflow: hidden;
    }
    button, input, select { font: inherit; }
    .app { min-height: 100dvh; display: grid; grid-template-rows: auto 1fr auto; padding: max(16px, env(safe-area-inset-top)) 16px max(14px, env(safe-area-inset-bottom)); gap: 14px; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .brand { display: grid; gap: 2px; }
    .brand strong { font-size: 22px; letter-spacing: 0; }
    .status { font-size: 12px; color: var(--soft); display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 99px; background: #f59e0b; box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.14); }
    .dot.ok { background: #22c55e; box-shadow-color: rgba(34, 197, 94, 0.16); }
    .dot.bad { background: #ef4444; box-shadow-color: rgba(239, 68, 68, 0.14); }
    .pill { border: 1px solid var(--line); border-radius: 999px; padding: 8px 11px; background: rgba(255, 255, 255, 0.62); color: var(--soft); font-size: 12px; }
    .card { background: var(--panel); border: 1px solid rgba(255,255,255,0.72); border-radius: 24px; box-shadow: var(--shadow); backdrop-filter: blur(20px); }
    .content { overflow: hidden; min-height: 0; }
    .tab { height: 100%; display: none; overflow: auto; padding: 18px; }
    .tab.active { display: block; }
    .now { display: grid; gap: 18px; align-content: start; }
    .cover { width: min(68vw, 310px); aspect-ratio: 1; border-radius: 28px; margin: 6px auto 0; background: linear-gradient(145deg, #f3e8ff, #dbeafe); overflow: hidden; display: grid; place-items: center; color: rgba(39,35,45,0.38); font-size: 72px; box-shadow: 0 20px 60px rgba(90, 76, 99, 0.18); }
    .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .meta { text-align: center; display: grid; gap: 7px; }
    .title { margin: 0; font-size: clamp(23px, 7vw, 34px); line-height: 1.08; }
    .artist { margin: 0; color: var(--soft); font-size: 16px; line-height: 1.35; }
    .seek { display: grid; gap: 8px; }
    .time { display: flex; justify-content: space-between; color: var(--soft); font-size: 12px; }
    input[type="range"] { width: 100%; accent-color: var(--accent); }
    .controls { display: grid; grid-template-columns: 54px 72px 54px; justify-content: center; align-items: center; gap: 18px; }
    .round { border: 0; border-radius: 999px; height: 54px; background: var(--panel-strong); color: var(--text); box-shadow: 0 12px 28px rgba(50, 43, 60, 0.12); display: inline-grid; place-items: center; }
    .play { height: 72px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; }
    .tools { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .tool { border: 1px solid var(--line); background: rgba(255,255,255,0.68); color: var(--text); border-radius: 16px; min-height: 46px; display: grid; place-items: center; gap: 4px; font-size: 12px; }
    .tool.active { color: var(--accent); border-color: rgba(217, 110, 154, 0.38); background: rgba(255, 234, 243, 0.72); }
    .lyrics { display: grid; align-content: center; gap: 16px; text-align: center; min-height: 100%; padding: 26px 8px; }
    .lyric-line { margin: 0; color: var(--muted); font-size: 17px; line-height: 1.45; transition: transform 160ms ease, color 160ms ease, opacity 160ms ease; opacity: 0.62; }
    .lyric-line.current { color: var(--text); opacity: 1; font-size: clamp(25px, 8vw, 36px); font-weight: 800; transform: scale(1.02); }
    .settings { display: grid; gap: 14px; align-content: start; }
    .setting { display: grid; gap: 8px; padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.58); border: 1px solid var(--line); }
    .setting label { font-size: 12px; color: var(--soft); font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
    .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    select { width: 100%; border: 1px solid var(--line); border-radius: 14px; padding: 11px 12px; background: #fff; color: var(--text); }
    .tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 7px; border-radius: 20px; background: rgba(255,255,255,0.6); border: 1px solid var(--line); }
    .tab-btn { border: 0; border-radius: 15px; background: transparent; color: var(--soft); min-height: 44px; font-weight: 800; }
    .tab-btn.active { background: #fff; color: var(--text); box-shadow: 0 8px 22px rgba(52,43,61,0.1); }
    .small { color: var(--soft); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
    @media (max-width: 360px) { .controls { gap: 12px; } .tools { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <main class="app">
    <header class="top">
      <div class="brand">
        <strong>ECHO Remote</strong>
        <span class="status"><span id="dot" class="dot"></span><span id="statusText">Connecting</span></span>
      </div>
      <span id="clientPill" class="pill">LAN</span>
    </header>

    <section class="content card">
      <div id="tabNow" class="tab now active">
        <div id="cover" class="cover">♪</div>
        <div class="meta">
          <h1 id="title" class="title">ECHO</h1>
          <p id="artist" class="artist">Waiting for playback</p>
        </div>
        <div class="seek">
          <input id="seek" type="range" min="0" max="0" step="0.1" value="0" />
          <div class="time"><span id="pos">0:00</span><span id="dur">0:00</span></div>
        </div>
        <div class="controls">
          <button class="round" id="prev" aria-label="Previous">‹‹</button>
          <button class="round play" id="play" aria-label="Play or pause">▶</button>
          <button class="round" id="next" aria-label="Next">››</button>
        </div>
        <div class="tools">
          <button id="like" class="tool">♡<span>Like</span></button>
          <button id="mode" class="tool">↻<span id="modeText">Loop</span></button>
          <button id="mute" class="tool">♬<span>Mute</span></button>
          <button id="lyricsBtn" class="tool">詞<span>Lyrics</span></button>
        </div>
      </div>

      <div id="tabLyrics" class="tab">
        <div class="lyrics">
          <p id="lyricPrev" class="lyric-line"></p>
          <p id="lyricCurrent" class="lyric-line current">No lyrics</p>
          <p id="lyricNext" class="lyric-line"></p>
        </div>
      </div>

      <div id="tabSettings" class="tab settings">
        <div class="setting">
          <label>Volume</label>
          <div class="setting-row"><input id="volume" type="range" min="0" max="1" step="0.01" value="1" /><strong id="volumeText">100%</strong></div>
        </div>
        <div class="setting">
          <label>Playback Rate</label>
          <div class="setting-row"><input id="rate" type="range" min="0.5" max="2" step="0.05" value="1" /><strong id="rateText">1.00x</strong></div>
        </div>
        <div class="setting">
          <label>EQ Preset</label>
          <select id="eq">
            <option value="">Keep current</option>
            <option value="Custom">Custom</option>
            <option value="Flat">Flat</option>
            <option value="Pop">Pop</option>
            <option value="Rock">Rock</option>
            <option value="Classical">Classical</option>
            <option value="Bass Boost">Bass Boost</option>
            <option value="Treble Boost">Treble Boost</option>
            <option value="Vocal">Vocal</option>
            <option value="Electronic">Electronic</option>
            <option value="Hi-Res Air">Hi-Res Air</option>
          </select>
        </div>
        <div class="setting">
          <label>Desktop Lyrics</label>
          <div class="setting-row">
            <button id="desktopLyricsOpen" class="tool">Open</button>
            <button id="desktopLyricsClose" class="tool">Close</button>
          </div>
        </div>
        <div class="setting">
          <label>Connection</label>
          <p id="urlText" class="small"></p>
        </div>
      </div>
    </section>

    <nav class="tabs">
      <button class="tab-btn active" data-tab="Now">Now</button>
      <button class="tab-btn" data-tab="Lyrics">Lyrics</button>
      <button class="tab-btn" data-tab="Settings">Settings</button>
    </nav>
  </main>

  <script>
    const els = {
      dot: document.getElementById('dot'),
      statusText: document.getElementById('statusText'),
      clientPill: document.getElementById('clientPill'),
      cover: document.getElementById('cover'),
      title: document.getElementById('title'),
      artist: document.getElementById('artist'),
      seek: document.getElementById('seek'),
      pos: document.getElementById('pos'),
      dur: document.getElementById('dur'),
      play: document.getElementById('play'),
      like: document.getElementById('like'),
      mode: document.getElementById('mode'),
      modeText: document.getElementById('modeText'),
      mute: document.getElementById('mute'),
      lyricPrev: document.getElementById('lyricPrev'),
      lyricCurrent: document.getElementById('lyricCurrent'),
      lyricNext: document.getElementById('lyricNext'),
      volume: document.getElementById('volume'),
      volumeText: document.getElementById('volumeText'),
      rate: document.getElementById('rate'),
      rateText: document.getElementById('rateText'),
      eq: document.getElementById('eq'),
      urlText: document.getElementById('urlText')
    }
    let ws = null
    let reconnectMs = 650
    let heartbeat = 0
    let lastState = null
    const token = new URLSearchParams(location.search).get('t') || ''
    els.urlText.textContent = location.href

    function formatTime(value) {
      const seconds = Math.max(0, Number(value) || 0)
      const m = Math.floor(seconds / 60)
      const s = Math.floor(seconds % 60)
      return m + ':' + String(s).padStart(2, '0')
    }

    function setStatus(kind, text) {
      els.dot.className = 'dot ' + (kind || '')
      els.statusText.textContent = text
    }

    function send(type, payload) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type, payload }))
    }

    function command(command, payload) {
      send('command', { command, payload: payload || {} })
    }

    function renderCover(src) {
      els.cover.innerHTML = ''
      if (src) {
        const img = document.createElement('img')
        img.src = src
        img.alt = ''
        img.onerror = () => {
          els.cover.innerHTML = '♪'
        }
        els.cover.appendChild(img)
      } else {
        els.cover.textContent = '♪'
      }
    }

    function render(state) {
      lastState = state || {}
      const track = lastState.track || {}
      const playback = lastState.playback || {}
      const lyrics = lastState.lyrics || {}
      els.title.textContent = track.title || 'ECHO'
      els.artist.textContent = track.artist || track.album || 'Waiting for playback'
      renderCover(track.cover || '')
      els.play.textContent = playback.isPlaying ? 'Ⅱ' : '▶'
      els.seek.max = Math.max(0, Number(playback.duration) || 0)
      els.seek.value = Math.max(0, Number(playback.position) || 0)
      els.pos.textContent = formatTime(playback.position)
      els.dur.textContent = formatTime(playback.duration)
      els.volume.value = Math.max(0, Math.min(1, Number(playback.volume) || 0))
      els.volumeText.textContent = Math.round(Number(els.volume.value) * 100) + '%'
      els.rate.value = Math.max(0.5, Math.min(2, Number(playback.playbackRate) || 1))
      els.rateText.textContent = Number(els.rate.value).toFixed(2) + 'x'
      els.like.classList.toggle('active', !!track.liked)
      els.mute.classList.toggle('active', !!playback.isMuted)
      const mode = playback.playMode || 'loop'
      els.modeText.textContent = mode === 'shuffle' ? 'Shuffle' : mode === 'single' ? 'Single' : 'Loop'
      els.lyricPrev.textContent = lyrics.prev || ''
      els.lyricCurrent.textContent = lyrics.current || 'No lyrics'
      els.lyricNext.textContent = lyrics.next || ''
    }

    function connect() {
      clearInterval(heartbeat)
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(proto + '//' + location.host + '/remote-ws' + location.search)
      ws.onopen = () => {
        reconnectMs = 650
        setStatus('ok', 'Connected')
        send('hello', { token })
        heartbeat = setInterval(() => send('ping', { at: Date.now() }), 10000)
      }
      ws.onmessage = (event) => {
        let msg = null
        try { msg = JSON.parse(event.data) } catch { return }
        if (msg.type === 'auth_failed') {
          setStatus('bad', 'Token rejected')
          return
        }
        if (msg.type === 'hello') {
          els.clientPill.textContent = msg.payload && msg.payload.clientId ? 'Client ' + msg.payload.clientId.slice(-4) : 'LAN'
        }
        if (msg.type === 'state') render(msg.payload)
      }
      ws.onclose = () => {
        clearInterval(heartbeat)
        setStatus('bad', 'Reconnecting')
        setTimeout(connect, reconnectMs)
        reconnectMs = Math.min(8000, Math.round(reconnectMs * 1.6))
      }
      ws.onerror = () => setStatus('bad', 'Connection error')
    }

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn))
        document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'))
        document.getElementById('tab' + btn.dataset.tab).classList.add('active')
      })
    })
    document.getElementById('prev').onclick = () => command('previous')
    document.getElementById('next').onclick = () => command('next')
    els.play.onclick = () => command('togglePlay')
    els.like.onclick = () => command('toggleLike')
    els.mode.onclick = () => command('cyclePlayMode')
    els.mute.onclick = () => command('toggleMute')
    document.getElementById('lyricsBtn').onclick = () => command('toggleLyricsView')
    els.seek.addEventListener('change', () => command('seek', { position: Number(els.seek.value) || 0 }))
    els.volume.addEventListener('input', () => {
      els.volumeText.textContent = Math.round(Number(els.volume.value) * 100) + '%'
    })
    els.volume.addEventListener('change', () => command('setVolume', { volume: Number(els.volume.value) || 0 }))
    els.rate.addEventListener('input', () => {
      els.rateText.textContent = Number(els.rate.value).toFixed(2) + 'x'
    })
    els.rate.addEventListener('change', () => command('setPlaybackRate', { rate: Number(els.rate.value) || 1 }))
    els.eq.addEventListener('change', () => {
      if (els.eq.value) command('setEqPreset', { preset: els.eq.value })
    })
    document.getElementById('desktopLyricsOpen').onclick = () => command('setDesktopLyrics', { enabled: true })
    document.getElementById('desktopLyricsClose').onclick = () => command('setDesktopLyrics', { enabled: false })

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/remote-sw.js' + location.search).catch(() => {})
    }
    connect()
  </script>
</body>
</html>`

const REMOTE_SW_JS = String.raw`const CACHE = 'echo-phone-remote-v5';
const START_URL = __REMOTE_START_URL__;
self.addEventListener('install', (event) => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('echo-phone-remote-')).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});`

function makeToken() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

function timingSafeTokenEqual(received, expected) {
  const candidate = String(received || '')
  const reference = String(expected || '')
  const candidateFixed = Buffer.from(candidate.padEnd(6, '0').slice(0, 6))
  const referenceFixed = Buffer.from(reference.padEnd(6, '0').slice(0, 6))
  const formatOk = /^\d{6}$/.test(candidate) && /^\d{6}$/.test(reference)
  return crypto.timingSafeEqual(candidateFixed, referenceFixed) && formatOk
}

function isPrivateIpv4(address) {
  const parts = String(address || '')
    .split('.')
    .map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  const [a, b] = parts
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

function getLanIpv4Addresses() {
  const entries = []
  const seen = new Set()
  const nets = os.networkInterfaces()
  for (const [name, items] of Object.entries(nets)) {
    for (const item of items || []) {
      if (!item || item.family !== 'IPv4' || item.internal) continue
      if (!isPrivateIpv4(item.address)) continue
      if (seen.has(item.address)) continue
      seen.add(item.address)
      const label = String(name || '')
      const virtualPenalty = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|tailscale|zerotier/i.test(
        label
      )
        ? 100
        : 0
      const wifiBonus = /wi-?fi|wlan|wireless/i.test(label) ? -20 : 0
      const ethernetBonus = /ethernet|以太|本地连接/i.test(label) ? -10 : 0
      const subnetScore = item.address.startsWith('192.168.')
        ? 0
        : item.address.startsWith('10.')
          ? 20
          : 30
      entries.push({
        address: item.address,
        score: virtualPenalty + wifiBonus + ethernetBonus + subnetScore
      })
    }
  }
  return entries.sort((a, b) => a.score - b.score).map((entry) => entry.address)
}

function asSafeRemoteState(snapshot) {
  const state = snapshot && typeof snapshot === 'object' ? snapshot : {}
  const track = state.track && typeof state.track === 'object' ? state.track : {}
  const playback = state.playback && typeof state.playback === 'object' ? state.playback : {}
  const lyrics = state.lyrics && typeof state.lyrics === 'object' ? state.lyrics : {}
  const queue = Array.isArray(state.queue) ? state.queue : []
  const search = state.search && typeof state.search === 'object' ? state.search : {}
  const library = state.library && typeof state.library === 'object' ? state.library : {}
  const controls = state.controls && typeof state.controls === 'object' ? state.controls : {}
  const safeTrackItem = (item) => ({
    id: String(item?.id || ''),
    title: String(item?.title || ''),
    artist: String(item?.artist || ''),
    album: String(item?.album || ''),
    cover: typeof item?.cover === 'string' ? item.cover : '',
    duration: Number.isFinite(Number(item?.duration)) ? Number(item.duration) : 0,
    codec: String(item?.codec || ''),
    sampleRateHz: Number.isFinite(Number(item?.sampleRateHz)) ? Number(item.sampleRateHz) : 0,
    bitDepth: Number.isFinite(Number(item?.bitDepth)) ? Number(item.bitDepth) : 0,
    bitrateKbps: Number.isFinite(Number(item?.bitrateKbps)) ? Number(item.bitrateKbps) : 0,
    isCurrent: item?.isCurrent === true
  })
  return {
    track: {
      id: String(track.id || ''),
      title: String(track.title || ''),
      artist: String(track.artist || ''),
      album: String(track.album || ''),
      cover: typeof track.cover === 'string' ? track.cover : '',
      liked: track.liked === true,
      qualityText: String(track.qualityText || '')
    },
    playback: {
      isPlaying: playback.isPlaying === true,
      position: Number.isFinite(Number(playback.position)) ? Number(playback.position) : 0,
      duration: Number.isFinite(Number(playback.duration)) ? Number(playback.duration) : 0,
      playbackRate: Number.isFinite(Number(playback.playbackRate))
        ? Number(playback.playbackRate)
        : 1,
      volume: Number.isFinite(Number(playback.volume)) ? Number(playback.volume) : 1,
      isMuted: playback.isMuted === true,
      playMode: String(playback.playMode || 'loop')
    },
    lyrics: {
      prev: String(lyrics.prev || ''),
      current: String(lyrics.current || ''),
      next: String(lyrics.next || ''),
      index: Number.isFinite(Number(lyrics.index)) ? Number(lyrics.index) : -1
    },
    queue: queue.slice(0, 80).map(safeTrackItem),
    search: {
      query: String(search.query || ''),
      results: (Array.isArray(search.results) ? search.results : []).slice(0, 40).map(safeTrackItem)
    },
    library: {
      query: String(library.query || ''),
      offset: Number.isFinite(Number(library.offset)) ? Number(library.offset) : 0,
      total: Number.isFinite(Number(library.total)) ? Number(library.total) : 0,
      hasMore: library.hasMore === true,
      results: (Array.isArray(library.results) ? library.results : [])
        .slice(0, 500)
        .map(safeTrackItem)
    },
    controls: {
      libraryCount: Number.isFinite(Number(controls.libraryCount)) ? Number(controls.libraryCount) : 0,
      useNativeEngine: controls.useNativeEngine === true,
      audioExclusive: controls.audioExclusive === true,
      gaplessEnabled: controls.gaplessEnabled === true,
      automixEnabled: controls.automixEnabled === true,
      desktopLyricsEnabled: controls.desktopLyricsEnabled === true,
      useEQ: controls.useEQ === true,
      activePreset: String(controls.activePreset || 'Custom'),
      eqPresets: (Array.isArray(controls.eqPresets) ? controls.eqPresets : [])
        .slice(0, 80)
        .map((item) => String(item || ''))
        .filter(Boolean),
      outputDeviceId: String(controls.outputDeviceId || ''),
      outputDeviceName: String(controls.outputDeviceName || ''),
      outputDevices: (Array.isArray(controls.outputDevices) ? controls.outputDevices : [])
        .slice(0, 80)
        .map((device) => ({
          id: String(device?.id || ''),
          name: String(device?.name || ''),
          isDefault: device?.isDefault === true
        }))
    }
  }
}

export class PhoneRemoteServer {
  constructor({ getMainWindow, onCommand } = {}) {
    this.getMainWindow = typeof getMainWindow === 'function' ? getMainWindow : () => null
    this.onCommand = typeof onCommand === 'function' ? onCommand : null
    this.httpServer = null
    this.wss = null
    this.port = DEFAULT_PORT
    this.token = makeToken()
    this.allowNoToken = false
    this.clients = new Map()
    this.lastState = asSafeRemoteState(null)
    this.heartbeatTimer = null
    this.lastError = ''
  }

  async start(options = {}) {
    const requestedPort = normalizePort(options.port)
    const nextAllowNoToken = options.allowNoToken === true
    if (this.httpServer) {
      const authModeChanged = this.allowNoToken !== nextAllowNoToken
      this.allowNoToken = nextAllowNoToken
      if (authModeChanged) this.disconnectClients(1008, 'auth_mode_changed')
      if (requestedPort === this.port) return this.getStatus()
      await this.stop()
    }
    this.allowNoToken = nextAllowNoToken

    for (let port = requestedPort; port < requestedPort + 20 && port < 65535; port += 1) {
      try {
        await this.listenOnPort(port)
        this.port = port
        this.lastError = ''
        this.startHeartbeat()
        console.info(`[PhoneRemote] listening on ${port}`)
        return this.getStatus()
      } catch (error) {
        if (error?.code !== 'EADDRINUSE') {
          this.lastError = error?.message || String(error)
          throw error
        }
      }
    }

    this.lastError = `No available port from ${requestedPort}`
    throw new Error(this.lastError)
  }

  async stop() {
    this.stopHeartbeat()
    for (const client of this.clients.values()) {
      try {
        client.ws.close(1001, 'remote_stopped')
      } catch {
        /* ignore */
      }
    }
    this.clients.clear()
    const wss = this.wss
    const server = this.httpServer
    this.wss = null
    this.httpServer = null

    await Promise.all([
      new Promise((resolve) => {
        if (!wss) return resolve()
        try {
          wss.close(() => resolve())
        } catch {
          resolve()
        }
      }),
      new Promise((resolve) => {
        if (!server) return resolve()
        try {
          server.close(() => resolve())
        } catch {
          resolve()
        }
      })
    ])
    return this.getStatus()
  }

  async listenOnPort(port) {
    const server = http.createServer((req, res) => this.handleHttpRequest(req, res))
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => {
      const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      if (parsed.pathname !== '/remote-ws') {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    })
    wss.on('connection', (ws, req) => this.handleWsConnection(ws, req))

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '0.0.0.0')
    })

    this.httpServer = server
    this.wss = wss
  }

  handleHttpRequest(req, res) {
    const host = req.headers.host || 'localhost'
    const parsed = new URL(req.url || '/', `http://${host}`)
    if (parsed.pathname === '/remote-sw.js') {
      if (!this.isRequestAuthorized(parsed)) {
        this.writeText(res, 403, 'auth_failed')
        return
      }
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store'
      })
      const startUrl = this.allowNoToken
        ? './'
        : `./?t=${encodeURIComponent(parsed.searchParams.get('t') || this.token)}`
      res.end(REMOTE_SW_JS.replace('__REMOTE_START_URL__', JSON.stringify(startUrl)))
      return
    }

    if (parsed.pathname === '/remote-manifest.webmanifest') {
      if (!this.isRequestAuthorized(parsed)) {
        this.writeText(res, 403, 'auth_failed')
        return
      }
      const startUrl = this.allowNoToken
        ? './'
        : `./?t=${encodeURIComponent(parsed.searchParams.get('t') || this.token)}`
      res.writeHead(200, {
        'content-type': 'application/manifest+json; charset=utf-8',
        'cache-control': 'no-store'
      })
      res.end(
        JSON.stringify({
          name: 'ECHO Remote',
          short_name: 'ECHO',
          start_url: startUrl,
          scope: './',
          display: 'standalone',
          background_color: '#f8f3f7',
          theme_color: '#d66f9c'
        })
      )
      return
    }

    if (req.method !== 'GET' || (parsed.pathname !== '/' && parsed.pathname !== '/index.html')) {
      this.writeText(res, 404, 'not_found')
      return
    }

    if (!this.isRequestAuthorized(parsed)) {
      console.warn(`[PhoneRemote] HTTP auth failed from ${req.socket?.remoteAddress || 'unknown'}`)
      this.writeText(res, 403, 'auth_failed')
      return
    }

    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    })
    res.end(MOBILE_REMOTE_HTML_V2)
  }

  handleWsConnection(ws, req) {
    const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    if (!this.isRequestAuthorized(parsed)) {
      console.warn(`[PhoneRemote] WS auth failed from ${req.socket?.remoteAddress || 'unknown'}`)
      this.sendRaw(ws, 'auth_failed', {})
      ws.close(1008, 'auth_failed')
      return
    }
    if (this.clients.size >= MAX_CLIENTS) {
      this.sendRaw(ws, 'server_full', { maxClients: MAX_CLIENTS })
      ws.close(1013, 'server_full')
      return
    }

    const id = crypto.randomUUID()
    const client = {
      id,
      ws,
      ip: req.socket?.remoteAddress || '',
      userAgent: req.headers['user-agent'] || '',
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      isAlive: true
    }
    this.clients.set(id, client)
    ws.on('message', (data) => this.handleClientMessage(client, data))
    ws.on('pong', () => {
      client.isAlive = true
      client.lastSeen = Date.now()
    })
    ws.on('close', () => {
      this.clients.delete(id)
    })
    this.send(client, 'hello', { clientId: id, maxClients: MAX_CLIENTS })
    this.send(client, 'state', this.lastState)
  }

  handleClientMessage(client, data) {
    client.lastSeen = Date.now()
    let msg = null
    try {
      msg = JSON.parse(String(data || ''))
    } catch {
      this.send(client, 'error', { error: 'invalid_json' })
      return
    }
    const type = msg?.type
    if (type === 'ping') {
      this.send(client, 'pong', { at: Date.now() })
      return
    }
    if (type === 'hello') {
      this.send(client, 'state', this.lastState)
      return
    }
    if (type === 'queue_request') {
      this.send(client, 'state', this.lastState)
      return
    }
    if (type === 'command') {
      const command = String(msg?.payload?.command || '')
      if (!command) {
        this.send(client, 'error', { error: 'missing_command' })
        return
      }
      const payload = msg?.payload?.payload || {}
      this.forwardCommand(client, command, payload)
      this.send(client, 'ack', { command })
    }
  }

  forwardCommand(client, command, payload) {
    const message = {
      clientId: client.id,
      command,
      payload: payload && typeof payload === 'object' ? payload : {},
      receivedAt: Date.now()
    }
    if (this.onCommand) {
      this.onCommand(message)
      return
    }
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('remote:command', message)
    }
  }

  updateState(snapshot) {
    this.lastState = asSafeRemoteState(snapshot)
    this.broadcast('state', this.lastState)
    return { ok: true }
  }

  rotateToken() {
    this.token = makeToken()
    this.disconnectClients(1008, 'token_rotated', 'token_rotated')
    return this.getStatus()
  }

  kickClient(clientId) {
    const id = String(clientId || '')
    const client = this.clients.get(id)
    if (!client) return { ok: false, error: 'not_found', ...this.getStatus() }
    this.send(client, 'kicked', {})
    try {
      client.ws.close(1008, 'kicked')
    } catch {
      /* ignore */
    }
    this.clients.delete(id)
    return { ok: true, ...this.getStatus() }
  }

  listClients() {
    return this.getStatus().clients
  }

  getStatus() {
    const addresses = getLanIpv4Addresses()
    const urls = addresses.map((address) => this.makeUrl(address))
    const localUrl = this.makeUrl('127.0.0.1')
    return {
      ok: true,
      enabled: !!this.httpServer,
      listening: !!this.httpServer,
      port: this.httpServer ? this.port : normalizePort(this.port),
      token: this.token,
      allowNoToken: this.allowNoToken,
      primaryUrl: urls[0] || localUrl,
      localUrl,
      urls,
      clients: Array.from(this.clients.values()).map((client) => ({
        id: client.id,
        ip: client.ip,
        userAgent: client.userAgent,
        connectedAt: client.connectedAt,
        lastSeen: client.lastSeen
      })),
      maxClients: MAX_CLIENTS,
      lastError: this.lastError
    }
  }

  disconnectClients(code = 1001, reason = 'disconnect', eventType = reason) {
    for (const client of this.clients.values()) {
      this.send(client, eventType, {})
      try {
        client.ws.close(code, reason)
      } catch {
        /* ignore */
      }
    }
    this.clients.clear()
  }

  makeUrl(address) {
    const host = address.includes(':') ? `[${address}]` : address
    const tokenQuery = this.allowNoToken ? '' : `?t=${encodeURIComponent(this.token)}`
    return `http://${host}:${this.port}/${tokenQuery}`
  }

  isRequestAuthorized(parsedUrl) {
    if (this.allowNoToken) return true
    return timingSafeTokenEqual(parsedUrl.searchParams.get('t'), this.token)
  }

  startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const client of this.clients.values()) {
        if (!client.isAlive || now - client.lastSeen > CLIENT_TIMEOUT_MS) {
          try {
            client.ws.terminate()
          } catch {
            /* ignore */
          }
          this.clients.delete(client.id)
          continue
        }
        client.isAlive = false
        try {
          client.ws.ping()
        } catch {
          this.clients.delete(client.id)
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  stopHeartbeat() {
    if (!this.heartbeatTimer) return
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  send(client, type, payload) {
    this.sendRaw(client.ws, type, payload)
  }

  broadcast(type, payload) {
    for (const client of this.clients.values()) {
      this.send(client, type, payload)
    }
  }

  sendRaw(ws, type, payload) {
    if (!ws || ws.readyState !== 1) return
    try {
      ws.send(JSON.stringify({ type, payload }))
    } catch {
      /* ignore */
    }
  }

  writeText(res, statusCode, text) {
    res.writeHead(statusCode, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store'
    })
    res.end(text)
  }
}

function normalizePort(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1 || n > 65534) return DEFAULT_PORT
  return Math.floor(n)
}
