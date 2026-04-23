import { getDevices, AudioIO, SampleFormatFloat32 } from 'naudiodon'
import ffmpeg from 'fluent-ffmpeg'
import { Transform } from 'stream'
import {
  NativeAudioBridge,
  isNativeBridgeAvailable,
  listNativeDevices
} from './NativeAudioBridge.js'
import { createEqFloatProcessor } from './eqFloatProcessor.js'
import { getResolvedFfmpegStaticPath } from '../utils/resolveFfmpegStaticPath.js'
import { logLine } from '../utils/logLine.js'
import { VstBridge } from './VstBridge.js'

const resolvedFfmpeg = getResolvedFfmpegStaticPath()
ffmpeg.setFfmpegPath(resolvedFfmpeg)

function normalizeStreamUri(uri) {
  if (!uri || typeof uri !== 'string') return uri
  let s = uri.trim()
  if (!/^https?:\/\//i.test(s)) return s
  return s.replace(/&amp;/gi, '&')
}

const NETEASE_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 NeteaseMusic/9.0.0'
const NETEASE_HEADERS = 'Referer: https://music.163.com/\r\nOrigin: https://music.163.com\r\n'

function isNeteaseStreamUrl(uri) {
  return /music\.163\.com|126\.net|netease|interface\.music\.163/i.test(uri)
}

function escapeUnicodeForLog(value) {
  return String(value || '')
}

function formatPathForLog(filePath) {
  const fullPath = String(filePath || '')
  const fileName = fullPath.split(/[/\\]/).filter(Boolean).pop() || fullPath
  return `file=${escapeUnicodeForLog(fileName)} | path=${escapeUnicodeForLog(fullPath)}`
}

/**
 * AudioProcessor — volume + safe buffer copy + byte-count progress (legacy path only).
 *
 * In native-bridge mode the byte-count progress is ignored; position comes from
 * the output-side frame counter reported by the child process.
 */
class AudioProcessor extends Transform {
  constructor(options) {
    super(options)
    this.engine = options.engine
    this.targetSampleRate = options.targetSampleRate
    this.channels = options.channels
    this.playbackRate = options.playbackRate
    this.startTime = options.startTime
    this.bytesWritten = 0
  }

  _transform(chunk, encoding, callback) {
    if (!this.engine.isPlaying) return callback()

    const ab = new ArrayBuffer(chunk.byteLength)
    const srcFloat32 = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 4)
    const dstFloat32 = new Float32Array(ab)
    dstFloat32.set(srcFloat32)

    if (this.engine._bridge && this.engine._eqProcessor) {
      try {
        this.engine._eqProcessor.processInterleaved(dstFloat32)
      } catch (e) {
        /* ignore single-frame EQ errors */
      }
    }

    const vol = this.engine.volume
    for (let i = 0; i < dstFloat32.length; i++) {
      dstFloat32[i] *= vol
    }

    if (this.engine._outputSink && this.engine.isPlaying) {
      this.push(Buffer.from(ab))
    }

    this.bytesWritten += chunk.byteLength

    // Legacy path: update playbackTime from decoded bytes (input side).
    // When native bridge is active this is overridden by output-side position.
    if (!this.engine._bridge) {
      const secondsProcessed =
        (this.bytesWritten / (this.targetSampleRate * this.channels * 4)) * this.playbackRate
      this.engine.playbackTime = Math.max(0, this.startTime + secondsProcessed)
    }

    callback()
  }
}

export class AudioEngine {
  constructor() {
    this._outputSink = null // naudiodon AudioIO OR bridge writable
    this._bridge = null // NativeAudioBridge instance (null = legacy mode)
    this.activeDevice = null
    this.activeDeviceIndex = -1
    this.isPlaying = false
    this.ffmpegProcess = null
    this.playbackTime = 0
    this.volume = 1.0
    this.playbackRate = 1.0
    this.currentFilePath = null
    this.processor = null
    this.exclusiveMode = false
    this._asioMode = false
    this.eqConfig = null
    /** HiFi path: PCM EQ + preamp (mirrors renderer Web Audio chain). */
    this._eqProcessor = null
    this.bufferProfile = 'balanced'
    /** Track the sample rates and format info for status reporting */
    this._fileSampleRate = 0
    this._outputSampleRate = 0
    this._fileCodec = ''
    this._fileBitsPerSample = 0
    this._fileIsDSD = false
    this._fileDsdRate = 0
    this._onTrackEnded = null
    this._fadeInterval = null
    this._userVolume = 1.0   // 用户设定的目标音量，fade 不覆盖这个值
    this._useNativeBridge = isNativeBridgeAvailable()
    this.vstBridge = new VstBridge()
    /** Gapless playback */
    this._gaplessEnabled = false
    this._nextTrackPb = null     // prebuffer state for next track
    this._activeChannels = 2     // channels used by current bridge stream
    this._onGaplessTrackChanged = null

    if (this._useNativeBridge) {
      console.log('[AudioEngine] Native bridge available — HiFi mode enabled')
    } else {
      console.log('[AudioEngine] Native bridge not found — using naudiodon fallback')
    }
  }

  onTrackEnded(fn) {
    this._onTrackEnded = fn
  }

  onGaplessTrackChanged(fn) {
    this._onGaplessTrackChanged = fn
  }

  setGapless(enabled) {
    this._gaplessEnabled = !!enabled
    logLine(`[AudioEngine] Gapless: ${this._gaplessEnabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Begin pre-decoding the next track into memory so it's ready for a
   * zero-gap transition when the current track ends.
   * Safe to call while playing; cancels any previous prebuffer.
   */
  prebufferNextTrack(filePath) {
    this._cancelPrebuffer()
    if (!filePath || !this._gaplessEnabled || !this._useNativeBridge) return

    const pb = {
      path: filePath,
      chunks: [],
      totalBytes: 0,
      bufferedSeconds: 0,
      done: false,
      info: null,
      targetSampleRate: this._outputSampleRate || 44100,
      channels: this._activeChannels || 2,
      ffmpegCmd: null
    }
    this._nextTrackPb = pb

    const MAX_PREBUFFER_BYTES = 12 * 1024 * 1024 // ~6s of 44.1kHz stereo float32

    this._getFileInfo(filePath)
      .then((info) => {
        if (this._nextTrackPb !== pb) return
        pb.info = info
        const fileSampleRate = info.sampleRate || 44100
        const channels = Math.max(1, Math.min(2, info.channels || 2))
        pb.channels = channels
        const bytesPerSec = pb.targetSampleRate * channels * 4

        const filters = []
        if (fileSampleRate !== pb.targetSampleRate) {
          filters.push(`aresample=${pb.targetSampleRate}`)
        }

        const cmd = ffmpeg(filePath)
          .seekInput(0)
          .format('f32le')
          .audioChannels(channels)
          .audioFrequency(pb.targetSampleRate)
        if (filters.length > 0) cmd.audioFilters(filters)
        pb.ffmpegCmd = cmd

        const stream = cmd.pipe()
        stream.on('data', (chunk) => {
          if (this._nextTrackPb !== pb) { stream.destroy(); return }
          pb.chunks.push(Buffer.from(chunk))
          pb.totalBytes += chunk.byteLength
          pb.bufferedSeconds = pb.totalBytes / bytesPerSec
          if (pb.totalBytes >= MAX_PREBUFFER_BYTES) stream.destroy()
        })
        stream.on('end', () => {
          if (this._nextTrackPb === pb) {
            pb.done = true
            logLine(`[AudioEngine] Gapless prebuffer done (full): ${filePath}`)
          }
        })
        stream.on('close', () => {
          if (this._nextTrackPb === pb && !pb.done) {
            logLine(`[AudioEngine] Gapless prebuffer ready (${pb.bufferedSeconds.toFixed(1)}s): ${filePath}`)
          }
        })
        stream.on('error', (e) => {
          if (!e.message?.includes('SIGKILL')) {
            console.warn('[AudioEngine] Gapless prebuffer error:', e.message)
          }
          if (this._nextTrackPb === pb) this._nextTrackPb = null
        })
      })
      .catch((e) => {
        console.warn('[AudioEngine] Gapless prebuffer getFileInfo failed:', e.message)
        if (this._nextTrackPb === pb) this._nextTrackPb = null
      })
  }

  _cancelPrebuffer() {
    const pb = this._nextTrackPb
    this._nextTrackPb = null
    if (pb?.ffmpegCmd) {
      try { pb.ffmpegCmd.kill('SIGKILL') } catch { /* ignore */ }
    }
  }

  /**
   * Called when current track's processor finishes in gapless mode.
   * If prebuffer is ready and format matches, transitions without stopping bridge.
   */
  _handleGaplessTransition(endedFilePath) {
    if (this.currentFilePath !== endedFilePath || !this.isPlaying) return

    const pb = this._nextTrackPb
    const sink = this._outputSink
    const bridge = this._bridge

    // Fallback to normal end if conditions aren't met
    if (
      !pb ||
      !pb.info ||
      pb.chunks.length === 0 ||
      !sink ||
      !bridge ||
      pb.targetSampleRate !== this._outputSampleRate ||
      pb.channels !== this._activeChannels
    ) {
      this.isPlaying = false
      if (this._onTrackEnded) this._onTrackEnded()
      return
    }

    this._nextTrackPb = null

    // Kill old processor + ffmpeg (they're done, but clean up refs)
    if (this.processor) {
      try { this.processor.destroy() } catch { /* ignore */ }
      this.processor = null
    }
    if (this.ffmpegProcess) {
      try { this.ffmpegProcess.kill('SIGKILL') } catch { /* ignore */ }
      this.ffmpegProcess = null
    }

    // Update track metadata
    const nextPath = pb.path
    this.currentFilePath = nextPath
    this.playbackTime = 0
    this._fileSampleRate = pb.info.sampleRate || 44100
    this._fileBitsPerSample = pb.info.bitsPerSample || 16
    this._fileCodec = pb.info.codec || 'unknown'
    this._fileIsDSD = !!pb.info.isDSD
    this._fileDsdRate = pb.info.isDSD ? pb.info.sampleRate : 0

    // Reset bridge position counter for correct time display
    bridge.resetForGapless(0, this.playbackRate)

    // Create fresh processor for next track
    const newProcessor = new AudioProcessor({
      engine: this,
      targetSampleRate: pb.targetSampleRate,
      channels: pb.channels,
      playbackRate: this.playbackRate,
      startTime: 0
    })
    this.processor = newProcessor

    // Keep bridge open: pipe with { end: false } and hook next transition
    newProcessor.pipe(sink, { end: false })
    newProcessor.once('finish', () => this._handleGaplessTransition(nextPath))

    // Flush prebuffered chunks first (covers FFmpeg startup time)
    for (const chunk of pb.chunks) {
      if (!newProcessor.destroyed) newProcessor.write(chunk)
    }

    // Start fresh FFmpeg for remainder of track
    if (!pb.done) {
      const seekTo = Math.max(0, pb.bufferedSeconds - 0.1) // slight overlap to avoid click
      this._setupFFmpeg(
        nextPath,
        seekTo,
        this.playbackRate,
        pb.channels,
        pb.info.sampleRate || 44100,
        pb.targetSampleRate
      )
      this.ffmpegProcess.pipe(newProcessor)
      logLine(`[AudioEngine] Gapless transition OK: streaming ${nextPath} from ${seekTo.toFixed(2)}s`)
    } else {
      logLine(`[AudioEngine] Gapless transition OK: fully buffered ${nextPath}`)
    }

    // Notify renderer to advance track display without restarting audio
    if (this._onGaplessTrackChanged) this._onGaplessTrackChanged(nextPath)
  }

  getMediaInfo(uri) {
    return this._getFileInfo(uri)
  }

  getDevices() {
    if (this._useNativeBridge) {
      try {
        const nativeDevices = listNativeDevices()
        if (nativeDevices.length > 0) {
          return nativeDevices.map((d) => ({
            id: d.index,
            name: d.name,
            hostApi: 'WASAPI',
            sampleRate: 0,
            maxChannels: 0
          }))
        }
      } catch (e) {
        console.warn('[AudioEngine] native device list failed, fallback:', e?.message)
      }
    }
    try {
      const devices = getDevices()
      return devices
        .filter((d) => d.maxOutputChannels > 0)
        .map((d) => ({
          id: d.id,
          name: d.name,
          hostApi: d.hostApi,
          sampleRate: d.defaultSampleRate || 44100,
          maxChannels: d.maxOutputChannels
        }))
    } catch {
      return []
    }
  }

  async setDevice(deviceId) {
    if (deviceId == null || deviceId === '') {
      const wasPlaying = this.isPlaying
      const pos = this.playbackTime
      const file = this.currentFilePath
      const rate = this.playbackRate

      this.activeDevice = null
      this.activeDeviceIndex = -1
      console.log('[AudioEngine] Active device reset to system default')

      if (this._useNativeBridge && wasPlaying && file) {
        await this._releaseResources()
        this.play(file, pos, rate)
      }

      return { success: true, device: null }
    }

    if (this._useNativeBridge) {
      const idx = typeof deviceId === 'number' ? deviceId : parseInt(deviceId, 10)
      if (isNaN(idx) || idx < 0) return { success: false, error: 'Invalid device index' }
      const wasPlaying = this.isPlaying
      const pos = this.playbackTime
      const file = this.currentFilePath
      const rate = this.playbackRate

      this.activeDeviceIndex = idx
      this.activeDevice = { id: idx, name: `Device #${idx}`, sampleRate: 0 }
      console.log(`[AudioEngine] Native device set: index ${idx}`)

      if (wasPlaying && file) {
        await this._releaseResources()
        this.play(file, pos, rate)
      }
      return { success: true, device: this.activeDevice }
    }

    const devices = getDevices()
    const device = devices.find((d) => d.id === deviceId)
    if (device) {
      this.activeDevice = device
      this.activeDeviceIndex = -1
      console.log(`[AudioEngine] Active device set: ${device.name}`)
      return { success: true, device: this.activeDevice }
    }
    return { success: false, error: 'Device not found' }
  }

  setExclusive(exclusive) {
    this.exclusiveMode = !!exclusive
    console.log(`[AudioEngine] Exclusive mode: ${this.exclusiveMode}`)
  }

  setAsio(enabled) {
    this._asioMode = !!enabled
    console.log(`[AudioEngine] ASIO mode: ${this._asioMode}`)
  }

  getAsioMode() {
    return this._asioMode
  }

  setOutputBufferProfile(profile) {
    this.bufferProfile = profile || 'balanced'
  }

  setEqConfig(eqConfig) {
    this.eqConfig = eqConfig
    if (this._eqProcessor) {
      try {
        this._eqProcessor.update(eqConfig)
      } catch (e) {
        console.warn('[AudioEngine] EQ update failed:', e?.message)
      }
    }
  }

  loadVstPlugin(pluginPath) {
    if (this.vstBridge) {
      this.vstBridge.loadPlugin(pluginPath)
      // Restart playback if currently playing
      if (this.isPlaying && this.currentFilePath) {
        this.play(this.currentFilePath, this.playbackTime, this.playbackRate)
      }
    }
  }

  disableVstPlugin() {
    if (this.vstBridge) {
      this.vstBridge.disable()
      if (this.isPlaying && this.currentFilePath) {
        this.play(this.currentFilePath, this.playbackTime, this.playbackRate)
      }
    }
  }

  showVstPluginUI() {
    if (this.vstBridge) {
      this.vstBridge.showPluginUI()
    }
  }

  async play(filePath, startTime = 0, playbackRate = 1.0) {
    while (this._playLocked) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    this._playLocked = true

    try {
      this._cancelPrebuffer()
      await this._releaseResources()

      if (/^https?:\/\//i.test(filePath)) filePath = normalizeStreamUri(filePath)
      this.currentFilePath = filePath
      this.playbackRate = playbackRate
      this.playbackTime = startTime

      const info = await this._getFileInfo(filePath)
      const fileSampleRate = info.sampleRate || 44100
      const channels = Math.max(1, Math.min(2, info.channels || 2))

      this._fileCodec = info.codec || 'unknown'
      this._fileBitsPerSample = info.bitsPerSample || 16
      this._fileIsDSD = !!info.isDSD
      this._fileDsdRate = info.isDSD ? fileSampleRate : 0

      let targetSampleRate
      if (info.isDSD) {
        // DSD -> PCM: convert at a high-res rate preserving maximum fidelity
        // DSD64 (2.8 MHz) -> 176.4 kHz, DSD128 (5.6 MHz) -> 352.8 kHz
        const dsdPcmRate = Math.min(352800, Math.max(176400, Math.round(fileSampleRate / 16)))
        targetSampleRate =
          (this.exclusiveMode || this._asioMode) && this._useNativeBridge ? dsdPcmRate : 44100
        logLine(`[AudioEngine] DSD detected: native=${fileSampleRate}Hz -> PCM ${dsdPcmRate}Hz`)
      } else if ((this.exclusiveMode || this._asioMode) && this._useNativeBridge) {
        targetSampleRate = fileSampleRate
      } else if (this.activeDevice && this.activeDevice.sampleRate > 0) {
        targetSampleRate = this.activeDevice.sampleRate
      } else {
        targetSampleRate = 44100
      }

      this._fileSampleRate = fileSampleRate
      this._outputSampleRate = targetSampleRate
      const playLogText =
        `[AudioEngine] Play: ${formatPathForLog(filePath)} | ${info.codec} ${info.bitsPerSample}bit | ` +
        `src=${fileSampleRate}Hz -> out=${targetSampleRate}Hz | rate=${playbackRate} | ` +
        `bridge=${this._useNativeBridge} | exclusive=${this.exclusiveMode} | asio=${this._asioMode}${info.isDSD ? ' | DSD' : ''}`
      logLine(playLogText)

      /* ── output backend ── */
      if (this._useNativeBridge) {
        const bridge = new NativeAudioBridge()
        try {
          await bridge.start({
            sampleRate: targetSampleRate,
            channels,
            deviceIndex: this.activeDeviceIndex,
            asio: this._asioMode,
            exclusive: this._asioMode ? false : this.exclusiveMode,
            volume: this.volume,
            startTime,
            playbackRate
          })
        } catch (e) {
          console.warn('[AudioEngine] Native bridge start failed:', e?.message)
          bridge.stop()
          if (this._asioMode) {
            return { success: false, error: e?.message || 'asio_start_failed' }
          }
          return this._playLegacy(
            filePath,
            startTime,
            playbackRate,
            channels,
            fileSampleRate,
            targetSampleRate
          )
        }

        bridge.onEnded(() => {
          if (this._bridge === bridge && this.isPlaying && this.currentFilePath === filePath) {
            this.isPlaying = false
            if (this._onTrackEnded) this._onTrackEnded()
          }
        })

        bridge.onError((err) => {
          console.error('[AudioEngine] Bridge error:', err?.message)
          if (err?.message === 'exclusive_denied') {
            console.warn('[AudioEngine] Exclusive denied, retrying shared mode...')
            this.exclusiveMode = false
            this.play(filePath, this.playbackTime, playbackRate)
          }
        })

        this._bridge = bridge
        this._outputSink = bridge.writable
        this._eqProcessor = createEqFloatProcessor(this.eqConfig, targetSampleRate, channels)
        this._activeChannels = channels
      } else {
        return this._playLegacy(
          filePath,
          startTime,
          playbackRate,
          channels,
          fileSampleRate,
          targetSampleRate
        )
      }

      /* ── FFmpeg decode ── */
      this._setupFFmpeg(
        filePath,
        startTime,
        playbackRate,
        channels,
        fileSampleRate,
        targetSampleRate
      )

      this.processor = new AudioProcessor({
        engine: this,
        targetSampleRate,
        channels,
        playbackRate,
        startTime
      })

      this.ffmpegProcess.pipe(this.processor)

      // 【绝对安全隔离】：Native 核心管道同样加锁，仅开启时使用 vstBridge
      if (this.vstBridge && this.vstBridge.enabled) {
        this.vstBridge.pipe(this.processor, this._outputSink, targetSampleRate, channels)
      } else if (this._gaplessEnabled) {
        // Gapless: keep bridge writable open when processor ends
        this.processor.pipe(this._outputSink, { end: false })
        this.processor.once('finish', () => this._handleGaplessTransition(filePath))
      } else {
        this.processor.pipe(this._outputSink)
      }

      this.isPlaying = true
      return { success: true }
    } finally {
      this._playLocked = false
    }
  }

  /**
   * Legacy playback path using naudiodon (PortAudio).
   */
  _playLegacy(filePath, startTime, playbackRate, channels, fileSampleRate, targetSampleRate) {
    try {
      const ao = new AudioIO({
        outOptions: {
          channelCount: channels,
          sampleFormat: SampleFormatFloat32,
          sampleRate: targetSampleRate,
          deviceId: this.activeDevice ? this.activeDevice.id : -1,
          closeOnError: false
        }
      })
      this._outputSink = ao
      this._bridge = null
    } catch (e) {
      console.error('[AudioEngine] PortAudio Error:', e.message)
      return { success: false, error: e.message }
    }

    this._eqProcessor = null

    this._setupFFmpeg(filePath, startTime, playbackRate, channels, fileSampleRate, targetSampleRate)

    this.processor = new AudioProcessor({
      engine: this,
      targetSampleRate,
      channels,
      playbackRate,
      startTime
    })

    this.ffmpegProcess.pipe(this.processor)

    // 【绝对安全隔离】：如果用户没开 VST，这里走的回退分支与以前的代码 100% 一致！不影响任何正常用户
    if (this.vstBridge && this.vstBridge.enabled) {
      this.vstBridge.pipe(this.processor, this._outputSink, targetSampleRate, channels)
    } else {
      this.processor.pipe(this._outputSink)
    }

    this._outputSink.start()
    this.isPlaying = true
    return { success: true }
  }

  /**
   * Set up the FFmpeg decode process (shared by both paths).
   */
  _setupFFmpeg(filePath, startTime, playbackRate, channels, fileSampleRate, targetSampleRate) {
    const filters = []
    if (playbackRate !== 1.0) {
      const ncRate = Math.round(targetSampleRate * playbackRate)
      filters.push(`aresample=${targetSampleRate}`)
      filters.push(`asetrate=${ncRate}`)
      filters.push(`aresample=${targetSampleRate}`)
    } else if (fileSampleRate !== targetSampleRate) {
      filters.push(`aresample=${targetSampleRate}`)
    }

    this.ffmpegProcess = ffmpeg(filePath)
      .seekInput(startTime)
      .format('f32le')
      .audioChannels(channels)
      .audioFrequency(targetSampleRate)

    if (/^https?:\/\//i.test(filePath)) {
      const opts = isNeteaseStreamUrl(filePath)
        ? ['-user_agent', NETEASE_UA, '-headers', NETEASE_HEADERS]
        : ['-user_agent', 'EchoesStudio/1.0']
      this.ffmpegProcess.inputOptions(opts)
    }

    if (filters.length > 0) this.ffmpegProcess.audioFilters(filters)

    this.ffmpegProcess.on('error', (err) => {
      if (!err.message.includes('SIGKILL')) console.error('[FFmpeg] Error:', err.message)
    })
  }

  setVolume(vol) {
    this._userVolume = vol
    this.volume = vol
  }
  getVolume() {
    return this._userVolume
  }

  startFadeOut(durationMs, onComplete) {
    this._clearFadeInterval()
    const totalMs = Math.max(0, Number(durationMs) || 0)
    const startVolume = Math.max(0, Number(this.volume) || 0)
    if (totalMs <= 0) {
      this.volume = 0
      if (typeof onComplete === 'function') onComplete()
      return
    }

    const startAt = Date.now()
    this._fadeInterval = setInterval(() => {
      const elapsed = Date.now() - startAt
      const progress = Math.min(1, elapsed / totalMs)
      this.volume = Math.max(0, startVolume * (1 - progress))
      if (progress >= 1) {
        this._clearFadeInterval()
        this.volume = 0
        if (typeof onComplete === 'function') onComplete()
      }
    }, 50)
  }

  startFadeIn(durationMs) {
    this._clearFadeInterval()
    const totalMs = Math.max(0, Number(durationMs) || 0)
    const targetVol = this._userVolume ?? 1.0
    if (totalMs <= 0) {
      this.volume = targetVol
      return
    }

    this.volume = 0
    const startAt = Date.now()
    this._fadeInterval = setInterval(() => {
      const elapsed = Date.now() - startAt
      const progress = Math.min(1, elapsed / totalMs)
      this.volume = Math.min(targetVol, targetVol * progress)
      if (progress >= 1) {
        this._clearFadeInterval()
        this.volume = targetVol
      }
    }, 50)
  }

  cancelFade() {
    this._clearFadeInterval()
    this.volume = this._userVolume ?? 1.0
  }

  async setPlaybackRate(rate) {
    if (this.currentFilePath && Math.abs(this.playbackRate - rate) > 0.01) {
      return this.play(this.currentFilePath, this.playbackTime, rate)
    }
  }

  async pause() {
    if (this.isPlaying) {
      this.cancelFade()
      if (this._bridge) {
        this.playbackTime = this._bridge.getPosition()
      }
      console.log(`[AudioEngine] Pausing at ${this.playbackTime}`)
      this.isPlaying = false
      await this._releaseResources()
    }
  }

  resume() {
    if (!this.isPlaying && this.currentFilePath) {
      console.log(`[AudioEngine] Resuming from ${this.playbackTime}`)
      this.play(this.currentFilePath, this.playbackTime, this.playbackRate)
    }
  }

  async stop() {
    this._cancelPrebuffer()
    this.cancelFade()
    this.isPlaying = false
    await this._releaseResources()
    this.currentFilePath = null
    this.playbackTime = 0
  }

  _clearFadeInterval() {
    if (!this._fadeInterval) return
    clearInterval(this._fadeInterval)
    this._fadeInterval = null
  }

  async _releaseResources() {
    if (this.processor) {
      try {
        if (this._outputSink) this.processor.unpipe(this._outputSink)
        this.processor.destroy()
      } catch {
        /* ignore */
      }
      this.processor = null
    }

    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      this.ffmpegProcess = null
    }

    /* ── native bridge cleanup ── */
    if (this._bridge) {
      this._bridge.stop()
      this._bridge = null
      this._outputSink = null
      this._eqProcessor = null
      return
    }

    /* ── legacy naudiodon cleanup ── */
    if (this._outputSink) {
      const ao = this._outputSink
      this._outputSink = null

      if (this.processor) {
        try {
          this.processor.unpipe(ao)
        } catch {
          /* ignore */
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 50))

      try {
        console.log('[AudioEngine] Quitting AudioIO...')
        await ao.quit()
        console.log('[AudioEngine] AudioIO quit successfully.')
      } catch (e) {
        console.warn(`[AudioEngine] AudioIO quit failed/ignored: ${e.message}`)
      }
    }
  }

  getStatus() {
    let currentTime = this.playbackTime
    if (this._bridge && this._bridge.isReady) {
      currentTime = this._bridge.getPosition()
      this.playbackTime = currentTime
    }
    const deviceInfo = this._bridge?.deviceInfo
    const outSR = deviceInfo?.sampleRate || this._outputSampleRate || 0
    const srcSR = this._fileSampleRate
    return {
      isPlaying: this.isPlaying,
      currentTime,
      filePath: this.currentFilePath,
      playbackRate: this.playbackRate,
      exclusive: this._asioMode ? false : this.exclusiveMode,
      exclusiveConfirmed: !!(!this._asioMode && deviceInfo && deviceInfo.exclusive === true),
      asio: this._asioMode,
      nativeBridge: this._useNativeBridge,
      fileSampleRate: srcSR,
      outputSampleRate: outSR,
      codec: this._fileCodec,
      bitsPerSample: this._fileBitsPerSample,
      isDSD: this._fileIsDSD,
      dsdRate: this._fileDsdRate,
      bitPerfect: srcSR > 0 && outSR > 0 && srcSR === outSR && !this._fileIsDSD,
      useEQ: !!(this.eqConfig && this.eqConfig.useEQ)
    }
  }

  async _getFileInfo(filePath) {
    if (/^https?:\/\//i.test(filePath)) {
      return {
        sampleRate: 44100,
        channels: 2,
        bitsPerSample: 16,
        codec: 'stream',
        lossless: false,
        isDSD: false
      }
    }
    // Cache to avoid re-parsing the same file on every play() call.
    // DSD files (dsf/dff) are especially slow to parse — caching eliminates
    // the stutter on second+ play of the same track.
    if (!this._fileInfoCache) this._fileInfoCache = new Map()
    const cached = this._fileInfoCache.get(filePath)
    if (cached) return cached

    try {
      const { parseFile } = await import('music-metadata')
      const meta = await parseFile(filePath, { duration: false })
      const codecName = (meta.format.codec || meta.format.container || '').toLowerCase()
      const isDSD = /dsd/.test(codecName) || /\.(dsf|dff)$/i.test(filePath)
      const result = {
        sampleRate: meta.format.sampleRate || 44100,
        channels: meta.format.numberOfChannels || 2,
        bitsPerSample: meta.format.bitsPerSample || (isDSD ? 1 : 16),
        codec: meta.format.container || 'unknown',
        lossless: !!meta.format.lossless || isDSD,
        isDSD
      }
      this._fileInfoCache.set(filePath, result)
      return result
    } catch (e) {
      console.warn('[AudioEngine] _getFileInfo failed, using defaults:', e?.message)
      return {
        sampleRate: 44100,
        channels: 2,
        bitsPerSample: 16,
        codec: 'unknown',
        lossless: false,
        isDSD: false
      }
    }
  }
}

export const audioEngine = new AudioEngine()