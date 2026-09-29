export const normalPlaybackProgressRenderIntervalMs = 125;
export const unfocusedPlaybackProgressRenderIntervalMs = 250;
export const lowLoadPlaybackProgressRenderIntervalMs = 1000;

export const resolvePlaybackProgressRenderIntervalMs = (
  lowLoadPlaybackModeEnabled: boolean,
  windowFocused: boolean,
): number => {
  if (lowLoadPlaybackModeEnabled) {
    return lowLoadPlaybackProgressRenderIntervalMs;
  }

  return windowFocused
    ? normalPlaybackProgressRenderIntervalMs
    : unfocusedPlaybackProgressRenderIntervalMs;
};

export const startPlaybackProgressUpdates = (
  update: () => void,
  lowLoadPlaybackModeEnabled: boolean,
  windowFocused: boolean,
): (() => void) => {
  update();
  const timerId = window.setInterval(
    update,
    resolvePlaybackProgressRenderIntervalMs(lowLoadPlaybackModeEnabled, windowFocused),
  );

  return () => {
    window.clearInterval(timerId);
  };
};
