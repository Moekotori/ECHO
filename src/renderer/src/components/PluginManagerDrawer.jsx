import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  Blocks,
  ToggleLeft,
  ToggleRight,
  Trash2,
  FolderOpen,
  Plus,
  ChevronRight,
  ChevronLeft,
  Shield,
  AlertCircle
} from 'lucide-react'
import { usePlugins } from '../plugins/PluginHost'

export default function PluginManagerDrawer({ open, onClose }) {
  const { t } = useTranslation()
  const plugins = usePlugins()
  const [list, setList] = useState([])
  const [busy, setBusy] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!window.api?.plugin?.list) return
    try {
      const result = await window.api.plugin.list()
      setList(result)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setDetailId(null)
      setError(null)
      return
    }
    refresh()
    const off = window.api?.plugin?.onListChanged?.((newList) => setList(newList))
    return () => off?.()
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (detailId) setDetailId(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, detailId])

  const handleToggle = async (id, currentlyEnabled) => {
    setBusy(id)
    setError(null)
    try {
      if (currentlyEnabled) {
        await window.api.plugin.disable(id)
      } else {
        await window.api.plugin.enable(id)
      }
      await refresh()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  const handleUninstall = async (id) => {
    setBusy(id)
    setError(null)
    try {
      const result = await window.api.plugin.uninstall(id)
      if (!result?.ok) setError(result?.error || 'uninstall failed')
      setDetailId(null)
      await refresh()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  const handleInstall = async () => {
    setError(null)
    try {
      const result = await window.api.plugin.selectInstallDir()
      if (result?.ok) await refresh()
      else if (result?.error && result.error !== 'canceled') setError(result.error)
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  const handleOpenDir = async () => {
    try {
      await window.api.plugin.openPluginsDir()
    } catch {
      /* ignore */
    }
  }

  const detail = detailId ? list.find((p) => p.id === detailId) : null

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
        aria-label={t('plugins.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2
            className="lyrics-drawer-title"
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Blocks size={20} />
            {t('plugins.title')}
          </h2>
          <button
            type="button"
            className="lyrics-drawer-close"
            onClick={onClose}
            aria-label={t('aria.close')}
          >
            <X size={20} />
          </button>
        </div>

        <div className="lyrics-drawer-body md-drawer-body" style={{ maxWidth: 480 }}>
          {error && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '10px 12px',
                borderRadius: 'var(--border-radius-sm)',
                background: 'rgba(255,80,80,0.12)',
                fontSize: 13,
                marginBottom: 12
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {!detail ? (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button
                  type="button"
                  className="export-btn"
                  style={{ flex: 1 }}
                  onClick={handleInstall}
                >
                  <Plus size={16} /> {t('plugins.install')}
                </button>
                <button
                  type="button"
                  className="export-btn"
                  style={{ flex: 1 }}
                  onClick={handleOpenDir}
                >
                  <FolderOpen size={16} /> {t('plugins.openDir')}
                </button>
              </div>

              {list.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '40px 16px',
                    opacity: 0.5,
                    fontSize: 14
                  }}
                >
                  {t('plugins.empty')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {list.map((plugin) => (
                    <div
                      key={plugin.id}
                      className="glass-panel"
                      style={{
                        padding: '12px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        cursor: 'pointer',
                        transition: 'background 0.2s'
                      }}
                      onClick={() => setDetailId(plugin.id)}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = ''
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 14,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {plugin.name}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            opacity: 0.6,
                            marginTop: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          v{plugin.version}
                          {plugin.author ? ` · ${plugin.author}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: 4,
                          display: 'flex',
                          opacity: busy === plugin.id ? 0.4 : 1
                        }}
                        disabled={busy === plugin.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleToggle(plugin.id, plugin.enabled)
                        }}
                        title={plugin.enabled ? t('plugins.disable') : t('plugins.enable')}
                      >
                        {plugin.enabled ? (
                          <ToggleRight size={22} style={{ color: 'var(--accent-pink)' }} />
                        ) : (
                          <ToggleLeft size={22} style={{ opacity: 0.5 }} />
                        )}
                      </button>
                      <ChevronRight size={16} style={{ opacity: 0.4, flexShrink: 0 }} />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div>
              <button
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 0',
                  marginBottom: 16,
                  fontSize: 13,
                  opacity: 0.7
                }}
                onClick={() => setDetailId(null)}
              >
                <ChevronLeft size={16} /> {t('plugins.backToList')}
              </button>

              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{detail.name}</h3>
              <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 16 }}>
                v{detail.version}
                {detail.author ? ` · ${detail.author}` : ''}
              </div>

              {detail.description && (
                <p style={{ fontSize: 14, opacity: 0.85, lineHeight: 1.5, marginBottom: 16 }}>
                  {detail.description}
                </p>
              )}

              <div className="glass-panel" style={{ padding: '12px 14px', marginBottom: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 8
                  }}
                >
                  <Shield size={14} /> {t('plugins.permissions')}
                </div>
                {detail.permissions && detail.permissions.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {detail.permissions.map((perm) => (
                      <span
                        key={perm}
                        style={{
                          padding: '3px 10px',
                          borderRadius: 'var(--border-radius-sm)',
                          background: 'rgba(255,255,255,0.08)',
                          fontSize: 12
                        }}
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: 12, opacity: 0.5 }}>{t('plugins.noPermissions')}</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                <span style={{ fontSize: 12, opacity: 0.5 }}>
                  {detail.hasMain ? 'Main ' : ''}
                  {detail.hasRenderer ? 'Renderer ' : ''}
                  {detail.hasStyles ? 'Styles' : ''}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="export-btn"
                  style={{ flex: 1 }}
                  disabled={busy === detail.id}
                  onClick={() => handleToggle(detail.id, detail.enabled)}
                >
                  {detail.enabled ? (
                    <>
                      <ToggleRight size={16} /> {t('plugins.disable')}
                    </>
                  ) : (
                    <>
                      <ToggleLeft size={16} /> {t('plugins.enable')}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="export-btn"
                  style={{
                    background: 'rgba(255,70,70,0.15)',
                    borderColor: 'rgba(255,70,70,0.3)'
                  }}
                  disabled={busy === detail.id}
                  onClick={() => {
                    if (window.confirm(t('plugins.confirmUninstall', { name: detail.name }))) {
                      handleUninstall(detail.id)
                    }
                  }}
                >
                  <Trash2 size={16} /> {t('plugins.uninstall')}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
