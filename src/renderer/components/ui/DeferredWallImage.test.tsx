// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { DeferredWallImage } from './DeferredWallImage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DeferredWallImage', () => {
  it('loads priority images immediately even when scrolling is active', () => {
    const { container } = render(<DeferredWallImage alt="" decoding="async" paused priority src="echo-cover://album/priority" />);

    expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('echo-cover://album/priority');
  });

  it('waits for scroll idle before starting non-priority images', async () => {
    const { container, rerender } = render(<DeferredWallImage alt="" paused src="echo-cover://album/deferred" />);

    expect(container.querySelector('img')).toBeNull();

    rerender(<DeferredWallImage alt="" paused={false} src="echo-cover://album/deferred" />);

    await waitFor(() => {
      expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('echo-cover://album/deferred');
    });
  });

  it('limits concurrent non-priority image starts', async () => {
    const { container } = render(
      <>
        {Array.from({ length: 12 }, (_, index) => (
          <DeferredWallImage alt="" key={index} src={`echo-cover://album/${index}`} />
        ))}
      </>,
    );

    await waitFor(() => {
      expect(container.querySelectorAll('img')).toHaveLength(8);
    });
  });
});
