import { createRequire } from 'module'
import fs from 'fs'
import { join } from 'path'
import MediaDownloader from './MediaDownloader.js'
import { buildNcmRequestOptions, buildNeteaseHeaderArgs } from './neteaseAuth.js'

const require = createRequire(import.meta.url)

function getNcmApi() {
  return require('@neteasecloudmusicapienhanced/api')
}

function formatNcmError(err) {
  if (!err || typeof err !== 'object') return String(err)
  const msg = err.body?.msg || err.body?.message
  if (msg) return String(msg)
  if (err.status && err.status !== 200) return `Request failed (HTTP ${err.status})`
  return 'NetEase Cloud Music API request failed'
}

export function parseNeteasePlaylistId(input) {
  if (input == null) return null
  const s = String(input).trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return s
  try {
    const normalized = s.includes('://') ? s : `https://${s}`
    const u = new URL(normalized)
    const directId = u.searchParams.get('id')
    if (directId && /^\d+$/.test(directId)) return directId
    const pathMatch = u.pathname.match(/\/playlist\/(\d+)/)
    if (pathMatch) return pathMatch[1]
    if (u.hash) {
      const hashQuery = u.hash.includes('?') ? u.hash.slice(u.hash.indexOf('?') + 1) : ''
      const q = new URLSearchParams(hashQuery)
      const hashId = q.get('id')
      if (hashId && /^\d+$/.test(hashId)) return hashId
    }
  } catch {
    // fall through
  }
  const m = /[?&]id=(\d+)/.exec(s)
  return m ? m[1] : null
}

export async function fetchNeteasePlaylistMeta(playlistId, opts = {}) {
  const ncm = getNcmApi()
  const base = buildNcmRequestOptions(opts.cookie)

  let detail
  try {
    detail = await ncm.playlist_detail({
      id: playlistId,
      ...base
    })
  } catch (err) {
    throw new Error(formatNcmError(err))
  }

  const playlist = detail.body?.playlist
  if (!playlist) {
    throw new Error(
      'Playlist not found or inaccessible (private or removed; try signing in to NetEase again).'
    )
  }

  const name = playlist.name || 'NetEase Playlist'

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
    songs = playlist.tracks || []
    if (songs.length === 0) {
      throw new Error(formatNcmError(err))
    }
  }

  const tracks = songs.map((track) => ({
    id: track.id,
    name: (track.name && String(track.name).trim()) || 'Unknown',
    artists: (track.ar || [])
      .map((artist) => artist.name)
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

function sanitizeFolderName(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return cleaned || 'Imported playlist'
}

function ensurePlaylistFolder(baseDir, folderName) {
  const resolved = join(baseDir, sanitizeFolderName(folderName))
  fs.mkdirSync(resolved, { recursive: true })
  return resolved
}

function buildTrackFilename(track) {
  const title = String(track?.name || '').trim()
  const artists = String(track?.artists || '').trim()
  if (artists && title) return `${artists} - ${title}`
  return title || `nm_${track?.id || 'track'}`
}

export async function importNeteasePlaylist(
  playlistInput,
  downloadFolder,
  eventSender,
  preferredFolderName = null,
  opts = {}
) {
  const playlistId = parseNeteasePlaylistId(playlistInput)
  if (!playlistId) {
    throw new Error('Invalid playlist URL or ID')
  }
  if (!downloadFolder || !fs.existsSync(downloadFolder)) {
    throw new Error('Invalid save folder; choose a valid directory in Settings.')
  }

  const meta = await fetchNeteasePlaylistMeta(playlistId, opts)
  const targetFolder = ensurePlaylistFolder(downloadFolder, preferredFolderName || meta.name)
  const total = meta.tracks.length

  eventSender.send('playlist-link:import-progress', {
    phase: 'meta',
    playlistName: meta.name,
    total
  })

  if (total === 0) {
    return { playlistName: meta.name, added: [], failed: [] }
  }

  const extraArgs = [...buildNeteaseHeaderArgs(opts.cookie), ...ytDlpExtraArgs()]
  const added = []
  const failed = []

  for (let i = 0; i < meta.tracks.length; i++) {
    const track = meta.tracks[i]
    const songUrl = `https://music.163.com/song?id=${track.id}`

    eventSender.send('playlist-link:import-progress', {
      phase: 'download',
      current: i + 1,
      total,
      trackName: track.name,
      artists: track.artists
    })

    const basename = `nm_${track.id}`
    try {
      const downloadedPath = await MediaDownloader.downloadAudioWithBasename(
        songUrl,
        targetFolder,
        basename,
        eventSender,
        { extraArgs, quickMode: opts.quickMode === true }
      )
      const filePath = MediaDownloader.renameDownloadedMedia(
        downloadedPath,
        buildTrackFilename(track)
      )
      const item = { path: filePath, trackTitle: track.name, sourceUrl: songUrl }
      added.push(item)
      eventSender.send('playlist-link:import-progress', {
        phase: 'added',
        playlistName: meta.name,
        ...item
      })
    } catch (error) {
      failed.push({
        name: track.name,
        error: error.message || String(error)
      })
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  return {
    playlistName: meta.name,
    added,
    failed
  }
}
