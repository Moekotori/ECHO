// Explicitly hiding to the tray means the main UI is no longer visible. Park
// rebuildable renderer resources on the next task instead of retaining them
// behind a grace period; native playback remains owned by the audio host.
export const trayDeepParkingDelayMs = 0;
export const trayBackgroundResumeDelayMs = 2_000;
export const trayMemoryPostCleanupSampleDelayMs = 15_000;
export const trayMemorySettledSampleDelayMs = 120_000;
