import { PRESET_THEMES } from '../utils/color'

/** 参量 EQ 16 段：双搁架 + 14 峰化，对数分布覆盖 20Hz–20kHz */
export const DEFAULT_EQ_BANDS = [
  { id: 1, type: 'lowshelf', freq: 32, gain: 0, q: 1.0, enabled: true },
  { id: 2, type: 'peaking', freq: 45, gain: 0, q: 1.2, enabled: true },
  { id: 3, type: 'peaking', freq: 90, gain: 0, q: 1.2, enabled: true },
  { id: 4, type: 'peaking', freq: 125, gain: 0, q: 1.3, enabled: true },
  { id: 5, type: 'peaking', freq: 180, gain: 0, q: 1.3, enabled: true },
  { id: 6, type: 'peaking', freq: 250, gain: 0, q: 1.3, enabled: true },
  { id: 7, type: 'peaking', freq: 350, gain: 0, q: 1.3, enabled: true },
  { id: 8, type: 'peaking', freq: 500, gain: 0, q: 1.3, enabled: true },
  { id: 9, type: 'peaking', freq: 700, gain: 0, q: 1.3, enabled: true },
  { id: 10, type: 'peaking', freq: 1000, gain: 0, q: 1.3, enabled: true },
  { id: 11, type: 'peaking', freq: 1800, gain: 0, q: 1.3, enabled: true },
  { id: 12, type: 'peaking', freq: 2800, gain: 0, q: 1.3, enabled: true },
  { id: 13, type: 'peaking', freq: 4500, gain: 0, q: 1.3, enabled: true },
  { id: 14, type: 'peaking', freq: 7000, gain: 0, q: 1.3, enabled: true },
  { id: 15, type: 'peaking', freq: 11000, gain: 0, q: 1.2, enabled: true },
  { id: 16, type: 'highshelf', freq: 16000, gain: 0, q: 1.0, enabled: true }
]

/**
 * 将旧版 10 段 EQ 迁入 16 段布局：保留前 10 段的 gain/q/enabled，频点与类型采用新版默认值。
 */
export function migrateEqBandsTo16(oldBands) {
  if (!Array.isArray(oldBands) || oldBands.length !== 10) {
    return DEFAULT_EQ_BANDS.map((b) => ({ ...b }))
  }
  return DEFAULT_EQ_BANDS.map((template, i) => {
    if (i < oldBands.length) {
      const o = oldBands[i]
      return {
        ...template,
        gain: typeof o.gain === 'number' ? o.gain : template.gain,
        q: typeof o.q === 'number' ? o.q : template.q,
        enabled: o.enabled !== false
      }
    }
    return { ...template }
  })
}

export const DEFAULT_CONFIG = {
  /**
   * 递增并在 App 加载时 run migration（`oldRev < configRevision`）。
   * 老存档无此字段时视为 0。
   */
  configRevision: 4,
  /** UI language: en | zh | ja */
  uiLocale: 'en',
  showVisualizer: false,
  showMiniWaveform: false,
  useEQ: true,
  eqBands: DEFAULT_EQ_BANDS.map((b) => ({ ...b })),
  /**
   * 主进程 naudiodon 输出缓冲：low 低延迟 / balanced 默认 / stable 减卡顿
   */
  audioOutputBufferProfile: 'balanced',
  audioDeviceId: '',
  audioExclusive: false,
  visualizerStyle: 'bars',
  showDiscordRPC: true,
  enableMV: false,
  customBgPath: null,
  customBgOpacity: 1.0,
  uiBgOpacity: 0.6,
  uiBlur: 20,
  uiFontFamily: 'system',
  /** 用户选择的本地字体文件路径（.ttf / .otf / .woff / .woff2）；与 uiFontFamily === "custom" 一起使用 */
  uiCustomFontPath: null,
  uiBaseFontSize: 15,
  uiRadiusScale: 1,
  uiShadowIntensity: 1,
  uiSaturation: 1,
  uiAccentBackgroundGlow: false,
  theme: 'minimal',
  customColors: { ...PRESET_THEMES.minimal.colors },
  mvAsBackground: false,
  /** 沉浸式 MV 作背景时隐藏左上角歌曲信息与底部播放条（仍可用 Esc 或左上角箭头退出歌词页） */
  mvHideImmersiveChrome: false,
  mvBackgroundOpacity: 0.8,
  /** 沉浸式 MV 背景模糊强度（px），0 为不模糊 */
  mvBackgroundBlur: 0,
  mvMuted: true,
  autoFallbackToBilibili: true,
  /** 默认 MV 搜索源 */
  mvSource: 'bilibili',
  /** MV 相对本地音频的同步偏移（毫秒）：正值让画面略超前对齐 */
  mvOffsetMs: 0,
  lyricsShadow: true,
  lyricsShadowOpacity: 0.6,
  lyricsShowRomaji: true,
  lyricsShowTranslation: true,
  /** 歌词主行逐字高亮（类 Apple Music 卡拉 OK） */
  lyricsWordHighlight: false,
  /** 逐字高亮前置补偿（毫秒，正值更早） */
  lyricsWordLeadMs: 100,
  /** 单行逐字填充完成比例（相对到下一句起点），建议 0.8~0.95 */
  lyricsWordFillRatio: 0.88,
  lyricsFontSize: 32,
  /** Lyrics text color override (hex). Applies in lyrics view. */
  lyricsFontColor: null,
  /**
   * Professional lyrics color panel (by layer + state + alpha).
   * When null, lyrics colors fall back to theme/runtime defaults.
   */
  lyricsColor: null,
  lyricsSource: 'lrclib',
  lyricsSourceLink: '',
  lyricsOffsetMs: 0,
  /** 歌词页隐藏滚动歌词（仍保留标题区与侧栏 MV / 沉浸式背景） */
  lyricsHidden: false,
  /** Floating always-on-top lyrics window (see Lyrics settings) */
  desktopLyricsEnabled: false,
  /** Base font size (px) for desktop lyrics window */
  desktopLyricsFontPx: 26,
  /** Desktop overlay: lock position and let mouse clicks pass through */
  desktopLyricsLocked: false,
  /** Desktop overlay: show previous / next line */
  desktopLyricsShowPrev: true,
  desktopLyricsShowNext: true,
  /** Desktop overlay: show romaji line(s) when available */
  desktopLyricsShowRomaji: false,
  /** Desktop overlay: show translation line(s) when available */
  desktopLyricsShowTranslation: false,
  /** Hex colors for desktop floating lyrics (see Lyrics settings) */
  desktopLyricsColorText: '#fff8f5',
  desktopLyricsColorSecondary: '#ffc8b8',
  desktopLyricsColorGlow: '#ff8866',
  desktopLyricsColorRomaji: '#e8d0c8',
  preamp: 0,
  activePreset: 'Custom',
  enableDiscordRPC: true,
  /** 歌单导入（如网易云）保存音频的目录；为 null 时使用 downloadFolder */
  playlistImportFolder: null,
  /** 自动保存媒体库（播放列表/自定义歌单/收藏） */
  autoSaveLibrary: true,
  /** 开发者模式（开启后显示高级开发者功能） */
  devModeEnabled: false,
  /** 启动应用后自动打开开发者工具（Console） */
  devOpenDevToolsOnStartup: false
}
