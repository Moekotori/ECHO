/**
 * Float32 interleaved stereo EQ — same topology as Web Audio: preamp → cascaded biquads.
 * Coefficients follow the Web Audio / RBJ cookbook (Blink biquad_dsp_kernel style).
 */

function clampBiquadQ(type, q) {
  const t = type || 'peaking'
  const n = typeof q === 'number' && !Number.isNaN(q) ? q : 1
  if (t === 'lowshelf' || t === 'highshelf') {
    return Math.max(0.1, Math.min(1, n))
  }
  return Math.max(0.1, Math.min(10, n))
}

/** Normalize so a0 = 1 */
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

/**
 * @param {'peaking'|'lowshelf'|'highshelf'} type
 * @param {number} freqHz
 * @param {number} Q
 * @param {number} gainDb
 * @param {number} sampleRate
 */
export function computeBiquadCoefficients(type, freqHz, Q, gainDb, sampleRate) {
  const sr = sampleRate > 0 ? sampleRate : 44100
  const f = Math.max(1, Math.min(sr * 0.499, freqHz))
  const w0 = (2 * Math.PI * f) / sr
  const cosw0 = Math.cos(w0)
  const sinw0 = Math.sin(w0)

  if (type === 'peaking') {
    const A = Math.pow(10, gainDb / 40)
    const alpha = sinw0 / (2 * Q)
    const b0 = 1 + alpha * A
    const b1 = -2 * cosw0
    const b2 = 1 - alpha * A
    const a0 = 1 + alpha / A
    const a1 = -2 * cosw0
    const a2 = 1 - alpha / A
    return normalizeCoeffs(b0, b1, b2, a0, a1, a2)
  }

  const A = Math.pow(10, gainDb / 40)
  // Web Audio shelf filters: same alpha as Blink / spec
  const inner = (A + 1 / A) * (1 / Q - 1) + 2
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
    this.x1 = this.x2 = this.y1 = this.y2 = 0
  }
}

/**
 * @param {object} eqConfig
 * @param {boolean} eqConfig.useEQ
 * @param {number} eqConfig.preamp
 * @param {Array<{type,freq,q,gain,enabled}>} eqConfig.eqBands
 * @param {number} sampleRate
 * @param {number} channels 1 or 2
 */
const MIN_EQ_BANDS = 16

export function createEqFloatProcessor(eqConfig, sampleRate, channels) {
  const ch = Math.max(1, Math.min(2, channels | 0))
  const bands = Array.isArray(eqConfig?.eqBands) ? eqConfig.eqBands : []
  const sectionCount = Math.max(MIN_EQ_BANDS, bands.length)
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

    update(cfg) {
      const sr = state.sampleRate
      const use = !!cfg?.useEQ
      const pre = typeof cfg?.preamp === 'number' ? cfg.preamp : 0
      state.preampLin = Math.pow(10, pre / 20)
      state.bypass = !use

      const list = Array.isArray(cfg?.eqBands) ? cfg.eqBands : []
      for (let i = 0; i < state.sections.length; i++) {
        const band = list[i]
        const [l, r] = state.sections[i]
        if (!band) {
          l.setCoeffs({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 })
          r.setCoeffs({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 })
          l.reset()
          r.reset()
          continue
        }

        const g = use && band.enabled !== false ? band.gain : 0
        const typ = band.type || 'peaking'
        const q = clampBiquadQ(typ, band.q)
        const c = computeBiquadCoefficients(typ, band.freq, q, g, sr)
        l.setCoeffs(c)
        r.setCoeffs(c)
      }
    },

    /** In-place interleaved float32: [L,R,L,R,...] */
    processInterleaved(data) {
      if (state.bypass) return
      const n = data.length
      const nCh = state.channels
      const sec = state.sections
      const pl = state.preampLin

      for (let i = 0; i < n; i += nCh) {
        for (let c = 0; c < nCh; c++) {
          let x = data[i + c] * pl
          for (let s = 0; s < sec.length; s++) {
            x = sec[s][c].processSample(x)
          }
          data[i + c] = x
        }
      }
    },

    reset() {
      for (const [l, r] of state.sections) {
        l.reset()
        r.reset()
      }
    }
  }

  state.update(eqConfig || { useEQ: false, preamp: 0, eqBands: [] })
  return state
}
