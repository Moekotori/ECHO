// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProgressiveRenderLimit } from './useProgressiveRenderLimit';

const Probe = ({ identityKey, itemCount }: { identityKey: string; itemCount: number }) => {
  const limit = useProgressiveRenderLimit({
    identityKey,
    itemCount,
    initialCount: 24,
    step: 48,
    delayMs: 80,
  });

  return <output aria-label="limit">{limit}</output>;
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useProgressiveRenderLimit', () => {
  it('returns an initial slice first, then expands on a timer', async () => {
    vi.useFakeTimers();

    render(<Probe identityKey="album-1" itemCount={60} />);

    expect(screen.getByLabelText('limit').textContent).toBe('24');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });

    expect(screen.getByLabelText('limit').textContent).toBe('60');
  });

  it('resets the first paint limit when the identity changes', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe identityKey="album-1" itemCount={60} />);

    expect(screen.getByLabelText('limit').textContent).toBe('24');

    rerender(<Probe identityKey="album-2" itemCount={10} />);

    expect(screen.getByLabelText('limit').textContent).toBe('10');
  });
});
