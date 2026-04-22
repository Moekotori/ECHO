import { stripExtension } from './trackUtils'

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function basename(filePath = '') {
  return String(filePath || '')
    .split(/[/\\]/)
    .pop()
}

function dirname(filePath = '') {
  const normalized = String(filePath || '')
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return idx >= 0 ? normalized.slice(0, idx) : ''
}

function extname(filePath = '') {
  const name = basename(filePath)
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(idx) : ''
}

function joinPath(folder, name) {
  if (!folder) return name
  const separator = folder.includes('\\') ? '\\' : '/'
  return `${folder}${separator}${name}`
}

export function sanitizeFileNamePart(value) {
  let normalized = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  if (!normalized) normalized = 'Untitled'
  if (WINDOWS_RESERVED_NAMES.test(normalized)) normalized = `${normalized}_`
  return normalized
}

function formatTrackNo(value) {
  const n = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(n) && n > 0 ? String(n).padStart(2, '0') : ''
}

export function buildRenamedBaseName(track, templateKey) {
  const info = track?.info || {}
  const title = sanitizeFileNamePart(info.title || stripExtension(track?.name || ''))
  const artist = sanitizeFileNamePart(info.artist || 'Unknown Artist')
  const trackNo = formatTrackNo(info.trackNo)

  switch (templateKey) {
    case 'trackTitle':
      return sanitizeFileNamePart(trackNo ? `${trackNo}. ${title}` : title)
    case 'trackArtistTitle':
      return sanitizeFileNamePart(trackNo ? `${trackNo}. ${artist} - ${title}` : `${artist} - ${title}`)
    case 'artistTitle':
    default:
      return sanitizeFileNamePart(`${artist} - ${title}`)
  }
}

export function buildRenamePreview(tracks, templateKey) {
  const usedTargets = new Set()
  return (Array.isArray(tracks) ? tracks : []).map((track) => {
    const currentPath = String(track?.path || '')
    const currentName = basename(currentPath)
    const extension = extname(currentPath)
    const folder = dirname(currentPath)
    const baseName = buildRenamedBaseName(track, templateKey)
    let candidateName = `${baseName}${extension}`
    let candidatePath = joinPath(folder, candidateName)
    let dedupeIndex = 2

    while (usedTargets.has(candidatePath.toLowerCase())) {
      candidateName = `${baseName} (${dedupeIndex})${extension}`
      candidatePath = joinPath(folder, candidateName)
      dedupeIndex += 1
    }

    usedTargets.add(candidatePath.toLowerCase())
    return {
      from: currentPath,
      to: candidatePath,
      currentName,
      nextName: candidateName,
      changed: currentPath !== candidatePath
    }
  })
}
