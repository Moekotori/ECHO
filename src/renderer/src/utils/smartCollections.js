function normalizeTextFilter(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalPositiveNumber(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.floor(num)
}

export function createEmptySmartCollectionRules() {
  return {
    matchMode: 'all',
    likedOnly: false,
    minPlayCount: null,
    playedWithinDays: null,
    addedWithinDays: null,
    titleIncludes: '',
    artistIncludes: '',
    albumIncludes: ''
  }
}

export function normalizeSmartCollectionRules(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    matchMode: source.matchMode === 'any' ? 'any' : 'all',
    likedOnly: source.likedOnly === true,
    minPlayCount: normalizeOptionalPositiveNumber(source.minPlayCount),
    playedWithinDays: normalizeOptionalPositiveNumber(source.playedWithinDays),
    addedWithinDays: normalizeOptionalPositiveNumber(source.addedWithinDays),
    titleIncludes: normalizeTextFilter(source.titleIncludes),
    artistIncludes: normalizeTextFilter(source.artistIncludes),
    albumIncludes: normalizeTextFilter(source.albumIncludes)
  }
}

export function hasActiveSmartCollectionRules(rules) {
  const normalized = normalizeSmartCollectionRules(rules)
  return Boolean(
    normalized.likedOnly ||
    normalized.minPlayCount ||
    normalized.playedWithinDays ||
    normalized.addedWithinDays ||
    normalized.titleIncludes ||
    normalized.artistIncludes ||
    normalized.albumIncludes
  )
}

export function normalizeUserSmartCollections(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (!id || !name) return null
      const rules = normalizeSmartCollectionRules(item.rules)
      if (!hasActiveSmartCollectionRules(rules)) return null
      return { id, name, rules }
    })
    .filter(Boolean)
}

function buildTrackClauses(track, rules, trackStats, likedSet, nowMs) {
  const info = track?.info || {}
  const stats = (track?.path && trackStats?.[track.path]) || {}
  const clauses = []

  if (rules.likedOnly) {
    clauses.push(Boolean(track?.path && likedSet?.has(track.path)))
  }

  if (rules.minPlayCount) {
    clauses.push(Number(stats.playCount || 0) >= rules.minPlayCount)
  }

  if (rules.playedWithinDays) {
    const cutoff = nowMs - rules.playedWithinDays * 24 * 60 * 60 * 1000
    clauses.push(Number(stats.lastPlayedAt || 0) >= cutoff)
  }

  if (rules.addedWithinDays) {
    const referenceMs = Number(track?.birthtimeMs || track?.mtimeMs || 0)
    const cutoff = nowMs - rules.addedWithinDays * 24 * 60 * 60 * 1000
    clauses.push(referenceMs >= cutoff)
  }

  if (rules.titleIncludes) {
    clauses.push(
      String(info.title || '')
        .toLowerCase()
        .includes(rules.titleIncludes.toLowerCase())
    )
  }

  if (rules.artistIncludes) {
    clauses.push(
      String(info.artist || '')
        .toLowerCase()
        .includes(rules.artistIncludes.toLowerCase())
    )
  }

  if (rules.albumIncludes) {
    clauses.push(
      String(info.album || '')
        .toLowerCase()
        .includes(rules.albumIncludes.toLowerCase())
    )
  }

  return clauses
}

export function matchTrackAgainstSmartCollection(
  track,
  rules,
  trackStats,
  likedSet,
  nowMs = Date.now()
) {
  const normalized = normalizeSmartCollectionRules(rules)
  const clauses = buildTrackClauses(track, normalized, trackStats, likedSet, nowMs)
  if (clauses.length === 0) return true
  return normalized.matchMode === 'any' ? clauses.some(Boolean) : clauses.every(Boolean)
}
