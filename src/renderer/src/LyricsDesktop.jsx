import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const DEFAULT_COLORS = {
  text: '#fff8f5',
  secondary: '#ffc8b8',
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

/** Injected once: line enter animation for desktop lyrics (prev / current / next). */
const LYRICS_DESKTOP_STYLE_ID = 'lyrics-desktop-line-anim'

function injectLyricsDesktopLineStyles() {
  if (typeof document === 'undefined' || document.getElementById(LYRICS_DESKTOP_STYLE_ID)) return
  const s = document.createElement('style')
  s.id = LYRICS_DESKTOP_STYLE_ID
  s.textContent = `
@keyframes lyrics-desk-line-enter {
  from {
    opacity: 0;
    transform: translate3d(0, var(--lyrics-desk-dy, 10px), 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
.lyrics-desk-line {
  animation: lyrics-desk-line-enter var(--lyrics-desk-dur, 0.34s) cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--lyrics-desk-delay, 0s);
}
.lyrics-desk-line--secondary {
  --lyrics-desk-dy: 7px;
  --lyrics-desk-dur: 0.26s;
}
.lyrics-desk-line--current {
  --lyrics-desk-dy: 11px;
  --lyrics-desk-dur: 0.38s;
}
@media (prefers-reduced-motion: reduce) {
  .lyrics-desk-line {
    animation: none !important;
  }
}
`
  document.head.appendChild(s)
}

/** Avoid aggressive mid-word breaks; overflow-wrap only for very long unspaced tokens. */
const DESKTOP_LYRIC_TEXT = {
  textAlign: 'center',
  whiteSpace: 'pre-wrap',
  wordBreak: 'normal',
  overflowWrap: 'break-word'
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
    noLyrics: p?.noLyrics === true,
    title: typeof p?.title === 'string' ? p.title : '',
    fontPx: typeof p?.fontPx === 'number' && p.fontPx > 8 ? p.fontPx : 26,
    colors: {
      text: typeof c.text === 'string' && c.text ? c.text : DEFAULT_COLORS.text,
      secondary: typeof c.secondary === 'string' && c.secondary ? c.secondary : DEFAULT_COLORS.secondary,
      glow: typeof c.glow === 'string' && c.glow ? c.glow : DEFAULT_COLORS.glow,
      romaji: typeof c.romaji === 'string' && c.romaji ? c.romaji : DEFAULT_COLORS.romaji
    }
  }
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
    noLyrics: false,
    title: '',
    fontPx: 26,
    colors: { ...DEFAULT_COLORS }
  }))

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') void window.api?.dismissLyricsDesktop?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    injectLyricsDesktopLineStyles()
    return () => {
      const el = document.getElementById(LYRICS_DESKTOP_STYLE_ID)
      if (el) el.remove()
    }
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
      root.style.minHeight = 'min-content'
      root.style.margin = '0'
      root.style.background = transparent
    }
  }, [])

  useEffect(() => {
    if (!window.api?.onLyricsDesktopData) return undefined
    const unsub = window.api.onLyricsDesktopData((p) => {
      setData(normalizePayload(p))
    })
    void window.api?.notifyLyricsDesktopReady?.()
    return unsub
  }, [])

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
    noLyrics,
    title,
    fontPx,
    colors
  } = data

  const glowPrimary = useMemo(() => makeGlow(colors.glow), [colors.glow])
  const glowSecondary = useMemo(() => makeGlow(colors.secondary, true), [colors.secondary])

  const renderLine = (text, rom, { size, weight, opacity, marginBottom, isSecondary, animDelaySec = 0 }) => {
    if (!text) return null
    const glow = isSecondary ? glowSecondary : glowPrimary
    const color = isSecondary ? colors.secondary : colors.text
    return (
      <div
        key={text}
        className={`lyrics-desk-line${isSecondary ? ' lyrics-desk-line--secondary' : ''}`}
        style={{
          marginBottom: marginBottom ?? 0,
          ...(animDelaySec > 0 ? { ['--lyrics-desk-delay']: `${animDelaySec}s` } : null)
        }}
      >
        <div
          style={{
            ...DESKTOP_LYRIC_TEXT,
            color,
            textShadow: glow,
            fontSize: size,
            fontWeight: weight,
            opacity,
            lineHeight: 1.35
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

  const mb = next && showNext ? 6 : showRomaji && currentRomaji ? 4 : 0

  return (
    <div
      role="presentation"
      data-lyrics-hit
      onContextMenu={(e) => {
        e.preventDefault()
        void window.api?.dismissLyricsDesktop?.()
      }}
      title={title ? `${title} — ${t('lyrics.desktopLyricsChromeHint')}` : t('lyrics.desktopLyricsChromeHint')}
      style={{
        minHeight: '100%',
        width: '100%',
        margin: 0,
        boxSizing: 'border-box',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        WebkitUserSelect: 'none',
        userSelect: 'none',
        overflow: 'hidden',
        pointerEvents: 'auto',
        WebkitAppRegion: 'drag',
        cursor: 'grab'
      }}
    >
      <div
        style={{
          boxSizing: 'border-box',
          width: '100%',
          maxWidth: '100%',
          textAlign: 'center',
          padding: '4px 12px',
          background: 'transparent',
          borderRadius: 12,
          opacity: noLyrics ? 0 : 1,
          pointerEvents: noLyrics ? 'none' : undefined,
          transition: 'opacity 0.3s ease'
        }}
      >
        {showPrev && prev
          ? renderLine(prev, prevRomaji, {
              size: Math.max(12, fontPx * 0.4),
              weight: 600,
              opacity: 0.58,
              marginBottom: 6,
              isSecondary: true,
              animDelaySec: 0
            })
          : null}
        <div
          key={current || '__empty__'}
          className="lyrics-desk-line lyrics-desk-line--current"
          style={{
            marginBottom: mb,
            ['--lyrics-desk-delay']: '0.04s'
          }}
        >
          <div
            style={{
              ...DESKTOP_LYRIC_TEXT,
              color: colors.text,
              textShadow: glowPrimary,
              fontSize: fontPx,
              fontWeight: 700,
              lineHeight: 1.35
            }}
          >
            {current || '—'}
          </div>
          {showRomaji && currentRomaji ? (
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
          ) : null}
        </div>
        {showNext && next
          ? renderLine(next, nextRomaji, {
              size: Math.max(13, fontPx * 0.48),
              weight: 600,
              opacity: 0.75,
              marginBottom: 0,
              isSecondary: true,
              animDelaySec: 0.08
            })
          : null}
      </div>
    </div>
  )
}
