import type { AudioStatus } from '../../shared/types/audio';
import { updateTaskbarHostState } from './taskbarHostProcess';

/** Keep the existing native player current without rebuilding a renderer. */
export class UltraLightNativeTaskbar {
  private lastKey: string | null = null;

  update(status: AudioStatus): void {
    // Position ticks can arrive much faster than the small native display needs.
    const key = JSON.stringify([
      status.currentTrackId, status.currentFilePath, status.currentTrackTitle,
      status.currentTrackArtist, status.currentTrackAlbumArtist, status.state,
      Math.floor(status.positionSeconds), status.durationSeconds,
    ]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    updateTaskbarHostState({
      title: status.currentTrackTitle || status.currentFilePath?.split(/[\\/]/u).pop() || 'ECHO',
      artist: status.currentTrackArtist || status.currentTrackAlbumArtist || '',
      playing: status.state === 'playing' || status.state === 'loading',
      position: status.positionSeconds,
      duration: status.durationSeconds,
      // The renderer-owned artwork and lyric presentation is no longer current.
      coverPath: '',
      lyrics: '',
    });
  }

  reset(): void {
    this.lastKey = null;
  }
}
