import fs from 'fs'
import { nativeImage } from 'electron'
import { basename, dirname, extname, join } from 'path'

const FOLDER_COVER_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const MAX_FOLDER_COVER_DIMENSION = 520
const FOLDER_COVER_JPEG_QUALITY = 78
const PREFERRED_COVER_NAMES = [
  'cover',
  'folder',
  'front',
  'album',
  'artwork',
  'coverart',
  'albumart'
]

function imageMimeFromPath(filePath) {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function scoreFolderCoverName(filePath) {
  const name = basename(filePath, extname(filePath)).toLowerCase().replace(/[^a-z0-9]+/g, '')
  const preferredIndex = PREFERRED_COVER_NAMES.indexOf(name)
  if (preferredIndex >= 0) return preferredIndex
  if (name.includes('cover')) return 20
  if (name.includes('folder')) return 21
  if (name.includes('front')) return 22
  if (name.includes('album')) return 23
  return 100
}

function compressImageFileToDataUrl(filePath) {
  try {
    const buffer = fs.readFileSync(filePath)
    let image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) {
      return `data:${imageMimeFromPath(filePath)};base64,${buffer.toString('base64')}`
    }

    const size = image.getSize()
    const maxSide = Math.max(size.width || 0, size.height || 0)
    if (maxSide > MAX_FOLDER_COVER_DIMENSION) {
      const scale = MAX_FOLDER_COVER_DIMENSION / maxSide
      image = image.resize({
        width: Math.max(1, Math.round((size.width || MAX_FOLDER_COVER_DIMENSION) * scale)),
        height: Math.max(1, Math.round((size.height || MAX_FOLDER_COVER_DIMENSION) * scale)),
        quality: 'best'
      })
    }

    const jpeg = image.toJPEG(FOLDER_COVER_JPEG_QUALITY)
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch {
    return null
  }
}

export function findFolderCoverDataUrl(audioPath) {
  if (typeof audioPath !== 'string' || !audioPath) return null

  try {
    const dirPath = dirname(audioPath)
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const candidates = entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(dirPath, entry.name))
      .filter((filePath) => FOLDER_COVER_EXTS.has(extname(filePath).toLowerCase()))
      .sort((a, b) => scoreFolderCoverName(a) - scoreFolderCoverName(b))

    for (const candidate of candidates) {
      const dataUrl = compressImageFileToDataUrl(candidate)
      if (dataUrl) return dataUrl
    }
  } catch {
    return null
  }

  return null
}
