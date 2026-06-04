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
    expect(css).toContain('rgb(10 11 12 / 0.9) !important;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .app-shell--lyrics-player-drawer .lyrics-player-drawer-host .player-bar::before,');
    expect(css).toContain('display: none !important;');
    expect(css).toContain('grid-template-columns: auto minmax(240px, 1fr);');
    expect(css).toContain('color: rgb(232 237 236 / 0.94) !important;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .app-shell--lyrics-player-drawer .lyrics-player-drawer-host .progress-track[data-waveform="true"] {');
    expect(css).toContain('/* FINAL mini player containment: keep the progress rail and right-side controls inside the capsule. */');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(css).toContain('grid-template-columns: auto minmax(210px, 340px);');
    expect(css).toContain('width: min(34vw, 340px);');
    expect(css).toContain('max-width: 152px;');
    expect(css).toContain('flex: 0 0 30px;');
  });

  it('keeps FINAL queue and media walls on stable inner scroll containers', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('/* FINAL scroll repair: keep virtual queues and media walls on their own scroll layers. */');
    expect(css).toContain('html[data-theme-preset="FINAL"] .page-surface:has(:is(.queue-page, .albums-page, .artists-page)) {');
    expect(css).toContain('overflow: hidden !important;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .queue-list {');
    expect(css).toContain('overflow-y: auto !important;');
    expect(css).toContain('overscroll-behavior: contain;');
    expect(css).toContain('html[data-theme-preset="FINAL"] :is(.albums-page, .artists-page) .media-wall-scroll-shell {');
    expect(css).toContain('scrollbar-gutter: stable;');
    expect(css).toContain('overflow-anchor: none;');
    expect(css).toContain('html[data-theme-preset="FINAL"] .artists-page .artist-wall > .artist-card {\n  overflow-anchor: none;');
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
