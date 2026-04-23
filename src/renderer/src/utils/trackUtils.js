export const stripExtension = (name = '') => name.replace(/\.[^/.]+$/, '')

/** Slash in YT/B站 titles is usually 「曲名 / 翻唱署名」, not 「歌手 / 曲名」. */
const SLASH_LIKE = new Set(['/', '／'])

function looksLikeSlashSideCredit(right) {
  const r = (right || '').trim()
  if (!r) return false
  if (/\b(covers?)\b/i.test(r)) return true
  if (/cover\s*$/i.test(r)) return true
  if (/翻唱|カバー|歌ってみた|弾いてみた|试着唱|翻自/i.test(r)) return true
  return false
}

export const parseArtistTitleFromName = (name = '') => {
  const separators = [' - ', ' – ', ' — ', '_', '／', '/', '-', '–', '—']
  for (const separator of separators) {
    if (!name.includes(separator)) continue
    const [left, ...rest] = name.split(separator)
    if (!left || rest.length === 0) continue
    const leftPart = left.trim()
    const rightPart = rest.join(separator).trim()
    if (!leftPart || !rightPart) continue

    if (SLASH_LIKE.has(separator) && looksLikeSlashSideCredit(rightPart)) {
      return { title: leftPart, artist: undefined }
    }

    return { artist: leftPart, title: rightPart }
  }
  return null
}

export const toOrderNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER
}

export const compareTrackOrder = (a, b) => {
  const discDiff = toOrderNumber(a.info.discNo) - toOrderNumber(b.info.discNo)
  if (discDiff !== 0) return discDiff

  const trackDiff = toOrderNumber(a.info.trackNo) - toOrderNumber(b.info.trackNo)
  if (trackDiff !== 0) return trackDiff

  return a.info.fileName.localeCompare(b.info.fileName, undefined, {
    numeric: true,
    sensitivity: 'base'
  })
}

export const parseTrackInfo = (track, meta) => {
  const rawName = track?.name || ''
  const fileName = stripExtension(rawName)
  const pathParts = (track?.path || '').split(/[/\\]/).filter(Boolean)
  const folderAlbum = pathParts.length > 1 ? pathParts[pathParts.length - 2] : 'Unknown Album'

  const trackNoFromName = fileName.match(/^\s*(\d{1,3})[.)\-\s_]+/)?.[1] || null
  const noTrackNo = fileName.replace(/^\s*\d+[.)\-\s_]+/, '').trim()
  const normalized = noTrackNo || fileName
  const parsedFromFile = parseArtistTitleFromName(normalized)
  const parsedFromMeta = meta?.title ? parseArtistTitleFromName(meta.title) : null
  /** Slash+cover 启发式时只返回 title，不把左侧当歌手 */
  const metaTitleForUi =
    parsedFromMeta && parsedFromMeta.artist === undefined && parsedFromMeta.title
      ? parsedFromMeta.title
      : null

  const metaArtist = meta?.artist && meta.artist !== 'Unknown Artist' ? meta.artist : null
  const artist =
    metaArtist ||
    meta?.albumArtist ||
    parsedFromMeta?.artist ||
    parsedFromFile?.artist ||
    'Unknown Artist'
  const title =
    metaTitleForUi || meta?.title || parsedFromFile?.title || normalized || 'Unknown Track'

  return {
    fileName,
    title,
    artist,
    album: meta?.album || track?.album || folderAlbum || 'Unknown Album',
    cover: meta?.cover || null,
    trackNo: meta?.trackNo ?? (trackNoFromName ? Number(trackNoFromName) : null),
    discNo: meta?.discNo ?? null,
    duration: meta?.duration || 0,
    sizeBytes: track?.sizeBytes || 0
  }
}
