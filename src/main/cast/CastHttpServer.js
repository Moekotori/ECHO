import http from 'http'
import fs from 'fs'
import { basename, extname } from 'path'
import { pathToFileURL } from 'url'
import crypto from 'crypto'
import { getBestLanIPv4 } from './UpnpDiscovery.js'

const MIME_BY_EXT = {
  '.aac': 'audio/aac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.ape': 'audio/x-ape',
  '.dsf': 'audio/x-dsf',
  '.dff': 'audio/x-dff',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wv': 'audio/x-wavpack'
}

const IMAGE_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

function sanitizeToken(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '')
}

function mimeForPath(filePath) {
  return MIME_BY_EXT[extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream'
}

function imageMimeForPath(filePath) {
  return IMAGE_MIME_BY_EXT[extname(String(filePath || '')).toLowerCase()] || 'image/jpeg'
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i)
  if (!match) return null
  const mime = match[1] || 'application/octet-stream'
  const isBase64 = !!match[2]
  const body = match[3] || ''
  try {
    return {
      mime,
      buffer: isBase64 ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body))
    }
  } catch {
    return null
  }
}

function normalizeTrack(input) {
  const track = input && typeof input === 'object' ? input : {}
  const filePath = String(track.path || track.filePath || '').trim()
  const title = String(track.title || basename(filePath || 'Unknown Track')).trim()
  return {
    id: crypto.createHash('sha1').update(`${filePath}:${Date.now()}`).digest('hex').slice(0, 16),
    path: filePath,
    title,
    artist: String(track.artist || '').trim(),
    album: String(track.album || '').trim(),
    duration: Number(track.duration) || 0,
    codec: String(track.codec || '').trim(),
    sampleRateHz: Number(track.sampleRateHz || track.sampleRate || 0) || 0,
    bitDepth: Number(track.bitDepth || 0) || 0,
    bitrateKbps: Number(track.bitrateKbps || 0) || 0,
    cover: String(track.cover || track.coverUrl || track.coverPath || '').trim()
  }
}

export class CastHttpServer {
  constructor({ logLine = null } = {}) {
    this.logLine = typeof logLine === 'function' ? logLine : () => {}
    this.server = null
    this.port = 0
    this.host = getBestLanIPv4()
    this.tracks = new Map()
    this.covers = new Map()
  }

  async start() {
    if (this.server) return this.getStatus()
    this.host = getBestLanIPv4()
    this.server = http.createServer((req, res) => this.handleRequest(req, res))
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '0.0.0.0', () => {
        this.server.removeListener('error', reject)
        this.port = this.server.address().port
        resolve()
      })
    })
    this.logLine(`[CastOut] HTTP server listening on ${this.host}:${this.port}`)
    return this.getStatus()
  }

  async stop() {
    const server = this.server
    this.server = null
    this.port = 0
    this.tracks.clear()
    this.covers.clear()
    if (!server) return { ok: true }
    await new Promise((resolve) => {
      try {
        server.close(() => resolve())
      } catch {
        resolve()
      }
    })
    return { ok: true }
  }

  getStatus() {
    return {
      ok: true,
      running: !!this.server,
      host: this.host,
      port: this.port,
      baseUrl: this.server ? `http://${this.host}:${this.port}` : ''
    }
  }

  async exposeTrack(trackInput) {
    await this.start()
    const track = normalizeTrack(trackInput)
    if (!track.path || !fs.existsSync(track.path)) {
      throw new Error('Cast source file is not available on local disk')
    }
    const stat = fs.statSync(track.path)
    if (!stat.isFile()) throw new Error('Cast source path is not a file')
    track.size = stat.size
    track.mime = mimeForPath(track.path)
    this.tracks.set(track.id, track)

    let coverUrl = ''
    const coverInfo = this.prepareCover(track)
    if (coverInfo) {
      this.covers.set(track.id, coverInfo)
      coverUrl = `http://${this.host}:${this.port}/cover/${encodeURIComponent(track.id)}`
    } else if (/^https?:\/\//i.test(track.cover)) {
      coverUrl = track.cover
    }

    const streamUrl = `http://${this.host}:${this.port}/media/${encodeURIComponent(
      track.id
    )}/${encodeURIComponent(basename(track.path))}`
    return {
      ...track,
      fileUrl: pathToFileURL(track.path).href,
      streamUrl,
      coverUrl,
      protocolInfo: `http-get:*:${track.mime}:*`
    }
  }

  prepareCover(track) {
    if (!track.cover) return null
    if (/^data:image\//i.test(track.cover)) {
      const parsed = parseDataUrl(track.cover)
      if (!parsed?.buffer?.length) return null
      return { type: 'buffer', mime: parsed.mime, buffer: parsed.buffer }
    }
    if (/^https?:\/\//i.test(track.cover)) return null
    if (fs.existsSync(track.cover)) {
      const stat = fs.statSync(track.cover)
      if (stat.isFile()) {
        return { type: 'file', mime: imageMimeForPath(track.cover), path: track.cover, size: stat.size }
      }
    }
    return null
  }

  handleRequest(req, res) {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
      if (url.pathname.startsWith('/media/')) return this.handleMedia(url, req, res)
      if (url.pathname.startsWith('/cover/')) return this.handleCover(url, req, res)
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(error?.message || String(error))
    }
  }

  handleMedia(url, req, res) {
    const id = sanitizeToken(url.pathname.split('/')[2] || '')
    const track = this.tracks.get(id)
    if (!track || !fs.existsSync(track.path)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Media not found')
      return
    }
    const stat = fs.statSync(track.path)
    const total = stat.size
    const range = req.headers.range
    const commonHeaders = {
      'Accept-Ranges': 'bytes',
      'Content-Type': track.mime || mimeForPath(track.path),
      'contentFeatures.dlna.org': 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000'
    }
    if (range) {
      const match = String(range).match(/bytes=(\d*)-(\d*)/)
      if (!match) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` })
        res.end()
        return
      }
      const start = match[1] ? parseInt(match[1], 10) : 0
      const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` })
        res.end()
        return
      }
      res.writeHead(206, {
        ...commonHeaders,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${total}`
      })
      fs.createReadStream(track.path, { start, end }).pipe(res)
      return
    }
    res.writeHead(200, {
      ...commonHeaders,
      'Content-Length': total
    })
    fs.createReadStream(track.path).pipe(res)
  }

  handleCover(url, req, res) {
    const id = sanitizeToken(url.pathname.split('/')[2] || '')
    const cover = this.covers.get(id)
    if (!cover) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Cover not found')
      return
    }
    if (cover.type === 'buffer') {
      res.writeHead(200, {
        'Content-Type': cover.mime,
        'Content-Length': cover.buffer.length,
        'Cache-Control': 'no-store'
      })
      res.end(cover.buffer)
      return
    }
    const stat = fs.statSync(cover.path)
    res.writeHead(200, {
      'Content-Type': cover.mime,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store'
    })
    fs.createReadStream(cover.path).pipe(res)
  }
}
