/**
 * Per-audio-file MV override (Bilibili / YouTube id), persisted in localStorage.
 * Keyed by absolute file path (same as lyrics override).
 */
const STORAGE_KEY = 'echoes_mv_override_v1'

export function getMvOverrideForPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const map = JSON.parse(raw)
    const e = map[filePath]
    if (!e || typeof e.id !== 'string' || !e.id.trim()) return null
    const source = e.source
    if (source !== 'bilibili' && source !== 'youtube') return null
    return { id: e.id.trim(), source, savedAt: e.savedAt }
  } catch {
    return null
  }
}

export function setMvOverrideForPath(filePath, { id, source }) {
  if (!filePath || typeof filePath !== 'string') return
  if (!id || typeof id !== 'string') return
  if (source !== 'bilibili' && source !== 'youtube') return
  try {
    const prev = localStorage.getItem(STORAGE_KEY)
    const map = prev ? JSON.parse(prev) : {}
    map[filePath] = { id: id.trim(), source, savedAt: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* quota */
  }
}

export function clearMvOverrideForPath(filePath) {
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
