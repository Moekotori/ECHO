import { PRESET_THEMES } from './color.js'

const DEFAULT_ANGLE = 135

/** Default radial accent positions (%), fade radii (%), and size scale — per-theme overrides in `color.js`. */
export const DEFAULT_BACKDROP_GLOW_POSITIONS = [
  [15, 25],
  [85, 75],
  [50, 50]
]
export const DEFAULT_BACKDROP_GLOW_FADE = [32, 32, 40]

function normalizeBackdropGlow(base) {
  const backdropGlowLayers =
    typeof base.backdropGlowLayers === 'number' && !Number.isNaN(base.backdropGlowLayers)
      ? Math.min(3, Math.max(0, Math.floor(base.backdropGlowLayers)))
      : 2

  const backdropGlowIntensity =
    typeof base.backdropGlowIntensity === 'number' && !Number.isNaN(base.backdropGlowIntensity)
      ? Math.min(1, Math.max(0, base.backdropGlowIntensity))
      : 0.7

  const positions = DEFAULT_BACKDROP_GLOW_POSITIONS.map((p) => [...p])
  if (Array.isArray(base.backdropGlowPositions)) {
    for (let i = 0; i < Math.min(3, base.backdropGlowPositions.length); i++) {
      const p = base.backdropGlowPositions[i]
      if (Array.isArray(p) && p.length >= 2) {
        const x = Number(p[0])
        const y = Number(p[1])
        if (!Number.isNaN(x) && !Number.isNaN(y)) positions[i] = [x, y]
      }
    }
  }

  let backdropGlowFade = DEFAULT_BACKDROP_GLOW_FADE
  if (typeof base.backdropGlowFade === 'number' && !Number.isNaN(base.backdropGlowFade)) {
    const f = Math.min(72, Math.max(18, base.backdropGlowFade))
    backdropGlowFade = [f, f, f]
  } else if (Array.isArray(base.backdropGlowFade)) {
    backdropGlowFade = [0, 1, 2].map((i) => {
      const v = base.backdropGlowFade[i]
      if (typeof v === 'number' && !Number.isNaN(v)) return Math.min(72, Math.max(18, v))
      return DEFAULT_BACKDROP_GLOW_FADE[i]
    })
  }

  const backdropGlowSize =
    typeof base.backdropGlowSize === 'number' && !Number.isNaN(base.backdropGlowSize)
      ? Math.min(240, Math.max(80, base.backdropGlowSize))
      : 150

  return {
    backdropGlowLayers,
    backdropGlowIntensity,
    backdropGlowPositions: positions,
    backdropGlowFade,
    backdropGlowSize
  }
}

export const FONT_STACKS = {
  outfit: '"Outfit", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  /** System sans stack — avoids a second webfont; use tabular-nums in CSS where needed */
  inter: 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  system: 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
}

/** Registered via @font-face when loaded from user-supplied font file */
export const UI_CUSTOM_FONT_FAMILY = 'EchoesUserUiFont'

const FONT_FILE_FALLBACK = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'

function fontFileFormatSuffix(absPath) {
  const x = (absPath || '').toLowerCase()
  if (x.endsWith('.woff2')) return ' format("woff2")'
  if (x.endsWith('.woff')) return ' format("woff")'
  if (x.endsWith('.otf')) return ' format("opentype")'
  if (x.endsWith('.ttf')) return ' format("truetype")'
  return ''
}

/** file:// URL for local font (Chromium/Electron) */
export function uiFontFileToUrl(absPath) {
  if (!absPath) return ''
  const normalized = absPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const raw = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
  try {
    return encodeURI(raw)
  } catch {
    return raw
  }
}

/**
 * @param {object} config  renderer app config (uiFontFamily, uiCustomFontPath)
 * @returns {string} CSS font-family value for --font-family-main
 */
export function getUiFontStack(config) {
  const key = config?.uiFontFamily || 'outfit'
  if (
    key === 'custom' &&
    typeof config?.uiCustomFontPath === 'string' &&
    config.uiCustomFontPath.trim()
  ) {
    return `"${UI_CUSTOM_FONT_FAMILY}", ${FONT_FILE_FALLBACK}`
  }
  if (key === 'custom') {
    return FONT_STACKS.outfit
  }
  return FONT_STACKS[key] || FONT_STACKS.outfit
}

/** CSS @font-face rule body or empty string */
export function buildUiCustomFontFaceCss(absPath) {
  if (!absPath || !String(absPath).trim()) return ''
  const url = uiFontFileToUrl(String(absPath).trim())
  const fmt = fontFileFormatSuffix(absPath)
  return `@font-face{font-family:"${UI_CUSTOM_FONT_FAMILY}";src:url("${url}")${fmt};font-weight:100 900;font-style:normal;font-display:swap;}`
}

/**
 * 合并旧版缺少的渐变字段，保证预设与自定义都有完整结构。
 */
export function normalizeThemeColors(raw) {
  const base = raw && typeof raw === 'object' ? raw : PRESET_THEMES.sakura.colors
  const bgGradientEnd = base.bgGradientEnd ?? base.accent2 ?? base.bgColor
  const bgGradientAngle =
    typeof base.bgGradientAngle === 'number' && !Number.isNaN(base.bgGradientAngle)
      ? base.bgGradientAngle
      : DEFAULT_ANGLE
  let bgMode = base.bgMode
  if (bgMode !== 'solid' && bgMode !== 'linear') {
    bgMode =
      bgGradientEnd && base.bgColor && bgGradientEnd.toLowerCase() !== base.bgColor.toLowerCase()
        ? 'linear'
        : 'solid'
  }
  return {
    ...base,
    bgGradientEnd,
    bgGradientAngle,
    bgMode,
    ...normalizeBackdropGlow(base)
  }
}

/**
 * 与 index.css body 上原先的三层径向 + 底层背景一致；glow 为 false 时仅保留底色/渐变。
 */
export function getAppThemeBackgroundStyle(colors, glowEnabled = true) {
  const c = normalizeThemeColors(colors)
  const layers = []
  const layerCount =
    glowEnabled && (c.backdropGlowLayers ?? 2) > 0 ? Math.min(c.backdropGlowLayers ?? 2, 3) : 0
  const intensity = c.backdropGlowIntensity ?? 0.7
  const positions = c.backdropGlowPositions || DEFAULT_BACKDROP_GLOW_POSITIONS
  const fades = c.backdropGlowFade || DEFAULT_BACKDROP_GLOW_FADE
  const size = c.backdropGlowSize ?? 150
  const accents = [c.accent1, c.accent2, c.accent3]

  for (let i = 0; i < layerCount; i++) {
    const [px, py] = positions[i] ?? DEFAULT_BACKDROP_GLOW_POSITIONS[i]
    const fade = fades[i] ?? fades[fades.length - 1] ?? 40
    const ac = accents[i]
    const centerColor =
      intensity >= 0.999
        ? ac
        : `color-mix(in srgb, ${ac} ${Math.round(intensity * 100)}%, transparent)`
    layers.push(`radial-gradient(circle at ${px}% ${py}%, ${centerColor} 0%, transparent ${fade}%)`)
  }

  if (c.bgMode === 'linear') {
    layers.push(`linear-gradient(${c.bgGradientAngle}deg, ${c.bgColor}, ${c.bgGradientEnd})`)
  } else {
    layers.push(`linear-gradient(${c.bgColor}, ${c.bgColor})`)
  }

  const glowSizes =
    layerCount > 0
      ? [...Array(layerCount)].map(() => `${size}vw ${size}vh`).join(', ') + ', auto'
      : 'auto'
  const glowAttach =
    layerCount > 0 ? [...Array(layerCount)].map(() => 'fixed').join(', ') + ', fixed' : undefined

  return {
    position: 'fixed',
    inset: 0,
    zIndex: -3,
    pointerEvents: 'none',
    backgroundImage: layers.join(', '),
    backgroundSize: glowSizes,
    backgroundAttachment: glowAttach,
    backgroundRepeat: 'no-repeat'
  }
}
