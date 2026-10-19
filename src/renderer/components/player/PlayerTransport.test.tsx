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
  onCyclePlaybackMode: vi.fn(),
  onOpenLyrics: vi.fn(),
  onOpenMv: vi.fn(),
};

afterEach(() => cleanup());

describe('PlayerTransport', () => {
  it('uses one mode control and reflects shuffle and single-repeat state', () => {
    const cycle = vi.fn();
    const { rerender } = render(<PlayerTransport {...defaultProps} onCyclePlaybackMode={cycle} />);
    fireEvent.click(screen.getByRole('button', { name: '顺序播放' }));
    expect(cycle).toHaveBeenCalledTimes(1);
    rerender(<PlayerTransport {...defaultProps} isShuffleEnabled />);
    expect(screen.getByRole('button', { name: '随机播放' }).getAttribute('aria-pressed')).toBe('true');
    rerender(<PlayerTransport {...defaultProps} repeatMode="one" />);
    expect(screen.getByRole('button', { name: '单曲循环' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps MV directly accessible beside lyrics', () => {
    const onOpenMv = vi.fn();
    const onOpenLyrics = vi.fn();
    render(<PlayerTransport {...defaultProps} onOpenLyrics={onOpenLyrics} onOpenMv={onOpenMv} />);
    const lyricsButton = screen.getByRole('button', { name: '歌词' });
    fireEvent.click(lyricsButton);
    fireEvent.click(screen.getByRole('button', { name: 'MV' }));
    expect(onOpenLyrics).toHaveBeenCalledTimes(1);
    expect(onOpenMv).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'MV' }).closest('.transport')).not.toBeNull();
  });

  it('marks the liked button for visible confirmation when the current track is liked', () => {
    render(<PlayerTransport {...defaultProps} canLikeCurrentTrack isCurrentTrackLiked />);
    const likeButton = screen.getByRole('button', { name: '取消喜欢当前歌曲' });
    expect(likeButton.className).toContain('is-soft-active');
    expect(likeButton.getAttribute('aria-pressed')).toBe('true');
  });
});
