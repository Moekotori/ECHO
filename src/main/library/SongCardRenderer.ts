import sharp from 'sharp';
import type { LibraryTrack } from './libraryTypes';
import { defaultCoverSvg } from './workers/TsCoverExtractor';

export type SongCardRenderInput = {
  track: Pick<LibraryTrack, 'title' | 'artist' | 'album' | 'coverId'>;
  coverPath: string | null;
  coverMimeType: string | null;
};

export type SongCardRenderResult = {
  pngBuffer: Buffer;
  suggestedFileName: string;
};

const width = 1920;
const height = 1080;
const outerRadius = 72;
const coverSize = 760;
const coverX = 1012;
const coverY = 160;
const coverRadius = 0;
const textX = 142;
const textMaxWidth = 760;
const textAverageWidthRatio = 0.56;
const defaultCoverBuffer = Buffer.from(defaultCoverSvg);

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

type SongCardPalette = {
  accent: string;
  accentSoft: string;
  accentDeep: string;
  accentMist: string;
};

const fallbackAccent: RgbColor = { r: 116, g: 108, b: 255 };

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const mixColor = (from: RgbColor, to: RgbColor, amount: number): RgbColor => ({
  r: clampChannel(from.r + (to.r - from.r) * amount),
  g: clampChannel(from.g + (to.g - from.g) * amount),
  b: clampChannel(from.b + (to.b - from.b) * amount),
});

const colorToHex = ({ r, g, b }: RgbColor): string =>
  `#${[r, g, b].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;

const colorLuminance = ({ r, g, b }: RgbColor): number => r * 0.2126 + g * 0.7152 + b * 0.0722;

const normalizeAccent = (color: RgbColor): RgbColor => {
  const luminance = colorLuminance(color);

  if (luminance < 72) {
    return mixColor(color, { r: 190, g: 210, b: 255 }, 0.48);
  }

  if (luminance > 204) {
    return mixColor(color, { r: 76, g: 118, b: 240 }, 0.42);
  }

  return color;
};

const samplePalette = async (coverInput: string | Buffer): Promise<SongCardPalette> => {
  try {
    const sample = await sharp(coverInput, { animated: false })
      .rotate()
      .resize(1, 1, { fit: 'cover', position: 'centre' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const sampled = normalizeAccent({
      r: sample[0] ?? fallbackAccent.r,
      g: sample[1] ?? fallbackAccent.g,
      b: sample[2] ?? fallbackAccent.b,
    });

    return {
      accent: colorToHex(mixColor(sampled, { r: 255, g: 255, b: 255 }, 0.1)),
      accentSoft: colorToHex(mixColor(sampled, { r: 128, g: 104, b: 255 }, 0.28)),
      accentDeep: colorToHex(mixColor(sampled, { r: 4, g: 9, b: 20 }, 0.62)),
      accentMist: colorToHex(mixColor(sampled, { r: 232, g: 238, b: 255 }, 0.58)),
    };
  } catch {
    return {
      accent: colorToHex(fallbackAccent),
      accentSoft: '#8f7cff',
      accentDeep: '#151236',
      accentMist: '#dcdfff',
    };
  }
};

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const cleanText = (value: string | null | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const safeFileName = (value: string): string => {
  const cleaned = Array.from(value)
    .filter((character) => character.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'ECHO Song Card').slice(0, 120);
};

const fitTextLines = (value: string, fontSize: number, maxWidth: number, maxLines: number): string[] => {
  let remaining = value.trim();
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * textAverageWidthRatio)));
  const lines: string[] = [];

  while (remaining.length > 0 && lines.length < maxLines) {
    const remainingChars = Array.from(remaining);
    const isLastLine = lines.length === maxLines - 1;
    const willTruncate = isLastLine && remainingChars.length > maxChars;
    const limit = Math.max(1, willTruncate ? maxChars - 3 : maxChars);
    let take = Math.min(limit, remainingChars.length);

    if (!isLastLine && remainingChars.length > take) {
      const slice = remainingChars.slice(0, take);
      const lowerBreakBound = Math.floor(take * 0.45);
      for (let index = slice.length - 1; index >= lowerBreakBound; index -= 1) {
        if (/\s/u.test(slice[index] ?? '')) {
          take = index;
          break;
        }
      }
    }

    const line = remainingChars.slice(0, take).join('').trimEnd();
    lines.push(`${line || remainingChars.slice(0, 1).join('')}${willTruncate ? '...' : ''}`);
    remaining = remainingChars.slice(Math.max(1, take)).join('').trimStart();
  }

  return lines.length > 0 ? lines : [value];
};

const fitText = (value: string, fontSize: number, maxWidth: number): string => {
  const [line = value] = fitTextLines(value, fontSize, maxWidth, 1);
  return line;
};

const titleSizeFor = (value: string): number => {
  const length = Array.from(value).length;

  if (length > 46) {
    return 56;
  }

  if (length > 34) {
    return 64;
  }

  if (length > 24) {
    return 78;
  }

  if (length > 16) {
    return 92;
  }

  return 112;
};

const metadataMarksSvg = (palette: SongCardPalette): string => {
  const markY = 874;

  return `<g>
    <rect x="${textX}" y="${markY}" width="112" height="4" rx="2" fill="${palette.accent}" fill-opacity="0.7"/>
    <line x1="${textX + 142}" y1="${markY + 2}" x2="${textX + 616}" y2="${markY + 2}" stroke="${palette.accentMist}" stroke-opacity="0.14" stroke-width="1.5"/>
    <circle cx="${textX + 654}" cy="${markY + 2}" r="4.5" fill="${palette.accentMist}" fill-opacity="0.26"/>
  </g>`;
};

const textSvg = (track: SongCardRenderInput['track'], palette: SongCardPalette): Buffer => {
  const title = cleanText(track.title, 'Untitled');
  const artist = cleanText(track.artist, 'Unknown Artist');
  const album = cleanText(track.album, 'Unknown Album');
  const titleSize = titleSizeFor(title);
  const titleLines = fitTextLines(title, titleSize, textMaxWidth, 2);
  const fittedArtist = fitText(artist, 56, textMaxWidth);
  const fittedAlbum = fitText(album, 38, textMaxWidth);
  const titleLineHeight = Math.round(titleSize * 1.08);
  const titleStartY = titleLines.length > 1 ? 386 : titleSize >= 100 ? 474 : 454;
  const artistY = titleStartY + titleLineHeight * titleLines.length + (titleLines.length > 1 ? 58 : 70);
  const albumY = artistY + 66;
  const titleElements = titleLines
    .map(
      (line, index) =>
        `<text x="${textX}" y="${titleStartY + index * titleLineHeight}" fill="#fbfbff" font-family="Inter, Microsoft YaHei, Segoe UI, Arial, sans-serif" font-size="${titleSize}" font-weight="900" letter-spacing="0" filter="url(#text-shadow)">${escapeXml(line)}</text>`,
    )
    .join('\n  ');

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="text-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#020711" flood-opacity="0.44"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" rx="${outerRadius}" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1.5"/>
  <g font-family="Inter, Microsoft YaHei, Segoe UI, Arial, sans-serif" font-size="26" font-weight="800" letter-spacing="0">
    <text x="${textX}" y="176" fill="#fbfbff" fill-opacity="0.74">ECHO NEXT</text>
    <rect x="${textX}" y="210" width="132" height="4" rx="2" fill="${palette.accent}" fill-opacity="0.68"/>
    <text x="${textX + 198}" y="176" fill="#fbfbff" fill-opacity="0.46">NOW PLAYING</text>
  </g>
  ${titleElements}
  <text x="${textX}" y="${artistY}" fill="#f8f9ff" fill-opacity="0.92" font-family="Inter, Microsoft YaHei, Segoe UI, Arial, sans-serif" font-size="56" font-weight="820" letter-spacing="0">${escapeXml(fittedArtist)}</text>
  <text x="${textX}" y="${albumY}" fill="#f8f9ff" fill-opacity="0.55" font-family="Inter, Microsoft YaHei, Segoe UI, Arial, sans-serif" font-size="38" font-weight="720" letter-spacing="0">${escapeXml(fittedAlbum)}</text>
  ${metadataMarksSvg(palette)}
</svg>`);
};

const roundedRectMask = (maskWidth: number, maskHeight: number, radius: number): Buffer =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${maskWidth}" height="${maskHeight}">
    <rect width="${maskWidth}" height="${maskHeight}" rx="${radius}" ry="${radius}" fill="#fff"/>
  </svg>`);

const coverShadowSvg = (palette: SongCardPalette): Buffer =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="cover-shadow" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="34" stdDeviation="30" flood-color="#020711" flood-opacity="0.52"/>
    </filter>
    <filter id="accent-glow" x="-45%" y="-45%" width="190%" height="190%">
      <feGaussianBlur stdDeviation="42"/>
    </filter>
  </defs>
  <rect x="${coverX - 32}" y="${coverY + 20}" width="${coverSize}" height="${coverSize}" rx="${coverRadius}" fill="${palette.accent}" fill-opacity="0.16" filter="url(#accent-glow)"/>
  <rect x="${coverX + 18}" y="${coverY + 22}" width="${coverSize - 36}" height="${coverSize - 32}" rx="${Math.max(0, coverRadius - 8)}" fill="#020711" fill-opacity="0.72" filter="url(#cover-shadow)"/>
</svg>`);

const overlaySvg = (palette: SongCardPalette): Buffer =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="text-depth" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#020611" stop-opacity="0.92"/>
      <stop offset="0.44" stop-color="#020611" stop-opacity="0.78"/>
      <stop offset="0.74" stop-color="#020611" stop-opacity="0.36"/>
      <stop offset="1" stop-color="#020611" stop-opacity="0.58"/>
    </linearGradient>
    <linearGradient id="cover-wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.accentDeep}" stop-opacity="0.28"/>
      <stop offset="0.58" stop-color="${palette.accentSoft}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0.22"/>
    </linearGradient>
    <linearGradient id="cover-focus" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#020611" stop-opacity="0"/>
      <stop offset="0.52" stop-color="#ffffff" stop-opacity="0.035"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.07"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="#020611" fill-opacity="0.48"/>
  <rect width="${width}" height="${height}" fill="url(#text-depth)"/>
  <rect width="${width}" height="${height}" fill="url(#cover-wash)"/>
  <rect x="850" y="0" width="${width - 850}" height="${height}" fill="url(#cover-focus)"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#00030a" fill-opacity="0.08"/>
</svg>`);

export class SongCardRenderer {
  async render(input: SongCardRenderInput): Promise<SongCardRenderResult> {
    const coverInput = input.coverPath ?? defaultCoverBuffer;
    const palette = await samplePalette(coverInput);
    const background = await sharp(coverInput, { animated: false })
      .rotate()
      .resize(width, height, { fit: 'cover', position: 'centre' })
      .blur(38)
      .modulate({ brightness: 0.56, saturation: 1.18 })
      .png()
      .toBuffer();
    const foregroundCover = await sharp(coverInput, { animated: false })
      .rotate()
      .flatten({ background: palette.accentDeep })
      .resize(coverSize, coverSize, { fit: 'cover', position: 'centre' })
      .composite([{ input: roundedRectMask(coverSize, coverSize, coverRadius), blend: 'dest-in' }])
      .png()
      .toBuffer();
    const composedCard = await sharp(background)
      .composite([
        { input: overlaySvg(palette), left: 0, top: 0 },
        { input: coverShadowSvg(palette), left: 0, top: 0 },
        { input: foregroundCover, left: coverX, top: coverY },
        { input: textSvg(input.track, palette), left: 0, top: 0 },
      ])
      .png()
      .toBuffer();
    const card = await sharp(composedCard)
      .composite([{ input: roundedRectMask(width, height, outerRadius), blend: 'dest-in' }])
      .png()
      .toBuffer();

    return {
      pngBuffer: card,
      suggestedFileName: `${safeFileName(`${cleanText(input.track.title, 'Untitled')} - ${cleanText(input.track.artist, 'Unknown Artist')}`)}.png`,
    };
  }
}
