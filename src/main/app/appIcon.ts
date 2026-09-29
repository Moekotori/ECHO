import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nativeImage } from 'electron';

const mainOutputDir = import.meta.dirname;
const requestedWindowsIconPath = 'D:\\ECHODev\\build-resources\\icons\\software.ico';

const iconRelativePaths = [
  '../../build-resources/icons/software.ico',
  '../../build-resources/icons/software.png',
  '../../../build-resources/icons/software.ico',
  '../../../build-resources/icons/software.png',
] as const;

export const resolveAppIconPath = (baseDir = mainOutputDir): string | null => {
  if (process.platform === 'win32' && existsSync(requestedWindowsIconPath)) {
    return requestedWindowsIconPath;
  }

  for (const relativePath of iconRelativePaths) {
    const candidate = join(baseDir, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const createFallbackBitmapIcon = (): Electron.NativeImage => {
  const width = 16;
  const height = 16;
  const raw = Buffer.alloc(width * height * 4);

  const paintPixel = (x: number, y: number, red: number, green: number, blue: number, alpha = 255): void => {
    const offset = (y * width + x) * 4;
    raw[offset] = blue;
    raw[offset + 1] = green;
    raw[offset + 2] = red;
    raw[offset + 3] = alpha;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cornerX = x < 3 ? 2 - x : x > 12 ? x - 13 : 0;
      const cornerY = y < 3 ? 2 - y : y > 12 ? y - 13 : 0;
      const alpha = cornerX * cornerX + cornerY * cornerY > 5 ? 0 : 255;
      paintPixel(x, y, 47, 111, 143, alpha);
    }
  }

  for (let y = 4; y <= 11; y += 1) {
    paintPixel(6, y, 255, 255, 255);
    paintPixel(7, y, 255, 255, 255);
  }
  for (let x = 6; x <= 12; x += 1) {
    paintPixel(x, 4, 255, 255, 255);
    paintPixel(x, 5, 255, 255, 255);
  }
  for (let y = 10; y <= 13; y += 1) {
    for (let x = 3; x <= 7; x += 1) {
      const dx = x - 5;
      const dy = y - 12;
      if (dx * dx + dy * dy <= 6) {
        paintPixel(x, y, 255, 255, 255);
      }
    }
  }

  return nativeImage.createFromBitmap(raw, { width, height });
};

export const createAppIconImage = (): Electron.NativeImage => {
  const iconPath = resolveAppIconPath();
  if (iconPath) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      return image;
    }
  }

  return createFallbackBitmapIcon();
};
