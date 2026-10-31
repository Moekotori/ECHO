# Theme Contract

Renderer styles should describe UI roles, not fixed light or dark colors.

Use semantic tokens from `src/renderer/styles/tokens.css` for theme-sensitive surfaces:

- Page and text: `--theme-app-bg`, `--theme-page-bg`, `--theme-page-text`, `--theme-heading-text`, `--theme-muted-text`.
- Panels and cards: `--theme-panel-bg`, `--theme-panel-bg-strong`, `--theme-panel-bg-muted`, `--theme-panel-border`.
- Inputs: `--theme-field-bg`, `--theme-field-bg-strong`, `--theme-field-border`, `--theme-field-placeholder`.
- Buttons and chips: `--theme-button-bg`, `--theme-button-bg-hover`, `--theme-button-border`, `--theme-chip-bg`, `--theme-chip-bg-active`.
- Lists: `--theme-list-row-bg`, `--theme-list-row-bg-hover`, `--theme-list-row-bg-active`, `--theme-list-row-border`.
- Shell and controls: `--theme-player-bg`, `--theme-player-border`, `--theme-control-bg`, `--theme-control-bg-hover`, `--theme-control-bg-active`.
- Overlays and glass: `--theme-overlay-bg`, `--theme-overlay-text`, `--theme-overlay-muted-text`, `--theme-glass-bg-*`.
- State colors: `--theme-accent-solid-bg`, `--theme-danger-solid-bg`, `--theme-danger-bg`, `--theme-danger-panel-bg`, `--theme-danger-text`, `--theme-success-bg`, `--theme-success-panel-bg`, `--theme-success-text`, `--theme-warning-bg`, `--theme-warning-panel-bg`, `--theme-warning-text`.

Do not add hard-coded white or pale backgrounds to new CSS files. The `check:theme-colors` script is wired into `npm run lint` and fails new CSS that uses literal colors in theme-sensitive declarations. Existing CSS has a counted baseline in `scripts/theme-color-baseline.json`; adding more hard-coded theme colors above that baseline also fails.

Rare fixed-color assets are allowed only with a nearby `/* theme-color-allow: reason */` comment.

`src/renderer/styles/legacy-theme-bridge.css` is a temporary migration layer for old selectors that still leak fixed light surfaces. New UI must not add selectors there by default; prefer semantic tokens in the source stylesheet and lower `scripts/theme-color-baseline.json` as each file is migrated.

When adding a new page, verify at least these theme states:

- Light mode.
- Dark mode.
- Follow System with the system set to light and dark.
- Page surface, toolbar, inputs, panels/cards, list rows, empty states, and player overlap.
