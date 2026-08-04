import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('theme presets stylesheet', () => {
  it('keeps preset settings backgrounds out of app wallpaper mode', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');
    const layoutCss = readFileSync('src/renderer/styles/layout.css', 'utf8');

    expect(css).toContain(
      'html:is([data-theme-custom="true"], [data-theme-preset]:not([data-theme-preset="classic"])) .app-shell:not(.app-shell--wallpaper) .page-surface:has(.settings-page) {',
    );
    expect(css).not.toContain(
      'html:is([data-theme-custom="true"], [data-theme-preset]:not([data-theme-preset="classic"])) .page-surface:has(.settings-page) {\n  background: var(--echo-polish-page-bg), var(--theme-app-bg);',
    );
    expect(css).not.toContain(
      'html:is([data-theme-custom="true"], [data-theme-preset]:not([data-theme-preset="classic"])) .app-shell--wallpaper-ready::before,',
    );
    expect(css).toContain(
      '.app-shell--wallpaper-ready[data-wallpaper-unified-opacity="true"] .page-surface',
    );
    expect(css).toContain(
      '.app-shell--wallpaper-ready:not([data-wallpaper-unified-opacity="true"]):not([data-wallpaper-ui-transparent="true"]) .app-titlebar',
    );
    expect(layoutCss).toContain('.app-wallpaper-layer img,\n.app-wallpaper-layer video {');
    expect(layoutCss).toContain('object-fit: cover;');
    expect(layoutCss).not.toContain('object-fit: contain;');
    expect(layoutCss).toContain('.app-shell--wallpaper-ready[data-wallpaper-unified-opacity="true"]::before');
  });

  it('keeps acrylic lyrics window controls above the page without adding chrome', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain(
      'html .app-shell.app-shell--acrylic:is(.app-shell--lyrics, :has(.lyrics-page)):not(.app-shell--wallpaper) .window-controls {',
    );
    expect(css).toMatch(
      /html \.app-shell\.app-shell--acrylic:is\(\.app-shell--lyrics, :has\(\.lyrics-page\)\):not\(\.app-shell--wallpaper\) \.app-titlebar \{\r?\n  z-index: 90;[\s\S]*?background: transparent;[\s\S]*?backdrop-filter: none;/,
    );
    expect(css).toMatch(
      /html \.app-shell\.app-shell--acrylic:is\(\.app-shell--lyrics, :has\(\.lyrics-page\)\):not\(\.app-shell--wallpaper\) \.window-controls \{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?backdrop-filter: none;/,
    );
    expect(css).toContain(
      'html .app-shell.app-shell--acrylic:is(.app-shell--lyrics, :has(.lyrics-page)):not(.app-shell--wallpaper) .window-control {',
    );
    expect(css).toMatch(
      /html \.app-shell\.app-shell--acrylic:not\(\.app-shell--wallpaper\) \.page-surface:has\(\.lyrics-page\[data-immersive-cover-style="true"\]\[data-background="cover"\]\) \{\r?\n  background: transparent;\r?\n  backdrop-filter: none;/,
    );
    expect(css).toContain(
      'html .app-shell.app-shell--acrylic:is(.app-shell--lyrics, :has(.lyrics-page)):not(.app-shell--wallpaper) .window-control--close:hover {',
    );
  });

  it('keeps normal lyrics titlebar colors but uses white glyphs over immersive cover art', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toMatch(
      /html \.app-shell:is\(\.app-shell--lyrics, :has\(\.lyrics-page\)\) \{\r?\n  --lyrics-titlebar-glyph: var\(--theme-button-muted-text\);[\s\S]*?--lyrics-titlebar-glyph-hover: var\(--theme-heading-text\);/,
    );
    expect(css).toMatch(
      /html \.app-shell:has\(\.lyrics-page\[data-immersive-cover-style="true"\]\[data-background="cover"\]\) \{\r?\n  --lyrics-titlebar-glyph: #ffffff;[\s\S]*?--lyrics-titlebar-glyph-hover: #ffffff;/,
    );
    expect(css).toMatch(
      /html \.app-shell:has\(\.lyrics-page\[data-lyrics-page-style="roseVinyl"\]\[data-background="cover"\]\) \{\r?\n  --lyrics-titlebar-glyph: rgb\(246 238 231 \/ 0\.76\);[\s\S]*?--lyrics-titlebar-glyph-hover: rgb\(255 248 242 \/ 0\.92\);/,
    );
    expect(css).toContain(
      'html .app-shell:has(.lyrics-page[data-immersive-cover-style="true"][data-background="cover"]) :is(.titlebar-action, .window-control) {',
    );
    expect(css).not.toContain('html .app-shell:has(.lyrics-page[data-immersive-cover-style="true"]),');
    expect(css).not.toContain('html .app-shell:has(.lyrics-page[data-immersive-cover-style="true"][data-background="cover"] .lyrics-mv-panel[data-mv-enabled="false"])');
    expect(css).not.toContain('html .app-shell:has(.lyrics-page .lyrics-mv-background) {');
    expect(css).toContain('background: var(--lyrics-titlebar-glyph-hover-bg) !important;');
    expect(css).toContain('background: var(--lyrics-titlebar-glyph-close-bg) !important;');
  });

  it('keeps Ambient range sliders soft instead of using native bordered tracks', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('html[data-theme-mode="ambient"] :is(\n  .settings-range-field input[type="range"],');
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\([\s\S]*?::-webkit-slider-runnable-track \{[\s\S]*?height: 6px;[\s\S]*?border: 0;[\s\S]*?background: rgb\(255 255 255 \/ 0\.13\);/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\([\s\S]*?::-webkit-slider-thumb \{[\s\S]*?border: 0;[\s\S]*?background: linear-gradient\(180deg, #c4cee5, #8e9cba\);/,
    );
  });

  it('keeps Ambient plugin panels on the dark surface system', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('html[data-theme-mode="ambient"] :is(\n  .plugins-drop-overlay,');
    expect(css).toContain('  .plugin-market-panel,');
    expect(css).toContain('  .plugin-security-panel,');
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\([\s\S]*?\.plugin-market-panel,[\s\S]*?\) \{[\s\S]*?background: var\(--echo-polish-surface\);/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\([\s\S]*?\.plugin-market-toggle strong,[\s\S]*?\) \{[\s\S]*?color: var\(--theme-heading-text\);/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\(\.plugin-market-card, \.plugin-security-grid span,[\s\S]*?\) \{[\s\S]*?background: rgb\(255 255 255 \/ 0\.035\);/,
    );
  });

  it('removes Ambient settings page container outlines', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('html[data-theme-mode="ambient"] .settings-page :is(.section-title, .setting-row, .setting-row--compact-panel, .setting-row--shortcut, .setting-row--shortcut-header) {');
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] \.settings-page :is\(\.section-title,[\s\S]*?\) \{[\s\S]*?border-bottom-color: transparent;[\s\S]*?box-shadow: none;/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] \.settings-page :is\([\s\S]*?\.settings-cache-panel,[\s\S]*?\.settings-data-backup-panel,[\s\S]*?\.diagnostics-assistant-summary,[\s\S]*?\) \{[\s\S]*?border-color: transparent;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] \.settings-page :is\([\s\S]*?\.settings-status-grid span,[\s\S]*?\.settings-data-backup-meta span,[\s\S]*?\) \{[\s\S]*?border-color: transparent;[\s\S]*?background: rgb\(255 255 255 \/ 0\.035\);/,
    );
    expect(css).toContain('html[data-theme-mode="ambient"] .settings-page :is(.settings-data-backup-panel, .settings-package-export-panel) {');
    expect(css).toContain('html[data-theme-mode="ambient"] .settings-page .settings-data-backup-progress-track {');
  });

  it('removes Ambient page container outlines beyond Settings', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('html[data-theme-mode="ambient"] .page-surface :is(\n  [class*="-panel"],');
    expect(css).toContain('  [class*="-section"],');
    expect(css).toContain('  [class*="-toolbar"],');
    expect(css).toContain('  [class*="-list"],');
    expect(css).toContain('  [class*="-shell"]');
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] \.page-surface :is\([\s\S]*?\):not\([\s\S]*?\.player-bar \*[\s\S]*?\) \{[\s\S]*?border-color: transparent;[\s\S]*?box-shadow: none;/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] \.page-surface :is\([\s\S]*?\.settings-action-button,[\s\S]*?\.audio-field select[\s\S]*?\) \{[\s\S]*?border-color: var\(--theme-button-border\);/,
    );
  });

  it('tones down Ambient audio tags instead of using bright pills', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('html[data-theme-mode="ambient"] :is(.hifi-tag, .remote-track-source-badge, .playing-pill, .duplicate-version-badge) {');
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\(\.hifi-tag,[\s\S]*?\) \{[\s\S]*?linear-gradient\(180deg, rgb\(255 255 255 \/ 0\.05\), transparent\),[\s\S]*?rgb\(87 98 124 \/ 0\.2\);/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\(\.tag-flac,[\s\S]*?\.remote-track-source-badge\) \{[\s\S]*?background: rgb\(54 92 121 \/ 0\.24\);/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\(\.tag-hires,[\s\S]*?\.tag-rate-lift-output\) \{[\s\S]*?background: rgb\(122 95 43 \/ 0\.2\);/,
    );
  });

  it('keeps Ambient surfaces quieter than the normal dark theme chrome', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\]\[data-theme="dark"\] \{[\s\S]*?--theme-page-text: #dce4f0;[\s\S]*?--theme-button-bg: rgb\(255 255 255 \/ 0\.044\);[\s\S]*?--theme-list-row-bg: rgb\(255 255 255 \/ 0\.024\);/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\]\[data-theme="dark"\] \{[\s\S]*?--echo-polish-surface: rgb\(18 22 34 \/ 0\.5\);[\s\S]*?--echo-polish-border: rgb\(238 242 251 \/ 0\.056\);/,
    );
  });

  it('gives Ambient rows and popovers low-contrast states instead of hard cards', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\([\s\S]*?\.track-row,[\s\S]*?\.lyrics-mv-candidate[\s\S]*?\) \{[\s\S]*?border-color: rgb\(238 242 251 \/ 0\.048\);[\s\S]*?linear-gradient\(180deg, rgb\(255 255 255 \/ 0\.026\), rgb\(255 255 255 \/ 0\.014\)\),[\s\S]*?rgb\(255 255 255 \/ 0\.018\);/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\([\s\S]*?\.track-row\[data-playing="true"\],[\s\S]*?\.artist-track-row\[data-playing="true"\][\s\S]*?\) \{[\s\S]*?box-shadow: inset 3px 0 0 rgb\(145 158 190 \/ 0\.54\);/,
    );
    expect(css).toContain('html[data-theme-mode="ambient"] :is(\n  .settings-nav,\n  .settings-search,');
    expect(css).toContain('  .track-context-menu,');
    expect(css).toContain('  .font-picker-modal');
  });

  it('removes Ambient album-detail track table frames', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] \.album-detail-page :is\([\s\S]*?\.album-detail-track-console,[\s\S]*?\.album-track-list[\s\S]*?\) \{[\s\S]*?border-color: transparent;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
    );
    expect(css).toContain('html[data-theme-mode="ambient"] .album-detail-page .album-track-list {\n  gap: 0;\n}');
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] \.album-detail-page \.album-track-row \{[\s\S]*?border-color: transparent;[\s\S]*?border-radius: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] \.album-detail-page \.album-track-row::before,[\s\S]*?html\[data-theme-mode="ambient"\] \.album-detail-page \.album-track-row::after \{[\s\S]*?display: none;[\s\S]*?content: none;/,
    );
  });

  it('removes the big song-list row frames on the Songs page across themes', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toMatch(
      /html \.songs-page > \.track-list-shell,[\s\S]*?html\[data-theme\]\[data-theme-preset\] \.songs-page > \.track-list-shell,[\s\S]*?html\[data-theme-mode="ambient"\] \.songs-page > \.track-list-shell \{[\s\S]*?border-color: transparent;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
    );
    expect(css).toMatch(
      /html \.songs-page \.track-row,[\s\S]*?html\[data-theme\]\[data-theme-preset\] \.songs-page \.track-row,[\s\S]*?html\[data-theme-mode="ambient"\] \.songs-page \.track-row \{[\s\S]*?border-color: transparent;[\s\S]*?border-radius: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
    );
    expect(css).toMatch(
      /html \.songs-page \.track-row::before,[\s\S]*?html\[data-theme-mode="ambient"\] \.songs-page \.track-row::after \{[\s\S]*?display: none;[\s\S]*?content: none;/,
    );
    expect(css).toMatch(
      /html \.songs-page \.track-row:hover,[\s\S]*?html\[data-theme\]\[data-theme-preset\] \.songs-page \.track-row:hover,[\s\S]*?html\[data-theme-mode="ambient"\] \.songs-page \.track-row:hover \{[\s\S]*?border-color: transparent;[\s\S]*?color-mix\(in srgb, var\(--theme-list-row-bg-hover\) 68%, transparent\)/,
    );
    expect(css).toMatch(
      /html \.songs-page \.playing-dot,[\s\S]*?html\[data-theme-mode="ambient"\] \.songs-page \.playing-dot \{[\s\S]*?width: 6px;[\s\S]*?color-mix\(in srgb, var\(--theme-accent-bg\) 34%, transparent\);/,
    );
    expect(css).toMatch(
      /html \.songs-page \.track-row\[data-playing="true"\],[\s\S]*?html\[data-theme-mode="ambient"\] \.songs-page \.track-row\[data-playing="true"\] \{[\s\S]*?color-mix\(in srgb, var\(--theme-accent-bg\) 34%, transparent\)[\s\S]*?box-shadow: inset 2px 0 0 color-mix\(in srgb, var\(--theme-accent-solid-bg\) 58%, transparent\);/,
    );
    expect(css).toMatch(
      /html \.songs-page \.track-row\[data-selected="true"\],[\s\S]*?html\[data-theme-mode="ambient"\] \.songs-page \.track-row\[data-selected="true"\] \{[\s\S]*?color-mix\(in srgb, var\(--theme-accent-bg\) 72%, transparent\)[\s\S]*?box-shadow: inset 3px 0 0 color-mix\(in srgb, var\(--theme-accent-solid-bg\) 72%, transparent\);/,
    );
  });

  it('keeps Ambient player controls soft while preserving active feedback', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] \.player-bar :is\(\.icon-button, \.audio-icon-command, \.signal-path-control\) \{[\s\S]*?background: rgb\(255 255 255 \/ 0\.042\);/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] \.player-bar :is\(\.icon-button\.is-soft-active,[\s\S]*?\.signal-path-control\.is-soft-active\) \{[\s\S]*?background: rgb\(96 110 142 \/ 0\.2\);/,
    );
  });

  it('adds Ambient fine-detail polish without brightening the theme', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('--ambient-fine-line: rgb(238 242 251 / 0.052);');
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\(\.settings-search,[\s\S]*?\.downloads-search-box\):focus-within \{[\s\S]*?box-shadow:[\s\S]*?0 0 0 1px rgb\(171 184 212 \/ 0\.08\),/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\([\s\S]*?\.track-cover,[\s\S]*?\.download-job-icon[\s\S]*?\) \{[\s\S]*?box-shadow:[\s\S]*?0 16px 34px rgb\(0 0 0 \/ 0\.26\),/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] \.nav-item\[data-active="true"\]::before \{[\s\S]*?background: linear-gradient\(180deg, #c5cee1, #6e7b99\);/,
    );
    expect(css).toMatch(
      /html\[data-theme-mode="ambient"\] :is\(\.progress-fill, \.progress-thumb\) \{[\s\S]*?background: linear-gradient\(90deg, #b4bfd6, #6f7d99\);/,
    );
  });

  it('keeps FINAL artist wall avatars as square product tiles', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('html[data-theme-preset="FINAL"] .artists-page .artist-wall {');
    expect(css).toContain('grid-template-columns: repeat(auto-fill, minmax(164px, 1fr));');
    expect(css).toContain('html[data-theme-preset="FINAL"] .artists-page .artist-wall > .artist-card {');
    expect(css).toContain('justify-items: stretch;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .artists-page .artist-wall .artist-avatar {');
    expect(css).toContain('width: 100% !important;');
    expect(css).toContain('border-radius: 6px !important;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .artists-page .artist-wall .artist-avatar::before');
    expect(css).toContain('html[data-theme-preset="FINAL"] .artists-page .artist-wall .artist-avatar .deferred-wall-image');
    expect(css).toContain('html[data-theme-preset="FINAL"] .artists-page .artist-wall :is(.artist-avatar-refresh, .artist-card-action)');
  });

  it('keeps FINAL album and artist wall decorations away from top-right controls', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('html[data-theme-preset="FINAL"] .page-surface:has(:is(.albums-page, .artists-page))::after {');
    expect(css).toContain('top: 148px;');
    expect(css).toContain('width: min(18vw, 230px);');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.albums-page, .artists-page) .songs-header::after');
    expect(css).not.toContain('content: "FINAL ACOUSTIC MEASUREMENT // KAWASAKI // MAKE SOUND PERFECT."');
    expect(css).not.toContain('content: "X8000 / FLAGSHIP\\A D8000 / AFDS PLANAR\\A A8000 / TRUE BERYLLIUM\\A ZE8000 / 8K SOUND"');
  });

  it('adds FINAL product-nameplate styling to the player transport', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('html[data-theme-preset="FINAL"] .player-bar::after {');
    expect(css).toContain('repeating-linear-gradient(90deg, rgb(var(--preset-accent-rgb) / 0.22) 0 1px, transparent 1px 15px) center bottom / 100% 7px no-repeat');
    expect(css).not.toContain('content: "FINAL INC. KAWASAKI / AFDS PLANAR / TRUE BERYLLIUM / 8K SOUND"');
    expect(css).toContain('html[data-theme-preset="FINAL"] .player-cover[data-empty="true"] .player-cover-disc');
    expect(css).toContain('html[data-theme-preset="FINAL"] .player-bar .progress-track::before');
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.player-bar \{[\s\S]*?overflow: visible;/,
    );
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.player-bar \.progress-track,\r?\nhtml\[data-theme-preset="FINAL"\] \.player-bar \.progress-track\[data-waveform="true"\] \{\r?\n  height: 9px;/,
    );
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.player-bar \.progress-waveform i \{\r?\n  display: none;/,
    );
    expect(css).not.toContain('Hi-Res');
  });

  it('keeps the FINAL home side engraving free of the black logo mark', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    const homeSideEngraving = css.match(
      /html\[data-theme-preset="FINAL"\] \.page-surface:has\(\.home-page\)::after \{[\s\S]*?\n\}/,
    )?.[0];

    expect(homeSideEngraving).toBeDefined();
    expect(homeSideEngraving).toContain('content: "MAKE\\A SOUND\\A PERFECT.";');
    expect(homeSideEngraving).not.toContain('var(--final-logo-mark)');
  });

  it('extends FINAL packaging details into album and artist detail pages', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('/* FINAL detail pages: album and artist views become product-spec packaging sheets. */');
    expect(css).toContain('--preset-ink-rgb: 23 21 17;');
    expect(css).toContain('D8000 DC / AFDS\\A ZE8000 MK2 / 8K SOUND\\A A8000 / TRUE BERYLLIUM');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.album-detail-hero, .artist-hero)');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.album-track-row[data-playing');
    expect(css).toContain('html[data-theme-preset="FINAL"] .album-detail-facts::before');
    expect(css).toContain('/* FINAL album detail correction: a centered product sheet instead of a stretched empty drafting table. */');
    expect(css).toContain('html[data-theme-preset="FINAL"] .album-detail-page {');
    expect(css).toContain('width: min(100%, 1360px);');
    expect(css).toContain('html[data-theme-preset="FINAL"] .album-detail-track-console {');
    expect(css).toContain('margin-inline: 0;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .album-related-album-strip {');
    expect(css).toContain('grid-auto-columns: minmax(120px, 148px);');
  });

  it('keeps FINAL artist detail artwork full-bleed without the milky wash', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('/* FINAL artist detail repair: keep the artist image full-bleed, only remove the milky wash. */');
    expect(css).toContain('html[data-theme-preset="FINAL"] .artist-hero-backdrop {');
    expect(css).toContain('display: block !important;');
    expect(css).toContain('filter: saturate(1) contrast(0.98) brightness(0.92) !important;');
    expect(css).toContain('object-position: center;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .artist-hero-art {');
    expect(css).toContain('position: absolute !important;');
    expect(css).toContain('inset: 0 !important;');
    expect(css).toContain('object-fit: cover;');
    expect(css).toContain('opacity: 1 !important;');
  });

  it('keeps FINAL artist hero secondary actions readable on light artwork', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('html[data-theme-preset="FINAL"] .artist-hero .artist-secondary-action {');
    expect(css).toContain('color: rgb(var(--preset-ink-rgb) / 0.84) !important;');
    expect(css).toContain('background-color: rgb(255 253 247 / 0.76) !important;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .artist-hero .artist-secondary-action:disabled {');
    expect(css).toContain('opacity: 0.76 !important;');
  });

  it('extends FINAL precision console styling into queue and folders pages', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('/* FINAL operational pages: queue and folders as a quiet Kawasaki lab console. */');
    expect(css).toContain('html[data-theme-preset="FINAL"] .page-surface:has(:is(.queue-page, .folders-workbench))');
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.page-surface:has\(\.queue-page\) \{[\s\S]*?height: 100%;[\s\S]*?max-height: 100%;[\s\S]*?overflow-y: auto !important;[\s\S]*?scrollbar-gutter: stable;/,
    );
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.page-surface:has\(\.folders-workbench\) \{[\s\S]*?overflow: hidden;/,
    );
    expect(css).toContain('D8000 DC / AFDS ORDER MAP\\A ZE8000 MK2 / 8K TRANSPORT');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.queue-now-cover, .queue-row-cover)[data-empty="true"]::after');
    expect(css).toContain('html[data-theme-preset="FINAL"] .folder-cover-stack[data-cover-count=\'0\']::after');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.queue-row[data-current=\'true\'], .folder-root-button[data-active=\'true\'], .folder-tree-node[data-active=\'true\'])');
    expect(css).toContain('html[data-theme-preset="FINAL"] .folder-metrics span::after');
  });

  it('extends FINAL catalog-sheet styling into songs downloads and inbox pages', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('/* FINAL dense library pages: songs, downloads, and inbox as precision catalog sheets. */');
    expect(css).toContain('html[data-theme-preset="FINAL"] .page-surface:has(:is(.songs-page, .downloads-page, .inbox-page))');
    expect(css).toContain('html[data-theme-preset="FINAL"] .page-surface:has(:is(.songs-page, .downloads-page, .inbox-page))::before');
    expect(css).toContain('display: none;');
    expect(css).not.toContain('A8000 / TRUE BERYLLIUM\\A D8000 DC / 70% FRONT OPEN\\A ZE8000 MK2 / 8K SOUND');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.track-row[data-playing="true"], .track-row[data-selected="true"], .inbox-processing-card[data-active="true"])');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.track-cover, .inbox-track-cover, .inbox-album-art)[data-empty="true"]::after');
    expect(css).toContain('html[data-theme-preset="FINAL"] .download-progress-track span');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.download-provider-chip, .download-tool-pill, .inbox-reason-row span, .inbox-track-title span)');
  });

  it('adds FINAL research-grade refinement without reintroducing large black marks', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('/* FINAL research-grade refinement: transparent sound, 8K timing, beryllium, and stainless machining. */');
    expect(css).toContain('--final-transparent-glass:');
    expect(css).toContain('--final-beryllium-edge:');
    expect(css).toContain('--final-8k-timing-rail:');
    expect(css).toContain('content: "PTM / TRANSPARENCY";');
    expect(css).toContain('content: "TETRA-CHAMBER";');
    expect(css).toContain('content: "8K TIMING";');
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.player-bar \.progress-track,\r?\nhtml\[data-theme-preset="FINAL"\] \.player-bar \.progress-track\[data-waveform="true"\]/,
    );
    expect(css).not.toContain('var(--final-logo-mark) right top / 76px 72px');
    expect(css).not.toContain('var(--final-logo-mark) right 2px top 0 / 80px 74px');
  });

  it('fills the FINAL home view with an acoustic console treatment', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('/* FINAL home acoustic console: fill the landing view with subtle product-sheet density. */');
    expect(css).toContain('html[data-theme-preset="FINAL"] .home-page::before');
    expect(css).toContain('html[data-theme-preset="FINAL"] .home-now-card .home-artwork');
    expect(css).toContain('html[data-theme-preset="FINAL"] .home-now-copy::before');
    expect(css).toContain('html[data-theme-preset="FINAL"] .home-section-header::before');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.home-cover-card, .home-recommend-rail .home-cover-card)');
    expect(css).toContain('html[data-theme-preset="FINAL"] .home-week-heatmap');
  });

  it('keeps FINAL metric tiles aligned and adapts the lyrics page', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.home-metric-tile \{\r?\n  grid-template-columns: 54px minmax\(0, 1fr\);/,
    );
    expect(css).not.toMatch(
      /html\[data-theme-preset="FINAL"\] \.home-metric-tile > svg \{\r?\n  margin-left: 18px;/,
    );
    expect(css).toContain('/* FINAL lyrics page: warm acoustic paper, clear active line, and precision timing rails. */');
    expect(css).toContain('html[data-theme-preset="FINAL"] .page-surface:has(.lyrics-page)');
    expect(css).toContain('html[data-theme-preset="FINAL"] .lyrics-backdrop');
    expect(css).toContain('html[data-theme-preset="FINAL"] .lyrics-back-button {\n  position: relative;\n  z-index: 80;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .lyrics-line[data-active="true"] span');
    expect(css).toContain('html[data-theme-preset="FINAL"] .lyrics-page:has(.lyrics-mv-panel[data-mv-enabled="false"]) .lyrics-track-header');
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.app-shell--lyrics-player-drawer \.lyrics-page\[data-view-mode="lyrics"\] > \.lyrics-track-header-floating \{\r?\n  border-color: transparent !important;\r?\n  background: transparent !important;\r?\n  box-shadow: none !important;/,
    );
    expect(css).toContain('html[data-theme-preset="FINAL"] .lyrics-page:has(.lyrics-mv-panel[data-mv-enabled="false"]) .lyrics-back-button {\n  position: absolute;\n  top: max(18px, calc(var(--titlebar-height) + 8px));\n  left: 22px;\n  z-index: 80;');
    expect(css).toContain('pointer-events: auto;');
    expect(css).toContain('-webkit-app-region: no-drag !important;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .app-shell:not(.app-shell--lyrics-player-drawer):has(.lyrics-page .lyrics-mv-panel[data-mv-enabled="false"]) .player-bar');
    expect(css).toContain('/* FINAL lyrics transport repair: keep the bottom deck compact and prevent the page header from colliding with it. */');
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.app-shell:not\(\.app-shell--wallpaper\):not\(\.app-shell--lyrics-player-drawer\) \.player-bar \{[\s\S]*?overflow: visible;/,
    );
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.app-shell:not\(\.app-shell--lyrics-player-drawer\):has\(\.lyrics-page \.lyrics-mv-panel\[data-mv-enabled="false"\]\) \.lyrics-track-header \{\r?\n  display: none !important;/,
    );
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.app-shell:not\(\.app-shell--lyrics-player-drawer\):has\(\.lyrics-page \.lyrics-mv-panel\[data-mv-enabled="false"\]\) \.player-now \{\r?\n  display: flex !important;/,
    );
    expect(css).toContain('html[data-theme-preset="FINAL"] .app-shell:not(.app-shell--wallpaper):not(.app-shell--lyrics-player-drawer):has(.lyrics-page .lyrics-mv-panel[data-mv-enabled="false"]) .player-center {');
    expect(css).toContain('width: 100%;\n  max-width: 620px;\n  grid-column: 2;\n  justify-self: center;');
  });

  it('rebuilds the FINAL mini lyrics player as a readable dark transport', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('/* FINAL mini player: readable MV drawer controls on dark or bright video. */');
    expect(css).toContain('html[data-theme-preset="FINAL"] .app-shell--lyrics-player-drawer .lyrics-player-drawer-host .player-bar {');
    expect(css).toContain('linear-gradient(90deg, rgb(255 255 255 / 0.08), transparent 24%, rgb(var(--final-lab-gold-rgb) / 0.045)),');
    expect(css).toMatch(/rgb\(10 11 12 \/ 0\.9\)\r?\n\s+\) !important;/);
    expect(css).toContain('html[data-theme-preset="FINAL"] .app-shell--lyrics-player-drawer .lyrics-player-drawer-host .player-bar::before,');
    expect(css).toContain('display: none !important;');
    expect(css).toContain('grid-template-columns: auto minmax(240px, 1fr);');
    expect(css).toContain('color: var(--lyrics-mini-player-readable-muted, rgb(232 237 236 / 0.94)) !important;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .app-shell--lyrics-player-drawer .lyrics-player-drawer-host .progress-track[data-waveform="true"] {');
    expect(css).toContain('/* FINAL mini player containment: keep the progress rail and right-side controls inside the capsule. */');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(css).toContain('grid-template-columns: auto minmax(210px, 340px);');
    expect(css).toContain('width: min(34vw, 340px);');
    expect(css).toContain('max-width: 152px;');
    expect(css).toContain('flex: 0 0 30px;');
  });

  it('keeps FINAL queue and media walls on stable scroll containers', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('/* FINAL scroll repair: keep virtual queues and media walls on stable scroll layers. */');
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.page-surface:has\(\.queue-page\) \{[\s\S]*?height: 100%;[\s\S]*?max-height: 100%;[\s\S]*?overflow-y: auto !important;[\s\S]*?scrollbar-gutter: stable;/,
    );
    expect(css).not.toContain('html[data-theme-preset="FINAL"] .page-surface:has(:is(.queue-page, .albums-page, .artists-page)) {');
    expect(css).not.toContain('html[data-theme-preset="FINAL"] :is(.queue-page, .albums-page, .artists-page) {');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.albums-page, .artists-page) {');
    expect(css).toMatch(/html\[data-theme-preset="FINAL"\] \.queue-page \{[\s\S]*?height: auto;[\s\S]*?min-height: 100%;[\s\S]*?overflow: visible;/);
    expect(css).toMatch(/html\[data-theme-preset="FINAL"\] \.queue-list-section \{[\s\S]*?flex: none;[\s\S]*?overflow: visible;/);
    expect(css).toMatch(
      /html\[data-theme-preset="FINAL"\] \.page-surface:has\(:is\(\.albums-page, \.artists-page\)\) \{[\s\S]*?overflow: hidden !important;/,
    );
    expect(css).toContain('html[data-theme-preset="FINAL"] .queue-list {');
    expect(css).toContain('overscroll-behavior: contain;');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.albums-page, .artists-page) .media-wall-scroll-shell {');
    expect(css).toContain('scrollbar-gutter: stable;');
    expect(css).toContain('overflow-anchor: none;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .page-surface:has(.album-detail-page) {');
    expect(css).toContain('overflow-y: auto !important;');
    expect(css).toMatch(/html\[data-theme-preset="FINAL"\] \.artists-page \.artist-wall > \.artist-card \{[\s\S]*?overflow-anchor: none;/);
    expect(css).toContain('html[data-theme-preset="FINAL"] .artists-page .artist-wall :is(');
    expect(css).toContain('.artist-avatar[data-visual="avatar"],');
    expect(css).toContain('clip-path: none !important;');
  });

  it('keeps the FINAL hero character from being hard-cropped', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('/* FINAL hero character repair: remove the hard rectangular crop and let the edge fade naturally. */');
    expect(css).toContain('html[data-theme-preset="FINAL"] .home-hero::after {');
    expect(css).toContain('clip-path: none !important;');
    expect(css).toContain('-webkit-mask-image: linear-gradient(180deg, #000 0 84%, rgb(0 0 0 / 0.96) 91%, transparent 100%);');
    expect(css).toContain('mask-image: linear-gradient(180deg, #000 0 84%, rgb(0 0 0 / 0.96) 91%, transparent 100%);');
  });
});
