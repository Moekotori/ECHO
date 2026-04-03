import vm from 'vm'

const SAFE_CONSOLE = Object.freeze({
  log: (...a) => console.log('[Plugin]', ...a),
  warn: (...a) => console.warn('[Plugin]', ...a),
  error: (...a) => console.error('[Plugin]', ...a),
  info: (...a) => console.info('[Plugin]', ...a),
  debug: (...a) => console.debug('[Plugin]', ...a)
})

/**
 * Execute plugin main-process code inside a vm sandbox.
 * Returns `{ activate, deactivate }` exported by the plugin,
 * or `null` on failure.
 */
export function runPluginInSandbox(code, echoAPI, { pluginId, timeout = 5000 }) {
  const exports = {}
  const module = { exports }

  const sandbox = vm.createContext({
    console: SAFE_CONSOLE,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    URL,
    TextEncoder,
    TextDecoder,
    module,
    exports,
    echo: Object.freeze(echoAPI)
  })

  try {
    const script = new vm.Script(
      `(function(module, exports, echo) {\n${code}\n})(module, exports, echo);`,
      { filename: `plugin:${pluginId}`, timeout }
    )
    script.runInContext(sandbox, { timeout })
  } catch (e) {
    console.error(`[PluginSandbox:${pluginId}] execution error:`, e?.message || e)
    return null
  }

  const result = module.exports || exports
  return {
    activate: typeof result.activate === 'function' ? result.activate : null,
    deactivate: typeof result.deactivate === 'function' ? result.deactivate : null
  }
}
