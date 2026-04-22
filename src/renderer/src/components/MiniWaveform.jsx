import { useRef, useEffect, useCallback } from 'react'

function readCssColorVar(name, fallback) {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function MiniWaveform({ analyser, isPlaying }) {
  // Visual height is controlled by CSS on `.mini-waveform-container`.
  // Keep a fallback here for initial layout before first ResizeObserver tick.
  const CANVAS_HEIGHT = 120
  const BAR_WIDTH = 10
  const BAR_GAP = 6

  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const lastFrameAtRef = useRef(0)
  const gradientRef = useRef({ key: '', gradient: null })
  const layoutRef = useRef({ width: 0, height: CANVAS_HEIGHT, dpr: 1 })
  const dataArrayRef = useRef(null)
  const barStateRef = useRef([])
  const energyPeakRef = useRef(0.22)
  const paletteRef = useRef({
    c1: '#f7aab5',
    c2: '#a3d2e3',
    c3: '#bbf0d8'
  })

  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = containerRef.current
    if (!canvas || !wrap) return

    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.floor(wrap.clientWidth))
    const height = Math.max(1, Math.floor(wrap.clientHeight || CANVAS_HEIGHT))
    const nextPixelWidth = Math.round(width * dpr)
    const nextPixelHeight = Math.round(height * dpr)

    if (canvas.width !== nextPixelWidth || canvas.height !== nextPixelHeight) {
      canvas.width = nextPixelWidth
      canvas.height = nextPixelHeight
    }

    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    layoutRef.current = { width, height, dpr }
    gradientRef.current = { key: '', gradient: null }
  }, [])

  const refreshPalette = useCallback(() => {
    paletteRef.current = {
      c1: readCssColorVar('--accent-pink', '#f7aab5'),
      c2: readCssColorVar('--accent-blue', '#a3d2e3'),
      c3: readCssColorVar('--accent-mint', '#bbf0d8')
    }
    gradientRef.current = { key: '', gradient: null }
  }, [])

  const draw = useCallback(
    (timestamp = 0) => {
      if (!canvasRef.current || !analyser) return
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
      if (!ctx) return

      const previousTs = lastFrameAtRef.current || 0
      const frameDeltaMs =
        previousTs > 0 && timestamp > previousTs ? Math.min(40, timestamp - previousTs) : 1000 / 60
      lastFrameAtRef.current = timestamp || performance.now()
      const deltaFactor = frameDeltaMs / (1000 / 60)

      let { width, height, dpr } = layoutRef.current
      if (width < 2 || height < 2) {
        syncCanvasSize()
        ;({ width, height, dpr } = layoutRef.current)
        if (width < 2 || height < 2) return
      }

      const bufferLength = analyser.frequencyBinCount
      let dataArray = dataArrayRef.current
      if (!dataArray || dataArray.length !== bufferLength) {
        dataArray = new Uint8Array(bufferLength)
        dataArrayRef.current = dataArray
      }
      analyser.getByteFrequencyData(dataArray)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const barCount = Math.max(12, Math.floor(width / (BAR_WIDTH + BAR_GAP)))

      const { c1, c2, c3 } = paletteRef.current
      const gradKey = `${c1}|${c2}|${c3}|${width}`
      let gradient = gradientRef.current.gradient
      if (gradientRef.current.key !== gradKey) {
        gradient = ctx.createLinearGradient(0, 0, width, 0)
        gradient.addColorStop(0, c1)
        gradient.addColorStop(0.5, c2)
        gradient.addColorStop(1, c3)
        gradientRef.current = { key: gradKey, gradient }
      }
      ctx.fillStyle = gradient

      const minBarHeight = 3
      const maxVisualHeight = Math.max(minBarHeight, height - 6)
      const bandLimit = Math.max(24, Math.floor(bufferLength * 0.62))
      const nextBarState = new Array(barCount).fill(0)
      let frameEnergyPeak = 0

      for (let i = 0; i < barCount; i++) {
        const startNorm = i / barCount
        const endNorm = (i + 1) / barCount
        const startIndex = Math.floor(Math.pow(startNorm, 1.85) * bandLimit)
        const endIndex = Math.max(startIndex + 1, Math.floor(Math.pow(endNorm, 1.85) * bandLimit))

        let sum = 0
        let peak = 0
        let count = 0
        for (let idx = startIndex; idx < endIndex && idx < bandLimit; idx++) {
          const val = dataArray[idx] || 0
          sum += val
          if (val > peak) peak = val
          count += 1
        }

        const avg = count > 0 ? sum / count : 0
        const combined = peak * 0.58 + avg * 0.42
        frameEnergyPeak = Math.max(frameEnergyPeak, combined)
        nextBarState[i] = combined
      }

      const previousPeak = energyPeakRef.current || 0.22
      const peakDecay = Math.pow(0.94, deltaFactor)
      const nextPeak = Math.max(frameEnergyPeak / 255, previousPeak * peakDecay, 0.16)
      energyPeakRef.current = nextPeak

      const previousBarState = barStateRef.current
      for (let i = 0; i < barCount; i++) {
        const raw = nextBarState[i] / 255
        const gated = Math.max(0, raw - 0.055)
        const normalized = Math.min(1, gated / Math.max(0.14, nextPeak - 0.03))
        const shaped = Math.pow(normalized, 1.45)
        const prev = previousBarState[i] ?? 0
        const attackMix = 1 - Math.pow(0.25, deltaFactor)
        const releaseMix = 1 - Math.pow(0.8, deltaFactor)
        const eased =
          shaped > prev ? prev + (shaped - prev) * attackMix : prev + (shaped - prev) * releaseMix
        const barHeight = minBarHeight + eased * (maxVisualHeight - minBarHeight)
        nextBarState[i] = eased

        const x = i * (BAR_WIDTH + BAR_GAP)
        const y = height - barHeight

        ctx.beginPath()
        if (ctx.roundRect) {
          ctx.roundRect(x, y, BAR_WIDTH, barHeight, [BAR_WIDTH / 2])
        } else {
          ctx.rect(x, y, BAR_WIDTH, barHeight)
        }
        ctx.fill()
      }
      barStateRef.current = nextBarState
    },
    [analyser, refreshPalette, syncCanvasSize]
  )

  useEffect(() => {
    refreshPalette()
    syncCanvasSize()
    draw()
  }, [refreshPalette, syncCanvasSize, draw])

  useEffect(() => {
    const wrap = containerRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined

    const ro = new ResizeObserver(() => {
      syncCanvasSize()
      draw()
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [syncCanvasSize, draw])

  useEffect(() => {
    const loop = (timestamp) => {
      draw(timestamp)
      animationRef.current = requestAnimationFrame(loop)
    }
    if (isPlaying) {
      barStateRef.current = []
      energyPeakRef.current = 0.22
      lastFrameAtRef.current = 0
      animationRef.current = requestAnimationFrame(loop)
    } else {
      barStateRef.current = []
      energyPeakRef.current = 0.22
      lastFrameAtRef.current = 0
      draw(performance.now())
    }
    return () => cancelAnimationFrame(animationRef.current)
  }, [isPlaying, draw])

  return (
    <div className="mini-waveform-container no-drag" ref={containerRef}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
