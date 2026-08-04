export const mvDiagnosticsStorageKey = 'echo:mv:show-diagnostics-report';
export const mvDiagnosticsPreferenceChangedEvent = 'mv:diagnostics-preference-changed';

export const readMvDiagnosticsEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(mvDiagnosticsStorageKey) === 'true';
  } catch {
    return false;
  }
};

export const writeMvDiagnosticsEnabled = (enabled: boolean): void => {
  try {
    if (enabled) {
      window.localStorage.setItem(mvDiagnosticsStorageKey, 'true');
    } else {
      window.localStorage.removeItem(mvDiagnosticsStorageKey);
    }
  } catch {
    // Diagnostics are best-effort and should never affect MV playback.
  }

  window.dispatchEvent(new CustomEvent(mvDiagnosticsPreferenceChangedEvent, { detail: { enabled } }));
};
