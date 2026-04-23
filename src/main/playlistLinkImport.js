import { spawn } from 'child_process'
import { join, extname } from 'path'
import fs from 'fs'
import { getResolvedFfmpegStaticPath } from './utils/resolveFfmpegStaticPath.js'
import youtubedl from 'youtube-dl-exec'
import MediaDownloader from './MediaDownloader.js'
import { importNeteasePlaylist, parseNeteasePlaylistId } from './neteasePlaylist.js'

const ytDlpBinaryPath = youtubedl.constants.YOUTUBE_DL_PATH.replace('app.asar', 'app.asar.unpacked')

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.opus', '.flac', '.ogg', '.wav', '.webm'])

function isAudioFilename(name) {
  return AUDIO_EXT.has(extname(name).toLowerCase())
}

function ytDlpExtraFromEnv() {
  return process.env.ECHOES_YTDLP_EXTRA
    ? process.env.ECHOES_YTDLP_EXTRA.split(/\s+/).filter(Boolean)
    : []
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

function deriveFolderNameFromInput(input) {
  const raw = String(input || '').trim()
  if (!raw) return 'Imported playlist'
  try {
    const parsed = new URL(raw)
    const lastPath = parsed.pathname.split('/').filter(Boolean).pop()
    return sanitizeFolderName(lastPath || parsed.hostname || 'Imported playlist')
  } catch {
    return sanitizeFolderName(raw)
  }
}

/**
 * 是否为网易云歌单链接（走专用 API + 逐首下载）
 */
function looksLikeNetEasePlaylistInput(raw) {
  const s = String(raw || '').trim()
  if (!s) return false
  if (/^\d+$/.test(s)) return true
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`)
    return /163\.com|music\.163/i.test(u.hostname)
  } catch {
    return false
  }
}

function runYtDlpDumpJson(url) {
  return new Promise((resolve, reject) => {
    const p = spawn(ytDlpBinaryPath, [
      '-J',
      '--no-warnings',
      '--skip-download',
      '--socket-timeout',
      '30',
      url
    ])
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => {
      out += d.toString()
    })
    p.stderr.on('data', (d) => {
      err += d.toString()
    })
    p.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || 'Could not read that link.'))
        return
      }
      try {
        resolve(JSON.parse(out))
      } catch (e) {
        reject(new Error('Could not parse playlist info.'))
      }
    })
  })
}

function extractEntries(json) {
  if (!json || typeof json !== 'object') return []
  if (Array.isArray(json.entries) && json.entries.length > 0) {
    return json.entries
  }
  if (json._type === 'playlist' && Array.isArray(json.entries)) {
    return json.entries
  }
  if (json.id != null && (json.url || json.webpage_url)) {
    return [json]
  }
  return []
}

function isPlaylistLike(json) {
  return !!(
    json &&
    typeof json === 'object' &&
    (json._type === 'playlist' || (Array.isArray(json.entries) && json.entries.length > 0))
  )
}

function entryPlaybackUrl(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (typeof entry.webpage_url === 'string' && entry.webpage_url.trim()) return entry.webpage_url
  if (typeof entry.original_url === 'string' && entry.original_url.trim()) return entry.original_url
  if (typeof entry.url === 'string' && /^https?:\/\//i.test(entry.url.trim())) return entry.url
  return null
}

function buildTrackFilename(entry, fallbackTitle, fallbackIndex) {
  const title = String(fallbackTitle || entry?.title || entry?.track || '').trim()
  const artist = String(entry?.artist || entry?.uploader || entry?.channel || '').trim()
  if (artist && title) return `${artist} - ${title}`
  return title || `track_${fallbackIndex}`
}

/**
 * 逐条 URL 下载（Spotify / SoundCloud / Tidal 等由 yt-dlp 支持的链接）
 */
async function importByYtDlpEntryLoop(url, folder, eventSender, metaJson, options = {}) {
  const entries = extractEntries(metaJson)
  const playlistLike = isPlaylistLike(metaJson)
  const playlistName =
    metaJson.title || metaJson.playlist || metaJson.playlist_title || 'Imported playlist'
  const total = entries.length

  eventSender.send('playlist-link:import-progress', {
    phase: 'meta',
    playlistName,
    total
  })

  if (total === 0) {
    return { playlistName, added: [], failed: [] }
  }

  const extraArgs = ytDlpExtraFromEnv()
  const added = []
  const failed = []

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const playlistItem =
      Number.isFinite(e?.playlist_index) && e.playlist_index > 0 ? e.playlist_index : i + 1
    const trackUrl = playlistLike ? url : entryPlaybackUrl(e) || url
    const sourceUrl = entryPlaybackUrl(e) || trackUrl
    const trackName = e.title || e.track || `Track ${i + 1}`

    if (!trackUrl) {
      failed.push({
        name: trackName,
        error: 'No playable URL in catalog response'
      })
      continue
    }

    eventSender.send('playlist-link:import-progress', {
      phase: 'download',
      current: i + 1,
      total,
      trackName
    })

    const basename = `lk_${i}_${e.id != null ? e.id : i}`
    const perTrackArgs = playlistLike
      ? [...extraArgs, '--yes-playlist', '--playlist-items', String(playlistItem)]
      : extraArgs
    try {
      const downloadedPath = await MediaDownloader.downloadAudioWithBasename(
        trackUrl,
        folder,
        basename,
        eventSender,
        { extraArgs: perTrackArgs, quickMode: options.quickMode === true }
      )
      const filePath = MediaDownloader.renameDownloadedMedia(
        downloadedPath,
        buildTrackFilename(e, trackName, i + 1)
      )
      const item = { path: filePath, trackTitle: trackName, sourceUrl }
      added.push(item)
      eventSender.send('playlist-link:import-progress', {
        phase: 'added',
        playlistName,
        ...item
      })
    } catch (err) {
      failed.push({
        name: trackName,
        error: err.message || String(err)
      })
    }

    await new Promise((r) => setTimeout(r, 200))
  }

  return { playlistName, added, failed }
}

/**
 * 整包拉取（条目无法逐条解析时的兜底）
 */
async function importByYtDlpBulk(url, folder, eventSender, hintName, options = {}) {
  const ffmpegPath = getResolvedFfmpegStaticPath()
  let before
  try {
    before = new Set(fs.readdirSync(folder))
  } catch {
    before = new Set()
  }

  const extraArgs = ytDlpExtraFromEnv()
  const args = [
    url,
    '-x',
    '--extract-audio',
    '-f',
    'bestaudio/best',
    '--audio-quality',
    '0',
    ...(options.quickMode === true ? [] : ['--embed-thumbnail', '--add-metadata']),
    '-o',
    join(folder, 'import_%(playlist_index)s_%(id)s.%(ext)s'),
    '--ffmpeg-location',
    ffmpegPath,
    '--yes-playlist',
    '--ignore-errors',
    '--no-abort-on-error',
    ...extraArgs
  ]

  const addedFiles = await new Promise((resolve, reject) => {
    const p = spawn(ytDlpBinaryPath, args)
    let err = ''
    p.stdout.on('data', (data) => {
      const text = data.toString()
      const match = text.match(/\[download\]\s+([\d.]+)%/)
      if (match && match[1] && eventSender) {
        const progress = parseFloat(match[1])
        eventSender.send('playlist-link:import-progress', {
          phase: 'bulk',
          progress,
          message: 'Downloading…'
        })
      }
    })
    p.stderr.on('data', (d) => {
      err += d.toString()
    })
    p.on('close', (code) => {
      let after
      try {
        after = fs.readdirSync(folder)
      } catch {
        after = []
      }
      const next = []
      for (const name of after) {
        if (before.has(name)) continue
        if (!isAudioFilename(name)) continue
        const item = {
          path: join(folder, name),
          trackTitle: name
        }
        next.push(item)
        if (eventSender) {
          eventSender.send('playlist-link:import-progress', {
            phase: 'added',
            playlistName: hintName || 'Imported playlist',
            ...item
          })
        }
      }
      if (next.length > 0) {
        resolve(next)
        return
      }
      if (code !== 0) {
        reject(new Error(err.trim() || 'Download failed.'))
        return
      }
      resolve([])
    })
  })

  return {
    playlistName: hintName || 'Imported playlist',
    added: addedFiles,
    failed: []
  }
}

/**
 * 从用户粘贴的链接导入歌单：网易云走专用逻辑，其余交给 yt-dlp（含 Spotify / SoundCloud / Tidal 等，取决于 yt-dlp 与网络环境）。
 */
export async function importPlaylistFromLink(
  rawInput,
  downloadFolder,
  eventSender,
  preferredFolderName = null,
  options = {}
) {
  if (!downloadFolder || !fs.existsSync(downloadFolder)) {
    throw new Error('Invalid save folder; choose a valid directory in Settings.')
  }

  const trimmed = String(rawInput || '').trim()
  if (!trimmed) {
    throw new Error('Paste a link first.')
  }

  if (looksLikeNetEasePlaylistInput(trimmed) && parseNeteasePlaylistId(trimmed)) {
    return importNeteasePlaylist(trimmed, downloadFolder, eventSender, preferredFolderName, options)
  }

  const normalized = trimmed.includes('://') ? trimmed : `https://${trimmed}`

  let metaJson
  try {
    metaJson = await runYtDlpDumpJson(normalized)
  } catch {
    const fallbackFolder = ensurePlaylistFolder(
      downloadFolder,
      preferredFolderName || deriveFolderNameFromInput(normalized)
    )
    return importByYtDlpBulk(
      normalized,
      fallbackFolder,
      eventSender,
      preferredFolderName || null,
      options
    )
  }

  const entries = extractEntries(metaJson)
  const playlistName = metaJson.title || metaJson.playlist || metaJson.playlist_title || null
  const targetFolder = ensurePlaylistFolder(
    downloadFolder,
    preferredFolderName || playlistName || deriveFolderNameFromInput(normalized)
  )

  if (entries.length === 0) {
    return importByYtDlpBulk(normalized, targetFolder, eventSender, playlistName, options)
  }

  try {
    return await importByYtDlpEntryLoop(normalized, targetFolder, eventSender, metaJson, options)
  } catch {
    return importByYtDlpBulk(normalized, targetFolder, eventSender, playlistName, options)
  }
}
