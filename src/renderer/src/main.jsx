import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import App from './App'
import PluginHostProvider from './plugins/PluginHost'
import RendererErrorBoundary from './RendererErrorBoundary'
import './index.css'
import './styles/tokens.css'
import './styles/echo-tokens.css'
import './styles/echo-track-list.css'

const LyricsDesktop = lazy(() => import('./LyricsDesktop'))

const desktopMode =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('mode') === 'lyrics-desktop'

const lyricsDesktopFallback = (
  <div
    style={{
      minHeight: '100vh',
      margin: 0,
      background: 'transparent'
    }}
  />
)

ReactDOM.createRoot(document.getElementById('root')).render(
  desktopMode ? (
    <Suspense fallback={lyricsDesktopFallback}>
      <LyricsDesktop />
    </Suspense>
  ) : (
    <React.StrictMode>
      <RendererErrorBoundary>
        <PluginHostProvider>
          <App />
        </PluginHostProvider>
      </RendererErrorBoundary>
    </React.StrictMode>
  )
)
