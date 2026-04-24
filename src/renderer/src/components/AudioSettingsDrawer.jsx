import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  Headphones,
  Settings2,
  Zap,
  Lock,
  Unlock,
  CheckCircle2,
  Radio,
  Gauge,
  Shield,
  Disc3
} from 'lucide-react'

function formatHz(hz) {
  if (!hz || hz <= 0) return '—'
  if (hz >= 1000000) return `${(hz / 1000000).toFixed(hz % 1000000 === 0 ? 0 : 1)} MHz`
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`
  return `${hz} Hz`
}

function dsdLabel(rate) {
  if (!rate || rate <= 0) return null
  if (rate >= 11289600) return 'DSD256'
  if (rate >= 5644800) return 'DSD128'
  if (rate >= 2822400) return 'DSD64'
  return 'DSD'
}

function codecLabel(codec) {
  if (!codec) return ''
  const upper = codec.toUpperCase()
  if (upper === 'MPEG') return 'MP3'
  return upper
}

export default function AudioSettingsDrawer({ open, onClose, audioDevices, config, setConfig }) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const [engineInfo, setEngineInfo] = useState(null)
  const [asioDevices, setAsioDevices] = useState([])
  const [asioDeviceId, setAsioDeviceId] = useState(null)
  const [asioMode, setAsioMode] = useState(false)
  const activeDeviceId = config?.audioDeviceId ?? ''
  const isExclusive = config?.audioExclusive === true
  const bufferProfile = config?.audioOutputBufferProfile || 'balanced'

  useEffect(() => {
    if (!open) return
    const handler = (status) => {
      if (status) {
        setEngineInfo({
          nativeBridge: !!status.nativeBridge,
          exclusive: !!status.exclusive,
          exclusiveConfirmed: !!status.exclusiveConfirmed,
          asio: !!status.asio,
          fileSampleRate: status.fileSampleRate || 0,
          outputSampleRate: status.outputSampleRate || 0,
          codec: status.codec || '',
          bitsPerSample: status.bitsPerSample || 0,
          isDSD: !!status.isDSD,
          dsdRate: status.dsdRate || 0,
          bitPerfect: !!status.bitPerfect,
          useEQ: !!status.useEQ
        })
      }
    }
    if (window.api?.onAudioStatus) {
      return window.api.onAudioStatus(handler)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!window.api?.getAsioDevices) return
    window.api.getAsioDevices().then((devices) => {
      setAsioDevices(Array.isArray(devices) ? devices : [])
    })
  }, [open])

  useEffect(() => {
    if (engineInfo?.asio) setAsioMode(true)
  }, [engineInfo?.asio])

  useEffect(() => {
    if (engineInfo?.asio === false) {
      setAsioMode((prev) => (prev && asioDeviceId != null ? prev : false))
    }
  }, [engineInfo?.asio, asioDeviceId])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleDeviceChange = useCallback(
    async (id) => {
      if (window.api?.setAsioMode) {
        await window.api.setAsioMode(false)
      }
      if (window.api?.setAudioDevice) {
        await window.api.setAudioDevice(id ?? '')
      }
      setAsioMode(false)
      setAsioDeviceId(null)
      setConfig((prev) => ({
        ...prev,
        audioDeviceId: id ?? ''
      }))
    },
    [setConfig]
  )

  const handleAsioDeviceChange = useCallback(async (id) => {
    if (window.api?.setAsioMode) {
      await window.api.setAsioMode(true)
    }
    if (window.api?.setAudioDevice) {
      await window.api.setAudioDevice(id)
    }
    setAsioMode(true)
    setAsioDeviceId(id)
  }, [])

  const handleExclusiveSwitch = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      audioExclusive: !(prev.audioExclusive === true)
    }))
  }, [setConfig])

  const handleExclusiveStartupSwitch = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      audioExclusiveResetOnStartup: !(prev.audioExclusiveResetOnStartup !== false)
    }))
  }, [setConfig])

  const handleBufferProfileChange = useCallback(
    (prof) => {
      setConfig((prev) => ({
        ...prev,
        audioOutputBufferProfile: prof
      }))
    },
    [setConfig]
  )

  const bufferOptions = [
    { key: 'low', label: t('settings.bufferProfiles.low', 'Low Latency'), sub: '256 frames' },
    {
      key: 'balanced',
      label: t('settings.bufferProfiles.balanced', 'Balanced'),
      sub: '512 frames'
    },
    { key: 'stable', label: t('settings.bufferProfiles.stable', 'Stable'), sub: '1024 frames' }
  ]

  const isHiFi = engineInfo?.nativeBridge
  const srSource = engineInfo?.fileSampleRate
  const srOut = engineInfo?.outputSampleRate
  const codec = engineInfo?.codec
  const bits = engineInfo?.bitsPerSample
  const isDSD = engineInfo?.isDSD
  const dsdTag = isDSD ? dsdLabel(engineInfo?.dsdRate) : null
  const bitPerfect = engineInfo?.bitPerfect
  const useEQ = engineInfo?.useEQ
  const hasAsioDevices = asioDevices.length > 0
  const isAsioSelected = asioMode || engineInfo?.asio

  const signalNodes = []
  if (codec || isDSD) {
    if (isDSD && dsdTag) {
      signalNodes.push({ label: `${codecLabel(codec)} ${dsdTag}`, type: 'source' })
    } else if (codec) {
      const bitsText = bits > 0 ? ` ${bits}bit` : ''
      signalNodes.push({ label: `${codecLabel(codec)}${bitsText}`, type: 'source' })
    }
  }
  if (srSource > 0) signalNodes.push({ label: formatHz(srSource), type: 'rate' })
  if (isDSD) signalNodes.push({ label: t('settings.dsdToPcm', 'PCM Convert'), type: 'process' })
  if (useEQ) signalNodes.push({ label: 'EQ', type: 'process' })
  if (isHiFi) signalNodes.push({ label: 'Native Bridge', type: 'engine' })
  if (srOut > 0 && srOut !== srSource) signalNodes.push({ label: formatHz(srOut), type: 'rate' })

  return (
    <>
      <div
        className={`lyrics-drawer-backdrop ${open ? 'lyrics-drawer-backdrop--open' : ''}`}
        onClick={onClose}
      />
      <div className={`lyrics-drawer-panel ${open ? 'lyrics-drawer-panel--open' : ''}`}>
        {/* Header */}
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title">
            <Settings2 size={18} />
            {t('settings.audioTitle', 'Audio Settings')}
          </h2>
          <button className="lyrics-drawer-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="lyrics-drawer-body">
          {/* Engine status */}
          <div className={`audio-drawer-engine-badge ${isHiFi ? 'hifi' : ''}`}>
            <Zap size={15} className="audio-drawer-engine-icon" />
            <div className="audio-drawer-engine-details">
              <div className="audio-drawer-engine-row">
                <span className="audio-drawer-engine-name">
                  {isHiFi ? 'HiFi Engine' : 'Standard Engine'}
                </span>
                {engineInfo?.exclusiveConfirmed && (
                  <span className="audio-drawer-tag audio-drawer-tag--exclusive">
                    <Lock size={9} /> EXCLUSIVE
                  </span>
                )}
                {bitPerfect && (
                  <span className="audio-drawer-tag audio-drawer-tag--bitperfect">
                    <Shield size={9} /> Bit-Perfect
                  </span>
                )}
                {isDSD && dsdTag && (
                  <span className="audio-drawer-tag audio-drawer-tag--dsd">
                    <Disc3 size={9} /> {dsdTag}
                  </span>
                )}
              </div>

              {(srSource > 0 || codec) && (
                <span className="audio-drawer-format-line">
                  {codec && codecLabel(codec)}
                  {codec && bits > 0 && !isDSD && ` ${bits}-bit`}
                  {codec && srSource > 0 && ' | '}
                  {srSource > 0 && formatHz(srSource)}
                  {srSource > 0 && srOut > 0 && '  \u2192  '}
                  {srOut > 0 && formatHz(srOut)}
                </span>
              )}
            </div>
          </div>

          {/* Signal Path (compact text) */}
          {signalNodes.length > 1 && (
            <p className="audio-drawer-signal-text">
              {signalNodes.map((n) => n.label).join(' \u2192 ')}
            </p>
          )}

          {/* Output Device */}
          <div className="lyrics-drawer-section">
            <div className="audio-drawer-section-header">
              <Headphones size={16} />
              <span className="audio-drawer-section-label">
                {t('settings.outputDevice', 'Output Device')}
              </span>
            </div>

            <div className="audio-drawer-device-list">
              <button
                type="button"
                className={`audio-drawer-device-btn ${!isAsioSelected && !activeDeviceId ? 'active' : ''}`}
                onClick={() => handleDeviceChange('')}
              >
                {!isAsioSelected && !activeDeviceId ? (
                  <CheckCircle2 size={15} className="audio-drawer-device-icon" />
                ) : (
                  <Radio size={15} className="audio-drawer-device-icon" />
                )}
                <span className="audio-drawer-device-name">
                  {t('settings.systemDefault', 'System Default')}
                </span>
              </button>

              {audioDevices?.map((d) => {
                const isActive = !isAsioSelected && String(activeDeviceId) === String(d.id)
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`audio-drawer-device-btn ${isActive ? 'active' : ''}`}
                    onClick={() => handleDeviceChange(d.id)}
                  >
                    {isActive ? (
                      <CheckCircle2 size={15} className="audio-drawer-device-icon" />
                    ) : (
                      <Radio size={15} className="audio-drawer-device-icon" />
                    )}
                    <span className="audio-drawer-device-name">{d.name}</span>
                    {d.sampleRate > 0 && (
                      <span className="audio-drawer-device-rate">{formatHz(d.sampleRate)}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {hasAsioDevices && (
            <div className="lyrics-drawer-section">
              <div className="audio-drawer-section-header">
                <Zap size={16} style={{ color: 'var(--accent-mint)' }} />
                <span className="audio-drawer-section-label">ASIO {t('settings.outputDevice', 'Output Device')}</span>
              </div>

              <div className="audio-drawer-device-list">
                {asioDevices.map((d) => {
                  const isActive = isAsioSelected && String(asioDeviceId) === String(d.index)
                  const displayName = String(d.name || '').replace(/^\[ASIO\]\s*/i, '')
                  return (
                    <button
                      key={`asio-${d.index}`}
                      type="button"
                      className={`audio-drawer-device-btn audio-drawer-device-btn--asio ${isActive ? 'active active-asio' : ''}`}
                      onClick={() => handleAsioDeviceChange(d.index)}
                    >
                      {isActive ? (
                        <CheckCircle2 size={15} className="audio-drawer-device-icon" />
                      ) : (
                        <Radio size={15} className="audio-drawer-device-icon" />
                      )}
                      <span className="audio-drawer-device-name">{displayName || d.name}</span>
                      <span className="audio-drawer-tag audio-drawer-tag--asio">ASIO</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Exclusive Mode */}
          <div className="lyrics-drawer-section">
            <div className="audio-drawer-exclusive-row">
              <div className="audio-drawer-exclusive-label">
                {isExclusive ? (
                  <Lock size={16} style={{ color: 'var(--accent-pink)' }} />
                ) : (
                  <Unlock size={16} style={{ opacity: 0.45 }} />
                )}
                <span className="audio-drawer-section-label">
                  {t('settings.exclusiveMode', 'WASAPI Exclusive')}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isAsioSelected ? false : isExclusive}
                className={`lyrics-drawer-switch ${!isAsioSelected && isExclusive ? 'on' : ''}`}
                onClick={handleExclusiveSwitch}
                disabled={isAsioSelected}
              >
                <span className="lyrics-drawer-switch-thumb" />
              </button>
            </div>
            <p className="audio-drawer-hint">
              {isAsioSelected
                ? 'ASIO mode ignores WASAPI exclusive settings.'
                : t(
                    'settings.exclusiveDesc',
                    'Bypasses Windows audio mixer for bit-perfect output. Source sample rate is preserved (e.g. 192 kHz). Other apps will be muted while active.'
                  )}
            </p>
            {engineInfo?.exclusive && !engineInfo?.exclusiveConfirmed && (
              <p className="audio-drawer-hint audio-drawer-hint--warn">
                {t(
                  'settings.exclusiveWaiting',
                  'Exclusive mode will apply on the next track start.'
                )}
              </p>
            )}
            <div className="audio-drawer-exclusive-row" style={{ marginTop: 10 }}>
              <div className="audio-drawer-exclusive-label">
                <span className="audio-drawer-section-label">
                  {t(
                    'settings.exclusiveStartupReset',
                    'Turn off exclusive mode on app startup'
                  )}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config?.audioExclusiveResetOnStartup !== false}
                className={`lyrics-drawer-switch ${config?.audioExclusiveResetOnStartup !== false ? 'on' : ''}`}
                onClick={handleExclusiveStartupSwitch}
              >
                <span className="lyrics-drawer-switch-thumb" />
              </button>
            </div>
            <p className="audio-drawer-hint">
              {t(
                'settings.exclusiveStartupResetDesc',
                'Enabled by default. Turn this off if you want WASAPI exclusive mode to stay on after restarting ECHO.'
              )}
            </p>
          </div>

          {/* Buffer Profile */}
          <div className="lyrics-drawer-section">
            <div className="audio-drawer-section-header">
              <Gauge size={16} />
              <span className="audio-drawer-section-label">
                {t('settings.bufferProfile', 'Buffer Profile')}
              </span>
            </div>

            <div className="audio-drawer-chip-row">
              {bufferOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`list-filter-chip audio-drawer-chip-col ${bufferProfile === opt.key ? 'active' : ''}`}
                  onClick={() => handleBufferProfileChange(opt.key)}
                >
                  <span className="audio-drawer-chip-label">{opt.label}</span>
                  <span className="audio-drawer-chip-sub">{opt.sub}</span>
                </button>
              ))}
            </div>

            <p className="audio-drawer-footnote">
              {t(
                'settings.bufferHint',
                'If you hear crackling or dropouts in exclusive mode, try increasing the buffer.'
              )}
            </p>
          </div>

          {/* DSD Mode */}
          {isDSD && (
            <div className="lyrics-drawer-section">
              <div className="audio-drawer-section-header">
                <Disc3 size={16} style={{ color: '#c4b5fd' }} />
                <span className="audio-drawer-section-label">
                  {t('settings.dsdMode', 'DSD Playback')}
                </span>
              </div>
              <div className="audio-drawer-chip-row">
                <button type="button" className="list-filter-chip audio-drawer-chip-col active">
                  <span className="audio-drawer-chip-label">
                    {t('settings.dsdPcm', 'PCM Conversion')}
                  </span>
                  <span className="audio-drawer-chip-sub">
                    {t('settings.dsdPcmDesc', 'Universal')}
                  </span>
                </button>
                <button
                  type="button"
                  className="list-filter-chip audio-drawer-chip-col"
                  disabled
                  style={{ opacity: 0.4, cursor: 'not-allowed' }}
                >
                  <span className="audio-drawer-chip-label">DoP</span>
                  <span className="audio-drawer-chip-sub">
                    {t('settings.dsdDopDesc', 'Coming Soon')}
                  </span>
                </button>
              </div>
              <p className="audio-drawer-footnote">
                {t(
                  'settings.dsdHint',
                  'DSD files are converted to high-resolution PCM for playback. DoP (DSD over PCM) for compatible DACs will be available in a future update.'
                )}
              </p>
            </div>
          )}

          {/* VST UI (Beta) */}
          <div className="lyrics-drawer-section">
            <div className="audio-drawer-section-header">
              <Zap size={16} style={{ color: '#fbbf24' }} />
              <span className="audio-drawer-section-label">
                {loc === 'zh' ? 'VST 音效接管 (测试版)' : 'VST Plugins (Beta)'}
              </span>
            </div>

            <div className="audio-drawer-chip-row" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="list-filter-chip audio-drawer-chip-col"
                onClick={async () => {
                  const res = await window.api.openVstPluginHandler(loc)
                  if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
                    await window.api.loadVstPlugin(res.filePaths[0])
                  }
                }}
              >
                <span className="audio-drawer-chip-label">
                  {loc === 'zh' ? '加载插件' : 'Load .dll'}
                </span>
                <span className="audio-drawer-chip-sub">
                  {loc === 'zh' ? '选择本地 VST2 插件' : 'Select Plugin'}
                </span>
              </button>

              <button
                type="button"
                className="list-filter-chip audio-drawer-chip-col"
                onClick={() => window.api.showVstPluginUI()}
              >
                <span className="audio-drawer-chip-label">
                  {loc === 'zh' ? '显示界面' : 'Show UI'}
                </span>
                <span className="audio-drawer-chip-sub">
                  {loc === 'zh' ? '打开高级面板' : 'Open GUI'}
                </span>
              </button>

              <button
                type="button"
                className="list-filter-chip audio-drawer-chip-col"
                onClick={() => window.api.disableVstPlugin()}
              >
                <span className="audio-drawer-chip-label">
                  {loc === 'zh' ? '关闭特效' : 'Disable'}
                </span>
                <span className="audio-drawer-chip-sub">
                  {loc === 'zh' ? '恢复默认音质' : 'Restore Default'}
                </span>
              </button>
            </div>
            <p className="audio-drawer-footnote" style={{ marginTop: '0.75rem', opacity: 0.8 }}>
              {loc === 'zh'
                ? '加载第三方 VST2 插件 (64位 .dll) 将通过原生引擎接管输出，提供专业级听觉体验。若无声音或报错可点击“关闭特效”一键重置。'
                : 'Loading a 64-bit VST2 (.dll) plugin will take over the audio output for enhanced playback. Click "Disable" to reset.'}
            </p>
          </div>

          <p className="audio-drawer-footnote">{t('settings.audioDrawerEqBlurb')}</p>
        </div>
      </div>
    </>
  )
}
