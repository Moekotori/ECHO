import { inflateSync } from 'node:zlib';
import { parseAssLyrics, parseSubtitleLyrics } from './subtitleLyrics';
import { parseLegacyTimedLyrics } from './legacyTimedLyrics';
import type { LyricLine, LyricWordTiming } from '../../shared/types/lyrics';
import { parseKrcEmbeddedSecondaryTracks } from './krcEmbeddedLyrics';
import type { LyricsParseLimits } from '../../shared/lyrics/localLyricsFormats';
type ExtendedLyricsParseLimits = LyricsParseLimits;

const krcHeader = new Uint8Array([0x6b, 0x72, 0x63, 0x31]);
const krcXorKey = new Uint8Array([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47,
  0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
]);
const qrcLinePattern = /^\s*\[(\d+),(\d+)\](.*)$/u;
const qrcWordPattern = /\((\d+),(\d+)(?:,\d+)?\)/gu;
const qrcWordDetectionPattern = /\(\d+,\d+(?:,\d+)?\)/u;
const krcLinePattern = /^\s*\[(\d+),(\d+)\](.*)$/u;
const krcWordPattern = /<(\d+),(\d+)(?:,\d+)?>/gu;

const startsWithBytes = (value: Uint8Array, prefix: Uint8Array): boolean =>
  value.length >= prefix.length && prefix.every((byte, index) => value[index] === byte);

export const decodeKrcFileBytes = (bytes: Uint8Array, maxOutputBytes: number): Uint8Array | null => {
  if (!startsWithBytes(bytes, krcHeader)) {
    return bytes;
  }

  if (bytes.length <= krcHeader.length || maxOutputBytes <= 0) {
    return null;
  }

  try {
    const encrypted = bytes.subarray(krcHeader.length);
    const compressed = new Uint8Array(encrypted.length);
    for (let index = 0; index < encrypted.length; index += 1) {
      compressed[index] = encrypted[index] ^ krcXorKey[index % krcXorKey.length];
    }

    const inflated = inflateSync(compressed, { maxOutputLength: maxOutputBytes });
    return inflated.length <= maxOutputBytes ? inflated : null;
  } catch {
    return null;
  }
};

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : '';
    })
    .replace(/&#(\d+);/gu, (_match, code: string) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : '';
    })
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&amp;/giu, '&');

const cleanTimedText = (value: string): string =>
  decodeXmlEntities(value)
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<[^>]+>/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

const cleanTimedSegmentText = (value: string): string =>
  decodeXmlEntities(value)
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<[^>]+>/gu, '')
    .replace(/\s+/gu, ' ');

const validLineText = (value: string, limits: ExtendedLyricsParseLimits): boolean =>
  value.length > 0 && value.length <= limits.maxLineTextChars;

const normalizeWords = (
  segments: Array<{ text: string; startMs: number; endMs: number }>,
  limits: ExtendedLyricsParseLimits,
): LyricWordTiming[] | undefined => {
  const words = segments
    .map((segment) => ({ ...segment, text: cleanTimedSegmentText(segment.text) }))
    .filter(
      (segment) =>
        validLineText(segment.text.trim(), limits) &&
        segment.text.length <= limits.maxLineTextChars &&
        segment.startMs >= 0 &&
        segment.endMs > segment.startMs,
    )
    .slice(0, limits.maxWordsPerLine);

  return words.length >= 2 ? words : undefined;
};

const extractQrcLyricsText = (value: string): string => {
  const attribute = value.match(/\bLyricContent\s*=\s*(["'])([\s\S]*?)\1/iu)?.[2];
  return attribute === undefined ? value : decodeXmlEntities(attribute);
};

const resolveQrcWordStartMs = (
  rawStartMs: number,
  lineStartMs: number,
  lineDurationMs: number,
  allSegmentsFitRelative: boolean,
  allSegmentsFitAbsolute: boolean,
): number => (allSegmentsFitRelative && !allSegmentsFitAbsolute ? lineStartMs + rawStartMs : rawStartMs);

const parseQrcLine = (value: string, limits: ExtendedLyricsParseLimits): LyricLine | null => {
  const match = value.match(qrcLinePattern);
  if (!match) {
    return null;
  }

  const timeMs = Number(match[1]);
  const durationMs = Number(match[2]);
  const content = match[3] ?? '';
  if (!Number.isFinite(timeMs) || !Number.isFinite(durationMs) || timeMs < 0 || durationMs < 0 || content.trimStart().startsWith('(')) {
    return null;
  }

  const timingMatches = [...content.matchAll(qrcWordPattern)];
  if (timingMatches.length === 0) {
    const text = cleanTimedText(content);
    return validLineText(text, limits) ? { timeMs, text } : null;
  }

  const rawSegments: Array<{ text: string; rawStartMs: number; durationMs: number }> = [];
  let cursor = 0;
  for (const timingMatch of timingMatches) {
    if (timingMatch.index === undefined) {
      return null;
    }

    const rawStartMs = Number(timingMatch[1]);
    const wordDurationMs = Number(timingMatch[2]);
    rawSegments.push({
      text: content.slice(cursor, timingMatch.index),
      rawStartMs,
      durationMs: wordDurationMs,
    });
    cursor = timingMatch.index + timingMatch[0].length;
  }

  const trailing = cleanTimedText(content.slice(cursor));
  if (trailing && rawSegments.length > 0) {
    rawSegments[rawSegments.length - 1].text += trailing;
  }

  const toleranceMs = 50;
  const allSegmentsFitRelative = rawSegments.every(
    (segment) => segment.rawStartMs >= 0 && segment.rawStartMs + segment.durationMs <= durationMs + toleranceMs,
  );
  const allSegmentsFitAbsolute = rawSegments.every(
    (segment) =>
      segment.rawStartMs >= Math.max(0, timeMs - toleranceMs) &&
      segment.rawStartMs + segment.durationMs <= timeMs + durationMs + toleranceMs,
  );
  const segments = rawSegments.map((segment) => {
    const startMs = resolveQrcWordStartMs(
      segment.rawStartMs,
      timeMs,
      durationMs,
      allSegmentsFitRelative,
      allSegmentsFitAbsolute,
    );
    return { text: segment.text, startMs, endMs: startMs + segment.durationMs };
  });
  const text = cleanTimedText(segments.map((segment) => segment.text).join(''));
  if (!validLineText(text, limits)) {
    return null;
  }

  const words = normalizeWords(segments, limits);
  return { timeMs, text, ...(words ? { words } : {}) };
};

const parseQrcLyrics = (value: string, limits: ExtendedLyricsParseLimits): LyricLine[] => {
  const qrcText = extractQrcLyricsText(value).replace(/^\uFEFF/u, '');
  const lines: LyricLine[] = [];
  for (const rawLine of qrcText.split(/\r?\n/gu)) {
    if (lines.length >= limits.maxLines) {
      break;
    }

    const line = parseQrcLine(rawLine, limits);
    if (line) {
      lines.push(line);
    }
  }

  return lines.sort((left, right) => left.timeMs - right.timeMs);
};

const parseKrcLine = (value: string, limits: ExtendedLyricsParseLimits): LyricLine | null => {
  const match = value.match(krcLinePattern);
  if (!match) {
    return null;
  }

  const timeMs = Number(match[1]);
  const durationMs = Number(match[2]);
  const content = match[3] ?? '';
  if (!Number.isFinite(timeMs) || !Number.isFinite(durationMs) || timeMs < 0 || durationMs < 0 || !content.trimStart().startsWith('<')) {
    return null;
  }

  const timingMatches = [...content.matchAll(krcWordPattern)];
  const segments: Array<{ text: string; startMs: number; endMs: number }> = [];
  for (let index = 0; index < timingMatches.length; index += 1) {
    const timingMatch = timingMatches[index];
    if (timingMatch.index === undefined) {
      return null;
    }

    const relativeStartMs = Number(timingMatch[1]);
    const wordDurationMs = Number(timingMatch[2]);
    const textStart = timingMatch.index + timingMatch[0].length;
    const textEnd = timingMatches[index + 1]?.index ?? content.length;
    const startMs = timeMs + relativeStartMs;
    segments.push({
      text: content.slice(textStart, textEnd),
      startMs,
      endMs: startMs + wordDurationMs,
    });
  }

  const text = cleanTimedText(segments.map((segment) => segment.text).join(''));
  if (!validLineText(text, limits)) {
    return null;
  }

  const words = normalizeWords(segments, limits);
  return { timeMs, text, ...(words ? { words } : {}) };
};

const parseKrcLyrics = (value: string, limits: ExtendedLyricsParseLimits): LyricLine[] => {
  const lines: LyricLine[] = [];
  for (const rawLine of value.replace(/^\uFEFF/u, '').split(/\r?\n/gu)) {
    if (lines.length >= limits.maxLines) {
      break;
    }

    const line = parseKrcLine(rawLine, limits);
    if (line) {
      lines.push(line);
    }
  }

  const sorted = lines.sort((left, right) => left.timeMs - right.timeMs);
  const embedded = parseKrcEmbeddedSecondaryTracks(value, limits);
  return sorted.map((line, index) => ({
    ...line,
    ...(embedded.translations[index] ? { translation: embedded.translations[index] } : {}),
    ...(embedded.romanizations[index] ? { romanization: embedded.romanizations[index] } : {}),
  }));
};

const looksLikeQrc = (value: string): boolean =>
  /<QrcInfos\b/iu.test(value) || value.split(/\r?\n/gu).some((line) => {
    const match = line.match(qrcLinePattern);
    const content = match?.[3]?.trimStart() ?? '';
    return Boolean(match && content && !content.startsWith('(') && qrcWordDetectionPattern.test(content));
  });

const looksLikeKrc = (value: string): boolean =>
  value.split(/\r?\n/gu).some((line) => {
    const match = line.match(krcLinePattern);
    return Boolean(match?.[3]?.trimStart().startsWith('<'));
  });

export const parseExtendedTimedLyrics = (
  value: string,
  limits: ExtendedLyricsParseLimits,
): LyricLine[] | null => {
  const subtitles = parseAssLyrics(value, limits) ?? parseSubtitleLyrics(value, limits) ?? parseLegacyTimedLyrics(value, limits);
  if (subtitles !== null) return subtitles;
  if (looksLikeQrc(value)) {
    return parseQrcLyrics(value, limits);
  }
  if (looksLikeKrc(value)) {
    return parseKrcLyrics(value, limits);
  }
  return null;
};
