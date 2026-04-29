import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Cast, RefreshCw, Play, Pause, Square, Volume2, AlertCircle } from 'lucide-react'

function deviceLabel(device) {
  return [device?.manufacturer, device?.modelName].filter(Boolean).join(' · ')
}

export default function CastSendDrawer({
  open,
  onClose,
  t,
  currentTrack,
  isLocalPlaying,
  onLocalTakeover
}) {
  const [status, setStatus] = useState(null)
  const [devices, setDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [volume, setVolume] = useState(0.7)
  const [mode, setMode] = useState('takeover')

  const activeDeviceId = status?.activeDeviceId || selectedDeviceId
  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === activeDeviceId) || devices[0] || null,
    [activeDeviceId, devices]
  )

  const applyStatus = useCallback((nextStatus) => {
    if (!nextStatus) return
    setStatus(nextStatus)
    if (Array.isArray(nextStatus.devices)) {
      setDevices(nextStatus.devices)
      setSelectedDeviceId((prev) => prev || nextStatus.activeDeviceId || nextStatus.devices[0]?.id || '')
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    if (!window.api?.castSend?.getStatus) return
    const nextStatus = await window.api.castSend.getStatus()
    applyStatus(nextStatus)
  }, [applyStatus])

  const discover = useCallback(async () => {
    if (!window.api?.castSend?.discover) return
    setBusy(true)
    try {
      const result = await window.api.castSend.discover()
      if (result?.devices) {
        setDevices(result.devices)
        setSelectedDeviceId((prev) => prev || result.devices[0]?.id || '')
      }
      await refreshStatus()
    } catch (error) {
      setStatus((prev) => ({ ...(prev || {}), lastError: error?.message || String(error) }))
    } finally {
      setBusy(false)
    }
  }, [refreshStatus])

  useEffect(() => {
    if (!open) return undefined
    refreshStatus()
    const timer = window.setInterval(refreshStatus, 2500)
    return () => window.clearInterval(timer)
  }, [open, refreshStatus])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const playCurrent = async () => {
    if (!window.api?.castSend?.playTrack || !currentTrack?.path) return
    const deviceId = selectedDeviceId || selectedDevice?.id || ''
    if (!deviceId) {
      setStatus((prev) => ({ ...(prev || {}), lastError: '请先选择一个数播设备' }))
      return
    }
    setBusy(true)
    try {
      const result = await window.api.castSend.playTrack({
        deviceId,
        track: currentTrack,
        options: { mode, processed: false }
      })
      applyStatus(result?.status || result)
      if (result?.ok && mode === 'takeover' && isLocalPlaying && typeof onLocalTakeover === 'function') {
        await onLocalTakeover()
      }
    } catch (error) {
      setStatus((prev) => ({ ...(prev || {}), lastError: error?.message || String(error) }))
    } finally {
      setBusy(false)
    }
  }

  const sendCommand = async (name, payload) => {
    if (!window.api?.castSend?.[name]) return
    setBusy(true)
    try {
      const result = await window.api.castSend[name](payload ?? selectedDeviceId)
      applyStatus(result?.status || result)
    } catch (error) {
      setStatus((prev) => ({ ...(prev || {}), lastError: error?.message || String(error) }))
    } finally {
      setBusy(false)
    }
  }

  const setRemoteVolume = async () => {
    await sendCommand('setVolume', { deviceId: selectedDeviceId, volume })
  }

  const signalPath = status?.signalPath || 'Bit-Perfect'
  const activeTrack = status?.activeTrack
  const lastError = status?.lastError || ''

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
        aria-label={t?.('castSend.title', '投送到数播')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title">{t?.('castSend.title', '投送到数播')}</h2>
          <button type="button" className="lyrics-drawer-close" onClick={onClose} aria-label={t?.('aria.close', '关闭')}>
            <X size={20} />
          </button>
        </div>
        <div className="lyrics-drawer-body md-drawer-body" style={{ maxWidth: 460 }}>
          <p style={{ opacity: 0.86, fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
            {t?.(
              'castSend.intro',
              '把当前音乐通过 UPnP/DLNA 投送给 Eversolo、HiFi Rose、FiiO、Marantz 等数播。默认直通原文件，优先保持 bit-perfect。'
            )}
          </p>

          <button
            type="button"
            className="export-btn"
            style={{ width: '100%', marginBottom: 12 }}
            disabled={busy}
            onClick={discover}
          >
            <RefreshCw size={16} />
            {busy ? t?.('castSend.working', '正在处理...') : t?.('castSend.discover', '扫描数播设备')}
          </button>

          <div className="glass-panel" style={{ padding: 12, marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 800, opacity: 0.7, marginBottom: 6 }}>
              {t?.('castSend.device', '目标设备')}
            </label>
            <select
              value={selectedDeviceId}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 'var(--border-radius-sm)',
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(0,0,0,0.15)',
                color: 'inherit',
                marginBottom: 10
              }}
            >
              <option value="">{t?.('castSend.noDevice', '未选择设备')}</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name || device.host}
                </option>
              ))}
            </select>
            {selectedDevice ? (
              <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.5 }}>
                <div>{deviceLabel(selectedDevice) || selectedDevice.host}</div>
                <div>
                  DLNA {selectedDevice.supportsDlna ? 'OK' : 'N/A'} · OpenHome{' '}
                  {selectedDevice.supportsOpenHome ? 'OK' : '未检测到'}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, opacity: 0.72 }}>{t?.('castSend.empty', '还没有扫描到设备')}</div>
            )}
          </div>

          <div className="glass-panel" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <strong>{t?.('castSend.signalPath', '信号路径')}</strong>
              <span style={{ color: signalPath === 'Bit-Perfect' ? '#54d18a' : '#f0b35d', fontWeight: 800 }}>
                {signalPath}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                className={`cast-send-option ${mode === 'takeover' ? 'active' : ''}`}
                onClick={() => setMode('takeover')}
              >
                {t?.('castSend.takeover', '接管模式')}
              </button>
              <button
                type="button"
                className={`cast-send-option ${mode === 'remote' ? 'active' : ''}`}
                onClick={() => setMode('remote')}
              >
                {t?.('castSend.remoteOnly', '遥控模式')}
              </button>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 12, opacity: 0.72, lineHeight: 1.55 }}>
              {mode === 'takeover'
                ? t?.('castSend.takeoverHint', '投送成功后会暂停本机播放，声音只从数播输出。')
                : t?.('castSend.remoteHint', '本机不主动出声，只把当前曲目交给数播播放。')}
            </p>
          </div>

          <div className="glass-panel" style={{ padding: 12, marginBottom: 12 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>
              {currentTrack?.title || t?.('castSend.noTrack', '没有当前曲目')}
            </strong>
            <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.55, marginBottom: 12 }}>
              {[currentTrack?.artist, currentTrack?.album].filter(Boolean).join(' · ') || 'ECHO'}
              {currentTrack?.qualityText ? <div>{currentTrack.qualityText}</div> : null}
            </div>
            <button
              type="button"
              className="export-btn"
              style={{ width: '100%', marginBottom: 8 }}
              disabled={busy || !currentTrack?.path || !selectedDevice}
              onClick={playCurrent}
            >
              <Cast size={16} />
              {t?.('castSend.playCurrent', '投送当前曲目')}
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <button type="button" className="cast-send-option" disabled={busy} onClick={() => sendCommand('pause')}>
                <Pause size={14} /> {t?.('castSend.pause', '暂停')}
              </button>
              <button type="button" className="cast-send-option" disabled={busy} onClick={() => sendCommand('resume')}>
                <Play size={14} /> {t?.('castSend.resume', '继续')}
              </button>
              <button type="button" className="cast-send-option" disabled={busy} onClick={() => sendCommand('stop')}>
                <Square size={14} /> {t?.('castSend.stop', '停止')}
              </button>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: 12, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800 }}>
              <Volume2 size={16} /> {t?.('castSend.volume', '数播音量')} {Math.round(volume * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value) || 0)}
              onMouseUp={setRemoteVolume}
              onTouchEnd={setRemoteVolume}
              style={{ width: '100%', marginTop: 8 }}
            />
          </div>

          {activeTrack ? (
            <div className="glass-panel" style={{ padding: 12, fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
              <strong>{t?.('castSend.nowCasting', '正在投送')}</strong>
              <div>{activeTrack.title}</div>
              <div style={{ wordBreak: 'break-all', opacity: 0.72 }}>{activeTrack.streamUrl}</div>
            </div>
          ) : null}

          {lastError ? (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                padding: 10,
                borderRadius: 'var(--border-radius-sm)',
                background: 'rgba(255,80,80,0.12)',
                fontSize: 13
              }}
            >
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{lastError}</span>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  )
}
