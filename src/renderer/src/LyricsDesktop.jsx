import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

/**
 * Minimal always-on-top lyrics strip (loaded with ?mode=lyrics-desktop).
 */
export default function LyricsDesktop() {
  const [data, setData] = useState({
    prev: '',
    current: '',
    next: '',
    title: '',
    fontPx: 26
  })

  useEffect(() => {
    document.documentElement.style.height = '100%'
    document.body.style.margin = '0'
    document.body.style.minHeight = '100%'
    document.body.style.background = '#0b1220'
    const root = document.getElementById('root')
    if (root) {
      root.style.minHeight = '100%'
      root.style.margin = '0'
    }
  }, [])

  useEffect(() => {
    if (!window.api?.onLyricsDesktopData) return undefined
    return window.api.onLyricsDesktopData((p) => {
      setData({
        prev: typeof p?.prev === 'string' ? p.prev : '',
        current: typeof p?.current === 'string' ? p.current : '',
        next: typeof p?.next === 'string' ? p.next : '',
        title: typeof p?.title === 'string' ? p.title : '',
        fontPx: typeof p?.fontPx === 'number' && p.fontPx > 8 ? p.fontPx : 26
      })
    })
  }, [])

  const { prev, current, next, title, fontPx } = data

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        margin: 0,
        boxSizing: 'border-box',
        background: 'rgba(6, 8, 14, 0.42)',
        color: '#f4f7ff',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '6px 14px 10px',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        overflow: 'hidden',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.08)'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
          WebkitAppRegion: 'drag'
        }}
      >
        <span
          style={{
            fontSize: 11,
            opacity: 0.65,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '78%'
          }}
        >
          {title || 'ECHO'}
        </span>
        <button
          type="button"
          onClick={() => window.api?.closeLyricsDesktop?.()}
          style={{
            WebkitAppRegion: 'no-drag',
            border: 'none',
            background: 'rgba(255,255,255,0.08)',
            color: 'inherit',
            borderRadius: 6,
            padding: 4,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
      {prev ? (
        <div style={{ fontSize: Math.max(11, fontPx * 0.42), opacity: 0.45, marginBottom: 4 }}>{prev}</div>
      ) : null}
      <div
        style={{
          fontSize: fontPx,
          fontWeight: 700,
          lineHeight: 1.25,
          textShadow: '0 1px 12px rgba(0,0,0,0.55)',
          marginBottom: next ? 4 : 0
        }}
      >
        {current || '—'}
      </div>
      {next ? (
        <div style={{ fontSize: Math.max(11, fontPx * 0.45), opacity: 0.5 }}>{next}</div>
      ) : null}
    </div>
  )
}
