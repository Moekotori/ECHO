// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlayerProgress } from './PlayerProgress';

describe('PlayerProgress', () => {
  it('previews drag position locally and commits only when released', () => {
    const onCommit = vi.fn();

    render(
      <PlayerProgress
        disabled={false}
        durationSeconds={180}
        positionSeconds={4}
        onCommit={onCommit}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Seek position' });
    expect(screen.getByText('0:04')).toBeTruthy();

    fireEvent.change(slider, { target: { value: '30' } });

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText('0:30')).toBeTruthy();
    expect((slider as HTMLInputElement).value).toBe('30');

    fireEvent.pointerUp(slider);

    expect(onCommit).toHaveBeenCalledWith(30);
  });

  it('keeps the Dark Side theme prism progress treatment scoped to that preset', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('The Dark Side of the Moon theme, a tribute to Pink Floyd.');
    expect(css).toContain('html[data-theme-preset="darkSideMoon"] .player-bar .progress-track');
    expect(css).toContain('html[data-theme-preset="darkSideMoon"] .player-bar .progress-fill');
    expect(css).toContain('html[data-theme-preset="darkSideMoon"] .player-bar .progress-thumb');
    expect(css).toContain('--preset-app-bg: #10111a;');
    expect(css).toContain('html[data-theme-preset="darkSideMoon"] .settings-range-field input[type="range"]::-webkit-slider-runnable-track');
    expect(css).toContain('html[data-theme-preset="darkSideMoon"] .album-detail-page');
    expect(css).toContain('html[data-theme-preset="darkSideMoon"] .artist-detail-page');
    expect(css).toContain('html[data-theme-preset="darkSideMoon"] .artist-detail-tabs');
    expect(css).toContain('html[data-theme-preset="darkSideMoon"] .artists-page .artist-wall .artist-copy strong');
    expect(css).toContain('html[data-theme-preset="darkSideMoon"] .artists-page .artist-wall .artist-copy small');
    expect(css).toContain('html[data-theme-preset="darkSideMoon"] .album-track-row[data-playing');
    expect(css).toMatch(
      /html\[data-theme-preset="darkSideMoon"\] \.player-bar \.progress-track\[data-waveform="true"\] \{[\s\S]*?height: 24px;[\s\S]*?overflow: visible;/,
    );
    expect(css).toMatch(
      /html\[data-theme-preset="darkSideMoon"\] \.player-bar \.progress-track\[data-waveform="true"\] \.progress-thumb \{[\s\S]*?width: 28px;[\s\S]*?height: 25px;/,
    );
    expect(css).toContain('#ed2f3b');
    expect(css).toContain('#ffd84f');
    expect(css).toContain('#28b8f0');
    expect(css).toContain('clip-path: none;');
  });

  it('keeps the Nyan Cat theme color flow visible without JS timers', () => {
    const css = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(css).toContain('--nyan-page-gradient:');
    expect(css).toContain('--nyan-surface-gradient:');
    expect(css).toContain('--nyan-player-gradient:');
    expect(css).toMatch(
      /html\[data-theme-preset="nyanCat"\] \.app-shell \{\r?\n  background: var\(--echo-polish-app-bg-layer\), var\(--echo-polish-app-bg\);/,
    );
    expect(css).toMatch(
      /html\[data-theme-preset="nyanCat"\] \.page-surface:not\(:has\(\.lyrics-page\)\) \{\r?\n  background: var\(--echo-polish-page-bg\), var\(--theme-app-bg\);/,
    );
    expect(css).toMatch(
      /html\[data-theme-preset="nyanCat"\] \.player-bar \{\r?\n  background: var\(--echo-polish-player-bg\);/,
    );
    expect(css).toContain('animation: nyan-cat-gradient-flow 18s ease-in-out infinite alternate;');
    expect(css).toMatch(
      /html\[data-theme-preset="nyanCat"\] \.player-bar \.progress-track\[data-waveform="true"\] \{[\s\S]*?height: 26px;[\s\S]*?overflow: visible;/,
    );
    expect(css).toMatch(
      /html\[data-theme-preset="nyanCat"\] \.player-bar \.progress-track\[data-waveform="true"\] \.progress-thumb \{[\s\S]*?width: 54px;[\s\S]*?height: 34px;/,
    );
    expect(css).not.toContain('setInterval');
    expect(css).not.toContain('requestAnimationFrame');
  });

  it('keeps waveform progress frameless across theme overrides', () => {
    const appCss = readFileSync('src/renderer/styles/app.css', 'utf8');
    const themeCss = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');

    expect(appCss).toMatch(
      /\.progress-track\[data-waveform="true"\] \.progress-thumb \{[\s\S]*?width: 2px;[\s\S]*?height: 28px;[\s\S]*?box-shadow: none;/,
    );
    expect(themeCss).toMatch(
      /\.app-shell--lyrics-player-drawer \.lyrics-player-drawer-host \.progress-track\[data-waveform="true"\] \{[\s\S]*?height: 24px;[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/,
    );
    expect(themeCss).toMatch(
      /html\[data-theme-preset\] \.app-shell\.app-shell--lyrics-player-drawer \.lyrics-player-drawer-host \.progress-track\[data-waveform="true"\] \.progress-thumb,[\s\S]*?\.app-shell--lyrics-player-drawer \.lyrics-player-drawer-host \.progress-track\[data-waveform="true"\] \.progress-thumb \{[\s\S]*?width: 0 !important;[\s\S]*?height: 0 !important;[\s\S]*?opacity: 0 !important;/,
    );
  });
});
