import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, RefreshCw, Minus, Plus, Upload } from 'lucide-react'

export default function LyricsSettingsDrawer({
  open,
  onClose,
  config,
  setConfig,
  lyricsMatchStatus,
  lyricTimelineValid,
  onRefreshLyrics,
  onFetchLyricsFromLink,
  onApplyLyricsText,
  onNativeLyricsFilePick
}) {
  const { t } = useTranslation()
  const sourceOptions = useMemo(
    () => [
      { value: 'local', label: t('lyricsDrawer.sourceLocal') },
      { value: 'lrclib', label: t('lyricsDrawer.sourceLrclib') },
      { value: 'netease', label: t('lyricsDrawer.sourceNetease') },
      { value: 'qq', label: t('lyricsDrawer.sourceQq') }
    ],
    [t]
  )

  const [showTextarea, setShowTextarea] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [isOffsetDragging, setIsOffsetDragging] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!open) {
      setShowTextarea(false)
      setPasteText('')
      setDropdownOpen(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const dropdownWrapRef = useRef(null)
  useEffect(() => {
    if (!dropdownOpen) return
    const onDoc = (e) => {
      if (dropdownWrapRef.current && !dropdownWrapRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [dropdownOpen])

  const offsetMs = config.lyricsOffsetMs ?? 0
  const fontSize = config.lyricsFontSize ?? 32
  const lyricsColor = config.lyricsColor || null

  const stateDefs = useMemo(
    () => [
      { id: 'active', label: t('lyricsDrawer.stateActive') },
      { id: 'normal', label: t('lyricsDrawer.stateNormal') }
    ],
    [t]
  )

  const colorPresets = useMemo(
    () => [
      '#FFFFFF',
      '#EAF2FF',
      '#DDE7F3',
      '#BFC9D6',
      '#111827',
      '#0B1220',
      '#22D3EE',
      '#60A5FA',
      '#A78BFA',
      '#FB7185',
      '#FBBF24',
      '#86EFAC'
    ],
    []
  )

  const getColor = useCallback(
    (layer, state) => {
      const v = lyricsColor?.layers?.[layer]?.[state]
      if (!v) return null
      const hex = typeof v.hex === 'string' ? v.hex : ''
      const a = typeof v.a === 'number' ? v.a : 1
      return hex ? { hex, a } : null
    },
    [lyricsColor]
  )

  const setMainColor = useCallback(
    (state, next) => {
      setConfig((p) => {
        const prev = p.lyricsColor || { version: 1, layers: {} }
        const prevMain = prev.layers?.main || {}
        return {
          ...p,
          lyricsColor: {
            version: 1,
            layers: {
              ...(prev.layers || {}),
              main: {
                ...prevMain,
                [state]: next
              }
            }
          }
        }
      })
    },
    [setConfig]
  )

  const parseHexWithOptionalAlpha = useCallback((raw) => {
    const s = String(raw || '').trim()
    if (!s) return null
    const m = s.startsWith('#') ? s.slice(1) : s
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(m)) return null
    const hex = `#${m.slice(0, 6).toUpperCase()}`
    const a =
      m.length === 8 ? Math.max(0, Math.min(1, parseInt(m.slice(6, 8), 16) / 255)) : 1
    return { hex, a }
  }, [])

  const activeInit = getColor('main', 'active')
  const normalInit = getColor('main', 'normal')
  const [activeHexDraft, setActiveHexDraft] = useState(activeInit?.hex || '')
  const [normalHexDraft, setNormalHexDraft] = useState(normalInit?.hex || '')
  const [activeInvalid, setActiveInvalid] = useState(false)
  const [normalInvalid, setNormalInvalid] = useState(false)

  useEffect(() => {
    const a = getColor('main', 'active')
    const n = getColor('main', 'normal')
    setActiveHexDraft(a?.hex || '')
    setNormalHexDraft(n?.hex || '')
    setActiveInvalid(false)
    setNormalInvalid(false)
  }, [getColor])

  const applyPreset = useCallback(
    (state, hex) => {
      const prev = getColor('main', state)
      setMainColor(state, { hex, a: prev?.a ?? 1 })
      if (state === 'active') {
        setActiveHexDraft(hex)
        setActiveInvalid(false)
      } else {
        setNormalHexDraft(hex)
        setNormalInvalid(false)
      }
    },
    [getColor, setMainColor]
  )

  const statusLabel =
    lyricsMatchStatus === 'loading'
      ? t('lyricsDrawer.statusLoading')
      : lyricsMatchStatus === 'matched'
        ? t('lyricsDrawer.statusMatched')
        : lyricsMatchStatus === 'none'
          ? t('lyricsDrawer.statusNone')
          : t('lyricsDrawer.statusDash')

  const statusTone =
    lyricsMatchStatus === 'loading' ? 'pending' : lyricsMatchStatus === 'none' ? 'bad' : lyricsMatchStatus === 'matched' ? 'ok' : ''

  const handleDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const f = e.dataTransfer?.files?.[0]
    if (!f) return
    const name = (f.name || '').toLowerCase()
    if (!name.endsWith('.lrc') && !name.endsWith('.lrcx')) return
    if (f.path && window.api?.readBufferHandler) {
      const buf = await window.api.readBufferHandler(f.path)
      if (buf) {
        const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
        const text = new TextDecoder('utf-8').decode(u8)
        onApplyLyricsText(text)
      }
    } else {
      const text = await f.text()
      onApplyLyricsText(text)
    }
  }

  const handleApplyPaste = () => {
    if (!pasteText.trim()) return
    onApplyLyricsText(pasteText)
    setPasteText('')
    setShowTextarea(false)
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
        aria-label={t('drawer.lyricsAria')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title">{t('drawer.lyricsTitle')}</h2>
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
          <section className="lyrics-drawer-section">
            <h3 className="lyrics-drawer-section-title">{t('lyricsDrawer.displayStyle')}</h3>
            <div className="lyrics-drawer-row">
              <span className="lyrics-drawer-label">{t('lyricsDrawer.romaji')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!config.lyricsShowRomaji}
                className={`lyrics-drawer-switch ${config.lyricsShowRomaji ? 'on' : ''}`}
                onClick={() =>
                  setConfig((p) => ({
                    ...p,
                    lyricsShowRomaji: !p.lyricsShowRomaji
                  }))
                }
              >
                <span className="lyrics-drawer-switch-thumb" />
              </button>
            </div>
            <div className="lyrics-drawer-row">
              <span className="lyrics-drawer-label">{t('lyricsDrawer.translation')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!config.lyricsShowTranslation}
                className={`lyrics-drawer-switch ${config.lyricsShowTranslation ? 'on' : ''}`}
                onClick={() =>
                  setConfig((p) => ({
                    ...p,
                    lyricsShowTranslation: !p.lyricsShowTranslation
                  }))
                }
              >
                <span className="lyrics-drawer-switch-thumb" />
              </button>
            </div>
            <div className="lyrics-drawer-row">
              <span className="lyrics-drawer-label">{t('lyricsDrawer.wordHighlight')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={config.lyricsWordHighlight !== false}
                className={`lyrics-drawer-switch ${config.lyricsWordHighlight !== false ? 'on' : ''}`}
                onClick={() =>
                  setConfig((p) => ({
                    ...p,
                    lyricsWordHighlight: p.lyricsWordHighlight === false ? true : false
                  }))
                }
              >
                <span className="lyrics-drawer-switch-thumb" />
              </button>
            </div>
            <div className="lyrics-drawer-slider-block">
              <div className="lyrics-drawer-label-row">
                <span className="lyrics-drawer-label">{t('lyricsDrawer.mainLineSize')}</span>
                <span className="lyrics-drawer-value">{fontSize}px</span>
              </div>
              <input
                type="range"
                min={18}
                max={56}
                step={1}
                value={fontSize}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    lyricsFontSize: parseInt(e.target.value, 10)
                  }))
                }
                className="lyrics-drawer-range"
              />
            </div>

            <div className="lyrics-drawer-color-grid">
              <div className="lyrics-drawer-label-row">
                <span className="lyrics-drawer-label">{t('lyricsDrawer.fontColor')}</span>
                <button
                  type="button"
                  className="lyrics-drawer-btn"
                  onClick={() =>
                    setConfig((p) => ({
                      ...p,
                      lyricsColor: null,
                      lyricsFontColor: null
                    }))
                  }
                >
                  {t('lyricsDrawer.reset')}
                </button>
              </div>
              <p className="lyrics-drawer-hint">{t('lyricsDrawer.fontColorHint')}</p>

              <div className="lyrics-color-inline">
                <div className="lyrics-color-inline-row">
                  <div className="lyrics-color-inline-label">{t('lyricsDrawer.stateActive')}</div>
                  <div
                    className="lyrics-color-inline-swatch"
                    style={{
                      background: activeInit?.hex ? activeInit.hex : 'transparent'
                    }}
                  />
                  <input
                    className={`lyrics-drawer-text-input ${activeInvalid ? 'is-invalid' : ''}`}
                    value={activeHexDraft}
                    placeholder="#RRGGBB or #RRGGBBAA"
                    onChange={(e) => {
                      setActiveHexDraft(e.target.value)
                      setActiveInvalid(false)
                    }}
                    onBlur={() => {
                      if (!activeHexDraft.trim()) {
                        setMainColor('active', null)
                        setActiveInvalid(false)
                        return
                      }
                      const parsed = parseHexWithOptionalAlpha(activeHexDraft)
                      if (!parsed) {
                        setActiveInvalid(true)
                        return
                      }
                      setMainColor('active', parsed)
                      setActiveHexDraft(parsed.hex)
                      setActiveInvalid(false)
                    }}
                  />
                </div>
                <div className="lyrics-color-inline-tools">
                  <div className="lyrics-color-palette" role="group" aria-label="Active color presets">
                    {colorPresets.map((hex) => (
                      <button
                        key={`active-${hex}`}
                        type="button"
                        className="lyrics-color-preset"
                        style={{ background: hex }}
                        onClick={() => applyPreset('active', hex)}
                        aria-label={hex}
                      />
                    ))}
                  </div>
                  <label className="lyrics-color-picker">
                    <input
                      type="color"
                      value={activeInit?.hex || '#FFFFFF'}
                      onChange={(e) => applyPreset('active', e.target.value.toUpperCase())}
                      aria-label="Pick active color"
                    />
                  </label>
                </div>

                <div className="lyrics-color-inline-row">
                  <div className="lyrics-color-inline-label">{t('lyricsDrawer.stateNormal')}</div>
                  <div
                    className="lyrics-color-inline-swatch"
                    style={{
                      background: normalInit?.hex ? normalInit.hex : 'transparent'
                    }}
                  />
                  <input
                    className={`lyrics-drawer-text-input ${normalInvalid ? 'is-invalid' : ''}`}
                    value={normalHexDraft}
                    placeholder="#RRGGBB or #RRGGBBAA"
                    onChange={(e) => {
                      setNormalHexDraft(e.target.value)
                      setNormalInvalid(false)
                    }}
                    onBlur={() => {
                      if (!normalHexDraft.trim()) {
                        setMainColor('normal', null)
                        setNormalInvalid(false)
                        return
                      }
                      const parsed = parseHexWithOptionalAlpha(normalHexDraft)
                      if (!parsed) {
                        setNormalInvalid(true)
                        return
                      }
                      setMainColor('normal', parsed)
                      setNormalHexDraft(parsed.hex)
                      setNormalInvalid(false)
                    }}
                  />
                </div>
                <div className="lyrics-color-inline-tools">
                  <div className="lyrics-color-palette" role="group" aria-label="Normal color presets">
                    {colorPresets.map((hex) => (
                      <button
                        key={`normal-${hex}`}
                        type="button"
                        className="lyrics-color-preset"
                        style={{ background: hex }}
                        onClick={() => applyPreset('normal', hex)}
                        aria-label={hex}
                      />
                    ))}
                  </div>
                  <label className="lyrics-color-picker">
                    <input
                      type="color"
                      value={normalInit?.hex || '#FFFFFF'}
                      onChange={(e) => applyPreset('normal', e.target.value.toUpperCase())}
                      aria-label="Pick normal color"
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="lyrics-drawer-row">
              <span className="lyrics-drawer-label">{t('lyricsDrawer.hideLyrics')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!config.lyricsHidden}
                className={`lyrics-drawer-switch ${config.lyricsHidden ? 'on' : ''}`}
                onClick={() =>
                  setConfig((p) => ({
                    ...p,
                    lyricsHidden: !p.lyricsHidden
                  }))
                }
              >
                <span className="lyrics-drawer-switch-thumb" />
              </button>
            </div>
            {config.lyricsHidden ? (
              <p className="lyrics-drawer-hint">{t('lyricsDrawer.hideLyricsHint')}</p>
            ) : null}
          </section>

          <section className="lyrics-drawer-section">
            <h3 className="lyrics-drawer-section-title">{t('lyricsDrawer.source')}</h3>
            <div className="lyrics-drawer-status">
              <span className={`lyrics-drawer-status-dot ${statusTone}`} />
              <span>
                {t('lyricsDrawer.statusPrefix')} {statusLabel}
              </span>
            </div>
            <div className="lyrics-drawer-dropdown-wrap" ref={dropdownWrapRef}>
              <button
                type="button"
                className="lyrics-drawer-dropdown-trigger"
                onClick={() => setDropdownOpen((v) => !v)}
              >
                {sourceOptions.find((o) => o.value === config.lyricsSource)?.label ||
                  t('lyricsDrawer.selectSource')}
              </button>
              {dropdownOpen && (
                <ul className="lyrics-drawer-dropdown-menu">
                  {sourceOptions.map((o) => (
                    <li key={o.value}>
                      <button
                        type="button"
                        className={config.lyricsSource === o.value ? 'active' : ''}
                        onClick={() => {
                          setConfig((p) => ({ ...p, lyricsSource: o.value }))
                          setDropdownOpen(false)
                        }}
                      >
                        {o.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              className="lyrics-drawer-refresh"
              onClick={() => onRefreshLyrics()}
              title={t('lyricsDrawer.fetchAgainTitle')}
            >
              <RefreshCw size={16} />
              {t('lyricsDrawer.refresh')}
            </button>
            <div className="lyrics-drawer-textarea-block">
              <input
                type="text"
                className="lyrics-drawer-url-input"
                placeholder={t('lyricsDrawer.linkPlaceholder')}
                value={config.lyricsSourceLink || ''}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    lyricsSourceLink: e.target.value
                  }))
                }
              />
              <button
                type="button"
                className="lyrics-drawer-primary-btn"
                onClick={() => onFetchLyricsFromLink?.()}
              >
                {t('lyricsDrawer.fetchFromLink')}
              </button>
              <p className="lyrics-drawer-hint">{t('lyricsDrawer.linkHint')}</p>
            </div>
          </section>

          <section className="lyrics-drawer-section">
            <h3 className="lyrics-drawer-section-title">{t('lyrics.desktopLyrics')}</h3>
            <p className="lyrics-drawer-hint">{t('lyrics.desktopLyricsHint')}</p>
            <div className="lyrics-drawer-row" style={{ marginTop: 8 }}>
              <span className="lyrics-drawer-label">{t('lyrics.desktopLyricsEnable')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!config.desktopLyricsEnabled}
                className={`lyrics-drawer-switch ${config.desktopLyricsEnabled ? 'on' : ''}`}
                onClick={() =>
                  setConfig((p) => ({ ...p, desktopLyricsEnabled: !p.desktopLyricsEnabled }))
                }
              >
                <span className="lyrics-drawer-switch-thumb" />
              </button>
            </div>
            <div className="lyrics-drawer-row" style={{ marginTop: 8 }}>
              <span className="lyrics-drawer-label">{t('lyrics.desktopLyricsAlwaysOnTop')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={config.desktopLyricsAlwaysOnTop !== false}
                className={`lyrics-drawer-switch ${config.desktopLyricsAlwaysOnTop !== false ? 'on' : ''}`}
                onClick={() => {
                  const newVal = config.desktopLyricsAlwaysOnTop === false ? true : false
                  setConfig((p) => ({ ...p, desktopLyricsAlwaysOnTop: newVal }))
                  if (window.api?.setLyricsDesktopAlwaysOnTop) {
                    window.api.setLyricsDesktopAlwaysOnTop(newVal)
                  }
                }}
              >
                <span className="lyrics-drawer-switch-thumb" />
              </button>
            </div>
            <div className="lyrics-drawer-row" style={{ marginTop: 8 }}>
              <span className="lyrics-drawer-label">{t('lyrics.desktopLyricsSyncTheme')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!config.desktopLyricsSyncTheme}
                className={`lyrics-drawer-switch ${config.desktopLyricsSyncTheme ? 'on' : ''}`}
                onClick={() =>
                  setConfig((p) => ({ ...p, desktopLyricsSyncTheme: !p.desktopLyricsSyncTheme }))
                }
              >
                <span className="lyrics-drawer-switch-thumb" />
              </button>
            </div>
            <div className="lyrics-drawer-slider-block" style={{ marginTop: 12 }}>
              <div className="lyrics-drawer-label-row">
                <span className="lyrics-drawer-label">{t('lyricsDrawer.desktopFontSize')}</span>
                <span className="lyrics-drawer-value">{config.desktopLyricsFontPx ?? 26}px</span>
              </div>
              <input
                type="range"
                min={14}
                max={40}
                step={1}
                value={config.desktopLyricsFontPx ?? 26}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    desktopLyricsFontPx: Number(e.target.value)
                  }))
                }
                className="lyrics-drawer-range"
              />
            </div>

            <div
              className="lyrics-drawer-desktop-options"
              style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <div className="lyrics-drawer-row">
                <span className="lyrics-drawer-label">{t('lyrics.desktopShowPrev')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.desktopLyricsShowPrev !== false}
                  className={`lyrics-drawer-switch ${config.desktopLyricsShowPrev !== false ? 'on' : ''}`}
                  onClick={() =>
                    setConfig((p) => ({
                      ...p,
                      desktopLyricsShowPrev: p.desktopLyricsShowPrev === false ? true : false
                    }))
                  }
                >
                  <span className="lyrics-drawer-switch-thumb" />
                </button>
              </div>
              <div className="lyrics-drawer-row">
                <span className="lyrics-drawer-label">{t('lyrics.desktopShowNext')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.desktopLyricsShowNext !== false}
                  className={`lyrics-drawer-switch ${config.desktopLyricsShowNext !== false ? 'on' : ''}`}
                  onClick={() =>
                    setConfig((p) => ({
                      ...p,
                      desktopLyricsShowNext: p.desktopLyricsShowNext === false ? true : false
                    }))
                  }
                >
                  <span className="lyrics-drawer-switch-thumb" />
                </button>
              </div>
              <div className="lyrics-drawer-row">
                <span className="lyrics-drawer-label">{t('lyrics.desktopShowRomaji')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.desktopLyricsShowRomaji === true}
                  className={`lyrics-drawer-switch ${config.desktopLyricsShowRomaji === true ? 'on' : ''}`}
                  onClick={() =>
                    setConfig((p) => ({
                      ...p,
                      desktopLyricsShowRomaji: !p.desktopLyricsShowRomaji
                    }))
                  }
                >
                  <span className="lyrics-drawer-switch-thumb" />
                </button>
              </div>
            </div>

            <div className="lyrics-drawer-color-grid" style={{ marginTop: 12 }}>
              <div className="lyrics-drawer-label-row">
                <span className="lyrics-drawer-label">{t('lyrics.desktopColorsSection')}</span>
              </div>
              <div className="lyrics-color-inline">
                <div className="lyrics-color-inline-row">
                  <div className="lyrics-color-inline-label">{t('lyrics.desktopColorText')}</div>
                  <div
                    className="lyrics-color-inline-swatch"
                    style={{ background: config.desktopLyricsColorText || '#fff8f5' }}
                  />
                  <label className="lyrics-color-picker">
                    <input
                      type="color"
                      aria-label={t('lyrics.desktopColorText')}
                      value={config.desktopLyricsColorText || '#fff8f5'}
                      onChange={(e) =>
                        setConfig((p) => ({ ...p, desktopLyricsColorText: e.target.value }))
                      }
                    />
                  </label>
                </div>
                <div className="lyrics-color-inline-row">
                  <div className="lyrics-color-inline-label">{t('lyrics.desktopColorSecondary')}</div>
                  <div
                    className="lyrics-color-inline-swatch"
                    style={{ background: config.desktopLyricsColorSecondary || '#ffc8b8' }}
                  />
                  <label className="lyrics-color-picker">
                    <input
                      type="color"
                      aria-label={t('lyrics.desktopColorSecondary')}
                      value={config.desktopLyricsColorSecondary || '#ffc8b8'}
                      onChange={(e) =>
                        setConfig((p) => ({ ...p, desktopLyricsColorSecondary: e.target.value }))
                      }
                    />
                  </label>
                </div>
                <div className="lyrics-color-inline-row">
                  <div className="lyrics-color-inline-label">{t('lyrics.desktopColorGlow')}</div>
                  <div
                    className="lyrics-color-inline-swatch"
                    style={{ background: config.desktopLyricsColorGlow || '#ff8866' }}
                  />
                  <label className="lyrics-color-picker">
                    <input
                      type="color"
                      aria-label={t('lyrics.desktopColorGlow')}
                      value={config.desktopLyricsColorGlow || '#ff8866'}
                      onChange={(e) =>
                        setConfig((p) => ({ ...p, desktopLyricsColorGlow: e.target.value }))
                      }
                    />
                  </label>
                </div>
                <div className="lyrics-color-inline-row">
                  <div className="lyrics-color-inline-label">{t('lyrics.desktopColorRomaji')}</div>
                  <div
                    className="lyrics-color-inline-swatch"
                    style={{ background: config.desktopLyricsColorRomaji || '#e8d0c8' }}
                  />
                  <label className="lyrics-color-picker">
                    <input
                      type="color"
                      aria-label={t('lyrics.desktopColorRomaji')}
                      value={config.desktopLyricsColorRomaji || '#e8d0c8'}
                      onChange={(e) =>
                        setConfig((p) => ({ ...p, desktopLyricsColorRomaji: e.target.value }))
                      }
                    />
                  </label>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="lyrics-drawer-primary-btn"
                onClick={() => window.api?.openLyricsDesktop?.()}
              >
                {t('lyrics.desktopOpen')}
              </button>
              <button
                type="button"
                className="lyrics-drawer-primary-btn"
                style={{ opacity: 0.85 }}
                onClick={() => window.api?.closeLyricsDesktop?.()}
              >
                {t('lyrics.desktopClose')}
              </button>
            </div>
          </section>

          <section className="lyrics-drawer-section">
            <h3 className="lyrics-drawer-section-title">{t('lyricsDrawer.localSync')}</h3>
            <div className="lyrics-drawer-offset">
              <span className="lyrics-drawer-label">{t('lyricsDrawer.timingOffset')}</span>
              <div className="lyrics-drawer-offset-controls">
                <button
                  type="button"
                  className="lyrics-drawer-icon-btn"
                  onClick={() =>
                    setConfig((p) => ({
                      ...p,
                      lyricsOffsetMs: (p.lyricsOffsetMs ?? 0) - 50
                    }))
                  }
                  aria-label={t('lyricsDrawer.decrease50')}
                >
                  <Minus size={18} />
                </button>
                <span className="lyrics-drawer-offset-value">{offsetMs} ms</span>
                <button
                  type="button"
                  className="lyrics-drawer-icon-btn"
                  onClick={() =>
                    setConfig((p) => ({
                      ...p,
                      lyricsOffsetMs: (p.lyricsOffsetMs ?? 0) + 50
                    }))
                  }
                  aria-label={t('lyricsDrawer.increase50')}
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className={`lyrics-drawer-slider-block lyrics-drawer-slider-block--offset ${isOffsetDragging ? 'is-dragging' : ''}`}>
                <div className="lyrics-drawer-range-float-wrap">
                  <span
                    className="lyrics-drawer-range-float"
                    style={{ left: `${((Math.min(1500, Math.max(-1500, offsetMs)) + 1500) / 3000) * 100}%` }}
                  >
                    {offsetMs} ms
                  </span>
                </div>
                <input
                  type="range"
                  min={-1500}
                  max={1500}
                  step={10}
                  value={Math.min(1500, Math.max(-1500, offsetMs))}
                  onChange={(e) =>
                    setConfig((p) => ({
                      ...p,
                      lyricsOffsetMs: parseInt(e.target.value, 10)
                    }))
                  }
                  onMouseDown={() => setIsOffsetDragging(true)}
                  onMouseUp={() => setIsOffsetDragging(false)}
                  onMouseLeave={() => setIsOffsetDragging(false)}
                  onTouchStart={() => setIsOffsetDragging(true)}
                  onTouchEnd={() => setIsOffsetDragging(false)}
                  className={`lyrics-drawer-range ${isOffsetDragging ? 'is-dragging' : ''}`}
                />
              </div>
              <p className="lyrics-drawer-hint">{t('lyricsDrawer.offsetHint')}</p>
            </div>

            <div
              className="lyrics-drawer-dropzone"
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDrop={handleDrop}
            >
              <Upload size={22} strokeWidth={1.5} />
              <p>{t('lyricsDrawer.dropzone')}</p>
              <button
                type="button"
                className="lyrics-drawer-link-btn"
                onClick={() => {
                  if (window.api?.openLyricsFileHandler) {
                    onNativeLyricsFilePick?.()
                  } else {
                    fileInputRef.current?.click()
                  }
                }}
              >
                {t('lyricsDrawer.chooseFile')}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".lrc,.lrcx,text/plain"
              className="lyrics-drawer-file-input"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const text = await f.text()
                onApplyLyricsText(text)
              }}
            />

            <button
              type="button"
              className="lyrics-drawer-secondary-btn"
              onClick={() => setShowTextarea((v) => !v)}
            >
              {t('lyricsDrawer.editPlain')}
            </button>
            {showTextarea && (
              <div className="lyrics-drawer-textarea-block">
                <textarea
                  className="lyrics-drawer-textarea"
                  placeholder={t('lyricsDrawer.pastePlaceholder')}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={8}
                />
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn"
                  onClick={handleApplyPaste}
                >
                  {t('lyricsDrawer.applyLyrics')}
                </button>
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  )
}
