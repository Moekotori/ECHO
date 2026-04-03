import { createRequire } from 'module'
import fs from 'fs'
import MediaDownloader from './MediaDownloader.js'

const require = createRequire(import.meta.url)

/** 懒加载 CJS 包，避免影响未使用网易云导入时的启动 */
function getNcmApi() {
  return require('@neteasecloudmusicapienhanced/api')
}

/** 与 NeteaseCloudMusicApiEnhanced 一致的请求参数（Cookie / 代理） */
function ncmRequestOptions() {
  const opts = {}
  const cookie = process.env.ECHOES_NETEASE_COOKIE?.trim()
  if (cookie) opts.cookie = cookie
  const proxy = process.env.ECHOES_NETEASE_PROXY?.trim()
  if (proxy) opts.proxy = proxy
  return opts
}

function formatNcmError(err) {
  if (!err || typeof err !== 'object') return String(err)
  const msg = err.body?.msg || err.body?.message
  if (msg) return String(msg)
  if (err.status && err.status !== 200) return `Request failed (HTTP ${err.status})`
  return 'NetEase Cloud Music API request failed'
}

/**
 * Parse NetEase playlist numeric id from paste/input (URLs or plain digits).
 */
export function parseNeteasePlaylistId(input) {
  if (input == null) return null
  const s = String(input).trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return s
  try {
    const normalized = s.includes('://') ? s : `https://${s}`
    const u = new URL(normalized)
    let id = u.searchParams.get('id')
    if (id && /^\d+$/.test(id)) return id
    const pathMatch = u.pathname.match(/\/playlist\/(\d+)/)
    if (pathMatch) return pathMatch[1]
    if (u.hash) {
      const hashQuery = u.hash.includes('?') ? u.hash.slice(u.hash.indexOf('?') + 1) : ''
      const q = new URLSearchParams(hashQuery)
      const hid = q.get('id')
      if (hid && /^\d+$/.test(hid)) return hid
    }
  } catch (_) {
    /* fall through */
  }
  const m = /[?&]id=(\d+)/.exec(s)
  return m ? m[1] : null
}

export async function fetchNeteasePlaylistMeta(playlistId) {
  const ncm = getNcmApi()
  const base = ncmRequestOptions()

  let detail
  try {
    detail = await ncm.playlist_detail({
      id: playlistId,
      ...base
    })
  } catch (err) {
    throw new Error(formatNcmError(err))
  }

  const pl = detail.body?.playlist
  if (!pl) {
    throw new Error(
      'Playlist not found or inaccessible (private or removed; try ECHOES_NETEASE_COOKIE).'
    )
  }

  const name = pl.name || 'NetEase Playlist'

  let songs = []
  try {
    const all = await ncm.playlist_track_all({
      id: playlistId,
      limit: 100000,
      offset: 0,
      ...base
    })
    songs = all.body?.songs || []
  } catch (err) {
    songs = pl.tracks || []
    if (songs.length === 0) {
      throw new Error(formatNcmError(err))
    }
  }

  const tracks = songs.map((t) => ({
    id: t.id,
    name: (t.name && String(t.name).trim()) || 'Unknown',
    artists: (t.ar || [])
      .map((a) => a.name)
      .filter(Boolean)
      .join(', ')
  }))

  return { name, tracks }
}

function ytDlpExtraArgs() {
  const fromEnv = process.env.ECHOES_YTDLP_EXTRA
    ? process.env.ECHOES_YTDLP_EXTRA.split(/\s+/).filter(Boolean)
    : []
  const geo = process.env.ECHOES_NETEASE_NO_GEO === '1' ? [] : ['--geo-bypass-country', 'CN']
  return [...geo, ...fromEnv]
}

/**
 * 拉取歌单元数据并用 yt-dlp 逐首下载到本地（需网络环境可访问网易云音源，海外用户可能需要代理）。
 */
export async function importNeteasePlaylist(playlistInput, downloadFolder, eventSender) {
  const playlistId = parseNeteasePlaylistId(playlistInput)
  if (!playlistId) {
    throw new Error('Invalid playlist URL or ID')
  }
  if (!downloadFolder || !fs.existsSync(downloadFolder)) {
    throw new Error('Invalid save folder; choose a valid directory in Settings.')
  }

  const meta = await fetchNeteasePlaylistMeta(playlistId)
  const total = meta.tracks.length

  eventSender.send('playlist-link:import-progress', {
    phase: 'meta',
    playlistName: meta.name,
    total
  })

  if (total === 0) {
    return { playlistName: meta.name, added: [], failed: [] }
  }

  const extraArgs = ytDlpExtraArgs()
  const added = []
  const failed = []

  for (let i = 0; i < meta.tracks.length; i++) {
    const t = meta.tracks[i]
    const songUrl = `https://music.163.com/song?id=${t.id}`

    eventSender.send('playlist-link:import-progress', {
      phase: 'download',
      current: i + 1,
      total,
      trackName: t.name,
      artists: t.artists
    })

    const basename = `nm_${t.id}`
    try {
      const filePath = await MediaDownloader.downloadAudioWithBasename(
        songUrl,
        downloadFolder,
        basename,
        eventSender,
        { extraArgs }
      )
      added.push({ path: filePath, trackTitle: t.name })
    } catch (e) {
      failed.push({
        name: t.name,
        error: e.message || String(e)
      })
    }

    await new Promise((r) => setTimeout(r, 250))
  }

  return {
    playlistName: meta.name,
    added,
    failed
  }
}
