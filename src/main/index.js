import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  net,
  clipboard,
  nativeImage
} from 'electron'
import { join, basename, dirname, extname, resolve, sep } from 'path'
import { execSync as _execSyncUtf } from 'child_process'

// Fix Windows console encoding so CJK characters in logs aren't garbled
if (process.platform === 'win32') {
  try { _execSyncUtf('chcp 65001', { stdio: 'ignore' }) } catch { /* best-effort */ }
}

// YouTube 内嵌 MV：主界面来自 localhost / 本地 file，embed 为跨�??iframe。Chromium 默认按「顶级站�??× 嵌入源」做
// 存储分区，导致在「应用内登录」子窗口（同一会话）里写入�??youtube.com Cookie 无法被该 iframe 读取�??// 仍会提示「请登录 / 机器人验证」。须�??app ready 之前关闭第三方存储分区。（合规桌面应用常见做法，非绕过验证逻辑。）
app.commandLine.appendSwitch('disable-features', 'ThirdPartyStoragePartitioning')
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs from 'fs'
import { execFile } from 'child_process'
import DiscordRPC from 'discord-rpc'
import axios from 'axios'
import http from 'http'
import { audioEngine } from './audio/AudioEngine'
import { DlnaMediaRenderer } from './cast/DlnaMediaRenderer.js'
import { initCrashReporter, logError, getCrashDir } from './CrashReporter'
import MediaDownloader from './MediaDownloader'
import { importPlaylistFromLink } from './playlistLinkImport.js'
import { convertLinesToRomaji } from './romajiKuroshiro.js'
import {
  fetchNeteaseLrcText,
  searchNeteaseSongs
} from './neteaseLyrics.js'
import { getMediaDurationSeconds } from './utils/ffmpegProbeDuration.js'
import { getDialogStrings } from './dialogLocale.js'
import PluginManager from './plugins/PluginManager.js'

function dialogLocaleFromOpts(opts) {
  const loc = opts && typeof opts === 'object' && opts.locale
  return loc === 'zh' || loc === 'ja' ? loc : 'en'
}

let mainWindow = null
/** Floating lyrics panel (renderer `?mode=lyrics-desktop`) */
let lyricsDesktopWindow = null
/** Last payload so the child window can request a resend after it subscribes to IPC */
let lyricsDesktopLastPayload = {}
/** Main-process timer pulls lyrics from the main renderer — not throttled when the main window is minimized */
let lyricsDesktopMainSyncTimer = null

function stopLyricsDesktopMainSyncTimer() {
  if (lyricsDesktopMainSyncTimer) {
    clearInterval(lyricsDesktopMainSyncTimer)
    lyricsDesktopMainSyncTimer = null
  }
}

function lyricsDesktopPullFromMainRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!lyricsDesktopWindow || lyricsDesktopWindow.isDestroyed()) return
  mainWindow.webContents
    .executeJavaScript(
      `(function(){try{return typeof window.__getDesktopLyricsPayload==='function'?window.__getDesktopLyricsPayload():null}catch(e){return null}})()`,
      true
    )
    .then((payload) => {
      if (!payload || typeof payload !== 'object') return
      lyricsDesktopLastPayload = payload
      if (lyricsDesktopWindow && !lyricsDesktopWindow.isDestroyed()) {
        lyricsDesktopWindow.webContents.send('lyrics-desktop:data', payload)
      }
    })
    .catch(() => {})
}

function startLyricsDesktopMainSyncTimer() {
  stopLyricsDesktopMainSyncTimer()
  lyricsDesktopMainSyncTimer = setInterval(() => {
    lyricsDesktopPullFromMainRenderer()
  }, 50)
}

function broadcastCastStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('cast:status', dlnaRenderer.getStatus())
}

const dlnaRenderer = new DlnaMediaRenderer({
  audioEngine,
  getMainWindow: () => mainWindow,
  onCastActivity: broadcastCastStatus
})
let youtubeSignInWindow = null
let bilibiliSignInWindow = null
let neteaseSignInWindow = null
let rendererHttpServer = null
let rendererServerUrl = null
const APP_STATE_FILE = 'echoes-app-state.json'
const APP_STATE_KEYS = new Set([
  'playlist',
  'userPlaylists',
  'config',
  'likedPaths',
  'playMode',
  'queuePlaybackEnabled',
  'downloaderSettings',
  'ltSettings',
  'lyricsDesktopBounds'
])

function readAppStateJson() {
  try {
    const filePath = join(app.getPath('userData'), APP_STATE_FILE)
    if (!fs.existsSync(filePath)) return {}
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAppStateJson(nextState) {
  try {
    const filePath = join(app.getPath('userData'), APP_STATE_FILE)
    fs.writeFileSync(filePath, JSON.stringify(nextState), 'utf-8')
    return true
  } catch (e) {
    console.warn('[appState] write failed:', e?.message || e)
    return false
  }
}

/** Override with env `ECHOES_SOUNDCLOUD_PROXY` (no trailing slash), e.g. https://your-proxy.example.com */
const SOUNDCLOUD_PROXY_BASE = (
  process.env.ECHOES_SOUNDCLOUD_PROXY || 'https://soundcloud-ep22.onrender.com'
).replace(/\/$/, '')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8'
}

function getMimeType(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'
}

const SUPPORTED_AUDIO_EXTS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.m4a',
  '.aac',
  '.ncm',
  '.dsf',
  '.dff'
])

/**
 * 递归收集目录下（或单个音频文件）的受支持音频，顺序为目录遍历顺序�?
 * @param {string} entryPath
 * @param {{ name: string, path: string }[]} out
 */
function collectAudioFilesRecursive(entryPath, out) {
  try {
    const stats = fs.statSync(entryPath)
    if (stats.isDirectory()) {
      for (const name of fs.readdirSync(entryPath)) {
        collectAudioFilesRecursive(join(entryPath, name), out)
      }
    } else {
      const ext = extname(entryPath).toLowerCase()
      if (SUPPORTED_AUDIO_EXTS.has(ext)) {
        out.push({ name: basename(entryPath), path: entryPath })
      }
    }
  } catch (e) {
    console.error(`[collectAudioFilesRecursive] ${entryPath}:`, e?.message || e)
  }
}

async function startRendererHttpServer() {
  if (rendererServerUrl) return rendererServerUrl

  const rendererRoot = resolve(join(__dirname, '../renderer'))

  rendererHttpServer = http.createServer((req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
      let pathname = decodeURIComponent(requestUrl.pathname || '/')
      if (pathname === '/') pathname = '/index.html'

      const normalizedPath = pathname.replace(/^\/+/, '')
      let targetPath = resolve(join(rendererRoot, normalizedPath))

      const allowedPrefix = `${rendererRoot}${sep}`
      if (targetPath !== rendererRoot && !targetPath.startsWith(allowedPrefix)) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }

      if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
        targetPath = resolve(join(rendererRoot, 'index.html'))
      }

      if (!fs.existsSync(targetPath)) {
        res.writeHead(404)
        res.end('Not Found')
        return
      }

      res.writeHead(200, {
        'Content-Type': getMimeType(targetPath),
        'Cache-Control': 'no-cache'
      })
      fs.createReadStream(targetPath).pipe(res)
    } catch (e) {
      res.writeHead(500)
      res.end('Internal Server Error')
    }
  })

  await new Promise((resolvePromise, rejectPromise) => {
    rendererHttpServer.once('error', rejectPromise)
    rendererHttpServer.listen(0, '127.0.0.1', () => {
      const addr = rendererHttpServer.address()
      rendererServerUrl = `http://127.0.0.1:${addr.port}`
      console.log(`[RendererServer] Started at ${rendererServerUrl}`)
      resolvePromise()
    })
  })

  return rendererServerUrl
}

async function stopRendererHttpServer() {
  if (!rendererHttpServer) return
  await new Promise((resolvePromise) => {
    rendererHttpServer.close(() => resolvePromise())
  })
  rendererHttpServer = null
  rendererServerUrl = null
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 900,
    minWidth: 760,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    // Keep timers/rAF running when minimized so desktop lyrics IPC sync does not stall.
    backgroundThrottling: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      // webSecurity must be false so file:// audio works from http(s) pages.
      sandbox: false,
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', () => {
    try {
      stopLyricsDesktopMainSyncTimer()
      if (lyricsDesktopWindow && !lyricsDesktopWindow.isDestroyed()) {
        try {
          const bounds = lyricsDesktopWindow.getBounds()
          const state = readAppStateJson()
          state.lyricsDesktopBounds = bounds
          writeAppStateJson(state)
        } catch (e) {}
        lyricsDesktopWindow.destroy()
        lyricsDesktopWindow = null
      }
    } catch {
      /* ignore */
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    const localUrl = await startRendererHttpServer()
    mainWindow.loadURL(localUrl)
  }
}

// Discord RPC Setup
const DISCORD_CLIENT_ID = '1487118099298779206'
const DISCORD_RPC_RECONNECT_MAX = 10
let rpcClient = null
let rpcReady = false
let rpcRetryTimer = null
let rpcConnecting = false
let rpcEnabled = true
let rpcReconnectAttempts = 0
let rpcLastActivity = null
/** 应用即将退出（Windows/Linux 关窗链或任意平台 before-quit）：禁止重连 */
let discordRpcQuitting = false
const rpcCoverCache = new Map()

const DEFAULT_RPC_ACTIVITY = {
  details: 'Browsing library',
  state: 'ECHO',
  largeImageKey: 'echoes_logo',
  largeImageText: 'ECHO - Hi-Fi Audio Player',
  instance: false
}

function clearRpcRetryTimer() {
  if (rpcRetryTimer) {
    clearTimeout(rpcRetryTimer)
    rpcRetryTimer = null
  }
}

/** 重连 / login 前快速拆掉旧 transport，不�? Discord clear（避免闪断展示） */
function destroyRpcClient() {
  if (!rpcClient) {
    rpcReady = false
    rpcConnecting = false
    return
  }
  const c = rpcClient
  rpcClient = null
  rpcReady = false
  rpcConnecting = false
  try {
    c.removeAllListeners()
  } catch (_) {}
  Promise.resolve(c.destroy()).catch(() => {})
}

/** 退出或用户关闭 RPC：先 clearActivity �? destroy，减少对端残留「正在玩�? */
async function disposeDiscordRpc() {
  clearRpcRetryTimer()
  const c = rpcClient
  const wasReady = rpcReady
  rpcClient = null
  rpcReady = false
  rpcConnecting = false
  if (!c) return
  try {
    c.removeAllListeners()
  } catch (_) {}
  try {
    if (wasReady) await c.clearActivity()
  } catch (_) {}
  try {
    await c.destroy()
  } catch (_) {}
}

function buildRpcPayload(activity = {}) {
  const payload = {
    details: activity.title || 'Unknown Track',
    state: `${activity.artist || 'ECHO'}${activity.playbackRate ? ` · ${activity.playbackRate}x Speed` : ''}`,
    // NOTE: Discord RPC expects app asset key, not arbitrary URL.
    largeImageKey: 'echoes_logo',
    largeImageText: 'ECHO',
    smallImageKey: activity.isPlaying ? 'playing' : 'paused',
    smallImageText: activity.isPlaying ? 'Playing' : 'Paused',
    instance: false
  }

  if (activity.startTimestamp && Number.isFinite(activity.startTimestamp)) {
    payload.startTimestamp = activity.startTimestamp
  }
  if (activity.endTimestamp && Number.isFinite(activity.endTimestamp)) {
    payload.endTimestamp = activity.endTimestamp
  }

  return payload
}

function getDiscordImageKeyCandidates(coverUrl) {
  if (!coverUrl || typeof coverUrl !== 'string') return []
  const url = coverUrl.trim()
  if (!/^https?:\/\//i.test(url)) return []

  // Some Discord clients/extensions accept URL directly, some accept mp: prefixed form.
  return [url, `mp:${url}`]
}

async function resolveRpcCoverUrl(activity = {}) {
  if (activity?.coverUrl && /^https?:\/\//i.test(activity.coverUrl)) {
    return activity.coverUrl
  }

  const title = (activity?.title || '').trim()
  const artist = (activity?.artist || '').trim()
  const cacheKey = `${title}::${artist}`
  if (!title) return null

  if (rpcCoverCache.has(cacheKey)) {
    return rpcCoverCache.get(cacheKey)
  }

  try {
    const query = encodeURIComponent(`${title} ${artist}`.trim())
    const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`
    const response = await axios.get(url, { timeout: 5000 })
    const artwork = response?.data?.results?.[0]?.artworkUrl100 || null
    const highRes = artwork ? artwork.replace('100x100bb.jpg', '1000x1000bb.jpg') : null
    rpcCoverCache.set(cacheKey, highRes)
    return highRes
  } catch (_) {
    rpcCoverCache.set(cacheKey, null)
    return null
  }
}

async function applyRpcActivity(activity, fallbackToDefault = false) {
  if (discordRpcQuitting || !rpcClient || !rpcReady) return false
  try {
    if (activity) {
      const payload = buildRpcPayload(activity)
      const resolvedCoverUrl = await resolveRpcCoverUrl(activity)
      const candidates = getDiscordImageKeyCandidates(resolvedCoverUrl)

      for (const imageKey of candidates) {
        try {
          await rpcClient.setActivity({
            ...payload,
            largeImageKey: imageKey,
            largeImageText: `${activity.title || 'Unknown Track'} cover`
          })
          return true
        } catch (_) {
          // Try next candidate
        }
      }

      // Fallback to app default asset if dynamic cover fails.
      await rpcClient.setActivity(payload)
      return true
    }

    await rpcClient.setActivity(DEFAULT_RPC_ACTIVITY)
    return true
  } catch (e) {
    if (fallbackToDefault) {
      try {
        await rpcClient.setActivity(DEFAULT_RPC_ACTIVITY)
        return true
      } catch (_) {}
    }
    console.log('[Discord RPC] setActivity failed:', e?.message || e)
    return false
  }
}

function scheduleDiscordReconnect(reason = 'unknown') {
  if (discordRpcQuitting || !rpcEnabled) return
  if (rpcReconnectAttempts >= DISCORD_RPC_RECONNECT_MAX) {
    console.warn(
      '[Discord RPC] Max reconnect attempts reached; change track or re-enable RPC to retry.'
    )
    return
  }
  clearRpcRetryTimer()

  const delay = Math.min(5000 * Math.pow(2, rpcReconnectAttempts), 60000)
  rpcReconnectAttempts += 1
  console.log(`[Discord RPC] Reconnect scheduled in ${delay}ms (${reason})`)
  rpcRetryTimer = setTimeout(() => {
    initDiscordRPC()
  }, delay)
}

function initDiscordRPC() {
  if (discordRpcQuitting || !rpcEnabled) return
  if (rpcReady || rpcConnecting) return

  clearRpcRetryTimer()
  destroyRpcClient()

  try {
    rpcConnecting = true
    rpcClient = new DiscordRPC.Client({ transport: 'ipc' })

    rpcClient.on('ready', () => {
      rpcReady = true
      rpcConnecting = false
      rpcReconnectAttempts = 0
      console.log('[Discord RPC] Connected!')
      applyRpcActivity(rpcLastActivity, true).catch(() => {})
    })

    rpcClient.on('disconnected', () => {
      console.log('[Discord RPC] Disconnected')
      rpcReady = false
      rpcConnecting = false
      destroyRpcClient()
      scheduleDiscordReconnect('disconnected')
    })

    rpcClient.on('error', (err) => {
      console.log('[Discord RPC] Client error:', err?.message || err)
      rpcReady = false
      rpcConnecting = false
      destroyRpcClient()
      scheduleDiscordReconnect('client-error')
    })

    rpcClient.login({ clientId: DISCORD_CLIENT_ID }).catch((err) => {
      console.log('[Discord RPC] Login failed:', err.message)
      rpcReady = false
      rpcConnecting = false
      destroyRpcClient()
      scheduleDiscordReconnect('login-failed')
    })
  } catch (e) {
    console.log('[Discord RPC] Init error:', e.message)
    rpcReady = false
    rpcConnecting = false
    destroyRpcClient()
    scheduleDiscordReconnect('init-error')
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.echoes.studio')

  const chromeVersion = process.versions.chrome || '126.0.0.0'
  const chromeMajor = chromeVersion.split('.')[0]
  const standardUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`

  app.userAgentFallback = standardUA
  session.defaultSession.setUserAgent(standardUA)

  // 修正 Sec-CH-UA Client Hints + B 站视�??CDN Referer 注入
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://*.google.com/*',
        'https://*.youtube.com/*',
        'https://*.gstatic.com/*',
        'https://*.googleapis.com/*',
        'https://*.bilivideo.com/*',
        'https://*.bilivideo.cn/*'
      ]
    },
    (details, callback) => {
      const h = details.requestHeaders
      h['User-Agent'] = standardUA
      if (/bilivideo\.com|bilivideo\.cn/i.test(details.url)) {
        h['Referer'] = 'https://www.bilibili.com/'
        h['Origin'] = 'https://www.bilibili.com'
      } else {
        h['Sec-CH-UA'] =
          `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not_A Brand";v="8"`
        h['Sec-CH-UA-Mobile'] = '?0'
        h['Sec-CH-UA-Platform'] = `"Windows"`
      }
      callback({ requestHeaders: h })
    }
  )

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://*.bilivideo.com/*', 'https://*.bilivideo.cn/*'] },
    (details, callback) => {
      const rh = details.responseHeaders || {}
      rh['access-control-allow-origin'] = ['*']
      rh['access-control-allow-methods'] = ['GET, HEAD, OPTIONS']
      callback({ responseHeaders: rh })
    }
  )

  // 初始化崩溃报告器（必须在最前）
  initCrashReporter(() => audioEngine.getStatus())

  // 插件系统
  const pluginManager = new PluginManager()
  pluginManager.registerIPC()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('app:getVersion', async () => {
    try {
      return app.getVersion()
    } catch {
      return '0.0.0'
    }
  })

  ipcMain.handle('appState:get', async (_, key) => {
    if (!APP_STATE_KEYS.has(key)) return null
    const state = readAppStateJson()
    return state[key] ?? null
  })

  ipcMain.handle('appState:set', async (_, key, value) => {
    if (!APP_STATE_KEYS.has(key)) return { ok: false, error: 'invalid_key' }
    const state = readAppStateJson()
    state[key] = value
    const ok = writeAppStateJson(state)
    return ok ? { ok: true } : { ok: false, error: 'write_failed' }
  })

  ipcMain.handle('shell:openExternal', async (_, url) => {
    if (typeof url !== 'string') return { ok: false, error: 'invalid_url' }
    const t = url.trim()
    if (!/^https?:\/\//i.test(t)) return { ok: false, error: 'invalid_url' }
    try {
      await shell.openExternal(t)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('shell:showItemInFolder', async (_, fullPath) => {
    if (typeof fullPath !== 'string' || !fullPath.trim())
      return { ok: false, error: 'invalid_path' }
    try {
      shell.showItemInFolder(fullPath.trim())
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('shell:openPath', async (_, fullPath) => {
    if (typeof fullPath !== 'string' || !fullPath.trim())
      return { ok: false, error: 'invalid_path' }
    try {
      const err = await shell.openPath(fullPath.trim())
      if (err) return { ok: false, error: err }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('clipboard:writeText', async (_, text) => {
    if (typeof text !== 'string') return { ok: false, error: 'invalid_text' }
    try {
      clipboard.writeText(text)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('clipboard:writeImage', async (_, dataUrl) => {
    if (typeof dataUrl !== 'string' || !dataUrl.trim()) {
      return { ok: false, error: 'invalid_image_data' }
    }
    try {
      const img = nativeImage.createFromDataURL(dataUrl)
      if (img.isEmpty()) return { ok: false, error: 'invalid_image_data' }
      clipboard.writeImage(img)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // IPC: Show open folder dialog
  ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections']
    })
    if (canceled) {
      return []
    } else {
      return filePaths
    }
  })
  // IPC: Show open files dialog
  ipcMain.handle('dialog:openFile', async (_, opts) => {
    const d = getDialogStrings(dialogLocaleFromOpts(opts))
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: d.filterAudio,
          extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'ncm', 'dsf', 'dff']
        }
      ]
    })
    if (canceled) {
      return []
    } else {
      return filePaths.map((f) => ({
        name: basename(f),
        path: f
      }))
    }
  })

  // IPC: Show open VST plugin dialog (.dll)
  ipcMain.handle('dialog:openVstPlugin', async (_, opts) => {
    const loc = dialogLocaleFromOpts(opts)
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: loc === 'zh' ? 'VST2 插件' : 'VST2 Plugin', extensions: ['dll'] }]
    })
    return { canceled, filePaths }
  })

  // IPC: Show open lyrics file dialog (.lrc / .lrcx)
  ipcMain.handle('dialog:openLyricsFile', async (_, opts) => {
    const d = getDialogStrings(dialogLocaleFromOpts(opts))
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: d.filterLyrics,
          extensions: ['lrc', 'lrcx', 'txt']
        }
      ]
    })
    if (canceled || !filePaths?.length) return null
    return filePaths[0]
  })

  // IPC: Show open image dialog
  ipcMain.handle('dialog:openImage', async (_, opts) => {
    const d = getDialogStrings(dialogLocaleFromOpts(opts))
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: d.filterImages,
          extensions: ['jpg', 'png', 'gif', 'webp', 'bmp', 'jpeg']
        }
      ]
    })
    if (canceled) {
      return null
    } else {
      return filePaths[0] // Return the single path
    }
  })

  ipcMain.handle('dialog:openFontFile', async (_, opts) => {
    const d = getDialogStrings(dialogLocaleFromOpts(opts))
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: d.filterFonts,
          extensions: ['ttf', 'otf', 'woff', 'woff2']
        }
      ]
    })
    if (canceled || !filePaths?.length) return null
    return filePaths[0]
  })

  ipcMain.handle('dialog:openThemeJson', async (_, opts) => {
    const d = getDialogStrings(dialogLocaleFromOpts(opts))
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: d.filterThemeJson, extensions: ['json'] }]
    })
    if (canceled || !filePaths?.length) return null
    try {
      const content = fs.readFileSync(filePaths[0], 'utf8')
      return { path: filePaths[0], content }
    } catch (e) {
      return { error: String(e.message || e) }
    }
  })

  ipcMain.handle('dialog:saveThemeJson', async (_, text, defaultName, opts) => {
    const d = getDialogStrings(dialogLocaleFromOpts(opts))
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: d.saveThemeTitle,
      defaultPath: defaultName || 'echoes-studio-theme.json',
      filters: [{ name: d.filterThemeJson, extensions: ['json'] }]
    })
    if (canceled || !filePath) return { success: false }
    try {
      fs.writeFileSync(filePath, text, 'utf8')
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: String(e.message || e) }
    }
  })

  ipcMain.handle('dialog:saveImage', async (_, dataUrl, defaultName) => {
    if (typeof dataUrl !== 'string' || !dataUrl.trim()) {
      return { success: false, error: 'invalid_image_data' }
    }
    try {
      const img = nativeImage.createFromDataURL(dataUrl)
      if (img.isEmpty()) return { success: false, error: 'invalid_image_data' }
      const pngBuffer = img.toPNG()
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save Image',
        defaultPath: defaultName || 'song-card.png',
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      })
      if (canceled || !filePath) return { success: false }
      fs.writeFileSync(filePath, pngBuffer)
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: String(e.message || e) }
    }
  })

  // IPC: Read directory �? 递归包含所有子文件夹中的受支持音频
  ipcMain.handle('file:readDirectory', async (_, dirPath) => {
    try {
      const audioFiles = []
      collectAudioFilesRecursive(dirPath, audioFiles)
      return audioFiles
    } catch (e) {
      console.error(e)
      return []
    }
  })

  // IPC: Process multiple paths (files or directories) for drag-and-drop
  ipcMain.handle('file:getFilesFromPaths', async (_, paths) => {
    const result = []
    for (const p of paths) {
      collectAudioFilesRecursive(p, result)
    }
    return result
  })

  // IPC: Read file as buffer (for jsmediatags or general binary reading)
  ipcMain.handle('file:readBuffer', async (_, filePath) => {
    try {
      const buffer = fs.readFileSync(filePath)
      return buffer
    } catch (e) {
      return null
    }
  })

  // IPC: 日文歌词�??�??罗马音（Kuroshiro + Kuromoji，首调较慢）
  ipcMain.handle('lyrics:toRomajiBatch', async (_, texts) => {
    try {
      return await convertLinesToRomaji(texts)
    } catch (e) {
      console.warn('[lyrics:toRomajiBatch]', e?.message || e)
      return Array.isArray(texts) ? texts.map(() => '') : []
    }
  })

  ipcMain.handle('lyrics:neteaseFetch', async (_, payload) => {
    try {
      const lrc = await fetchNeteaseLrcText(payload || {})
      return { ok: !!lrc, lrc: lrc || '' }
    } catch (e) {
      console.warn('[lyrics:neteaseFetch]', e?.message || e)
      return { ok: false, lrc: '' }
    }
  })

  // IPC: Read LRC lyrics file (same directory, same name as audio file)
  ipcMain.handle('file:readLyrics', async (_, audioFilePath) => {
    try {
      const { dirname, basename, join: pathJoin, extname } = await import('path')
      const dir = dirname(audioFilePath)
      const nameWithoutExt = basename(audioFilePath, extname(audioFilePath))
      const lrcPath = pathJoin(dir, `${nameWithoutExt}.lrc`)
      const lrcPath2 = pathJoin(dir, `${nameWithoutExt}.txt`) // Check for .txt as well
      if (fs.existsSync(lrcPath)) {
        const content = fs.readFileSync(lrcPath, 'utf-8')
        return content
      } else if (fs.existsSync(lrcPath2)) {
        return fs.readFileSync(lrcPath2, 'utf8')
      }
      return null
    } catch (error) {
      console.error('Error reading lyrics:', error)
      return null
    }
  })

  // IPC: Read info JSON (from yt-dlp)
  ipcMain.handle('file:readInfoJson', async (_, audioFilePath) => {
    try {
      const { dirname, basename, join: pathJoin, extname } = await import('path')
      const dir = dirname(audioFilePath)
      const nameWithoutExt = basename(audioFilePath, extname(audioFilePath))
      const infoPath = pathJoin(dir, `${nameWithoutExt}.info.json`)
      if (fs.existsSync(infoPath)) {
        const content = fs.readFileSync(infoPath, 'utf-8')
        return JSON.parse(content)
      }
      return null
    } catch (error) {
      console.error('Error reading info json:', error)
      return null
    }
  })

  // Media Download IPC
  ipcMain.handle('netease:search', async (event, keywords) => {
    return await searchNeteaseSongs(keywords)
  })

  ipcMain.handle('netease:fetchLrcText', async (event, params) => {
    return await fetchNeteaseLrcText(params)
  })

  ipcMain.handle('media:writeFile', async (event, filePath, text) => {
    const fs = require('fs')
    fs.writeFileSync(filePath, text, 'utf8')
    return true
  })

  ipcMain.handle('media:getMetadata', async (event, url) => {
    return await MediaDownloader.getMetadata(url)
  })

  ipcMain.handle('media:download', async (event, url, folder, options = {}) => {
    return await MediaDownloader.downloadAudio(url, folder, event.sender, options)
  })

  ipcMain.handle('playlistLink:importPlaylist', async (event, payload) => {
    const { playlistInput, downloadFolder } = payload || {}
    return await importPlaylistFromLink(playlistInput, downloadFolder, event.sender)
  })

  // IPC: Search MV
  function scoreBilibiliResult(video, queryTerms) {
    const raw = (video.title || '').replace(/<[^>]*>/g, '')
    const t = raw.toLowerCase()
    const author = (video.author || '').toLowerCase()
    let score = 0

    for (const term of queryTerms) {
      if (term.length < 2) continue
      if (t.includes(term)) score += 3
      if (author.includes(term)) score += 1
    }

    if (/MV|官方|official|music\s*video/i.test(raw)) score += 5
    if (/PV|原版|完整�?/i.test(raw)) score += 2
    if (
      /reaction|翻唱|cover|教程|教学|钢琴|piano|guitar|吉他|drum|鼓|手元|弹奏|演奏|谱|tabs?$/i.test(
        raw
      )
    )
      score -= 6
    if (/搬运|转载/i.test(raw)) score -= 1

    const dim = video.dimension || {}
    const res = dim.height ? `${dim.width || '?'}x${dim.height}` : ''

    return { score, title: raw, resolution: res }
  }

  ipcMain.handle('api:searchMV', async (_, query, source = 'youtube') => {
    try {
      if (source === 'bilibili') {
        const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}`
        const resp = await net.fetch(url, {
          headers: {
            'User-Agent': standardUA,
            Referer: 'https://www.bilibili.com/'
          }
        })
        const data = await resp.json()

        const videoResults = data?.data?.result || []
        if (videoResults.length > 0) {
          const queryTerms = query
            .toLowerCase()
            .replace(/\b(mv|官方|official)\b/gi, '')
            .split(/\s+/)
            .filter((t) => t.length >= 2)

          const scored = videoResults.slice(0, 15).map((v) => {
            const { score, title, resolution } = scoreBilibiliResult(v, queryTerms)
            return {
              bvid: v.bvid,
              score,
              title,
              author: v.author || '',
              resolution
            }
          })
          scored.sort((a, b) => b.score - a.score)

          const hit = scored[0]
          if (hit) {
            console.log(
              `[MV Search] Bilibili: "${query}" -> score=${hit.score} bvid=${hit.bvid} res=${hit.resolution || 'N/A'}`
            )
            return {
              id: hit.bvid,
              title: hit.title,
              source: 'bilibili',
              resolution: hit.resolution
            }
          }
        }
      } else {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
        const { data } = await axios.get(url, {
          headers: { 'User-Agent': standardUA }
        })
        const titleMatch = data.match(/"title":\{"runs":\[\{"text":"([^"]+)"\}/)
        const idMatch = data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/)
        if (idMatch && idMatch[1]) {
          const ytTitle = titleMatch ? titleMatch[1] : 'unknown'
          console.log(`[MV Search] YouTube: "${query}" -> id=${idMatch[1]}`)
          return { id: idMatch[1], title: ytTitle, source: 'youtube' }
        }
      }
    } catch (e) {
      console.error('[MV Search] Error:', e.message)
    }
    return null
  })

  // IPC: Save audio file
  ipcMain.handle('dialog:saveExport', async (_, arrayBuffer, defaultName, opts) => {
    const d = getDialogStrings(dialogLocaleFromOpts(opts))
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: d.saveExportTitle,
      defaultPath: defaultName || 'export.wav',
      filters: [{ name: d.filterWav, extensions: ['wav'] }]
    })
    if (!canceled && filePath) {
      fs.writeFileSync(filePath, Buffer.from(arrayBuffer))
      return { success: true, filePath }
    }
    return { success: false }
  })

  // IPC: Close App
  ipcMain.on('window:close', () => {
    app.quit()
  })

  // IPC: Maximize App
  ipcMain.on('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    }
  })

  // IPC: Minimize App
  ipcMain.on('window:minimize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) win.minimize()
  })

  // IPC: Download from SoundCloud using Third-Party Proxy
  ipcMain.handle('soundcloud:download', async (_, url, downloadPath) => {
    try {
      // 1. Get Metadata via SoundCloud oEmbed
      const oembedUrl = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`
      const metaRes = await axios.get(oembedUrl)
      const info = metaRes.data || {}

      if (!info.title) throw new Error('Could not fetch track metadata')

      const title = info.title.replace(/[\\/:*?"<>|]/g, '_')

      // 2. Prepare Download Path
      const targetDir = downloadPath || join(app.getAppPath(), 'downloads')
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }

      const fileName = `${title}.mp3`
      const filePath = join(targetDir, fileName)

      // 3. Download via Proxy
      const proxyUrl = `${SOUNDCLOUD_PROXY_BASE}/stream?url=${encodeURIComponent(url)}`
      console.log(`[SoundCloud] Downloading via proxy: ${proxyUrl}`)

      const response = await axios({
        method: 'GET',
        url: proxyUrl,
        responseType: 'stream',
        timeout: 30000 // 30s timeout
      })

      const writeStream = fs.createWriteStream(filePath)

      return new Promise((resolve, reject) => {
        response.data.pipe(writeStream)

        writeStream.on('finish', () => {
          resolve({
            success: true,
            name: fileName,
            path: filePath
          })
        })

        response.data.on('error', (err) => {
          console.error('SoundCloud stream error:', err)
          reject(err)
        })

        writeStream.on('error', (err) => {
          console.error('SoundCloud write error:', err)
          reject(err)
        })
      })
    } catch (e) {
      console.error('SoundCloud download error:', e)
      return {
        success: false,
        error: e.response?.status === 500 ? 'Proxy error (Render instance sleepy)' : e.message
      }
    }
  })

  // IPC: Convert NCM to FLAC/MP3
  ipcMain.handle('file:convertNcm', async (_, ncmPath) => {
    return new Promise((resolve) => {
      // exe path is in root
      const exeName = 'NCMconverter.exe'
      // Use process.cwd() in dev, process.resourcesPath in production
      const exePath = is.dev ? join(process.cwd(), exeName) : join(process.resourcesPath, exeName)

      if (!fs.existsSync(exePath)) {
        console.error('Converter not found at:', exePath)
        return resolve({ success: false, error: 'Converter not found' })
      }

      execFile(exePath, [ncmPath], (error, stdout, stderr) => {
        if (error) {
          console.error('Conversion error:', error)
          return resolve({ success: false, error: error.message })
        }

        // Try to find the output file (flac or mp3)
        const dir = dirname(ncmPath)
        const nameWithoutExt = basename(ncmPath, extname(ncmPath))

        const possibleOutputs = [
          join(dir, `${nameWithoutExt}.flac`),
          join(dir, `${nameWithoutExt}.mp3`)
        ]

        for (const outPath of possibleOutputs) {
          if (fs.existsSync(outPath)) {
            return resolve({
              success: true,
              path: outPath,
              name: basename(outPath)
            })
          }
        }

        resolve({
          success: false,
          error: 'Conversion completed but output file not found'
        })
      })
    })
  })

  function getExtendedMetadataFallback(filePath) {
    const ext = extname(filePath)
    const baseTitle = basename(filePath, ext)
    const extShort = ext.replace(/^\./, '').toUpperCase() || null
    return {
      success: true,
      technical: {
        sampleRate: null,
        bitrate: null,
        channels: null,
        codec: extShort,
        duration: null,
        lossless: ['FLAC', 'WAV', 'APE', 'ALAC'].includes(extShort || '')
      },
      common: {
        title: baseTitle,
        artist: 'Unknown Artist',
        album: null,
        albumArtist: null,
        trackNo: null,
        discNo: null,
        lyrics: null,
        cover: null
      }
    }
  }

  // IPC: Get Extended Audio Metadata (Sample rate, bitrate, format, cover)
  ipcMain.handle('file:getExtendedMetadata', async (_, filePath) => {
    try {
      // Use dynamic import for pure-ESM music-metadata in CJS main process
      const { parseFile, selectCover } = await import('music-metadata')
      const metadata = await parseFile(filePath)
      let cover = null

      const extLower = extname(filePath).toLowerCase()
      const isDsdFile = extLower === '.dsf' || extLower === '.dff'
      let durationSec = metadata.format.duration
      if (isDsdFile) {
        const probed = await getMediaDurationSeconds(filePath)
        if (probed > 0) durationSec = probed
      }

      const picture = selectCover(metadata.common.picture)
      if (picture) {
        // picture.format is already a MIME type like 'image/jpeg'
        const mime = picture.format.includes('/') ? picture.format : `image/${picture.format}`
        cover = `data:${mime};base64,${Buffer.from(picture.data).toString('base64')}`
      }

      return {
        success: true,
        technical: {
          sampleRate: metadata.format.sampleRate,
          bitrate: metadata.format.bitrate,
          channels: metadata.format.numberOfChannels,
          codec: metadata.format.container, // e.g., 'FLAC', 'MPEG'
          duration: durationSec,
          lossless:
            metadata.format.lossless ||
            metadata.format.container?.toLowerCase() === 'flac' ||
            metadata.format.container?.toLowerCase() === 'wav'
        },
        common: {
          title: metadata.common.title || basename(filePath, extname(filePath)),
          artist: metadata.common.artist || 'Unknown Artist',
          album: metadata.common.album,
          albumArtist: metadata.common.albumartist || metadata.common.albumArtist || null,
          trackNo: metadata.common.track?.no ?? null,
          discNo: metadata.common.disk?.no ?? null,
          lyrics:
            Array.isArray(metadata.common.lyrics) && metadata.common.lyrics.length > 0
              ? metadata.common.lyrics.join('\n')
              : null,
          cover: cover
        }
      }
    } catch (e) {
      const msg = e?.message || String(e)
      const isKnownParseNoise =
        e?.name === 'FieldDecodingError' || /FourCC|invalid characters|Tokenizer/i.test(msg)
      if (!isKnownParseNoise) {
        console.error('getExtendedMetadata error:', msg)
      }
      return getExtendedMetadataFallback(filePath)
    }
  })

  // IPC: Update Discord Rich Presence
  ipcMain.on('discord:setActivity', (_, activity) => {
    rpcLastActivity = activity || null
    if (!rpcEnabled || discordRpcQuitting) return

    if (!rpcClient || !rpcReady) {
      rpcReconnectAttempts = 0
      initDiscordRPC()
      return
    }

    applyRpcActivity(rpcLastActivity, true).catch(() => {})
  })

  // IPC: Clear Discord Presence
  ipcMain.on('discord:clearActivity', () => {
    rpcLastActivity = null
    if (!rpcClient || !rpcReady) return
    try {
      rpcClient.clearActivity()
    } catch (e) {}
  })

  // IPC: Toggle Discord RPC
  ipcMain.on('discord:toggle', (_, enabled) => {
    rpcEnabled = !!enabled
    if (enabled) {
      if (discordRpcQuitting) return
      rpcReconnectAttempts = 0
      initDiscordRPC()
    } else {
      rpcLastActivity = null
      void disposeDiscordRpc()
    }
  })

  // === Native Audio Engine IPC ===
  ipcMain.handle('audio:getDevices', async () => {
    return audioEngine.getDevices()
  })

  ipcMain.handle('audio:setDevice', async (_, deviceId) => {
    return audioEngine.setDevice(deviceId)
  })

  ipcMain.handle('audio:setExclusive', async (_, exclusive) => {
    audioEngine.setExclusive(exclusive)
  })

  ipcMain.handle('audio:setOutputBufferProfile', async (_, profile) => {
    audioEngine.setOutputBufferProfile(profile)
  })

  ipcMain.handle('audio:setEqConfig', async (_, eqConfig) => {
    audioEngine.setEqConfig(eqConfig)
  })

  ipcMain.handle('audio:play', async (_, filePath, startTime, playbackRate, sourceSampleRateHint) => {
    return audioEngine.play(filePath, startTime, playbackRate, sourceSampleRateHint)
  })

  ipcMain.handle('audio:setPlaybackRate', async (_, rate) => {
    return audioEngine.setPlaybackRate(rate)
  })

  ipcMain.handle('audio:pause', async () => {
    audioEngine.pause()
  })

  ipcMain.handle('audio:resume', async () => {
    audioEngine.resume()
  })

  ipcMain.handle('audio:stop', async () => {
    audioEngine.stop()
  })

  ipcMain.handle('audio:setVolume', async (_, vol) => {
    audioEngine.setVolume(vol)
  })

  ipcMain.handle('audio:loadVst', async (_, path) => {
    audioEngine.loadVstPlugin(path)
  })

  ipcMain.handle('audio:disableVst', async () => {
    audioEngine.disableVstPlugin()
  })

  ipcMain.handle('audio:showVstUI', async () => {
    audioEngine.showVstPluginUI()
  })

  // Start polling playback status
  let lastAudioStatus = null
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const status = audioEngine.getStatus()
    if (lastAudioStatus && lastAudioStatus.playing !== status.playing) {
      // Playing state changed, notify renderer
      mainWindow.webContents.send('audio:status-update', status)
    }
    lastAudioStatus = status
  }, 200)

  ipcMain.handle('lyricsDesktop:open', async () => {
    try {
      if (lyricsDesktopWindow && !lyricsDesktopWindow.isDestroyed()) {
        lyricsDesktopWindow.focus()
        startLyricsDesktopMainSyncTimer()
        lyricsDesktopPullFromMainRenderer()
        return { ok: true }
      }

      const globalState = readAppStateJson()
      const savedBounds = globalState.lyricsDesktopBounds || { width: 680, height: 132 }
      const alwaysOnTop = globalState.config?.desktopLyricsAlwaysOnTop !== false

      lyricsDesktopWindow = new BrowserWindow({
        width: savedBounds.width,
        height: savedBounds.height,
        x: savedBounds.x,
        y: savedBounds.y,
        minWidth: 400,
        minHeight: 64,
        show: false,
        frame: false,
        transparent: true,
        hasShadow: false,
        alwaysOnTop: alwaysOnTop,
        autoHideMenuBar: true,
        backgroundThrottling: false,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          sandbox: false,
          webSecurity: false
        }
      })

      if (alwaysOnTop) {
        lyricsDesktopWindow.setAlwaysOnTop(true, 'screen-saver')
        lyricsDesktopWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      }

      // Must attach before loadURL: ready-to-show often fires before loadURL's promise resolves,
      // so registering after await loadURL leaves the window invisible forever (show: false).
      lyricsDesktopWindow.once('ready-to-show', () => {
        if (lyricsDesktopWindow && !lyricsDesktopWindow.isDestroyed()) lyricsDesktopWindow.show()
      })
      lyricsDesktopWindow.on('close', () => {
        try {
          if (lyricsDesktopWindow && !lyricsDesktopWindow.isDestroyed()) {
            const bounds = lyricsDesktopWindow.getBounds()
            const state = readAppStateJson()
            state.lyricsDesktopBounds = bounds
            writeAppStateJson(state)
          }
        } catch {
          // ignore
        }
      })
      lyricsDesktopWindow.on('closed', () => {
        stopLyricsDesktopMainSyncTimer()
        lyricsDesktopWindow = null
      })
      let loadUrl
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        const u = new URL(process.env['ELECTRON_RENDERER_URL'])
        u.searchParams.set('mode', 'lyrics-desktop')
        loadUrl = u.toString()
      } else {
        const localUrl = await startRendererHttpServer()
        const u = new URL(localUrl)
        u.searchParams.set('mode', 'lyrics-desktop')
        loadUrl = u.toString()
      }
      await lyricsDesktopWindow.loadURL(loadUrl)
      if (lyricsDesktopWindow && !lyricsDesktopWindow.isDestroyed() && !lyricsDesktopWindow.isVisible()) {
        lyricsDesktopWindow.show()
      }
      startLyricsDesktopMainSyncTimer()
      lyricsDesktopPullFromMainRenderer()
      return { ok: true }
    } catch (e) {
      console.error('[lyricsDesktop] open failed:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('lyricsDesktop:close', async () => {
    try {
      stopLyricsDesktopMainSyncTimer()
      if (lyricsDesktopWindow && !lyricsDesktopWindow.isDestroyed()) {
        lyricsDesktopWindow.close()
      }
      lyricsDesktopWindow = null
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('lyricsDesktop:setAlwaysOnTop', async (_, isAlwaysOnTop) => {
    try {
      if (lyricsDesktopWindow && !lyricsDesktopWindow.isDestroyed()) {
        if (isAlwaysOnTop) {
          lyricsDesktopWindow.setAlwaysOnTop(true, 'screen-saver')
          lyricsDesktopWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        } else {
          lyricsDesktopWindow.setAlwaysOnTop(false)
          lyricsDesktopWindow.setVisibleOnAllWorkspaces(false)
        }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /** User dismissed the floating overlay (Escape / right-click): close + uncheck in main UI */
  ipcMain.handle('lyricsDesktop:dismiss', async () => {
    try {
      stopLyricsDesktopMainSyncTimer()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lyrics-desktop:uncheck')
      }
      if (lyricsDesktopWindow && !lyricsDesktopWindow.isDestroyed()) {
        lyricsDesktopWindow.close()
      }
      lyricsDesktopWindow = null
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('lyricsDesktop:ready', async () => {
    if (lyricsDesktopWindow && !lyricsDesktopWindow.isDestroyed()) {
      lyricsDesktopWindow.webContents.send('lyrics-desktop:data', lyricsDesktopLastPayload)
    }
    return { ok: true }
  })

  // === 手机投流到本机（DLNA MediaRenderer�??==
  ipcMain.handle('cast:dlnaStart', async (_, opts) => {
    return dlnaRenderer.start(opts || {})
  })

  ipcMain.handle('cast:dlnaStop', async () => {
    return dlnaRenderer.stop()
  })

  ipcMain.handle('cast:getStatus', async () => {
    return dlnaRenderer.getStatus()
  })

  // 获取崩溃报告目录
  ipcMain.handle('crash:getReportDir', () => {
    return getCrashDir()
  })

  // 获取崩溃报告列表
  ipcMain.handle('crash:listReports', () => {
    try {
      const dir = getCrashDir()
      if (!fs.existsSync(dir)) return []
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.log'))
        .map((f) => ({
          name: f,
          path: join(dir, f),
          size: fs.statSync(join(dir, f)).size,
          time: fs.statSync(join(dir, f)).mtime.toISOString()
        }))
        .sort((a, b) => new Date(b.time) - new Date(a.time))
    } catch (e) {
      return []
    }
  })

  // 打开崩溃报告文件�?
  ipcMain.on('crash:openDir', () => {
    const dir = getCrashDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    shell.openPath(dir)
  })

  ipcMain.handle('dev:openDevTools', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools()
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' })
      }
    }
    return { ok: true }
  })

  ipcMain.handle('dev:reloadWindow', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload()
    }
    return { ok: true }
  })

  ipcMain.handle('dev:openUserData', () => {
    const p = app.getPath('userData')
    try {
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
      shell.openPath(p)
    } catch (_) {}
    return { ok: true, path: p }
  })
  const STEALTH_JS = `(function(){
    Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    if(!window.chrome)window.chrome={};
    if(!window.chrome.runtime)window.chrome.runtime={connect:function(){},sendMessage:function(){}};
    Object.defineProperty(navigator,'plugins',{get:()=>{
      const p=[
        {name:'Chrome PDF Plugin',filename:'internal-pdf-viewer',description:'Portable Document Format',length:1,item:()=>null,namedItem:()=>null},
        {name:'Chrome PDF Viewer',filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai',description:'',length:1,item:()=>null,namedItem:()=>null},
        {name:'Native Client',filename:'internal-nacl-plugin',description:'',length:1,item:()=>null,namedItem:()=>null},
      ];p.refresh=()=>{};try{Object.setPrototypeOf(p,PluginArray.prototype)}catch(e){};return p}});
    Object.defineProperty(navigator,'languages',{get:()=>['zh-CN','zh','en-US','en']});
    const _oq=navigator.permissions&&navigator.permissions.query&&navigator.permissions.query.bind(navigator.permissions);
    if(_oq)navigator.permissions.query=(p)=>p.name==='notifications'?Promise.resolve({state:Notification.permission}):_oq(p);
  })()`

  function injectStealth(webContents) {
    webContents.setUserAgent(standardUA)
    const inject = () => {
      if (webContents.isDestroyed()) return
      webContents.executeJavaScript(STEALTH_JS).catch(() => {})
    }
    webContents.on('dom-ready', inject)
    webContents.on('did-navigate-in-page', inject)
  }

  function createSignInWindow(url, onClosed) {
    const sharedSession = mainWindow.webContents.session
    const win = new BrowserWindow({
      parent: mainWindow,
      width: 960,
      height: 720,
      minWidth: 400,
      minHeight: 400,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        session: sharedSession,
        contextIsolation: true,
        sandbox: true
      }
    })
    injectStealth(win.webContents)
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show()
    })
    win.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: win,
        autoHideMenuBar: true,
        webPreferences: {
          session: sharedSession,
          contextIsolation: true,
          sandbox: true
        }
      }
    }))
    win.webContents.on('did-create-window', (child) => {
      injectStealth(child.webContents)
    })
    win.loadURL(url)
    win.on('closed', () => {
      if (onClosed) onClosed()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('signin:status-changed')
      }
    })
    return win
  }

  ipcMain.handle('youtube:openSignInWindow', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: 'no_main_window' }
    }
    if (youtubeSignInWindow && !youtubeSignInWindow.isDestroyed()) {
      youtubeSignInWindow.focus()
      return { ok: true, reused: true }
    }
    youtubeSignInWindow = createSignInWindow('https://www.youtube.com/', () => {
      youtubeSignInWindow = null
    })
    return { ok: true }
  })

  ipcMain.handle('bilibili:openSignInWindow', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: 'no_main_window' }
    }
    if (bilibiliSignInWindow && !bilibiliSignInWindow.isDestroyed()) {
      bilibiliSignInWindow.focus()
      return { ok: true, reused: true }
    }
    bilibiliSignInWindow = createSignInWindow('https://www.bilibili.com/', () => {
      bilibiliSignInWindow = null
    })
    return { ok: true }
  })

  ipcMain.handle('netease:openSignInWindow', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: 'no_main_window' }
    }
    if (neteaseSignInWindow && !neteaseSignInWindow.isDestroyed()) {
      neteaseSignInWindow.focus()
      return { ok: true, reused: true }
    }
    neteaseSignInWindow = createSignInWindow('https://music.163.com/#/login', () => {
      neteaseSignInWindow = null
    })
    return { ok: true }
  })

  ipcMain.handle('netease:getCookie', async () => {
    const ses = session.defaultSession
    const cookieList = await ses.cookies.get({ domain: '.music.163.com' })
    const map = new Map()
    for (const c of cookieList) {
      map.set(c.name, c.value)
    }
    const names = ['MUSIC_U', 'MUSIC_A', '__csrf', 'NMTID']
    const cookie = names
      .map((name) => {
        const value = map.get(name)
        return value ? `${name}=${value}` : ''
      })
      .filter(Boolean)
      .join('; ')
    return {
      ok: true,
      signedIn: Boolean(map.get('MUSIC_U') || map.get('MUSIC_A')),
      cookie,
      hasMusicU: Boolean(map.get('MUSIC_U'))
    }
  })

  ipcMain.handle('signin:checkStatus', async () => {
    const ses = session.defaultSession
    const ytCookies = await ses.cookies.get({ domain: '.youtube.com' })
    const ytSignedIn = ytCookies.some(
      (c) => c.name === 'SID' || c.name === 'SSID' || c.name === 'LOGIN_INFO'
    )
    const biliCookies = await ses.cookies.get({ domain: '.bilibili.com' })
    const biliSignedIn = biliCookies.some((c) => c.name === 'DedeUserID' || c.name === 'SESSDATA')
    const neteaseCookies = await ses.cookies.get({ domain: '.music.163.com' })
    const neteaseSignedIn = neteaseCookies.some((c) => c.name === 'MUSIC_U' || c.name === 'MUSIC_A')
    return { youtube: ytSignedIn, bilibili: biliSignedIn, netease: neteaseSignedIn }
  })

  // ─── Bilibili: 直接解析视频流地址（绕过嵌入播放器画质限制）───
  const BILI_QN_DESC = {
    6: '240P',
    16: '360P',
    32: '480P',
    64: '720P',
    80: '1080P',
    112: '1080P+',
    116: '1080P 60fps',
    120: '4K',
    127: '8K'
  }

  ipcMain.handle('bilibili:resolveStream', async (_, bvid, qualityId) => {
    try {
      const ses = session.defaultSession
      const cookies = await ses.cookies.get({ domain: '.bilibili.com' })
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
      const headers = {
        Cookie: cookieStr,
        Referer: 'https://www.bilibili.com/',
        'User-Agent': standardUA
      }

      const infoRes = await axios.get(
        `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
        { headers, timeout: 10000 }
      )
      const cid = infoRes.data?.data?.cid
      if (!cid) return { ok: false, error: 'no_cid' }

      const qn = qualityId || 80
      const playRes = await axios.get(
        `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=${qn}&fnval=4048&fourk=1`,
        { headers, timeout: 10000 }
      )
      const d = playRes.data?.data
      if (!d) return { ok: false, error: 'no_play_data', code: playRes.data?.code }

      if (d.dash) {
        const videos = (d.dash.video || []).filter((v) => v.baseUrl || v.base_url)
        const audios = (d.dash.audio || []).filter((a) => a.baseUrl || a.base_url)
        const codecPriority = (c) => {
          if (!c) return 0
          if (c.startsWith('av01')) return 2 // AV1
          if (c.startsWith('hev1') || c.startsWith('hvc1')) return 1 // H.265
          return 0 // H.264
        }
        videos.sort((a, b) => {
          if (b.id !== a.id) return b.id - a.id
          return codecPriority(b.codecs) - codecPriority(a.codecs)
        })
        const bestVideo = videos.find((v) => v.id <= qn) || videos[0]
        audios.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
        const bestAudio = audios[0]
        const videoUrl = bestVideo?.baseUrl || bestVideo?.base_url
        const audioUrl = bestAudio?.baseUrl || bestAudio?.base_url
        const actualQn = bestVideo?.id || qn
        console.log(
          `[Bilibili Stream] DASH: qn=${actualQn} (${BILI_QN_DESC[actualQn] || '?'}), codecs=${bestVideo?.codecs || '?'}`
        )
        return {
          ok: true,
          videoUrl,
          audioUrl,
          quality: actualQn,
          qualityDesc: BILI_QN_DESC[actualQn] || String(actualQn),
          format: 'dash',
          acceptQuality: d.accept_quality || []
        }
      }

      if (d.durl?.length > 0) {
        const actualQn = d.quality || qn
        console.log(`[Bilibili Stream] durl: qn=${actualQn} (${BILI_QN_DESC[actualQn] || '?'})`)
        return {
          ok: true,
          videoUrl: d.durl[0].url,
          audioUrl: null,
          quality: actualQn,
          qualityDesc: BILI_QN_DESC[actualQn] || String(actualQn),
          format: 'durl',
          acceptQuality: d.accept_quality || []
        }
      }

      return { ok: false, error: 'no_stream_found' }
    } catch (e) {
      console.error('[Bilibili Stream] Error:', e?.message || e)
      return { ok: false, error: e?.message || 'unknown' }
    }
  })

  // Native bridge: forward track-ended to renderer
  audioEngine.onTrackEnded(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('audio:track-ended')
    }
  })

  // 定时推送播放状态到渲染进程 (200ms 间隔)
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('audio:status-update', audioEngine.getStatus())
    }
  }, 200)

  await createWindow()
  pluginManager.setMainWindow(mainWindow)
  pluginManager.loadAll().catch((e) => {
    console.error('[PluginManager] loadAll failed:', e?.message || e)
  })
  initDiscordRPC()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((e) => {
        console.error('[Window] Failed to create window:', e?.message || e)
      })
    }
  })
})

app.on('before-quit', () => {
  discordRpcQuitting = true
  clearRpcRetryTimer()
  void disposeDiscordRpc()
  stopRendererHttpServer().catch(() => {})
  dlnaRenderer.stop().catch(() => {})
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    discordRpcQuitting = true
  }
  clearRpcRetryTimer()
  void disposeDiscordRpc()
  // 停止音频引擎
  audioEngine.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
