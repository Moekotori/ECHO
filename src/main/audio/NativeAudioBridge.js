import { spawn, execFileSync } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'
import { Writable } from 'stream'
import readline from 'readline'
import { logLine } from '../utils/logLine.js'

/**
 * Resolve the path to the echo-audio-host binary.
 * In production it lives in resources/; in dev it lives in electron-app/build/.
 */
function resolveHostBinary() {
  const exe = process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host'

  const candidates = [
    join(process.resourcesPath || '', exe),
    join(app.getAppPath(), '..', exe),
    join(app.getAppPath(), '..', '..', 'electron-app', 'build', exe),
    join(app.getAppPath(), 'electron-app', 'build', exe)
  ]

  // Also check relative to the working directory (dev mode)
  try {
    const cwd = process.cwd()
    candidates.push(join(cwd, 'electron-app', 'build', exe))
  } catch {
    /* ignore */
  }

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Check whether the echo-audio-host binary is available.
 */
export function isNativeBridgeAvailable() {
  return resolveHostBinary() !== null
}

function parseDeviceListLine(line) {
  const parts = line.trim().split('\t')
  if (parts.length < 2) return null
  const index = parseInt(parts[0], 10)
  if (!Number.isFinite(index)) return null
  const sampleRate = parseInt(parts[2] || '0', 10)
  const sharedSampleRate = parseInt(parts[4] || '0', 10)
  return {
    index,
    name: parts[1],
    sampleRate: Number.isFinite(sampleRate) ? sampleRate : 0,
    sharedSampleRate: Number.isFinite(sharedSampleRate) ? sharedSampleRate : 0,
    isDefault: parts[3] === '1'
  }
}

/**
 * List audio devices by running `echo-audio-host -list`.
 * Returns an array of `{ index, name }`.
 */
export function listNativeDevices() {
  const bin = resolveHostBinary()
  if (!bin) return []
  try {
    const out = execFileSync(bin, ['-list'], { timeout: 5000, encoding: 'utf-8' })
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseDeviceListLine)
      .filter(Boolean)
  } catch (e) {
    console.error('[NativeAudioBridge] listDevices failed:', e?.message || e)
    return []
  }
}

export function listAsioDevices() {
  const bin = resolveHostBinary()
  if (!bin) return []
  try {
    const out = execFileSync(bin, ['-list', '-asio'], { timeout: 5000, encoding: 'utf-8' })
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseDeviceListLine)
      .filter(Boolean)
  } catch (e) {
    console.error('[NativeAudioBridge] listAsioDevices failed:', e?.message || e)
    return []
  }
}

/**
 * A writable stream adapter that forwards data to the child process stdin.
 * When the child process is gone the writes are silently dropped.
 */
class BridgeWritable extends Writable {
  constructor(childStdin) {
    super()
    this._target = childStdin
    this._closed = false
    childStdin.on('error', () => {
      this._closed = true
    })
    childStdin.on('close', () => {
      this._closed = true
    })
  }
  _write(chunk, encoding, callback) {
    const target = this._target
    if (
      this._closed ||
      !target ||
      target.destroyed ||
      target.writableEnded ||
      target.writableFinished ||
      !target.writable
    ) {
      this._closed = true
      return callback()
    }

    try {
      target.write(chunk, (err) => {
        if (err) {
          this._closed = true
          return callback()
        }
        callback()
      })
    } catch {
      this._closed = true
      callback()
    }
  }
  _final(callback) {
    const target = this._target
    if (
      !this._closed &&
      target &&
      !target.destroyed &&
      !target.writableEnded &&
      !target.writableFinished &&
      target.writable
    ) {
      try {
        target.end(callback)
      } catch {
        this._closed = true
        callback()
      }
    } else {
      callback()
    }
  }
}

/**
 * NativeAudioBridge — manages a single echo-audio-host child process.
 *
 * Usage:
 *   const bridge = new NativeAudioBridge()
 *   await bridge.start({ sampleRate: 44100, channels: 2 })
 *   ffmpegStream.pipe(bridge.writable)
 *   console.log(bridge.getPosition()) // seconds from output clock
 *   bridge.stop()
 */
export class NativeAudioBridge {
  constructor() {
    this._proc = null
    this._writable = null
    this._framesConsumed = 0
    this._frameOffset = 0
    this._sampleRate = 44100
    this._startTime = 0
    this._playbackRate = 1.0
    this._ready = false
    this._ended = false
    /** True while we intentionally kill the child (replace track / teardown). Suppresses spurious onError for SIGKILL (code=null). */
    this._stopRequested = false
    this._readyTimer = null
    this._onEnded = null
    this._onError = null
    this._deviceInfo = null
  }

  get writable() {
    return this._writable
  }

  /**
   * Spawn the child process.
   * Resolves once the first `{"ready":true}` JSON line arrives.
   */
  start({
    sampleRate = 44100,
    channels = 2,
    deviceIndex = -1,
    deviceName,
    asio = false,
    exclusive = false,
    volume: _vol = 1.0,
    startTime = 0,
    playbackRate = 1.0
  }) {
    return new Promise((resolve, reject) => {
      const bin = resolveHostBinary()
      if (!bin) return reject(new Error('echo-audio-host binary not found'))

      this._sampleRate = sampleRate
      this._startTime = startTime
      this._playbackRate = playbackRate
      this._framesConsumed = 0
      this._frameOffset = 0
      this._ready = false
      this._ended = false

      const args = ['-sr', String(sampleRate), '-ch', String(channels)]
      if (deviceIndex >= 0) args.push('-device-index', String(deviceIndex))
      else if (deviceName) args.push('-device', deviceName)
      if (asio) args.push('-asio')
      if (exclusive && !asio) args.push('-exclusive')
      // Volume is applied only in the main-process AudioProcessor (JS) so live
      // slider changes stay consistent. Do not pass -vol here — C++ g_volume
      // would double-apply with already-scaled PCM and stay stale until restart.

      logLine(`[NativeAudioBridge] spawn: ${bin} ${args.join(' ')}`)

      this._proc = spawn(bin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })

      this._writable = new BridgeWritable(this._proc.stdin)

      // Parse stdout JSON lines
      const rl = readline.createInterface({ input: this._proc.stdout })
      rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line)
          if (msg.ready) {
            this._ready = true
            this._deviceInfo = msg
            if (this._readyTimer) {
              clearTimeout(this._readyTimer)
              this._readyTimer = null
            }
            // Sync to actual device sample rate (may differ from requested
            // when exclusive mode uses the device's native rate)
            if (typeof msg.sampleRate === 'number' && msg.sampleRate > 0) {
              this._sampleRate = msg.sampleRate
            }
            resolve({ ok: true, device: msg })
          }
          if (typeof msg.pos === 'number') {
            this._framesConsumed = msg.pos
          }
          if (msg.event === 'ended') {
            if (this._stopRequested) return
            this._ended = true
            if (this._onEnded) this._onEnded()
          }
        } catch {
          /* non-JSON line, ignore */
        }
      })

      // Capture stderr for logging
      const stderrRL = readline.createInterface({ input: this._proc.stderr })
      stderrRL.on('line', (line) => {
        logLine(`[echo-audio-host] ${line}`)
      })

      this._proc.on('error', (err) => {
        console.error('[NativeAudioBridge] process error:', err?.message || err)
        if (!this._ready) reject(err)
        if (this._onError) this._onError(err)
      })

      this._proc.on('exit', (code, signal) => {
        const wasReady = this._ready
        this._ready = false
        if (code === -2) {
          // Exclusive mode denied
          if (this._onError) this._onError(new Error('exclusive_denied'))
          return
        }
        const intentional = this._stopRequested
        this._stopRequested = false
        if (!intentional) {
          logLine(`[NativeAudioBridge] exited code=${code} signal=${signal}`)
        }
        if (!wasReady && !intentional && code !== 0) {
          if (this._readyTimer) {
            clearTimeout(this._readyTimer)
            this._readyTimer = null
          }
          const errMsg = code != null ? `exit_code_${code}` : `exit_signal_${signal || '?'}`
          reject(new Error(errMsg))
          return
        }
        if (intentional || this._ended) return
        if (code === 0) return
        // code=null means signal exit (e.g. SIGKILL); only report if not our stop()
        const errMsg = code != null ? `exit_code_${code}` : `exit_signal_${signal || '?'}`
        if (this._onError) this._onError(new Error(errMsg))
      })

      // Timeout if no ready message within 5s
      if (this._readyTimer) clearTimeout(this._readyTimer)
      this._readyTimer = setTimeout(() => {
        this._readyTimer = null
        if (!this._ready) {
          this.stop()
          reject(new Error('timeout waiting for echo-audio-host ready'))
        }
      }, 5000)
    })
  }

  /**
   * Get current playback position in seconds, derived from the output-side
   * frame counter (what the user actually hears).
   */
  getPosition() {
    if (this._sampleRate <= 0) return this._startTime
    const localFrames = Math.max(0, this._framesConsumed - this._frameOffset)
    return this._startTime + (localFrames / this._sampleRate) * this._playbackRate
  }

  get isReady() {
    return this._ready
  }
  get isEnded() {
    return this._ended
  }
  get deviceInfo() {
    return this._deviceInfo
  }

  onEnded(fn) {
    this._onEnded = fn
  }
  onError(fn) {
    this._onError = fn
  }

  /**
   * Reset position tracking for gapless track transition.
   * Called when a new track starts on the same open bridge stream.
   */
  resetForGapless(startTime = 0, playbackRate = 1.0) {
    this._frameOffset = this._framesConsumed
    this._startTime = startTime
    this._playbackRate = playbackRate
    this._ended = false
  }

  /**
   * Stop the child process and clean up.
   */
  stop() {
    if (this._readyTimer) {
      clearTimeout(this._readyTimer)
      this._readyTimer = null
    }
    this._stopRequested = true
    if (this._writable) {
      try {
        this._writable.destroy()
      } catch {
        /* ignore */
      }
      this._writable = null
    }
    if (this._proc) {
      try {
        this._proc.stdin.destroy()
      } catch {
        /* ignore */
      }
      try {
        this._proc.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      this._proc = null
    }
    this._ready = false
  }
}

export default NativeAudioBridge
