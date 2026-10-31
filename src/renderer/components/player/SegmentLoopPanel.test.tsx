// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SegmentLoopPanel } from './SegmentLoopPanel';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('SegmentLoopPanel', () => {
  it('saves the current A-B range as a per-track bookmark', () => {
    const onSeek = vi.fn();
    const { rerender } = render(
      <SegmentLoopPanel
        artist="Loop Artist"
        disabled={false}
        durationSeconds={120}
        isPlaying={false}
        positionSeconds={12.3}
        title="Loop Song"
        trackKey="track-1"
        onSeek={onSeek}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    rerender(
      <SegmentLoopPanel
        artist="Loop Artist"
        disabled={false}
        durationSeconds={120}
        isPlaying={false}
        positionSeconds={24.8}
        title="Loop Song"
        trackKey="track-1"
        onSeek={onSeek}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    fireEvent.click(screen.getByRole('button', { name: /保存当前片段书签|Save current segment bookmark/u }));

    const stored = JSON.parse(window.localStorage.getItem('echo-next:segment-bookmarks:v1') ?? '{}') as Record<string, Array<{ title: string; startSeconds: number; endSeconds: number }>>;
    expect(stored['track-1']?.[0]).toMatchObject({
      title: 'Loop Song',
      startSeconds: 12.3,
      endSeconds: 24.8,
    });
  });

  it('seeks back to point A when playback reaches point B', () => {
    const onSeek = vi.fn();
    const { rerender } = render(
      <SegmentLoopPanel
        artist="Loop Artist"
        disabled={false}
        durationSeconds={120}
        isPlaying={false}
        positionSeconds={10}
        title="Loop Song"
        trackKey="track-1"
        onSeek={onSeek}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    rerender(
      <SegmentLoopPanel
        artist="Loop Artist"
        disabled={false}
        durationSeconds={120}
        isPlaying={false}
        positionSeconds={15}
        title="Loop Song"
        trackKey="track-1"
        onSeek={onSeek}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    fireEvent.click(screen.getByRole('button', { name: /切换 A-B 循环|Toggle A-B loop/u }));

    rerender(
      <SegmentLoopPanel
        artist="Loop Artist"
        disabled={false}
        durationSeconds={120}
        isPlaying
        positionSeconds={14.95}
        title="Loop Song"
        trackKey="track-1"
        onSeek={onSeek}
      />,
    );

    expect(onSeek).toHaveBeenCalledWith(10);
  });
});
