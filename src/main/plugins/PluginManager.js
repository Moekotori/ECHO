import { app, ipcMain } from 'electron'
import { join, resolve } from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'
import { runPluginInSandbox } from './PluginSandbox.js'
import { buildMainPluginAPI } from './PluginAPI.js'
import {
  getPluginEnabled,
  setPluginEnabled,
  getPluginSettings,
  setPluginSettings,
  removePluginState,
  getAllPluginStates
} from './PluginStorage.js'

const REQUIRED_MANIFEST_FIELDS = ['id', 'name', 'version']

function pluginsDir() {
  return join(app.getPath('userData'), 'plugins')
}

function ensurePluginsDir() {
  const dir = pluginsDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return 'manifest must be a JSON object'
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!manifest[field] || typeof manifest[field] !== 'string') {
      return `missing required field: ${field}`
    }
  }
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(manifest.id)) {
    return 'id must be lowercase alphanumeric with dots/hyphens/underscores'
  }
  if (manifest.permissions && !Array.isArray(manifest.permissions)) {
    return 'permissions must be an array'
  }
  return null
}

export class PluginManager {
  /** @type {Map<string, { manifest, dir, sandbox, active }>} */
  plugins = new Map()
  eventBus = new EventEmitter()
  /** BrowserWindow reference (set after window creation) */
  mainWindow = null

  setMainWindow(win) {
    this.mainWindow = win
  }

  discover() {
    const dir = ensurePluginsDir()
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const found = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const pluginDir = join(dir, entry.name)
      const manifestPath = join(pluginDir, 'plugin.json')
      if (!fs.existsSync(manifestPath)) continue

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
        const err = validateManifest(manifest)
        if (err) {
          console.warn(`[PluginManager] invalid manifest in ${entry.name}: ${err}`)
          continue
        }
        found.push({ manifest, dir: pluginDir })
      } catch (e) {
        console.warn(`[PluginManager] failed to read ${entry.name}/plugin.json:`, e?.message)
      }
    }

    return found
  }

  async activatePlugin(pluginId) {
    const info = this.plugins.get(pluginId)
    if (!info) return { ok: false, error: 'not_found' }
    if (info.active) return { ok: true }

    const { manifest, dir } = info

    if (manifest.main) {
      const mainFile = join(dir, manifest.main)
      if (fs.existsSync(mainFile)) {
        try {
          const code = fs.readFileSync(mainFile, 'utf-8')
          const perms = new Set(manifest.permissions || [])
          const echoAPI = buildMainPluginAPI(pluginId, {
            manifest,
            eventBus: this.eventBus,
            networkAllowed: perms.has('network')
          })
          const sandbox = runPluginInSandbox(code, echoAPI, { pluginId })
          if (sandbox?.activate) {
            await Promise.resolve(sandbox.activate(echoAPI))
          }
          info.sandbox = sandbox
        } catch (e) {
          console.error(`[PluginManager] activate ${pluginId} main failed:`, e?.message || e)
          return { ok: false, error: e?.message || 'activate_failed' }
        }
      }
    }

    info.active = true
    setPluginEnabled(pluginId, true)
    this._broadcastPluginList()
    return { ok: true }
  }

  async deactivatePlugin(pluginId) {
    const info = this.plugins.get(pluginId)
    if (!info) return { ok: false, error: 'not_found' }
    if (!info.active) return { ok: true }

    if (info.sandbox?.deactivate) {
      try {
        await Promise.resolve(info.sandbox.deactivate())
      } catch (e) {
        console.warn(`[PluginManager] deactivate ${pluginId} error:`, e?.message || e)
      }
    }

    info.active = false
    info.sandbox = null
    setPluginEnabled(pluginId, false)
    this._broadcastPluginList()
    return { ok: true }
  }

  async loadAll() {
    const found = this.discover()
    for (const { manifest, dir } of found) {
      this.plugins.set(manifest.id, {
        manifest,
        dir,
        sandbox: null,
        active: false
      })

      if (getPluginEnabled(manifest.id)) {
        await this.activatePlugin(manifest.id)
      }
    }
    console.log(`[PluginManager] loaded ${this.plugins.size} plugin(s)`)
  }

  async installFromPath(sourcePath) {
    const manifestPath = join(sourcePath, 'plugin.json')
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, error: 'no_manifest' }
    }

    let manifest
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch {
      return { ok: false, error: 'invalid_manifest_json' }
    }

    const err = validateManifest(manifest)
    if (err) return { ok: false, error: err }

    const dest = join(ensurePluginsDir(), manifest.id)
    if (fs.existsSync(dest)) {
      return { ok: false, error: 'already_installed' }
    }

    try {
      copyDirRecursive(sourcePath, dest)
    } catch (e) {
      return { ok: false, error: e?.message || 'copy_failed' }
    }

    this.plugins.set(manifest.id, {
      manifest,
      dir: dest,
      sandbox: null,
      active: false
    })

    setPluginEnabled(manifest.id, true)
    await this.activatePlugin(manifest.id)
    return { ok: true, pluginId: manifest.id }
  }

  async uninstall(pluginId) {
    const info = this.plugins.get(pluginId)
    if (!info) return { ok: false, error: 'not_found' }

    if (info.active) {
      await this.deactivatePlugin(pluginId)
    }

    try {
      fs.rmSync(info.dir, { recursive: true, force: true })
    } catch (e) {
      return { ok: false, error: e?.message || 'remove_failed' }
    }

    this.plugins.delete(pluginId)
    removePluginState(pluginId)
    this._broadcastPluginList()
    return { ok: true }
  }

  listPlugins() {
    const states = getAllPluginStates()
    return Array.from(this.plugins.values()).map(({ manifest, active }) => ({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || '',
      author: manifest.author || '',
      permissions: manifest.permissions || [],
      contributes: manifest.contributes || {},
      hasMain: !!manifest.main,
      hasRenderer: !!manifest.renderer,
      hasStyles: !!manifest.styles,
      enabled: getPluginEnabled(manifest.id),
      active,
      settings: states[manifest.id]?.settings || {}
    }))
  }

  getRendererPayload(pluginId) {
    const info = this.plugins.get(pluginId)
    if (!info) return null
    const { manifest, dir } = info

    const payload = { manifest }

    if (manifest.renderer) {
      const rFile = join(dir, manifest.renderer)
      if (fs.existsSync(rFile)) {
        payload.rendererCode = fs.readFileSync(rFile, 'utf-8')
      }
    }

    if (manifest.styles) {
      const sFile = join(dir, manifest.styles)
      if (fs.existsSync(sFile)) {
        payload.stylesCode = fs.readFileSync(sFile, 'utf-8')
      }
    }

    const localesDir = join(dir, 'locales')
    if (fs.existsSync(localesDir)) {
      payload.locales = {}
      for (const f of fs.readdirSync(localesDir)) {
        if (!f.endsWith('.json')) continue
        try {
          const lang = f.replace('.json', '')
          payload.locales[lang] = JSON.parse(
            fs.readFileSync(join(localesDir, f), 'utf-8')
          )
        } catch { /* skip broken locale files */ }
      }
    }

    return payload
  }

  _broadcastPluginList() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('plugin:list-changed', this.listPlugins())
    }
  }

  registerIPC() {
    ipcMain.handle('plugin:list', () => this.listPlugins())

    ipcMain.handle('plugin:enable', async (_, id) => {
      return this.activatePlugin(id)
    })

    ipcMain.handle('plugin:disable', async (_, id) => {
      return this.deactivatePlugin(id)
    })

    ipcMain.handle('plugin:install', async (_, sourcePath) => {
      return this.installFromPath(sourcePath)
    })

    ipcMain.handle('plugin:uninstall', async (_, id) => {
      return this.uninstall(id)
    })

    ipcMain.handle('plugin:getSettings', (_, id) => {
      return getPluginSettings(id)
    })

    ipcMain.handle('plugin:setSettings', (_, id, settings) => {
      setPluginSettings(id, settings)
      this._broadcastPluginList()
      return { ok: true }
    })

    ipcMain.handle('plugin:getRendererPayload', (_, id) => {
      return this.getRendererPayload(id)
    })

    ipcMain.handle('plugin:getActiveRendererPayloads', () => {
      const payloads = []
      for (const [id, info] of this.plugins) {
        if (!info.active) continue
        const p = this.getRendererPayload(id)
        if (p) payloads.push(p)
      }
      return payloads
    })

    ipcMain.handle('plugin:openPluginsDir', async () => {
      const dir = ensurePluginsDir()
      const { shell } = await import('electron')
      await shell.openPath(dir)
      return { ok: true }
    })

    ipcMain.handle('plugin:selectInstallDir', async () => {
      const { dialog } = await import('electron')
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select plugin folder'
      })
      if (result.canceled || !result.filePaths.length) return { ok: false, error: 'canceled' }
      return this.installFromPath(result.filePaths[0])
    })
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export default PluginManager
