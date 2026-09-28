// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../../shared/types/audio';
import type { LyricsState } from './lyricsTypes';
import { LyricsOffsetControls, LyricsSmartAlignmentControls } from './LyricsTimingControls';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const lyrics: LyricsState = {
  kind: 'synced', source: 'local', offsetMs: 0,
  lines: [{ timeMs: 0, text: 'First' }, { timeMs: 10000, text: 'Second' }],
};
const settings = {
  lyricsOffsetControlsEnabled: true, lyricsTimelineCorrectionEnabled: true,
  lyricsGlobalSyncOffsetMs: 0, lyricsSmartAlignmentEnabled: true,
};

it('aligns the current line using the latest clock and keeps per-song offset actions', () => {
  const change = vi.fn().mockResolvedValue(undefined);
  const props = {
    trackId: 'track', lyrics, displayedLyrics: lyrics, lyricsDisplaySettings: settings,
    isLyricsOffsetSaving: false, handleLyricsOffsetChange: change,
  };
  const { rerender } = render(<LyricsOffsetControls {...props} lyricsPositionSeconds={1} />);
  rerender(<LyricsOffsetControls {...props} lyricsPositionSeconds={10.25} />);
  fireEvent.click(screen.getByRole('button', { name: '对齐当前句' }));
  expect(change).toHaveBeenLastCalledWith(-250);
  fireEvent.click(screen.getByRole('button', { name: '+100ms' }));
  expect(change).toHaveBeenLastCalledWith(100);
});

it('marks the latest smart-alignment position and preserves undo', () => {
  window.echo = { lyrics: { setOffset: vi.fn() } } as unknown as Window['echo'];
  const change = vi.fn().mockResolvedValue(undefined);
  const setAnchors = vi.fn();
  const props = {
    trackId: 'track', lyrics, lyricsDisplaySettings: settings, isLyricsOffsetSaving: false,
    handleLyricsOffsetChange: change, smartAlignmentEvaluation: null,
    smartAlignmentAutoState: { trackId: 'track', previousOffsetMs: 100, offsetMs: -250 },
    isSmartAlignmentSessionActive: true, smartAlignmentAnchors: [],
    setSmartAlignmentAnchors: setAnchors, setIsSmartAlignmentSessionActive: vi.fn(),
    setSmartAlignmentAutoState: vi.fn(), smartAlignmentAutoAppliedKeyRef: { current: 'applied' },
  };
  const status = { currentTrackId: 'track', outputMode: 'shared', positionSeconds: 1 } as AudioStatus;
  const { rerender } = render(<LyricsSmartAlignmentControls {...props} audioStatus={status} />);
  rerender(<LyricsSmartAlignmentControls {...props} audioStatus={{ ...status, positionSeconds: 10.25 }} />);
  fireEvent.click(screen.getByRole('button', { name: '标记当前句' }));
  expect(setAnchors.mock.calls[0][0]([])).toEqual([
    { lyricLineTimeMs: 10000, playbackMs: 10250, globalOffsetMs: 0, outputMode: 'shared' },
  ]);
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(change).toHaveBeenLastCalledWith(100, { source: 'smart-undo' });
});
