import type { LyricLine, LyricWordTiming, LyricsKind } from '../../shared/types/lyrics';

const metadataTagPattern = /^\s*\[(ar|ti|al|by|offset|length|re|ve):[^\]]*\]\s*$/i;
const timestampPattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const leadingTimestampsPattern = /^\s*(?:(?:\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\])\s*)+/;
const angleTimestampPattern = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const enhancedTimestampPattern = /<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g;
const neteaseYrcLinePattern = /^\s*\[(\d+),(\d+)\](.*)$/;
const neteaseYrcWordPattern = /\((\d+),(\d+)(?:,\d+)?\)/g;

const fractionToMs = (fraction: string | undefined): number => {
  if (!fraction) {
    return 0;
  }

  if (fraction.length === 1) {
    return Number(fraction) * 100;
  }

  if (fraction.length === 2) {
    return Number(fraction) * 10;
  }

  return Number(fraction.slice(0, 3));
};

const parseTimestamp = (match: RegExpMatchArray): number | null => {
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const milliseconds = fractionToMs(match[3]);

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) {
    return null;
  }

  return minutes * 60_000 + seconds * 1000 + milliseconds;
};

const cleanLyricText = (text: string): string =>
  text
    .replace(enhancedTimestampPattern, '')
    .replace(/\s+/g, ' ')
    .trim();

const cleanBracketTimestampedLyricText = (text: string): string => cleanLyricText(text.replace(timestampPattern, ''));
const normalizeTimedSegmentText = (text: string): string => text.replace(/\s+/g, ' ');

type TimedSegment = {
  text: string;
  startMs: number;
  endMs: number | null;
};

const normalizeWordTimings = (segments: TimedSegment[]): LyricWordTiming[] | undefined => {
  const words: LyricWordTiming[] = [];

  for (const segment of segments) {
    const text = normalizeTimedSegmentText(segment.text);
    if (!text.trim()) {
      continue;
    }

    if (!Number.isFinite(segment.startMs) || segment.startMs < 0) {
      return undefined;
    }

    if (segment.endMs !== null && (!Number.isFinite(segment.endMs) || segment.endMs <= segment.startMs)) {
      return undefined;
    }

    const previous = words[words.length - 1];
    if (previous && segment.startMs <= previous.startMs) {
      return undefined;
    }

    words.push({
      text,
      startMs: Math.round(segment.startMs),
      endMs: segment.endMs === null ? null : Math.round(segment.endMs),
    });
  }

  return words.length >= 2 ? words : undefined;
};

const normalizedTextIdentity = (value: string): string => value.replace(/\s+/g, ' ').trim();

const attachWordTimings = (
  line: Pick<LyricLine, 'text' | 'translation'>,
  words: LyricWordTiming[] | undefined,
): Pick<LyricLine, 'text' | 'translation' | 'words'> => {
  if (!words?.length) {
    return line;
  }

  const wordText = normalizedTextIdentity(words.map((word) => word.text).join(''));
  if (wordText !== normalizedTextIdentity(line.text)) {
    return line;
  }

  return { ...line, words };
};

const parseNeteaseYrcLine = (line: string): LyricLine | null => {
  const lineMatch = line.match(neteaseYrcLinePattern);
  if (!lineMatch) {
    return null;
  }

  const timeMs = Number(lineMatch[1]);
  const lineDurationMs = Number(lineMatch[2]);
  if (!Number.isFinite(timeMs) || !Number.isFinite(lineDurationMs) || timeMs < 0 || lineDurationMs < 0) {
    return null;
  }

  const content = lineMatch[3] ?? '';
  const matches = [...content.matchAll(neteaseYrcWordPattern)];
  const textOnlyLine = (): LyricLine | null => {
    const text = cleanLyricText(content.replace(neteaseYrcWordPattern, ''));
    return text ? { timeMs, ...splitInlineTranslation(text) } : null;
  };

  if (matches.length === 0) {
    return textOnlyLine();
  }

  const rawSegments: Array<{ text: string; rawStartMs: number; durationMs: number }> = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match.index === undefined) {
      return textOnlyLine();
    }

    const rawStartMs = Number(match[1]);
    const durationMs = Number(match[2]);
    if (!Number.isFinite(rawStartMs) || !Number.isFinite(durationMs) || rawStartMs < 0 || durationMs < 0) {
      return textOnlyLine();
    }

    const textStart = match.index + match[0].length;
    const textEnd = matches[index + 1]?.index ?? content.length;
    rawSegments.push({ text: content.slice(textStart, textEnd), rawStartMs, durationMs });
  }

  const text = cleanLyricText(content.replace(neteaseYrcWordPattern, ''));
  if (!text) {
    return null;
  }

  const yrcTimingToleranceMs = 50;
  const usesRelativeWordTimes =
    lineDurationMs > 0 &&
    rawSegments.every((segment) => segment.rawStartMs + segment.durationMs <= lineDurationMs + yrcTimingToleranceMs);
  const segments: TimedSegment[] = rawSegments.map((segment) => {
    const startMs = usesRelativeWordTimes
      ? timeMs + segment.rawStartMs
      : segment.rawStartMs < timeMs && timeMs - segment.rawStartMs > 1000
        ? timeMs + segment.rawStartMs
        : segment.rawStartMs;

    return {
      text: segment.text,
      startMs,
      endMs: segment.durationMs > 0 ? startMs + segment.durationMs : null,
    };
  });

  return { timeMs, ...attachWordTimings(splitInlineTranslation(text), normalizeWordTimings(segments)) };
};

const parseAngleEnhancedWordTimings = (content: string): LyricWordTiming[] | undefined => {
  const matches = [...content.matchAll(angleTimestampPattern)];
  if (matches.length < 2) {
    return undefined;
  }

  const firstIndex = matches[0].index ?? 0;
  if (content.slice(0, firstIndex).trim()) {
    return undefined;
  }

  const segments: TimedSegment[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const startMs = parseTimestamp(match);
    if (startMs === null || match.index === undefined) {
      return undefined;
    }

    const textStart = match.index + match[0].length;
    const textEnd = matches[index + 1]?.index ?? content.length;
    const endMs = matches[index + 1] ? parseTimestamp(matches[index + 1]) : null;
    if (endMs === null && matches[index + 1]) {
      return undefined;
    }

    segments.push({
      text: content.slice(textStart, textEnd),
      startMs,
      endMs,
    });
  }

  return normalizeWordTimings(segments);
};

const parseBracketEnhancedWordTimings = (
  line: string,
  timestamps: RegExpMatchArray[],
  leadingMatches: RegExpMatchArray[],
): LyricWordTiming[] | undefined => {
  if (leadingMatches.length !== 1 || timestamps.length < 3) {
    return undefined;
  }

  const lastTimestamp = timestamps[timestamps.length - 1];
  const lastTimestampEnd = (lastTimestamp.index ?? -1) + lastTimestamp[0].length;
  if (lastTimestampEnd !== line.length) {
    return undefined;
  }

  const segments: TimedSegment[] = [];
  for (let index = 0; index < timestamps.length - 1; index += 1) {
    const match = timestamps[index];
    const nextMatch = timestamps[index + 1];
    const startMs = parseTimestamp(match);
    const endMs = parseTimestamp(nextMatch);
    if (startMs === null || endMs === null || match.index === undefined || nextMatch.index === undefined) {
      return undefined;
    }

    segments.push({
      text: line.slice(match.index + match[0].length, nextMatch.index),
      startMs,
      endMs,
    });
  }

  return normalizeWordTimings(segments);
};

const looksLikeBracketEnhancedLine = (
  line: string,
  timestamps: RegExpMatchArray[],
  leadingMatches: RegExpMatchArray[],
): boolean => {
  if (leadingMatches.length === 0 || timestamps.length < 4) {
    return false;
  }

  const lastTimestamp = timestamps[timestamps.length - 1];
  const lastTimestampEnd = (lastTimestamp.index ?? -1) + lastTimestamp[0].length;
  if (lastTimestampEnd !== line.length) {
    return false;
  }

  const timedSegments = timestamps
    .map((match, index) => {
      const textStart = (match.index ?? 0) + match[0].length;
      const textEnd = timestamps[index + 1]?.index ?? line.length;
      return cleanLyricText(line.slice(textStart, textEnd));
    })
    .filter((segment) => segment.length > 0);

  if (timedSegments.length < 2) {
    return false;
  }

  const shortSegments = timedSegments.filter((segment) => segment.length <= 12 && !/\s/u.test(segment));
  return shortSegments.length / timedSegments.length >= 0.7;
};

const hasHan = (value: string): boolean => /\p{Script=Han}/u.test(value);
const hasKana = (value: string): boolean => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
const hasLatin = (value: string): boolean => /\p{Script=Latin}/u.test(value);
const hasHangul = (value: string): boolean => /\p{Script=Hangul}/u.test(value);

const hasEastAsianScript = (value: string): boolean =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);

const normalizeLineText = (value: string | null | undefined): string | null => {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized.length > 0 ? normalized : null;
};

const looksLikeRomanizationText = (value: string): boolean =>
  hasLatin(value) &&
  !hasEastAsianScript(value) &&
  /^[\p{Script=Latin}\d\s'"’.,!?():;+\-/&]+$/u.test(value);

const englishLyricWordSignals = new Set([
  'a',
  'about',
  'again',
  'all',
  'always',
  'am',
  'and',
  'anything',
  'are',
  'away',
  'baby',
  'be',
  'been',
  'but',
  'can',
  'cant',
  'celebrate',
  'chance',
  'confined',
  'continuously',
  'cool',
  'come',
  'could',
  'day',
  'do',
  'dont',
  'down',
  'dream',
  'energy',
  'fade',
  'feel',
  'feeling',
  'floor',
  'for',
  'from',
  'fun',
  'get',
  'girl',
  'go',
  'good',
  'got',
  'had',
  'have',
  'heart',
  'heated',
  'hello',
  'here',
  'hey',
  'how',
  'i',
  'if',
  'im',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'jungle',
  'know',
  'let',
  'life',
  'like',
  'love',
  'make',
  'me',
  'mistake',
  'moment',
  'music',
  'my',
  'never',
  'night',
  'no',
  'not',
  'now',
  'of',
  'oh',
  'ooh',
  'on',
  'one',
  'only',
  'out',
  'place',
  'play',
  'playin',
  'reason',
  'release',
  'say',
  'see',
  'she',
  'so',
  'some',
  'take',
  'that',
  'the',
  'there',
  'this',
  'time',
  'to',
  'turnin',
  'up',
  'wait',
  'wanna',
  'want',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'who',
  'will',
  'with',
  'world',
  'would',
  'yeah',
  'you',
  'youre',
  'your',
  'zoo',
]);

const englishWordPattern = /\p{Script=Latin}+(?:['\u2018\u2019\u02bc]\p{Script=Latin}+)?/gu;
const normalizeEnglishSignalWord = (value: string): string => value.toLowerCase().replace(/['\u2018\u2019\u02bc]/gu, '');

const looksLikeEnglishLyricText = (value: string): boolean => {
  if (!hasLatin(value) || hasEastAsianScript(value)) {
    return false;
  }

  const words = value.match(englishWordPattern) ?? [];
  if (words.length === 0) {
    return false;
  }

  const normalizedWords = words.map(normalizeEnglishSignalWord).filter(Boolean);
  const signalCount = normalizedWords.filter((word) => englishLyricWordSignals.has(word)).length;
  if (signalCount >= Math.max(1, Math.ceil(normalizedWords.length * 0.5))) {
    return true;
  }

  const totalWordLength = normalizedWords.reduce((total, word) => total + word.length, 0);
  const averageWordLength = totalWordLength / normalizedWords.length;
  const hasLongWord = normalizedWords.some((word) => word.length >= 5);
  return signalCount >= 1 && hasLongWord && averageWordLength >= 4;
};

const looksLikeTranslationText = (primaryText: string, value: string): boolean => {
  if (!hasHan(value) || hasKana(value) || hasHangul(value)) {
    return false;
  }

  return hasKana(primaryText) || hasLatin(primaryText) || hasHangul(primaryText) || !hasHan(primaryText);
};

const splitInlineTranslation = (value: string): Pick<LyricLine, 'text' | 'translation'> => {
  const delimiterPattern = /\s*[\/／]\s*/g;
  for (const match of value.matchAll(delimiterPattern)) {
    const delimiterIndex = match.index ?? -1;
    if (delimiterIndex <= 0) {
      continue;
    }

    const primaryText = normalizeLineText(value.slice(0, delimiterIndex));
    const translationText = normalizeLineText(value.slice(delimiterIndex + match[0].length));
    if (!primaryText || !translationText) {
      continue;
    }

    if (looksLikeTranslationText(primaryText, translationText)) {
      return { text: primaryText, translation: translationText };
    }
  }

  return { text: value };
};

const classifyAlternateLine = (
  primaryText: string,
  value: string,
  usedFields: Set<'romanization' | 'translation'>,
): 'romanization' | 'translation' | null => {
  if (!usedFields.has('romanization') && looksLikeRomanizationText(value)) {
    return 'romanization';
  }

  if (!usedFields.has('translation') && looksLikeTranslationText(primaryText, value)) {
    return 'translation';
  }

  return null;
};

const primaryLineScore = (line: LyricLine): number => {
  const text = normalizeLineText(line.text) ?? '';
  let score = 0;

  if (hasKana(text) || hasHangul(text)) {
    score += 8;
  } else if (hasHan(text)) {
    score += 6;
  } else if (hasEastAsianScript(text)) {
    score += 4;
  }

  if (looksLikeRomanizationText(text)) {
    score -= 10;
  }

  return score;
};

const selectPrimaryLineIndex = (group: LyricLine[]): number => {
  const englishPrimaryIndex = group.findIndex((line, index) => {
    const text = normalizeLineText(line.text) ?? '';
    return (
      looksLikeEnglishLyricText(text) &&
      group.some((candidate, candidateIndex) => {
        if (candidateIndex === index) {
          return false;
        }

        const candidateText = normalizeLineText(candidate.text) ?? '';
        return looksLikeTranslationText(text, candidateText);
      })
    );
  });
  if (englishPrimaryIndex >= 0) {
    return englishPrimaryIndex;
  }

  let primaryIndex = 0;
  let primaryScore = primaryLineScore(group[0]);

  for (let index = 1; index < group.length; index += 1) {
    const score = primaryLineScore(group[index]);
    if (score > primaryScore) {
      primaryIndex = index;
      primaryScore = score;
    }
  }

  return primaryIndex;
};

const collapseTimestampGroup = (group: LyricLine[]): LyricLine[] => {
  if (group.length <= 1) {
    return group;
  }

  const primaryIndex = selectPrimaryLineIndex(group);
  const primary = group[primaryIndex];
  const usedFields = new Set<'romanization' | 'translation'>();
  const collapsed: LyricLine = { ...primary };
  if (normalizeLineText(collapsed.romanization)) {
    usedFields.add('romanization');
  }
  if (normalizeLineText(collapsed.translation)) {
    usedFields.add('translation');
  }

  let changed = false;
  const pending: string[] = [];
  for (const [index, line] of group.entries()) {
    if (index === primaryIndex) {
      continue;
    }

    const alternateText = normalizeLineText(line.text);
    if (!alternateText || alternateText === collapsed.text) {
      continue;
    }

    const field = classifyAlternateLine(collapsed.text, alternateText, usedFields);
    if (field) {
      collapsed[field] = alternateText;
      usedFields.add(field);
      changed = true;
      continue;
    }

    pending.push(alternateText);
  }

  if (changed) {
    for (const alternateText of pending) {
      if (!usedFields.has('translation')) {
        collapsed.translation = alternateText;
        usedFields.add('translation');
        continue;
      }

      if (!usedFields.has('romanization')) {
        collapsed.romanization = alternateText;
        usedFields.add('romanization');
      }
    }

    return [collapsed];
  }

  return group;
};

export const normalizeSyncedLyricAlternates = (lines: LyricLine[]): LyricLine[] => {
  if (lines.length < 2) {
    return lines;
  }

  const normalized: LyricLine[] = [];
  let group: LyricLine[] = [];
  for (const line of lines) {
    if (line.timeMs < 0) {
      if (group.length > 0) {
        normalized.push(...collapseTimestampGroup(group));
        group = [];
      }
      normalized.push(line);
      continue;
    }

    if (group.length === 0 || group[0].timeMs === line.timeMs) {
      group.push(line);
      continue;
    }

    normalized.push(...collapseTimestampGroup(group));
    group = [line];
  }

  if (group.length > 0) {
    normalized.push(...collapseTimestampGroup(group));
  }

  return normalized;
};

const ttmlRootPattern = /<(?:[\w.-]+:)?tt(?:\s|>)/iu;
const ttmlParagraphPattern = /<(?:[\w.-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?p>/giu;
const ttmlSpanPattern = /<(?:[\w.-]+:)?span\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?span>/giu;
const ttmlTranslationTextPattern = /<(?:[\w.-]+:)?text\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?text>/giu;
const ttmlAttributePattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&amp;/giu, '&')
    .replace(/&#(\d+);/gu, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));

const parseTtmlAttributes = (value: string): Map<string, string> => {
  const attributes = new Map<string, string>();
  for (const match of value.matchAll(ttmlAttributePattern)) {
    attributes.set(match[1].toLowerCase(), decodeXmlEntities(match[2] ?? match[3] ?? ''));
  }

  return attributes;
};

const fractionToTtmlMs = (fraction: string | undefined): number => {
  if (!fraction) {
    return 0;
  }

  return Number(fraction.slice(0, 3).padEnd(3, '0'));
};

const parseTtmlTime = (value: string | null | undefined): number | null => {
  const text = value?.trim();
  if (!text) {
    return null;
  }

  const milliseconds = text.match(/^(\d+(?:\.\d+)?)ms$/iu);
  if (milliseconds) {
    return Math.round(Number(milliseconds[1]));
  }

  const seconds = text.match(/^(\d+(?:\.\d+)?)s$/iu);
  if (seconds) {
    return Math.round(Number(seconds[1]) * 1000);
  }

  const bareSeconds = text.match(/^(\d+\.\d+)$/u);
  if (bareSeconds) {
    return Math.round(Number(bareSeconds[1]) * 1000);
  }

  const minutes = text.match(/^(\d+(?:\.\d+)?)m$/iu);
  if (minutes) {
    return Math.round(Number(minutes[1]) * 60_000);
  }

  const hoursTime = text.match(/^(\d+):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/u);
  if (hoursTime) {
    const hours = Number(hoursTime[1]);
    const mins = Number(hoursTime[2]);
    const secs = Number(hoursTime[3]);
    if (!Number.isFinite(hours) || !Number.isFinite(mins) || !Number.isFinite(secs) || mins > 59 || secs > 59) {
      return null;
    }

    return hours * 3_600_000 + mins * 60_000 + secs * 1000 + fractionToTtmlMs(hoursTime[4]);
  }

  const minutesTime = text.match(/^(\d+):(\d{2})(?:[.,](\d{1,3}))?$/u);
  if (minutesTime) {
    const mins = Number(minutesTime[1]);
    const secs = Number(minutesTime[2]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs > 59) {
      return null;
    }

    return mins * 60_000 + secs * 1000 + fractionToTtmlMs(minutesTime[3]);
  }

  return null;
};

const ttmlLineText = (value: string): string =>
  decodeXmlEntities(value)
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

const normalizeTtmlTextPart = (value: string): string => ttmlLineText(value);

const firstTtmlAttribute = (attributes: Map<string, string>, names: string[]): string | null => {
  for (const name of names) {
    const value = attributes.get(name);
    if (value) {
      return value;
    }
  }

  return null;
};

const ttmlRoleKind = (attributes: Map<string, string>): 'translation' | 'romanization' | null => {
  const role = firstTtmlAttribute(attributes, ['ttm:role', 'role'])?.toLowerCase();
  if (!role) {
    return null;
  }

  if (role.includes('x-translation')) {
    return 'translation';
  }

  if (role.includes('x-roman')) {
    return 'romanization';
  }

  return null;
};

const shouldInsertTtmlTextSpace = (left: string, right: string): boolean => {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const leftChar = leftCharacters[leftCharacters.length - 1] ?? '';
  const rightChar = rightCharacters[0] ?? '';
  return /[\p{Script=Latin}\d,.;:!?"'\u2019\u201d)]/u.test(leftChar) && /[\p{Script=Latin}\d(]/u.test(rightChar);
};

type TtmlTextPart = {
  text: string;
  startMs: number | null;
  endMs: number | null;
};

const pushTtmlTextPart = (parts: TtmlTextPart[], part: TtmlTextPart): void => {
  if (!part.text) {
    return;
  }

  const previous = parts[parts.length - 1];
  if (previous && shouldInsertTtmlTextSpace(previous.text, part.text)) {
    previous.text += ' ';
  }

  parts.push(part);
};

const resolveTtmlChildTime = (timeMs: number | null, parentStartMs: number): number | null => {
  if (timeMs === null) {
    return null;
  }

  return timeMs < parentStartMs && parentStartMs - timeMs > 1000 ? parentStartMs + timeMs : timeMs;
};

const parseTtmlTranslations = (ttmlText: string): Map<string, string> => {
  const translations = new Map<string, string>();
  for (const match of ttmlText.matchAll(ttmlTranslationTextPattern)) {
    const attributes = parseTtmlAttributes(match[1]);
    const targetId = firstTtmlAttribute(attributes, ['for', 'itunes:for', 'xml:id', 'id']);
    if (!targetId || translations.has(targetId)) {
      continue;
    }

    const text = ttmlLineText(match[2]);
    if (text) {
      translations.set(targetId, text);
    }
  }

  return translations;
};

const parseTtmlParagraph = (
  attributesText: string,
  content: string,
  translationsById: Map<string, string>,
): LyricLine | null => {
  const attributes = parseTtmlAttributes(attributesText);
  const beginMs = parseTtmlTime(attributes.get('begin'));
  const endMs = parseTtmlTime(attributes.get('end'));
  const durationMs = parseTtmlTime(attributes.get('dur'));
  const parentStartMs = beginMs ?? 0;
  const parts: TtmlTextPart[] = [];
  let inlineTranslation: string | null = null;
  let inlineRomanization: string | null = null;
  let cursor = 0;

  for (const match of content.matchAll(ttmlSpanPattern)) {
    if (match.index === undefined) {
      continue;
    }

    pushTtmlTextPart(parts, {
      text: normalizeTtmlTextPart(content.slice(cursor, match.index)),
      startMs: null,
      endMs: null,
    });

    const spanAttributes = parseTtmlAttributes(match[1]);
    const roleKind = ttmlRoleKind(spanAttributes);
    if (roleKind) {
      const text = normalizeTtmlTextPart(match[2]);
      if (text) {
        if (roleKind === 'translation') {
          inlineTranslation = inlineTranslation ? `${inlineTranslation} ${text}` : text;
        } else {
          inlineRomanization = inlineRomanization ? `${inlineRomanization} ${text}` : text;
        }
      }
      cursor = match.index + match[0].length;
      continue;
    }

    const spanStartMs = resolveTtmlChildTime(parseTtmlTime(spanAttributes.get('begin')), parentStartMs);
    const spanEndMs =
      resolveTtmlChildTime(parseTtmlTime(spanAttributes.get('end')), parentStartMs) ??
      (spanStartMs === null
        ? null
        : (() => {
          const spanDurationMs = parseTtmlTime(spanAttributes.get('dur'));
          return spanDurationMs === null ? null : spanStartMs + spanDurationMs;
        })());

    pushTtmlTextPart(parts, {
      text: normalizeTtmlTextPart(match[2]),
      startMs: spanStartMs,
      endMs: spanEndMs,
    });
    cursor = match.index + match[0].length;
  }

  pushTtmlTextPart(parts, {
    text: normalizeTtmlTextPart(content.slice(cursor)),
    startMs: null,
    endMs: null,
  });
  const timedParts = parts.filter((part): part is TtmlTextPart & { startMs: number } => part.startMs !== null);
  const lineBeginMs = beginMs ?? timedParts[0]?.startMs ?? null;
  if (lineBeginMs === null) {
    return null;
  }

  const lineEndMs = endMs ?? (durationMs === null ? null : lineBeginMs + durationMs);
  for (let index = 0; index < timedParts.length; index += 1) {
    const part = timedParts[index];
    const nextStartMs = timedParts[index + 1]?.startMs ?? null;
    const inferredEndMs = nextStartMs ?? lineEndMs;
    if (part.endMs === null && inferredEndMs !== null && inferredEndMs > part.startMs) {
      part.endMs = inferredEndMs;
    }
  }

  const text = parts.map((part) => part.text).join('').replace(/\s+/gu, ' ').trim();
  if (!text) {
    return null;
  }

  const words = normalizeWordTimings(
    timedParts
      .map((part) => ({
        text: part.text,
        startMs: part.startMs,
        endMs: part.endMs,
      })),
  );

  const line: LyricLine = {
    timeMs: lineBeginMs,
    ...attachWordTimings(splitInlineTranslation(text), words),
  };
  const lineId = firstTtmlAttribute(attributes, ['itunes:key', 'xml:id', 'id', 'key']);
  const translation = lineId ? translationsById.get(lineId) : undefined;
  if (translation && !line.translation) {
    line.translation = translation;
  }
  if (inlineTranslation && !line.translation) {
    line.translation = inlineTranslation;
  }
  if (inlineRomanization && !line.romanization) {
    line.romanization = inlineRomanization;
  }

  return line;
};

export const parseTtmlLyrics = (ttmlText: string): LyricLine[] => {
  if (!ttmlRootPattern.test(ttmlText)) {
    return [];
  }

  const translationsById = parseTtmlTranslations(ttmlText);
  const lines: LyricLine[] = [];
  for (const match of ttmlText.matchAll(ttmlParagraphPattern)) {
    const line = parseTtmlParagraph(match[1], match[2], translationsById);
    if (line) {
      lines.push(line);
    }
  }

  return lines.sort((left, right) => left.timeMs - right.timeMs);
};

export const parseSyncedLyrics = (lrcText: string): LyricLine[] => {
  const ttmlLines = parseTtmlLyrics(lrcText);
  if (ttmlLines.length > 0) {
    return ttmlLines;
  }

  const lines: LyricLine[] = [];

  for (const rawLine of lrcText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || metadataTagPattern.test(line)) {
      continue;
    }

    const neteaseYrcLine = parseNeteaseYrcLine(line);
    if (neteaseYrcLine) {
      lines.push(neteaseYrcLine);
      continue;
    }

    const timestamps = [...line.matchAll(timestampPattern)];
    if (!timestamps.length) {
      continue;
    }

    const leadingTimestamps = line.match(leadingTimestampsPattern)?.[0] ?? '';
    const leadingMatches = [...leadingTimestamps.matchAll(timestampPattern)];
    const hasOnlyLeadingTimestamps = timestamps.length === leadingMatches.length;

    if (looksLikeBracketEnhancedLine(line, timestamps, leadingMatches)) {
      const text = cleanBracketTimestampedLyricText(line.slice(leadingTimestamps.length));
      if (!text) {
        continue;
      }
      const words = parseBracketEnhancedWordTimings(line, timestamps, leadingMatches);

      for (const match of leadingMatches) {
        const timeMs = parseTimestamp(match);
        if (timeMs === null) {
          continue;
        }

        lines.push({ timeMs, ...attachWordTimings(splitInlineTranslation(text), words) });
      }

      continue;
    }

    if (hasOnlyLeadingTimestamps) {
      const content = line.slice(leadingTimestamps.length);
      const text = cleanLyricText(content);
      if (!text) {
        continue;
      }
      const words = parseAngleEnhancedWordTimings(content);

      for (const match of timestamps) {
        const timeMs = parseTimestamp(match);
        if (timeMs === null) {
          continue;
        }

        lines.push({ timeMs, ...attachWordTimings(splitInlineTranslation(text), words) });
      }

      continue;
    }

    for (let index = 0; index < timestamps.length; index += 1) {
      const match = timestamps[index];
      const timeMs = parseTimestamp(match);
      if (timeMs === null || match.index === undefined) {
        continue;
      }

      const textStart = match.index + match[0].length;
      const textEnd = timestamps[index + 1]?.index ?? line.length;
      const text = cleanLyricText(line.slice(textStart, textEnd));
      if (text) {
        const words = parseAngleEnhancedWordTimings(line.slice(textStart, textEnd));
        lines.push({ timeMs, ...attachWordTimings(splitInlineTranslation(text), words) });
      }
    }
  }

  return lines.sort((left, right) => left.timeMs - right.timeMs);
};

export const parsePlainLyrics = (plainText: string): LyricLine[] => {
  if (ttmlRootPattern.test(plainText)) {
    return [];
  }

  return plainText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => ({
      timeMs: -1,
      ...splitInlineTranslation(text),
    }));
};

export const detectLyricsKind = ({
  instrumental,
  plainLyrics,
  syncedLyrics,
}: {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean | null;
}): LyricsKind => {
  if (instrumental) {
    return 'instrumental';
  }

  if (syncedLyrics && parseSyncedLyrics(syncedLyrics).length > 0) {
    return 'synced';
  }

  if (plainLyrics && parsePlainLyrics(plainLyrics).length > 0) {
    return 'plain';
  }

  return 'empty';
};

export const serializeLyricLines = (lines: LyricLine[]): string => JSON.stringify(lines);

const deserializeWordTimings = (value: unknown, lineText: string): LyricWordTiming[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const words = normalizeWordTimings(
    value
      .filter((word): word is Record<string, unknown> => Boolean(word && typeof word === 'object' && !Array.isArray(word)))
      .map((word) => ({
        text: typeof word.text === 'string' ? word.text : '',
        startMs: Number(word.startMs),
        endMs: word.endMs === null || word.endMs === undefined ? null : Number(word.endMs),
      })),
  );

  if (!words?.length) {
    return undefined;
  }

  return normalizedTextIdentity(words.map((word) => word.text).join('')) === normalizedTextIdentity(lineText)
    ? words
    : undefined;
};

export const deserializeLyricLines = (linesJson: string): LyricLine[] => {
  try {
    const parsed = JSON.parse(linesJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((line): line is Record<string, unknown> => line && typeof line === 'object' && !Array.isArray(line))
      .map((line) => {
        const text = typeof line.text === 'string' ? line.text : '';
        const words = deserializeWordTimings(line.words, text);
        return {
          timeMs: Number(line.timeMs),
          text,
          ...(words ? { words } : {}),
          ...(typeof line.translation === 'string' ? { translation: line.translation } : {}),
          ...(typeof line.romanization === 'string' ? { romanization: line.romanization } : {}),
          ...(typeof line.kana === 'string' ? { kana: line.kana } : {}),
        };
      })
      .filter((line) => Number.isFinite(line.timeMs) && line.text.trim().length > 0);
  } catch {
    return [];
  }
};
