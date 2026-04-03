# Audio stack smoke checklist

Run these after changes to `AudioEngine`, `NativeAudioBridge`, `echo-audio-host`, or renderer playback/EQ sync.

## Paths to exercise

1. **Play / pause / resume** — Start a track, pause, resume; confirm no duplicate `[NativeAudioBridge] spawn` lines for a single user action (aside from intentional track change).
2. **Next / previous track** — Switch tracks while playing; audio should switch cleanly; watch for `SIGKILL` storms in logs.
3. **Seek** — Drag progress bar and use lyrics click-to-seek in HiFi mode; waveform/MV should stay aligned with audible position.
4. **Device switch** — Open audio settings, pick another output device while playing; playback should continue on the new device (native path replays from current position).
5. **Exclusive mode** — Toggle WASAPI exclusive; if denied, expect fallback log (`exclusive_denied`, `-2` exit) and retry in shared mode.
6. **Volume** — Change master volume; in HiFi mode output level should follow (native volume), not only the muted HTML audio path.
7. **EQ** — With HiFi enabled, boost a single band strongly; audible tone should change. If EQ has no effect, confirm `setAudioEqConfig` is firing and `[AudioEngine]` is not stuck on legacy path.

## Log markers

| Marker | Meaning |
|--------|---------|
| `[NativeAudioBridge] spawn:` | New native host process (expect one per play session). |
| `[NativeAudioBridge] exited code=-2` | Exclusive mode denied. |
| `[AudioEngine] Native bridge available` | Binary found; UI may show HiFi. |
| `[echo-audio-host]` | stderr from native host (device diagnostics). |

## Regression notes

- **Segfault / RPC**: Crashes when opening some video/MV streams may involve Chromium + native modules; `naudiodon`’s `segfault-handler` has been disabled in the past for this reason—do not re-enable without retesting MV playback.
- **White screen**: Usually a renderer `ReferenceError`; check recent `useEffect` dependency ordering in `App.jsx`.
