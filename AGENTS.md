# AI Contribution Guardrails

## The App.jsx Rule

`src/renderer/src/App.jsx` is a legacy integration surface. It is large because it still coordinates playback, library state, lyrics, MV playback, drawers, and cross-feature UI glue.

Future AI agents should treat it as a routing layer, not as the default place to add new feature code. This is guidance, not a ban: small, well-scoped `App.jsx` edits are allowed when they are the clearest route.

Before editing `App.jsx`:

1. Read `docs/APP_JSX_CHANGE_MAP.md`.
2. Prefer adding new logic in `src/renderer/src/components`, `src/renderer/src/utils`, `src/renderer/src/config`, or `src/main`, then wire it through the smallest possible `App.jsx` call site.
3. If `App.jsx` must change, state the exact region being touched before editing.
4. Keep edits contiguous and easy to review. Avoid scattered patches across unrelated state, effects, handlers, and JSX.
5. Run `npm run guard:app-jsx` before finishing if `App.jsx` changed. It warns by default; set `STRICT_APP_JSX_GUARD=1` only when a branch intentionally needs a blocking gate.
6. Run `npm run build` after any renderer/main behavior change.

## Preferred Routing

- UI panels and drawers: create or update a component under `src/renderer/src/components`.
- Pure data transforms: use `src/renderer/src/utils`.
- Defaults and persisted settings: update `src/renderer/src/config/defaultConfig.js`, then wire migration/normalization deliberately.
- Styling: use `src/renderer/src/index.css` or the relevant file under `src/renderer/src/styles`.
- Main process, filesystem, downloader, and export behavior: use `src/main` and expose through preload when needed.
- Text and labels: update locale JSON files under `src/renderer/src/locales`.

## Regression Checks

Build success is only the baseline. When touching related behavior, also smoke-test:

- Playback start, pause, seek, next, previous, and queue behavior.
- Right-click context menus on tracks, covers, albums, and groups.
- Lyrics visibility, search, and quick controls inside the lyric column.
- MV playback, especially Bilibili direct playback and sustained smoothness.
- Export dialogs and output formats when export logic changes.
