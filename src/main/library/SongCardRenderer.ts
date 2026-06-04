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
const outerRadius = 70;
const coverSize = 690;
const coverX = 112;
const coverY = 194;
const coverRadius = 54;
const panelX = 742;
const panelY = 154;
const panelWidth = 1066;
const panelHeight = 760;
const textX = 838;
const textMaxWidth = 850;
const textAverageWidthRatio = 0.62;
const defaultCoverBuffer = Buffer.from(defaultCoverSvg);

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

const fitText = (value: string, fontSize: number, maxWidth: number): string => {
  const chars = Array.from(value);
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * textAverageWidthRatio)));

  if (chars.length <= maxChars) {
    return value;
  }

  return `${chars.slice(0, Math.max(1, maxChars - 3)).join('')}...`;
};

const titleSizeFor = (value: string): number => {
  const length = Array.from(value).length;

  if (length > 32) {
    return 74;
  }

  if (length > 22) {
    return 88;
  }

  return 118;
};

const textSvg = (track: SongCardRenderInput['track']): Buffer => {
  const title = cleanText(track.title, 'Untitled');
  const artist = cleanText(track.artist, 'Unknown Artist');
  const album = cleanText(track.album, 'Unknown Album');
  const titleSize = titleSizeFor(title);
  const fittedTitle = fitText(title, titleSize, textMaxWidth);
  const fittedArtist = fitText(artist, 72, textMaxWidth);
  const fittedAlbum = fitText(album, 50, textMaxWidth);
  const titleY = titleSize >= 100 ? 446 : 430;
  const artistY = titleY + 118;
  const albumY = artistY + 98;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#020711" flood-opacity="0.34"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" rx="${outerRadius}" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="1.5"/>
  <text x="${textX}" y="266" fill="#f6f8ff" fill-opacity="0.82" font-family="Inter, Microsoft YaHei, Segoe UI, Arial, sans-serif" font-size="46" font-weight="800" letter-spacing="10">ECHO NEXT</text>
  <text x="${textX}" y="${titleY}" fill="#f7f8ff" font-family="Inter, Microsoft YaHei, Segoe UI, Arial, sans-serif" font-size="${titleSize}" font-weight="900" filter="url(#soft-shadow)">${escapeXml(fittedTitle)}</text>
  <text x="${textX}" y="${artistY}" fill="#f6f8ff" fill-opacity="0.94" font-family="Inter, Microsoft YaHei, Segoe UI, Arial, sans-serif" font-size="72" font-weight="800">${escapeXml(fittedArtist)}</text>
  <text x="${textX}" y="${albumY}" fill="#f6f8ff" fill-opacity="0.68" font-family="Inter, Microsoft YaHei, Segoe UI, Arial, sans-serif" font-size="50" font-weight="700">${escapeXml(fittedAlbum)}</text>
  <line x1="${textX}" y1="738" x2="1698" y2="738" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2"/>
  <g font-family="Inter, Microsoft YaHei, Segoe UI, Arial, sans-serif" font-size="34" font-weight="800" fill="#f6f8ff">
    <rect x="${textX}" y="784" width="236" height="68" rx="34" fill="#ffffff" fill-opacity="0.13" stroke="#ffffff" stroke-opacity="0.24" stroke-width="1.5"/>
    <text x="${textX + 34}" y="831">Song Card</text>
    <rect x="${textX + 260}" y="784" width="270" height="68" rx="34" fill="#ffffff" fill-opacity="0.13" stroke="#ffffff" stroke-opacity="0.24" stroke-width="1.5"/>
    <text x="${textX + 294}" y="831">Now Playing</text>
  </g>
</svg>`);
};

const roundedRectMask = (maskWidth: number, maskHeight: number, radius: number): Buffer =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${maskWidth}" height="${maskHeight}">
    <rect width="${maskWidth}" height="${maskHeight}" rx="${radius}" ry="${radius}" fill="#fff"/>
  </svg>`);

const coverShadowSvg = (): Buffer =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="cover-shadow" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="32" stdDeviation="30" flood-color="#020814" flood-opacity="0.48"/>
    </filter>
  </defs>
  <rect x="${coverX}" y="${coverY}" width="${coverSize}" height="${coverSize}" rx="${coverRadius}" fill="#0a1222" fill-opacity="0.58" stroke="#ffffff" stroke-opacity="0.18" stroke-width="1.5" filter="url(#cover-shadow)"/>
</svg>`);

const panelSvg = (): Buffer =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.23"/>
      <stop offset="0.46" stop-color="#ffffff" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#0c1628" stop-opacity="0.36"/>
    </linearGradient>
    <filter id="panel-shadow" x="-18%" y="-18%" width="136%" height="136%">
      <feDropShadow dx="0" dy="30" stdDeviation="36" flood-color="#020711" flood-opacity="0.32"/>
    </filter>
  </defs>
  <rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="58" fill="url(#panel)" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1.5" filter="url(#panel-shadow)"/>
  <rect x="${panelX + 34}" y="${panelY + 34}" width="${panelWidth - 68}" height="${panelHeight - 68}" rx="44" fill="#08101e" fill-opacity="0.16" stroke="#ffffff" stroke-opacity="0.09" stroke-width="1"/>
</svg>`);

const overlaySvg = (): Buffer =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="blue" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#09111f" stop-opacity="0.46"/>
      <stop offset="0.58" stop-color="#171226" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#1f5c9f" stop-opacity="0.44"/>
    </linearGradient>
    <radialGradient id="violet" cx="0.12" cy="0.88" r="0.62">
      <stop offset="0" stop-color="#6b4cff" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#6b4cff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="rgba(2,7,18,0.56)"/>
  <rect width="${width}" height="${height}" fill="url(#blue)"/>
  <rect width="${width}" height="${height}" fill="url(#violet)"/>
</svg>`);

export class SongCardRenderer {
  async render(input: SongCardRenderInput): Promise<SongCardRenderResult> {
    const coverInput = input.coverPath ?? defaultCoverBuffer;
    const background = await sharp(coverInput, { animated: false })
      .rotate()
      .resize(width, height, { fit: 'cover', position: 'centre' })
      .blur(26)
      .modulate({ brightness: 0.62, saturation: 1.16 })
      .png()
      .toBuffer();
    const foregroundCover = await sharp(coverInput, { animated: false })
      .rotate()
      .resize(coverSize, coverSize, { fit: 'cover', position: 'centre' })
      .composite([{ input: roundedRectMask(coverSize, coverSize, coverRadius), blend: 'dest-in' }])
      .png()
      .toBuffer();
    const composedCard = await sharp(background)
      .composite([
        { input: overlaySvg(), left: 0, top: 0 },
        { input: panelSvg(), left: 0, top: 0 },
        { input: coverShadowSvg(), left: 0, top: 0 },
        { input: foregroundCover, left: coverX, top: coverY },
        { input: textSvg(input.track), left: 0, top: 0 },
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
