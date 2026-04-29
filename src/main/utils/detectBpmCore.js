import { spawn } from 'child_process'
import { createRequire } from 'module'
import { getResolvedFfmpegStaticPath } from './resolveFfmpegStaticPath.js'

const require = createRequire(import.meta.url)

const ESSENTIA_SAMPLE_RATE = 44100
const FALLBACK_SAMPLE_RATE = 11025
const MAX_SECONDS = 90
const FRAME_SIZE = 1024
const HOP_SIZE = 512
const MIN_BPM = 60
const MAX_BPM = 200
const ESSENTIA_MAX_PCM_BYTES = ESSENTIA_SAMPLE_RATE * MAX_SECONDS * 4
const FALLBACK_MAX_PCM_BYTES = FALLBACK_SAMPLE_RATE * MAX_SECONDS * 2

let essentiaInstance = null
let essentiaLoadFailed = false

function readPcmWindow(filePath, { sampleRate, format, maxBytes }) {
  return new Promise((resolve) => {
    const ffmpegPath = getResolvedFfmpegStaticPath()
    if (!ffmpegPath || typeof filePath !== 'string' || !filePath.trim()) {
      resolve(null)
      return
    }

    const args = [
      '-hide_banner',
      '-nostdin',
      '-i',
      filePath,
      '-t',
      String(MAX_SECONDS),
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      format,
      'pipe:1'
    ]

    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    })

    const chunks = []
    let bytes = 0
    let settled = false

    const finish = (buffer) => {
      if (settled) return
      settled = true
      resolve(buffer)
    }

    proc.stdout.on('data', (chunk) => {
      if (bytes >= maxBytes) return
      const remaining = maxBytes - bytes
      const next = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
      chunks.push(next)
      bytes += next.length
      if (bytes >= maxBytes) {
        try {
          proc.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
    })

    proc.on('error', () => finish(null))
    proc.on('close', () => finish(bytes > 0 ? Buffer.concat(chunks, bytes) : null))
  })
}

function readEssentiaPcmWindow(filePath) {
  return readPcmWindow(filePath, {
    sampleRate: ESSENTIA_SAMPLE_RATE,
    format: 'f32le',
    maxBytes: ESSENTIA_MAX_PCM_BYTES
  })
}

function readFallbackPcmWindow(filePath) {
  return readPcmWindow(filePath, {
    sampleRate: FALLBACK_SAMPLE_RATE,
    format: 's16le',
    maxBytes: FALLBACK_MAX_PCM_BYTES
  })
}

function getEssentia() {
  if (essentiaInstance) return essentiaInstance
  if (essentiaLoadFailed) return null
  try {
    const { Essentia, EssentiaWASM } = require('essentia.js')
    essentiaInstance = new Essentia(EssentiaWASM)
    return essentiaInstance
  } catch (error) {
    essentiaLoadFailed = true
    console.warn('[BPM] Essentia.js unavailable, using fallback:', error?.message || error)
    return null
  }
}

function pcmFloat32BufferToArray(buffer) {
  if (!buffer || buffer.length < 4) return null
  const sampleCount = Math.floor(buffer.length / 4)
  const signal = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i += 1) {
    const value = buffer.readFloatLE(i * 4)
    signal[i] = Number.isFinite(value) ? value : 0
  }
  return signal
}

function buildOnsetEnvelope(pcm) {
  if (!pcm || pcm.length < FRAME_SIZE * 2) return []
  const sampleCount = Math.floor(pcm.length / 2)
  const energies = []

  for (let offset = 0; offset + FRAME_SIZE < sampleCount; offset += HOP_SIZE) {
    let energy = 0
    for (let i = 0; i < FRAME_SIZE; i += 1) {
      const sample = pcm.readInt16LE((offset + i) * 2) / 32768
      energy += sample * sample
    }
    energies.push(Math.sqrt(energy / FRAME_SIZE))
  }

  if (energies.length < 8) return []
  const flux = []
  let prev = energies[0]
  for (let i = 1; i < energies.length; i += 1) {
    const diff = energies[i] - prev
    flux.push(diff > 0 ? diff : 0)
    prev = energies[i]
  }

  const mean = flux.reduce((sum, value) => sum + value, 0) / Math.max(1, flux.length)
  const variance =
    flux.reduce((sum, value) => {
      const delta = value - mean
      return sum + delta * delta
    }, 0) / Math.max(1, flux.length)
  const stdev = Math.sqrt(variance) || 1

  return flux.map((value) => Math.max(0, (value - mean) / stdev))
}

function scoreLag(envelope, lag) {
  let score = 0
  let count = 0
  for (let i = lag; i < envelope.length; i += 1) {
    score += envelope[i] * envelope[i - lag]
    count += 1
  }
  return count > 0 ? score / count : 0
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] || 0
}

function normalizeBpmRange(bpm) {
  let value = bpm
  while (value < MIN_BPM) value *= 2
  while (value > MAX_BPM) value /= 2
  return value
}

function estimateFromPeakIntervals(envelope) {
  if (envelope.length < 16) return null
  const threshold = Math.max(0.8, median(envelope) * 1.8)
  const peaks = []

  for (let i = 1; i < envelope.length - 1; i += 1) {
    if (envelope[i] < threshold) continue
    if (envelope[i] < envelope[i - 1] || envelope[i] < envelope[i + 1]) continue
    if (peaks.length && i - peaks[peaks.length - 1] < 3) {
      if (envelope[i] > envelope[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i
    } else {
      peaks.push(i)
    }
  }

  if (peaks.length < 4) return null

  const frameRate = FALLBACK_SAMPLE_RATE / HOP_SIZE
  const bins = new Map()
  for (let i = 0; i < peaks.length; i += 1) {
    for (let j = i + 1; j < Math.min(peaks.length, i + 8); j += 1) {
      const frames = peaks[j] - peaks[i]
      if (frames <= 0) continue
      const rawBpm = normalizeBpmRange((60 * frameRate) / frames)
      if (rawBpm < MIN_BPM || rawBpm > MAX_BPM) continue
      const bpm = Math.round(rawBpm)
      bins.set(bpm, (bins.get(bpm) || 0) + 1)
    }
  }

  let best = { bpm: null, score: 0 }
  for (const [bpm, score] of bins.entries()) {
    if (score > best.score) best = { bpm, score }
  }
  return best.bpm
}

async function detectBpmWithEssentia(filePath) {
  const essentia = getEssentia()
  if (!essentia) return null

  const pcm = await readEssentiaPcmWindow(filePath)
  const signal = pcmFloat32BufferToArray(pcm)
  if (!signal || signal.length < ESSENTIA_SAMPLE_RATE * 5) return null

  let vector = null
  try {
    vector = essentia.arrayToVector(signal)
    const result = essentia.RhythmExtractor2013(vector, MAX_BPM, 'multifeature', MIN_BPM)
    const rawBpm = Number(result?.bpm)
    if (!Number.isFinite(rawBpm) || rawBpm <= 0) return null
    const rawConfidence = Number(result?.confidence)
    return {
      bpm: Math.round(normalizeBpmRange(rawBpm)),
      confidence: Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0,
      backend: 'essentia-rhythm-extractor-2013'
    }
  } catch (error) {
    console.warn('[BPM] Essentia.js RhythmExtractor2013 failed:', error?.message || error)
    return null
  } finally {
    try {
      vector?.delete?.()
    } catch {
      /* ignore */
    }
  }
}

async function detectBpmWithFallback(filePath) {
  const pcm = await readFallbackPcmWindow(filePath)
  const envelope = buildOnsetEnvelope(pcm)
  if (envelope.length < 32) {
    const peakBpm = estimateFromPeakIntervals(envelope)
    return {
      bpm: peakBpm,
      confidence: peakBpm ? 0.2 : 0,
      backend: 'fallback-autocorrelation'
    }
  }

  const frameRate = FALLBACK_SAMPLE_RATE / HOP_SIZE
  let best = { bpm: null, score: 0 }
  let second = 0

  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 1) {
    const lag = Math.round((60 * frameRate) / bpm)
    if (lag < 2 || lag >= envelope.length / 2) continue
    const score =
      scoreLag(envelope, lag) +
      scoreLag(envelope, Math.max(2, Math.round(lag / 2))) * 0.35 +
      scoreLag(envelope, Math.min(envelope.length - 1, lag * 2)) * 0.2
    if (score > best.score) {
      second = best.score
      best = { bpm, score }
    } else if (score > second) {
      second = score
    }
  }

  if (!best.bpm || best.score <= 0) {
    const peakBpm = estimateFromPeakIntervals(envelope)
    return {
      bpm: peakBpm,
      confidence: peakBpm ? 0.25 : 0,
      backend: 'fallback-autocorrelation'
    }
  }

  const bpm = Math.round(normalizeBpmRange(best.bpm))
  const peakBpm = estimateFromPeakIntervals(envelope)
  const resolvedBpm =
    peakBpm && Math.abs(peakBpm - bpm) <= 3 ? Math.round((peakBpm + bpm) / 2) : bpm
  const confidence = Math.max(0, Math.min(1, (best.score - second) / best.score))
  return { bpm: resolvedBpm, confidence, backend: 'fallback-autocorrelation' }
}

export async function detectBpmInProcess(filePath) {
  const essentiaResult = await detectBpmWithEssentia(filePath)
  if (essentiaResult?.bpm) {
    return essentiaResult
  }
  return await detectBpmWithFallback(filePath)
}
