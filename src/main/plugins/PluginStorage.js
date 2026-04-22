import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'

const STATE_FILE = 'plugin-state.json'

function filePath() {
  return join(app.getPath('userData'), STATE_FILE)
}

function readAll() {
  try {
    const p = filePath()
    if (!fs.existsSync(p)) return {}
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function writeAll(data) {
  try {
    fs.writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error('[PluginStorage] write failed:', e?.message || e)
    return false
  }
}

export function getPluginEnabled(pluginId) {
  const all = readAll()
  return all[pluginId]?.enabled !== false
}

export function setPluginEnabled(pluginId, enabled) {
  const all = readAll()
  if (!all[pluginId]) all[pluginId] = {}
  all[pluginId].enabled = !!enabled
  return writeAll(all)
}

export function getPluginSettings(pluginId) {
  const all = readAll()
  return all[pluginId]?.settings ?? {}
}

export function setPluginSettings(pluginId, settings) {
  const all = readAll()
  if (!all[pluginId]) all[pluginId] = {}
  all[pluginId].settings = settings
  return writeAll(all)
}

export function removePluginState(pluginId) {
  const all = readAll()
  delete all[pluginId]
  return writeAll(all)
}

export function getAllPluginStates() {
  return readAll()
}

/**
 * Per-plugin key-value storage accessible from sandbox.
 * Data stored under `plugin-data/<pluginId>.json` in userData.
 */
export function createPluginDataStore(pluginId) {
  const dir = join(app.getPath('userData'), 'plugin-data')
  const file = join(dir, `${pluginId}.json`)

  function read() {
    try {
      if (!fs.existsSync(file)) return {}
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch {
      return {}
    }
  }

  function write(data) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) {
      console.error(`[PluginData:${pluginId}] write failed:`, e?.message || e)
    }
  }

  return {
    get(key) {
      return read()[key] ?? null
    },
    set(key, value) {
      const d = read()
      d[key] = value
      write(d)
    },
    getAll() {
      return read()
    },
    remove(key) {
      const d = read()
      delete d[key]
      write(d)
    },
    clear() {
      write({})
    }
  }
}
