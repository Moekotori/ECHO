import { spawn } from 'child_process'
import { getResolvedFfmpegStaticPath } from './resolveFfmpegStaticPath.js'

const SAMPLE_RATE = 11025
const MAX_SECONDS = 90
const FRAME_SIZE = 1024
const HOP_SIZE = 512
const MIN_BPM = 60
const MAX_BPM = 200
const MAX_PCM_BYTES = SAMPLE_RATE * MAX_SECONDS * 2

function readPcmWindow(filePath) {
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
      String(SAMPLE_RATE),
      '-f',
      's16le',
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
      if (bytes >= MAX_PCM_BYTES) return
      const remaining = MAX_PCM_BYTES - bytes
      const next = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
      chunks.push(next)
      bytes += next.length
      if (bytes >= MAX_PCM_BYTES) {
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

  const frameRate = SAMPLE_RATE / HOP_SIZE
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

function normalizeBpmRange(bpm) {
  let value = bpm
  while (value < MIN_BPM) value *= 2
  while (value > MAX_BPM) value /= 2
  return value
}

export async function detectBpm(filePath) {
  const pcm = await readPcmWindow(filePath)
  const envelope = buildOnsetEnvelope(pcm)
  if (envelope.length < 32) {
    const peakBpm = estimateFromPeakIntervals(envelope)
    return { bpm: peakBpm, confidence: peakBpm ? 0.2 : 0 }
  }

  const frameRate = SAMPLE_RATE / HOP_SIZE
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
    return { bpm: peakBpm, confidence: peakBpm ? 0.25 : 0 }
  }

  const bpm = Math.round(normalizeBpmRange(best.bpm))
  const peakBpm = estimateFromPeakIntervals(envelope)
  const resolvedBpm = peakBpm && Math.abs(peakBpm - bpm) <= 3 ? Math.round((peakBpm + bpm) / 2) : bpm
  const confidence = Math.max(0, Math.min(1, (best.score - second) / best.score))
  return { bpm: resolvedBpm, confidence }
}
