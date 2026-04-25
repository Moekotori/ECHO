import fs from 'fs'
import { basename, dirname, extname, join } from 'path'

const SUPPORTED_AUDIO_EXTS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.m4a',
  '.aac',
  '.ncm',
  '.dsf',
  '.dff',
  '.opus',
  '.webm',
  '.wma',
  '.alac',
  '.aiff',
  '.m4b',
  '.caf'
])

function normalizeFolderPath(folderPath) {
  if (typeof folderPath !== 'string') return ''
  return folderPath.replace(/[\\/]+$/, '').trim()
}

function normalizeForCompare(itemPath) {
  return normalizeFolderPath(itemPath).replace(/\\/g, '/').toLowerCase()
}

function isPathInsideFolder(itemPath, folderPath) {
  const normalizedPath = normalizeForCompare(itemPath)
  const normalizedFolder = normalizeForCompare(folderPath)
  return (
    !!normalizedPath &&
    !!normalizedFolder &&
    (normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`))
  )
}

function toAudioEntry(entryPath, stats) {
  return {
    name: basename(entryPath),
    path: entryPath,
    folder: dirname(entryPath),
    birthtimeMs: stats.birthtimeMs || stats.ctimeMs || 0,
    mtimeMs: stats.mtimeMs || 0,
    sizeBytes: stats.size || 0
  }
}

export async function collectAudioFilesRecursive(entryPath, out) {
  try {
    const stats = await fs.promises.stat(entryPath)
    if (!stats.isDirectory()) {
      const ext = extname(entryPath).toLowerCase()
      if (SUPPORTED_AUDIO_EXTS.has(ext)) {
        out.push(toAudioEntry(entryPath, stats))
      }
      return
    }

    const entries = await fs.promises.readdir(entryPath, { withFileTypes: true })
    for (const entry of entries) {
      const nextPath = join(entryPath, entry.name)
      try {
        if (entry.isDirectory()) {
          await collectAudioFilesRecursive(nextPath, out)
          continue
        }

        if (!entry.isFile()) continue
        const ext = extname(nextPath).toLowerCase()
        if (!SUPPORTED_AUDIO_EXTS.has(ext)) continue

        const fileStats = await fs.promises.stat(nextPath)
        out.push(toAudioEntry(nextPath, fileStats))
      } catch (e) {
        console.error(`[collectAudioFilesRecursive] ${nextPath}:`, e?.message || e)
      }
    }
  } catch (e) {
    console.error(`[collectAudioFilesRecursive] ${entryPath}:`, e?.message || e)
  }
}

function collectDirectoriesRecursive(entryPath, out, seen) {
  const normalized = normalizeFolderPath(entryPath)
  if (!normalized || seen.has(normalized)) return

  try {
    const stats = fs.statSync(normalized)
    if (!stats.isDirectory()) return
    seen.add(normalized)
    out.push(normalized)

    for (const name of fs.readdirSync(normalized)) {
      const nextPath = join(normalized, name)
      try {
        if (fs.statSync(nextPath).isDirectory()) {
          collectDirectoriesRecursive(nextPath, out, seen)
        }
      } catch (e) {
        console.warn(`[libraryWatcher] skip dir ${nextPath}:`, e?.message || e)
      }
    }
  } catch (e) {
    console.warn(`[libraryWatcher] skip root ${normalized}:`, e?.message || e)
  }
}

function collectKnownDirectoriesFromPaths(existingPaths = []) {
  const dirs = new Set()
  for (const path of Array.isArray(existingPaths) ? existingPaths : []) {
    if (typeof path !== 'string' || !path) continue
    let dir = dirname(path)
    while (dir && dir !== dirname(dir)) {
      dirs.add(normalizeFolderPath(dir))
      dir = dirname(dir)
    }
  }
  return dirs
}

function collectDirectoriesForFolders(folders) {
  const allDirectories = []
  const seenDirectories = new Set()
  for (const folder of folders) {
    collectDirectoriesRecursive(folder, allDirectories, seenDirectories)
  }
  return allDirectories
}

function collectUnknownDirectoriesForRescan(entryPath, knownDirectories, out, seen) {
  const normalized = normalizeFolderPath(entryPath)
  if (!normalized || seen.has(normalized)) return

  try {
    const stats = fs.statSync(normalized)
    if (!stats.isDirectory()) return
    seen.add(normalized)

    const isKnown = knownDirectories.has(normalized)
    if (!isKnown) out.push(normalized)

    for (const name of fs.readdirSync(normalized)) {
      const nextPath = normalizeFolderPath(join(normalized, name))
      try {
        if (!fs.statSync(nextPath).isDirectory()) continue
        if (isKnown && knownDirectories.has(nextPath)) continue
        collectUnknownDirectoriesForRescan(nextPath, knownDirectories, out, seen)
      } catch (e) {
        console.warn(`[libraryWatcher] skip rescan dir ${nextPath}:`, e?.message || e)
      }
    }
  } catch (e) {
    console.warn(`[libraryWatcher] skip rescan root ${normalized}:`, e?.message || e)
  }
}

function collectUnknownDirectoriesForFolders(folders, knownDirectories) {
  const allDirectories = []
  const seenDirectories = new Set()
  for (const folder of folders) {
    collectUnknownDirectoriesForRescan(folder, knownDirectories, allDirectories, seenDirectories)
  }
  return allDirectories
}

function uniqueByPath(entries) {
  const seen = new Set()
  const next = []
  for (const entry of entries) {
    const path = entry?.path
    if (!path || seen.has(path)) continue
    seen.add(path)
    next.push(entry)
  }
  return next
}

function normalizeAudioEntrySeed(entry) {
  if (!entry?.path || typeof entry.path !== 'string') return null
  return {
    name: entry.name || basename(entry.path),
    path: entry.path,
    folder: entry.folder || dirname(entry.path),
    birthtimeMs: Number(entry.birthtimeMs) || 0,
    mtimeMs: Number(entry.mtimeMs) || 0,
    sizeBytes: Number(entry.sizeBytes) || 0
  }
}

function buildSnapshot(entries) {
  const map = new Map()
  for (const entry of uniqueByPath(entries)) {
    map.set(entry.path, entry)
  }
  return map
}

function buildFingerprint(entry) {
  if (!entry?.path) return ''
  const ext = extname(entry.path).toLowerCase()
  return [entry.birthtimeMs || 0, entry.sizeBytes || 0, entry.mtimeMs || 0, ext].join(':')
}

function pairRenamedEntries(removedEntries, addedEntries) {
  const renamed = []
  const removedByFingerprint = new Map()
  const addedByFingerprint = new Map()

  const pushGroup = (map, entry) => {
    const key = buildFingerprint(entry)
    if (!key) return
    const group = map.get(key)
    if (group) group.push(entry)
    else map.set(key, [entry])
  }

  removedEntries.forEach((entry) => pushGroup(removedByFingerprint, entry))
  addedEntries.forEach((entry) => pushGroup(addedByFingerprint, entry))

  for (const [fingerprint, removedGroup] of removedByFingerprint) {
    const addedGroup = addedByFingerprint.get(fingerprint)
    if (!addedGroup || removedGroup.length !== 1 || addedGroup.length !== 1) continue
    renamed.push({
      from: removedGroup[0].path,
      to: addedGroup[0].path,
      entry: addedGroup[0]
    })
  }

  if (!renamed.length) {
    return {
      renamed,
      remainingRemoved: removedEntries,
      remainingAdded: addedEntries
    }
  }

  const renamedFromSet = new Set(renamed.map((item) => item.from))
  const renamedToSet = new Set(renamed.map((item) => item.to))
  return {
    renamed,
    remainingRemoved: removedEntries.filter((entry) => !renamedFromSet.has(entry.path)),
    remainingAdded: addedEntries.filter((entry) => !renamedToSet.has(entry.path))
  }
}

function diffSnapshots(previousSnapshot, nextSnapshot) {
  const removedEntries = []
  const addedEntries = []

  for (const [path, entry] of previousSnapshot) {
    if (!nextSnapshot.has(path)) removedEntries.push(entry)
  }

  for (const [path, entry] of nextSnapshot) {
    if (!previousSnapshot.has(path)) addedEntries.push(entry)
  }

  const { renamed, remainingRemoved, remainingAdded } = pairRenamedEntries(
    removedEntries,
    addedEntries
  )

  return {
    renamed,
    removedPaths: remainingRemoved.map((entry) => entry.path),
    added: remainingAdded
  }
}

async function scanFolders(folders) {
  const files = []
  for (const folder of folders) {
    await collectAudioFilesRecursive(folder, files)
  }
  return uniqueByPath(files)
}

export async function rescanImportedFolders(folders, existingPaths = []) {
  const normalizedFolders = Array.isArray(folders)
    ? [...new Set(folders.map(normalizeFolderPath).filter(Boolean))]
    : []
  const existingPathSet = new Set(
    Array.isArray(existingPaths) ? existingPaths.filter((item) => typeof item === 'string') : []
  )
  if (existingPathSet.size > 0) {
    const knownDirectories = collectKnownDirectoriesFromPaths(existingPaths)
    const candidateDirectories = collectUnknownDirectoriesForFolders(normalizedFolders, knownDirectories)
    return (await scanFolders(candidateDirectories)).filter((entry) => !existingPathSet.has(entry.path))
  }
  return (await scanFolders(normalizedFolders)).filter((entry) => !existingPathSet.has(entry.path))
}

export function createLibraryWatchManager({ onChange }) {
  let watchedFolders = []
  let snapshot = new Map()
  let watchers = new Map()
  let debounceTimer = null
  let scanning = false
  let rescanQueued = false
  let dirtyScanRoots = new Set()
  const lastErrorRescanAtByDir = new Map()

  const closeAllWatchers = () => {
    for (const watcher of watchers.values()) {
      try {
        watcher.close()
      } catch {
        /* ignore */
      }
    }
    watchers = new Map()
  }

  const rebuildWatchers = (scanRoots = watchedFolders) => {
    const allDirectories = collectDirectoriesForFolders(scanRoots)
    const nextDirectorySet = new Set(allDirectories)

    for (const [dirPath, watcher] of watchers) {
      if (watchedFolders.some((folder) => isPathInsideFolder(dirPath, folder))) continue
      try {
        watcher.close()
      } catch {
        /* ignore */
      }
      watchers.delete(dirPath)
    }

    for (const dirPath of allDirectories) {
      if (watchers.has(dirPath)) continue
      try {
        const watcher = fs.watch(dirPath, () => {
          scheduleRescan(dirPath)
        })
        watcher.on('error', (error) => {
          console.warn(`[libraryWatcher] ${dirPath}:`, error?.message || error)
          const now = Date.now()
          const lastAt = lastErrorRescanAtByDir.get(dirPath) || 0
          if (now - lastAt >= 1000) {
            lastErrorRescanAtByDir.set(dirPath, now)
            scheduleRescan(dirPath)
          }
        })
        watchers.set(dirPath, watcher)
      } catch (error) {
        console.warn(`[libraryWatcher] failed to watch ${dirPath}:`, error?.message || error)
      }
    }
  }

  const runRescan = async () => {
    if (scanning) {
      rescanQueued = true
      return
    }

    scanning = true
    try {
      const scanRoots = [...dirtyScanRoots].filter((dirPath) =>
        watchedFolders.some((folder) => isPathInsideFolder(dirPath, folder))
      )
      dirtyScanRoots = new Set()
      if (!scanRoots.length) return

      const nextSnapshot = buildSnapshot(await scanFolders(scanRoots))
      const previousSnapshot = new Map(
        [...snapshot].filter(([path]) =>
          scanRoots.some((rootPath) => isPathInsideFolder(path, rootPath))
        )
      )
      const diff = diffSnapshots(previousSnapshot, nextSnapshot)
      for (const path of previousSnapshot.keys()) snapshot.delete(path)
      for (const [path, entry] of nextSnapshot) snapshot.set(path, entry)
      rebuildWatchers(scanRoots)
      if (diff.renamed.length || diff.removedPaths.length || diff.added.length) {
        onChange?.(diff)
      }
    } finally {
      scanning = false
      if (rescanQueued) {
        rescanQueued = false
        scheduleRescan()
      }
    }
  }

  const scheduleRescan = (dirPath) => {
    if (dirPath) dirtyScanRoots.add(normalizeFolderPath(dirPath))
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void runRescan()
    }, 350)
  }

  return {
    async start(folders, existingTracks = []) {
      const nextFolders = Array.isArray(folders)
        ? [...new Set(folders.map(normalizeFolderPath).filter(Boolean))]
        : []
      const seededSnapshot = buildSnapshot(
        (Array.isArray(existingTracks) ? existingTracks : [])
          .map(normalizeAudioEntrySeed)
          .filter((entry) =>
            nextFolders.some((folder) => entry?.path && isPathInsideFolder(entry.path, folder))
          )
      )
      const addedFolders = nextFolders.filter(
        (folder) => !watchedFolders.some((existing) => isPathInsideFolder(folder, existing))
      )
      watchedFolders = nextFolders
      snapshot = seededSnapshot
      for (const path of [...snapshot.keys()]) {
        if (!watchedFolders.some((folder) => isPathInsideFolder(path, folder))) {
          snapshot.delete(path)
        }
      }
      rebuildWatchers(addedFolders)
      return {
        ok: true,
        trackedFolders: watchedFolders.slice()
      }
    },
    stop() {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      closeAllWatchers()
      watchedFolders = []
      snapshot = new Map()
      scanning = false
      rescanQueued = false
      dirtyScanRoots = new Set()
      return { ok: true }
    }
  }
}
