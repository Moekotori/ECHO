// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnimatedBackNavigation } from './useAnimatedBackNavigation';

type BackProbeProps = {
  enabled?: boolean;
  mounted?: boolean;
  onBack: () => void;
};

const BackProbe = ({ enabled = true, mounted = true, onBack }: BackProbeProps): JSX.Element => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useAnimatedBackNavigation(onBack, enabled, { durationMs: 80, rootRef });

  return mounted ? <div ref={rootRef}>Detail</div> : <div>Nested detail</div>;
};

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('useAnimatedBackNavigation', () => {
  it('ignores Escape when its explicitly scoped route surface is detached', () => {
    const onBack = vi.fn();
    render(<BackProbe mounted={false} onBack={onBack} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onBack).not.toHaveBeenCalled();
  });

  it('cancels a pending animated return when the detail layer is disabled', () => {
    vi.useFakeTimers();
    const onBack = vi.fn();
    const view = render(<BackProbe onBack={onBack} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    view.rerender(<BackProbe enabled={false} onBack={onBack} />);
    act(() => vi.advanceTimersByTime(80));

    expect(onBack).not.toHaveBeenCalled();
  });
});
