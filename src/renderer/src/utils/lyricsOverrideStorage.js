const STORAGE_KEY = 'echoes_lyrics_override_v1'

export function getLyricsOverrideForPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const map = JSON.parse(raw)
    const entry = map[filePath]
    if (!entry || typeof entry.raw !== 'string' || !entry.raw.trim()) return null
    return entry
  } catch {
    return null
  }
}

export function setLyricsOverrideForPath(filePath, rawLrcText, meta = {}) {
  if (!filePath || typeof filePath !== 'string') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const map = raw ? JSON.parse(raw) : {}
    map[filePath] = {
      raw: rawLrcText,
      savedAt: Date.now(),
      source: typeof meta.source === 'string' ? meta.source : '',
      origin: typeof meta.origin === 'string' ? meta.origin : ''
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore quota */
  }
}

export function clearLyricsOverrideForPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const map = JSON.parse(raw)
    delete map[filePath]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export function remapLyricsOverrides(pathMap = {}, removedPaths = []) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const map = JSON.parse(raw)
    let changed = false

    for (const [fromPath, toPath] of Object.entries(pathMap || {})) {
      if (!fromPath || !toPath || fromPath === toPath || !map[fromPath]) continue
      if (!map[toPath]) {
        map[toPath] = map[fromPath]
      }
      delete map[fromPath]
      changed = true
    }

    for (const removedPath of removedPaths || []) {
      if (!removedPath || !map[removedPath]) continue
      delete map[removedPath]
      changed = true
    }

    if (changed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    }
  } catch {
    /* ignore quota */
  }
}
