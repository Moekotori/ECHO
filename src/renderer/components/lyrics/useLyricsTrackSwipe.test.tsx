// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLyricsTrackSwipeTriggerPx,
  resolveLyricsTrackSwipeDirection,
  useLyricsTrackSwipe,
  type LyricsTrackSwipeDirection,
} from './useLyricsTrackSwipe';

const SwipeHarness = ({
  enabled = true,
  onSwipe,
}: {
  enabled?: boolean;
  onSwipe: (direction: LyricsTrackSwipeDirection) => void;
}): JSX.Element => {
  const swipe = useLyricsTrackSwipe(onSwipe, enabled);

  return (
    <div data-testid="surface" {...swipe.handlers}>
      <button type="button">Control</button>
      <button className="lyrics-line" data-testid="line" type="button">
        <span data-lyrics-line-hit-target="true">Lyric text</span>
      </button>
    </div>
  );
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useLyricsTrackSwipe', () => {
  it('maps a deliberate horizontal mouse drag to one track command', () => {
    vi.useFakeTimers();
    const onSwipe = vi.fn();
    render(<SwipeHarness onSwipe={onSwipe} />);
    const surface = screen.getByTestId('surface');

    fireEvent.pointerDown(surface, { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 120 });
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: 'mouse', clientX: 130, clientY: 126 });

    expect(surface.dataset.lyricsTrackSwipeDirection).toBe('next');
    expect(surface.dataset.lyricsTrackSwipePhase).toBe('ready');
    expect(surface.style.getPropertyValue('--lyrics-track-swipe-offset')).toBe('-168.0px');

    fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'mouse', clientX: 130, clientY: 126 });
    expect(onSwipe).toHaveBeenCalledOnce();
    expect(onSwipe).toHaveBeenCalledWith('next');

    vi.advanceTimersByTime(180);
    expect(surface.dataset.lyricsTrackSwipeDirection).toBeUndefined();
  });

  it('ignores vertical movement, short drags, controls, and lyric text', () => {
    const onSwipe = vi.fn();
    render(<SwipeHarness onSwipe={onSwipe} />);
    const surface = screen.getByTestId('surface');
    const control = screen.getByRole('button', { name: 'Control' });
    const text = screen.getByText('Lyric text');
    const line = screen.getByTestId('line');

    fireEvent.pointerDown(surface, { button: 0, pointerId: 2, pointerType: 'mouse', clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 2, pointerType: 'mouse', clientX: 112, clientY: 180 });
    fireEvent.pointerUp(surface, { pointerId: 2, pointerType: 'mouse', clientX: 112, clientY: 180 });

    fireEvent.pointerDown(control, { button: 0, pointerId: 4, pointerType: 'mouse', clientX: 200, clientY: 100 });
    fireEvent.pointerMove(control, { pointerId: 4, pointerType: 'mouse', clientX: 20, clientY: 100 });
    fireEvent.pointerUp(control, { pointerId: 4, pointerType: 'mouse', clientX: 20, clientY: 100 });

    fireEvent.pointerDown(text, { button: 0, pointerId: 9, pointerType: 'mouse', clientX: 300, clientY: 100 });
    fireEvent.pointerMove(text, { pointerId: 9, pointerType: 'mouse', clientX: 120, clientY: 104 });
    fireEvent.pointerUp(text, { pointerId: 9, pointerType: 'mouse', clientX: 120, clientY: 104 });

    fireEvent.pointerDown(line, { button: 0, pointerId: 10, pointerType: 'mouse', clientX: 300, clientY: 100 });
    fireEvent.pointerMove(line, { pointerId: 10, pointerType: 'mouse', clientX: 120, clientY: 104 });
    fireEvent.pointerUp(line, { pointerId: 10, pointerType: 'mouse', clientX: 120, clientY: 104 });

    expect(onSwipe).toHaveBeenCalledOnce();
    expect(onSwipe).toHaveBeenCalledWith('next');
  });

  it('scales the lyrics threshold and rejects the old short-drag range', () => {
    expect(getLyricsTrackSwipeTriggerPx(1_000)).toBe(180);
    expect(resolveLyricsTrackSwipeDirection(120, 0)).toBeNull();
    expect(resolveLyricsTrackSwipeDirection(-144, 0)).toBe('next');
  });
});
