import { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { hexToRgbaString } from '../utils/color'
import { clampBiquadQ } from '../utils/eqBiquad'

const GAIN_RANGE = 24
const PREAMP_RANGE = 20
const FREQ_MIN = 20
const FREQ_MAX = 20000
const SHELF_TYPES = new Set(['lowshelf', 'highshelf'])

const EQ_FILTER_TYPES = [
  'lowshelf',
  'peaking',
  'highshelf',
  'lowpass',
  'highpass',
  'notch',
  'allpass'
]

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function isShelf(type) {
  return SHELF_TYPES.has(type)
}

function formatFreq(freq) {
  if (freq >= 1000) {
    const v = freq / 1000
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}kHz`
  }
  return `${Math.round(freq)}Hz`
}

function formatDb(value) {
  const n = Number.isFinite(value) ? value : 0
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} dB`
}

function getShelfSlope(band) {
  return band?.slope === 6 || band?.slope === 24 ? band.slope : 12
}

function getShelfStageCount(band) {
  return getShelfSlope(band) === 24 ? 2 : 1
}

function computeCompositeMagnitudes(bands, frequencies) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!Ctx) {
    return new Float32Array(frequencies.length).fill(1)
  }

  const offlineCtx = new Ctx(1, 1, 44100)
  const totalMag = new Float32Array(frequencies.length).fill(1)
  bands.forEach((band) => {
    if (!band || band.enabled === false) return
    const stages = isShelf(band.type) ? getShelfStageCount(band) : 1
    const gainPerStage = stages > 1 ? band.gain / stages : band.gain
    for (let stage = 0; stage < stages; stage++) {
      const filter = offlineCtx.createBiquadFilter()
      filter.type = band.type
      filter.frequency.value = clamp(band.freq, FREQ_MIN, FREQ_MAX)
      filter.Q.value = clampBiquadQ(band.type, getShelfSlope(band) === 6 ? 0.55 : band.q)
      filter.gain.value = gainPerStage
      const mag = new Float32Array(frequencies.length)
      const phase = new Float32Array(frequencies.length)
      filter.getFrequencyResponse(frequencies, mag, phase)
      for (let i = 0; i < frequencies.length; i++) totalMag[i] *= mag[i]
    }
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
  analyser,
  soloIdx = null,
  onSoloChange,
  onEnable
}) {
  const { t } = useTranslation()
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [draggingIdx, setDraggingIdx] = useState(null)
  const [hoverIdx, setHoverIdx] = useState(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [mousePoint, setMousePoint] = useState(null)
  const [editingField, setEditingField] = useState(null)
  const [drafts, setDrafts] = useState({
    preamp: '0.0',
    freq: '',
    gain: '',
    q: ''
  })

  const layoutRef = useRef({ width: 0, height: 0, dpr: 1 })
  const curveMagRef = useRef(null)
  const soloCurveMagRef = useRef(null)
  const lastCurveSigRef = useRef('')
  const lastSoloCurveSigRef = useRef('')
  const rtaGradientRef = useRef({ key: '', gradient: null })
  const eqAreaGradientRef = useRef({ key: '', gradient: null })

  const safeBands = useMemo(() => (Array.isArray(bands) ? bands : []), [bands])
  const accent = accentHex || '#f7aab5'

  const freqToX = useCallback((f, width) => {
    return ((Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * width
  }, [])

  const xToFreq = useCallback((x, width) => {
    return Math.pow(10, (x / width) * (Math.log10(20000) - Math.log10(20)) + Math.log10(20))
  }, [])

  const gainToY = useCallback((g, height) => {
    const padding = 25
    const usableHeight = height - padding * 2
    return padding + usableHeight / 2 - (g / GAIN_RANGE) * usableHeight
  }, [])

  const yToGain = useCallback((y, height) => {
    const padding = 25
    const usableHeight = height - padding * 2
    return ((padding + usableHeight / 2 - y) / usableHeight) * GAIN_RANGE
  }, [])

  const frequencies = useMemo(() => {
    const f = new Float32Array(480)
    for (let i = 0; i < f.length; i++) {
      f[i] = xToFreq((i / (f.length - 1)) * 1000, 1000)
    }
    return f
  }, [xToFreq])

  const plotBands = useMemo(() => {
    if (soloIdx === null || soloIdx < 0 || soloIdx >= safeBands.length) return safeBands
    return safeBands.map((band, index) => (index === soloIdx ? band : { ...band, gain: 0 }))
  }, [safeBands, soloIdx])

  const bandsSig = useMemo(
    () =>
      plotBands
        .map((b) =>
          [
            b.type,
            Math.round(b.freq * 100) / 100,
            Number(b.gain || 0).toFixed(3),
            clampBiquadQ(b.type, b.q).toFixed(3),
            b.slope ?? '',
            b.enabled === false ? '0' : '1'
          ].join(',')
        )
        .join('|'),
    [plotBands]
  )

  const activeIdx =
    draggingIdx !== null
      ? draggingIdx
      : hoverIdx !== null
        ? hoverIdx
        : safeBands.length > 0
          ? clamp(selectedIdx, 0, safeBands.length - 1)
          : null
  const activeNode = activeIdx !== null ? safeBands[activeIdx] : null

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

  useEffect(() => {
    if (safeBands.length === 0) return
    setSelectedIdx((idx) => clamp(idx, 0, safeBands.length - 1))
  }, [safeBands.length])

  useEffect(() => {
    if (editingField !== null) return
    setDrafts({
      preamp: (Number.isFinite(preamp) ? preamp : 0).toFixed(1),
      freq: activeNode ? Math.round(activeNode.freq).toString() : '',
      gain: activeNode ? Number(activeNode.gain || 0).toFixed(1) : '',
      q: activeNode ? clampBiquadQ(activeNode.type, activeNode.q).toFixed(2) : ''
    })
  }, [preamp, activeIdx, activeNode, editingField])

  const layoutSize = () => {
    const L = layoutRef.current
    if (L.width > 1 && L.height > 1) return L
    const c = canvasRef.current
    if (!c) return { width: 0, height: 0 }
    const r = c.getBoundingClientRect()
    return { width: r.width, height: r.height }
  }

  const findNearestByPoint = useCallback(
    (x, y, width, height, radius) => {
      let closestIdx = null
      let minDist = radius
      safeBands.forEach((band, idx) => {
        const bx = freqToX(clamp(band.freq, FREQ_MIN, FREQ_MAX), width)
        const by = gainToY(clamp(band.gain, -GAIN_RANGE, GAIN_RANGE), height)
        const dist = Math.sqrt((x - bx) ** 2 + (y - by) ** 2)
        if (dist < minDist) {
          minDist = dist
          closestIdx = idx
        }
      })
      return closestIdx
    },
    [freqToX, gainToY, safeBands]
  )

  const findNearestByX = useCallback(
    (x, width) => {
      let closestIdx = null
      let minDist = Infinity
      safeBands.forEach((band, idx) => {
        const bx = freqToX(clamp(band.freq, FREQ_MIN, FREQ_MAX), width)
        const dist = Math.abs(x - bx)
        if (dist < minDist) {
          minDist = dist
          closestIdx = idx
        }
      })
      return closestIdx
    },
    [freqToX, safeBands]
  )

  const setBand = useCallback(
    (idx, updates) => {
      if (idx === null || idx < 0 || idx >= safeBands.length) return
      onBandChange?.(idx, updates)
    },
    [onBandChange, safeBands.length]
  )

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
    ctx.imageSmoothingEnabled = true
    ctx.clearRect(0, 0, width, height)

    if (enabled && analyser) {
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      analyser.getByteFrequencyData(dataArray)
      ctx.beginPath()
      ctx.moveTo(0, height)
      const spectrumPoints = 140
      for (let i = 0; i <= spectrumPoints; i++) {
        const x = (i / spectrumPoints) * width
        const f = xToFreq(x, width)
        const sampleRate = 44100
        const binIndex = Math.floor((f / (sampleRate / 2)) * bufferLength)
        const val = dataArray[binIndex] || 0
        const percent = val / 255
        ctx.lineTo(x, height - percent * height * 0.6)
      }
      ctx.lineTo(width, height)
      const rtaKey = `${accent}|${height}`
      let rtaGrad = rtaGradientRef.current.gradient
      if (rtaGradientRef.current.key !== rtaKey) {
        rtaGrad = ctx.createLinearGradient(0, height, 0, 0)
        rtaGrad.addColorStop(0, 'rgba(0, 0, 0, 0)')
        rtaGrad.addColorStop(1, hexToRgbaString(accent, 0.08))
        rtaGradientRef.current = { key: rtaKey, gradient: rtaGrad }
      }
      ctx.fillStyle = rtaGrad
      ctx.fill()
    }

    ctx.lineWidth = 1
    ;[-24, -18, -12, -6, 0, 6, 12, 18, 24].forEach((g) => {
      const y = gainToY(g, height)
      ctx.strokeStyle = g === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.045)'
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
      ctx.fillStyle = 'rgba(0,0,0,0.36)'
      ctx.font = '800 9px Inter'
      ctx.textAlign = 'right'
      ctx.fillText(`${g > 0 ? '+' : ''}${g}`, width - 5, y - 4)
    })

    const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
    gridFreqs.forEach((f) => {
      const x = freqToX(f, width)
      ctx.strokeStyle = 'rgba(0,0,0,0.045)'
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
      ctx.fillStyle = 'rgba(0,0,0,0.36)'
      ctx.font = '800 9px Inter'
      ctx.textAlign = 'center'
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : f, x, height - 10)
    })

    if (mousePoint) {
      const mouseFreq = xToFreq(clamp(mousePoint.x, 0, width), width)
      const mouseGain = clamp(
        yToGain(clamp(mousePoint.y, 0, height), height),
        -GAIN_RANGE,
        GAIN_RANGE
      )
      ctx.fillStyle = 'rgba(0,0,0,0.32)'
      ctx.font = '800 10px Inter'
      ctx.textAlign = 'left'
      ctx.fillText(`${formatFreq(mouseFreq)} / ${formatDb(mouseGain)}`, 10, 18)
    }

    if (plotBands.length > 0) {
      const mustRecomputeCurve =
        draggingIdx !== null || bandsSig !== lastCurveSigRef.current || curveMagRef.current === null
      if (mustRecomputeCurve) {
        curveMagRef.current = computeCompositeMagnitudes(plotBands, frequencies)
        lastCurveSigRef.current = bandsSig
      }

      const totalMag = curveMagRef.current
      ctx.beginPath()
      ctx.moveTo(0, gainToY(0, height))
      for (let i = 0; i < frequencies.length; i++) {
        const x = (i / (frequencies.length - 1)) * width
        const db = 20 * Math.log10(totalMag[i])
        ctx.lineTo(x, gainToY(clamp(db, -GAIN_RANGE, GAIN_RANGE), height))
      }
      ctx.lineTo(width, gainToY(0, height))
      const fillKey = `${accent}|${height}|${enabled ? 'on' : 'bypass'}`
      let fillGrad = eqAreaGradientRef.current.gradient
      if (eqAreaGradientRef.current.key !== fillKey) {
        fillGrad = ctx.createLinearGradient(0, 0, 0, height)
        fillGrad.addColorStop(0, enabled ? 'rgba(34, 38, 48, 0.1)' : 'rgba(90,90,100,0.08)')
        fillGrad.addColorStop(
          0.5,
          enabled ? hexToRgbaString(accent, 0.035) : 'rgba(90,90,100,0.035)'
        )
        fillGrad.addColorStop(1, 'rgba(0,0,0,0)')
        eqAreaGradientRef.current = { key: fillKey, gradient: fillGrad }
      }
      ctx.fillStyle = fillGrad
      ctx.fill()

      ctx.beginPath()
      ctx.strokeStyle = enabled ? 'rgba(32, 36, 46, 0.92)' : 'rgba(80,84,96,0.45)'
      ctx.lineWidth = enabled ? 2.5 : 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (let i = 0; i < frequencies.length; i++) {
        const x = (i / (frequencies.length - 1)) * width
        const db = 20 * Math.log10(totalMag[i])
        const y = gainToY(clamp(db, -GAIN_RANGE, GAIN_RANGE), height)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      if (activeNode) {
        const soloSig = `${activeIdx}|${activeNode.type}|${activeNode.freq}|${activeNode.gain}|${activeNode.q}|${activeNode.slope}|${activeNode.enabled}`
        if (lastSoloCurveSigRef.current !== soloSig || soloCurveMagRef.current === null) {
          soloCurveMagRef.current = computeCompositeMagnitudes([activeNode], frequencies)
          lastSoloCurveSigRef.current = soloSig
        }
        const soloMag = soloCurveMagRef.current
        ctx.beginPath()
        ctx.strokeStyle = hexToRgbaString(accent, 0.32)
        ctx.lineWidth = 1.2
        ctx.setLineDash([4, 4])
        for (let i = 0; i < frequencies.length; i++) {
          const x = (i / (frequencies.length - 1)) * width
          const db = 20 * Math.log10(soloMag[i])
          const y = gainToY(clamp(db, -GAIN_RANGE, GAIN_RANGE), height)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    if (activeNode) {
      const x = freqToX(clamp(activeNode.freq, FREQ_MIN, FREQ_MAX), width)
      const y = gainToY(clamp(activeNode.gain, -GAIN_RANGE, GAIN_RANGE), height)
      ctx.strokeStyle = hexToRgbaString(accent, 0.28)
      ctx.lineWidth = 1
      ctx.setLineDash([3, 5])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(32, 36, 46, 0.78)'
      ctx.font = '900 10px Inter'
      ctx.textAlign = 'center'
      ctx.fillText(formatFreq(activeNode.freq), x, Math.max(16, y - 18))
      ctx.textAlign = 'left'
      ctx.fillText(formatDb(activeNode.gain), Math.min(width - 70, x + 10), y - 6)
    }

    safeBands.forEach((band, idx) => {
      const x = freqToX(clamp(band.freq, FREQ_MIN, FREQ_MAX), width)
      const y = gainToY(clamp(band.gain, -GAIN_RANGE, GAIN_RANGE), height)
      const isActive = draggingIdx === idx || hoverIdx === idx || selectedIdx === idx
      const bandDisabled = band.enabled === false
      const radius = isActive ? 10 : 8

      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = bandDisabled
        ? 'rgba(244,246,249,0.82)'
        : isActive
          ? hexToRgbaString(accent, enabled ? 0.28 : 0.16)
          : 'rgba(255,255,255,0.94)'
      ctx.fill()
      ctx.strokeStyle = bandDisabled
        ? 'rgba(80,84,96,0.35)'
        : isActive
          ? hexToRgbaString(accent, enabled ? 0.95 : 0.58)
          : 'rgba(32,36,46,0.62)'
      ctx.lineWidth = isActive ? 3 : 2
      ctx.stroke()

      ctx.fillStyle = bandDisabled
        ? 'rgba(80,84,96,0.55)'
        : isActive
          ? 'rgba(32,36,46,0.9)'
          : 'rgba(32,36,46,0.78)'
      ctx.font = '900 9px Inter'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(idx + 1), x, y + 0.5)

      if (bandDisabled) {
        ctx.strokeStyle = 'rgba(80,84,96,0.7)'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(x - 4, y - 4)
        ctx.lineTo(x + 4, y + 4)
        ctx.moveTo(x + 4, y - 4)
        ctx.lineTo(x - 4, y + 4)
        ctx.stroke()
      }
    })
  }, [
    accent,
    activeIdx,
    activeNode,
    analyser,
    bandsSig,
    draggingIdx,
    enabled,
    frequencies,
    freqToX,
    gainToY,
    hoverIdx,
    mousePoint,
    plotBands,
    safeBands,
    selectedIdx,
    syncCanvasSize,
    xToFreq,
    yToGain
  ])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      draw()
      if (enabled && analyser) {
        raf = requestAnimationFrame(tick)
      }
    }
    tick()
    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [draw, enabled, analyser])

  const commitNumber = useCallback(
    (field, rawValue) => {
      const parsed = parseFloat(rawValue)
      if (!Number.isFinite(parsed)) {
        setEditingField(null)
        return
      }
      if (field === 'preamp') {
        onPreampChange?.(clamp(parsed, -PREAMP_RANGE, PREAMP_RANGE))
        setEditingField(null)
        return
      }
      if (activeIdx === null || !activeNode) {
        setEditingField(null)
        return
      }
      if (field === 'freq') {
        setBand(activeIdx, { freq: clamp(parsed, FREQ_MIN, FREQ_MAX) })
      } else if (field === 'gain') {
        setBand(activeIdx, { gain: clamp(parsed, -GAIN_RANGE, GAIN_RANGE) })
      } else if (field === 'q') {
        setBand(activeIdx, { q: clampBiquadQ(activeNode.type, parsed) })
      }
      setEditingField(null)
    },
    [activeIdx, activeNode, onPreampChange, setBand]
  )

  const resetDraft = useCallback(
    (field) => {
      setDrafts((prev) => ({
        ...prev,
        [field]:
          field === 'preamp'
            ? (Number.isFinite(preamp) ? preamp : 0).toFixed(1)
            : field === 'freq'
              ? activeNode
                ? Math.round(activeNode.freq).toString()
                : ''
              : field === 'gain'
                ? activeNode
                  ? Number(activeNode.gain || 0).toFixed(1)
                  : ''
                : activeNode
                  ? clampBiquadQ(activeNode.type, activeNode.q).toFixed(2)
                  : ''
      }))
      setEditingField(null)
    },
    [activeNode, preamp]
  )

  const handleInputKey = (field) => (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitNumber(field, drafts[field])
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      resetDraft(field)
      e.currentTarget.blur()
    }
  }

  const handleMouseDown = (e) => {
    const { width, height } = layoutSize()
    if (width < 1 || safeBands.length === 0) return
    const rect = canvasRef.current?.getBoundingClientRect()
    const sx = rect ? e.clientX - rect.left : 0
    const sy = rect ? e.clientY - rect.top : 0
    const radius = Math.max(28, width / 30)
    const closestIdx = findNearestByPoint(sx, sy, width, height, radius)
    if (closestIdx !== null) {
      setSelectedIdx(closestIdx)
      setDraggingIdx(closestIdx)
      return
    }
    const nearestX = findNearestByX(sx, width)
    if (nearestX !== null) setSelectedIdx(nearestX)
  }

  const handleMouseMove = (e) => {
    const { width, height } = layoutSize()
    if (width < 1 || safeBands.length === 0) return
    const rect = canvasRef.current?.getBoundingClientRect()
    const x = rect ? e.clientX - rect.left : 0
    const y = rect ? e.clientY - rect.top : 0
    setMousePoint({ x, y })

    const radius = Math.max(32, width / 28)
    const pointHit = findNearestByPoint(x, y, width, height, radius)
    const currentHover = pointHit !== null ? pointHit : findNearestByX(x, width)
    setHoverIdx(currentHover)

    if (draggingIdx === null) return
    const boundedX = clamp(x, 0, width)
    const boundedY = clamp(y, 0, height)
    setBand(draggingIdx, {
      freq: clamp(xToFreq(boundedX, width), FREQ_MIN, FREQ_MAX),
      gain: clamp(yToGain(boundedY, height), -GAIN_RANGE, GAIN_RANGE)
    })
  }

  const handleWheel = (e) => {
    const { width } = layoutSize()
    const rect = canvasRef.current?.getBoundingClientRect()
    const wx = rect ? e.clientX - rect.left : 0
    const closestIdx = findNearestByX(wx, width || rect?.width || 1)
    if (closestIdx !== null) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.05 : 0.05
      const b = safeBands[closestIdx]
      setSelectedIdx(closestIdx)
      setBand(closestIdx, {
        q: clampBiquadQ(b.type, b.q + delta)
      })
    }
  }

  const handleKeyDown = (e) => {
    if (activeIdx === null || !activeNode) return
    const big = e.shiftKey
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const step = big ? 1 : 0.1
      setBand(activeIdx, {
        gain: clamp(
          (activeNode.gain || 0) + (e.key === 'ArrowUp' ? step : -step),
          -GAIN_RANGE,
          GAIN_RANGE
        )
      })
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const ratio = big ? 1.25 : 1.05
      setBand(activeIdx, {
        freq: clamp(
          activeNode.freq * (e.key === 'ArrowRight' ? ratio : 1 / ratio),
          FREQ_MIN,
          FREQ_MAX
        )
      })
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      setBand(activeIdx, { gain: 0 })
    }
  }

  const preampPercent =
    ((clamp(preamp || 0, -PREAMP_RANGE, PREAMP_RANGE) + PREAMP_RANGE) / (PREAMP_RANGE * 2)) * 100
  const qMin = 0.1
  const qMax = activeNode && isShelf(activeNode.type) ? 2 : 10
  const qValue = activeNode ? clampBiquadQ(activeNode.type, activeNode.q) : 1
  const activeBandLabel =
    activeNode && activeIdx !== null
      ? t('eqPlot.bandOption', { index: activeIdx + 1, freq: formatFreq(activeNode.freq) })
      : t('eqPlot.band')
  const activeTypeLabel = activeNode ? t(`eqPlot.types.${activeNode.type}`) : ''

  return (
    <div
      className={`hi-fi-eq-plot-main-wrapper echo-clean-eq-panel no-drag ${enabled ? '' : 'eq-bypassed'}`}
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="preamp-vertical-container eq-preamp-card">
        <div className="eq-preamp-card-head">
          <span className="preamp-label-title">{t('eqPlot.preamp')}</span>
          <strong className="preamp-label-db">{formatDb(preamp || 0)}</strong>
        </div>
        <div className="eq-preamp-scale">
          <span>+20</span>
          <div className="preamp-vertical-slider-track">
            <input
              type="range"
              min={-PREAMP_RANGE}
              max={PREAMP_RANGE}
              step={0.1}
              value={clamp(preamp || 0, -PREAMP_RANGE, PREAMP_RANGE)}
              onChange={(e) => onPreampChange?.(parseFloat(e.target.value))}
              className="preamp-input"
              aria-label={t('eqPlot.preamp')}
            />
            <div className="preamp-fill" style={{ height: `${preampPercent}%` }} />
            <div className="preamp-thumb" style={{ bottom: `calc(${preampPercent}% - 8px)` }} />
          </div>
          <span>-20</span>
        </div>
        <label className="eq-preamp-number-row">
          <input
            className="eq-number-input preamp-number-input"
            type="number"
            min={-PREAMP_RANGE}
            max={PREAMP_RANGE}
            step={0.1}
            value={drafts.preamp}
            onFocus={() => setEditingField('preamp')}
            onChange={(e) => setDrafts((prev) => ({ ...prev, preamp: e.target.value }))}
            onBlur={() => commitNumber('preamp', drafts.preamp)}
            onKeyDown={handleInputKey('preamp')}
            aria-label={t('eqPlot.preamp')}
          />
          <span>dB</span>
        </label>
      </div>

      <div className="eq-plot-with-labels-container">
        <div className="eq-plot-topline">
          <div>
            <span className="eq-plot-kicker">{activeBandLabel}</span>
            <strong>{activeTypeLabel}</strong>
          </div>
          <span className="eq-plot-tip">{t('eqPlot.scrollQ')}</span>
        </div>
        <div className="eq-canvas-wrapper">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={() => setDraggingIdx(null)}
            onMouseLeave={() => {
              setDraggingIdx(null)
              setHoverIdx(null)
              setMousePoint(null)
            }}
            onWheel={handleWheel}
          />
          {!enabled && (
            <button type="button" className="eq-bypass-enable" onClick={onEnable}>
              {t('eqPlot.bypassedEnable')}
            </button>
          )}
        </div>

        <div className="eq-selected-info-bar">
          <div className="eq-inspector-summary">
            <span>{activeBandLabel}</span>
            <strong>
              {activeNode ? `${formatFreq(activeNode.freq)} / ${formatDb(activeNode.gain)}` : '-'}
            </strong>
            {activeTypeLabel && <em>{activeTypeLabel}</em>}
          </div>
          <div className="eq-inspector-controls">
          <label className="info-item eq-band-picker-label">
            {t('eqPlot.band')}
            <select
              className="eq-filter-type-select eq-band-select"
              value={activeIdx ?? 0}
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10)
                setSelectedIdx(idx)
                setHoverIdx(null)
              }}
            >
              {safeBands.map((band, idx) => (
                <option key={band.id ?? idx} value={idx}>
                  {t('eqPlot.bandOption', { index: idx + 1, freq: formatFreq(band.freq) })}
                </option>
              ))}
            </select>
          </label>

          <label className="info-item">
            {t('eqPlot.freq')}
            <input
              className="eq-number-input"
              type="number"
              min={FREQ_MIN}
              max={FREQ_MAX}
              step={0.5}
              value={drafts.freq}
              onFocus={() => setEditingField('freq')}
              onChange={(e) => setDrafts((prev) => ({ ...prev, freq: e.target.value }))}
              onBlur={() => commitNumber('freq', drafts.freq)}
              onKeyDown={handleInputKey('freq')}
            />
            <span>Hz</span>
          </label>

          <label className="info-item">
            {t('eqPlot.gain')}
            <input
              className="eq-number-input"
              type="number"
              min={-GAIN_RANGE}
              max={GAIN_RANGE}
              step={0.1}
              value={drafts.gain}
              onFocus={() => setEditingField('gain')}
              onChange={(e) => setDrafts((prev) => ({ ...prev, gain: e.target.value }))}
              onBlur={() => commitNumber('gain', drafts.gain)}
              onKeyDown={handleInputKey('gain')}
            />
            <span>dB</span>
          </label>

          <label className="info-item">
            {t('eqPlot.qLabel')}
            <input
              className="eq-number-input eq-q-number"
              type="number"
              min={qMin}
              max={qMax}
              step={0.05}
              value={drafts.q}
              onFocus={() => setEditingField('q')}
              onChange={(e) => setDrafts((prev) => ({ ...prev, q: e.target.value }))}
              onBlur={() => commitNumber('q', drafts.q)}
              onKeyDown={handleInputKey('q')}
            />
          </label>

          {activeNode && activeIdx !== null && (
            <>
              <label className="info-item">
                {t('eqPlot.filterType')}
                <select
                  className="eq-filter-type-select"
                  value={activeNode.type}
                  onChange={(e) => {
                    const nextType = e.target.value
                    setBand(activeIdx, {
                      type: nextType,
                      q: clampBiquadQ(nextType, activeNode.q),
                      slope: isShelf(nextType) ? getShelfSlope(activeNode) : undefined
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

              <label className="info-item eq-slider-item">
                <input
                  type="range"
                  className="eq-q-slider"
                  min={qMin}
                  max={qMax}
                  step={0.05}
                  value={qValue}
                  onChange={(e) =>
                    setBand(activeIdx, {
                      q: clampBiquadQ(activeNode.type, parseFloat(e.target.value))
                    })
                  }
                />
              </label>

              {isShelf(activeNode.type) && (
                <label className="info-item">
                  {t('eqPlot.slope')}
                  <select
                    className="eq-filter-type-select"
                    value={getShelfSlope(activeNode)}
                    onChange={(e) => setBand(activeIdx, { slope: parseInt(e.target.value, 10) })}
                  >
                    {[6, 12, 24].map((slope) => (
                      <option key={slope} value={slope}>
                        {slope} dB/oct
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <button
                type="button"
                className={`eq-mini-btn ${activeNode.enabled === false ? '' : 'active'}`}
                onClick={() => setBand(activeIdx, { enabled: activeNode.enabled === false })}
              >
                {activeNode.enabled === false ? t('eqPlot.disabled') : t('eqPlot.enabled')}
              </button>
              <button
                type="button"
                className={`eq-mini-btn ${soloIdx === activeIdx ? 'active' : ''}`}
                onClick={() => onSoloChange?.(soloIdx === activeIdx ? null : activeIdx)}
              >
                {t('eqPlot.solo')}
              </button>
              <button
                type="button"
                className="eq-mini-btn"
                onClick={() => setBand(activeIdx, { gain: 0 })}
              >
                {t('eqPlot.mute')}
              </button>
            </>
          )}

          <div className="info-item eq-help-text">{t('eqPlot.scrollQ')}</div>
          {activeNode && Math.abs(activeNode.gain) > 12 && (
            <p className="eq-shelf-hint">{t('eqPlot.gainExtremeHint')}</p>
          )}
          {activeNode && isShelf(activeNode.type) && (
            <p className="eq-shelf-hint">{t('eqPlot.shelfQHint')}</p>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
