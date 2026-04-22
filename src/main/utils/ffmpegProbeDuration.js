import { spawn } from 'child_process'
import { getResolvedFfmpegStaticPath } from './resolveFfmpegStaticPath.js'

/**
 * Read container duration (seconds) via bundled ffmpeg -i (stderr).
 * Reliable for DSD / formats where music-metadata or the browser reports wrong length.
 */
export function getMediaDurationSeconds(filePath) {
  return new Promise((resolve) => {
    const ffmpegPath = getResolvedFfmpegStaticPath()
    if (!ffmpegPath || typeof filePath !== 'string' || !filePath.trim()) {
      resolve(0)
      return
    }
    const proc = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-i', filePath], {
      windowsHide: true
    })
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.stdout.on('data', () => {})
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, 15000)
    proc.on('error', () => {
      clearTimeout(timer)
      resolve(0)
    })
    proc.on('close', () => {
      clearTimeout(timer)
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
      if (!m) {
        resolve(0)
        return
      }
      const h = parseInt(m[1], 10)
      const min = parseInt(m[2], 10)
      const sec = parseFloat(m[3])
      if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(sec)) {
        resolve(0)
        return
      }
      resolve(h * 3600 + min * 60 + sec)
    })
  })
}
