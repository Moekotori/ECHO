import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('global album cover shape styles', () => {
  it('covers album artwork across the main renderer surfaces', () => {
    const styles = readFileSync('src/renderer/styles/theme-presets.css', 'utf8');
    const shapeRuleStart = styles.indexOf('html[data-album-cover-shape] :is(');
    const shapeRuleEnd = styles.indexOf(') {', shapeRuleStart);
    const shapeSelector = styles.slice(shapeRuleStart, shapeRuleEnd);

    expect(shapeRuleStart).toBeGreaterThan(-1);
    expect(shapeSelector).toContain('.album-cover');
    expect(shapeSelector).toContain('.album-detail-cover');
    expect(shapeSelector).toContain('.player-cover');
    expect(shapeSelector).toContain('.now-playing-cover');
    expect(shapeSelector).toContain('.history-cover');
    expect(shapeSelector).toContain('.inbox-track-cover');
    expect(shapeSelector).toContain('.lyrics-queue-row-cover');
    expect(shapeSelector).toContain('.streaming-cover:not(.streaming-cover--avatar)');
  });
});
