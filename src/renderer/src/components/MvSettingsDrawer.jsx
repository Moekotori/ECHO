import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ToggleLeft, ToggleRight, Link, Play, Minus, Plus } from 'lucide-react'
import { extractVideoId } from '../utils/mvUrlParse'

const QUALITY_LABELS = {
  tiny: '144p',
  small: '240p',
  medium: '360p',
  large: '480p',
  hd720: '720p',
  hd1080: '1080p',
  hd1440: '1440p',
  hd2160: '4K',
  highres: '4K+'
}

function getMvQualityPresentation(mvId, mvPlaybackQuality, biliDirectStream, t) {
  if (!mvPlaybackQuality) return null
  const label = QUALITY_LABELS[mvPlaybackQuality] || mvPlaybackQuality
  if (mvId?.source === 'bilibili') {
    if (biliDirectStream?.ok) {
      return {
        badge: label,
        inline: label,
        hint: t('mvDrawer.hintBiliDirect', {
          format: biliDirectStream.format?.toUpperCase() || 'DASH'
        }),
        pillClass: 'mv-drawer-quality-live'
      }
    }
    return {
      badge: `~${label}`,
      inline: `~${label}`,
      hint: t('mvDrawer.hintBiliEmbed'),
      pillClass: 'mv-drawer-quality-estimate'
    }
  }
  return {
    badge: label,
    inline: label,
    hint: t('mvDrawer.hintYoutube'),
    pillClass: 'mv-drawer-quality-live'
  }
}

export default function MvSettingsDrawer({
  open,
  onClose,
  config,
  setConfig,
  signInStatus,
  onYoutubeSignIn,
  onBilibiliSignIn,
  mvId,
  setMvId,
  mvPlaybackQuality,
  biliDirectStream,
  onPersistMvOverride,
  onRestartPlayback
}) {
  const { t } = useTranslation()
  const [customUrl, setCustomUrl] = useState('')
  const [urlError, setUrlError] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      setUrlError('')
    }
  }, [open])

  const handleCustomMv = useCallback(() => {
    setUrlError('')
    const result = extractVideoId(customUrl)
    if (!result) {
      setUrlError(t('mvDrawer.urlError'))
      return
    }
    const next = { id: result.id, source: result.source }
    setMvId(next)
    if (onPersistMvOverride) onPersistMvOverride(next)
    setCustomUrl('')
    if (onRestartPlayback) onRestartPlayback()
  }, [customUrl, setMvId, onPersistMvOverride, onRestartPlayback, t])

  const selectStyle = {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    background: 'rgba(255,255,255,0.08)',
    color: 'var(--text-main)',
    outline: 'none',
    width: '100%',
    maxWidth: 220
  }

  const qualityPres = getMvQualityPresentation(mvId, mvPlaybackQuality, biliDirectStream, t)

  const mvOffsetMs = config.mvOffsetMs ?? 0

  return (
    <>
      <div
        className={`lyrics-drawer-backdrop ${open ? 'lyrics-drawer-backdrop--open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`lyrics-drawer-panel ${open ? 'lyrics-drawer-panel--open' : ''}`}
        role="dialog"
        aria-label={t('drawer.mvAria')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title">{t('drawer.mvTitle')}</h2>
          <button
            type="button"
            className="lyrics-drawer-close"
            onClick={onClose}
            aria-label={t('aria.close')}
          >
            <X size={20} />
          </button>
        </div>

        <div className="lyrics-drawer-body">
          {/* Custom MV */}
          <section className="mv-drawer-section">
            <h3 className="mv-drawer-section-title">
              <Link size={16} />
              {t('mvDrawer.customMv')}
            </h3>
            <p className="mv-drawer-hint">{t('mvDrawer.customHint')}</p>
            <div className="mv-drawer-url-row">
              <input
                type="text"
                className="mv-drawer-url-input"
                placeholder={t('mvDrawer.urlPlaceholder')}
                value={customUrl}
                onChange={(e) => {
                  setCustomUrl(e.target.value)
                  setUrlError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomMv()
                }}
              />
              <button
                type="button"
                className="mv-drawer-url-btn"
                onClick={handleCustomMv}
                disabled={!customUrl.trim()}
              >
                <Play size={16} />
              </button>
            </div>
            {urlError && <p className="mv-drawer-url-error">{urlError}</p>}
            {mvId && (
              <div
                className={`mv-drawer-now-playing-box ${qualityPres ? 'mv-drawer-now-playing-box--stack' : ''}`}
              >
                <p className="mv-drawer-now-playing">
                  {t('mvDrawer.nowPlaying', {
                    source: mvId.source,
                    id: mvId.id
                  })}
                </p>
                {qualityPres && (
                  <>
                    <span className="mv-drawer-quality-badge">{qualityPres.badge}</span>
                    <span className="mv-drawer-quality-hint">{qualityPres.hint}</span>
                  </>
                )}
              </div>
            )}
          </section>

          {/* Playback */}
          <section className="mv-drawer-section">
            <h3 className="mv-drawer-section-title">{t('mvDrawer.playback')}</h3>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">{t('mvDrawer.enableMv')}</span>
              </div>
              <button
                className={`toggle-btn ${config.enableMV ? 'active' : ''}`}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    enableMV: !prev.enableMV
                  }))
                  if (config.enableMV && !config.mvAsBackground) setMvId(null)
                }}
              >
                {config.enableMV ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
              </button>
            </div>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">{t('mvDrawer.mvSource')}</span>
              </div>
              <select
                value={config.mvSource || 'bilibili'}
                onChange={(e) => setConfig((prev) => ({ ...prev, mvSource: e.target.value }))}
                style={selectStyle}
              >
                <option value="youtube">YouTube</option>
                <option value="bilibili">Bilibili</option>
              </select>
            </div>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">
                  {t('mvDrawer.videoQuality')}
                  {qualityPres && (
                    <span className={qualityPres.pillClass}>{qualityPres.inline}</span>
                  )}
                </span>
              </div>
              <select
                value={config.mvQuality || 'high'}
                onChange={(e) => setConfig((prev) => ({ ...prev, mvQuality: e.target.value }))}
                style={selectStyle}
              >
                <option value="ultra">{t('mvDrawer.qualityUltra')}</option>
                <option value="highfps">{t('mvDrawer.qualityHighFps')}</option>
                <option value="high">{t('mvDrawer.qualityHigh')}</option>
                <option value="medium">{t('mvDrawer.qualityMedium')}</option>
                <option value="low">{t('mvDrawer.qualityLow')}</option>
              </select>
            </div>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">{t('mvDrawer.muteMv')}</span>
              </div>
              <button
                className={`toggle-btn ${config.mvMuted ? 'active' : ''}`}
                onClick={() => setConfig((prev) => ({ ...prev, mvMuted: !prev.mvMuted }))}
              >
                {config.mvMuted ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
              </button>
            </div>

            <div className="lyrics-drawer-offset" style={{ marginTop: 8 }}>
              <span className="lyrics-drawer-label">{t('mvDrawer.mvSyncOffset')}</span>
              <div className="lyrics-drawer-offset-controls">
                <button
                  type="button"
                  className="lyrics-drawer-icon-btn"
                  onClick={() =>
                    setConfig((p) => ({
                      ...p,
                      mvOffsetMs: (p.mvOffsetMs ?? 0) - 50
                    }))
                  }
                  aria-label={t('lyricsDrawer.decrease50')}
                >
                  <Minus size={18} />
                </button>
                <span className="lyrics-drawer-offset-value">
                  {mvOffsetMs > 0 ? '+' : ''}
                  {mvOffsetMs} ms
                </span>
                <button
                  type="button"
                  className="lyrics-drawer-icon-btn"
                  onClick={() =>
                    setConfig((p) => ({
                      ...p,
                      mvOffsetMs: (p.mvOffsetMs ?? 0) + 50
                    }))
                  }
                  aria-label={t('lyricsDrawer.increase50')}
                >
                  <Plus size={18} />
                </button>
              </div>
              <p className="lyrics-drawer-hint">{t('mvDrawer.mvSyncOffsetHint')}</p>
            </div>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">{t('mvDrawer.autoFallback')}</span>
              </div>
              <button
                className={`toggle-btn ${config.autoFallbackToBilibili ? 'active' : ''}`}
                onClick={() =>
                  setConfig((prev) => ({
                    ...prev,
                    autoFallbackToBilibili: !prev.autoFallbackToBilibili
                  }))
                }
              >
                {config.autoFallbackToBilibili ? (
                  <ToggleRight size={28} />
                ) : (
                  <ToggleLeft size={28} />
                )}
              </button>
            </div>
          </section>

          {/* Immersive Background */}
          <section className="mv-drawer-section">
            <h3 className="mv-drawer-section-title">{t('mvDrawer.immersive')}</h3>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">{t('mvDrawer.mvAsBg')}</span>
              </div>
              <button
                className={`toggle-btn ${config.mvAsBackground ? 'active' : ''}`}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    mvAsBackground: !prev.mvAsBackground
                  }))
                  if (config.mvAsBackground && !config.enableMV) setMvId(null)
                }}
              >
                {config.mvAsBackground ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
              </button>
            </div>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">{t('mvDrawer.mvAsBgMain')}</span>
              </div>
              <button
                className={`toggle-btn ${config.mvAsBackgroundMain ? 'active' : ''}`}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    mvAsBackgroundMain: !prev.mvAsBackgroundMain
                  }))
                  if (config.mvAsBackgroundMain && !config.enableMV) setMvId(null)
                }}
              >
                {config.mvAsBackgroundMain ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
              </button>
            </div>

            {(config.mvAsBackground || config.mvAsBackgroundMain) && (
              <div className="mv-drawer-row">
                <div className="mv-drawer-row-info">
                  <span className="mv-drawer-label">{t('mvDrawer.bgOpacity')}</span>
                  <span className="mv-drawer-value">
                    {Math.round(
                      (config.mvBackgroundOpacity !== undefined
                        ? config.mvBackgroundOpacity
                        : 0.8) * 100
                    )}
                    %
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={
                    config.mvBackgroundOpacity !== undefined ? config.mvBackgroundOpacity : 0.8
                  }
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      mvBackgroundOpacity: parseFloat(e.target.value)
                    }))
                  }
                  style={{ flex: 1, maxWidth: 180 }}
                />
              </div>
            )}

            {(config.mvAsBackground || config.mvAsBackgroundMain) && (
              <div className="mv-drawer-row">
                <div className="mv-drawer-row-info">
                  <span className="mv-drawer-label">{t('mvDrawer.bgBlur')}</span>
                  <span className="mv-drawer-value">
                    {Math.round(
                      config.mvBackgroundBlur !== undefined ? config.mvBackgroundBlur : 0
                    )}
                    px
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={1}
                  value={config.mvBackgroundBlur !== undefined ? config.mvBackgroundBlur : 0}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      mvBackgroundBlur: parseInt(e.target.value, 10)
                    }))
                  }
                  style={{ flex: 1, maxWidth: 180 }}
                />
              </div>
            )}

            {config.mvAsBackground && (
              <>
                <div className="mv-drawer-row">
                  <div className="mv-drawer-row-info">
                    <span className="mv-drawer-label">{t('mvDrawer.hideImmersiveChrome')}</span>
                  </div>
                  <button
                    type="button"
                    className={`toggle-btn ${config.mvHideImmersiveChrome ? 'active' : ''}`}
                    onClick={() =>
                      setConfig((prev) => ({
                        ...prev,
                        mvHideImmersiveChrome: !prev.mvHideImmersiveChrome
                      }))
                    }
                  >
                    {config.mvHideImmersiveChrome ? (
                      <ToggleRight size={28} />
                    ) : (
                      <ToggleLeft size={28} />
                    )}
                  </button>
                </div>
                <p className="lyrics-drawer-hint">{t('mvDrawer.hideImmersiveChromeHint')}</p>
              </>
            )}
          </section>

          {/* Account */}
          <section className="mv-drawer-section">
            <h3 className="mv-drawer-section-title">{t('mvDrawer.account')}</h3>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">
                  YouTube
                  {signInStatus.youtube ? (
                    <span className="signin-badge signed-in">{t('mvDrawer.signedIn')}</span>
                  ) : (
                    <span className="signin-badge not-signed">{t('mvDrawer.notSignedIn')}</span>
                  )}
                </span>
              </div>
              <button type="button" className="mv-drawer-action-btn" onClick={onYoutubeSignIn}>
                {signInStatus.youtube ? t('mvDrawer.reSignIn') : t('mvDrawer.signIn')}
              </button>
            </div>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">
                  Bilibili
                  {signInStatus.bilibili ? (
                    <span className="signin-badge signed-in">{t('mvDrawer.signedIn')}</span>
                  ) : (
                    <span className="signin-badge not-signed">{t('mvDrawer.notSignedIn')}</span>
                  )}
                </span>
              </div>
              <button type="button" className="mv-drawer-action-btn" onClick={onBilibiliSignIn}>
                {signInStatus.bilibili ? t('mvDrawer.reSignIn') : t('mvDrawer.signIn')}
              </button>
            </div>
          </section>
        </div>
      </aside>
    </>
  )
}
