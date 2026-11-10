import type { CSSProperties } from 'react';
import type { ReadableColorSample } from '../lyricsReadableColor';
import { createAfterglowCoverPalette } from './afterglowCoverPalette';

/** Visual tokens only; playback state and commands remain in the shared player bar. */
export const createAfterglowCoverMiniPlayerPalette = (
  sample: ReadableColorSample | null,
  opacity: number,
): CSSProperties => {
  const palette = createAfterglowCoverPalette(sample);
  const alpha = Math.max(0.2, Math.min(1, opacity));

  return {
    '--lyrics-mini-player-background': `rgb(${palette['--afterglow-cover-bar-rgb']} / ${alpha.toFixed(2)})`,
    '--lyrics-mini-player-border': 'rgb(249 245 237 / 0.16)',
    '--lyrics-mini-player-readable-text': 'rgb(249 245 237)',
    '--lyrics-mini-player-readable-muted': 'rgb(249 245 237 / 0.78)',
    '--lyrics-mini-player-time-text': 'rgb(249 245 237)',
    '--lyrics-mini-player-progress-fill': `rgb(${palette['--afterglow-cover-accent-rgb']})`,
    '--lyrics-mini-player-readable-shadow': 'none',
    '--lyrics-mini-player-readable-button-bg': 'rgb(249 245 237 / 0.08)',
    '--lyrics-mini-player-readable-button-bg-hover': 'rgb(249 245 237 / 0.14)',
    '--lyrics-mini-player-readable-button-border': 'rgb(249 245 237 / 0.14)',
    '--lyrics-mini-player-readable-play-bg': 'rgb(249 245 237 / 0.16)',
    '--lyrics-mini-player-readable-play-bg-hover': 'rgb(249 245 237 / 0.22)',
    '--lyrics-mini-player-readable-play-border': 'rgb(249 245 237 / 0.20)',
    '--lyrics-mini-player-readable-track-bg': 'rgb(249 245 237 / 0.22)',
    '--lyrics-mini-player-readable-track-border': 'rgb(249 245 237 / 0.12)',
  } as CSSProperties;
};
