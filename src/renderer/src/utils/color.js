export const hexToRgbStr = (hex) => {
  let validHex = hex.replace('#', '')
  if (validHex.length === 3)
    validHex = validHex
      .split('')
      .map((c) => c + c)
      .join('')
  const r = parseInt(validHex.substring(0, 2) || 'ff', 16)
  const g = parseInt(validHex.substring(2, 4) || 'ff', 16)
  const b = parseInt(validHex.substring(4, 6) || 'ff', 16)
  return `${r}, ${g}, ${b}`
}

export const hexToRgb = (hex) => {
  let h = hex.replace('#', '')
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  const r = parseInt(h.substring(0, 2) || 'ff', 16) / 255
  const g = parseInt(h.substring(2, 4) || 'ff', 16) / 255
  const b = parseInt(h.substring(4, 6) || 'ff', 16) / 255
  return { r, g, b }
}

/** Canvas / inline 样式用，alpha 为 0–1 */
export const hexToRgbaString = (hex, alpha) => {
  const { r, g, b } = hexToRgb(hex || '#000000')
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}

/** sRGB 相对亮度 0–1 */
export const relativeLuminance = (hex) => {
  const { r, g, b } = hexToRgb(hex)
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

export const hslToHex = (h, s, l) => {
  l /= 100
  const a = (s * Math.min(l, 1 - l)) / 100
  const f = (n) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export const generateRandomPalette = () => {
  const H = Math.floor(Math.random() * 360)
  const S = 55 + Math.floor(Math.random() * 35) // 55–90%
  const isDark = Math.random() > 0.5

  const accent1 = hslToHex(H, S, isDark ? 62 : 58)
  const accent2 = hslToHex((H + 40) % 360, S, isDark ? 58 : 62)
  const accent3 = hslToHex((H + 80) % 360, S, isDark ? 65 : 60)

  let bgColor
  let glassColor
  if (isDark) {
    bgColor = hslToHex(H, 28, 10)
    glassColor = hslToHex(H, 22, 14)
  } else {
    bgColor = hslToHex(H, 18, 97)
    glassColor = '#ffffff'
  }

  /** 保证主文字与背景对比度 ≥ 4.5:1（近似 WCAG AA） */
  const pickTextForBg = (bg, hue) => {
    const Lbg = relativeLuminance(bg)
    const wantLightText = Lbg < 0.45
    let textM = wantLightText ? hslToHex(hue % 360, 12, 94) : hslToHex(hue % 360, 38, 16)
    let Ltm = relativeLuminance(textM)
    let ratio = (Math.max(Lbg, Ltm) + 0.05) / (Math.min(Lbg, Ltm) + 0.05)
    let guard = 0
    while (ratio < 4.2 && guard < 12) {
      textM = wantLightText
        ? hslToHex(hue % 360, 10, Math.min(98, 88 + guard * 2))
        : hslToHex(hue % 360, 40, Math.max(8, 14 - guard))
      Ltm = relativeLuminance(textM)
      ratio = (Math.max(Lbg, Ltm) + 0.05) / (Math.min(Lbg, Ltm) + 0.05)
      guard++
    }
    const textS = wantLightText
      ? hslToHex((hue + 20) % 360, 18, 68)
      : hslToHex((hue + 15) % 360, 28, 42)
    return { textMain: textM, textSoft: textS }
  }

  const { textMain, textSoft } = pickTextForBg(bgColor, H)

  const bgGradientEnd = isDark ? hslToHex((H + 50) % 360, 35, 16) : hslToHex((H + 45) % 360, 25, 92)

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
    bgMode: 'linear'
  }
}

export const PRESET_THEMES = {
  darkmode: {
    name: 'Graphite Bloom',
    colors: {
      bgColor: '#101722',
      accent1: '#8ea7ff',
      accent2: '#62d1d1',
      accent3: '#f0a6c8',
      textMain: '#f8fbff',
      textSoft: '#c3cfdd',
      glassColor: '#151f2d',
      bgGradientEnd: '#202a3e',
      bgGradientAngle: 136,
      bgMode: 'linear',
      backdropGlowLayers: 2,
      backdropGlowIntensity: 0.42,
      backdropGlowPositions: [
        [18, 20],
        [86, 74],
        [52, 52]
      ],
      backdropGlowFade: [42, 46, 54]
    }
  },
  sakura: {
    name: 'Sakura Atelier',
    colors: {
      bgColor: '#fff8f9',
      accent1: '#d97691',
      accent2: '#6fb7ca',
      accent3: '#93bd85',
      textMain: '#32262d',
      textSoft: '#6d5962',
      glassColor: '#ffffff',
      bgGradientEnd: '#eef8f7',
      bgGradientAngle: 138,
      bgMode: 'linear',
      backdropGlowIntensity: 0.36,
      backdropGlowPositions: [
        [18, 18],
        [82, 80],
        [54, 46]
      ],
      backdropGlowFade: [34, 38, 52]
    }
  },
  midnight: {
    name: 'Midnight Prism',
    colors: {
      bgColor: '#0d1221',
      accent1: '#a4b3ff',
      accent2: '#c08bff',
      accent3: '#5fd5e3',
      textMain: '#f9fbff',
      textSoft: '#c4ccda',
      glassColor: '#131c30',
      bgGradientEnd: '#251e4a',
      bgGradientAngle: 128,
      bgMode: 'linear',
      backdropGlowLayers: 3,
      backdropGlowIntensity: 0.4,
      backdropGlowPositions: [
        [16, 28],
        [80, 20],
        [64, 86]
      ],
      backdropGlowFade: [38, 36, 44]
    }
  },
  matcha: {
    name: 'Matcha Linen',
    colors: {
      bgColor: '#f8f8ed',
      accent1: '#6c9c70',
      accent2: '#c59b4d',
      accent3: '#6fa5b8',
      textMain: '#243326',
      textSoft: '#586657',
      glassColor: '#ffffff',
      bgGradientEnd: '#edf4df',
      bgGradientAngle: 142,
      bgMode: 'linear',
      backdropGlowIntensity: 0.34,
      backdropGlowPositions: [
        [20, 24],
        [84, 78],
        [55, 45]
      ],
      backdropGlowFade: [36, 40, 52]
    }
  },
  sunset: {
    name: 'Apricot Cinema',
    colors: {
      bgColor: '#fff8f2',
      accent1: '#d86f61',
      accent2: '#d8a24b',
      accent3: '#7e88d2',
      textMain: '#3f2824',
      textSoft: '#705954',
      glassColor: '#ffffff',
      bgGradientEnd: '#f4edf8',
      bgGradientAngle: 132,
      bgMode: 'linear',
      backdropGlowIntensity: 0.38,
      backdropGlowFade: [38, 42, 54]
    }
  },
  rose: {
    name: 'Rose Porcelain',
    colors: {
      bgColor: '#fff9f7',
      accent1: '#c96f87',
      accent2: '#b99555',
      accent3: '#68b3aa',
      textMain: '#3c2830',
      textSoft: '#725a62',
      glassColor: '#ffffff',
      bgGradientEnd: '#f7eef3',
      bgGradientAngle: 135,
      bgMode: 'linear',
      backdropGlowIntensity: 0.34,
      backdropGlowFade: [34, 38, 50]
    }
  },
  magicalGirl: {
    name: 'Magical Ribbon',
    colors: {
      bgColor: '#fff7fc',
      accent1: '#cc6aa6',
      accent2: '#d6a34c',
      accent3: '#8e82dd',
      textMain: '#3a2638',
      textSoft: '#6d5770',
      glassColor: '#ffffff',
      bgGradientEnd: '#f4efff',
      bgGradientAngle: 120,
      bgMode: 'linear',
      backdropGlowIntensity: 0.36,
      backdropGlowPositions: [
        [18, 24],
        [80, 22],
        [58, 84]
      ],
      backdropGlowFade: [34, 34, 48]
    }
  },
  miku: {
    name: 'Virtual Aqua',
    colors: {
      bgColor: '#f2fbfa',
      accent1: '#28aa9f',
      accent2: '#d56f96',
      accent3: '#4b98d4',
      textMain: '#143735',
      textSoft: '#4f706d',
      glassColor: '#ffffff',
      bgGradientEnd: '#e3f6f2',
      bgGradientAngle: 135,
      bgMode: 'linear',
      backdropGlowIntensity: 0.34,
      backdropGlowFade: [36, 38, 52]
    }
  },
  alice: {
    name: 'Alice Reverie',
    colors: {
      bgColor: '#f6fbff',
      accent1: '#5899cc',
      accent2: '#c99a4d',
      accent3: '#7f87d8',
      textMain: '#1b3245',
      textSoft: '#526c80',
      glassColor: '#ffffff',
      bgGradientEnd: '#eaf2fb',
      bgGradientAngle: 145,
      bgMode: 'linear',
      backdropGlowIntensity: 0.34,
      backdropGlowFade: [36, 40, 52]
    }
  },
  minimal: {
    name: 'Clear Studio',
    colors: {
      bgColor: '#f7f9fb',
      accent1: '#6f829e',
      accent2: '#8da8b9',
      accent3: '#b8a884',
      textMain: '#151c27',
      textSoft: '#4b5968',
      glassColor: '#ffffff',
      bgGradientEnd: '#edf3f7',
      bgGradientAngle: 135,
      bgMode: 'solid',
      backdropGlowLayers: 0
    }
  },
  idolStage: {
    name: 'Idol Stage',
    colors: {
      bgColor: '#fff8fc',
      accent1: '#e06aa8',
      accent2: '#6bb7f0',
      accent3: '#ffd06b',
      textMain: '#342536',
      textSoft: '#705a72',
      glassColor: '#ffffff',
      bgGradientEnd: '#eef7ff',
      bgGradientAngle: 124,
      bgMode: 'linear',
      backdropGlowLayers: 3,
      backdropGlowIntensity: 0.36,
      backdropGlowPositions: [
        [14, 22],
        [82, 18],
        [68, 84]
      ],
      backdropGlowFade: [34, 36, 46],
      backdropGlowSize: 142
    }
  },
  yumeKawaii: {
    name: 'Yume Kawaii',
    colors: {
      bgColor: '#fff7ff',
      accent1: '#c87be8',
      accent2: '#77c7f2',
      accent3: '#f2b7cf',
      textMain: '#32283f',
      textSoft: '#675c78',
      glassColor: '#ffffff',
      bgGradientEnd: '#f0f6ff',
      bgGradientAngle: 130,
      bgMode: 'linear',
      backdropGlowLayers: 3,
      backdropGlowIntensity: 0.34,
      backdropGlowPositions: [
        [16, 18],
        [84, 20],
        [54, 78]
      ],
      backdropGlowFade: [36, 36, 50]
    }
  },
  sodaPop: {
    name: 'Soda Pop',
    colors: {
      bgColor: '#f3fcff',
      accent1: '#40aee3',
      accent2: '#f184b7',
      accent3: '#78d3a7',
      textMain: '#153142',
      textSoft: '#527184',
      glassColor: '#ffffff',
      bgGradientEnd: '#eefdf5',
      bgGradientAngle: 146,
      bgMode: 'linear',
      backdropGlowLayers: 3,
      backdropGlowIntensity: 0.33,
      backdropGlowPositions: [
        [18, 24],
        [88, 22],
        [70, 80]
      ],
      backdropGlowFade: [34, 36, 48]
    }
  },
  academyBlue: {
    name: 'Academy Blue',
    colors: {
      bgColor: '#f4f8ff',
      accent1: '#5f8fe6',
      accent2: '#69c3d5',
      accent3: '#f0b169',
      textMain: '#1b2e48',
      textSoft: '#546b86',
      glassColor: '#ffffff',
      bgGradientEnd: '#eef4ff',
      bgGradientAngle: 138,
      bgMode: 'linear',
      backdropGlowLayers: 2,
      backdropGlowIntensity: 0.35,
      backdropGlowPositions: [
        [16, 24],
        [84, 78],
        [56, 52]
      ],
      backdropGlowFade: [38, 44, 54]
    }
  },
  shibuyaNight: {
    name: 'Shibuya Night',
    colors: {
      bgColor: '#100f1c',
      accent1: '#ff75bf',
      accent2: '#55b7ff',
      accent3: '#ffd066',
      textMain: '#fff9fd',
      textSoft: '#d7cbd8',
      glassColor: '#1b1828',
      bgGradientEnd: '#142544',
      bgGradientAngle: 142,
      bgMode: 'linear',
      backdropGlowLayers: 3,
      backdropGlowIntensity: 0.34,
      backdropGlowPositions: [
        [14, 22],
        [86, 28],
        [64, 86]
      ],
      backdropGlowFade: [34, 36, 42]
    }
  },
  lullabyPeach: {
    name: 'Lullaby Peach',
    colors: {
      bgColor: '#fff9f5',
      accent1: '#df7e76',
      accent2: '#8bb9df',
      accent3: '#e4bb6a',
      textMain: '#3a2927',
      textSoft: '#6f5d58',
      glassColor: '#ffffff',
      bgGradientEnd: '#f6f0ff',
      bgGradientAngle: 126,
      bgMode: 'linear',
      backdropGlowLayers: 3,
      backdropGlowIntensity: 0.32,
      backdropGlowPositions: [
        [20, 18],
        [82, 78],
        [58, 46]
      ],
      backdropGlowFade: [34, 38, 50]
    }
  }
}

export const extractAverageColorFromSrc = (src) => {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 64, 64);
      try {
        const data = ctx.getImageData(0, 0, 64, 64).data;
        let r = 0, g = 0, b = 0, c = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i+3] < 128) continue;
          r += data[i]; g += data[i+1]; b += data[i+2];
          c++;
        }
        if (c > 0) resolve(`rgb(${Math.round(r/c)}, ${Math.round(g/c)}, ${Math.round(b/c)})`);
        else resolve(null);
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export const extractAverageHexFromSrc = (src) => {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 64, 64);
      try {
        const data = ctx.getImageData(0, 0, 64, 64).data;
        let r = 0, g = 0, b = 0, c = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i+3] < 128) continue;
          r += data[i]; g += data[i+1]; b += data[i+2];
          c++;
        }
        if (c > 0) {
          const hex = `#${((1 << 24) + (r/c) * 65536 + (g/c) * 256 + (b/c) | 0).toString(16).slice(1)}`;
          resolve(hex);
        } else resolve(null);
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export const hexToHsl = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / (max - min) + (g < b ? 6 : 0); break;
      case g: h = (b - r) / (max - min) + 2; break;
      case b: h = (r - g) / (max - min) + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export const generatePaletteFromHex = (hex) => {
  if (!hex) return generateRandomPalette();
  let { h, s, l } = hexToHsl(hex);
  s = Math.max(40, Math.min(90, s));
  const isDark = l < 50;

  const accent1 = hslToHex(h, s, isDark ? 62 : 58);
  const accent2 = hslToHex((h + 40) % 360, s, isDark ? 58 : 62);
  const accent3 = hslToHex((h + 80) % 360, s, isDark ? 65 : 60);

  let bgColor, glassColor;
  if (isDark) {
    bgColor = hslToHex(h, Math.min(s, 28), 10);
    glassColor = hslToHex(h, Math.min(s, 22), 14);
  } else {
    bgColor = hslToHex(h, Math.min(s, 18), 97);
    glassColor = '#ffffff';
  }

  const pickTextForBg = (bg, hue) => {
    const Lbg = relativeLuminance(bg);
    const wantLightText = Lbg < 0.45;
    let textM = wantLightText ? hslToHex(hue % 360, 12, 94) : hslToHex(hue % 360, 38, 16);
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
    return { textMain: textM, textSoft: textS }
  }

  const { textMain, textSoft } = pickTextForBg(bgColor, h);
  const bgGradientEnd = isDark ? hslToHex((h + 50) % 360, Math.min(s, 35), 16) : hslToHex((h + 45) % 360, Math.min(s, 25), 92);
  
  return {
    bgColor,
    glassColor,
    textMain,
    textSoft,
    accent1,
    accent2,
    accent3,
    bgGradientEnd,
    bgGradientAngle: 135,
    bgMode: 'linear'
  };
}
