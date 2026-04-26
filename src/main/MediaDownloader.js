import { spawn } from 'child_process'
import { join, dirname, basename, extname } from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import axios from 'axios'
import { getResolvedFfmpegStaticPath } from './utils/resolveFfmpegStaticPath.js'
import { buildNeteaseHeaderArgs } from './neteaseAuth.js'
import youtubedl from 'youtube-dl-exec'

const ytDlpBinaryPath = youtubedl.constants.YOUTUBE_DL_PATH.replace('app.asar', 'app.asar.unpacked')

const AUDIO_EXT_CANDIDATES = ['.mp3', '.m4a', '.aac', '.opus', '.flac', '.ogg', '.wav', '.webm']
const SIDECAR_SUFFIXES = ['.info.json', '.lrc']
const INFO_JSON_SIDECAR_DIR = 'ECHO JSON'
const METADATA_CACHE_TTL_MS = 5 * 60 * 1000
const METADATA_PROCESS_TIMEOUT_MS = 25000
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

function buildUniqueSidecarPath(folder, filename) {
  let candidate = join(folder, filename)
  if (!fs.existsSync(candidate)) return candidate

  const ext = extname(filename)
  const stem = basename(filename, ext)
  for (let index = 2; index < 10000; index += 1) {
    candidate = join(folder, `${stem} (${index})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }

  return join(folder, `${stem}-${Date.now()}${ext}`)
}

function moveInfoJsonSidecars(targetFolder) {
  try {
    if (!targetFolder || !fs.existsSync(targetFolder)) return []
    const entries = fs.readdirSync(targetFolder, { withFileTypes: true })
    const infoFiles = entries
      .filter((entry) => entry.isFile() && /\.info\.json$/i.test(entry.name))
      .map((entry) => entry.name)

    if (infoFiles.length === 0) return []

    const sidecarFolder = join(targetFolder, INFO_JSON_SIDECAR_DIR)
    fs.mkdirSync(sidecarFolder, { recursive: true })

    const moved = []
    for (const filename of infoFiles) {
      const source = join(targetFolder, filename)
      const target = buildUniqueSidecarPath(sidecarFolder, filename)
      fs.renameSync(source, target)
      moved.push(target)
    }

    console.log(`[MediaDownloader] moved ${moved.length} info json sidecar(s) to ${sidecarFolder}`)
    return moved
  } catch (error) {
    console.warn('[MediaDownloader] failed to move info json sidecars:', error?.message || error)
    return []
  }
}

function pickThumbnail(entity) {
  if (!entity || typeof entity !== 'object') return null
  if (typeof entity.thumbnail === 'string' && entity.thumbnail.trim()) return entity.thumbnail
  if (Array.isArray(entity.thumbnails)) {
    const candidates = entity.thumbnails
      .filter((item) => typeof item?.url === 'string' && item.url.trim())
      .map((item, index) => {
        const url = item.url.trim()
        const width = Number(item.width || 0)
        const height = Number(item.height || 0)
        const area = width > 0 && height > 0 ? width * height : 0
        const isJpeg = /\.jpe?g(?:[?#]|$)/i.test(url)
        const isWebp = /\.webp(?:[?#]|$)/i.test(url)
        const isMaxRes = /maxresdefault/i.test(url)
        const isHq = /hq720|sddefault|hqdefault/i.test(url)
        return {
          url,
          score:
            area +
            (isJpeg ? 100000000 : 0) +
            (isMaxRes ? 50000000 : 0) +
            (isHq ? 10000000 : 0) -
            (isWebp ? 1000000 : 0) +
            index
        }
      })
      .sort((a, b) => b.score - a.score)
    return candidates[0]?.url || null
  }
  return null
}

function cleanYoutubeMusicTitlePart(value) {
  return String(value || '')
    .replace(/^[\s:：\-–—|/\\]+|[\s:：\-–—|/\\]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripYoutubeTitleDecorations(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''

  let previous = ''
  while (text && text !== previous) {
    previous = text
    text = text
      .replace(/^\s*(?:【[^】]{1,80}】|\[[^\]]{1,80}\]|\([^)]{1,80}\))\s*/g, '')
      .trim()
  }

  return text
    .replace(/\s*(?:【[^】]*(?:official|audio|video|mv|pv|music|bof|歌ってみた|cover)[^】]*】|\[[^\]]*(?:official|audio|video|mv|pv|music|bof|cover)[^\]]*\]|\([^)]*(?:official|audio|video|mv|pv|music|bof|cover)[^)]*\))\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function inferYoutubeMusicMetadataFromTitle(rawTitle) {
  const title = stripYoutubeTitleDecorations(rawTitle)
  if (!title) return null

  const slashMatch = title.match(/^(.+?)\s+[\/／]\s+(.+)$/)
  if (slashMatch) {
    const songTitle = cleanYoutubeMusicTitlePart(slashMatch[1])
    const artist = cleanYoutubeMusicTitlePart(slashMatch[2])
    if (songTitle && artist) return { title: songTitle, artist }
  }

  const hyphenMatch = title.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (hyphenMatch) {
    const artist = cleanYoutubeMusicTitlePart(hyphenMatch[1])
    const songTitle = cleanYoutubeMusicTitlePart(hyphenMatch[2])
    if (songTitle && artist) return { title: songTitle, artist }
  }

  const byMatch = title.match(/^(.+?)\s+by\s+(.+)$/i)
  if (byMatch) {
    const songTitle = cleanYoutubeMusicTitlePart(byMatch[1])
    const artist = cleanYoutubeMusicTitlePart(byMatch[2])
    if (songTitle && artist) return { title: songTitle, artist }
  }

  return { title, artist: null }
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
  const youtubeMusicMeta =
    !isCollection && isYouTubeUrl(primary.webpage_url || json.webpage_url || primary.original_url || json.original_url)
      ? inferYoutubeMusicMetadataFromTitle(title)
      : null

  const thumbnail = pickThumbnail(json) || pickThumbnail(primary) || null
  const duration =
    Number.isFinite(json.duration) && json.duration > 0
      ? json.duration
      : Number.isFinite(primary.duration) && primary.duration > 0
        ? primary.duration
        : null
  const artist =
    youtubeMusicMeta?.artist ||
    primary.artist ||
    json.artist ||
    primary.track_artist ||
    json.track_artist ||
    primary.creator ||
    json.creator ||
    primary.uploader ||
    primary.channel ||
    json.uploader ||
    json.channel ||
    null

  return {
    title: youtubeMusicMeta?.title || title,
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

function isSoundCloudUrl(url) {
  return /(^|\.)soundcloud\.com$/i.test(safeHostname(url))
}

function isYouTubeUrl(url) {
  return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(safeHostname(url))
}

function normalizeCookieBrowser(value) {
  const browser = String(value || 'edge').trim().toLowerCase()
  if (browser === 'chrome' || browser === 'edge' || browser === 'firefox') return browser
  if (browser === 'none' || browser === 'off' || browser === 'disabled') return 'none'
  return 'edge'
}

function normalizeCookieFile(value) {
  const filePath = String(value || '').trim()
  if (!filePath) return ''
  return fs.existsSync(filePath) ? filePath : ''
}

export function buildYoutubeCookieArgs(url, options = {}) {
  if (!isYouTubeUrl(url)) return []
  const cookieFile = normalizeCookieFile(options.youtubeCookieFile)
  if (cookieFile) return ['--cookies', cookieFile]
  const browser = normalizeCookieBrowser(options.youtubeCookieBrowser)
  if (browser === 'none') return []
  return ['--cookies-from-browser', browser]
}

function resolveNodeRuntimeArg() {
  const candidates = [
    process.env.npm_node_execpath,
    process.env.NODE,
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe'
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return `node:${candidate}`
    } catch (_) {}
  }
  return 'node'
}

function buildYoutubeChallengeArgs(url) {
  if (!isYouTubeUrl(url)) return []
  return ['--js-runtimes', resolveNodeRuntimeArg(), '--remote-components', 'ejs:github']
}

export function buildYtDlpMetadataArgs(url, options = {}) {
  const normalizedUrl = String(url || '').trim()
  const forceSinglePartArgs = isBilibiliSinglePartUrl(normalizedUrl) ? ['--no-playlist'] : []
  return [
    '-J',
    '--no-warnings',
    '--skip-download',
    '--socket-timeout',
    '30',
    '--ignore-no-formats-error',
    '-f',
    'bestaudio/best',
    ...buildYoutubeChallengeArgs(normalizedUrl),
    ...forceSinglePartArgs,
    ...buildYoutubeCookieArgs(normalizedUrl, options),
    normalizedUrl
  ]
}

function hasYoutubeCookieArgs(url, options = {}) {
  return buildYoutubeCookieArgs(url, options).length > 0
}

function safeHostname(url) {
  try {
    return new URL(String(url || '').trim()).hostname
  } catch {
    return ''
  }
}

async function getSoundCloudOembedMetadata(url) {
  try {
    const endpoint = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`
    const res = await axios.get(endpoint, { timeout: 15000 })
    const info = res.data || {}
    if (!info.title) throw new Error('SoundCloud metadata is empty')
    return {
      title: info.title,
      thumbnail: info.thumbnail_url || null,
      duration: null,
      artist: info.author_name || null,
      isCollection: false,
      itemCount: 1
    }
  } catch (error) {
    if (error?.response?.status === 404) {
      throw new Error('SoundCloud 链接不可用，可能已删除、私密或地址写错')
    }
    throw new Error(`SoundCloud 元数据解析失败：${error?.message || String(error)}`)
  }
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
  extraArgs.push(...buildYoutubeChallengeArgs(url))
  extraArgs.push(...buildYoutubeCookieArgs(url, options))

  const postProcessArgs = quickMode
    ? []
    : ['--convert-thumbnails', 'jpg', '--embed-thumbnail', '--add-metadata', '--write-info-json']

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
  static getMetadata(url, options = {}) {
    const normalizedUrl = String(url || '').trim()
    const cookieFile = normalizeCookieFile(options.youtubeCookieFile)
    const cacheKey = `${normalizedUrl}::yt-cookie-file=${cookieFile}::yt-browser=${normalizeCookieBrowser(options.youtubeCookieBrowser)}`
    const cached = readTimedCache(metadataCache, cacheKey, METADATA_CACHE_TTL_MS)
    if (cached) {
      console.log(`[MediaDownloader] metadata cache hit: ${normalizedUrl}`)
      return Promise.resolve(cached)
    }

    const pending = metadataPending.get(cacheKey)
    if (pending) {
      console.log(`[MediaDownloader] metadata awaiting in-flight request: ${normalizedUrl}`)
      return pending
    }

    const readMetadataJson = (metadataOptions, allowCookieRetry = true) => {
      return new Promise((resolve, reject) => {
        const startedAt = Date.now()
        const p = spawn(ytDlpBinaryPath, buildYtDlpMetadataArgs(normalizedUrl, metadataOptions))

        let out = ''
        let err = ''
        let settled = false
        const finish = (fn, value) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          fn(value)
        }

        const timeout = setTimeout(() => {
          try {
            p.kill()
          } catch (_) {}
          finish(reject, new Error('YouTube 解析超时，请稍后重试或重新保存登录状态'))
        }, METADATA_PROCESS_TIMEOUT_MS)

        p.stdout.on('data', (data) => {
          out += data.toString()
        })

        p.stderr.on('data', (data) => {
          err += data.toString()
        })

        p.on('error', (error) => {
          finish(reject, error)
        })

        p.on('close', async (code) => {
          if (settled) return
          if (code === 0) {
            try {
              const result = JSON.parse(out.trim())
              const metadata = extractMetadata(result)
              console.log(
                `[MediaDownloader] metadata fetched: ${normalizedUrl} | total=${Date.now() - startedAt}ms`
              )
              finish(resolve, metadata)
            } catch (e) {
              finish(reject, new Error('Failed to parse metadata JSON'))
            }
          } else if (
            allowCookieRetry &&
            isYouTubeUrl(normalizedUrl) &&
            hasYoutubeCookieArgs(normalizedUrl, metadataOptions)
          ) {
            console.warn(
              `[MediaDownloader] metadata cookie path failed, retrying without cookies: ${String(err || '').trim()}`
            )
            try {
              const metadata = await readMetadataJson(
                { ...metadataOptions, youtubeCookieBrowser: 'none', youtubeCookieFile: '' },
                false
              )
              finish(resolve, metadata)
            } catch (retryError) {
              finish(reject, retryError)
            }
          } else if (isSoundCloudUrl(normalizedUrl)) {
            try {
              const metadata = await getSoundCloudOembedMetadata(normalizedUrl)
              console.log(
                `[MediaDownloader] SoundCloud oEmbed metadata fetched: ${normalizedUrl} | total=${Date.now() - startedAt}ms`
              )
              finish(resolve, metadata)
            } catch (fallbackError) {
              finish(reject, fallbackError)
            }
          } else {
            finish(reject, new Error(err || 'Failed to get metadata'))
          }
        })
      })
    }

    const task = readMetadataJson(options).then((metadata) =>
      writeTimedCache(metadataCache, cacheKey, metadata)
    )
    metadataPending.set(cacheKey, task)
    return task.finally(() => {
      metadataPending.delete(cacheKey)
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
          moveInfoJsonSidecars(targetFolder)
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
        moveInfoJsonSidecars(targetFolder)
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
  static downloadFromUrl(url, targetFolder, filename, eventSender, options = {}) {
    return new Promise((resolve, reject) => {
      const outPath = join(targetFolder, filename)
      const file = fs.createWriteStream(outPath)
      const allowedHeaders = new Set(['Cookie', 'Referer', 'Origin', 'User-Agent'])
      const requestHeaders = {}
      const rawHeaders = options?.headers && typeof options.headers === 'object' ? options.headers : {}
      for (const [name, value] of Object.entries(rawHeaders)) {
        if (!allowedHeaders.has(name) || typeof value !== 'string' || !value.trim()) continue
        requestHeaders[name] = value
      }

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
          .get(reqUrl, { headers: requestHeaders }, (res) => {
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
