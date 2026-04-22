import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, LoaderCircle, Save, Tag, X } from 'lucide-react'

function normalizeNumberDraft(value) {
  if (value === null || value === undefined || value === '') return ''
  const n = Number.parseInt(String(value), 10)
  return Number.isFinite(n) && n > 0 ? String(n) : ''
}

export default function MetadataEditorDrawer({
  open,
  onClose,
  track,
  initialMetadata,
  onSave
}) {
  const { t, i18n } = useTranslation()
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [album, setAlbum] = useState('')
  const [albumArtist, setAlbumArtist] = useState('')
  const [trackNo, setTrackNo] = useState('')
  const [discNo, setDiscNo] = useState('')
  const [coverPath, setCoverPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setBusy(false)
      setError('')
      return
    }

    setTitle(initialMetadata?.title || '')
    setArtist(initialMetadata?.artist || '')
    setAlbum(initialMetadata?.album || '')
    setAlbumArtist(initialMetadata?.albumArtist || '')
    setTrackNo(normalizeNumberDraft(initialMetadata?.trackNo))
    setDiscNo(normalizeNumberDraft(initialMetadata?.discNo))
    setCoverPath('')
    setError('')
  }, [open, initialMetadata])

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose, open])

  const loc = useMemo(() => {
    if (i18n.language.startsWith('zh')) return 'zh'
    if (i18n.language.startsWith('ja')) return 'ja'
    return 'en'
  }, [i18n.language])

  const displayCover = useMemo(() => {
    if (coverPath) return window.api?.pathToFileURL?.(coverPath) || ''
    return initialMetadata?.cover || ''
  }, [coverPath, initialMetadata?.cover])

  const selectedCoverName = useMemo(() => {
    const source = coverPath || ''
    return source.split(/[/\\]/).pop() || ''
  }, [coverPath])

  const handleChooseCover = async () => {
    try {
      const picked = await window.api?.openImageHandler?.(loc)
      if (picked) {
        setCoverPath(picked)
        setError('')
      }
    } catch (err) {
      setError(err?.message || String(err))
    }
  }

  const handleSubmit = async () => {
    if (!track?.path || !onSave) return
    setBusy(true)
    setError('')
    try {
      await onSave({
        path: track.path,
        title,
        artist,
        album,
        albumArtist,
        trackNo,
        discNo,
        coverPath: coverPath || null
      })
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
        aria-label={t('drawer.metadataEditorAria', 'Metadata editor')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag size={18} />
            {t('drawer.metadataEditorTitle', 'Edit tags')}
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

        <div className="lyrics-drawer-body metadata-drawer-body">
          <div className="metadata-drawer-hero glass-panel">
            <div className="metadata-drawer-cover">
              {displayCover ? (
                <img
                  src={displayCover}
                  alt={t('metadataEditor.coverAlt', 'Cover preview')}
                  className="metadata-drawer-cover-image"
                />
              ) : (
                <div className="metadata-drawer-cover-empty">
                  {t('metadataEditor.noCover', 'No cover')}
                </div>
              )}
            </div>
            <div className="metadata-drawer-hero-copy">
              <div className="metadata-drawer-track-name">
                {track?.name || t('metadataEditor.unknownTrack', 'Unknown track')}
              </div>
              <div className="metadata-drawer-track-path">{track?.path || ''}</div>
              <button
                type="button"
                className="export-btn metadata-drawer-cover-btn"
                onClick={handleChooseCover}
                disabled={busy}
              >
                <ImagePlus size={16} />
                {coverPath
                  ? t('metadataEditor.replaceCover', 'Replace cover')
                  : t('metadataEditor.chooseCover', 'Choose cover')}
              </button>
              {selectedCoverName ? (
                <div className="metadata-drawer-cover-note">
                  {t('metadataEditor.pendingCover', 'Pending cover')}: {selectedCoverName}
                </div>
              ) : (
                <div className="metadata-drawer-cover-note">
                  {t(
                    'metadataEditor.coverHint',
                    'Keep empty to preserve the current embedded artwork.'
                  )}
                </div>
              )}
            </div>
          </div>

          {error ? <div className="metadata-drawer-error">{error}</div> : null}

          <div className="metadata-drawer-grid">
            <label className="metadata-drawer-field">
              <span>{t('metadataEditor.fields.title', 'Title')}</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
            </label>
            <label className="metadata-drawer-field">
              <span>{t('metadataEditor.fields.artist', 'Artist')}</span>
              <input
                value={artist}
                onChange={(event) => setArtist(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="metadata-drawer-field">
              <span>{t('metadataEditor.fields.album', 'Album')}</span>
              <input value={album} onChange={(event) => setAlbum(event.target.value)} disabled={busy} />
            </label>
            <label className="metadata-drawer-field">
              <span>{t('metadataEditor.fields.albumArtist', 'Album artist')}</span>
              <input
                value={albumArtist}
                onChange={(event) => setAlbumArtist(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="metadata-drawer-field">
              <span>{t('metadataEditor.fields.trackNo', 'Track #')}</span>
              <input
                inputMode="numeric"
                value={trackNo}
                onChange={(event) => setTrackNo(event.target.value.replace(/[^\d]/g, ''))}
                disabled={busy}
              />
            </label>
            <label className="metadata-drawer-field">
              <span>{t('metadataEditor.fields.discNo', 'Disc #')}</span>
              <input
                inputMode="numeric"
                value={discNo}
                onChange={(event) => setDiscNo(event.target.value.replace(/[^\d]/g, ''))}
                disabled={busy}
              />
            </label>
          </div>

          <p className="metadata-drawer-footnote">
            {t(
              'metadataEditor.saveHint',
              'Changes are written back to the source audio file and reflected in the library immediately.'
            )}
          </p>

          <div className="metadata-drawer-actions">
            <button type="button" className="export-btn secondary" onClick={onClose} disabled={busy}>
              {t('metadataEditor.cancel', 'Cancel')}
            </button>
            <button type="button" className="export-btn" onClick={handleSubmit} disabled={busy}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
              {busy ? t('metadataEditor.saving', 'Saving…') : t('metadataEditor.save', 'Save tags')}
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
