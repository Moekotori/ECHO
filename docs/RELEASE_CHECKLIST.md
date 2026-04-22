# Release Checklist

Use this before cutting a public desktop build. The release is not ready until every blocking item passes.

## Blocking Checks

1. Run `npm run build`.
2. Run `npm run test:unit`.
3. Run `npm run verify:release`.
4. Run the smoke flow in [`docs/SMOKE_AUDIO.md`](./SMOKE_AUDIO.md).
5. If publishing OTA artifacts, run `npm run build:win:release` and confirm `release/latest.yml` exists.

## Desktop Smoke Coverage

- Startup restore: last volume, playback history, and playback session recover from `appState`.
- Transport: play, pause, next, previous, seek, and close/reopen while a track is mid-play.
- Updates: open Settings and click "Check for Updates" repeatedly; UI must not flash or queue duplicate checks.
- Plugins: app loads with plugins enabled and Plugin Manager opens without renderer errors.
- Lyrics and MV: lyrics fetch, lyrics drawer, and MV lookup still behave for a normal local track.
- Network features: DLNA and Listen Together each get one basic connect/open sanity pass before release.

## Release Surface Checks

- Website release feed points at `Moekotori/Echoes` and no placeholder GitHub values remain.
- Package version matches the intended release tag/version string.
- `out/main/index.js`, `out/preload/index.js`, and `out/renderer/index.html` are present after `build`.
- App icon and bundled resources referenced from `package.json` exist on disk.
- OTA metadata (`latest.yml`) is validated for Windows release builds.

## Known Build Warnings

### Non-blocking

- `resolveFfmpegStaticPath.js` is both dynamically and statically imported, so Vite reports that it will stay in the same chunk.
- Current assessment: packaging/performance warning only, not a correctness or release-blocking issue.

### Release policy

- Any new warning that affects runtime correctness, update behavior, or missing assets becomes blocking immediately.
- Non-blocking warnings must be recorded here with a brief rationale instead of being ignored silently.
