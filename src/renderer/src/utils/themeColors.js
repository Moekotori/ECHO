import { PRESET_THEMES } from "./color";

const DEFAULT_ANGLE = 135;

export const FONT_STACKS = {
  outfit: '"Outfit", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  inter: '"Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  system: 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
};

/**
 * 合并旧版缺少的渐变字段，保证预设与自定义都有完整结构。
 */
export function normalizeThemeColors(raw) {
  const base =
    raw && typeof raw === "object" ? raw : PRESET_THEMES.sakura.colors;
  const bgGradientEnd = base.bgGradientEnd ?? base.accent2 ?? base.bgColor;
  const bgGradientAngle =
    typeof base.bgGradientAngle === "number" &&
    !Number.isNaN(base.bgGradientAngle)
      ? base.bgGradientAngle
      : DEFAULT_ANGLE;
  let bgMode = base.bgMode;
  if (bgMode !== "solid" && bgMode !== "linear") {
    bgMode =
      bgGradientEnd &&
      base.bgColor &&
      bgGradientEnd.toLowerCase() !== base.bgColor.toLowerCase()
        ? "linear"
        : "solid";
  }
  return {
    ...base,
    bgGradientEnd,
    bgGradientAngle,
    bgMode,
  };
}

/**
 * 与 index.css body 上原先的三层径向 + 底层背景一致；glow 为 false 时仅保留底色/渐变。
 */
export function getAppThemeBackgroundStyle(colors, glowEnabled = true) {
  const c = normalizeThemeColors(colors);
  const layers = [];
  if (glowEnabled) {
    layers.push(
      `radial-gradient(circle at 10% 20%, ${c.accent1} 0%, transparent 40%)`,
    );
    layers.push(
      `radial-gradient(circle at 90% 80%, ${c.accent2} 0%, transparent 40%)`,
    );
    layers.push(
      `radial-gradient(circle at 50% 50%, ${c.accent3} 0%, transparent 50%)`,
    );
  }
  if (c.bgMode === "linear") {
    layers.push(
      `linear-gradient(${c.bgGradientAngle}deg, ${c.bgColor}, ${c.bgGradientEnd})`,
    );
  } else {
    layers.push(`linear-gradient(${c.bgColor}, ${c.bgColor})`);
  }
  const g = glowEnabled;
  return {
    position: "fixed",
    inset: 0,
    zIndex: -3,
    pointerEvents: "none",
    backgroundImage: layers.join(", "),
    backgroundSize: g ? "150vw 150vh, 150vw 150vh, 150vw 150vh, auto" : "auto",
    backgroundAttachment: g ? "fixed, fixed, fixed, fixed" : undefined,
    backgroundRepeat: "no-repeat",
  };
}
