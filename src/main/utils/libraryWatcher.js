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
  return (await scanFolders(normalizedFolders)).filter((entry) => !existingPathSet.has(entry.path))
}

export function createLibraryWatchManager({ onChange }) {
  let watchedFolders = []
  let snapshot = new Map()
  let watchers = new Map()
  let debounceTimer = null
  let scanning = false
  let rescanQueued = false
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

  const rebuildWatchers = () => {
    const allDirectories = []
    const seenDirectories = new Set()
    for (const folder of watchedFolders) {
      collectDirectoriesRecursive(folder, allDirectories, seenDirectories)
    }

    const nextDirectorySet = new Set(allDirectories)

    for (const [dirPath, watcher] of watchers) {
      if (nextDirectorySet.has(dirPath)) continue
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
          scheduleRescan()
        })
        watcher.on('error', (error) => {
          console.warn(`[libraryWatcher] ${dirPath}:`, error?.message || error)
          const now = Date.now()
          const lastAt = lastErrorRescanAtByDir.get(dirPath) || 0
          if (now - lastAt >= 1000) {
            lastErrorRescanAtByDir.set(dirPath, now)
            scheduleRescan()
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
      const nextSnapshot = buildSnapshot(await scanFolders(watchedFolders))
      const diff = diffSnapshots(snapshot, nextSnapshot)
      snapshot = nextSnapshot
      rebuildWatchers()
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

  const scheduleRescan = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void runRescan()
    }, 350)
  }

  return {
    async start(folders) {
      watchedFolders = Array.isArray(folders)
        ? [...new Set(folders.map(normalizeFolderPath).filter(Boolean))]
        : []
      closeAllWatchers()
      snapshot = buildSnapshot(await scanFolders(watchedFolders))
      rebuildWatchers()
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
      return { ok: true }
    }
  }
}
