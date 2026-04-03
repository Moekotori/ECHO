import { spawn } from 'child_process'
import { join } from 'path'
import fs from 'fs'
import { getResolvedFfmpegStaticPath } from './utils/resolveFfmpegStaticPath.js'
import youtubedl from 'youtube-dl-exec'

const ytDlpBinaryPath = youtubedl.constants.YOUTUBE_DL_PATH.replace('app.asar', 'app.asar.unpacked')

const AUDIO_EXT_CANDIDATES = ['.mp3', '.m4a', '.aac', '.opus', '.flac', '.ogg', '.wav', '.webm']

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

export default class MediaDownloader {
  static getMetadata(url) {
    return new Promise((resolve, reject) => {
      const p = spawn(ytDlpBinaryPath, ['--dump-json', url])

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
            const result = JSON.parse(out)
            resolve({
              title: result.title,
              thumbnail: result.thumbnail,
              duration: result.duration,
              artist: result.uploader || result.artist
            })
          } catch (e) {
            reject(new Error('Failed to parse metadata JSON'))
          }
        } else {
          reject(new Error(err || 'Failed to get metadata'))
        }
      })
    })
  }

  static downloadAudio(url, targetFolder, eventSender, options = {}) {
    return new Promise((resolve, reject) => {
      const ffmpegPath = getResolvedFfmpegStaticPath()
      const audioFormat = buildAudioFormatByPreset(options.audioQualityPreset)
      const cookie = String(options.neteaseCookie || '').trim()
      const extraArgs = []
      if (cookie && isNeteaseUrl(url)) {
        extraArgs.push('--add-header', `Cookie: ${cookie}`)
        extraArgs.push('--add-header', 'Referer: https://music.163.com/')
        extraArgs.push(
          '--add-header',
          'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        )
      }

      const args = [
        url,
        '-x',
        '--extract-audio',
        '-f',
        audioFormat,
        '--audio-quality',
        '0',
        '--embed-thumbnail',
        '--add-metadata',
        '--write-info-json',
        '-o',
        `${targetFolder}/%(title)s.%(ext)s`,
        '--ffmpeg-location',
        ffmpegPath,
        ...extraArgs
      ]

      const p = spawn(ytDlpBinaryPath, args)

      let err = ''

      p.stdout.on('data', (data) => {
        const text = data.toString()
        // Match [download] 12.3%
        const match = text.match(/\[download\]\s+([\d.]+)%/)
        if (match && match[1]) {
          const progress = parseFloat(match[1])
          if (eventSender) {
            eventSender.send('media:download-progress', { url, progress })
          }
        }
      })

      p.stderr.on('data', (data) => {
        err += data.toString()
      })

      p.on('close', (code) => {
        if (code === 0) {
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
      const ffmpegPath = getResolvedFfmpegStaticPath()
      const outputPattern = join(targetFolder, `${basenameNoExt}.%(ext)s`)
      const extraArgs = options.extraArgs || []

      const args = [
        url,
        '-x',
        '--extract-audio',
        '-f',
        'bestaudio/best',
        '--audio-quality',
        '0',
        '--embed-thumbnail',
        '--add-metadata',
        '--write-info-json',
        '-o',
        outputPattern,
        '--ffmpeg-location',
        ffmpegPath,
        ...extraArgs
      ]

      const p = spawn(ytDlpBinaryPath, args)

      let err = ''

      p.stdout.on('data', (data) => {
        const text = data.toString()
        const match = text.match(/\[download\]\s+([\d.]+)%/)
        if (match && match[1]) {
          const progress = parseFloat(match[1])
          if (eventSender) {
            eventSender.send('media:download-progress', { url, progress })
          }
        }
      })

      p.stderr.on('data', (data) => {
        err += data.toString()
      })

      p.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(err || 'Download failed'))
          return
        }
        const resolved = findResolvedAudioPath(targetFolder, basenameNoExt)
        if (!resolved) {
          reject(new Error('Download finished but output file not found'))
          return
        }
        resolve(resolved)
      })
    })
  }
}
