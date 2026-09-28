# Community Ultralight

The community build adapts the Steam `UltraLightModeService`, renderer-free taskbar restore window, GPU relaunch arguments and restore-readiness handling to its existing Audio Core and background services.

In Settings → General → Performance:

- **ECHO Ultralight** manually unloads UI windows. Restore from the tray or `Ctrl+Shift+E` (`Cmd+Shift+E` on macOS).
- **Enable on minimize or hide** is opt-in. Minimize keeps a native taskbar restore entry on Windows; hiding uses the tray. Unsupported playback stays resident.
- **Disable Electron GPU** is a separate, default-off experimental option. It restarts the application on entry/exit and may interrupt audio or fail to restore the UI.

Ordinary background windows also pause rebuildable remote jobs and request existing soft-cache cleanup after 30 seconds. Foregrounding resumes jobs after a short delay without clearing the user's own pause. No audio quality or DSP setting is changed by this policy.

Restoring the renderer skips the startup overlay's minimum display delay and avoids reapplying persisted volume/speed over the running native host. The current route is preserved. Native taskbar presentation coalesces position-only updates and avoids repeated library lookups. Audio Core remains authoritative; fallback queue continuation only acts on its confirmed `ended` state while the renderer is absent.

## Compatibility boundaries

- System Output and non-local queues cannot be unloaded safely.
- This community host lacks Steam's queue source-range contract, so CUE queues stay resident.
- The community native taskbar player retains its existing controls. During Ultralight it shows host metadata and progress; renderer-provided artwork and lyrics are cleared.
- This ports the Ultralight lifecycle, not Steam's unrelated library-worker residency subsystem or its newer floating-player UI.

## Validation

Focused tests cover entry rejection, queue handoff, restoration races, GPU relaunch arguments, confirmed playback-end continuation, native taskbar updates, pause leases, IPC registration and restored volume/speed controls. They use mocked Electron/audio interfaces and can run with `ECHO_SKIP_NATIVE_ABI=1`.

Actual memory reduction, real-song continuity and Windows taskbar restoration still require desktop acceptance. No measured CPU/RAM improvement is claimed by the unit tests.
