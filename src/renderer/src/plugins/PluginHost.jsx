import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import pluginEventBus from './PluginEventBus'
import { buildRendererPluginAPI } from './PluginRendererAPI'

const PluginContext = createContext(null)

export function usePlugins() {
  return useContext(PluginContext)
}

/**
 * Registry for UI slot contributions from plugins.
 */
function createSlotRegistry() {
  let _slots = {}
  let _onChange = null

  return {
    setOnChange(fn) {
      _onChange = fn
    },
    register(pluginId, slotName, config) {
      if (!_slots[slotName]) _slots[slotName] = []
      _slots[slotName] = _slots[slotName].filter((s) => s.pluginId !== pluginId)
      _slots[slotName].push({ pluginId, ...config })
      _slots[slotName].sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
      _onChange?.({ ..._slots })
    },
    unregister(pluginId, slotName) {
      if (!_slots[slotName]) return
      _slots[slotName] = _slots[slotName].filter((s) => s.pluginId !== pluginId)
      _onChange?.({ ..._slots })
    },
    unregisterAll(pluginId) {
      for (const name of Object.keys(_slots)) {
        _slots[name] = _slots[name].filter((s) => s.pluginId !== pluginId)
      }
      _onChange?.({ ..._slots })
    },
    getSlot(name) {
      return _slots[name] || []
    },
    getAll() {
      return { ..._slots }
    }
  }
}

export default function PluginHostProvider({ children }) {
  const [pluginList, setPluginList] = useState([])
  const [slots, setSlots] = useState({})
  const [musicSources, setMusicSources] = useState(new Map())
  const [lyricsProviders, setLyricsProviders] = useState(new Map())
  const [loadedPlugins, setLoadedPlugins] = useState(new Map())

  const slotRegistryRef = useRef(createSlotRegistry())
  const musicSourceRegistryRef = useRef(new Map())
  const lyricsProviderRegistryRef = useRef(new Map())
  const deactivatorsRef = useRef(new Map())

  useEffect(() => {
    slotRegistryRef.current.setOnChange((newSlots) => setSlots(newSlots))
  }, [])

  const musicSourceReg = useRef({
    set(pluginId, provider) {
      musicSourceRegistryRef.current.set(pluginId, provider)
      setMusicSources(new Map(musicSourceRegistryRef.current))
    }
  })

  const lyricsProviderReg = useRef({
    set(pluginId, provider) {
      lyricsProviderRegistryRef.current.set(pluginId, provider)
      setLyricsProviders(new Map(lyricsProviderRegistryRef.current))
    }
  })

  const activateRendererPlugin = useCallback(
    (payload) => {
      const { manifest, rendererCode, stylesCode, locales } = payload
      const pluginId = manifest.id

      if (stylesCode) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', pluginId)
        style.textContent = stylesCode
        document.head.appendChild(style)
      }

      if (locales) {
        for (const [lang, translations] of Object.entries(locales)) {
          pluginEventBus.emit('plugin:i18n-add', { pluginId, locale: lang, translations })
        }
      }

      if (!rendererCode) return

      try {
        const echoAPI = buildRendererPluginAPI(pluginId, {
          slotRegistry: slotRegistryRef.current,
          musicSourceRegistry: musicSourceReg.current,
          lyricsProviderRegistry: lyricsProviderReg.current
        })

        const moduleExports = {}
        const pluginModule = { exports: moduleExports }

        // eslint-disable-next-line no-new-func
        const factory = new Function(
          'module',
          'exports',
          'echo',
          'React',
          rendererCode
        )
        factory(pluginModule, moduleExports, echoAPI, React)

        const exported = pluginModule.exports || moduleExports
        if (typeof exported.activate === 'function') {
          exported.activate(echoAPI)
        }

        deactivatorsRef.current.set(pluginId, () => {
          if (typeof exported.deactivate === 'function') {
            exported.deactivate(echoAPI)
          }
          slotRegistryRef.current.unregisterAll(pluginId)
          pluginEventBus.removeAllForPlugin(pluginId)
          musicSourceRegistryRef.current.delete(pluginId)
          lyricsProviderRegistryRef.current.delete(pluginId)
          setMusicSources(new Map(musicSourceRegistryRef.current))
          setLyricsProviders(new Map(lyricsProviderRegistryRef.current))

          const styleEl = document.querySelector(`style[data-plugin="${pluginId}"]`)
          if (styleEl) styleEl.remove()
        })

        setLoadedPlugins((prev) => {
          const next = new Map(prev)
          next.set(pluginId, { manifest, echoAPI })
          return next
        })
      } catch (e) {
        console.error(`[PluginHost] failed to activate renderer plugin ${pluginId}:`, e)
      }
    },
    []
  )

  const deactivateRendererPlugin = useCallback((pluginId) => {
    const cleanup = deactivatorsRef.current.get(pluginId)
    if (cleanup) {
      try { cleanup() } catch (e) {
        console.error(`[PluginHost] deactivate error for ${pluginId}:`, e)
      }
      deactivatorsRef.current.delete(pluginId)
    }
    setLoadedPlugins((prev) => {
      const next = new Map(prev)
      next.delete(pluginId)
      return next
    })
  }, [])

  const refreshPluginList = useCallback(async () => {
    if (!window.api?.plugin?.list) return
    const list = await window.api.plugin.list()
    setPluginList(list)
    return list
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!window.api?.plugin) return
      const list = await window.api.plugin.list()
      if (cancelled) return
      setPluginList(list)

      const payloads = await window.api.plugin.getActiveRendererPayloads()
      if (cancelled) return
      for (const p of payloads) {
        activateRendererPlugin(p)
      }
    }

    init()

    const offListChanged = window.api?.plugin?.onListChanged?.((list) => {
      if (cancelled) return
      setPluginList(list)

      const activeIds = new Set(list.filter((p) => p.active).map((p) => p.id))
      for (const id of deactivatorsRef.current.keys()) {
        if (!activeIds.has(id)) {
          deactivateRendererPlugin(id)
        }
      }

      for (const plugin of list) {
        if (plugin.active && !deactivatorsRef.current.has(plugin.id) && plugin.hasRenderer) {
          window.api.plugin.getRendererPayload(plugin.id).then((payload) => {
            if (payload && !cancelled) activateRendererPlugin(payload)
          })
        }
      }
    })

    return () => {
      cancelled = true
      offListChanged?.()
    }
  }, [activateRendererPlugin, deactivateRendererPlugin])

  const ctx = {
    pluginList,
    slots,
    musicSources,
    lyricsProviders,
    loadedPlugins,
    eventBus: pluginEventBus,
    refreshPluginList,
    getSlotEntries: (name) => slotRegistryRef.current.getSlot(name)
  }

  return <PluginContext.Provider value={ctx}>{children}</PluginContext.Provider>
}
