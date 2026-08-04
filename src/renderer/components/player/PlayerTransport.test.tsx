// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlayerTransport } from './PlayerTransport';

const defaultProps = {
  isPlaying: false,
  isShuffleEnabled: false,
  repeatMode: 'off' as const,
  canGoPrevious: true,
  canGoNext: true,
  onPlayPause: vi.fn(),
  onPrevious: vi.fn(),
  onNext: vi.fn(),
  onToggleShuffle: vi.fn(),
  onCycleRepeatMode: vi.fn(),
  onOpenLyrics: vi.fn(),
  onOpenMv: vi.fn(),
};

afterEach(() => {
  cleanup();
});

describe('PlayerTransport', () => {
  it('presents repeat as order playback or single repeat only', () => {
    const onCycleRepeatMode = vi.fn();
    const { rerender } = render(<PlayerTransport {...defaultProps} onCycleRepeatMode={onCycleRepeatMode} />);

    const repeatButton = screen.getByRole('button', { name: '循环模式' });
    expect(repeatButton.getAttribute('aria-pressed')).toBe('false');
    expect(repeatButton.getAttribute('title')).toBe('顺序播放');

    fireEvent.click(repeatButton);
    expect(onCycleRepeatMode).toHaveBeenCalledTimes(1);

    rerender(<PlayerTransport {...defaultProps} repeatMode="one" onCycleRepeatMode={onCycleRepeatMode} />);
    expect(screen.getByRole('button', { name: '循环模式' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '循环模式' }).getAttribute('title')).toBe('单曲循环');
  });

  it('opens MV from the dedicated transport button', () => {
    const onOpenMv = vi.fn();
    const onOpenLyrics = vi.fn();
    render(<PlayerTransport {...defaultProps} onOpenLyrics={onOpenLyrics} onOpenMv={onOpenMv} />);

    fireEvent.click(screen.getByRole('button', { name: 'MV' }));

    expect(onOpenMv).toHaveBeenCalledTimes(1);
    expect(onOpenLyrics).not.toHaveBeenCalled();
  });

  it('marks the liked button for visible confirmation when the current track is liked', () => {
    render(<PlayerTransport {...defaultProps} canLikeCurrentTrack isCurrentTrackLiked />);

    const likeButton = screen.getByRole('button', { name: '取消喜欢当前歌曲' });

    expect(likeButton.className).toContain('transport-like-button');
    expect(likeButton.className).toContain('is-soft-active');
    expect(likeButton.getAttribute('aria-pressed')).toBe('true');
  });
});
