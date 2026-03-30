import { PRESET_THEMES } from "../utils/color";

export const DEFAULT_CONFIG = {
  /**
   * 递增并在 App 加载时 run migration（`oldRev < configRevision`）。
   * 老存档无此字段时视为 0。
   */
  configRevision: 1,
  /** UI language: en | zh | ja */
  uiLocale: "en",
  showVisualizer: true,
  showMiniWaveform: true,
  useEQ: true,
  eqBands: [
    { id: 1, type: "lowshelf", freq: 32, gain: 0, q: 1.0, enabled: true },
    { id: 2, type: "peaking", freq: 64, gain: 0, q: 1.4, enabled: true },
    { id: 3, type: "peaking", freq: 125, gain: 0, q: 1.4, enabled: true },
    { id: 4, type: "peaking", freq: 250, gain: 0, q: 1.4, enabled: true },
    { id: 5, type: "peaking", freq: 500, gain: 0, q: 1.4, enabled: true },
    { id: 6, type: "peaking", freq: 1000, gain: 0, q: 1.4, enabled: true },
    { id: 7, type: "peaking", freq: 2000, gain: 0, q: 1.4, enabled: true },
    { id: 8, type: "peaking", freq: 4000, gain: 0, q: 1.4, enabled: true },
    { id: 9, type: "peaking", freq: 8000, gain: 0, q: 1.4, enabled: true },
    { id: 10, type: "highshelf", freq: 16000, gain: 0, q: 1.0, enabled: true },
  ],
  visualizerStyle: "bars",
  showDiscordRPC: true,
  enableMV: false,
  customBgPath: null,
  customBgOpacity: 1.0,
  uiBgOpacity: 0.6,
  uiBlur: 20,
  uiFontFamily: "system",
  /** 用户选择的本地字体文件路径（.ttf / .otf / .woff / .woff2）；与 uiFontFamily === "custom" 一起使用 */
  uiCustomFontPath: null,
  uiBaseFontSize: 15,
  uiRadiusScale: 1,
  uiShadowIntensity: 1,
  uiSaturation: 1,
  uiAccentBackgroundGlow: false,
  theme: "sakura",
  customColors: { ...PRESET_THEMES.sakura.colors },
  mvAsBackground: false,
  /** 沉浸式 MV 作背景时隐藏左上角歌曲信息与底部播放条（仍可用 Esc 或左上角箭头退出歌词页） */
  mvHideImmersiveChrome: false,
  mvBackgroundOpacity: 0.8,
  mvMuted: true,
  autoFallbackToBilibili: true,
  /** MV 相对本地音频的同步偏移（毫秒）：正值让画面略超前对齐 */
  mvOffsetMs: 0,
  lyricsShadow: true,
  lyricsShadowOpacity: 0.6,
  lyricsShowRomaji: true,
  lyricsShowTranslation: true,
  lyricsFontSize: 32,
  lyricsSource: "lrclib",
  lyricsOffsetMs: 0,
  /** 歌词页隐藏滚动歌词（仍保留标题区与侧栏 MV / 沉浸式背景） */
  lyricsHidden: false,
  preamp: 0,
  activePreset: "Custom",
  enableDiscordRPC: true,
  /** 歌单导入（如网易云）保存音频的目录；为 null 时使用 downloadFolder */
  playlistImportFolder: null,
  /** 启动应用后自动打开开发者工具（Console） */
  devOpenDevToolsOnStartup: false,
};
