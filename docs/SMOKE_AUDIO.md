# Desktop Smoke Checklist

Run this before cutting a desktop release, especially after changes to `AudioEngine`, `NativeAudioBridge`, `echo-audio-host`, updater logic, or persisted renderer state.

## Core restore and transport

1. **Startup restore**: Close the app mid-track, reopen it, and confirm the last track, current progress, volume, and playback history restore from `appState`. Expected UI: track restores in paused state.
2. **Play / pause / resume**: Start a track, pause, resume; confirm no duplicate `[NativeAudioBridge] spawn` lines for a single user action (aside from intentional track change).
3. **Next / previous track**: Switch tracks while playing; audio should switch cleanly and playback history should update once per previous track.
4. **Seek**: Drag the progress bar and use lyrics click-to-seek in HiFi mode; lyrics/MV should stay aligned with audible position.
5. **Volume restore**: Change master volume, close and reopen the app, and confirm the restored value is not reset to 100%.

## Audio stack

1. **Device switch**: Open audio settings, pick another output device while playing; playback should continue on the new device.
2. **Exclusive mode**: Toggle WASAPI exclusive; if denied, expect fallback log (`exclusive_denied`, `-2` exit) and retry in shared mode.
3. **EQ**: With HiFi enabled, boost a single band strongly; audible tone should change. If EQ has no effect, confirm `setAudioEqConfig` is firing and `[AudioEngine]` is not stuck on the legacy path.

## Release surface

1. **Update check**: Open Settings and click "Check for Updates" repeatedly; expected UI is one stable checking cycle with no rapid flashing.
2. **Plugin Manager**: Open Plugin Manager with at least one installed plugin; expected result is no renderer crash and settings panel still works.
3. **Lyrics / MV**: Load a normal local track, fetch lyrics, enter lyrics view, and verify MV lookup still works.
4. **Listen Together / DLNA**: Open each feature once and confirm the entry flow still initializes without blocking the rest of the app.

## Log markers

| Marker | Meaning |
|--------|---------|
| `[NativeAudioBridge] spawn:` | New native host process (expect one per play session). |
| `[NativeAudioBridge] exited code=-2` | Exclusive mode denied. |
| `[AudioEngine] Native bridge available` | Binary found; UI may show HiFi. |
| `[echo-audio-host]` | stderr from native host (device diagnostics). |
| `[PlaybackSession]` | Session restore / clear path for saved playback state. |
| `[PlaybackHistory]` | Legacy history upgrade or compatibility fallback. |
| `[UpdaterState]` | Manual/startup update-check coalescing and reuse behavior. |

## Regression notes

- **Segfault / RPC**: Crashes when opening some video/MV streams may involve Chromium + native modules; `naudiodon`'s `segfault-handler` has been disabled in the past for this reason. Do not re-enable without retesting MV playback.
- **White screen**: Usually a renderer `ReferenceError`; check recent `useEffect` dependency ordering in `App.jsx`.
- **History appears empty**: If saved history exists but current playlist lacks those tracks, the drawer should still render fallback metadata from the stored history entries.
