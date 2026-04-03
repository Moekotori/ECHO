import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function now() {
  return Date.now()
}

export class MediaStore {
  constructor(opts = {}) {
    this.baseDir = opts.baseDir || path.resolve(process.cwd(), 'tmp-media')
    this.ttlMs = Number(opts.ttlMs || 1000 * 60 * 60 * 4) // 4h
    this.maxFileBytes = Number(opts.maxFileBytes || 1024 * 1024 * 200) // 200MB
    this.items = new Map()
    ensureDir(this.baseDir)
  }

  createUpload(roomId, meta = {}) {
    const mediaId = crypto.randomBytes(8).toString('hex')
    const fileName = `${roomId}_${mediaId}.bin`
    const filePath = path.join(this.baseDir, fileName)
    this.items.set(mediaId, {
      mediaId,
      roomId,
      title: meta.title || '',
      artist: meta.artist || '',
      size: 0,
      createdAt: now(),
      updatedAt: now(),
      filePath
    })
    return this.items.get(mediaId)
  }

  appendChunk(mediaId, buffer) {
    const item = this.items.get(mediaId)
    if (!item) return { ok: false, error: 'media_not_found' }
    const nextSize = item.size + buffer.length
    if (nextSize > this.maxFileBytes) return { ok: false, error: 'file_too_large' }
    fs.appendFileSync(item.filePath, buffer)
    item.size = nextSize
    item.updatedAt = now()
    return { ok: true, size: item.size }
  }

  finish(mediaId) {
    const item = this.items.get(mediaId)
    if (!item) return null
    item.updatedAt = now()
    return item
  }

  get(mediaId) {
    return this.items.get(mediaId) || null
  }

  delete(mediaId) {
    const item = this.items.get(mediaId)
    if (!item) return
    try {
      if (fs.existsSync(item.filePath)) fs.unlinkSync(item.filePath)
    } catch (_) {
      // ignore cleanup failure
    }
    this.items.delete(mediaId)
  }

  cleanupExpired() {
    const cutoff = now() - this.ttlMs
    for (const item of this.items.values()) {
      if (item.updatedAt < cutoff) this.delete(item.mediaId)
    }
  }
}
