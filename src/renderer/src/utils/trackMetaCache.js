const DB_NAME = 'echo-track-meta-cache'
const DB_VERSION = 1
const STORE_NAME = 'trackMeta'
const MAX_CACHE_ENTRIES = 12000
const MAX_CACHE_COVER_ENTRIES = 6000

let dbPromise = null
let prunePromise = null

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined'
}

function openTrackMetaDb() {
  if (!hasIndexedDb()) return Promise.resolve(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'path' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })

  return dbPromise
}

function normalizeTrackMetaEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const next = {}
  for (const key of ['title', 'artist', 'album', 'albumArtist', 'cover', 'codec', 'lyrics', 'genre']) {
    if (typeof entry[key] === 'string') next[key] = entry[key]
    else if (entry[key] == null) next[key] = null
  }
  for (const key of ['trackNo', 'discNo', 'duration', 'bitrateKbps', 'sampleRateHz', 'bitDepth', 'channels', 'bpm']) {
    const value = Number(entry[key])
    next[key] = Number.isFinite(value) && value > 0 ? value : null
  }
  {
    const value = Number(entry.coverExtractorVersion)
    next.coverExtractorVersion = Number.isFinite(value) && value > 0 ? value : null
  }
  next.coverChecked = entry.coverChecked === true
  next.bpmChecked = entry.bpmChecked === true
  next.bpmMeasured = entry.bpmMeasured === true
  next.mqaChecked = entry.mqaChecked === true
  next.isMqa = entry.isMqa === true
  return next
}

function getAllRecords(store) {
  return new Promise((resolve) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : [])
    request.onerror = () => resolve([])
  })
}

export async function readTrackMetaCache(paths = []) {
  const db = await openTrackMetaDb()
  if (!db || !Array.isArray(paths) || paths.length === 0) return {}

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const result = {}
    let pending = paths.length

    const finish = () => {
      pending -= 1
      if (pending <= 0) resolve(result)
    }

    for (const path of paths) {
      const request = store.get(path)
      request.onsuccess = () => {
        const cached = request.result?.meta
        const normalized = normalizeTrackMetaEntry(cached)
        if (normalized) result[path] = normalized
        finish()
      }
      request.onerror = finish
    }
  })
}

export async function writeTrackMetaCache(entries = {}) {
  const db = await openTrackMetaDb()
  if (!db || !entries || typeof entries !== 'object') return

  await new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const updatedAt = Date.now()

    for (const [path, entry] of Object.entries(entries)) {
      if (!path) continue
      const meta = normalizeTrackMetaEntry(entry)
      if (!meta) continue
      store.put({ path, meta, updatedAt, hasCover: typeof meta.cover === 'string' && meta.cover.length > 0 })
    }

    tx.oncomplete = resolve
    tx.onerror = resolve
    tx.onabort = resolve
  })

  pruneTrackMetaCache()
}

export async function pruneTrackMetaCache() {
  if (prunePromise) return prunePromise

  prunePromise = (async () => {
    const db = await openTrackMetaDb()
    if (!db) return

    const readTx = db.transaction(STORE_NAME, 'readonly')
    const records = await getAllRecords(readTx.objectStore(STORE_NAME))

    await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      records.sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0))

      const removePaths = new Set()
      const overflow = records.length - MAX_CACHE_ENTRIES
      if (overflow > 0) {
        for (const record of records.slice(0, overflow)) removePaths.add(record.path)
      }

      const coverRecords = records.filter((record) => record.hasCover && !removePaths.has(record.path))
      const coverOverflow = coverRecords.length - MAX_CACHE_COVER_ENTRIES
      if (coverOverflow > 0) {
        for (const record of coverRecords.slice(0, coverOverflow)) removePaths.add(record.path)
      }

      for (const path of removePaths) store.delete(path)

      tx.oncomplete = resolve
      tx.onerror = resolve
      tx.onabort = resolve
    })
  })().finally(() => {
    prunePromise = null
  })

  return prunePromise
}
