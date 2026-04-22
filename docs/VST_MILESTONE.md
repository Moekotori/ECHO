# VST support — suggested milestone (optional)

VST2/VST3 hosting is **not** implemented in the app today. This document records a minimal, stability-first roadmap if you add it later.

## Why isolate

- Plugins are native code: crashes must not take down the Electron main/renderer process.
- Real-time audio requires a **fixed buffer size** and a **dedicated thread** or process with bounded queues.

## Minimal Windows-first approach

1. **Out-of-process host** — A small executable (C++) that loads the VST shell, exposes IPC (named pipe or localhost socket) for:
   - parameter changes
   - transport state (optional)
   - PCM in / PCM out in float32, non-interleaved or interleaved (pick one and document it).
2. **Buffer contract** — Fixed frames per block (e.g. 512); main process resamples or pads if FFmpeg delivers different sizes.
3. **Insertion point** — Either **before** the existing HiFi EQ (effect as “pre”) or **replace** a segment of the chain; start with **one stereo insert slot** only.
4. **UI** — Renderer lists installed plugins; main process only stores paths and enabled state; heavy work stays in the host.

## Non-goals for v1

- MIDI routing, sidechain buses, multi-plugin graphs.
- macOS/Linux until Windows path is stable.

## Related in-repo code

- PCM path today: FFmpeg → `AudioProcessor` → `NativeAudioBridge` stdin → `echo-audio-host`.
- A VST stage would sit **between** FFmpeg decode and the bridge (or inside a future unified DSP node).
