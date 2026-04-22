import pluginEventBus from './PluginEventBus'

/**
 * Build the `echo` API object passed to a renderer-side plugin's `activate(echo)`.
 * Each plugin gets its own scoped instance.
 */
export function buildRendererPluginAPI(
  pluginId,
  { slotRegistry, musicSourceRegistry, lyricsProviderRegistry }
) {
  const storage = createRendererStorage(pluginId)

  return {
    storage,

    hooks: {
      tap: (hookName, handler, priority) =>
        pluginEventBus.tap(hookName, { pluginId, priority, handler }),
      on: (eventName, handler) => pluginEventBus.on(eventName, handler),
      off: (eventName, handler) => pluginEventBus.off(eventName, handler)
    },

    ui: {
      registerSlot(slotName, config) {
        slotRegistry.register(pluginId, slotName, config)
      },
      unregisterSlot(slotName) {
        slotRegistry.unregister(pluginId, slotName)
      },
      unregisterAll() {
        slotRegistry.unregisterAll(pluginId)
      },
      showNotification(message, options = {}) {
        pluginEventBus.emit('plugin:notification', { pluginId, message, ...options })
      },
      registerSettingsSection(config) {
        slotRegistry.register(pluginId, '__settings', config)
      }
    },

    musicSource: {
      register(provider) {
        musicSourceRegistry.set(pluginId, { ...provider, pluginId })
      }
    },

    lyricsProvider: {
      register(provider) {
        lyricsProviderRegistry.set(pluginId, { ...provider, pluginId })
      }
    },

    network: {
      async fetch(url, options = {}) {
        const res = await window.fetch(url, options)
        return res
      }
    },

    app: {
      get version() {
        return window.__ECHO_APP_VERSION__ || '0.0.0'
      },
      get locale() {
        return document.documentElement.lang || 'en'
      }
    },

    i18n: {
      addResources(locale, translations) {
        pluginEventBus.emit('plugin:i18n-add', { pluginId, locale, translations })
      },
      t(key, options) {
        return key
      }
    }
  }
}

function createRendererStorage(pluginId) {
  const prefix = `__plugin_${pluginId}_`
  return {
    get(key) {
      try {
        const raw = localStorage.getItem(prefix + key)
        return raw !== null ? JSON.parse(raw) : null
      } catch {
        return null
      }
    },
    set(key, value) {
      localStorage.setItem(prefix + key, JSON.stringify(value))
    },
    getAll() {
      const result = {}
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k.startsWith(prefix)) {
          try {
            result[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k))
          } catch {
            /* skip */
          }
        }
      }
      return result
    },
    remove(key) {
      localStorage.removeItem(prefix + key)
    }
  }
}
