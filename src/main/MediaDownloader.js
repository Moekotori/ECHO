import { spawn } from 'child_process'
import { join, dirname, basename, extname } from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import { getResolvedFfmpegStaticPath } from './utils/resolveFfmpegStaticPath.js'
import { buildNeteaseHeaderArgs } from './neteaseAuth.js'
import youtubedl from 'youtube-dl-exec'

const ytDlpBinaryPath = youtubedl.constants.YOUTUBE_DL_PATH.replace('app.asar', 'app.asar.unpacked')

const AUDIO_EXT_CANDIDATES = ['.mp3', '.m4a', '.aac', '.opus', '.flac', '.ogg', '.wav', '.webm']
const SIDECAR_SUFFIXES = ['.info.json', '.lrc']
const METADATA_CACHE_TTL_MS = 5 * 60 * 1000
const metadataCache = new Map()
const metadataPending = new Map()

function readTimedCache(cache, key, ttlMs) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > ttlMs) {
    cache.delete(key)
    return null
  }
  return hit.value
}

function writeTimedCache(cache, key, value) {
  cache.set(key, { value, at: Date.now() })
  return value
}

function pickThumbnail(entity) {
  if (!entity || typeof entity !== 'object') return null
  if (typeof entity.thumbnail === 'string' && entity.thumbnail.trim()) return entity.thumbnail
  if (Array.isArray(entity.thumbnails)) {
    for (let i = entity.thumbnails.length - 1; i >= 0; i--) {
      const candidate = entity.thumbnails[i]
      if (candidate?.url) return candidate.url
    }
  }
  return null
}

function extractMetadata(json) {
  if (!json || typeof json !== 'object') {
    throw new Error('Metadata payload is empty')
  }

  const entries = Array.isArray(json.entries)
    ? json.entries.filter((entry) => entry && typeof entry === 'object')
    : []
  const primary = entries[0] || json
  const itemCount =
    entries.length ||
    (Number.isFinite(json.playlist_count) && json.playlist_count > 0 ? json.playlist_count : 0) ||
    1
  const isCollection =
    entries.length > 0 || json._type === 'playlist' || json._type === 'multi_video' || itemCount > 1

  const collectionTitle =
    json.title || json.playlist || json.playlist_title || json.series || json.album || null
  const entryTitle = primary.title || primary.fulltitle || primary.alt_title || null
  const title =
    (isCollection ? collectionTitle || entryTitle : entryTitle || collectionTitle) ||
    'Unknown title'

  const thumbnail = pickThumbnail(json) || pickThumbnail(primary) || null
  const duration =
    Number.isFinite(json.duration) && json.duration > 0
      ? json.duration
      : Number.isFinite(primary.duration) && primary.duration > 0
        ? primary.duration
        : null
  const artist =
    primary.uploader ||
    primary.artist ||
    primary.channel ||
    json.uploader ||
    json.artist ||
    json.channel ||
    null

  return {
    title,
    thumbnail,
    duration,
    artist,
    isCollection,
    itemCount
  }
}

function findResolvedAudioPath(targetFolder, basenameNoExt) {
  for (const ext of AUDIO_EXT_CANDIDATES) {
    const p = join(targetFolder, `${basenameNoExt}${ext}`)
    if (fs.existsSync(p)) return p
  }
  try {
    const files = fs.readdirSync(targetFolder)
    const hit = files.find(
      (f) =>
        f.startsWith(`${basenameNoExt}.`) &&
        !f.endsWith('.info.json') &&
        !f.endsWith('.jpg') &&
        !f.endsWith('.webp') &&
        !f.endsWith('.png')
    )
    if (hit) return join(targetFolder, hit)
  } catch (_) {}
  return null
}

function sanitizeFilenameStem(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return cleaned || 'track'
}

function buildUniquePath(dir, stem, ext) {
  let nextStem = sanitizeFilenameStem(stem)
  let candidate = join(dir, `${nextStem}${ext}`)
  let index = 2
  while (fs.existsSync(candidate)) {
    nextStem = `${sanitizeFilenameStem(stem)} (${index})`
    candidate = join(dir, `${nextStem}${ext}`)
    index += 1
  }
  return candidate
}

function buildAudioFormatByPreset(preset) {
  const p = String(preset || 'auto').toLowerCase()
  if (p === 'lossless') return 'bestaudio[acodec*=flac]/bestaudio[ext=flac]/bestaudio/best'
  if (p === 'high') return 'bestaudio[abr<=320]/bestaudio/best'
  if (p === 'medium') return 'bestaudio[abr<=192]/bestaudio[abr<=160]/bestaudio/best'
  if (p === 'low') return 'bestaudio[abr<=128]/bestaudio[abr<=96]/worstaudio'
  return 'bestaudio/best'
}

function isNeteaseUrl(url) {
  return /music\.163\.com|126\.net|netease|interface\.music\.163/i.test(String(url || ''))
}

function isBilibiliSinglePartUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return false
  try {
    const parsed = new URL(raw)
    if (!/(\.|^)bilibili\.com$/i.test(parsed.hostname)) return false
    if (!/\/video\//i.test(parsed.pathname)) return false
    const p = Number(parsed.searchParams.get('p'))
    return Number.isInteger(p) && p > 0
  } catch {
    return false
  }
}

function extractProgressPercent(text = '') {
  const match = String(text || '').match(/\[download\]\s+([\d.]+)%/)
  if (!match?.[1]) return null
  const progress = parseFloat(match[1])
  return Number.isFinite(progress) ? progress : null
}

function buildYtDlpAudioArgs(url, outputPattern, options = {}) {
  const ffmpegPath = getResolvedFfmpegStaticPath()
  const audioFormat = buildAudioFormatByPreset(options.audioQualityPreset)
  const cookie = String(options.neteaseCookie || '').trim()
  const extraArgs = Array.isArray(options.extraArgs) ? [...options.extraArgs] : []
  const forceSinglePartArgs = isBilibiliSinglePartUrl(url) ? ['--no-playlist'] : []
  const quickMode = options.quickMode === true

  if (cookie && isNeteaseUrl(url)) {
    extraArgs.push(...buildNeteaseHeaderArgs(cookie))
  }

  const postProcessArgs = quickMode
    ? []
    : ['--embed-thumbnail', '--add-metadata', '--write-info-json']

  return {
    args: [
      url,
      '-x',
      '--extract-audio',
      '-f',
      audioFormat,
      '--audio-quality',
      '0',
      ...postProcessArgs,
      '-o',
      outputPattern,
      '--ffmpeg-location',
      ffmpegPath,
      ...forceSinglePartArgs,
      ...extraArgs
    ],
    quickMode
  }
}

function logDownloadStageSummary(url, totalStartedAt, downloadCompletedAt, postProcessStartedAt, quickMode) {
  const finishedAt = Date.now()
  const downloadEnd = downloadCompletedAt || finishedAt
  const postProcessStart = postProcessStartedAt || downloadEnd
  const downloadMs = Math.max(0, downloadEnd - totalStartedAt)
  const postProcessMs = Math.max(0, finishedAt - postProcessStart)
  const totalMs = Math.max(0, finishedAt - totalStartedAt)
  console.log(
    `[MediaDownloader] download finished (${quickMode ? 'quick' : 'full'}) ${url} | network=${downloadMs}ms | post=${postProcessMs}ms | total=${totalMs}ms`
  )
}

export default class MediaDownloader {
  static getMetadata(url) {
    const normalizedUrl = String(url || '').trim()
    const cached = readTimedCache(metadataCache, normalizedUrl, METADATA_CACHE_TTL_MS)
    if (cached) {
      console.log(`[MediaDownloader] metadata cache hit: ${normalizedUrl}`)
      return Promise.resolve(cached)
    }

    const pending = metadataPending.get(normalizedUrl)
    if (pending) {
      console.log(`[MediaDownloader] metadata awaiting in-flight request: ${normalizedUrl}`)
      return pending
    }

    const startedAt = Date.now()
    const task = new Promise((resolve, reject) => {
      const forceSinglePartArgs = isBilibiliSinglePartUrl(normalizedUrl) ? ['--no-playlist'] : []
      const p = spawn(ytDlpBinaryPath, [
        '-J',
        '--no-warnings',
        '--skip-download',
        '--socket-timeout',
        '30',
        ...forceSinglePartArgs,
        normalizedUrl
      ])

      let out = ''
      let err = ''

      p.stdout.on('data', (data) => {
        out += data.toString()
      })

      p.stderr.on('data', (data) => {
        err += data.toString()
      })

      p.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(out.trim())
            const metadata = extractMetadata(result)
            writeTimedCache(metadataCache, normalizedUrl, metadata)
            console.log(
              `[MediaDownloader] metadata fetched: ${normalizedUrl} | total=${Date.now() - startedAt}ms`
            )
            resolve(metadata)
          } catch (e) {
            reject(new Error('Failed to parse metadata JSON'))
          }
        } else {
          reject(new Error(err || 'Failed to get metadata'))
        }
      })
    })
    metadataPending.set(normalizedUrl, task)
    return task.finally(() => {
      metadataPending.delete(normalizedUrl)
    })
  }

  static downloadAudio(url, targetFolder, eventSender, options = {}) {
    return new Promise((resolve, reject) => {
      const { args, quickMode } = buildYtDlpAudioArgs(url, `${targetFolder}/%(title)s.%(ext)s`, options)
      const startedAt = Date.now()
      let downloadCompletedAt = null
      let postProcessStartedAt = null

      const p = spawn(ytDlpBinaryPath, args)

      let err = ''

      const handleOutput = (data, isStdErr = false) => {
        const text = data.toString()
        const progress = extractProgressPercent(text)
        if (progress != null) {
          if (eventSender) {
            eventSender.send('media:download-progress', { url, progress })
          }
          if (progress >= 100 && !downloadCompletedAt) {
            downloadCompletedAt = Date.now()
          }
        }
        if (!postProcessStartedAt && /\[(ExtractAudio|Metadata|EmbedThumbnail|ffmpeg)\]/i.test(text)) {
          postProcessStartedAt = Date.now()
        }
        if (isStdErr) {
          err += text
        }
      }

      p.stdout.on('data', (data) => {
        handleOutput(data, false)
      })

      p.stderr.on('data', (data) => {
        handleOutput(data, true)
      })

      p.on('close', (code) => {
        if (code === 0) {
          logDownloadStageSummary(
            url,
            startedAt,
            downloadCompletedAt,
            postProcessStartedAt,
            quickMode
          )
          resolve()
        } else {
          reject(new Error(err || 'Download failed'))
        }
      })
    })
  }

  /**
   * 下载音频到固定文件名前缀（扩展名由 yt-dlp 决定），用于网易云等需预知输出路径的场景。
   */
  static downloadAudioWithBasename(url, targetFolder, basenameNoExt, eventSender, options = {}) {
    return new Promise((resolve, reject) => {
      const outputPattern = join(targetFolder, `${basenameNoExt}.%(ext)s`)
      const { args, quickMode } = buildYtDlpAudioArgs(url, outputPattern, options)
      const startedAt = Date.now()
      let downloadCompletedAt = null
      let postProcessStartedAt = null

      const p = spawn(ytDlpBinaryPath, args)

      let err = ''

      const handleOutput = (data, isStdErr = false) => {
        const text = data.toString()
        const progress = extractProgressPercent(text)
        if (progress != null) {
          if (eventSender) {
            eventSender.send('media:download-progress', { url, progress })
          }
          if (progress >= 100 && !downloadCompletedAt) {
            downloadCompletedAt = Date.now()
          }
        }
        if (!postProcessStartedAt && /\[(ExtractAudio|Metadata|EmbedThumbnail|ffmpeg)\]/i.test(text)) {
          postProcessStartedAt = Date.now()
        }
        if (isStdErr) {
          err += text
        }
      }

      p.stdout.on('data', (data) => {
        handleOutput(data, false)
      })

      p.stderr.on('data', (data) => {
        handleOutput(data, true)
      })

      p.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(err || 'Download failed'))
          return
        }
        logDownloadStageSummary(url, startedAt, downloadCompletedAt, postProcessStartedAt, quickMode)
        const resolved = findResolvedAudioPath(targetFolder, basenameNoExt)
        if (!resolved) {
          reject(new Error('Download finished but output file not found'))
          return
        }
        resolve(resolved)
      })
    })
  }

  static renameDownloadedMedia(filePath, desiredStem) {
    if (!filePath || !desiredStem) return filePath

    const trimmedStem = sanitizeFilenameStem(desiredStem)
    const dir = dirname(filePath)
    const currentExt = extname(filePath)
    const currentStem = basename(filePath, currentExt)
    if (!trimmedStem || trimmedStem === currentStem) return filePath

    const targetPath = buildUniquePath(dir, trimmedStem, currentExt)
    if (targetPath === filePath) return filePath

    fs.renameSync(filePath, targetPath)

    for (const suffix of SIDECAR_SUFFIXES) {
      const from = join(dir, `${currentStem}${suffix}`)
      if (!fs.existsSync(from)) continue
      const to = join(dir, `${basename(targetPath, currentExt)}${suffix}`)
      if (fs.existsSync(to)) continue
      fs.renameSync(from, to)
    }

    return targetPath
  }

  /**
   * 从直接 HTTP(S) URL 下载音频文件并保存到指定目录。
   * 自动跟随重定向，报告进度。
   * @param {string} url         直接下载链接
   * @param {string} targetFolder  保存目录
   * @param {string} filename     文件名（含扩展名，如 artist - title.mp3）
   * @param {object} eventSender  Electron webContents（可选，用于上报进度）
   * @returns {Promise<string>}   下载后的完整文件路径
   */
  static downloadFromUrl(url, targetFolder, filename, eventSender) {
    return new Promise((resolve, reject) => {
      const outPath = join(targetFolder, filename)
      const file = fs.createWriteStream(outPath)

      const doRequest = (reqUrl, redirectCount = 0) => {
        if (redirectCount > 5) {
          file.close()
          try {
            fs.unlinkSync(outPath)
          } catch (_) {}
          return reject(new Error('Too many redirects'))
        }
        const mod = reqUrl.startsWith('https') ? https : http
        mod
          .get(reqUrl, (res) => {
            // Follow redirects
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
              return doRequest(res.headers.location, redirectCount + 1)
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
              file.close()
              try {
                fs.unlinkSync(outPath)
              } catch (_) {}
              return reject(new Error(`HTTP ${res.statusCode}`))
            }
            const total = parseInt(res.headers['content-length'], 10)
            let downloaded = 0
            res.on('data', (chunk) => {
              downloaded += chunk.length
              file.write(chunk)
              if (total && eventSender) {
                const progress = Math.min(100, (downloaded / total) * 100)
                eventSender.send('media:download-progress', { url: reqUrl, progress })
              }
            })
            res.on('end', () => {
              file.end(() => resolve(outPath))
            })
            res.on('error', (e) => {
              file.close()
              try {
                fs.unlinkSync(outPath)
              } catch (_) {}
              reject(e)
            })
          })
          .on('error', (e) => {
            file.close()
            try {
              fs.unlinkSync(outPath)
            } catch (_) {}
            reject(e)
          })
      }
      doRequest(url)
    })
  }
}
