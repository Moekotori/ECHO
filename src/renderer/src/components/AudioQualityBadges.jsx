/**
 * AudioQualityBadges  v2
 * 可复用音质信息徽章组件。
 *
 * Props:
 *   quality   {AudioQuality}  音质对象（所有字段可选）
 *   compact   {boolean}       紧凑模式（列表行，隐藏 bitrate）
 *   variant   {string}        "list"（默认）| "player"（底部播放器）
 *   className {string}        自定义 class
 *
 * AudioQuality 字段：
 *   codec, bitrateKbps, sampleRateHz, bitDepth,
 *   channels, channelLayout, bpm, isLossless, isHiRes, isMqa
 */
import React from 'react'

// ─── 格式化工具 ──────────────────────────────────────────

export function formatSampleRate(hz) {
  if (!hz || !Number.isFinite(hz) || hz <= 0) return null
  const khz = hz / 1000
  return khz % 1 === 0 ? `${khz}kHz` : `${khz.toFixed(1)}kHz`
}

export function formatBitDepth(bits) {
  if (!bits || !Number.isFinite(bits) || bits <= 0) return null
  return `${bits}bit`
}

export function formatBitrate(kbps) {
  if (!kbps || !Number.isFinite(kbps) || kbps <= 0) return null
  return `${Math.round(kbps)}kbps`
}

export function formatChannels(ch, layout) {
  if (layout && typeof layout === 'string' && layout.trim()) {
    const l = layout.trim()
    if (l.toLowerCase() === 'stereo') return '立体声'
    if (l.toLowerCase() === 'mono')   return '单声道'
    return l
  }
  if (!ch || !Number.isFinite(ch)) return null
  if (ch === 1) return '单声道'
  if (ch === 2) return '立体声'
  return `${ch}声道`
}

export function formatBpm(bpm) {
  const value = Number(bpm)
  if (!Number.isFinite(value) || value <= 0) return null
  return `BPM ${Math.round(value)}`
}

// ─── DSD 特殊格式化 ──────────────────────────────────────

const DSD_CODECS = new Set(['DSD', 'DSF', 'DFF'])

/** 根据 sampleRateHz 判断 DSD 倍率标签，如 "DSD64" */
export function getDsdMultiplier(hz) {
  if (!hz || !Number.isFinite(hz)) return null
  // DSD 基准采样率 44100 * 64 = 2822400
  const BASE = 44100
  const mult = Math.round(hz / BASE)
  if (mult >= 512) return 'DSD512'
  if (mult >= 256) return 'DSD256'
  if (mult >= 128) return 'DSD128'
  if (mult >= 64)  return 'DSD64'
  return null
}

/** 将 DSD 采样率格式化为 MHz（e.g. 2.8MHz / 5.6MHz） */
export function formatDsdRate(hz) {
  if (!hz || !Number.isFinite(hz)) return null
  const mhz = hz / 1_000_000
  return mhz % 1 === 0 ? `${mhz}MHz` : `${mhz.toFixed(1)}MHz`
}

/** 判断给定 codec 是否为 DSD 系列 */
export function isDsdCodec(codec) {
  return Boolean(codec) && DSD_CODECS.has((codec || '').toUpperCase().trim())
}

// ─── 无损 / Hi-Res 判断 ─────────────────────────────────

const LOSSLESS_CODECS = new Set([
  'FLAC', 'ALAC', 'WAV', 'AIFF', 'PCM',
  'DSD', 'DSF', 'DFF', 'APE', 'TTA', 'WV', 'WAVPACK'
])
const LOSSY_CODECS = new Set([
  'MP3', 'AAC', 'OGG', 'OPUS', 'VORBIS', 'WMA', 'AC3', 'MP2', 'M4A'
])

export function formatCodecLabel(codec) {
  if (!codec || typeof codec !== 'string') return null
  const raw = codec.trim()
  if (!raw) return null
  const upper = raw.toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (
    upper === 'MPEG' ||
    upper === 'MPEG AUDIO' ||
    upper === 'MPEG 1 LAYER 3' ||
    upper === 'MPEG-1 LAYER 3' ||
    upper === 'MPEG LAYER 3' ||
    upper === 'MPEG LAYER III' ||
    upper === 'MPEG 1 AUDIO LAYER 3'
  ) {
    return 'MP3'
  }
  if (upper === 'MPEG 4 AAC' || upper === 'MPEG-4 AAC') return 'AAC'
  return upper
}

export function getIsLossless(quality) {
  if (!quality) return false
  if (typeof quality.isLossless === 'boolean') return quality.isLossless
  const codec = (quality.codec || '').toUpperCase().trim()
  if (LOSSLESS_CODECS.has(codec)) return true
  if (LOSSY_CODECS.has(codec))   return false
  return false
}

export function getIsHiRes(quality) {
  if (!quality) return false
  if (typeof quality.isHiRes === 'boolean') return quality.isHiRes
  const depth = Number(quality.bitDepth)
  const rate  = Number(quality.sampleRateHz)
  return (
    Number.isFinite(depth) && depth >= 24 &&
    Number.isFinite(rate)  && rate  >= 96000
  )
}

export function normalizeAudioQuality(quality) {
  if (!quality || typeof quality !== 'object') return null
  const n = { ...quality }
  if (n.codec && typeof n.codec === 'string') {
    n.codec = formatCodecLabel(n.codec)
  }
  if (typeof n.isLossless !== 'boolean') n.isLossless = getIsLossless(n)
  if (typeof n.isHiRes    !== 'boolean') n.isHiRes    = getIsHiRes(n)
  if (typeof n.isMqa      !== 'boolean') n.isMqa      = getIsMqa(n)
  return n
}

// ─── 组件 ────────────────────────────────────────────────

export default function AudioQualityBadges({
  quality,
  compact   = false,
  variant   = 'list',
  className = ''
}) {
  const q = normalizeAudioQuality(quality)
  if (!q) return null

  const codec      = q.codec || null
  const isLossless = q.isLossless
  const isHiRes    = q.isHiRes
  const isMqa      = q.isMqa
  const isDsd      = isDsdCodec(codec)

  // compact 模式不显示 bitrate；player 模式全显示
  const showBitrate  = variant === 'player' || !compact
  const showChannels = variant === 'player'

  const cls = ['aq-badges',
    variant === 'player' ? 'aq-badges--player' : '',
    compact ? 'aq-badges--compact' : '',
    className
  ].filter(Boolean).join(' ')

  // ── DSD 分支：完全独立的显示逻辑 ──────────────────────
  if (isDsd) {
    const dsdMult   = getDsdMultiplier(q.sampleRateHz)      // "DSD64" / null
    const dsdRate   = formatDsdRate(q.sampleRateHz)          // "2.8MHz" / null
    const bitDepth  = q.bitDepth === 1 ? '1bit' : (q.bitDepth ? `${q.bitDepth}bit` : null)
    const bitrateStr = formatBitrate(q.bitrateKbps)

    // 至少要有 codec 才渲染
    if (!codec) return null

    return (
      <div className={cls}>
        {/* codec: DSF / DFF */}
        <span className="aq-badge aq-badge--lossless-codec" title={`编码格式：${codec}`}>
          {codec}
        </span>
        {/* Lossless 标记 */}
        <span className="aq-badge aq-badge--lossless" title="DSD 无损音频">
          Lossless
        </span>
        {isMqa && (
          <span className="aq-badge aq-badge--mqa" title="MQA">
            MQA
          </span>
        )}
        {/* DSD 倍率 badge（最优先，如 DSD64） */}
        {dsdMult && (
          <span className="aq-badge aq-badge--hires" title={`DSD 规格：${dsdMult}`}>
            {dsdMult}
          </span>
        )}
        {/* 采样率（MHz 格式） */}
        {dsdRate && (
          <span className="aq-badge aq-badge--tech" title={`DSD 采样率：${dsdRate}`}>
            {dsdRate}
          </span>
        )}
        {/* 位深（通常 1bit） */}
        {bitDepth && (
          <span className="aq-badge aq-badge--tech" title={`位深：${bitDepth}`}>
            {bitDepth}
          </span>
        )}
        {/* 比特率（弱色，player 模式才显示） */}
        {bitrateStr && showBitrate && (
          <span className="aq-badge aq-badge--bitrate" title={`比特率：${bitrateStr}`}>
            {bitrateStr}
          </span>
        )}
      </div>
    )
  }

  // ── PCM / 常规格式 ────────────────────────────────────

  // bitDepth + sampleRate 合并成一个 badge："16bit / 48kHz"
  const bitDepthStr   = formatBitDepth(q.bitDepth)
  const sampleRateStr = formatSampleRate(q.sampleRateHz)
  const techLabel =
    bitDepthStr && sampleRateStr
      ? `${bitDepthStr} / ${sampleRateStr}`
      : bitDepthStr || sampleRateStr || null

  const bitrateStr = formatBitrate(q.bitrateKbps)
  const channels   = showChannels ? formatChannels(q.channels, q.channelLayout) : null
  const bpmStr      = formatBpm(q.bpm)

  if (!codec && !techLabel && !bitrateStr && !channels && !bpmStr && !isLossless && !isHiRes && !isMqa) {
    return null
  }

  return (
    <div className={cls}>
      {/* codec badge — 无损格式用主题色 */}
      {codec && (
        <span
          className={`aq-badge ${isLossless ? 'aq-badge--lossless-codec' : 'aq-badge--codec'}`}
          title={`编码格式：${codec}`}
        >
          {codec}
        </span>
      )}

      {/* Hi-Res — 最强强调 */}
      {isHiRes && (
        <span className="aq-badge aq-badge--hires" title="Hi-Res 高清音频">
          Hi-Res
        </span>
      )}

      {isMqa && (
        <span className="aq-badge aq-badge--mqa" title="MQA">
          MQA
        </span>
      )}

      {/* Lossless — 非 Hi-Res 时才单独显示 */}
      {isLossless && !isHiRes && (
        <span className="aq-badge aq-badge--lossless" title="无损音频">
          Lossless
        </span>
      )}

      {/* 技术参数：bitDepth / sampleRate 合并 */}
      {techLabel && (
        <span className="aq-badge aq-badge--tech" title={techLabel}>
          {techLabel}
        </span>
      )}

      {/* 比特率（弱色） */}
      {bitrateStr && showBitrate && (
        <span className="aq-badge aq-badge--bitrate" title={`比特率：${bitrateStr}`}>
          {bitrateStr}
        </span>
      )}

      {/* 声道（player 模式） */}
      {channels && (
        <span className="aq-badge aq-badge--channels" title={`声道：${channels}`}>
          {channels}
        </span>
      )}

      {bpmStr && (
        <span className="aq-badge aq-badge--bpm" title={`节拍：${bpmStr}`}>
          {bpmStr}
        </span>
      )}
    </div>
  )
}

export function getIsMqa(quality) {
  if (!quality) return false
  if (typeof quality.isMqa === 'boolean') return quality.isMqa
  const text = [quality.codec, quality.codecProfile, quality.container, quality.format]
    .filter(Boolean)
    .join(' ')
  return /\bmqa\b/i.test(text)
}
