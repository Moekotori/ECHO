# Ultralight validation — 2026-09-28

## Fixes

- Coalesce simultaneous entries and invalidate pending work when restoration starts. Old cleanup work cannot destroy a restored window.
- Cancel stale background-resume timers; release a stranded manual pause after a failed re-entry.
- Destroy a newly created window whose restore fails, allowing the next attempt to create a fresh renderer.
- Use the host queue occurrence ID when handing off and persisting repeated tracks.
- Treat explicit play/pause requests as idempotent commands. A user stop cancels delayed GPU-handoff playback recovery.
- Hydrate the recreated application layout from Audio Core status instead of reapplying saved output/DSP preferences. The previous initialization caused a real output reopen during restoration.

## Verified

- 107 focused tests passed (105 service/window/IPC/control tests, 2 application-layout startup/restore tests).
- Full TypeScript check passed.
- Independent Electron Vite build passed.
- Real Electron 42.3.3 smoke used a separate profile and build, without changing the running user's library/settings.
- Minimize left zero renderer windows and one native taskbar restore window. Restoration returned to one renderer and removed the temporary native window/restore shortcut.
- Tray hiding and simultaneous manual entries unloaded all UI windows. Immediate minimize/restore retained the main window.
- Two generated silent WAV files (4 and 8 seconds, stereo PCM16/48 kHz) played through the real WASAPI shared native host. Playback advanced to the second queue item with no renderer, and the queue position was persisted.
- Restoring during the second track preserved its playing state, forward-moving position and volume of 0.17. The test then stopped playback and closed its own process.

Local evidence is in `.cache/ultralight-audit/`: `verify.cjs`, `result.json`, `electron.log`, `build.log` and `restored-window.png`. Synthetic track IDs were not imported into the library, so metadata/MV lookups can log unknown-track messages; those are fixture limitations.

## Boundaries

This is a bounded lifecycle/playback check, not a long soak or an audible listening test. GPU process relaunch is covered by mocked tests only; ASIO, exclusive output and DSD were not separately exercised on hardware. CUE, remote queues and System Output retain the existing safe refusal to unload. The GPU-disable option remains off by default.
