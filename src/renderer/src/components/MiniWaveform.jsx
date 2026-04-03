import { useRef, useEffect, useCallback } from 'react'

function readCssColorVar(name, fallback) {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function MiniWaveform({ analyser, isPlaying }) {
  const CANVAS_HEIGHT = 150
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const gradientRef = useRef({ key: '', gradient: null })

  const draw = useCallback(() => {
    if (!canvasRef.current || !analyser) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    analyser.getByteFrequencyData(dataArray)

    ctx.clearRect(0, 0, width, height)

    const barWidth = 10
    const barGap = 6
    const barCount = Math.floor(width / (barWidth + barGap))

    const c1 = readCssColorVar('--accent-pink', '#f7aab5')
    const c2 = readCssColorVar('--accent-blue', '#a3d2e3')
    const c3 = readCssColorVar('--accent-mint', '#bbf0d8')
    const gradKey = `${c1}|${c2}|${c3}|${width}`
    let gradient = gradientRef.current.gradient
    if (gradientRef.current.key !== gradKey) {
      gradient = ctx.createLinearGradient(0, 0, width, 0)
      gradient.addColorStop(0, c1)
      gradient.addColorStop(0.5, c2)
      gradient.addColorStop(1, c3)
      gradientRef.current = { key: gradKey, gradient }
    }

    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor((i / barCount) * (bufferLength * 0.4))
      const val = dataArray[dataIndex] || 0
      const percent = Math.pow(val / 255, 1.2)
      const barHeight = Math.max(8, percent * height * 0.95)

      ctx.fillStyle = gradient

      const x = i * (barWidth + barGap)
      const y = height - barHeight

      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barWidth, barHeight, [barWidth / 2])
      } else {
        ctx.rect(x, y, barWidth, barHeight)
      }
      ctx.fill()
    }
  }, [analyser])

  useEffect(() => {
    const loop = () => {
      draw()
      animationRef.current = requestAnimationFrame(loop)
    }
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(loop)
    } else {
      draw()
    }
    return () => cancelAnimationFrame(animationRef.current)
  }, [isPlaying, draw])

  return (
    <div className="mini-waveform-container no-drag">
      <canvas
        ref={canvasRef}
        width={800}
        height={CANVAS_HEIGHT}
        style={{ width: '100%', height: `${CANVAS_HEIGHT}px` }}
      />
    </div>
  )
}
