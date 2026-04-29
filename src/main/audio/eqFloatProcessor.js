/**
 * Float32 interleaved EQ for the native path.
 * Topology mirrors Web Audio where possible: preamp -> cascaded biquads -> output safety.
 */

const MIN_EQ_BANDS = 16
const MAX_STAGES_PER_BAND = 2
const SOFT_LIMIT = 0.999
const SOFT_KNEE = 0.944
const SOFT_DEN = Math.tanh(1.8)

function clampBiquadQ(type, q) {
  const t = type || 'peaking'
  const n = typeof q === 'number' && !Number.isNaN(q) ? q : 1
  if (t === 'lowshelf' || t === 'highshelf') {
    return Math.max(0.1, Math.min(2, n))
  }
  return Math.max(0.1, Math.min(10, n))
}

function clamp(value, min, max, fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, n))
}

function resolveOversampling(value) {
  if (value === '4x') return 4
  if (value === 'off' || value === '1x') return 1
  return 2
}

function resolveOutputSafety(value) {
  if (value === 'hard' || value === 'limit') return 'hard'
  if (value === 'off') return 'off'
  return 'soft'
}

function shelfSlope(value) {
  return value === 6 || value === 24 ? value : 12
}

function normalizeCoeffs(b0, b1, b2, a0, a1, a2) {
  if (!Number.isFinite(a0) || Math.abs(a0) < 1e-12) {
    return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
  }
  const inv = 1 / a0
  return {
    b0: b0 * inv,
    b1: b1 * inv,
    b2: b2 * inv,
    a1: a1 * inv,
    a2: a2 * inv
  }
}

export function computeBiquadCoefficients(type, freqHz, Q, gainDb, sampleRate) {
  const sr = sampleRate > 0 ? sampleRate : 44100
  const f = Math.max(1, Math.min(sr * 0.499, freqHz))
  const w0 = (2 * Math.PI * f) / sr
  const cosw0 = Math.cos(w0)
  const sinw0 = Math.sin(w0)
  const q = Math.max(0.1, Q || 1)

  if (type === 'lowpass' || type === 'highpass' || type === 'notch' || type === 'allpass') {
    const alpha = sinw0 / (2 * q)
    const a0 = 1 + alpha
    const a1 = -2 * cosw0
    const a2 = 1 - alpha

    if (type === 'lowpass') {
      const b0 = (1 - cosw0) / 2
      const b1 = 1 - cosw0
      const b2 = (1 - cosw0) / 2
      return normalizeCoeffs(b0, b1, b2, a0, a1, a2)
    }

    if (type === 'highpass') {
      const b0 = (1 + cosw0) / 2
      const b1 = -(1 + cosw0)
      const b2 = (1 + cosw0) / 2
      return normalizeCoeffs(b0, b1, b2, a0, a1, a2)
    }

    if (type === 'notch') {
      return normalizeCoeffs(1, -2 * cosw0, 1, a0, a1, a2)
    }

    return normalizeCoeffs(1 - alpha, -2 * cosw0, 1 + alpha, a0, a1, a2)
  }

  if (type === 'peaking') {
    const A = Math.pow(10, gainDb / 40)
    const alpha = sinw0 / (2 * q)
    const b0 = 1 + alpha * A
    const b1 = -2 * cosw0
    const b2 = 1 - alpha * A
    const a0 = 1 + alpha / A
    const a1 = -2 * cosw0
    const a2 = 1 - alpha / A
    return normalizeCoeffs(b0, b1, b2, a0, a1, a2)
  }

  const A = Math.pow(10, gainDb / 40)
  const inner = (A + 1 / A) * (1 / q - 1) + 2
  const alpha = (sinw0 / 2) * Math.sqrt(Math.max(0, inner))
  const k = cosw0
  const k2 = 2 * Math.sqrt(A) * alpha

  if (type === 'lowshelf') {
    const ap = A + 1
    const am = A - 1
    const b0 = A * (ap - am * k + k2)
    const b1 = 2 * A * (am - ap * k)
    const b2 = A * (ap - am * k - k2)
    const a0 = ap + am * k + k2
    const a1 = -2 * (am + ap * k)
    const a2 = ap + am * k - k2
    return normalizeCoeffs(b0, b1, b2, a0, a1, a2)
  }

  if (type === 'highshelf') {
    const ap = A + 1
    const am = A - 1
    const b0 = A * (ap + am * k + k2)
    const b1 = -2 * A * (am + ap * k)
    const b2 = A * (ap + am * k - k2)
    const a0 = ap - am * k + k2
    const a1 = 2 * (am - ap * k)
    const a2 = ap - am * k - k2
    return normalizeCoeffs(b0, b1, b2, a0, a1, a2)
  }

  return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
}

class BiquadChannel {
  constructor() {
    this.b0 = 1
    this.b1 = 0
    this.b2 = 0
    this.a1 = 0
    this.a2 = 0
    this.x1 = 0
    this.x2 = 0
    this.y1 = 0
    this.y2 = 0
  }

  setCoeffs(c) {
    this.b0 = c.b0
    this.b1 = c.b1
    this.b2 = c.b2
    this.a1 = c.a1
    this.a2 = c.a2
  }

  processSample(x) {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }

  reset() {
    this.x1 = 0
    this.x2 = 0
    this.y1 = 0
    this.y2 = 0
  }
}

function softClipSample(x) {
  const ax = Math.abs(x)
  if (ax <= SOFT_KNEE) return x
  const sign = x < 0 ? -1 : 1
  const t = (ax - SOFT_KNEE) / (SOFT_LIMIT - SOFT_KNEE)
  const shaped = SOFT_KNEE + (SOFT_LIMIT - SOFT_KNEE) * (Math.tanh(t * 1.8) / SOFT_DEN)
  return sign * Math.min(SOFT_LIMIT, shaped)
}

function applyOutputSafety(x, mode) {
  if (mode === 'off') return x
  if (mode === 'hard') {
    if (x > SOFT_LIMIT) return SOFT_LIMIT
    if (x < -SOFT_LIMIT) return -SOFT_LIMIT
    return x
  }
  return softClipSample(x)
}

export function createEqFloatProcessor(eqConfig, sampleRate, channels) {
  const ch = Math.max(1, Math.min(2, channels | 0))
  const bands = Array.isArray(eqConfig?.eqBands) ? eqConfig.eqBands : []
  const bandCount = Math.max(MIN_EQ_BANDS, bands.length)
  const sectionCount = bandCount * MAX_STAGES_PER_BAND
  const sections = []
  for (let i = 0; i < sectionCount; i++) {
    sections.push([new BiquadChannel(), new BiquadChannel()])
  }

  const state = {
    sampleRate,
    channels: ch,
    sections,
    preampLin: 1,
    bypass: true,
    oversampleFactor: 2,
    outputSafety: 'soft',
    oversamplePrev: new Float32Array(ch),
    oversamplePrimed: false,

    setIdentity(sectionIndex) {
      const pair = state.sections[sectionIndex]
      if (!pair) return
      pair[0].setCoeffs({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 })
      pair[1].setCoeffs({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 })
    },

    update(cfg) {
      const use = !!cfg?.useEQ
      const pre = typeof cfg?.preamp === 'number' ? cfg.preamp : 0
      const nextFactor = resolveOversampling(cfg?.eqOversampling ?? cfg?.oversampling)
      const factorChanged = nextFactor !== state.oversampleFactor
      state.oversampleFactor = nextFactor
      state.outputSafety = resolveOutputSafety(cfg?.eqOutputSafety ?? cfg?.outputSafety)
      state.preampLin = Math.pow(10, pre / 20)
      state.bypass = !use

      const processRate = state.sampleRate * state.oversampleFactor
      const list = Array.isArray(cfg?.eqBands) ? cfg.eqBands : []
      for (let i = 0; i < state.sections.length; i++) state.setIdentity(i)

      for (let i = 0; i < bandCount; i++) {
        const band = list[i]
        if (!band) continue

        const typ = band.type || 'peaking'
        const enabled = use && band.enabled !== false
        if (!enabled) continue
        const gain = clamp(band.gain, -24, 24, 0)
        const freq = clamp(band.freq, 20, 20000, 1000)
        const slope = shelfSlope(band.slope)
        const isShelf = typ === 'lowshelf' || typ === 'highshelf'
        const stages = isShelf && slope === 24 ? 2 : 1
        const gainPerStage = stages > 1 ? gain / stages : gain
        const q = clampBiquadQ(typ, isShelf && slope === 6 ? 0.55 : band.q)

        for (let stage = 0; stage < stages; stage++) {
          const c = computeBiquadCoefficients(typ, freq, q, gainPerStage, processRate)
          const sectionIndex = i * MAX_STAGES_PER_BAND + stage
          const pair = state.sections[sectionIndex]
          if (!pair) continue
          pair[0].setCoeffs(c)
          pair[1].setCoeffs(c)
        }
      }

      if (factorChanged) state.reset()
    },

    processChannelSample(x, channel) {
      let y = x * state.preampLin
      const sec = state.sections
      for (let s = 0; s < sec.length; s++) {
        y = sec[s][channel].processSample(y)
      }
      return y
    },

    processOversampledSample(x, channel) {
      const factor = state.oversampleFactor
      if (factor <= 1) return state.processChannelSample(x, channel)
      const prev = state.oversamplePrimed ? state.oversamplePrev[channel] : x
      let acc = 0
      for (let os = 1; os <= factor; os++) {
        const interp = prev + (x - prev) * (os / factor)
        acc += state.processChannelSample(interp, channel)
      }
      state.oversamplePrev[channel] = x
      return acc / factor
    },

    processInterleaved(data) {
      if (state.bypass) return
      const n = data.length
      const nCh = state.channels

      if (!state.oversamplePrimed && n >= nCh) {
        for (let c = 0; c < nCh; c++) state.oversamplePrev[c] = data[c]
        state.oversamplePrimed = true
      }

      for (let i = 0; i < n; i += nCh) {
        for (let c = 0; c < nCh; c++) {
          const x = state.processOversampledSample(data[i + c], c)
          data[i + c] = applyOutputSafety(x, state.outputSafety)
        }
      }
    },

    reset() {
      for (let i = 0; i < state.sections.length; i++) {
        state.sections[i][0].reset()
        state.sections[i][1].reset()
      }
      state.oversamplePrev.fill(0)
      state.oversamplePrimed = false
    }
  }

  state.update(eqConfig || { useEQ: false, preamp: 0, eqBands: [] })
  return state
}
