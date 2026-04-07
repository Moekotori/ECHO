import React from 'react'

/**
 * Catches render errors so the window does not stay blank white without feedback.
 */
export default class RendererErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[RendererErrorBoundary]', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error?.message || String(this.state.error)
      return (
        <div
          style={{
            minHeight: '100vh',
            boxSizing: 'border-box',
            padding: 24,
            background: '#0f1117',
            color: '#fecaca',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14
          }}
        >
          <h1 style={{ color: '#fff', fontSize: 18, marginTop: 0 }}>Interface failed to load</h1>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 12 }}>{msg}</pre>
          <p style={{ color: '#94a3b8', marginTop: 16 }}>
            Open DevTools (if available) for the full stack trace, or restart the app.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
