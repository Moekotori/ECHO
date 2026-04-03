/**
 * Renderer-side event bus for plugin hooks and notifications.
 *
 * Two categories:
 *   - **hooks** (tap/call): interceptable, async waterfall with priority.
 *   - **events** (on/emit): fire-and-forget notifications.
 */
class PluginEventBus {
  /** @type {Map<string, Array<{ pluginId: string, priority: number, handler: Function }>>} */
  _hooks = new Map()
  /** @type {Map<string, Set<Function>>} */
  _listeners = new Map()

  /**
   * Register an interceptable hook handler.
   * Lower priority numbers run first.
   */
  tap(hookName, { pluginId, priority = 10, handler }) {
    if (!this._hooks.has(hookName)) this._hooks.set(hookName, [])
    const list = this._hooks.get(hookName)
    list.push({ pluginId, priority, handler })
    list.sort((a, b) => a.priority - b.priority)
  }

  untap(hookName, pluginId) {
    const list = this._hooks.get(hookName)
    if (!list) return
    this._hooks.set(
      hookName,
      list.filter((h) => h.pluginId !== pluginId)
    )
  }

  untapAll(pluginId) {
    for (const [name, list] of this._hooks) {
      this._hooks.set(
        name,
        list.filter((h) => h.pluginId !== pluginId)
      )
    }
  }

  /**
   * Invoke a hook chain. Each handler receives `context` and can mutate it.
   * If any handler returns `{ __cancel: true }`, the chain stops early.
   * Returns the (possibly mutated) context.
   */
  async call(hookName, context = {}) {
    const list = this._hooks.get(hookName)
    if (!list || list.length === 0) return context

    let ctx = { ...context }
    for (const { handler, pluginId } of list) {
      try {
        const result = await handler(ctx)
        if (result && typeof result === 'object') {
          if (result.__cancel) return { ...ctx, __cancelled: true, __cancelledBy: pluginId }
          ctx = { ...ctx, ...result }
        }
      } catch (e) {
        console.error(`[PluginEventBus] hook ${hookName} error in ${pluginId}:`, e)
      }
    }
    return ctx
  }

  on(eventName, handler) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set())
    this._listeners.get(eventName).add(handler)
  }

  off(eventName, handler) {
    this._listeners.get(eventName)?.delete(handler)
  }

  emit(eventName, data) {
    const set = this._listeners.get(eventName)
    if (!set) return
    for (const fn of set) {
      try {
        fn(data)
      } catch (e) {
        console.error(`[PluginEventBus] event ${eventName} listener error:`, e)
      }
    }
  }

  removeAllForPlugin(pluginId) {
    this.untapAll(pluginId)
  }
}

const pluginEventBus = new PluginEventBus()
export default pluginEventBus
