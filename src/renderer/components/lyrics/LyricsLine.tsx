import type { CSSProperties } from 'react';
import type { LyricLine as LyricLineType, LyricWordTiming } from '../../../shared/types/lyrics';
import { VerticalText } from './VerticalText';

type LyricsLineProps = {
  line: LyricLineType;
  index: number;
  active: boolean;
  past: boolean;
  onSeek: (timeMs: number) => void;
  seekable?: boolean;
  showRomanization?: boolean;
  preferKanaPronunciation?: boolean;
  showTranslation?: boolean;
  wordHighlightEnabled?: boolean;
  focusDistance?: number;
  textDirection?: 'horizontal' | 'vertical';
};

const selectPronunciation = (
  line: LyricLineType,
  preferKanaPronunciation: boolean,
): { text: string | null; kind: 'kana' | 'romanization' | 'none' } => {
  if (preferKanaPronunciation && line.kana?.trim()) {
    return { text: line.kana, kind: 'kana' };
  }

  if (line.romanization?.trim()) {
    return { text: line.romanization, kind: 'romanization' };
  }

  return { text: null, kind: 'none' };
};

const getLyricDensity = (
  line: LyricLineType,
  showRomanization: boolean,
  showTranslation: boolean,
  preferKanaPronunciation: boolean,
): 'short' | 'medium' | 'long' | 'dense' => {
  const textLength = Array.from(line.text.replace(/\s+/g, ' ').trim()).length;
  const pronunciation = selectPronunciation(line, preferKanaPronunciation).text ?? '';
  const secondaryLength = Array.from(
    `${showRomanization ? pronunciation : ''}${showTranslation ? (line.translation ?? '') : ''}`.replace(/\s+/g, ' ').trim(),
  ).length;
  const weightedLength = textLength + Math.round(secondaryLength * 0.45);

  if (weightedLength >= 86) {
    return 'dense';
  }

  if (weightedLength >= 58) {
    return 'long';
  }

  if (weightedLength >= 36) {
    return 'medium';
  }

  return 'short';
};

const maxRawWordHighlightSegments = 72;
const maxRenderedWordHighlightSegments = 18;
const minRenderableWordHighlightSegments = 2;
const minTimedWordDurationMs = 40;
const minLineTimingSpanMs = 220;
const tinySegmentDurationMs = 95;
const tinySegmentRatioLimit = 0.45;
const phraseTargetChars = 3;
const phraseMinDurationMs = 260;
const phraseMaxDurationMs = 900;
const phraseGapBoundaryMs = 210;
const phraseBoundaryPattern = /[,.!?;:)\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a\u2026]\s*$/u;

const renderableWordsCache = new WeakMap<LyricLineType, readonly LyricWordTiming[] | null>();

const lyricTextLength = (value: string): number => Array.from(value.replace(/\s+/gu, '')).length;

const hasWhitespace = (value: string): boolean => /\s/u.test(value);

const isPhraseBoundary = (value: string): boolean => phraseBoundaryPattern.test(value);

const normalizeTimingText = (value: string): string => value.replace(/\s+/gu, ' ').trim();
const normalizeCompactTimingText = (value: string): string => value.replace(/\s+/gu, '').trim();

const wordsMatchLineText = (line: LyricLineType, words: readonly LyricWordTiming[]): boolean =>
  normalizeTimingText(words.map((word) => word.text).join('')) === normalizeTimingText(line.text) ||
  normalizeCompactTimingText(words.map((word) => word.text).join('')) === normalizeCompactTimingText(line.text);

const preserveLineSpacingInWordTimings = (
  lineText: string,
  words: readonly LyricWordTiming[],
): readonly LyricWordTiming[] => {
  const joinedWordText = words.map((word) => word.text).join('');
  if (normalizeTimingText(joinedWordText) === normalizeTimingText(lineText)) {
    return words;
  }

  if (normalizeCompactTimingText(joinedWordText) !== normalizeCompactTimingText(lineText)) {
    return words;
  }

  const chars = Array.from(lineText.trim());
  let cursor = 0;
  const spacedWords = words.map((word) => {
    const targetLength = lyricTextLength(word.text);
    let text = '';
    let consumedChars = 0;

    while (cursor < chars.length && consumedChars < targetLength) {
      const char = chars[cursor];
      text += char;
      cursor += 1;
      if (!hasWhitespace(char)) {
        consumedChars += 1;
      }
    }

    while (cursor < chars.length && hasWhitespace(chars[cursor])) {
      text += chars[cursor];
      cursor += 1;
    }

    return { ...word, text };
  });

  return wordsMatchLineText({ text: lineText, timeMs: 0 }, spacedWords) ? spacedWords : words;
};

const getSegmentEndMs = (words: readonly LyricWordTiming[], index: number): number | null => {
  const word = words[index];
  const endMs = word.endMs ?? words[index + 1]?.startMs ?? null;
  return endMs !== null && Number.isFinite(endMs) && endMs > word.startMs ? endMs : null;
};

const getSegmentDurationMs = (words: readonly LyricWordTiming[], index: number): number | null => {
  const endMs = getSegmentEndMs(words, index);
  return endMs === null ? null : endMs - words[index].startMs;
};

const shouldCoalesceWordTimings = (words: readonly LyricWordTiming[], lineText: string): boolean => {
  if (words.length <= maxRenderedWordHighlightSegments) {
    const compactLength = lyricTextLength(lineText);
    return compactLength > 0 && !hasWhitespace(lineText) && words.length >= 7 && compactLength / words.length <= 1.35;
  }

  return true;
};

const mergeOverflowingWordTimingPhrases = (
  phrases: readonly LyricWordTiming[],
  maxSegments: number,
): LyricWordTiming[] => {
  const merged = [...phrases];

  while (merged.length > maxSegments) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index < merged.length - 1; index += 1) {
      const current = merged[index];
      const next = merged[index + 1];
      const currentEndMs = current.endMs ?? next.startMs;
      const gapMs = Math.max(0, next.startMs - currentEndMs);
      const combinedEndMs = next.endMs ?? currentEndMs;
      const combinedDurationMs = Math.max(0, combinedEndMs - current.startMs);
      const combinedChars = lyricTextLength(current.text) + lyricTextLength(next.text);
      const punctuationPenalty = isPhraseBoundary(current.text) ? 500 : 0;
      const score = gapMs * 4 + combinedDurationMs + combinedChars * 18 + punctuationPenalty;

      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const current = merged[bestIndex];
    const next = merged[bestIndex + 1];
    merged.splice(bestIndex, 2, {
      text: `${current.text}${next.text}`,
      startMs: current.startMs,
      endMs: next.endMs ?? current.endMs,
    });
  }

  return merged;
};

const coalesceWordTimings = (
  words: readonly LyricWordTiming[],
  maxSegments = maxRenderedWordHighlightSegments,
): LyricWordTiming[] => {
  const phrases: LyricWordTiming[] = [];
  let phraseStart = 0;
  let phraseText = '';
  let phraseChars = 0;
  const totalChars = Math.max(1, words.reduce((total, word) => total + lyricTextLength(word.text), 0));
  const firstStartMs = words[0]?.startMs ?? 0;
  const lastEndMs = getSegmentEndMs(words, words.length - 1) ?? words[words.length - 1]?.startMs ?? firstStartMs;
  const totalDurationMs = Math.max(phraseMinDurationMs, lastEndMs - firstStartMs);
  const dynamicTargetChars = Math.max(phraseTargetChars, Math.ceil(totalChars / Math.max(1, maxSegments)));
  const dynamicMinDurationMs = Math.max(
    phraseMinDurationMs,
    Math.min(620, Math.round((totalDurationMs / Math.max(1, maxSegments)) * 0.9)),
  );

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!phraseText) {
      phraseStart = word.startMs;
    }

    phraseText += word.text;
    phraseChars += lyricTextLength(word.text);

    const endMs = getSegmentEndMs(words, index);
    const nextStartMs = words[index + 1]?.startMs ?? null;
    const phraseDurationMs = endMs === null ? 0 : endMs - phraseStart;
    const nextGapMs = endMs !== null && nextStartMs !== null ? nextStartMs - endMs : 0;
    const shouldClose =
      index === words.length - 1 ||
      nextGapMs >= phraseGapBoundaryMs ||
      (phraseChars >= dynamicTargetChars && phraseDurationMs >= dynamicMinDurationMs) ||
      phraseDurationMs >= phraseMaxDurationMs ||
      isPhraseBoundary(word.text);

    if (shouldClose) {
      phrases.push({
        text: phraseText,
        startMs: phraseStart,
        endMs,
      });
      phraseText = '';
      phraseChars = 0;
    }
  }

  return mergeOverflowingWordTimingPhrases(phrases, maxSegments);
};

export const getRenderableLyricWords = (line: LyricLineType): readonly LyricWordTiming[] | null => {
  const cached = renderableWordsCache.get(line);
  if (cached !== undefined) {
    return cached;
  }

  const sourceWords = line.words ?? [];
  if (sourceWords.length < minRenderableWordHighlightSegments || sourceWords.length > maxRawWordHighlightSegments) {
    renderableWordsCache.set(line, null);
    return null;
  }

  for (let index = 0; index < sourceWords.length; index += 1) {
    const word = sourceWords[index];
    const previous = sourceWords[index - 1];
    if (!word.text.trim() || !Number.isFinite(word.startMs) || word.startMs < 0) {
      renderableWordsCache.set(line, null);
      return null;
    }
    if (previous && word.startMs <= previous.startMs) {
      renderableWordsCache.set(line, null);
      return null;
    }
    if (word.endMs !== null && (!Number.isFinite(word.endMs) || word.endMs <= word.startMs)) {
      renderableWordsCache.set(line, null);
      return null;
    }
  }

  if (!wordsMatchLineText(line, sourceWords)) {
    renderableWordsCache.set(line, null);
    return null;
  }

  const durations = sourceWords
    .map((_, index) => getSegmentDurationMs(sourceWords, index))
    .filter((duration): duration is number => duration !== null);
  const firstStartMs = sourceWords[0].startMs;
  const lastEndMs = getSegmentEndMs(sourceWords, sourceWords.length - 1) ?? sourceWords[sourceWords.length - 1].startMs;
  const lineTimingSpanMs = lastEndMs - firstStartMs;
  const tinySegmentRatio = durations.length > 0
    ? durations.filter((duration) => duration < tinySegmentDurationMs).length / durations.length
    : 0;

  if (
    lineTimingSpanMs < minLineTimingSpanMs ||
    durations.some((duration) => duration < minTimedWordDurationMs) ||
    tinySegmentRatio > tinySegmentRatioLimit
  ) {
    renderableWordsCache.set(line, null);
    return null;
  }

  const spacedSourceWords = preserveLineSpacingInWordTimings(line.text, sourceWords);
  const renderableWords = shouldCoalesceWordTimings(spacedSourceWords, line.text)
    ? coalesceWordTimings(spacedSourceWords, maxRenderedWordHighlightSegments)
    : [...spacedSourceWords];

  const result =
    renderableWords.length >= minRenderableWordHighlightSegments &&
    renderableWords.length <= maxRenderedWordHighlightSegments &&
    wordsMatchLineText(line, renderableWords)
      ? renderableWords
      : null;
  renderableWordsCache.set(line, result);
  return result;
};

export const LyricsLine = ({
  active,
  index,
  line,
  onSeek,
  past,
  seekable = true,
  showRomanization = true,
  preferKanaPronunciation = false,
  showTranslation = true,
  wordHighlightEnabled = true,
  focusDistance = 4,
  textDirection = 'horizontal',
}: LyricsLineProps): JSX.Element => {
  const density = getLyricDensity(line, showRomanization, showTranslation, preferKanaPronunciation);
  const { text: pronunciation, kind: pronunciationKind } = selectPronunciation(line, preferKanaPronunciation);
  const visibleSecondaryLines =
    (showRomanization && pronunciation ? 1 : 0) +
    (showTranslation && line.translation ? 1 : 0);
  const renderableWords = wordHighlightEnabled ? getRenderableLyricWords(line) : null;
  const hasWordHighlight = Boolean(renderableWords);
  const isVerticalText = textDirection === 'vertical';

  return (
    <button
      className="lyrics-line"
      data-active={active}
      data-density={density}
      data-focus-distance={Math.min(4, Math.max(0, focusDistance))}
      data-lyric-index={index}
      data-past={past}
      data-seekable={seekable}
      data-secondary-lines={visibleSecondaryLines}
      data-word-highlight={hasWordHighlight}
      type="button"
      onMouseDown={(event) => {
        if (seekable) {
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        if (seekable) {
          event.currentTarget.blur();
          onSeek(line.timeMs);
        }
      }}
    >
      <span className="lyrics-line-text">
        <span className="lyrics-line-primary" aria-label={isVerticalText ? line.text : undefined}>
          {hasWordHighlight
            ? renderableWords?.map((word, index) => (
              <mark
                className="lyrics-word"
                data-word-index={index}
                data-word-state="future"
                key={`${word.startMs}-${index}-${word.text}`}
                style={{ '--lyrics-word-progress': '0' } as CSSProperties}
              >
                {isVerticalText
                  ? <VerticalText className="lyrics-upright-character" text={word.text} />
                  : word.text}
              </mark>
            ))
            : isVerticalText
              ? <VerticalText className="lyrics-upright-character" text={line.text} />
              : line.text}
        </span>
        {showRomanization && pronunciation ? (
          <small data-pronunciation={pronunciationKind} aria-label={isVerticalText ? pronunciation : undefined}>
            {isVerticalText
              ? <VerticalText className="lyrics-upright-character" text={pronunciation} />
              : pronunciation}
          </small>
        ) : null}
        {showTranslation && line.translation ? (
          <em aria-label={isVerticalText ? line.translation : undefined}>
            {isVerticalText
              ? <VerticalText className="lyrics-upright-character" text={line.translation} />
              : line.translation}
          </em>
        ) : null}
      </span>
    </button>
  );
};
