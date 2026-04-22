import { createPluginDataStore } from './PluginStorage.js'

/**
 * Build the `echo` API object injected into a main-process plugin sandbox.
 * Each plugin receives its own scoped instance.
 */
export function buildMainPluginAPI(pluginId, { manifest, eventBus, networkAllowed }) {
  const storage = createPluginDataStore(pluginId)

  const api = {
    storage: {
      get: (key) => storage.get(key),
      set: (key, value) => storage.set(key, value),
      getAll: () => storage.getAll(),
      remove: (key) => storage.remove(key)
    },

    events: {
      on: (name, handler) => eventBus.on(`plugin:${name}`, handler),
      off: (name, handler) => eventBus.off(`plugin:${name}`, handler),
      emit: (name, data) => eventBus.emit(`plugin:${name}`, data)
    },

    log: {
      info: (...args) => console.log(`[Plugin:${pluginId}]`, ...args),
      warn: (...args) => console.warn(`[Plugin:${pluginId}]`, ...args),
      error: (...args) => console.error(`[Plugin:${pluginId}]`, ...args)
    }
  }

  if (networkAllowed) {
    api.network = {
      async fetch(url, options = {}) {
        const { default: fetch } = await import('node-fetch')
        const res = await fetch(url, {
          ...options,
          timeout: options.timeout ?? 15000
        })
        const text = await res.text()
        return {
          ok: res.ok,
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          text,
          json: () => JSON.parse(text)
        }
      }
    }
  }

  return api
}
