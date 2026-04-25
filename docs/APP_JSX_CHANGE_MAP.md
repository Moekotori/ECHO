# App.jsx Change Map

`src/renderer/src/App.jsx` is intentionally left intact for safety, but it should no longer be the default file for new implementation work. Small routing edits are acceptable when they are clearer than forcing an awkward detour.

Use this file as the route map before touching it.

## Default Decision

Add new code outside `App.jsx` unless the change is only:

- Wiring state/props into an existing component.
- Calling an existing utility from an existing handler.
- Connecting an IPC/preload API to an existing renderer flow.
- Moving a small JSX call site to a component that already owns the behavior.

If the change needs new business logic, put that logic in a focused module first.

## Where New Work Should Go

| Change type | Preferred location | App.jsx role |
| --- | --- | --- |
| Drawer or panel UI | `src/renderer/src/components/*Drawer.jsx` | Own open/close state and pass props |
| Small reusable UI | `src/renderer/src/components` or `src/renderer/src/components/ui` | Import and render |
| Lyrics parsing, ranking, overrides, links | `src/renderer/src/utils/lyrics*.js` | Call utilities and keep track-specific state |
| MV URL parsing and search helpers | `src/renderer/src/utils/mvUrlParse.js` or main/preload APIs | Store selected MV identity and render player |
| Playback context, queue, library transforms | `src/renderer/src/utils/*` | Coordinate current track and persistence |
| Persisted settings | `src/renderer/src/config/defaultConfig.js` plus `normalizeConfigState` | Normalize and pass config |
| Main-process IO, export, download, metadata | `src/main/*` and `src/preload/index.js` | Call exposed API and show UI state |
| Styling | `src/renderer/src/index.css` or `src/renderer/src/styles/*` | Use stable class names |
| Labels and copy | `src/renderer/src/locales/*.json` | Reference translation keys |

## Current App.jsx Landmarks

These line numbers drift, so search by symbol instead of trusting exact offsets.

- Imports: top of file. Add imports only after the target module exists.
- Utility helpers before `App`: `localPathToAudioSrc`, cover scoring helpers, playlist parsing, config normalization, path remapping, and smart collection helpers.
- `normalizeConfigState`: config migration and defaults merge. Keep persisted settings compatible with `DEFAULT_CONFIG`.
- `resolveContextMenuPoint`: shared right-click menu coordinate fallback. Use it for menu entry points instead of open-coded `clientX/clientY`.
- `export default function App()`: main orchestration shell.
- Playback state: near the start of `App`, around playlist, queue, current index, native engine, and progress state.
- MV state: search for `// MV State`.
- Lyrics state: search for `// Lyrics States`.
- Drawer open state: immediately after lyrics/MV state.
- Library and playlist state: search for `userPlaylists`, `userSmartCollections`, and `activePlaybackContext`.
- Rendered lyric/MV area: search for `lyrics-and-mv-wrapper` and `lyrics-main-column`.

## App.jsx Edit Checklist

Before editing:

- Name the user-visible behavior you are changing.
- Search for an existing component or utility that should own the logic.
- Decide whether the edit can be a small import, prop, handler call, or JSX replacement.

While editing:

- Keep all changes in one nearby region whenever possible.
- Avoid adding another broad `useEffect` unless it has a single owner and a narrow dependency list.
- Avoid storing temporary playback-only UI state in global config.
- Do not reset Bilibili iframe/player `src` as a seek strategy.
- Do not patch nested JSX fragments one line at a time; replace a full contiguous block when JSX structure changes.

After editing:

- Run `npm run guard:app-jsx`. This is a soft warning by default; set `STRICT_APP_JSX_GUARD=1` only when you deliberately want it to block.
- Run `npm run build`.
- Smoke-test the exact interaction touched by the change.
- If context menus, lyrics, MV, playback, or export were touched, smoke-test those flows directly.
