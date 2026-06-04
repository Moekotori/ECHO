import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Music2 } from 'lucide-react';
import { LyricsLine, getRenderableLyricWords } from './LyricsLine';
import type { LyricsState } from './lyricsTypes';
import type { LyricWordTiming } from '../../../shared/types/lyrics';
import { shouldShowRomanizationForLyrics } from '../../../shared/utils/lyricsLanguage';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';

type LyricScrollMode = 'animated' | 'instant' | 'recenter';
const lyricsLayoutSettingKeys = new Set([
  'lyricsFontSizePx',
  'lyricsSecondaryFontSizePx',
  'lyricsFontFamily',
  'lyricsFontFilePath',
  'lyricsLineSpacingPercent',
  'lyricsLineMaxChars',
  'lyricsRomanizationEnabled',
  'lyricsUtatenKanaEnabled',
  'lyricsTranslationEnabled',
  'lyricsContextOpacityPercent',
]);

type LyricsViewProps = {
  lyrics: LyricsState;
  durationMs?: number | null;
  positionMs: number;
  playbackRate?: number;
  playbackState?: string;
  positionUpdatedAtMs?: number;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  onSeek: (timeMs: number) => void;
  hideEmptyState?: boolean;
  showRomanization?: boolean;
  preferKanaPronunciation?: boolean;
  showTranslation?: boolean;
  wordHighlightEnabled?: boolean;
  highFrequencyUpdatesEnabled?: boolean;
};

const activeIndexSearchCache = new WeakMap<LyricsState['lines'], boolean>();

const canUseBinaryActiveIndexSearch = (lines: LyricsState['lines']): boolean => {
  const cached = activeIndexSearchCache.get(lines);
  if (cached !== undefined) {
    return cached;
  }

  let previousTimeMs = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    if (line.timeMs < 0 || line.timeMs < previousTimeMs) {
      activeIndexSearchCache.set(lines, false);
      return false;
    }
    previousTimeMs = line.timeMs;
  }

  activeIndexSearchCache.set(lines, true);
  return true;
};

const getActiveLyricIndexLinear = (lines: LyricsState['lines'], adjustedPositionMs: number): number => {
  let activeIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const timeMs = lines[index].timeMs;
    if (timeMs < 0) {
      continue;
    }

    if (timeMs > adjustedPositionMs) {
      break;
    }

    activeIndex = index;
  }

  return activeIndex;
};

export const getActiveLyricIndex = (lines: LyricsState['lines'], positionMs: number, offsetMs: number): number => {
  if (lines.length === 0) {
    return -1;
  }

  const adjustedPositionMs = Math.max(0, positionMs + offsetMs);
  if (!canUseBinaryActiveIndexSearch(lines)) {
    return getActiveLyricIndexLinear(lines, adjustedPositionMs);
  }

  let low = 0;
  let high = lines.length - 1;
  let activeIndex = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const timeMs = lines[mid].timeMs;

    if (timeMs < 0 || timeMs <= adjustedPositionMs) {
      if (timeMs >= 0) {
        activeIndex = mid;
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return activeIndex;
};

export const getEstimatedPlainLyricIndex = (
  lines: LyricsState['lines'],
  positionMs: number,
  durationMs?: number | null,
): number => {
  if (lines.length === 0 || !durationMs || durationMs <= 0 || !Number.isFinite(durationMs)) {
    return lines.length > 0 ? 0 : -1;
  }

  const progress = Math.max(0, Math.min(0.999999, positionMs / durationMs));
  return Math.max(0, Math.min(lines.length - 1, Math.floor(progress * lines.length)));
};

const easeInOutCubic = (progress: number): number =>
  progress < 0.5
    ? 4 * progress ** 3
    : 1 - ((-2 * progress + 2) ** 3) / 2;

const getAnimationNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const requestLyricAnimationFrame = (callback: FrameRequestCallback): number => {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }

  return window.setTimeout(() => {
    callback(getAnimationNow());
  }, 16);
};

const cancelLyricAnimationFrame = (frameId: number): void => {
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId);
    return;
  }

  window.clearTimeout(frameId);
};

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clampPositionMs = (positionMs: number, durationMs?: number | null): number => {
  const safePositionMs = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  return durationMs && durationMs > 0 && Number.isFinite(durationMs)
    ? Math.min(safePositionMs, durationMs)
    : safePositionMs;
};

const maxImplicitLastWordDurationMs = 1800;

const getWordEndMs = (
  words: readonly LyricWordTiming[],
  wordIndex: number,
  fallbackLineEndMs?: number,
): number => {
  const word = words[wordIndex];
  if (!word) {
    return 0;
  }

  const explicitEndMs = word.endMs ?? words[wordIndex + 1]?.startMs;
  if (explicitEndMs !== undefined && explicitEndMs > word.startMs) {
    return explicitEndMs;
  }

  const implicitEndMs = fallbackLineEndMs && fallbackLineEndMs > word.startMs
    ? fallbackLineEndMs
    : word.startMs + maxImplicitLastWordDurationMs;
  return Math.min(implicitEndMs, word.startMs + maxImplicitLastWordDurationMs);
};

const getInterpolatedPositionMs = ({
  durationMs,
  playbackRate,
  playbackState,
  positionMs,
  positionUpdatedAtMs,
}: {
  durationMs?: number | null;
  playbackRate: number;
  playbackState: string;
  positionMs: number;
  positionUpdatedAtMs: number;
}): number => {
  if (playbackState !== 'playing') {
    return clampPositionMs(positionMs, durationMs);
  }

  const elapsedMs = Math.max(0, getAnimationNow() - positionUpdatedAtMs);
  return clampPositionMs(positionMs + elapsedMs * playbackRate, durationMs);
};

const getLinePlaybackPositionMs = (
  words: readonly LyricWordTiming[],
  nextLine: LyricsState['lines'][number] | undefined,
  adjustedPositionMs: number,
): number => {
  if (!words.length) {
    return adjustedPositionMs;
  }

  const firstWord = words[0];
  const naturalEndMs = getWordEndMs(words, words.length - 1, nextLine?.timeMs);

  return Math.max(firstWord.startMs, Math.min(adjustedPositionMs, naturalEndMs));
};

const getCurrentWordIndex = (
  words: readonly LyricWordTiming[],
  adjustedPositionMs: number,
  fallbackLineEndMs?: number,
): number => {
  if (words.length === 0 || adjustedPositionMs < words[0].startMs) {
    return -1;
  }

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const endMs = getWordEndMs(words, index, fallbackLineEndMs);
    if (adjustedPositionMs < endMs) {
      return index;
    }
  }

  return words.length - 1;
};

const getWordProgress = (
  words: readonly LyricWordTiming[],
  wordIndex: number,
  adjustedPositionMs: number,
  fallbackLineEndMs?: number,
): number => {
  const word = words[wordIndex];
  if (!word) {
    return 0;
  }

  const endMs = getWordEndMs(words, wordIndex, fallbackLineEndMs);
  if (endMs <= word.startMs) {
    return adjustedPositionMs >= word.startMs ? 1 : 0;
  }

  return Math.max(0, Math.min(1, (adjustedPositionMs - word.startMs) / (endMs - word.startMs)));
};

const calculateActiveIndex = (
  lines: LyricsState['lines'],
  positionMs: number,
  offsetMs: number,
  durationMs: number | null | undefined,
  isSynced: boolean,
  isPlain: boolean,
): number =>
  isSynced
    ? getActiveLyricIndex(lines, positionMs, offsetMs)
    : isPlain
      ? getEstimatedPlainLyricIndex(lines, positionMs, durationMs)
      : -1;

const getActiveLineLayoutCenter = (
  scrollContainer: HTMLElement,
  activeLine: HTMLButtonElement,
): number => {
  if (activeLine.offsetHeight > 0) {
    return activeLine.offsetTop + activeLine.offsetHeight / 2;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const activeRect = activeLine.getBoundingClientRect();
  return activeRect.top - containerRect.top + scrollContainer.scrollTop + activeRect.height / 2;
};

type ActiveWordElementCache = {
  activeLine: HTMLButtonElement;
  lineKey: string;
  wordElements: HTMLElement[];
};

export const LyricsView = ({
  durationMs,
  hideEmptyState = false,
  lyrics,
  onContextMenu,
  onSeek,
  playbackRate = 1,
  playbackState = 'idle',
  positionMs,
  positionUpdatedAtMs = getAnimationNow(),
  showRomanization = true,
  preferKanaPronunciation = false,
  showTranslation = true,
  wordHighlightEnabled = true,
  highFrequencyUpdatesEnabled = true,
}: LyricsViewProps): JSX.Element | null => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const scrollRef = useRef<HTMLElement | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const scrollAnimationVersionRef = useRef(0);
  const activeCenterFrameRef = useRef<number | null>(null);
  const layoutPreserveFrameRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const wordAnimationFrameRef = useRef<number | null>(null);
  const activeIndexRef = useRef(-1);
  const wordElementCacheRef = useRef<ActiveWordElementCache | null>(null);
  const wordProgressRef = useRef<{ lineKey: string; progressValue: string | null; wordIndex: number } | null>(null);
  const isSynced = lyrics.kind === 'synced';
  const isPlain = lyrics.kind === 'plain';
  const canShowRomanization = showRomanization && shouldShowRomanizationForLyrics(lyrics.lines);
  const [activeIndex, setActiveIndex] = useState(() =>
    calculateActiveIndex(
      lyrics.lines,
      positionMs,
      lyrics.offsetMs,
      durationMs,
      isSynced,
      isPlain,
    ),
  );
  const lastCenteredActiveIndexRef = useRef(activeIndex);
  const hasCenteredActiveLyricRef = useRef(false);
  const lastLyricsLinesRef = useRef(lyrics.lines);
  const [centerRevision, setCenterRevision] = useState(0);
  activeIndexRef.current = activeIndex;

  const stopScrollAnimation = useCallback((): void => {
    scrollAnimationVersionRef.current += 1;
    if (scrollAnimationFrameRef.current !== null) {
      cancelLyricAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = null;
    }
  }, []);

  const stopWordAnimation = useCallback((): void => {
    if (wordAnimationFrameRef.current !== null) {
      cancelLyricAnimationFrame(wordAnimationFrameRef.current);
      wordAnimationFrameRef.current = null;
    }
  }, []);

  const resetWordHighlightCache = useCallback((): void => {
    wordElementCacheRef.current = null;
    wordProgressRef.current = null;
  }, []);

  const getActiveWordElements = useCallback((
    scrollContainer: HTMLElement,
    lineKey: string,
    wordCount: number,
  ): HTMLElement[] | null => {
    const cached = wordElementCacheRef.current;
    if (
      cached &&
      cached.lineKey === lineKey &&
      cached.wordElements.length === wordCount &&
      cached.activeLine.isConnected &&
      cached.activeLine.dataset.active === 'true'
    ) {
      return cached.wordElements;
    }

    const activeLine = scrollContainer.querySelector<HTMLButtonElement>('.lyrics-line[data-active="true"]');
    if (!activeLine) {
      wordElementCacheRef.current = null;
      return null;
    }

    const wordElements = Array.from(activeLine.querySelectorAll<HTMLElement>('.lyrics-word'));
    if (wordElements.length !== wordCount) {
      wordElementCacheRef.current = null;
      return null;
    }

    wordElementCacheRef.current = { activeLine, lineKey, wordElements };
    return wordElements;
  }, []);

  const syncActiveWordHighlight = useCallback((currentPositionMs: number): void => {
    if (!wordHighlightEnabled || prefersReducedMotion()) {
      return;
    }

    const scrollContainer = scrollRef.current;
    const currentIndex = activeIndexRef.current;
    const line = lyrics.lines[currentIndex];
    const words = line ? getRenderableLyricWords(line) : null;
    if (!scrollContainer || !line || !words) {
      resetWordHighlightCache();
      return;
    }

    const lineKey = `${line.timeMs}-${currentIndex}-${words.length}`;
    const wordElements = getActiveWordElements(scrollContainer, lineKey, words.length);
    if (!wordElements) {
      wordProgressRef.current = null;
      return;
    }

    const adjustedPositionMs = getLinePlaybackPositionMs(
      words,
      lyrics.lines[currentIndex + 1],
      currentPositionMs + lyrics.offsetMs,
    );
    const fallbackLineEndMs = lyrics.lines[currentIndex + 1]?.timeMs;
    const wordIndex = getCurrentWordIndex(words, adjustedPositionMs, fallbackLineEndMs);
    const previous = wordProgressRef.current;
    const changedWord = !previous || previous.lineKey !== lineKey || previous.wordIndex !== wordIndex;

    if (changedWord) {
      wordElements.forEach((element, index) => {
        const state = wordIndex < 0
          ? 'future'
          : index < wordIndex
            ? 'passed'
            : index === wordIndex
              ? 'current'
              : 'future';
        element.dataset.wordState = state;
        element.style.setProperty('--lyrics-word-progress', state === 'passed' ? '1' : '0');
      });
      wordProgressRef.current = { lineKey, progressValue: null, wordIndex };
    }

    if (wordIndex >= 0) {
      const currentWord = wordElements[wordIndex];
      const progressValue = getWordProgress(words, wordIndex, adjustedPositionMs, fallbackLineEndMs).toFixed(4);
      if (wordProgressRef.current?.progressValue !== progressValue) {
        currentWord?.style.setProperty('--lyrics-word-progress', progressValue);
        wordProgressRef.current = { lineKey, progressValue, wordIndex };
      }
    }
  }, [getActiveWordElements, lyrics.lines, lyrics.offsetMs, resetWordHighlightCache, wordHighlightEnabled]);

  const syncPlaybackPosition = useCallback((): void => {
    const currentPositionMs = getInterpolatedPositionMs({
      durationMs,
      playbackRate,
      playbackState,
      positionMs,
      positionUpdatedAtMs,
    });
    const nextActiveIndex = calculateActiveIndex(
      lyrics.lines,
      currentPositionMs,
      lyrics.offsetMs,
      durationMs,
      isSynced,
      isPlain,
    );

    if (activeIndexRef.current !== nextActiveIndex) {
      activeIndexRef.current = nextActiveIndex;
      resetWordHighlightCache();
      setActiveIndex(nextActiveIndex);
    } else {
      syncActiveWordHighlight(currentPositionMs);
    }
  }, [
    durationMs,
    isPlain,
    isSynced,
    lyrics.lines,
    lyrics.offsetMs,
    playbackRate,
    playbackState,
    positionMs,
    positionUpdatedAtMs,
    resetWordHighlightCache,
    syncActiveWordHighlight,
  ]);

  const animateScrollTop = useCallback(
    (scrollContainer: HTMLElement, targetTop: number, durationMs: number): void => {
      stopScrollAnimation();
      const animationVersion = scrollAnimationVersionRef.current;

      const startTop = scrollContainer.scrollTop;
      const distance = targetTop - startTop;
      if (Math.abs(distance) < 1 || durationMs <= 0 || prefersReducedMotion()) {
        scrollContainer.scrollTop = targetTop;
        return;
      }

      const startedAt = getAnimationNow();
      const tick = (now: number): void => {
        if (animationVersion !== scrollAnimationVersionRef.current || scrollRef.current !== scrollContainer) {
          return;
        }

        const elapsed = now - startedAt;
        const progress = Math.min(1, elapsed / durationMs);
        scrollContainer.scrollTop = startTop + distance * easeInOutCubic(progress);

        if (progress < 1) {
          scrollAnimationFrameRef.current = requestLyricAnimationFrame(tick);
          return;
        }

        scrollAnimationFrameRef.current = null;
        scrollContainer.scrollTop = targetTop;
      };

      scrollAnimationFrameRef.current = requestLyricAnimationFrame(tick);
    },
    [stopScrollAnimation],
  );

  const centerActiveLyric = useCallback((mode: LyricScrollMode = 'animated'): boolean => {
    if (activeIndex < 0) {
      return false;
    }

    const scrollContainer = scrollRef.current;
    const activeLine = scrollContainer?.querySelector<HTMLButtonElement>('.lyrics-line[data-active="true"]');
    if (!scrollContainer || !activeLine) {
      return false;
    }

    const activeCenter = getActiveLineLayoutCenter(scrollContainer, activeLine);
    const targetCenter = scrollContainer.clientHeight * 0.52;
    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, activeCenter - targetCenter));

    if (mode === 'instant') {
      stopScrollAnimation();
      scrollContainer.scrollTop = nextScrollTop;
      return true;
    }

    animateScrollTop(scrollContainer, nextScrollTop, mode === 'recenter' ? 260 : 880);
    return true;
  }, [activeIndex, animateScrollTop, stopScrollAnimation]);

  const preserveActiveLyricPosition = useCallback((event: Event): void => {
    if (event.type === 'settings:changed' && event instanceof CustomEvent) {
      return;
    }

    if (event instanceof CustomEvent && event.detail && typeof event.detail === 'object' && !Array.isArray(event.detail)) {
      const hasLayoutSetting = Object.keys(event.detail as Record<string, unknown>).some((key) => lyricsLayoutSettingKeys.has(key));
      if (!hasLayoutSetting) {
        return;
      }
    }

    const scrollContainer = scrollRef.current;
    const activeLine = scrollContainer?.querySelector<HTMLButtonElement>('.lyrics-line[data-active="true"]');
    if (!scrollContainer || !activeLine) {
      return;
    }

    const previousTop = activeLine.getBoundingClientRect().top;
    stopScrollAnimation();
    if (activeCenterFrameRef.current !== null) {
      cancelLyricAnimationFrame(activeCenterFrameRef.current);
      activeCenterFrameRef.current = null;
    }
    if (layoutPreserveFrameRef.current !== null) {
      cancelLyricAnimationFrame(layoutPreserveFrameRef.current);
    }

    layoutPreserveFrameRef.current = requestLyricAnimationFrame(() => {
      layoutPreserveFrameRef.current = null;
      const nextActiveLine = scrollContainer.querySelector<HTMLButtonElement>('.lyrics-line[data-active="true"]');
      if (!nextActiveLine) {
        return;
      }

      const deltaTop = nextActiveLine.getBoundingClientRect().top - previousTop;
      if (Math.abs(deltaTop) > 0.5) {
        scrollContainer.scrollTop += deltaTop;
      }
    });
  }, [stopScrollAnimation]);

  useEffect(() => {
    stopWordAnimation();
    syncPlaybackPosition();

    if (!highFrequencyUpdatesEnabled || playbackState !== 'playing') {
      return undefined;
    }

    const tick = (): void => {
      syncPlaybackPosition();
      wordAnimationFrameRef.current = requestLyricAnimationFrame(tick);
    };

    wordAnimationFrameRef.current = requestLyricAnimationFrame(tick);
    return stopWordAnimation;
  }, [highFrequencyUpdatesEnabled, playbackState, stopWordAnimation, syncPlaybackPosition]);

  useEffect(() => {
    const currentPositionMs = getInterpolatedPositionMs({
      durationMs,
      playbackRate,
      playbackState,
      positionMs,
      positionUpdatedAtMs,
    });
    syncActiveWordHighlight(currentPositionMs);
  }, [
    activeIndex,
    durationMs,
    playbackRate,
    playbackState,
    positionMs,
    positionUpdatedAtMs,
    syncActiveWordHighlight,
  ]);

  useEffect(() => {
    if (lastLyricsLinesRef.current === lyrics.lines) {
      return;
    }

    lastLyricsLinesRef.current = lyrics.lines;
    hasCenteredActiveLyricRef.current = false;
    stopScrollAnimation();
    resetWordHighlightCache();
    setCenterRevision((revision) => revision + 1);
  }, [lyrics.lines, resetWordHighlightCache, stopScrollAnimation]);

  useEffect(() => {
    if (activeCenterFrameRef.current !== null) {
      cancelLyricAnimationFrame(activeCenterFrameRef.current);
      activeCenterFrameRef.current = null;
    }

    if (activeIndex < 0) {
      hasCenteredActiveLyricRef.current = false;
      lastCenteredActiveIndexRef.current = activeIndex;
      return undefined;
    }

    const previousCenteredActiveIndex = lastCenteredActiveIndexRef.current;
    const shouldJumpToSeekTarget =
      hasCenteredActiveLyricRef.current &&
      previousCenteredActiveIndex >= 0 &&
      activeIndex >= 0 &&
      (activeIndex < previousCenteredActiveIndex || Math.abs(activeIndex - previousCenteredActiveIndex) > 1);
    const scrollMode: LyricScrollMode =
      !hasCenteredActiveLyricRef.current || shouldJumpToSeekTarget ? 'instant' : 'animated';

    activeCenterFrameRef.current = requestLyricAnimationFrame(() => {
      activeCenterFrameRef.current = null;
      if (centerActiveLyric(scrollMode)) {
        hasCenteredActiveLyricRef.current = true;
        lastCenteredActiveIndexRef.current = activeIndex;
      }
    });

    return () => {
      if (activeCenterFrameRef.current !== null) {
        cancelLyricAnimationFrame(activeCenterFrameRef.current);
        activeCenterFrameRef.current = null;
      }
    };
  }, [activeIndex, centerActiveLyric, centerRevision]);

  useEffect(() => {
    window.addEventListener('settings:changed', preserveActiveLyricPosition);
    window.addEventListener('lyrics:display-settings-changed', preserveActiveLyricPosition);
    return () => {
      window.removeEventListener('settings:changed', preserveActiveLyricPosition);
      window.removeEventListener('lyrics:display-settings-changed', preserveActiveLyricPosition);
      if (layoutPreserveFrameRef.current !== null) {
        cancelLyricAnimationFrame(layoutPreserveFrameRef.current);
        layoutPreserveFrameRef.current = null;
      }
    };
  }, [preserveActiveLyricPosition]);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || activeIndex < 0) {
      return undefined;
    }

    const scheduleRecenter = (): void => {
      if (resizeFrameRef.current !== null) {
        cancelLyricAnimationFrame(resizeFrameRef.current);
      }

      resizeFrameRef.current = requestLyricAnimationFrame(() => {
        resizeFrameRef.current = null;
        centerActiveLyric('recenter');
      });
    };

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(scheduleRecenter)
        : null;
    observer?.observe(scrollContainer);
    window.addEventListener('resize', scheduleRecenter);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleRecenter);
      if (resizeFrameRef.current !== null) {
        cancelLyricAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, [activeIndex, centerActiveLyric]);

  useEffect(
    () => () => {
      stopScrollAnimation();
      stopWordAnimation();
      if (activeCenterFrameRef.current !== null) {
        cancelLyricAnimationFrame(activeCenterFrameRef.current);
        activeCenterFrameRef.current = null;
      }
      if (resizeFrameRef.current !== null) {
        cancelLyricAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      if (layoutPreserveFrameRef.current !== null) {
        cancelLyricAnimationFrame(layoutPreserveFrameRef.current);
        layoutPreserveFrameRef.current = null;
      }
    },
    [stopScrollAnimation, stopWordAnimation],
  );

  if (lyrics.lines.length === 0) {
    if (hideEmptyState) {
      return null;
    }

    return (
      <section className="lyrics-empty" aria-label="Lyrics">
        <Music2 size={26} />
        <strong>{lyrics.kind === 'instrumental' ? t('lyricsView.empty.instrumental') : t('lyricsView.empty.noLyrics')}</strong>
        {lyrics.kind === 'instrumental' ? <span>Instrumental track</span> : null}
      </section>
    );
  }

  return (
    <section
      className="lyrics-scroll"
      aria-label="Lyrics"
      data-kind={lyrics.kind}
      ref={scrollRef}
      onContextMenu={onContextMenu}
    >
      {lyrics.lines.map((line, index) => (
        <LyricsLine
          active={index === activeIndex}
          index={index}
          focusDistance={activeIndex >= 0 ? Math.abs(index - activeIndex) : 4}
          key={`${line.timeMs}-${index}`}
          line={line}
          past={activeIndex >= 0 && index < activeIndex}
          showRomanization={canShowRomanization}
          preferKanaPronunciation={preferKanaPronunciation}
          showTranslation={showTranslation}
          wordHighlightEnabled={wordHighlightEnabled && !prefersReducedMotion()}
          onSeek={onSeek}
          seekable={false}
        />
      ))}
    </section>
  );
};
