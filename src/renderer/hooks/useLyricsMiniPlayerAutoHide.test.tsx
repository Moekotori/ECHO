// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLyricsMiniPlayerAutoHide } from './useLyricsMiniPlayerAutoHide';

const Harness = ({ enabled = true, queueOpen = false }: { enabled?: boolean; queueOpen?: boolean }): JSX.Element => {
  const ref = useRef<HTMLDivElement>(null);
  const hidden = useLyricsMiniPlayerAutoHide(ref, enabled, queueOpen);
  return <div ref={ref} data-hidden={String(hidden)}><button aria-expanded="false">Menu</button></div>;
};
const advance = (ms = 320): void => { act(() => vi.advanceTimersByTime(ms)); };
const move = (x: number, y: number): void => { fireEvent.mouseMove(window, { clientX: x, clientY: y }); advance(20); };

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('lyrics mini player auto hide', () => {
  it('hides after a delay, reveals near the bottom and cancels a pending hide on return', () => {
    const { container } = render(<Harness />);
    const host = container.firstElementChild!;
    advance(200);
    expect(host.getAttribute('data-hidden')).toBe('false');
    advance(100);
    expect(host.getAttribute('data-hidden')).toBe('true');
    move(500, window.innerHeight - 8);
    expect(host.getAttribute('data-hidden')).toBe('false');
    move(1, 1);
    advance(150);
    move(500, window.innerHeight - 8);
    advance();
    expect(host.getAttribute('data-hidden')).toBe('false');
    move(1, 1);
    advance();
    expect(host.getAttribute('data-hidden')).toBe('true');
  });

  it('keeps a portalled menu open and resumes hiding when its trigger closes', async () => {
    const { container } = render(<Harness />);
    const host = container.firstElementChild!;
    const button = host.querySelector('button')!;
    move(1, 1);
    await act(async () => { button.setAttribute('aria-expanded', 'true'); });
    advance();
    expect(host.getAttribute('data-hidden')).toBe('false');
    await act(async () => { button.setAttribute('aria-expanded', 'false'); });
    advance();
    expect(host.getAttribute('data-hidden')).toBe('true');
  });

  it('keeps pointer drags visible outside the bar until release', () => {
    const { container } = render(<Harness />);
    const host = container.firstElementChild!;
    fireEvent.pointerDown(host);
    move(1, 1);
    advance();
    expect(host.getAttribute('data-hidden')).toBe('false');
    fireEvent.pointerUp(window);
    advance();
    expect(host.getAttribute('data-hidden')).toBe('true');
  });

  it('stays visible for the queue or when disabled and cleans up pending timers', () => {
    const { container, rerender, unmount } = render(<Harness queueOpen />);
    const host = container.firstElementChild!;
    move(1, 1);
    advance();
    expect(host.getAttribute('data-hidden')).toBe('false');
    rerender(<Harness />);
    advance();
    expect(host.getAttribute('data-hidden')).toBe('true');
    rerender(<Harness enabled={false} />);
    advance();
    expect(host.getAttribute('data-hidden')).toBe('false');
    rerender(<Harness />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hides when the pointer leaves the window', () => {
    const { container } = render(<Harness />);
    const host = container.firstElementChild!;
    move(500, window.innerHeight - 8);
    fireEvent.mouseLeave(document.documentElement);
    advance();
    expect(host.getAttribute('data-hidden')).toBe('true');
  });
});
