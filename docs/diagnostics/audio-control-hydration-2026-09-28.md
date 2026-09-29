# Audio control hydration — 2026-09-28

The reported sequence contained a same-track `loading` status at 11.67 seconds and a subsequent 699 ms `audio:set-output` call. The user was only playing/switching tracks, without changing output settings. The historical messages do not identify the exact requesting component.

Application layout initialization and volume/speed control mounts could reapply persisted preferences while a native session was already playing. This also affected ordinary renderer reloads and settings reads that completed after a play click. They now read the resident host state during playing/loading and resident pause. Application initialization rechecks host state after asynchronous settings loading; idle cold startup still applies preferences. Explicit user controls retain their existing commands.

Successful `[ipc-perf]` and `[playback-perf]` `SLOW` messages captured from stderr now remain warnings in console rows and the problem board. `failed=true` IPC records and native exceptions remain errors. The timing warnings and their thresholds are retained.

Validation:

- 22 focused tests passed: startup/control hydration, slider interaction races and console classification/display.
- Full TypeScript check and independent Electron Vite build passed.
- Real Electron 42.3.3/WASAPI shared smoke used an isolated profile and generated silent WAV files. Renderer unload, automatic queue continuation and Ultralight restoration remained functional.
- An ordinary renderer reload during playback preserved the second track's `playing` state, forward progress (0.71 to 4.37 seconds) and volume (0.17).
- Local smoke evidence remains in `.cache/ultralight-audit/`, including `result.json` and `verify.cjs`.

The 305–796 ms library timings and 682–764 ms play timings are elapsed-call observations, not sufficient attribution of CPU/IO cost. MV auto-search is currently deferred background work rather than an awaited prerequisite for native playback. No large-library latency improvement or audible continuity measurement is claimed by this fix. The startup persistent-state snapshot and Electron development CSP warning are separate diagnostics.
