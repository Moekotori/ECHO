import { open, stat } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import iconv from 'iconv-lite';
import { parseFile } from 'music-metadata';
import type { IAudioMetadata } from 'music-metadata';
import { shouldPreferTagLibForAlacTechnicalFields } from '../../audio/AlacTechnicalMetadata';
import { resolveCueTrack } from '../../audio/CueSheet';
import { resolveMp4ContainerAudioCodec } from '../../audio/Mp4AudioCodec';
import type { EmbeddedCoverData, FieldSource, FieldSources, MetadataFields, MetadataResult } from '../libraryTypes';
import type { MetadataReader } from './MetadataReader';

const unknownArtist = 'Unknown Artist';
const unknownAlbum = '';
const waveInfoTagIds = new Set(['IART', 'INAM', 'IPRD', 'IGNR', 'ICRD', 'ITRK']);
const waveContainerIds = new Set(['RIFF', 'RF64', 'BW64']);
const riffSizePlaceholder = 0xffffffff;
const tagLibPreferredExtensions = new Set([
  '.dsf',
  '.dff',
  '.wav',
  '.aiff',
  '.aif',
  '.ape',
  '.wv',
  '.tta',
  '.tak',
  '.caf',
  '.mka',
  '.mkv',
  '.m4a',
  '.m4b',
  '.m4p',
  '.mp4',
  '.mov',
  '.webm',
  '.mpc',
]);
const tagLibCoreFallbackFields = ['title', 'artist'] as const;
const tagLibTechnicalFallbackFields = ['duration', 'codec', 'sampleRate', 'bitDepth', 'bitrate'] as const;
const replaceableMetadataSources = new Set<FieldSource>(['unknown', 'filename_fallback', 'folder_structure', 'artist_fallback']);
const replaceableTechnicalSources = new Set<FieldSource>(['unknown', 'filename_fallback']);
const mojibakeCandidateEncodings = ['latin1', 'win1252', 'gb18030', 'gbk', 'big5', 'shift_jis'] as const;
const tagLibTextQualityFallbackExtensions = new Set(['.wav', '.wave', '.aiff', '.aif']);
const textMetadataFields = new Set<keyof MetadataFields>(['title', 'artist', 'album', 'albumArtist', 'genre']);
const maxMetadataTextLength = 512;
const maxRawMetadataTextLength = 4096;
const suspiciousMojibakePattern = /(?:[\u00c0-\u00ff]{2,}|[\u00c2-\u00f4][\u0080-\u00bf]|[\u00c3\u00c2][\u0080-\u00ffA-Za-z]|[\u93c4\u71b7\u5a07\u9287\u958e\u59b5\u7d0b]{2,}|\u{fffd}|\?{2,})/u;
const binaryMetadataTextPattern = /(?:APIC|image\/(?:jpeg|jpg|png|webp|gif)|JFIF|Exif|\u0000)/iu;
const japaneseKanaPattern = /[\u3040-\u30ff]/u;
const unsafeEmbeddedMetadataWarning = 'embedded_metadata_skipped_unsafe_text';
const commonTextMetadataKeys = new Set(['title', 'artist', 'artists', 'album', 'albumartist', 'genre', 'date']);
const nativeArtworkTagIds = ['apic', 'pic', 'covr', 'coverart', 'metadata_block_picture', 'metadatablockpicture', 'wmpicture'];
const asfMetadataExtensions = new Set(['.asf', '.wma', '.wmv']);
const containerBitrateFallbackExtensions = new Set(['.ape']);
const suspiciouslyLowLosslessBitrate = 64_000;
const mojibakeFragments = [
  '\u00c3',
  '\u00c2',
  '\u00d0',
  '\u00d1',
  '\u00d2',
  '\u00d3',
  '\u00c5',
  '\u00c6',
  '\u00c7',
  '\u00c8',
  '\u00c9',
  '\u00ca',
  '\u00cb',
  '\u9287',
  '\u9288',
  '\u93c4',
  '\u71b7',
  '\u59b5',
  '\u958e',
  '\u7d0b',
  '\u{fffd}',
];

type WaveInfoTags = Partial<Record<'IART' | 'INAM' | 'IPRD' | 'IGNR' | 'ICRD' | 'ITRK' | 'BEXT_DESCRIPTION' | 'BEXT_ORIGINATOR' | 'BEXT_ORIGINATION_DATE', string>>;

type TagLibFallbackFields = {
  [Key in keyof MetadataFields]?: MetadataFields[Key] | null;
};

type TagLibFallbackMetadata = {
  fields: TagLibFallbackFields;
  embeddedCover?: EmbeddedCoverData;
  warnings: string[];
};

const stripTrailingNulls = (buffer: Buffer): Buffer => {
  let end = buffer.length;
  while (end > 0 && buffer[end - 1] === 0) {
    end -= 1;
  }

  return buffer.subarray(0, end);
};

const stripTrailingUtf16Nulls = (buffer: Buffer): Buffer => {
  let end = buffer.length;
  while (end >= 2 && buffer[end - 1] === 0 && buffer[end - 2] === 0) {
    end -= 2;
  }

  return buffer.subarray(0, end);
};

const countMatches = (text: string, pattern: RegExp): number => Array.from(text.matchAll(pattern)).length;

const countControlCharacters = (text: string): number => {
  let count = 0;

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint >= 0x00 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      count += 1;
    }
  }

  return count;
};

const countHardControlCharacters = (text: string): number =>
  countMatches(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu);

const normalizeMetadataTextWhitespace = (text: string): string =>
  text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim();

const isSafeMetadataText = (text: string): boolean => {
  if (!text || text.length > maxRawMetadataTextLength) {
    return false;
  }

  if (text.length > maxMetadataTextLength) {
    return false;
  }

  if (binaryMetadataTextPattern.test(text)) {
    return false;
  }

  const controlCount = countControlCharacters(text);
  return controlCount < 8 && controlCount / Math.max(1, text.length) <= 0.02;
};

const isUnsafeRawMetadataText = (value: string): boolean => {
  const raw = value.trim();
  if (!raw) {
    return false;
  }

  if (raw.length > maxRawMetadataTextLength || binaryMetadataTextPattern.test(raw)) {
    return true;
  }

  const hardControlCount = countHardControlCharacters(raw);
  return hardControlCount >= 8 || hardControlCount / Math.max(1, raw.length) > 0.02;
};

const containsUnsafeMetadataText = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return isUnsafeRawMetadataText(value);
  }

  return Array.isArray(value) ? value.some(containsUnsafeMetadataText) : false;
};

const isNativeArtworkTagId = (id: string): boolean => {
  const normalized = id.toLowerCase().replace(/[^a-z0-9]/g, '');
  return nativeArtworkTagIds.some((tagId) => normalized === tagId || normalized.startsWith(tagId));
};

const hasUnsafeTagMapTextMetadata = (tags: Record<string, unknown>): boolean =>
  Object.entries(tags).some(([key, value]) => !isNativeArtworkTagId(key) && containsUnsafeMetadataText(value));

const textQualityScore = (text: string): number => {
  let score = 0;

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === '\uFFFD') {
      score -= 40;
      continue;
    }

    if ((codePoint >= 0 && codePoint < 32 && ![9, 10, 13].includes(codePoint)) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      score -= 25;
      continue;
    }

    if (codePoint >= 0x2460 && codePoint <= 0x24ff) {
      score -= 8;
      continue;
    }

    if (
      (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
      (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7af)
    ) {
      score += 4;
      continue;
    }

    if (codePoint >= 0x20 && codePoint <= 0x7e) {
      score += 1;
      continue;
    }

    score += 0.5;
  }

  score -= countMatches(text, /[\uFFFD?]/gu) * 18;
  score -= countControlCharacters(text) * 20;
  score -= countMatches(text, /(?:[\u00c2-\u00f4][\u0080-\u00bf]|[\u00c3\u00c2][\u0080-\u00ffA-Za-z]|\u00e2[\u0080-\u00ff]{1,2})/gu) * 12;
  for (const fragment of mojibakeFragments) {
    score -= text.split(fragment).length - 1;
  }

  return score;
};

const isTextMetadataField = (field: keyof MetadataFields): field is 'title' | 'artist' | 'album' | 'albumArtist' | 'genre' =>
  textMetadataFields.has(field);

const countAsciiSymbols = (text: string): number =>
  countMatches(text, /[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]/gu);

const countAsciiLettersOrDigits = (text: string): number =>
  countMatches(text, /[A-Za-z0-9]/gu);

const isSuspiciousMetadataText = (text: string): boolean => {
  const normalized = normalizeMetadataTextWhitespace(text);
  if (!normalized) {
    return false;
  }

  if (suspiciousMojibakePattern.test(normalized) || countControlCharacters(normalized) > 0) {
    return true;
  }

  const asciiCharacters = Array.from(normalized).filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0x20 && codePoint <= 0x7e;
  }).length;
  const asciiSymbolCount = countAsciiSymbols(normalized);
  const asciiLetterOrDigitCount = countAsciiLettersOrDigits(normalized);
  if (
    normalized.length >= 4 &&
    asciiCharacters === normalized.length &&
    asciiLetterOrDigitCount > 0 &&
    asciiSymbolCount >= 2 &&
    asciiSymbolCount / normalized.length >= 0.3
  ) {
    return true;
  }

  return textQualityScore(normalized) < -8;
};

export const repairMojibakeText = (value: string): string => {
  const trimmed = value.trim();
  if (!suspiciousMojibakePattern.test(trimmed)) {
    return trimmed;
  }

  const candidates = mojibakeCandidateEncodings.flatMap((encoding) => {
    try {
      const decoded = iconv.decode(iconv.encode(trimmed, encoding), 'utf8').trim();
      if (!decoded || decoded === trimmed) {
        return [];
      }

      return [{ text: decoded, score: textQualityScore(decoded) }];
    } catch {
      return [];
    }
  });

  const originalScore = textQualityScore(trimmed);
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];

  return best && best.score >= originalScore + 4 ? best.text : trimmed;
};

const cleanText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const raw = value.trim();
  if (!raw || raw.length > maxRawMetadataTextLength || binaryMetadataTextPattern.test(raw)) {
    return null;
  }

  const rawControlCount = countHardControlCharacters(raw);
  if (rawControlCount >= 8 || rawControlCount / Math.max(1, raw.length) > 0.02) {
    return null;
  }

  const repaired = normalizeMetadataTextWhitespace(repairMojibakeText(raw));
  if (!isSafeMetadataText(repaired)) {
    return null;
  }

  return repaired.length > 0 ? repaired : null;
};

const cleanTextList = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    return cleanText(value.find((item) => cleanText(item)));
  }

  return cleanText(value);
};

const shouldInspectNativeTextTag = (common: IAudioMetadata['common'], rawId: string): boolean => {
  const id = rawId.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (id === 'title' || id === 'tit2') {
    return !cleanText(common.title);
  }
  if (id === 'artist' || id === 'tpe1') {
    return !cleanText(common.artist) && !cleanTextList(common.artists);
  }
  if (id === 'album' || id === 'talb') {
    return !cleanText(common.album);
  }
  if (id === 'albumartist' || id === 'tpe2') {
    return !cleanTextList(common.albumartist);
  }
  if (id === 'genre' || id === 'tcon') {
    return !cleanTextList(common.genre);
  }

  return [
    'tracknumber',
    'track',
    'trck',
    'discnumber',
    'disknumber',
    'disc',
    'disk',
    'tpos',
    'date',
    'year',
    'originaldate',
    'originalyear',
    'tdrc',
    'bpm',
    'tbpm',
    'replaygaintrackgain',
    'replaygaintrackpeak',
    'replaygainalbumgain',
    'replaygainalbumpeak',
    'replaygainintegratedlufs',
    'r128trackgain',
    'r128albumgain',
  ].includes(id);
};

const hasUnsafeEmbeddedTextMetadata = (metadata: IAudioMetadata): boolean => {
  for (const [key, value] of Object.entries(metadata.common ?? {})) {
    if (commonTextMetadataKeys.has(key.toLowerCase()) && containsUnsafeMetadataText(value)) {
      return true;
    }
  }

  for (const entries of Object.values(metadata.native ?? {})) {
    for (const entry of entries) {
      if (typeof entry.id !== 'string' || isNativeArtworkTagId(entry.id) || !shouldInspectNativeTextTag(metadata.common, entry.id)) {
        continue;
      }
      if (containsUnsafeMetadataText(entry.value)) {
        return true;
      }
    }
  }

  return false;
};

export const decodeWaveInfoText = (rawValue: Buffer): string | null => {
  const utf16Data = stripTrailingUtf16Nulls(rawValue);
  const data = stripTrailingNulls(rawValue);
  if (data.length === 0) {
    return null;
  }

  const hasUtf16LeBom = utf16Data.length >= 2 && utf16Data[0] === 0xff && utf16Data[1] === 0xfe;
  const hasUtf16BeBom = utf16Data.length >= 2 && utf16Data[0] === 0xfe && utf16Data[1] === 0xff;
  if (hasUtf16LeBom || hasUtf16BeBom) {
    const decoded = cleanText(new TextDecoder(hasUtf16LeBom ? 'utf-16le' : 'utf-16be').decode(utf16Data.subarray(2)));
    if (decoded) {
      return decoded;
    }
  }

  const evenNulls = utf16Data.filter((byte, index) => index % 2 === 0 && byte === 0).length;
  const oddNulls = utf16Data.filter((byte, index) => index % 2 === 1 && byte === 0).length;
  const likelyUtf16 =
    utf16Data.length >= 4 &&
    Math.max(evenNulls, oddNulls) >= 2 &&
    Math.max(evenNulls, oddNulls) / Math.max(1, Math.floor(utf16Data.length / 2)) >= 0.3;

  if (likelyUtf16) {
    const preferredEncoding = oddNulls >= evenNulls ? 'utf-16le' : 'utf-16be';
    const preferredText = cleanText(new TextDecoder(preferredEncoding).decode(utf16Data));
    if (preferredText) {
      return preferredText;
    }

    const utf16Candidates = ['utf-16le', 'utf-16be'].flatMap((encoding) => {
      try {
        const text = cleanText(new TextDecoder(encoding).decode(utf16Data));
        return text ? [{ text, score: textQualityScore(text) }] : [];
      } catch {
        return [];
      }
    });

    utf16Candidates.sort((left, right) => right.score - left.score);
    if (utf16Candidates[0]) {
      return utf16Candidates[0].text;
    }
  }

  try {
    const utf8Text = cleanText(new TextDecoder('utf-8', { fatal: true }).decode(data));
    if (utf8Text && !isSuspiciousMetadataText(utf8Text)) {
      return utf8Text;
    }
  } catch {
    // Legacy WAV INFO chunks often omit an encoding marker; fall through to heuristic decoding.
  }

  const candidates = ['utf-8', 'gb18030', 'gbk', 'shift_jis', 'euc-jp', 'iso-2022-jp', 'big5', 'windows-1252'].flatMap((encoding, index) => {
    try {
      const decoded =
        encoding === 'utf-8' || encoding === 'iso-2022-jp'
          ? new TextDecoder(encoding).decode(data)
          : iconv.decode(data, encoding === 'windows-1252' ? 'win1252' : encoding);
      const text = cleanText(decoded);
      const legacyJapaneseBonus = (encoding === 'shift_jis' || encoding === 'euc-jp' || encoding === 'iso-2022-jp') && japaneseKanaPattern.test(text ?? '') && !text?.includes('\uFFFD') ? 2 : 0;
      return text ? [{ text, score: textQualityScore(text) + legacyJapaneseBonus, priority: -index }] : [];
    } catch {
      return [];
    }
  });

  candidates.sort((left, right) => right.score - left.score || right.priority - left.priority);
  return candidates[0]?.text ?? null;
};

const safeUInt64LeToNumber = (buffer: Buffer, offset: number): number | null => {
  const value = buffer.readBigUInt64LE(offset);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
};

const parseDs64ChunkSizes = (data: Buffer): Map<string, number> => {
  const sizes = new Map<string, number>();
  if (data.length < 28) {
    return sizes;
  }

  const dataSize = safeUInt64LeToNumber(data, 8);
  if (dataSize !== null) {
    sizes.set('data', dataSize);
  }

  const tableLength = data.readUInt32LE(24);
  let position = 28;
  for (let index = 0; index < tableLength && position + 12 <= data.length; index += 1) {
    const chunkId = data.toString('ascii', position, position + 4);
    const chunkSize = safeUInt64LeToNumber(data, position + 4);
    if (chunkSize !== null) {
      sizes.set(chunkId, chunkSize);
    }
    position += 12;
  }

  return sizes;
};

const resolveChunkSize = (chunkId: string, chunkSize: number, ds64ChunkSizes: Map<string, number>): number | null => {
  if (chunkSize !== riffSizePlaceholder) {
    return chunkSize;
  }

  return ds64ChunkSizes.get(chunkId) ?? null;
};

const decodeBextFixedText = (data: Buffer, start: number, length: number): string | null => {
  if (data.length <= start) {
    return null;
  }

  return decodeWaveInfoText(data.subarray(start, Math.min(start + length, data.length)));
};

const readBextTags = (data: Buffer): WaveInfoTags => {
  const tags: WaveInfoTags = {};
  const description = decodeBextFixedText(data, 0, 256);
  const originator = decodeBextFixedText(data, 256, 32);
  const originationDate = decodeBextFixedText(data, 320, 10);

  if (description) {
    tags.BEXT_DESCRIPTION = description;
  }
  if (originator) {
    tags.BEXT_ORIGINATOR = originator;
  }
  if (originationDate) {
    tags.BEXT_ORIGINATION_DATE = originationDate;
  }

  return tags;
};

const readWaveInfoTags = async (filePath: string): Promise<WaveInfoTags> => {
  if (extname(filePath).toLowerCase() !== '.wav') {
    return {};
  }

  const file = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(12);
    const headerRead = await file.read(header, 0, header.length, 0);
    if (headerRead.bytesRead < header.length || !waveContainerIds.has(header.toString('ascii', 0, 4)) || header.toString('ascii', 8, 12) !== 'WAVE') {
      return {};
    }

    const fileSize = (await file.stat()).size;
    const tags: WaveInfoTags = {};
    const ds64ChunkSizes = new Map<string, number>();
    let position = 12;

    while (position + 8 <= fileSize) {
      const chunkHeader = Buffer.alloc(8);
      const chunkHeaderRead = await file.read(chunkHeader, 0, chunkHeader.length, position);
      if (chunkHeaderRead.bytesRead < chunkHeader.length) {
        break;
      }

      const chunkId = chunkHeader.toString('ascii', 0, 4);
      const chunkSize = chunkHeader.readUInt32LE(4);
      const resolvedChunkSize = resolveChunkSize(chunkId, chunkSize, ds64ChunkSizes);
      if (resolvedChunkSize === null || resolvedChunkSize < 0) {
        break;
      }
      const chunkDataPosition = position + 8;

      if (chunkId === 'ds64' && chunkDataPosition + resolvedChunkSize <= fileSize) {
        const ds64Data = Buffer.alloc(resolvedChunkSize);
        const ds64Read = await file.read(ds64Data, 0, ds64Data.length, chunkDataPosition);
        if (ds64Read.bytesRead === ds64Data.length) {
          for (const [id, size] of parseDs64ChunkSizes(ds64Data)) {
            ds64ChunkSizes.set(id, size);
          }
        }
      } else if (chunkId === 'bext' && chunkDataPosition < fileSize) {
        const bextReadLength = Math.min(resolvedChunkSize, 602, fileSize - chunkDataPosition);
        const bextData = Buffer.alloc(bextReadLength);
        const bextRead = await file.read(bextData, 0, bextData.length, chunkDataPosition);
        if (bextRead.bytesRead === bextData.length) {
          Object.assign(tags, readBextTags(bextData));
        }
      } else if (chunkId === 'LIST' && resolvedChunkSize >= 4) {
        const listType = Buffer.alloc(4);
        const listTypeRead = await file.read(listType, 0, listType.length, chunkDataPosition);
        if (listTypeRead.bytesRead === listType.length && listType.toString('ascii') === 'INFO') {
          let infoPosition = chunkDataPosition + 4;
          const infoEnd = Math.min(chunkDataPosition + resolvedChunkSize, fileSize);

          while (infoPosition + 8 <= infoEnd) {
            const infoHeader = Buffer.alloc(8);
            const infoHeaderRead = await file.read(infoHeader, 0, infoHeader.length, infoPosition);
            if (infoHeaderRead.bytesRead < infoHeader.length) {
              break;
            }

            const infoId = infoHeader.toString('ascii', 0, 4);
            const infoSize = infoHeader.readUInt32LE(4);
            const resolvedInfoSize = resolveChunkSize(infoId, infoSize, ds64ChunkSizes);
            if (resolvedInfoSize === null || resolvedInfoSize < 0) {
              break;
            }
            const infoDataPosition = infoPosition + 8;

            if (waveInfoTagIds.has(infoId) && infoDataPosition + resolvedInfoSize <= fileSize) {
              const value = Buffer.alloc(resolvedInfoSize);
              const valueRead = await file.read(value, 0, value.length, infoDataPosition);
              if (valueRead.bytesRead === value.length) {
                const decoded = decodeWaveInfoText(value);
                if (decoded) {
                  tags[infoId as keyof WaveInfoTags] = decoded;
                }
              }
            }

            infoPosition += 8 + resolvedInfoSize + (resolvedInfoSize % 2);
          }
        }
      }

      position += 8 + resolvedChunkSize + (resolvedChunkSize % 2);
    }

    return tags;
  } finally {
    await file.close();
  }
};

const stripFilenameSortPrefix = (value: string): string => {
  const trimmed = value.trim();
  const stripped = trimmed
    .replace(/^\d{1,3}\s*[.)．。]\s*/u, '')
    .replace(/^\d{1,3}\s*[-_]\s*(?=[^\d\s([（])/u, '')
    .trim();

  return stripped || trimmed;
};

const isLikelyTrackNumberArtist = (value: string): boolean => {
  const normalized = value.normalize('NFKC').trim();
  return /^\d{1,2}$/u.test(normalized) || /^0+\d*$/u.test(normalized);
};

const filenameArtistFallback = (value: string): string | null => {
  const stripped = stripFilenameSortPrefix(value);
  return stripped && !isLikelyTrackNumberArtist(stripped) ? stripped : null;
};

const guessFromFilename = (filePath: string): { artist: string | null; title: string } => {
  const name = basename(filePath, extname(filePath)).trim();
  const parts = name.split(' - ').map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 2) {
    return {
      artist: filenameArtistFallback(parts[0]),
      title: stripFilenameSortPrefix(parts.slice(1).join(' - ')),
    };
  }

  return {
    artist: null,
    title: stripFilenameSortPrefix(name) || 'Untitled',
  };
};

const folderAlbumFallback = (filePath: string): string | null => {
  const folderName = basename(dirname(filePath)).trim();
  return folderName.length > 0 ? folderName : null;
};

const codecFallback = (filePath: string, embeddedCodec: string | undefined): string | null => {
  const codec = cleanText(embeddedCodec);
  if (codec) {
    return codec;
  }

  const extension = extname(filePath).replace('.', '').toUpperCase();
  return extension.length > 0 ? extension : null;
};

const numberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

const positiveFloatOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const signedFloatOrNull = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const match = value.trim().match(/[+-]?\d+(?:\.\d+)?/u);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const replayGainPeakOrNull = (value: unknown): number | null => {
  const parsed = signedFloatOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const r128GainToDb = (value: unknown): number | null => {
  const parsed = signedFloatOrNull(value);
  return parsed === null ? null : parsed / 256;
};

const yearFromMetadata = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  if (typeof value === 'string') {
    const match = value.match(/\b(19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
  }

  return null;
};

const firstText = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    return cleanText(value.find((item) => cleanText(item)));
  }

  return cleanText(value);
};

const firstNumber = (value: unknown): number | null => {
  const parseOne = (item: unknown): number | null => {
    const parsed = numberOrNull(item);
    if (parsed !== null) {
      return parsed;
    }

    if (typeof item === 'string') {
      const match = item.match(/^\s*(\d+)/u);
      return match ? numberOrNull(match[1]) : null;
    }

    return null;
  };

  if (Array.isArray(value)) {
    return parseOne(value.find((item) => parseOne(item) !== null));
  }

  return parseOne(value);
};

const tagValue = (tags: Record<string, unknown>, keys: string[]): unknown => {
  const normalizedEntries = Object.entries(tags).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value] as const);

  for (const key of keys) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const directValue = tags[key];
    if (directValue !== undefined) {
      return directValue;
    }

    const match = normalizedEntries.find(([entryKey]) => entryKey === normalizedKey);
    if (match) {
      return match[1];
    }
  }

  return undefined;
};

const nativeValues = (metadata: IAudioMetadata, keys: string[]): unknown[] => {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const values: unknown[] = [];

  for (const entries of Object.values(metadata.native ?? {})) {
    for (const entry of entries) {
      const id = typeof entry.id === 'string' ? entry.id.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
      if (normalizedKeys.has(id)) {
        values.push(entry.value);
      }
    }
  }

  return values;
};

const firstNativeText = (metadata: IAudioMetadata, keys: string[]): string | null =>
  firstText(nativeValues(metadata, keys));

const isAsfMetadataFile = (filePath: string): boolean =>
  asfMetadataExtensions.has(extname(filePath).toLowerCase());

const cleanPictureMimeType = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed && trimmed.length <= 128 && countHardControlCharacters(trimmed) === 0 ? trimmed : null;
};

const embeddedCoverFromPicture = (
  picture: unknown,
  normalizeMimeType: (value: unknown) => string | null = cleanText,
): EmbeddedCoverData | undefined => {
  if (!picture || typeof picture !== 'object') {
    return undefined;
  }

  const candidate = picture as { data?: unknown; format?: unknown };
  if (!(candidate.data instanceof Uint8Array) || candidate.data.byteLength === 0) {
    return undefined;
  }

  return {
    data: candidate.data,
    mimeType: normalizeMimeType(candidate.format),
  };
};

const firstAsfNativePicture = (filePath: string, metadata: IAudioMetadata): EmbeddedCoverData | undefined => {
  if (!isAsfMetadataFile(filePath)) {
    return undefined;
  }

  for (const value of nativeValues(metadata, ['WM/Picture'])) {
    const picture = embeddedCoverFromPicture(value, cleanPictureMimeType);
    if (picture) {
      return picture;
    }
  }

  return undefined;
};

const preferHigherQualityText = (primary: string | null, candidate: string | null): string | null => {
  if (!candidate) {
    return primary;
  }

  if (!primary) {
    return candidate;
  }

  return textQualityScore(candidate) >= textQualityScore(primary) + 4 ? candidate : primary;
};

const shouldUseTagLibTextQualityFallback = (
  filePath: string,
  currentSource: FieldSource | undefined,
  currentValue: unknown,
  candidateValue: unknown,
): candidateValue is string => {
  if (!tagLibTextQualityFallbackExtensions.has(extname(filePath).toLowerCase()) || currentSource !== 'embedded') {
    return false;
  }

  if (typeof currentValue !== 'string' || typeof candidateValue !== 'string') {
    return false;
  }

  const currentText = cleanText(currentValue);
  const candidateText = cleanText(candidateValue);
  if (!candidateText || isSuspiciousMetadataText(candidateText)) {
    return false;
  }

  const currentScore = currentText ? textQualityScore(currentText) : textQualityScore(currentValue);
  const candidateScore = textQualityScore(candidateText);
  return (!currentText || isSuspiciousMetadataText(currentText)) && candidateScore >= currentScore + 4;
};

const firstNativeNumber = (metadata: IAudioMetadata, keys: string[]): number | null => {
  for (const value of nativeValues(metadata, keys)) {
    const parsed = firstNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const firstNativeYear = (metadata: IAudioMetadata, keys: string[]): number | null => {
  for (const value of nativeValues(metadata, keys)) {
    const parsed = yearFromMetadata(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const warningMessage = (prefix: string, error: unknown): string =>
  `${prefix}: ${error instanceof Error ? error.message : String(error)}`;

const hasTagLibFieldData = (metadata: TagLibFallbackMetadata): boolean =>
  Object.values(metadata.fields).some((value) => value !== null && value !== undefined && value !== '') || Boolean(metadata.embeddedCover);

const normalizeTagLibBitrate = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed * 1000);
};

const estimateBitrateFromFileSize = async (filePath: string, durationSeconds: number | null): Promise<number | null> => {
  if (!durationSeconds || durationSeconds <= 0) {
    return null;
  }

  try {
    const fileStats = await stat(filePath);
    const bitrate = Math.round((fileStats.size * 8) / durationSeconds);
    return Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null;
  } catch {
    return null;
  }
};

const resolveTagLibBitrate = async (
  filePath: string,
  durationSeconds: number | null,
  tagLibBitrate: number | null,
): Promise<number | null> => {
  if (!containerBitrateFallbackExtensions.has(extname(filePath).toLowerCase())) {
    return tagLibBitrate;
  }

  const estimatedBitrate = await estimateBitrateFromFileSize(filePath, durationSeconds);
  if (!estimatedBitrate) {
    return tagLibBitrate;
  }

  if (!tagLibBitrate || tagLibBitrate < suspiciouslyLowLosslessBitrate) {
    return estimatedBitrate;
  }

  return tagLibBitrate;
};

const normalizeTagLibCodec = (properties: Record<string, unknown> | undefined): string | null => {
  const codec = cleanText(properties?.codec);
  if (codec && codec.toLowerCase() !== 'unknown') {
    return codec;
  }

  const container = cleanText(properties?.containerFormat);
  return container && container.toLowerCase() !== 'unknown' ? container : null;
};

export const readTagLibFallbackMetadata = async (filePath: string): Promise<TagLibFallbackMetadata> => {
  const warnings: string[] = [];

  try {
    const taglib = await import('taglib-wasm');
    const metadata = await taglib.readMetadata(filePath);
    const tags = (metadata.tags ?? {}) as Record<string, unknown>;
    const properties = (metadata.properties ?? {}) as Record<string, unknown> | undefined;
    const skipTagMetadata = hasUnsafeTagMapTextMetadata(tags);
    const duration = positiveFloatOrNull(properties?.duration);
    const bitrate = await resolveTagLibBitrate(filePath, duration, normalizeTagLibBitrate(properties?.bitrate));
    let embeddedCover: EmbeddedCoverData | undefined;

    if (skipTagMetadata) {
      warnings.push(unsafeEmbeddedMetadataWarning);
    }

    if (metadata.hasCoverArt) {
      try {
        const pictures = await taglib.readPictures(filePath);
        const picture = pictures.find((item) => item.type === 'FrontCover') ?? pictures[0];
        if (picture?.data?.byteLength) {
          embeddedCover = {
            data: picture.data,
            mimeType: cleanText(picture.mimeType),
          };
        }
      } catch (error) {
        warnings.push(warningMessage('taglib_cover_unavailable', error));
      }
    }

    return {
      fields: {
        title: skipTagMetadata ? null : firstText(tagValue(tags, ['title'])),
        artist: skipTagMetadata ? null : firstText(tagValue(tags, ['artist', 'artists'])),
        album: skipTagMetadata ? null : firstText(tagValue(tags, ['album'])),
        albumArtist: skipTagMetadata ? null : firstText(tagValue(tags, ['albumArtist', 'albumartist', 'album_artist'])),
        trackNo: skipTagMetadata ? null : firstNumber(tagValue(tags, ['track', 'trackNumber', 'tracknumber'])),
        discNo: skipTagMetadata ? null : firstNumber(tagValue(tags, ['discNumber', 'discnumber', 'disc', 'disk'])),
        year: skipTagMetadata ? null : yearFromMetadata(tagValue(tags, ['year', 'date', 'originalDate', 'originaldate'])),
        genre: skipTagMetadata ? null : firstText(tagValue(tags, ['genre'])),
        duration,
        codec: normalizeTagLibCodec(properties),
        sampleRate: numberOrNull(properties?.sampleRate),
        bitDepth: numberOrNull(properties?.bitsPerSample),
        bitrate,
        bpm: skipTagMetadata ? null : positiveFloatOrNull(tagValue(tags, ['bpm'])),
        replayGainTrackGainDb:
          skipTagMetadata
            ? null
            : signedFloatOrNull(tagValue(tags, ['replaygain_track_gain', 'REPLAYGAIN_TRACK_GAIN'])) ??
              r128GainToDb(tagValue(tags, ['r128_track_gain', 'R128_TRACK_GAIN'])),
        replayGainAlbumGainDb:
          skipTagMetadata
            ? null
            : signedFloatOrNull(tagValue(tags, ['replaygain_album_gain', 'REPLAYGAIN_ALBUM_GAIN'])) ??
              r128GainToDb(tagValue(tags, ['r128_album_gain', 'R128_ALBUM_GAIN'])),
        replayGainTrackPeak: skipTagMetadata ? null : replayGainPeakOrNull(tagValue(tags, ['replaygain_track_peak', 'REPLAYGAIN_TRACK_PEAK'])),
        replayGainAlbumPeak: skipTagMetadata ? null : replayGainPeakOrNull(tagValue(tags, ['replaygain_album_peak', 'REPLAYGAIN_ALBUM_PEAK'])),
        replayGainIntegratedLufs: skipTagMetadata ? null : signedFloatOrNull(tagValue(tags, ['integrated_lufs', 'replaygain_integrated_lufs', 'ebu_r128_integrated_lufs'])),
      },
      embeddedCover,
      warnings,
    };
  } catch (error) {
    return {
      fields: {},
      warnings: [warningMessage('taglib_metadata_unavailable', error)],
    };
  }
};

const fallbackFields = (filePath: string): MetadataResult => {
  const filenameGuess = guessFromFilename(filePath);
  const folderAlbum = folderAlbumFallback(filePath);
  const artist = filenameGuess.artist ?? unknownArtist;
  const album = folderAlbum ?? unknownAlbum;
  const codec = codecFallback(filePath, undefined);

  return {
    fields: {
      title: filenameGuess.title,
      artist,
      album,
      albumArtist: artist,
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      duration: 0,
      codec,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
      bpm: null,
      replayGainTrackGainDb: null,
      replayGainAlbumGainDb: null,
      replayGainTrackPeak: null,
      replayGainAlbumPeak: null,
      replayGainIntegratedLufs: null,
    },
    fieldSources: {
      title: 'filename_fallback',
      artist: filenameGuess.artist ? 'filename_fallback' : 'unknown',
      album: folderAlbum ? 'folder_structure' : 'unknown',
      albumArtist: filenameGuess.artist ? 'artist_fallback' : 'unknown',
      trackNo: 'unknown',
      discNo: 'unknown',
      year: 'unknown',
      genre: 'unknown',
      duration: 'unknown',
      codec: codec ? 'filename_fallback' : 'unknown',
      sampleRate: 'unknown',
      bitDepth: 'unknown',
      bitrate: 'unknown',
      bpm: 'unknown',
    },
    embeddedMetadataStatus: 'missing',
    embeddedCoverStatus: 'missing',
    warnings: [],
    errors: [],
    status: 'fallback',
  };
};

export class TsMetadataReader implements MetadataReader {
  async read(filePath: string): Promise<MetadataResult> {
    const cueTrack = resolveCueTrack(filePath);
    const metadataPath = cueTrack?.audioPath ?? filePath;

    try {
      const metadata = await parseFile(metadataPath, {
        duration: true,
        skipCovers: false,
      });

      if (!cueTrack) {
        const waveInfoTags = await readWaveInfoTags(filePath).catch(() => ({}));
        return this.normalizeWithFallback(filePath, metadataPath, metadata, waveInfoTags);
      }

      const waveInfoTags = await readWaveInfoTags(metadataPath).catch(() => ({}));
      const normalized = await this.normalizeWithFallback(metadataPath, metadataPath, metadata, waveInfoTags);
      const sourceDuration = normalized.fields.duration;
      const cueEndSeconds = cueTrack.endSeconds ?? (sourceDuration > 0 ? sourceDuration : null);
      const duration = cueEndSeconds !== null ? Math.max(0, cueEndSeconds - cueTrack.startSeconds) : 0;
      const title = cueTrack.title ?? normalized.fields.title;
      const artist = cueTrack.performer ?? cueTrack.albumArtist ?? normalized.fields.artist;
      const album = cueTrack.album ?? normalized.fields.album;
      const albumArtist = cueTrack.albumArtist ?? artist;
      const cueFieldSource = cueTrack.source === 'embedded' ? 'embedded' : 'sidecar';

      return {
        ...normalized,
        fields: {
          ...normalized.fields,
          title,
          artist,
          album,
          albumArtist,
          trackNo: cueTrack.trackNumber,
          duration,
          codec: normalized.fields.codec ? `CUE/${normalized.fields.codec}` : 'CUE',
        },
        fieldSources: {
          ...normalized.fieldSources,
          title: cueTrack.title ? cueFieldSource : normalized.fieldSources.title,
          artist: cueTrack.performer || cueTrack.albumArtist ? cueFieldSource : normalized.fieldSources.artist,
          album: cueTrack.album ? cueFieldSource : normalized.fieldSources.album,
          albumArtist: cueTrack.albumArtist ? cueFieldSource : normalized.fieldSources.albumArtist,
          trackNo: cueFieldSource,
          duration: cueFieldSource,
          codec: normalized.fieldSources.codec ?? 'technical',
        },
        embeddedMetadataStatus: 'present',
        warnings: normalized.warnings,
        errors: normalized.errors,
        status: normalized.status,
      };
    } catch (error) {
      if (cueTrack) {
        const cueFieldSource = cueTrack.source === 'embedded' ? 'embedded' : 'sidecar';
        return {
          fields: {
            title: cueTrack.title ?? `Track ${cueTrack.trackNumber}`,
            artist: cueTrack.performer ?? cueTrack.albumArtist ?? unknownArtist,
            album: cueTrack.album ?? folderAlbumFallback(cueTrack.cuePath) ?? unknownAlbum,
            albumArtist: cueTrack.albumArtist ?? cueTrack.performer ?? unknownArtist,
            trackNo: cueTrack.trackNumber,
            discNo: null,
            year: null,
            genre: null,
            duration: cueTrack.endSeconds !== null ? Math.max(0, cueTrack.endSeconds - cueTrack.startSeconds) : 0,
            codec: 'CUE',
            sampleRate: null,
            bitDepth: null,
            bitrate: null,
            bpm: null,
            replayGainTrackGainDb: null,
            replayGainAlbumGainDb: null,
            replayGainTrackPeak: null,
            replayGainAlbumPeak: null,
            replayGainIntegratedLufs: null,
          },
          fieldSources: {
            title: cueTrack.title ? cueFieldSource : 'filename_fallback',
            artist: cueTrack.performer || cueTrack.albumArtist ? cueFieldSource : 'unknown',
            album: cueTrack.album ? cueFieldSource : 'folder_structure',
            albumArtist: cueTrack.albumArtist || cueTrack.performer ? cueFieldSource : 'unknown',
            trackNo: cueFieldSource,
            discNo: 'unknown',
            year: 'unknown',
            genre: 'unknown',
            duration: cueTrack.endSeconds !== null ? cueFieldSource : 'unknown',
            codec: cueFieldSource,
            sampleRate: 'unknown',
            bitDepth: 'unknown',
            bitrate: 'unknown',
            bpm: 'unknown',
          },
          embeddedMetadataStatus: 'present',
          embeddedCoverStatus: 'missing',
          warnings: [],
          errors: [error instanceof Error ? error.message : String(error)],
          status: 'fallback',
        };
      }

      const result = fallbackFields(filePath);
      const tagLibMetadata = await readTagLibFallbackMetadata(filePath);
      const merged = await this.applyMp4AudioCodecCorrection(
        this.applyTagLibFallback(result, tagLibMetadata, filePath),
        filePath,
      );
      const recovered = hasTagLibFieldData(tagLibMetadata);

      return {
        ...merged,
        status: recovered ? 'ok' : 'error',
        warnings: [...merged.warnings, warningMessage('music_metadata_unavailable', error)],
        errors: recovered ? [] : [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private async normalizeWithFallback(
    filePath: string,
    metadataPath: string,
    metadata: IAudioMetadata,
    waveInfoTags: WaveInfoTags = {},
  ): Promise<MetadataResult> {
    const normalized = this.normalize(filePath, metadata, waveInfoTags);

    if (!this.shouldReadTagLibFallback(metadataPath, normalized)) {
      return this.applyMp4AudioCodecCorrection(normalized, metadataPath);
    }

    return this.applyMp4AudioCodecCorrection(
      this.applyTagLibFallback(normalized, await readTagLibFallbackMetadata(metadataPath), metadataPath),
      metadataPath,
    );
  }

  private shouldReadTagLibFallback(filePath: string, result: MetadataResult): boolean {
    if (result.warnings.includes(unsafeEmbeddedMetadataWarning)) {
      return false;
    }

    if (tagLibPreferredExtensions.has(extname(filePath).toLowerCase())) {
      return true;
    }

    const missingCoreMetadata = tagLibCoreFallbackFields.some((field) =>
      replaceableMetadataSources.has(result.fieldSources[field] ?? 'unknown'),
    );
    const missingTechnicalMetadata = tagLibTechnicalFallbackFields.some((field) =>
      replaceableTechnicalSources.has(result.fieldSources[field] ?? 'unknown'),
    );

    return missingCoreMetadata || missingTechnicalMetadata;
  }

  private applyTagLibFallback(result: MetadataResult, tagLibMetadata: TagLibFallbackMetadata, filePath: string): MetadataResult {
    const fields: MetadataFields = { ...result.fields };
    const fieldSources: FieldSources = { ...result.fieldSources };
    let embeddedMetadataStatus = result.embeddedMetadataStatus;
    const preferTagLibAlacTechnicalFields = shouldPreferTagLibForAlacTechnicalFields(
      filePath,
      fields.codec,
      tagLibMetadata.fields.codec,
    );

    const applyEmbedded = <Key extends keyof MetadataFields>(field: Key, value: MetadataFields[Key] | null | undefined): void => {
      if (value === null || value === undefined || value === '') {
        return;
      }

      if (!replaceableMetadataSources.has(fieldSources[field] ?? 'unknown')) {
        if (
          isTextMetadataField(field) &&
          shouldUseTagLibTextQualityFallback(filePath, fieldSources[field], fields[field], value)
        ) {
          fields[field] = value;
          fieldSources[field] = 'embedded';
          embeddedMetadataStatus = 'present';
        }
        return;
      }

      fields[field] = value;
      fieldSources[field] = 'embedded';
      embeddedMetadataStatus = 'present';
    };

    const applyTechnical = <Key extends keyof MetadataFields>(field: Key, value: MetadataFields[Key] | null | undefined): void => {
      if (value === null || value === undefined || value === '') {
        return;
      }

      const canOverride =
        preferTagLibAlacTechnicalFields &&
        (field === 'codec' || field === 'sampleRate' || field === 'bitDepth' || field === 'bitrate');
      if (!canOverride && !replaceableTechnicalSources.has(fieldSources[field] ?? 'unknown')) {
        return;
      }

      fields[field] = value;
      fieldSources[field] = 'technical';
    };

    applyEmbedded('title', tagLibMetadata.fields.title);
    applyEmbedded('artist', tagLibMetadata.fields.artist);
    applyEmbedded('album', tagLibMetadata.fields.album);
    applyEmbedded('albumArtist', tagLibMetadata.fields.albumArtist);
    applyEmbedded('trackNo', tagLibMetadata.fields.trackNo);
    applyEmbedded('discNo', tagLibMetadata.fields.discNo);
    applyEmbedded('year', tagLibMetadata.fields.year);
    applyEmbedded('genre', tagLibMetadata.fields.genre);
    applyEmbedded('bpm', tagLibMetadata.fields.bpm);
    applyEmbedded('replayGainTrackGainDb', tagLibMetadata.fields.replayGainTrackGainDb);
    applyEmbedded('replayGainAlbumGainDb', tagLibMetadata.fields.replayGainAlbumGainDb);
    applyEmbedded('replayGainTrackPeak', tagLibMetadata.fields.replayGainTrackPeak);
    applyEmbedded('replayGainAlbumPeak', tagLibMetadata.fields.replayGainAlbumPeak);
    applyEmbedded('replayGainIntegratedLufs', tagLibMetadata.fields.replayGainIntegratedLufs);
    applyTechnical('duration', tagLibMetadata.fields.duration);
    applyTechnical('codec', tagLibMetadata.fields.codec);
    applyTechnical('sampleRate', tagLibMetadata.fields.sampleRate);
    applyTechnical('bitDepth', tagLibMetadata.fields.bitDepth);
    applyTechnical('bitrate', tagLibMetadata.fields.bitrate);

    const embeddedCover = result.embeddedCover ?? tagLibMetadata.embeddedCover;

    return {
      ...result,
      fields,
      fieldSources,
      embeddedCover,
      embeddedMetadataStatus,
      embeddedCoverStatus: embeddedCover ? 'present' : result.embeddedCoverStatus,
      warnings: [...result.warnings, ...tagLibMetadata.warnings],
    };
  }

  private async applyMp4AudioCodecCorrection(result: MetadataResult, filePath: string): Promise<MetadataResult> {
    const codec = await resolveMp4ContainerAudioCodec(filePath, result.fields.codec);
    if (!codec || codec === result.fields.codec) {
      return result;
    }

    return {
      ...result,
      fields: {
        ...result.fields,
        codec,
      },
      fieldSources: {
        ...result.fieldSources,
        codec: 'technical',
      },
    };
  }

  normalize(filePath: string, metadata: IAudioMetadata, waveInfoTags: WaveInfoTags = {}): MetadataResult {
    const common = metadata.common;
    const format = metadata.format;
    const filenameGuess = guessFromFilename(filePath);
    const fieldSources: FieldSources = {};
    const skipEmbeddedMetadata = hasUnsafeEmbeddedTextMetadata(metadata);

    // Fixed priority: manual > embedded > sidecar/info > folder inference > network completion > filename fallback.
    // Phase v0.1 implements embedded tags, folder album fallback, and filename fallback; source names stay stable
    // so a future Rust/C++ reader can return the same shape without changing SQLite, IPC, or renderer code.
    const pickText = (field: string, embeddedValue: string | null, fallbackValue: string, fallbackSource: FieldSource) => {
      if (embeddedValue) {
        fieldSources[field] = 'embedded';
        return embeddedValue;
      }

      fieldSources[field] = fallbackSource;
      return fallbackValue;
    };

    const pickNumber = (field: string, value: number | null): number | null => {
      fieldSources[field] = value !== null ? 'embedded' : 'unknown';
      return value;
    };

    const commonTitle = skipEmbeddedMetadata ? null : cleanText(common.title);
    const commonArtist = skipEmbeddedMetadata ? null : (cleanText(common.artist) ?? cleanTextList(common.artists));
    const commonAlbum = skipEmbeddedMetadata ? null : cleanText(common.album);
    const embeddedTitle = skipEmbeddedMetadata
      ? null
      : (preferHigherQualityText(commonTitle, cleanText(waveInfoTags.INAM)) ?? firstNativeText(metadata, ['TITLE', 'TIT2']) ?? cleanText(waveInfoTags.BEXT_DESCRIPTION));
    const embeddedArtist = skipEmbeddedMetadata
      ? null
      : (preferHigherQualityText(commonArtist, cleanText(waveInfoTags.IART)) ?? firstNativeText(metadata, ['ARTIST', 'TPE1']) ?? cleanText(waveInfoTags.BEXT_ORIGINATOR));
    const embeddedAlbum = skipEmbeddedMetadata
      ? null
      : (preferHigherQualityText(commonAlbum, cleanText(waveInfoTags.IPRD)) ?? firstNativeText(metadata, ['ALBUM', 'TALB']));
    const embeddedAlbumArtist = skipEmbeddedMetadata
      ? null
      : (cleanTextList(common.albumartist) ?? firstNativeText(metadata, ['ALBUMARTIST', 'ALBUM ARTIST', 'ALBUM_ARTIST', 'TPE2']));
    const embeddedGenre = skipEmbeddedMetadata
      ? null
      : (cleanTextList(common.genre) ?? cleanText(waveInfoTags.IGNR) ?? firstNativeText(metadata, ['GENRE', 'TCON']));
    const embeddedTrackNo = skipEmbeddedMetadata
      ? null
      : (numberOrNull(common.track?.no) ?? numberOrNull(waveInfoTags.ITRK) ?? firstNativeNumber(metadata, ['TRACKNUMBER', 'TRACK', 'TRCK']));
    const embeddedYear = skipEmbeddedMetadata ? null : (yearFromMetadata(common.year ?? common.date) ?? yearFromMetadata(waveInfoTags.ICRD) ?? yearFromMetadata(waveInfoTags.BEXT_ORIGINATION_DATE));
    const folderAlbum = folderAlbumFallback(filePath);

    const title = pickText('title', embeddedTitle, filenameGuess.title, 'filename_fallback');
    const artist = pickText('artist', embeddedArtist, filenameGuess.artist ?? unknownArtist, filenameGuess.artist ? 'filename_fallback' : 'unknown');
    const album = pickText('album', embeddedAlbum, folderAlbum ?? unknownAlbum, folderAlbum ? 'folder_structure' : 'unknown');
    const albumArtist = pickText('albumArtist', embeddedAlbumArtist, artist, 'artist_fallback');
    const trackNo = pickNumber('trackNo', embeddedTrackNo);
    const discNo = pickNumber('discNo', skipEmbeddedMetadata ? null : (numberOrNull(common.disk?.no) ?? firstNativeNumber(metadata, ['DISCNUMBER', 'DISKNUMBER', 'DISC', 'DISK', 'TPOS'])));
    const year = pickNumber('year', skipEmbeddedMetadata ? null : (embeddedYear ?? firstNativeYear(metadata, ['DATE', 'YEAR', 'ORIGINALDATE', 'ORIGINALYEAR', 'TDRC'])));
    const genre = embeddedGenre;
    fieldSources.genre = genre ? 'embedded' : 'unknown';
    const duration = Math.max(0, Number(format.duration ?? 0));
    fieldSources.duration = duration > 0 ? 'technical' : 'unknown';
    const codec = codecFallback(filePath, format.codec);
    fieldSources.codec = codec ? (format.codec ? 'technical' : 'filename_fallback') : 'unknown';
    const sampleRate = typeof format.sampleRate === 'number' ? format.sampleRate : null;
    fieldSources.sampleRate = sampleRate ? 'technical' : 'unknown';
    const bitDepth = typeof format.bitsPerSample === 'number' ? format.bitsPerSample : null;
    fieldSources.bitDepth = bitDepth ? 'technical' : 'unknown';
    const bitrate = typeof format.bitrate === 'number' ? Math.round(format.bitrate) : null;
    fieldSources.bitrate = bitrate ? 'technical' : 'unknown';
    const bpm = skipEmbeddedMetadata ? null : (positiveFloatOrNull(common.bpm) ?? firstNativeNumber(metadata, ['BPM', 'TBPM']));
    fieldSources.bpm = bpm ? 'embedded' : 'unknown';
    const replayGainTrackGainDb =
      skipEmbeddedMetadata
        ? null
        : signedFloatOrNull(firstNativeText(metadata, ['REPLAYGAIN_TRACK_GAIN', 'REPLAYGAIN_TRACKGAIN', 'TXXX:REPLAYGAIN_TRACK_GAIN'])) ??
          r128GainToDb(firstNativeText(metadata, ['R128_TRACK_GAIN']));
    const replayGainAlbumGainDb =
      skipEmbeddedMetadata
        ? null
        : signedFloatOrNull(firstNativeText(metadata, ['REPLAYGAIN_ALBUM_GAIN', 'REPLAYGAIN_ALBUMGAIN', 'TXXX:REPLAYGAIN_ALBUM_GAIN'])) ??
          r128GainToDb(firstNativeText(metadata, ['R128_ALBUM_GAIN']));
    const replayGainTrackPeak = skipEmbeddedMetadata ? null : replayGainPeakOrNull(firstNativeText(metadata, ['REPLAYGAIN_TRACK_PEAK', 'REPLAYGAIN_TRACKPEAK']));
    const replayGainAlbumPeak = skipEmbeddedMetadata ? null : replayGainPeakOrNull(firstNativeText(metadata, ['REPLAYGAIN_ALBUM_PEAK', 'REPLAYGAIN_ALBUMPEAK']));
    const replayGainIntegratedLufs = skipEmbeddedMetadata ? null : signedFloatOrNull(firstNativeText(metadata, ['REPLAYGAIN_INTEGRATED_LUFS', 'EBU_R128_INTEGRATED_LUFS', 'INTEGRATED_LUFS']));
    fieldSources.replayGainTrackGainDb = replayGainTrackGainDb !== null ? 'embedded' : 'unknown';
    fieldSources.replayGainAlbumGainDb = replayGainAlbumGainDb !== null ? 'embedded' : 'unknown';
    fieldSources.replayGainTrackPeak = replayGainTrackPeak !== null ? 'embedded' : 'unknown';
    fieldSources.replayGainAlbumPeak = replayGainAlbumPeak !== null ? 'embedded' : 'unknown';
    fieldSources.replayGainIntegratedLufs = replayGainIntegratedLufs !== null ? 'embedded' : 'unknown';
    const picture = skipEmbeddedMetadata
      ? undefined
      : (embeddedCoverFromPicture(common.picture?.[0]) ?? firstAsfNativePicture(filePath, metadata));
    const hasEmbeddedMetadata = [
      embeddedTitle,
      embeddedArtist,
      embeddedAlbum,
      embeddedAlbumArtist,
      embeddedGenre,
      trackNo,
      discNo,
      year,
    ].some((value) => value !== null && value !== undefined && value !== '');

    const fields: MetadataFields = {
      title,
      artist,
      album,
      albumArtist,
      trackNo,
      discNo,
      year,
      genre,
      duration,
      codec,
      sampleRate,
      bitDepth,
      bitrate,
      bpm,
      replayGainTrackGainDb,
      replayGainAlbumGainDb,
      replayGainTrackPeak,
      replayGainAlbumPeak,
      replayGainIntegratedLufs,
    };

    return {
      fields,
      fieldSources,
      embeddedCover: picture,
      embeddedMetadataStatus: hasEmbeddedMetadata ? 'present' : 'missing',
      embeddedCoverStatus: picture ? 'present' : 'missing',
      warnings: skipEmbeddedMetadata ? [unsafeEmbeddedMetadataWarning] : [],
      errors: [],
      status: 'ok',
    };
  }
}
