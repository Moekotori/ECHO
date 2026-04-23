import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FilePenLine, LoaderCircle, Pencil, Save, X } from 'lucide-react'
import { buildRenamePreview } from '../utils/fileRename'

const TEMPLATE_KEYS = ['artistTitle', 'trackTitle', 'trackArtistTitle']

export default function BatchRenameDrawer({
  open,
  onClose,
  tracks,
  scopeLabel,
  onApply
}) {
  const { t } = useTranslation()
  const [templateKey, setTemplateKey] = useState('artistTitle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setTemplateKey('artistTitle')
      setBusy(false)
      setError('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose, open])

  const preview = useMemo(() => buildRenamePreview(tracks, templateKey), [templateKey, tracks])
  const changedItems = useMemo(() => preview.filter((item) => item.changed), [preview])

  const templateOptions = useMemo(
    () =>
      TEMPLATE_KEYS.map((key) => ({
        key,
        label: t(`batchRename.templates.${key}.label`),
        example: t(`batchRename.templates.${key}.example`)
      })),
    [t]
  )

  const handleApply = async () => {
    if (!changedItems.length || !onApply) return
    setBusy(true)
    setError('')
    try {
      await onApply(changedItems)
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        className={`lyrics-drawer-backdrop ${open ? 'lyrics-drawer-backdrop--open' : ''}`}
        onClick={() => {
          if (!busy) onClose()
        }}
        aria-hidden={!open}
      />
      <aside
        className={`lyrics-drawer-panel ${open ? 'lyrics-drawer-panel--open' : ''}`}
        role="dialog"
        aria-label={t('drawer.batchRenameAria', 'Batch rename files')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FilePenLine size={18} />
            {t('drawer.batchRenameTitle', 'Rename files')}
          </h2>
          <button
            type="button"
            className="lyrics-drawer-close"
            onClick={onClose}
            aria-label={t('aria.close')}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>

        <div className="lyrics-drawer-body batch-rename-body">
          <div className="batch-rename-hero glass-panel">
            <div className="batch-rename-hero-line">
              <span className="batch-rename-hero-label">
                {t('batchRename.scope', 'Scope')}
              </span>
              <span className="batch-rename-hero-value">{scopeLabel}</span>
            </div>
            <div className="batch-rename-hero-line">
              <span className="batch-rename-hero-label">
                {t('batchRename.trackCount', 'Tracks')}
              </span>
              <span className="batch-rename-hero-value">
                {t('playlists.detailTrackCount', { count: tracks.length })}
              </span>
            </div>
            <div className="batch-rename-hero-line">
              <span className="batch-rename-hero-label">
                {t('batchRename.willChange', 'Will rename')}
              </span>
              <span className="batch-rename-hero-value">{changedItems.length}</span>
            </div>
          </div>

          <div className="batch-rename-template-row">
            {templateOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`list-filter-chip batch-rename-template ${templateKey === option.key ? 'active' : ''}`}
                onClick={() => setTemplateKey(option.key)}
                disabled={busy}
              >
                <span>{option.label}</span>
                <small>{option.example}</small>
              </button>
            ))}
          </div>

          {error ? <div className="metadata-drawer-error">{error}</div> : null}

          <div className="batch-rename-preview">
            {preview.slice(0, 80).map((item) => (
              <div
                key={item.from}
                className={`batch-rename-preview-row${item.changed ? ' changed' : ''}`}
              >
                <div className="batch-rename-preview-current">{item.currentName}</div>
                <Pencil size={14} aria-hidden className="batch-rename-preview-arrow" />
                <div className="batch-rename-preview-next">{item.nextName}</div>
              </div>
            ))}
            {preview.length > 80 ? (
              <div className="batch-rename-preview-more">
                {t('batchRename.morePreview', {
                  count: preview.length - 80,
                  defaultValue: `and ${preview.length - 80} more…`
                })}
              </div>
            ) : null}
          </div>

          <p className="metadata-drawer-footnote">
            {t(
              'batchRename.hint',
              'Only local files are renamed. Tags and library references are kept in sync automatically.'
            )}
          </p>

          <div className="metadata-drawer-actions">
            <button type="button" className="export-btn secondary" onClick={onClose} disabled={busy}>
              {t('batchRename.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              className="export-btn"
              onClick={handleApply}
              disabled={busy || changedItems.length === 0}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
              {busy
                ? t('batchRename.renaming', 'Renaming…')
                : t('batchRename.apply', 'Apply rename')}
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
