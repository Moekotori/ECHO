// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { LyricsView, getActiveLyricIndex } from './LyricsView';
import type { LyricsState } from './lyricsTypes';

const makeRect = (top: number, height: number): DOMRect => ({
  bottom: top + height,
  height,
  left: 0,
  right: 320,
  top,
  width: 320,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

const setLayoutNumber = (element: HTMLElement, property: 'clientHeight' | 'scrollHeight' | 'offsetHeight' | 'offsetTop', value: number): void => {
  Object.defineProperty(element, property, { configurable: true, value });
};

const lyrics: LyricsState = {
  kind: 'synced',
  source: 'placeholder',
  offsetMs: 0,
  lines: [
    { timeMs: 0, text: 'First line' },
    { timeMs: 1000, text: 'Second line' },
    { timeMs: 2000, text: 'Third line' },
  ],
};

const wordLyrics: LyricsState = {
  kind: 'synced',
  source: 'placeholder',
  offsetMs: 0,
  lines: [
    {
      timeMs: 1000,
      text: 'Hello world',
      words: [
        { text: 'Hello ', startMs: 1000, endMs: 1500 },
        { text: 'world', startMs: 1500, endMs: 2000 },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LyricsView', () => {
  it('keeps active line lookup stable when synced lines include untimed rows', () => {
    expect(getActiveLyricIndex([
      { timeMs: 1000, text: 'First' },
      { timeMs: -1, text: 'Untimed note' },
      { timeMs: 2000, text: 'Second' },
    ], 1500, 0)).toBe(0);
  });

  it('aligns word highlight immediately after seeking', async () => {
    const { container } = render(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={wordLyrics}
        playbackState="paused"
        positionMs={1250}
        positionUpdatedAtMs={0}
        onSeek={vi.fn()}
      />,
    );

    await waitFor(() => {
      const currentWord = container.querySelector<HTMLElement>('.lyrics-word[data-word-state="current"]');
      expect(currentWord?.textContent).toBe('Hello ');
      expect(currentWord?.style.getPropertyValue('--lyrics-word-progress')).toBe('0.5000');
    });
  });

  it('does not advance word highlight while paused', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1750);

    const { container } = render(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={wordLyrics}
        playbackState="paused"
        positionMs={1250}
        positionUpdatedAtMs={0}
        onSeek={vi.fn()}
      />,
    );

    await waitFor(() => {
      const currentWord = container.querySelector<HTMLElement>('.lyrics-word[data-word-state="current"]');
      expect(currentWord?.style.getPropertyValue('--lyrics-word-progress')).toBe('0.5000');
    });
  });

  it('uses the next lyric line to pace an open-ended final word', async () => {
    const openEndedLyrics: LyricsState = {
      kind: 'synced',
      source: 'placeholder',
      offsetMs: 0,
      lines: [
        {
          timeMs: 1000,
          text: 'Hello world',
          words: [
            { text: 'Hello ', startMs: 1000, endMs: 1500 },
            { text: 'world', startMs: 1500, endMs: null },
          ],
        },
        { timeMs: 2500, text: 'Next line' },
      ],
    };

    const { container } = render(
      <LyricsView
        durationMs={4000}
        hideEmptyState={false}
        lyrics={openEndedLyrics}
        playbackState="paused"
        positionMs={2000}
        positionUpdatedAtMs={0}
        onSeek={vi.fn()}
      />,
    );

    await waitFor(() => {
      const currentWord = container.querySelector<HTMLElement>('.lyrics-word[data-word-state="current"]');
      expect(currentWord?.textContent).toBe('world');
      expect(currentWord?.style.getPropertyValue('--lyrics-word-progress')).toBe('0.5000');
    });
  });

  it('keeps ordinary line rendering when word highlight is disabled', () => {
    const { container } = render(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={wordLyrics}
        positionMs={1250}
        wordHighlightEnabled={false}
        onSeek={vi.fn()}
      />,
    );

    expect(container.querySelector('.lyrics-word')).toBeNull();
    expect(container.textContent).toContain('Hello world');
  });

  it('hides romanization for Chinese-only lyrics even when cached lines contain it', () => {
    const chineseLyrics: LyricsState = {
      kind: 'synced',
      source: 'cached',
      offsetMs: 0,
      lines: [
        {
          timeMs: 1000,
          text: '还为分手前那句抱歉在感动',
          romanization: '还 为 bun temae 那 ku 抱 歉 zai kan 动',
        },
      ],
    };

    const { container } = render(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={chineseLyrics}
        positionMs={1000}
        onSeek={vi.fn()}
      />,
    );

    expect(container.textContent).toContain('还为分手前那句抱歉在感动');
    expect(container.textContent).not.toContain('bun temae');
    expect(container.querySelector('.lyrics-line')?.getAttribute('data-secondary-lines')).toBe('0');
  });

  it('keeps romanization visible when Japanese kana appears in the lyric set', () => {
    const japaneseLyrics: LyricsState = {
      kind: 'synced',
      source: 'cached',
      offsetMs: 0,
      lines: [
        { timeMs: 1000, text: '夢', romanization: 'yume' },
        { timeMs: 2000, text: '君が好き', romanization: 'kimi ga suki' },
      ],
    };

    const { container } = render(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={japaneseLyrics}
        positionMs={1000}
        onSeek={vi.fn()}
      />,
    );

    expect(container.textContent).toContain('yume');
    expect(container.textContent).toContain('kimi ga suki');
  });

  it('updates word progress through animation frames while keeping the active line mounted', async () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const { container } = render(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={wordLyrics}
        playbackRate={1}
        playbackState="playing"
        positionMs={1000}
        positionUpdatedAtMs={1000}
        onSeek={vi.fn()}
      />,
    );
    const activeLine = container.querySelector('.lyrics-line[data-active="true"]');

    vi.mocked(performance.now).mockReturnValue(1250);
    act(() => {
      const callbacks = Array.from(frames.entries());
      frames.clear();
      for (const [, callback] of callbacks) {
        callback(1250);
      }
    });

    await waitFor(() => {
      const currentWord = container.querySelector<HTMLElement>('.lyrics-word[data-word-state="current"]');
      expect(currentWord?.style.getPropertyValue('--lyrics-word-progress')).toBe('0.5000');
    });
    expect(container.querySelector('.lyrics-line[data-active="true"]')).toBe(activeLine);
  });

  it('does not advance word progress with high-frequency updates disabled', async () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const { container } = render(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={wordLyrics}
        playbackRate={1}
        playbackState="playing"
        positionMs={1000}
        positionUpdatedAtMs={1000}
        highFrequencyUpdatesEnabled={false}
        onSeek={vi.fn()}
      />,
    );

    await waitFor(() => {
      const currentWord = container.querySelector<HTMLElement>('.lyrics-word[data-word-state="current"]');
      expect(currentWord?.style.getPropertyValue('--lyrics-word-progress')).toBe('0.0000');
    });

    vi.mocked(performance.now).mockReturnValue(1250);
    act(() => {
      const callbacks = Array.from(frames.entries());
      frames.clear();
      for (const [, callback] of callbacks) {
        callback(1250);
      }
    });

    const currentWord = container.querySelector<HTMLElement>('.lyrics-word[data-word-state="current"]');
    expect(currentWord?.style.getPropertyValue('--lyrics-word-progress')).toBe('0.0000');
  });

  it('centers immediately when seeking backward to an earlier lyric line', async () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });

    const longLyrics: LyricsState = {
      ...lyrics,
      lines: [
        { timeMs: 0, text: 'First line' },
        { timeMs: 1000, text: 'Second line' },
        { timeMs: 2000, text: 'Third line' },
        { timeMs: 3000, text: 'Fourth line' },
        { timeMs: 4000, text: 'Fifth line' },
      ],
    };
    const { container, rerender } = render(
      <LyricsView
        durationMs={5000}
        hideEmptyState={false}
        lyrics={longLyrics}
        playbackState="paused"
        positionMs={4000}
        onSeek={vi.fn()}
      />,
    );
    const scrollContainer = container.querySelector('.lyrics-scroll') as HTMLElement;

    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 1200 });
    scrollContainer.getBoundingClientRect = vi.fn(() => makeRect(0, 400));

    act(() => {
      for (const [id, callback] of Array.from(frames.entries())) {
        frames.delete(id);
        callback(16);
      }
    });
    frames.clear();
    scrollContainer.scrollTop = 200;

    rerender(
      <LyricsView
        durationMs={5000}
        hideEmptyState={false}
        lyrics={longLyrics}
        playbackState="paused"
        positionMs={2000}
        onSeek={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.lyrics-line[data-active="true"]')?.textContent).toContain('Third line');
    });
    const activeLine = container.querySelector('.lyrics-line[data-active="true"]') as HTMLButtonElement;
    activeLine.getBoundingClientRect = vi.fn(() => makeRect(80, 42));

    act(() => {
      for (const [id, callback] of Array.from(frames.entries())) {
        frames.delete(id);
        callback(32);
      }
    });

    expect(scrollContainer.scrollTop).toBe(93);
    expect(frames.size).toBe(0);
  });

  it('centers from layout coordinates so line transform transitions do not change the target', () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });

    const { container } = render(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={lyrics}
        playbackState="paused"
        positionMs={1000}
        onSeek={vi.fn()}
      />,
    );
    const scrollContainer = container.querySelector('.lyrics-scroll') as HTMLElement;
    const activeLine = container.querySelector('.lyrics-line[data-active="true"]') as HTMLButtonElement;

    setLayoutNumber(scrollContainer, 'clientHeight', 200);
    setLayoutNumber(scrollContainer, 'scrollHeight', 1000);
    setLayoutNumber(activeLine, 'offsetTop', 300);
    setLayoutNumber(activeLine, 'offsetHeight', 40);
    scrollContainer.getBoundingClientRect = vi.fn(() => makeRect(0, 200));
    activeLine.getBoundingClientRect = vi.fn(() => makeRect(820, 40));

    act(() => {
      for (const [id, callback] of Array.from(frames.entries())) {
        frames.delete(id);
        callback(16);
      }
    });

    expect(scrollContainer.scrollTop).toBe(216);
    expect(frames.size).toBe(0);
  });

  it('recenters immediately when the lyric set changes but the active index stays the same', async () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const nextLyrics: LyricsState = {
      ...lyrics,
      lines: [
        { timeMs: 0, text: 'New first line' },
        { timeMs: 1000, text: 'New second line' },
        { timeMs: 2000, text: 'New third line' },
      ],
    };

    const { container, rerender } = render(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={lyrics}
        playbackState="paused"
        positionMs={1000}
        onSeek={vi.fn()}
      />,
    );
    const scrollContainer = container.querySelector('.lyrics-scroll') as HTMLElement;
    setLayoutNumber(scrollContainer, 'clientHeight', 200);
    setLayoutNumber(scrollContainer, 'scrollHeight', 1000);

    let activeLine = container.querySelector('.lyrics-line[data-active="true"]') as HTMLButtonElement;
    setLayoutNumber(activeLine, 'offsetTop', 300);
    setLayoutNumber(activeLine, 'offsetHeight', 40);
    act(() => {
      for (const [id, callback] of Array.from(frames.entries())) {
        frames.delete(id);
        callback(16);
      }
    });
    scrollContainer.scrollTop = 620;

    rerender(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={nextLyrics}
        playbackState="paused"
        positionMs={1000}
        onSeek={vi.fn()}
      />,
    );

    await waitFor(() => expect(frames.size).toBeGreaterThan(0));
    activeLine = container.querySelector('.lyrics-line[data-active="true"]') as HTMLButtonElement;
    setLayoutNumber(activeLine, 'offsetTop', 300);
    setLayoutNumber(activeLine, 'offsetHeight', 40);

    act(() => {
      for (const [id, callback] of Array.from(frames.entries())) {
        frames.delete(id);
        callback(32);
      }
    });

    expect(container.querySelector('.lyrics-line[data-active="true"]')?.textContent).toContain('New second line');
    expect(scrollContainer.scrollTop).toBe(216);
    expect(frames.size).toBe(0);
  });

  it('preserves the active lyric screen position when display settings change', () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });

    const { container } = render(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={lyrics}
        positionMs={1000}
        onSeek={vi.fn()}
      />,
    );
    const scrollContainer = container.querySelector('.lyrics-scroll') as HTMLElement;
    const activeLine = container.querySelector('.lyrics-line[data-active="true"]') as HTMLButtonElement;
    let activeTop = 200;

    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 1200 });
    scrollContainer.getBoundingClientRect = vi.fn(() => makeRect(0, 400));
    activeLine.getBoundingClientRect = vi.fn(() => makeRect(activeTop, 42));
    scrollContainer.scrollTop = 120;

    act(() => {
      window.dispatchEvent(new CustomEvent('lyrics:display-settings-changed', { detail: { lyricsFontSizePx: 44 } }));
    });

    activeTop = 164;
    act(() => {
      for (const [id, callback] of Array.from(frames.entries())) {
        frames.delete(id);
        callback(16);
      }
    });

    expect(scrollContainer.scrollTop).toBe(84);
  });

  it('ignores persisted settings payloads because display preview events handle lyric layout changes', () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });

    const { container } = render(
      <LyricsView
        durationMs={3000}
        hideEmptyState={false}
        lyrics={lyrics}
        positionMs={1000}
        onSeek={vi.fn()}
      />,
    );
    const scrollContainer = container.querySelector('.lyrics-scroll') as HTMLElement;
    const activeLine = container.querySelector('.lyrics-line[data-active="true"]') as HTMLButtonElement;
    let activeTop = 200;

    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 1200 });
    scrollContainer.getBoundingClientRect = vi.fn(() => makeRect(0, 400));
    activeLine.getBoundingClientRect = vi.fn(() => makeRect(activeTop, 42));
    scrollContainer.scrollTop = 120;

    act(() => {
      for (const [id, callback] of Array.from(frames.entries())) {
        frames.delete(id);
        callback(16);
      }
    });
    scrollContainer.scrollTop = 120;

    act(() => {
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: { lyricsFontSizePx: 44 } }));
    });

    activeTop = 164;
    act(() => {
      for (const [id, callback] of Array.from(frames.entries())) {
        frames.delete(id);
        callback(16);
      }
    });

    expect(scrollContainer.scrollTop).toBe(120);
  });
});
