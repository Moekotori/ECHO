export const hexToRgbStr = (hex) => {
  let validHex = hex.replace("#", "");
  if (validHex.length === 3)
    validHex = validHex
      .split("")
      .map((c) => c + c)
      .join("");
  const r = parseInt(validHex.substring(0, 2) || "ff", 16);
  const g = parseInt(validHex.substring(2, 4) || "ff", 16);
  const b = parseInt(validHex.substring(4, 6) || "ff", 16);
  return `${r}, ${g}, ${b}`;
};

export const hexToRgb = (hex) => {
  let h = hex.replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const r = parseInt(h.substring(0, 2) || "ff", 16) / 255;
  const g = parseInt(h.substring(2, 4) || "ff", 16) / 255;
  const b = parseInt(h.substring(4, 6) || "ff", 16) / 255;
  return { r, g, b };
};

/** Canvas / inline 样式用，alpha 为 0–1 */
export const hexToRgbaString = (hex, alpha) => {
  const { r, g, b } = hexToRgb(hex || "#000000");
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
};

/** sRGB 相对亮度 0–1 */
export const relativeLuminance = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};

export const hslToHex = (h, s, l) => {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

export const generateRandomPalette = () => {
  const H = Math.floor(Math.random() * 360);
  const S = 55 + Math.floor(Math.random() * 35); // 55–90%
  const isDark = Math.random() > 0.5;

  const accent1 = hslToHex(H, S, isDark ? 62 : 58);
  const accent2 = hslToHex((H + 40) % 360, S, isDark ? 58 : 62);
  const accent3 = hslToHex((H + 80) % 360, S, isDark ? 65 : 60);

  let bgColor;
  let glassColor;
  if (isDark) {
    bgColor = hslToHex(H, 28, 10);
    glassColor = hslToHex(H, 22, 14);
  } else {
    bgColor = hslToHex(H, 18, 97);
    glassColor = "#ffffff";
  }

  /** 保证主文字与背景对比度 ≥ 4.5:1（近似 WCAG AA） */
  const pickTextForBg = (bg, hue) => {
    const Lbg = relativeLuminance(bg);
    const wantLightText = Lbg < 0.45;
    let textM = wantLightText
      ? hslToHex(hue % 360, 12, 94)
      : hslToHex(hue % 360, 38, 16);
    let Ltm = relativeLuminance(textM);
    let ratio = (Math.max(Lbg, Ltm) + 0.05) / (Math.min(Lbg, Ltm) + 0.05);
    let guard = 0;
    while (ratio < 4.2 && guard < 12) {
      textM = wantLightText
        ? hslToHex(hue % 360, 10, Math.min(98, 88 + guard * 2))
        : hslToHex(hue % 360, 40, Math.max(8, 14 - guard));
      Ltm = relativeLuminance(textM);
      ratio = (Math.max(Lbg, Ltm) + 0.05) / (Math.min(Lbg, Ltm) + 0.05);
      guard++;
    }
    const textS = wantLightText
      ? hslToHex((hue + 20) % 360, 18, 68)
      : hslToHex((hue + 15) % 360, 28, 42);
    return { textMain: textM, textSoft: textS };
  };

  const { textMain, textSoft } = pickTextForBg(bgColor, H);

  const bgGradientEnd = isDark
    ? hslToHex((H + 50) % 360, 35, 16)
    : hslToHex((H + 45) % 360, 25, 92);

  return {
    bgColor,
    glassColor,
    textMain,
    textSoft,
    accent1,
    accent2,
    accent3,
    bgGradientEnd,
    bgGradientAngle: 120 + Math.floor(Math.random() * 60),
    bgMode: "linear",
  };
};

export const PRESET_THEMES = {
  sakura: {
    name: "Sakura Blossom",
    colors: {
      bgColor: "#f7f3f5",
      accent1: "#f7aab5",
      accent2: "#a3d2e3",
      accent3: "#bbf0d8",
      textMain: "#5c4349",
      textSoft: "#9a888c",
      glassColor: "#ffffff",
      bgGradientEnd: "#e3f2fa",
      bgGradientAngle: 135,
      bgMode: "linear",
    },
  },
  midnight: {
    name: "Midnight Echo",
    colors: {
      bgColor: "#0f172a",
      accent1: "#818cf8",
      accent2: "#c084fc",
      accent3: "#38bdf8",
      textMain: "#f8fafc",
      textSoft: "#94a3b8",
      glassColor: "#1e293b",
      bgGradientEnd: "#1e1b4b",
      bgGradientAngle: 128,
      bgMode: "linear",
    },
  },
  matcha: {
    name: "Matcha Latte",
    colors: {
      bgColor: "#f4fbf4",
      accent1: "#86efac",
      accent2: "#fde047",
      accent3: "#93c5fd",
      textMain: "#14532d",
      textSoft: "#4ade80",
      glassColor: "#ffffff",
      bgGradientEnd: "#ecfccb",
      bgGradientAngle: 145,
      bgMode: "linear",
    },
  },
  sunset: {
    name: "Sunset Glow",
    colors: {
      bgColor: "#fff1f2",
      accent1: "#fb7185",
      accent2: "#fbbf24",
      accent3: "#a78bfa",
      textMain: "#881337",
      textSoft: "#fda4af",
      glassColor: "#ffffff",
      bgGradientEnd: "#ffe4e6",
      bgGradientAngle: 135,
      bgMode: "linear",
    },
  },
  nordic: {
    name: "Nordic Night",
    colors: {
      bgColor: "#1e293b", // Slate 800
      accent1: "#38bdf8", // Sky 400
      accent2: "#818cf8", // Indigo 400
      accent3: "#f472b6", // Pink 400
      textMain: "#f8fafc", // Slate 50
      textSoft: "#94a3b8", // Slate 400
      glassColor: "#0f172a", // Slate 900
      bgGradientEnd: "#0f172a",
      bgGradientAngle: 160,
      bgMode: "linear",
    },
  },
  obsidian: {
    name: "Obsidian Neon",
    colors: {
      bgColor: "#000000",
      accent1: "#22d3ee", // Cyan 400
      accent2: "#818cf8",
      accent3: "#fb7185",
      textMain: "#ffffff",
      textSoft: "#71717a", // Zinc 400
      glassColor: "#09090b", // Zinc 950
      bgGradientEnd: "#18181b",
      bgGradientAngle: 135,
      bgMode: "linear",
    },
  },
  rose: {
    name: "Rose Quartz",
    colors: {
      bgColor: "#fffcfc",
      accent1: "#f43f5e", // Rose 500
      accent2: "#fbbf24", // Amber 400
      accent3: "#2dd4bf", // Teal 400
      textMain: "#4c0519", // Rose 950
      textSoft: "#fb7185", // Rose 400
      glassColor: "#ffffff",
      bgGradientEnd: "#fff1f2",
      bgGradientAngle: 135,
      bgMode: "linear",
    },
  },
  cyber: {
    name: "Cyber City",
    colors: {
      bgColor: "#0c0a09", // Stone 950
      accent1: "#d946ef", // Fuchsia 500
      accent2: "#3b82f6", // Blue 500
      accent3: "#14b8a6", // Teal 500
      textMain: "#fafaf9", // Stone 50
      textSoft: "#a8a29e", // Stone 400
      glassColor: "#1c1917", // Stone 900
      bgGradientEnd: "#172554",
      bgGradientAngle: 140,
      bgMode: "linear",
    },
  },
  minimal: {
    name: "Minimal Clarity",
    colors: {
      bgColor: "#f8fafc", // Slate 50
      accent1: "#d1d5db", // Gray 300
      accent2: "#e5e7eb", // Gray 200
      accent3: "#f3f4f6", // Gray 100
      textMain: "#111827", // Gray 900
      textSoft: "#4b5563", // Gray 600
      glassColor: "#ffffff",
      bgGradientEnd: "#f1f5f9",
      bgGradientAngle: 135,
      bgMode: "solid",
    },
  },
};
