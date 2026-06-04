import { describe, expect, it } from 'vitest';
import {
  createRecommendedGlobalShortcuts,
  createRecommendedLocalShortcuts,
  validateGlobalShortcutAccelerator,
} from './globalShortcuts';

describe('recommended shortcuts', () => {
  it('keeps common playback shortcuts simple and valid', () => {
    const localShortcuts = createRecommendedLocalShortcuts();
    const globalShortcuts = createRecommendedGlobalShortcuts();

    expect(localShortcuts.previousTrack).toEqual({ enabled: false, accelerator: 'Ctrl+K' });
    expect(localShortcuts.nextTrack).toEqual({ enabled: false, accelerator: 'Ctrl+J' });
    expect(globalShortcuts.playPause).toEqual({ enabled: false, accelerator: 'Ctrl+Space' });
    expect(globalShortcuts.previousTrack).toEqual({ enabled: false, accelerator: 'Ctrl+K' });
    expect(globalShortcuts.nextTrack).toEqual({ enabled: false, accelerator: 'Ctrl+J' });
    expect(globalShortcuts.openAudioSettings).toEqual({ enabled: false, accelerator: null });
    expect(globalShortcuts.openMvSettings).toEqual({ enabled: false, accelerator: null });
    expect(globalShortcuts.openLyricsSettings).toEqual({ enabled: false, accelerator: null });
    expect(localShortcuts.locateCurrentTrack).toEqual({ enabled: false, accelerator: null });
    expect(globalShortcuts.locateCurrentTrack).toEqual({ enabled: false, accelerator: null });
    expect(localShortcuts.toggleDesktopLyrics).toEqual({ enabled: false, accelerator: null });
    expect(globalShortcuts.toggleDesktopLyrics).toEqual({ enabled: false, accelerator: null });

    for (const binding of [...Object.values(localShortcuts), ...Object.values(globalShortcuts)]) {
      if (binding.accelerator) {
        expect(validateGlobalShortcutAccelerator(binding.accelerator).valid).toBe(true);
      }
    }
  });

  it('keeps numpad keys distinct from top-row number keys', () => {
    expect(validateGlobalShortcutAccelerator('Ctrl+Alt+Numpad1')).toEqual({
      accelerator: 'Ctrl+Alt+num1',
      available: true,
      reason: 'available',
      valid: true,
    });
    expect(validateGlobalShortcutAccelerator('Ctrl+Alt+num1')).toEqual({
      accelerator: 'Ctrl+Alt+num1',
      available: true,
      reason: 'available',
      valid: true,
    });
  });
});
