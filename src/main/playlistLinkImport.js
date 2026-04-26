import { spawn } from 'child_process'
import { join, extname } from 'path'
import fs from 'fs'
import { getResolvedFfmpegStaticPath } from './utils/resolveFfmpegStaticPath.js'
import youtubedl from 'youtube-dl-exec'
import MediaDownloader, { buildYoutubeCookieArgs, buildYtDlpMetadataArgs } from './MediaDownloader.js'
import { importNeteasePlaylist, parseNeteasePlaylistId } from './neteasePlaylist.js'
import { getNeteaseSongDirectUrl, searchNeteaseSongs } from './neteaseLyrics.js'
import {
  getQqMusicPlaylistTracks,
  getQqMusicSongDirectUrl,
  searchQqMusicSongs
} from './qqMusicProvider.js'

const ytDlpBinaryPath = youtubedl.constants.YOUTUBE_DL_PATH.replace('app.asar', 'app.asar.unpacked')

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.opus', '.flac', '.ogg', '.wav', '.webm'])

function isAudioFilename(name) {
  return AUDIO_EXT.has(extname(name).toLowerCase())
}

function ytDlpExtraFromEnv(url = '', options = {}) {
  const envArgs = process.env.ECHOES_YTDLP_EXTRA
    ? process.env.ECHOES_YTDLP_EXTRA.split(/\s+/).filter(Boolean)
    : []
  return [...envArgs, ...buildYoutubeCookieArgs(url, options)]
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

function parseQqMusicPlaylistId(input) {
  const s = String(input || '').trim()
  if (!s) return null
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`)
    if (!/qq\.com$/i.test(u.hostname) && !/qq\.com\./i.test(u.hostname)) return null
    const direct =
      u.searchParams.get('id') ||
      u.searchParams.get('tid') ||
      u.searchParams.get('disstid') ||
      u.searchParams.get('dirid')
    if (direct && /^\d+$/.test(direct)) return direct
    const pathMatch = u.pathname.match(/(?:playlist|taoge|details\/taoge)(?:\.html)?\/?(\d+)/i)
    if (pathMatch) return pathMatch[1]
  } catch {
    // fall through
  }
  const m = /(?:id|tid|disstid|dirid)=(\d+)/i.exec(s)
  return m ? m[1] : null
}

function looksLikeQqMusicPlaylistInput(raw) {
  return !!parseQqMusicPlaylistId(raw)
}

function looksLikeSpotifyPlaylistInput(raw) {
  const s = String(raw || '').trim()
  if (!s) return false
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`)
    return /(^|\.)spotify\.com$/i.test(u.hostname) && /\/playlist\//i.test(u.pathname)
  } catch {
    return /open\.spotify\.com\/playlist\//i.test(s)
  }
}

function runYtDlpDumpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ytDlpBinaryPath, buildYtDlpMetadataArgs(url, options))
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

function sanitizeFilenameStem(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return cleaned || 'track'
}

function normalizeCatalogTrack(entry, index = 0) {
  const title = String(entry?.track || entry?.title || entry?.name || '').trim()
  const artist = String(entry?.artist || entry?.artists || entry?.uploader || entry?.channel || '').trim()
  const album = String(entry?.album || entry?.release_title || '').trim()
  const durationRaw = Number(entry?.duration || entry?.duration_ms || entry?.durationMs || 0)
  const durationMs = durationRaw > 0 && durationRaw < 10000 ? durationRaw * 1000 : durationRaw
  return {
    title: title || `Track ${index + 1}`,
    artist,
    album,
    durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    cover: entry?.thumbnail || entry?.cover || null,
    sourceUrl: entryPlaybackUrl(entry) || entry?.webpage_url || null
  }
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|（[^）]*）|【[^】]*】/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactMatchText(value) {
  return normalizeMatchText(value).replace(/\s+/g, '')
}

function tokenSet(value) {
  return new Set(normalizeMatchText(value).split(/\s+/).filter(Boolean))
}

function overlapRatio(a, b) {
  const left = tokenSet(a)
  const right = tokenSet(b)
  if (left.size === 0 || right.size === 0) return 0
  let hits = 0
  for (const token of left) {
    if (right.has(token)) hits++
  }
  return hits / Math.max(left.size, 1)
}

function versionIntentScore(inputTitle, candidateTitle) {
  const source = normalizeMatchText(inputTitle)
  const result = normalizeMatchText(candidateTitle)
  const rules = [
    ['live', '演唱会', '现场'],
    ['remix', 'rmx', '混音'],
    ['acoustic', '不插电'],
    ['instrumental', '伴奏', 'off vocal', 'karaoke'],
    ['cover', '翻唱']
  ]
  let score = 0
  for (const terms of rules) {
    const wants = terms.some((term) => source.includes(term))
    const has = terms.some((term) => result.includes(term))
    if (wants && has) score += 8
    else if (!wants && has) score -= 22
    else if (wants && !has) score -= 6
  }
  return score
}

function scoreSearchCandidate(track, candidate) {
  const sourceTitle = compactMatchText(track.title)
  const resultTitle = compactMatchText(candidate.name || candidate.title)
  const sourceArtist = track.artist || ''
  const resultArtist = candidate.artist || candidate.artists || ''
  const sourceAlbum = compactMatchText(track.album)
  const resultAlbum = compactMatchText(candidate.album)
  let score = 0

  if (sourceTitle && resultTitle) {
    if (sourceTitle === resultTitle) score += 70
    else if (sourceTitle.includes(resultTitle) || resultTitle.includes(sourceTitle)) score += 52
    else score += Math.round(overlapRatio(track.title, candidate.name || candidate.title) * 42)
  }

  if (sourceArtist && resultArtist) {
    const artistOverlap = overlapRatio(sourceArtist, resultArtist)
    const compactSourceArtist = compactMatchText(sourceArtist)
    const compactResultArtist = compactMatchText(resultArtist)
    if (compactSourceArtist && compactSourceArtist === compactResultArtist) score += 42
    else if (
      compactSourceArtist &&
      compactResultArtist &&
      (compactSourceArtist.includes(compactResultArtist) ||
        compactResultArtist.includes(compactSourceArtist))
    ) {
      score += 34
    } else {
      score += Math.round(artistOverlap * 36)
    }
  }

  if (sourceAlbum && resultAlbum) {
    if (sourceAlbum === resultAlbum) score += 16
    else if (sourceAlbum.includes(resultAlbum) || resultAlbum.includes(sourceAlbum)) score += 9
  }

  const sourceDuration = Number(track.durationMs || 0)
  const resultDuration = Number(candidate.duration || candidate.durationMs || 0)
  if (sourceDuration > 0 && resultDuration > 0) {
    const diffSec = Math.abs(sourceDuration - resultDuration) / 1000
    if (diffSec <= 3) score += 24
    else if (diffSec <= 8) score += 16
    else if (diffSec <= 20) score += 8
    else if (diffSec > 60) score -= 18
  }

  score += versionIntentScore(track.title, candidate.name || candidate.title)
  return score
}

function buildSearchQueries(track) {
  const title = String(track.title || '').trim()
  const artist = String(track.artist || '').trim()
  const album = String(track.album || '').trim()
  const queries = [
    [title, artist].filter(Boolean).join(' '),
    [artist, title].filter(Boolean).join(' '),
    [title, album, artist].filter(Boolean).join(' ')
  ]
  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))]
}

function providerOrderForTrack(sourceKind, preferredProvider) {
  const preferred = preferredProvider === 'qq' ? 'qq' : 'netease'
  if (sourceKind === 'qq') return ['qq', preferred === 'qq' ? 'netease' : preferred]
  return [preferred, preferred === 'qq' ? 'netease' : 'qq']
}

async function searchProvider(provider, query, options) {
  if (provider === 'qq') {
    return await searchQqMusicSongs(query, { cookie: options.qqCookie || '', limit: 12 })
  }
  return await searchNeteaseSongs(query, { cookie: options.cookie || '' })
}

async function findBestProviderMatch(track, sourceKind, options) {
  if (sourceKind === 'qq' && track.qqSong?.mid) {
    return { provider: 'qq', candidate: track.qqSong, score: 140 }
  }
  const order = providerOrderForTrack(sourceKind, options.downloadProvider)
  let best = null
  for (const provider of order) {
    for (const query of buildSearchQueries(track)) {
      let results = []
      try {
        results = await searchProvider(provider, query, options)
      } catch {
        results = []
      }
      for (const candidate of results || []) {
        const score = scoreSearchCandidate(track, candidate)
        if (!best || score > best.score) {
          best = { provider, candidate, score }
        }
      }
      if (best?.provider === provider && best.score >= 112) return best
    }
    if (best?.provider === provider && best.score >= 82) return best
  }
  return best && best.score >= 78 ? best : null
}

async function downloadMatchedTrack(match, track, targetFolder, index, eventSender, options) {
  const candidate = match.candidate
  const artist = candidate.artist || candidate.artists || track.artist || ''
  const title = candidate.name || candidate.title || track.title || `Track ${index + 1}`
  const stem = sanitizeFilenameStem(`${String(index + 1).padStart(2, '0')} - ${artist ? `${artist} - ` : ''}${title}`)
  let direct = null
  let filename = ''

  if (match.provider === 'qq') {
    direct = await getQqMusicSongDirectUrl(candidate, {
      qualityPreset: options.qualityPreset || 'auto',
      cookie: options.qqCookie || ''
    })
    if (!direct?.url) throw new Error('QQ Music did not return a playable link for this account.')
    filename = `${stem}.${direct.ext || direct.type || 'mp3'}`
  } else {
    direct = await getNeteaseSongDirectUrl(candidate.id, options.neteaseLevel || 'exhigh', {
      cookie: options.cookie || ''
    })
    if (!direct?.url) throw new Error('NetEase did not return a playable link for this account.')
    filename = `${stem}.${direct.type || 'mp3'}`
  }

  const filePath = await MediaDownloader.downloadFromUrl(
    direct.url,
    targetFolder,
    filename,
    eventSender,
    { headers: direct.headers || {} }
  )
  return {
    path: filePath,
    trackTitle: title,
    artist,
    album: candidate.album || track.album || '',
    cover: candidate.cover || track.cover || null,
    sourceUrl: track.sourceUrl || direct.url,
    provider: match.provider,
    matchScore: match.score
  }
}

async function importCatalogTracks(
  tracks,
  playlistName,
  targetFolder,
  eventSender,
  sourceKind,
  options = {}
) {
  const total = tracks.length
  const added = []
  const failed = []
  eventSender.send('playlist-link:import-progress', {
    phase: 'meta',
    playlistName,
    total
  })

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]
    eventSender.send('playlist-link:import-progress', {
      phase: 'download',
      current: i + 1,
      total,
      trackName: track.title,
      artists: track.artist || ''
    })
    try {
      const match = await findBestProviderMatch(track, sourceKind, options)
      if (!match) throw new Error('No high-confidence match found.')
      const item = await downloadMatchedTrack(match, track, targetFolder, i, eventSender, options)
      added.push(item)
      eventSender.send('playlist-link:import-progress', {
        phase: 'added',
        playlistName,
        ...item
      })
    } catch (error) {
      failed.push({
        name: track.artist ? `${track.artist} - ${track.title}` : track.title,
        error: error.message || String(error)
      })
    }
    await new Promise((resolve) => setTimeout(resolve, 180))
  }

  return { playlistName, added, failed }
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
    const extraArgs = ytDlpExtraFromEnv(trackUrl, options)
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

  const extraArgs = ytDlpExtraFromEnv(url, options)
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

  if (looksLikeQqMusicPlaylistInput(trimmed)) {
    const playlistId = parseQqMusicPlaylistId(trimmed)
    const meta = await getQqMusicPlaylistTracks({
      playlistId,
      cookie: options.qqCookie || ''
    })
    const targetFolder = ensurePlaylistFolder(
      downloadFolder,
      preferredFolderName || meta.name || 'QQ Music Playlist'
    )
    const tracks = (meta.tracks || []).map((song) => ({
      title: song.name,
      artist: song.artist || song.artists || '',
      album: song.album || '',
      durationMs: song.duration || 0,
      cover: song.cover || null,
      qqSong: song,
      sourceUrl: song.mid ? `https://y.qq.com/n/ryqq/songDetail/${song.mid}` : null
    }))
    return importCatalogTracks(
      tracks,
      meta.name || 'QQ Music Playlist',
      targetFolder,
      eventSender,
      'qq',
      options
    )
  }

  const normalized = trimmed.includes('://') ? trimmed : `https://${trimmed}`

  let metaJson
  try {
    metaJson = await runYtDlpDumpJson(normalized, options)
  } catch {
    if (looksLikeSpotifyPlaylistInput(trimmed)) {
      throw new Error('无法读取 Spotify 歌单曲目，请确认歌单是公开链接，或稍后重试。')
    }
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

  if (looksLikeSpotifyPlaylistInput(trimmed)) {
    const tracks = entries.map((entry, index) => normalizeCatalogTrack(entry, index))
    return importCatalogTracks(
      tracks,
      playlistName || preferredFolderName || 'Spotify Playlist',
      targetFolder,
      eventSender,
      'spotify',
      options
    )
  }

  try {
    return await importByYtDlpEntryLoop(normalized, targetFolder, eventSender, metaJson, options)
  } catch {
    return importByYtDlpBulk(normalized, targetFolder, eventSender, playlistName, options)
  }
}
