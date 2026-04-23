export const DEFAULT_MAX_PLAYBACK_HISTORY = 40

export function dedupePathList(paths) {
  const seen = new Set()
  const next = []
  for (const path of Array.isArray(paths) ? paths : []) {
    if (typeof path !== 'string' || !path || seen.has(path)) continue
    seen.add(path)
    next.push(path)
  }
  return next
}

export function createPlaybackContext(kind = 'library', key = 'library', trackPaths = []) {
  return {
    kind,
    key,
    trackPaths: kind === 'library' ? [] : dedupePathList(trackPaths)
  }
}

export function normalizePlaybackContext(raw) {
  if (!raw || typeof raw !== 'object') return createPlaybackContext('library', 'library', [])
  const kind =
    raw.kind === 'userPlaylist' || raw.kind === 'smartCollection' ? raw.kind : 'library'
  const key = typeof raw.key === 'string' && raw.key.trim() ? raw.key.trim() : kind
  const trackPaths = Array.isArray(raw.trackPaths)
    ? raw.trackPaths.filter((path) => typeof path === 'string' && path)
    : []
  return createPlaybackContext(kind, key, trackPaths)
}

export function normalizePlaybackSession(raw) {
  if (!raw || typeof raw !== 'object') return null
  const trackPath = typeof raw.trackPath === 'string' ? raw.trackPath.trim() : ''
  if (!trackPath) return null
  const currentTimeSec = Math.max(0, Number(raw.currentTimeSec) || 0)
  return {
    trackPath,
    currentTimeSec,
    playbackContext: normalizePlaybackContext(raw.playbackContext),
    savedAt: Number(raw.savedAt) > 0 ? Number(raw.savedAt) : Date.now()
  }
}

export function normalizePlaybackHistoryEntry(value) {
  if (typeof value === 'string') {
    const path = value.trim()
    if (!path) return null
    return {
      path,
      title: '',
      artist: '',
      album: '',
      playedAt: 0
    }
  }
  if (!value || typeof value !== 'object') return null
  const path = typeof value.path === 'string' ? value.path.trim() : ''
  if (!path) return null
  return {
    path,
    title: typeof value.title === 'string' ? value.title.trim() : '',
    artist: typeof value.artist === 'string' ? value.artist.trim() : '',
    album: typeof value.album === 'string' ? value.album.trim() : '',
    playedAt: Number(value.playedAt) > 0 ? Number(value.playedAt) : 0
  }
}

export function containsLegacyPlaybackHistoryEntries(raw) {
  return Array.isArray(raw) && raw.some((entry) => typeof entry === 'string')
}

export function normalizePlaybackHistory(
  raw,
  maxEntries = DEFAULT_MAX_PLAYBACK_HISTORY
) {
  if (!Array.isArray(raw)) return []
  const next = []
  for (const value of raw) {
    const entry = normalizePlaybackHistoryEntry(value)
    if (entry) next.push(entry)
  }
  return next.slice(-maxEntries)
}

export function remapPlaybackHistoryEntries(
  entries,
  pathMap,
  removedSet,
  maxEntries = DEFAULT_MAX_PLAYBACK_HISTORY
) {
  const next = []
  for (const value of Array.isArray(entries) ? entries : []) {
    const entry = normalizePlaybackHistoryEntry(value)
    if (!entry) continue
    const mappedPath = pathMap[entry.path] || entry.path
    if (!mappedPath || removedSet.has(mappedPath)) continue
    next.push({
      ...entry,
      path: mappedPath
    })
  }
  return next.slice(-maxEntries)
}

export function pickInitialPersistedValue({
  snapshotValue,
  localValue,
  normalize = (value) => value,
  fallback
}) {
  if (snapshotValue !== undefined && snapshotValue !== null) {
    const normalizedSnapshot = normalize(snapshotValue)
    if (normalizedSnapshot !== undefined) return normalizedSnapshot
  }
  if (localValue !== undefined && localValue !== null) {
    const normalizedLocal = normalize(localValue)
    if (normalizedLocal !== undefined) return normalizedLocal
  }
  return typeof fallback === 'function' ? fallback() : fallback
}
