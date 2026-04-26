import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Search } from 'lucide-react'

/**
 * Manual LRCLIB ranked rows + NetEase search rows; user picks one row.
 */
export default function LyricsCandidatePicker({ open, loading, items, onClose, onPick, onSearch }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const overlayRef = useRef(null)

  const closePicker = useCallback(() => {
    onClose?.()
  }, [onClose])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const onKey = (e) => {
      if (e.key === 'Escape') closePicker()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closePicker])

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => overlayRef.current?.focus())
    }
  }, [open])

  const handleSearch = (e) => {
    e.preventDefault()
    if (query.trim() && onSearch) {
      onSearch(query.trim())
    }
  }

  const handlePick = (row) => {
    onPick?.(row)
    closePicker()
  }

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="lyrics-candidate-overlay no-drag"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lyrics-candidate-title"
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 12000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closePicker()
      }}
    >
      <div
        className="glass-panel lyrics-candidate-panel no-drag"
        style={{
          width: 'min(520px, 100%)',
          maxHeight: 'min(72vh, 640px)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 12,
          padding: 0,
          WebkitAppRegion: 'no-drag'
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.08)'
          }}
        >
          <h2 id="lyrics-candidate-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {t('lyricsDrawer.manualSearch', 'Manual Search')}
          </h2>
          <button
            type="button"
            onClick={closePicker}
            onPointerDown={(e) => e.stopPropagation()}
            className="lyrics-candidate-close no-drag"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              WebkitAppRegion: 'no-drag'
            }}
            aria-label={t('aria.close')}
          >
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={handleSearch}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.08)'
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('lyrics.searchPlaceholder', 'Title / Artist')}
            className="no-drag"
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              padding: '8px 12px',
              borderRadius: 6,
              outline: 'none',
              fontSize: 13
            }}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="no-drag"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: '#fff',
              padding: '8px',
              borderRadius: 6,
              cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !query.trim() ? 0.5 : 1
            }}
            aria-label={t('lyricsDrawer.manualSearch', 'Search')}
          >
            <Search size={16} />
          </button>
        </form>

        <div style={{ padding: '8px 12px 14px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <p style={{ opacity: 0.75, margin: '12px 0' }}>{t('lyrics.pickLoading')}</p>
          ) : items.length === 0 ? (
            <p style={{ opacity: 0.75, margin: '12px 0' }}>{t('lyrics.pickEmpty')}</p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6
              }}
            >
              {items.map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => handlePick(row)}
                    className="no-drag"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(255,255,255,0.04)',
                      color: 'inherit',
                      cursor: 'pointer',
                      fontSize: 13
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{row.title}</div>
                    <div style={{ opacity: 0.8, fontSize: 12 }}>
                      {row.subtitle}
                      {row.badge ? (
                        <span style={{ marginLeft: 8, opacity: 0.65 }}>{row.badge}</span>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
