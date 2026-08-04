// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LyricsLine, getRenderableLyricWords } from './LyricsLine';

afterEach(() => {
  cleanup();
});

describe('LyricsLine', () => {
  const line = { timeMs: 1000, text: 'Sakura', romanization: 'sakura', translation: 'Cherry blossoms' };

  it('shows romanization when enabled', () => {
    render(<LyricsLine active={false} index={0} line={line} past={false} onSeek={vi.fn()} />);

    expect(screen.getByText('sakura')).toBeTruthy();
  });

  it('uses romanization instead of cached kana by default', () => {
    render(
      <LyricsLine
        active={false}
        index={0}
        line={{ ...line, kana: 'さくら' }}
        past={false}
        onSeek={vi.fn()}
      />,
    );

    expect(screen.getByText('sakura')).toBeTruthy();
    expect(screen.queryByText('さくら')).toBeNull();
  });

  it('prefers kana over romanization when requested', () => {
    render(
      <LyricsLine
        active={false}
        index={0}
        line={{ ...line, kana: 'さくら' }}
        past={false}
        preferKanaPronunciation
        onSeek={vi.fn()}
      />,
    );

    expect(screen.getByText('さくら')).toBeTruthy();
    expect(screen.queryByText('sakura')).toBeNull();
  });

  it('hides romanization when disabled', () => {
    render(<LyricsLine active={false} index={0} line={line} past={false} showRomanization={false} onSeek={vi.fn()} />);

    expect(screen.queryByText('sakura')).toBeNull();
    expect(screen.getByText('Sakura')).toBeTruthy();
  });

  it('shows translation when enabled', () => {
    render(<LyricsLine active={false} index={0} line={line} past={false} onSeek={vi.fn()} />);

    expect(screen.getByText('Cherry blossoms')).toBeTruthy();
  });

  it('hides translation when disabled', () => {
    render(<LyricsLine active={false} index={0} line={line} past={false} showTranslation={false} onSeek={vi.fn()} />);

    expect(screen.queryByText('Cherry blossoms')).toBeNull();
  });

  it('marks how many secondary lyric rows are visible', () => {
    const { container, rerender } = render(<LyricsLine active index={0} line={line} past={false} onSeek={vi.fn()} />);

    expect(container.querySelector('.lyrics-line')?.getAttribute('data-secondary-lines')).toBe('2');

    rerender(<LyricsLine active index={0} line={line} past={false} showTranslation={false} onSeek={vi.fn()} />);

    expect(container.querySelector('.lyrics-line')?.getAttribute('data-secondary-lines')).toBe('1');
  });

  it('renders timed words only when word highlighting is enabled', () => {
    const timedLine = {
      timeMs: 1000,
      text: 'Hello world',
      words: [
        { text: 'Hello ', startMs: 1000, endMs: 1500 },
        { text: 'world', startMs: 1500, endMs: null },
      ],
    };
    const { container, rerender } = render(
      <LyricsLine active index={0} line={timedLine} past={false} onSeek={vi.fn()} wordHighlightEnabled />,
    );

    expect(Array.from(container.querySelectorAll('.lyrics-word')).map((word) => word.textContent)).toEqual([
      'Hello ',
      'world',
    ]);
    expect(container.querySelector('.lyrics-line')?.getAttribute('data-word-highlight')).toBe('true');

    rerender(<LyricsLine active index={0} line={timedLine} past={false} onSeek={vi.fn()} wordHighlightEnabled={false} />);

    expect(container.querySelector('.lyrics-word')).toBeNull();
    expect(screen.getByText('Hello world')).toBeTruthy();
    expect(container.querySelector('.lyrics-line')?.getAttribute('data-word-highlight')).toBe('false');
  });

  it('preserves display spaces when timed words omit English spacing', () => {
    const timedLine = {
      timeMs: 1000,
      text: "You don't want my heart",
      words: [
        { text: 'You', startMs: 1000, endMs: 1200 },
        { text: "don't", startMs: 1200, endMs: 1500 },
        { text: 'want', startMs: 1500, endMs: 1800 },
        { text: 'my', startMs: 1800, endMs: 2000 },
        { text: 'heart', startMs: 2000, endMs: 2400 },
      ],
    };

    const { container } = render(
      <LyricsLine active index={0} line={timedLine} past={false} onSeek={vi.fn()} wordHighlightEnabled />,
    );

    const words = Array.from(container.querySelectorAll('.lyrics-word'));
    expect(words.map((word) => word.textContent).join('')).toBe("You don't want my heart");
    expect(container.querySelector('.lyrics-line')?.getAttribute('data-word-highlight')).toBe('true');
  });

  it('coalesces noisy character-level timings into calmer phrase marks', () => {
    const text = '世界中のすべて';
    const timedLine = {
      timeMs: 1000,
      text,
      words: Array.from(text).map((char, index) => ({
        text: char,
        startMs: 1000 + index * 180,
        endMs: 1000 + (index + 1) * 180,
      })),
    };

    const { container } = render(
      <LyricsLine active index={0} line={timedLine} past={false} onSeek={vi.fn()} wordHighlightEnabled />,
    );
    const words = Array.from(container.querySelectorAll('.lyrics-word'));

    expect(words.length).toBeGreaterThanOrEqual(2);
    expect(words.length).toBeLessThan(Array.from(text).length);
    expect(words.map((word) => word.textContent).join('')).toBe(text);
  });

  it('coalesces long word-timed lines instead of dropping highlighting', () => {
    const tokens = Array.from({ length: 30 }, (_, index) => `word${index + 1}`);
    const timedLine = {
      timeMs: 1000,
      text: tokens.join(' '),
      words: tokens.map((token, index) => ({
        text: index === tokens.length - 1 ? token : `${token} `,
        startMs: 1000 + index * 240,
        endMs: 1000 + (index + 1) * 240,
      })),
    };

    const renderableWords = getRenderableLyricWords(timedLine);

    expect(renderableWords).not.toBeNull();
    expect(renderableWords?.length).toBeLessThanOrEqual(18);
    expect(renderableWords?.map((word) => word.text).join('')).toBe(timedLine.text);
  });

  it('falls back to plain text when word timings are too jittery', () => {
    const timedLine = {
      timeMs: 1000,
      text: 'abcdef',
      words: Array.from('abcdef').map((char, index) => ({
        text: char,
        startMs: 1000 + index * 30,
        endMs: 1000 + (index + 1) * 30,
      })),
    };

    const { container } = render(
      <LyricsLine active index={0} line={timedLine} past={false} onSeek={vi.fn()} wordHighlightEnabled />,
    );

    expect(container.querySelector('.lyrics-word')).toBeNull();
    expect(screen.getByText('abcdef')).toBeTruthy();
    expect(container.querySelector('.lyrics-line')?.getAttribute('data-word-highlight')).toBe('false');
  });
});
