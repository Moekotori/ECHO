import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const DEFAULT_COLORS = {
  text: '#fff8f5',
  secondary: '#ffc8b8',
  karaoke: '#ffffff',
  glow: '#ff8866',
  romaji: '#e8d0c8'
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim())
  if (!m) return { r: 255, g: 136, b: 102 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function makeGlow(hex, extraDark = true) {
  const { r, g, b } = hexToRgb(hex)
  const layers = [
    `0 0 1px rgba(${r},${g},${b},0.92)`,
    `0 0 3px rgba(${r},${g},${b},0.5)`,
    `0 1px 10px rgba(0,0,0,${extraDark ? 0.48 : 0.35})`
  ]
  return layers.join(', ')
}

function normalizePayload(p) {
  const c = p?.colors && typeof p.colors === 'object' ? p.colors : {}
  return {
    prev: typeof p?.prev === 'string' ? p.prev : '',
    current: typeof p?.current === 'string' ? p.current : '',
    next: typeof p?.next === 'string' ? p.next : '',
    prevRomaji: typeof p?.prevRomaji === 'string' ? p.prevRomaji : '',
    currentRomaji: typeof p?.currentRomaji === 'string' ? p.currentRomaji : '',
    nextRomaji: typeof p?.nextRomaji === 'string' ? p.nextRomaji : '',
    showPrev: p?.showPrev !== false,
    showNext: p?.showNext !== false,
    showRomaji: p?.showRomaji === true,
    wordHighlight: p?.wordHighlight !== false,
    lyricTimelineValid: p?.lyricTimelineValid === true,
    karaokeProgress:
      typeof p?.karaokeProgress === 'number' && Number.isFinite(p.karaokeProgress)
        ? Math.min(1, Math.max(0, p.karaokeProgress))
        : 0,
    title: typeof p?.title === 'string' ? p.title : '',
    fontPx: typeof p?.fontPx === 'number' && p.fontPx > 8 ? p.fontPx : 26,
    colors: {
      text: typeof c.text === 'string' && c.text ? c.text : DEFAULT_COLORS.text,
      secondary: typeof c.secondary === 'string' && c.secondary ? c.secondary : DEFAULT_COLORS.secondary,
      karaoke: typeof c.karaoke === 'string' && c.karaoke ? c.karaoke : DEFAULT_COLORS.karaoke,
      glow: typeof c.glow === 'string' && c.glow ? c.glow : DEFAULT_COLORS.glow,
      romaji: typeof c.romaji === 'string' && c.romaji ? c.romaji : DEFAULT_COLORS.romaji
    }
  }
}

/** All fields that affect React layout; omit karaokeProgress so progress-only IPC does not re-render. */
function contentKey(d) {
  const { karaokeProgress: _k, ...rest } = d
  return JSON.stringify(rest)
}

function applyKaraokeWidth(el, progress) {
  if (!el) return
  const pct = Math.min(100, Math.max(0, progress * 100))
  el.style.width = `${pct}%`
}

/**
 * Transparent always-on-top lyrics overlay (?mode=lyrics-desktop).
 */
export default function LyricsDesktop() {
  const { t } = useTranslation()
  const [data, setData] = useState(() => ({
    prev: '',
    current: '',
    next: '',
    prevRomaji: '',
    currentRomaji: '',
    nextRomaji: '',
    showPrev: true,
    showNext: true,
    showRomaji: false,
    wordHighlight: false,
    lyricTimelineValid: false,
    karaokeProgress: 0,
    title: '',
    fontPx: 26,
    colors: { ...DEFAULT_COLORS }
  }))

  const latestRef = useRef(data)
  const lastKeyRef = useRef('')
  const karaokeHlRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') void window.api?.dismissLyricsDesktop?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const transparent = 'transparent'
    document.documentElement.style.background = transparent
    document.documentElement.style.height = '100%'
    document.body.style.margin = '0'
    document.body.style.minHeight = '100%'
    document.body.style.background = transparent
    document.body.style.overflow = 'hidden'
    const root = document.getElementById('root')
    if (root) {
      root.style.minHeight = '100%'
      root.style.margin = '0'
      root.style.background = transparent
    }
  }, [])

  useEffect(() => {
    if (!window.api?.onLyricsDesktopData) return undefined
    const unsub = window.api.onLyricsDesktopData((p) => {
      const n = normalizePayload(p)
      latestRef.current = n

      const key = contentKey(n)
      const karaokeOn = n.wordHighlight && n.lyricTimelineValid && n.current.length > 0
      if (karaokeOn) {
        applyKaraokeWidth(karaokeHlRef.current, n.karaokeProgress)
      }

      if (key !== lastKeyRef.current) {
        lastKeyRef.current = key
        setData(n)
      }
    })
    void window.api?.notifyLyricsDesktopReady?.()
    return unsub
  }, [])

  useLayoutEffect(() => {
    const n = latestRef.current
    if (n.wordHighlight && n.lyricTimelineValid && n.current) {
      applyKaraokeWidth(karaokeHlRef.current, n.karaokeProgress)
    }
  }, [data])

  const {
    prev,
    current,
    next,
    prevRomaji,
    currentRomaji,
    nextRomaji,
    showPrev,
    showNext,
    showRomaji,
    wordHighlight,
    lyricTimelineValid,
    title,
    fontPx,
    colors
  } = data

  const glowPrimary = useMemo(() => makeGlow(colors.glow), [colors.glow])
  const glowSecondary = useMemo(() => makeGlow(colors.secondary, true), [colors.secondary])

  const useKaraoke = wordHighlight && lyricTimelineValid && current.length > 0

  const renderLine = (text, rom, { size, weight, opacity, marginBottom, isSecondary }) => {
    if (!text) return null
    const glow = isSecondary ? glowSecondary : glowPrimary
    const color = isSecondary ? colors.secondary : colors.text
    return (
      <div style={{ marginBottom: marginBottom ?? 0 }}>
        <div
          style={{
            color,
            textShadow: glow,
            fontSize: size,
            fontWeight: weight,
            opacity,
            lineHeight: 1.35,
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {text}
        </div>
        {showRomaji && rom ? (
          <div
            style={{
              color: colors.romaji,
              textShadow: glowSecondary,
              fontSize: Math.max(11, size * 0.42),
              fontWeight: 600,
              opacity: opacity * 0.92,
              marginTop: 4,
              lineHeight: 1.3,
              textAlign: 'center'
            }}
          >
            {rom}
          </div>
        ) : null}
      </div>
    )
  }

  const renderCurrent = () => {
    const glow = glowPrimary
    const mb = next && showNext ? 6 : showRomaji && currentRomaji ? 4 : 0

    const romajiBlock =
      showRomaji && currentRomaji ? (
        <div
          style={{
            color: colors.romaji,
            textShadow: glowSecondary,
            fontSize: Math.max(11, fontPx * 0.42),
            fontWeight: 600,
            marginTop: 6,
            lineHeight: 1.3,
            textAlign: 'center'
          }}
        >
          {currentRomaji}
        </div>
      ) : null

    if (!useKaraoke) {
      return (
        <div style={{ marginBottom: mb }}>
          <div
            style={{
              color: colors.text,
              textShadow: glow,
              fontSize: fontPx,
              fontWeight: 700,
              lineHeight: 1.35,
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {current || '—'}
          </div>
          {romajiBlock}
        </div>
      )
    }

    return (
      <div style={{ marginBottom: mb, width: '100%', textAlign: 'center' }}>
        <span
          style={{
            position: 'relative',
            display: 'inline-block',
            maxWidth: '100%',
            verticalAlign: 'top'
          }}
        >
          <span
            style={{
              display: 'block',
              color: colors.text,
              textShadow: glow,
              fontSize: fontPx,
              fontWeight: 700,
              lineHeight: 1.35,
              whiteSpace: 'nowrap'
            }}
          >
            {current}
          </span>
          <span
            ref={karaokeHlRef}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              width: '0%',
              maxWidth: '100%',
              display: 'block',
              color: colors.karaoke,
              textShadow: glow,
              fontSize: fontPx,
              fontWeight: 700,
              lineHeight: 1.35,
              pointerEvents: 'none',
              textAlign: 'left',
              willChange: 'width',
              transform: 'translateZ(0)'
            }}
          >
            {current}
          </span>
        </span>
        {romajiBlock}
      </div>
    )
  }

  return (
    <div
      role="presentation"
      onContextMenu={(e) => {
        e.preventDefault()
        void window.api?.dismissLyricsDesktop?.()
      }}
      title={title ? `${title} — ${t('lyrics.desktopLyricsChromeHint')}` : t('lyrics.desktopLyricsChromeHint')}
      style={{
        minHeight: '100vh',
        width: '100%',
        margin: 0,
        boxSizing: 'border-box',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '12px 20px 16px',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        overflow: 'hidden',
        WebkitAppRegion: 'drag',
        cursor: 'grab'
      }}
    >
      <div
        style={{
          textAlign: 'center',
          maxWidth: 'min(96vw, 920px)'
        }}
      >
        {showPrev && prev
          ? renderLine(prev, prevRomaji, {
              size: Math.max(12, fontPx * 0.4),
              weight: 600,
              opacity: 0.58,
              marginBottom: 6,
              isSecondary: true
            })
          : null}
        {renderCurrent()}
        {showNext && next
          ? renderLine(next, nextRomaji, {
              size: Math.max(13, fontPx * 0.48),
              weight: 600,
              opacity: 0.75,
              marginBottom: 0,
              isSecondary: true
            })
          : null}
      </div>
    </div>
  )
}
