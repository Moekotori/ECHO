import { getDevices, AudioIO, SampleFormatFloat32 } from 'naudiodon'
import ffmpeg from 'fluent-ffmpeg'
import { Transform } from 'stream'
import { NativeAudioBridge, isNativeBridgeAvailable, listNativeDevices } from './NativeAudioBridge.js'
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
const NETEASE_HEADERS =
  'Referer: https://music.163.com/\r\nOrigin: https://music.163.com\r\n'

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
    this._outputSink = null    // naudiodon AudioIO OR bridge writable
    this._bridge = null        // NativeAudioBridge instance (null = legacy mode)
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
    this._useNativeBridge = isNativeBridgeAvailable()
    this.vstBridge = new VstBridge()

    if (this._useNativeBridge) {
      console.log('[AudioEngine] Native bridge available — HiFi mode enabled')
    } else {
      console.log('[AudioEngine] Native bridge not found — using naudiodon fallback')
    }
  }

  onTrackEnded(fn) { this._onTrackEnded = fn }

  getMediaInfo(uri) { return this._getFileInfo(uri) }

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
        targetSampleRate = this.exclusiveMode && this._useNativeBridge
          ? dsdPcmRate
          : 44100
        logLine(`[AudioEngine] DSD detected: native=${fileSampleRate}Hz -> PCM ${dsdPcmRate}Hz`)
      } else if (this.exclusiveMode && this._useNativeBridge) {
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
        `bridge=${this._useNativeBridge} | exclusive=${this.exclusiveMode}${info.isDSD ? ' | DSD' : ''}`
      logLine(playLogText)

      /* ── output backend ── */
      if (this._useNativeBridge) {
        const bridge = new NativeAudioBridge()
        try {
          await bridge.start({
            sampleRate: targetSampleRate,
            channels,
            deviceIndex: this.activeDeviceIndex,
            exclusive: this.exclusiveMode,
            volume: this.volume,
            startTime,
            playbackRate
          })
        } catch (e) {
          console.warn('[AudioEngine] Native bridge start failed, falling back:', e?.message)
          bridge.stop()
          return this._playLegacy(filePath, startTime, playbackRate, channels, fileSampleRate, targetSampleRate)
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
      } else {
        return this._playLegacy(filePath, startTime, playbackRate, channels, fileSampleRate, targetSampleRate)
      }

      /* ── FFmpeg decode ── */
      this._setupFFmpeg(filePath, startTime, playbackRate, channels, fileSampleRate, targetSampleRate)

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

  setVolume(vol) { this.volume = vol }
  getVolume() { return this.volume }

  async setPlaybackRate(rate) {
    if (this.currentFilePath && Math.abs(this.playbackRate - rate) > 0.01) {
      return this.play(this.currentFilePath, this.playbackTime, rate)
    }
  }

  async pause() {
    if (this.isPlaying) {
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
    this.isPlaying = false
    await this._releaseResources()
    this.currentFilePath = null
    this.playbackTime = 0
  }

  async _releaseResources() {
    if (this.processor) {
      try {
        if (this._outputSink) this.processor.unpipe(this._outputSink)
        this.processor.destroy()
      } catch { /* ignore */ }
      this.processor = null
    }

    if (this.ffmpegProcess) {
      try { this.ffmpegProcess.kill('SIGKILL') } catch { /* ignore */ }
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
        try { this.processor.unpipe(ao) } catch { /* ignore */ }
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
      exclusive: this.exclusiveMode,
      exclusiveConfirmed: !!(deviceInfo && deviceInfo.exclusive === true),
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
      return { sampleRate: 44100, channels: 2, bitsPerSample: 16, codec: 'stream', lossless: false, isDSD: false }
    }
    try {
      const { parseFile } = await import('music-metadata')
      const meta = await parseFile(filePath, { duration: false })
      const codecName = (meta.format.codec || meta.format.container || '').toLowerCase()
      const isDSD = /dsd/.test(codecName) || /\.(dsf|dff)$/i.test(filePath)
      return {
        sampleRate: meta.format.sampleRate || 44100,
        channels: meta.format.numberOfChannels || 2,
        bitsPerSample: meta.format.bitsPerSample || (isDSD ? 1 : 16),
        codec: meta.format.container || 'unknown',
        lossless: !!meta.format.lossless || isDSD,
        isDSD
      }
    } catch (e) {
      console.warn('[AudioEngine] _getFileInfo failed, using defaults:', e?.message)
      return { sampleRate: 44100, channels: 2, bitsPerSample: 16, codec: 'unknown', lossless: false, isDSD: false }
    }
  }
}

export const audioEngine = new AudioEngine()
