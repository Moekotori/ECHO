import React, { Component } from 'react'
import { usePlugins } from './PluginHost'

class PluginErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(
      `[PluginSlot] Plugin "${this.props.pluginId}" crashed:`,
      error,
      info?.componentStack
    )
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="plugin-slot-error"
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(255,70,70,0.12)',
            color: '#ff8888',
            fontSize: '12px',
            margin: '4px 0'
          }}
        >
          Plugin "{this.props.pluginId}" error
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * Renders all plugin-contributed components for a given slot name.
 * Place `<PluginSlot name="sidebar" />` in App.jsx where plugins can inject UI.
 */
export default function PluginSlot({ name, context, style, className }) {
  const plugins = usePlugins()
  if (!plugins) return null

  const entries = plugins.getSlotEntries(name)
  if (!entries || entries.length === 0) return null

  return (
    <div className={`plugin-slot plugin-slot--${name} ${className || ''}`} style={style}>
      {entries.map((entry) => {
        const Comp = entry.component
        if (!Comp) return null
        return (
          <PluginErrorBoundary key={entry.pluginId} pluginId={entry.pluginId}>
            <Comp context={context} pluginId={entry.pluginId} />
          </PluginErrorBoundary>
        )
      })}
    </div>
  )
}
