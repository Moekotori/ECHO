import { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { hexToRgbaString } from '../utils/color'
import { clampBiquadQ } from '../utils/eqBiquad'

const GAIN_RANGE = 24

const EQ_FILTER_TYPES = [
  'lowshelf',
  'peaking',
  'highshelf',
  'lowpass',
  'highpass',
  'notch',
  'allpass'
]

function computeCompositeMagnitudes(bands, frequencies) {
  const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
    1,
    1,
    44100
  )
  const totalMag = new Float32Array(frequencies.length).fill(1)
  bands.forEach((band) => {
    if (!band.enabled) return
    const filter = offlineCtx.createBiquadFilter()
    filter.type = band.type
    filter.frequency.value = band.freq
    filter.Q.value = clampBiquadQ(band.type, band.q)
    filter.gain.value = band.gain
    const mag = new Float32Array(frequencies.length)
    const phase = new Float32Array(frequencies.length)
    filter.getFrequencyResponse(frequencies, mag, phase)
    for (let i = 0; i < frequencies.length; i++) totalMag[i] *= mag[i]
  })
  return totalMag
}

export function EqPlot({
  accentHex,
  bands,
  onBandChange,
  enabled,
  preamp,
  onPreampChange,
  analyser
}) {
  const { t } = useTranslation()
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [draggingIdx, setDraggingIdx] = useState(null)
  const [hoverIdx, setHoverIdx] = useState(null)
  const animationRef = useRef(null)

  const layoutRef = useRef({ width: 0, height: 0, dpr: 1 })
  const curveMagRef = useRef(null)
  const lastCurveSigRef = useRef('')
  const rtaGradientRef = useRef({ key: '', gradient: null })
  const eqAreaGradientRef = useRef({ key: '', gradient: null })

  const freqToX = (f, width) => {
    return ((Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * width
  }

  const xToFreq = (x, width) => {
    return Math.pow(10, (x / width) * (Math.log10(20000) - Math.log10(20)) + Math.log10(20))
  }

  const gainToY = (g, height) => {
    const padding = 25
    const usableHeight = height - padding * 2
    return padding + usableHeight / 2 - (g / GAIN_RANGE) * usableHeight
  }

  const yToGain = (y, height) => {
    const padding = 25
    const usableHeight = height - padding * 2
    return ((padding + usableHeight / 2 - y) / usableHeight) * GAIN_RANGE
  }

  const frequencies = useMemo(() => {
    const f = new Float32Array(400)
    for (let i = 0; i < 400; i++) {
      f[i] = xToFreq((i / 400) * 1000, 1000)
    }
    return f
  }, [])

  const accent = accentHex || '#f7aab5'

  const bandsSig = useMemo(
    () =>
      bands
        ?.map((b) =>
          [
            b.type,
            b.freq,
            b.gain.toFixed(3),
            clampBiquadQ(b.type, b.q).toFixed(3),
            b.enabled ? '1' : '0'
          ].join(',')
        )
        .join('|') ?? '',
    [bands]
  )

  const syncCanvasSize = useCallback(() => {
    const wrap = canvasRef.current?.parentElement ?? containerRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.floor(wrap.clientWidth))
    const h = Math.max(1, Math.floor(wrap.clientHeight))
    layoutRef.current = { width: w, height: h, dpr }
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [])

  useEffect(() => {
    const wrap = canvasRef.current?.parentElement
    if (!wrap || typeof ResizeObserver === 'undefined') {
      syncCanvasSize()
      return undefined
    }
    const ro = new ResizeObserver(() => {
      syncCanvasSize()
    })
    ro.observe(wrap)
    syncCanvasSize()
    return () => ro.disconnect()
  }, [syncCanvasSize])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let { width, height, dpr } = layoutRef.current
    if (width < 2 || height < 2) {
      syncCanvasSize()
      ;({ width, height, dpr } = layoutRef.current)
      if (width < 2 || height < 2) return
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (enabled && analyser) {
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      analyser.getByteFrequencyData(dataArray)

      ctx.beginPath()
      ctx.moveTo(0, height)

      const spectrumPoints = 120
      for (let i = 0; i <= spectrumPoints; i++) {
        const x = (i / spectrumPoints) * width
        const f = xToFreq(x, width)

        const sampleRate = 44100
        const binIndex = Math.floor((f / (sampleRate / 2)) * bufferLength)

        const val = dataArray[binIndex] || 0
        const percent = val / 255
        const rtaY = height - percent * height * 0.6

        ctx.lineTo(x, rtaY)
      }

      ctx.lineTo(width, height)
      const rtaKey = `${accent}|${height}`
      let rtaGrad = rtaGradientRef.current.gradient
      if (rtaGradientRef.current.key !== rtaKey) {
        rtaGrad = ctx.createLinearGradient(0, height, 0, 0)
        rtaGrad.addColorStop(0, 'rgba(0, 0, 0, 0)')
        rtaGrad.addColorStop(1, hexToRgbaString(accent, 0.15))
        rtaGradientRef.current = { key: rtaKey, gradient: rtaGrad }
      }
      ctx.fillStyle = rtaGrad
      ctx.fill()
    }

    ctx.lineWidth = 1
    ;[-24, -18, -12, -6, 0, 6, 12, 18, 24].forEach((g) => {
      const y = gainToY(g, height)
      ctx.strokeStyle = g === 0 ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.04)'
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()

      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.font = '800 9px Inter'
      ctx.textAlign = 'right'
      ctx.fillText(`${g > 0 ? '+' : ''}${g}`, width - 5, y - 4)
    })

    const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
    gridFreqs.forEach((f) => {
      const x = freqToX(f, width)
      ctx.strokeStyle = 'rgba(0,0,0,0.04)'
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()

      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.font = '800 9px Inter'
      ctx.textAlign = 'center'
      const label = f >= 1000 ? `${f / 1000}k` : f
      ctx.fillText(label, x, height - 10)
    })

    if (!enabled || !bands) return

    const mustRecomputeCurve =
      draggingIdx !== null || bandsSig !== lastCurveSigRef.current || curveMagRef.current === null

    if (mustRecomputeCurve) {
      curveMagRef.current = computeCompositeMagnitudes(bands, frequencies)
      lastCurveSigRef.current = bandsSig
    }

    const totalMag = curveMagRef.current

    ctx.beginPath()
    ctx.moveTo(0, gainToY(0, height))
    for (let i = 0; i < frequencies.length; i++) {
      const x = (i / frequencies.length) * width
      const db = 20 * Math.log10(totalMag[i])
      ctx.lineTo(x, gainToY(db, height))
    }
    ctx.lineTo(width, gainToY(0, height))
    const eqFillKey = `${accent}|${height}|fill`
    let fillGrad = eqAreaGradientRef.current.gradient
    if (eqAreaGradientRef.current.key !== eqFillKey) {
      fillGrad = ctx.createLinearGradient(0, 0, 0, height)
      fillGrad.addColorStop(0, hexToRgbaString(accent, 0.15))
      fillGrad.addColorStop(0.5, hexToRgbaString(accent, 0.05))
      fillGrad.addColorStop(1, hexToRgbaString(accent, 0))
      eqAreaGradientRef.current = { key: eqFillKey, gradient: fillGrad }
    }
    ctx.fillStyle = fillGrad
    ctx.fill()

    ctx.beginPath()
    ctx.strokeStyle = hexToRgbaString(accent, 1)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 0; i < frequencies.length; i++) {
      const x = (i / frequencies.length) * width
      const db = 20 * Math.log10(totalMag[i])
      const y = gainToY(db, height)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    bands.forEach((band, idx) => {
      if (!band.enabled) return
      const x = freqToX(band.freq, width)
      const y = gainToY(band.gain, height)
      const isActive = draggingIdx === idx || hoverIdx === idx

      ctx.beginPath()
      ctx.arc(x, y, isActive ? 8 : 6, 0, Math.PI * 2)
      ctx.fillStyle = 'white'
      ctx.fill()
      ctx.strokeStyle = hexToRgbaString(accent, 1)
      ctx.lineWidth = isActive ? 3 : 2
      ctx.stroke()

      if (isActive) {
        ctx.fillStyle = hexToRgbaString(accent, 1)
        ctx.font = '800 10px Inter'
        ctx.textAlign = 'center'
        ctx.fillText(`${Math.round(band.freq)}Hz`, x, y - 15)
      }
    })
  }, [
    bands,
    bandsSig,
    draggingIdx,
    hoverIdx,
    enabled,
    frequencies,
    analyser,
    accent,
    syncCanvasSize
  ])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      draw()
      if (enabled && analyser) {
        raf = requestAnimationFrame(tick)
        animationRef.current = raf
      }
    }
    tick()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      animationRef.current = null
    }
  }, [draw, enabled, analyser])

  const layoutSize = () => {
    const L = layoutRef.current
    if (L.width > 1 && L.height > 1) return L
    const c = canvasRef.current
    if (!c) return { width: 0, height: 0 }
    const r = c.getBoundingClientRect()
    return { width: r.width, height: r.height }
  }

  const handleMouseDown = (e) => {
    const { width, height } = layoutSize()
    if (width < 1) return
    const rect = canvasRef.current?.getBoundingClientRect()
    const sx = rect ? e.clientX - rect.left : 0
    const sy = rect ? e.clientY - rect.top : 0
    let closestIdx = null
    let minDist = 25
    bands?.forEach((band, idx) => {
      const bx = freqToX(band.freq, width)
      const by = gainToY(band.gain, height)
      const dist = Math.sqrt((sx - bx) ** 2 + (sy - by) ** 2)
      if (dist < minDist) {
        minDist = dist
        closestIdx = idx
      }
    })
    setDraggingIdx(closestIdx)
  }

  const handleMouseMove = (e) => {
    const { width, height } = layoutSize()
    if (width < 1) return
    const rect = canvasRef.current?.getBoundingClientRect()
    const x = rect ? e.clientX - rect.left : 0
    const y = rect ? e.clientY - rect.top : 0

    let currentHover = null
    let minDist = 20
    bands?.forEach((band, idx) => {
      const bx = freqToX(band.freq, width)
      const by = gainToY(band.gain, height)
      const dist = Math.sqrt((x - bx) ** 2 + (y - by) ** 2)
      if (dist < minDist) {
        minDist = dist
        currentHover = idx
      }
    })
    setHoverIdx(currentHover)

    if (draggingIdx === null) return
    const boundedX = Math.max(0, Math.min(width, x))
    const boundedY = Math.max(0, Math.min(height, y))
    onBandChange(draggingIdx, {
      freq: xToFreq(boundedX, width),
      gain: Math.max(-GAIN_RANGE, Math.min(GAIN_RANGE, yToGain(boundedY, height)))
    })
  }

  const activeIdx = draggingIdx !== null ? draggingIdx : hoverIdx !== null ? hoverIdx : null
  const activeNode = activeIdx !== null ? bands[activeIdx] : null

  return (
    <div className="hi-fi-eq-plot-main-wrapper no-drag" ref={containerRef}>
      <div className="preamp-vertical-container">
        <span className="preamp-label-db">
          {preamp > 0 ? `+${preamp.toFixed(1)}` : preamp.toFixed(1)} dB
        </span>
        <div className="preamp-vertical-slider-track">
          <input
            type="range"
            min={-12}
            max={12}
            step={0.1}
            value={preamp}
            onChange={(e) => onPreampChange(parseFloat(e.target.value))}
            className="preamp-input"
          />
          <div className="preamp-fill" style={{ height: `${((preamp + 12) / 24) * 100}%` }} />
          <div
            className="preamp-thumb"
            style={{ bottom: `calc(${((preamp + 12) / 24) * 100}% - 8px)` }}
          />
        </div>
        <span className="preamp-label-title">PREAMP</span>
      </div>
      <div className="eq-plot-with-labels-container">
        <div className="eq-canvas-wrapper">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={() => setDraggingIdx(null)}
            onMouseLeave={() => {
              setDraggingIdx(null)
              setHoverIdx(null)
            }}
            onWheel={(e) => {
              const { width: w } = layoutSize()
              const rect = canvasRef.current?.getBoundingClientRect()
              const wx = rect ? e.clientX - rect.left : 0
              let closestIdx = null
              let minDist = 40
              bands?.forEach((band, idx) => {
                const bx = freqToX(band.freq, w || rect?.width || 1)
                const dist = Math.abs(wx - bx)
                if (dist < minDist) {
                  minDist = dist
                  closestIdx = idx
                }
              })
              if (closestIdx !== null) {
                e.preventDefault()
                const delta = e.deltaY > 0 ? -0.1 : 0.1
                const b = bands[closestIdx]
                onBandChange(closestIdx, {
                  q: clampBiquadQ(b.type, b.q + delta)
                })
              }
            }}
          />
        </div>
        <div className="eq-selected-info-bar">
          <div className="info-item">
            FREQ <b>{activeNode ? Math.round(activeNode.freq) : '--'} Hz</b>
          </div>
          <div className="info-item">
            GAIN <b>{activeNode ? activeNode.gain.toFixed(1) : '--'} dB</b>
          </div>
          <div className="info-item">
            {t('eqPlot.qLabel')}{' '}
            <b>{activeNode ? clampBiquadQ(activeNode.type, activeNode.q).toFixed(2) : '--'}</b>
          </div>
          {activeNode && activeIdx !== null && (
            <>
              <label className="info-item">
                {t('eqPlot.filterType')}
                <select
                  className="eq-filter-type-select"
                  value={activeNode.type}
                  onChange={(e) => {
                    const nextType = e.target.value
                    onBandChange(activeIdx, {
                      type: nextType,
                      q: clampBiquadQ(nextType, activeNode.q)
                    })
                  }}
                >
                  {EQ_FILTER_TYPES.map((tp) => (
                    <option key={tp} value={tp}>
                      {t(`eqPlot.types.${tp}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="info-item">
                <input
                  type="range"
                  className="eq-q-slider"
                  min={0.1}
                  max={activeNode.type === 'lowshelf' || activeNode.type === 'highshelf' ? 1 : 10}
                  step={0.05}
                  value={clampBiquadQ(activeNode.type, activeNode.q)}
                  onChange={(e) =>
                    onBandChange(activeIdx, {
                      q: clampBiquadQ(activeNode.type, parseFloat(e.target.value))
                    })
                  }
                />
              </label>
            </>
          )}
          <div className="info-item" style={{ opacity: 0.5 }}>
            {t('eqPlot.scrollQ')}
          </div>
          {activeNode && Math.abs(activeNode.gain) > 12 && (
            <p className="eq-shelf-hint">{t('eqPlot.gainExtremeHint')}</p>
          )}
          {activeNode && (activeNode.type === 'lowshelf' || activeNode.type === 'highshelf') && (
            <p className="eq-shelf-hint">{t('eqPlot.shelfQHint')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
