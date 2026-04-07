import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

/**
 * Manual LRCLIB ranked rows + NetEase search rows; user picks one row.
 */
export default function LyricsCandidatePicker({
  open,
  loading,
  items,
  onClose,
  onPick
}) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="lyrics-candidate-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lyrics-candidate-title"
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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="glass-panel lyrics-candidate-panel"
        style={{
          width: 'min(520px, 100%)',
          maxHeight: 'min(72vh, 640px)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 12,
          padding: 0
        }}
        onMouseDown={(e) => e.stopPropagation()}
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
            {t('lyrics.pickTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="lyrics-candidate-close"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            aria-label={t('aria.close')}
          >
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: '8px 12px 14px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <p style={{ opacity: 0.75, margin: '12px 0' }}>{t('lyrics.pickLoading')}</p>
          ) : items.length === 0 ? (
            <p style={{ opacity: 0.75, margin: '12px 0' }}>{t('lyrics.pickEmpty')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => onPick(row)}
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
