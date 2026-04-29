import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, RefreshCcw, Smartphone, X, ShieldAlert, UserX } from 'lucide-react'
import { UiButton } from './ui'

function formatClientTime(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return new Date(n).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function PhoneRemoteDrawer({
  open,
  onClose,
  t,
  config,
  status,
  busy,
  onStart,
  onStop,
  onRefresh,
  onRotateToken,
  onKickClient,
  onConfigChange
}) {
  const [qrDataUrl, setQrDataUrl] = useState('')
  const primaryUrl = status?.primaryUrl || ''
  const localUrl = status?.localUrl || ''
  const networkUrls = Array.isArray(status?.urls) ? status.urls.filter(Boolean) : []
  const clients = Array.isArray(status?.clients) ? status.clients : []
  const enabled = config.phoneRemoteEnabled === true

  const statusText = useMemo(() => {
    if (!enabled) return t('remote.statusStopped', 'Stopped')
    if (status?.listening) return t('remote.statusReady', 'Ready')
    if (status?.lastError) return status.lastError
    return t('remote.statusStarting', 'Starting')
  }, [enabled, status, t])

  useEffect(() => {
    if (!open || !primaryUrl) {
      setQrDataUrl('')
      return undefined
    }
    let cancelled = false
    QRCode.toDataURL(primaryUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 288,
      color: {
        dark: '#211d26',
        light: '#ffffffff'
      }
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [open, primaryUrl])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const copyUrl = async () => {
    if (!primaryUrl) return
    await window.api?.writeClipboardText?.(primaryUrl)
  }

  const copyLocalUrl = async () => {
    if (!localUrl) return
    await window.api?.writeClipboardText?.(localUrl)
  }

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
        aria-label={t('remote.drawerTitle', 'Phone Remote')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title">{t('remote.drawerTitle', 'Phone Remote')}</h2>
          <button
            type="button"
            className="lyrics-drawer-close"
            onClick={onClose}
            aria-label={t('aria.close')}
          >
            <X size={20} />
          </button>
        </div>

        <div className="lyrics-drawer-body md-drawer-body phone-remote-drawer">
          <section className="listen-together-section phone-remote-hero">
            <div className="phone-remote-hero-title">
              <Smartphone size={20} />
              <div>
                <strong>{t('remote.heroTitle', 'Control ECHO from your phone')}</strong>
                <p>{t('remote.heroDesc', 'Scan the QR code on the same Wi-Fi network.')}</p>
              </div>
            </div>
            <div className={`lyrics-drawer-status ${enabled ? 'ok' : 'pending'}`}>
              <span className={`lyrics-drawer-status-dot ${enabled ? 'ok' : 'pending'}`} />
              <span>{statusText}</span>
            </div>
          </section>

          <section className="listen-together-section phone-remote-qr-section">
            <div className="phone-remote-qr">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={t('remote.qrAlt', 'Phone remote QR code')} />
              ) : (
                <Smartphone size={48} />
              )}
            </div>
            <div className="phone-remote-url-row">
              <code>{primaryUrl || t('remote.noUrl', 'Start the server to get a URL')}</code>
              <button
                type="button"
                className="lyrics-drawer-icon-btn"
                onClick={copyUrl}
                disabled={!primaryUrl}
                title={t('remote.copyUrl', 'Copy URL')}
              >
                <Copy size={16} />
              </button>
            </div>
            {localUrl && localUrl !== primaryUrl ? (
              <div className="phone-remote-url-row phone-remote-url-row--secondary">
                <code>
                  {t('remote.localTestUrl', 'This PC')}: {localUrl}
                </code>
                <button
                  type="button"
                  className="lyrics-drawer-icon-btn"
                  onClick={copyLocalUrl}
                  title={t('remote.copyLocalUrl', 'Copy local test URL')}
                >
                  <Copy size={16} />
                </button>
              </div>
            ) : null}
            <div className="phone-remote-actions">
              <UiButton
                variant={enabled ? 'secondary' : 'primary'}
                size="sm"
                onClick={enabled ? onStop : onStart}
                disabled={busy}
              >
                {enabled ? t('remote.stop', 'Stop') : t('remote.start', 'Start')}
              </UiButton>
              <UiButton variant="secondary" size="sm" onClick={onRefresh} disabled={busy}>
                <RefreshCcw size={14} />
                {t('remote.refresh', 'Refresh')}
              </UiButton>
              <UiButton variant="secondary" size="sm" onClick={onRotateToken} disabled={busy}>
                {t('remote.rotateToken', 'Rotate token')}
              </UiButton>
            </div>
          </section>

          <section className="listen-together-section">
            <h3 className="lyrics-drawer-section-title">
              {t('remote.network', 'Network')}
            </h3>
            <label className="lyrics-drawer-label-row">
              <span className="lyrics-drawer-label">{t('remote.port', 'Port')}</span>
              <input
                className="lyrics-drawer-text-input"
                type="number"
                min={1}
                max={65534}
                value={config.phoneRemotePort || 18888}
                onChange={(event) =>
                  onConfigChange({
                    phoneRemotePort: Math.max(
                      1,
                      Math.min(65534, Number.parseInt(event.target.value, 10) || 18888)
                    )
                  })
                }
                style={{ maxWidth: 128 }}
              />
            </label>
            <label className="lyrics-drawer-check phone-remote-warning">
              <input
                type="checkbox"
                className="lyrics-drawer-check-input"
                checked={config.phoneRemoteAllowNoToken === true}
                onChange={(event) =>
                  onConfigChange({ phoneRemoteAllowNoToken: event.target.checked })
                }
              />
              <span>
                <strong>
                  <ShieldAlert size={14} /> {t('remote.noTokenTitle', 'Allow no-token LAN mode')}
                </strong>
                <small>
                  {t(
                    'remote.noTokenDesc',
                    'Only enable this on a trusted private LAN. Existing clients reconnect when this changes.'
                  )}
                </small>
              </span>
            </label>
            {networkUrls.length > 1 ? (
              <div className="phone-remote-network-list">
                <span className="lyrics-drawer-label">
                  {t('remote.availableUrls', 'Available LAN URLs')}
                </span>
                {networkUrls.map((url) => (
                  <code key={url}>{url}</code>
                ))}
              </div>
            ) : null}
          </section>

          <section className="listen-together-section">
            <h3 className="lyrics-drawer-section-title">
              {t('remote.clients', { count: clients.length, defaultValue: 'Clients' })}
            </h3>
            {clients.length > 0 ? (
              <div className="phone-remote-client-list">
                {clients.map((client) => (
                  <div key={client.id} className="phone-remote-client">
                    <div>
                      <strong>{client.ip || t('remote.unknownClient', 'Unknown device')}</strong>
                      <small>
                        {formatClientTime(client.connectedAt)}
                        {client.userAgent ? ` · ${client.userAgent}` : ''}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="lyrics-drawer-icon-btn"
                      onClick={() => onKickClient(client.id)}
                      title={t('remote.kick', 'Kick client')}
                    >
                      <UserX size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="lyrics-drawer-hint">
                {t('remote.noClients', 'No phone is connected yet.')}
              </p>
            )}
          </section>
        </div>
      </aside>
    </>
  )
}
