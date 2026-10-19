// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { measureMediaWallFixedLayout, mediaWallScrollTopAfterLayoutChange } from './albumWallLayout';
import { readAlbumWallLayoutPreference, writeAlbumWallLayoutPreference } from './albumWallLayoutPreference';

const defaults = { minColumnWidth: 164, columnGap: 14, paddingRight: 8, minRowHeight: 236, copyHeight: 66 };
afterEach(() => window.localStorage.clear());
describe('album wall layout', () => {
  it('restores the saved preference and safely resets to automatic layout', () => {
    writeAlbumWallLayoutPreference({ columns: 4, rows: 3 });
    expect(readAlbumWallLayoutPreference()).toEqual({ columns: 4, rows: 3 });
    writeAlbumWallLayoutPreference({ columns: null, rows: null });
    expect(readAlbumWallLayoutPreference()).toEqual({ columns: null, rows: null });
  });
  it('keeps custom grids readable on narrow windows and square covers within row budgets', () => {
    const layout = measureMediaWallFixedLayout(400, { ...defaults, columnCount: 12, visibleRowCount: 6 }, 360)!;
    expect(layout.columnCount).toBeLessThan(12);
    expect(layout.cardWidth).toBeGreaterThanOrEqual(96);
    expect(layout.coverSize).toBeLessThanOrEqual(layout.cardWidth);
    expect(layout.coverSize! + defaults.copyHeight).toBeLessThanOrEqual(layout.rowHeight);
  });
  it('retains the first visible item when changing density', () => {
    const previous = measureMediaWallFixedLayout(1200, { ...defaults, columnCount: 4 })!;
    const next = measureMediaWallFixedLayout(1200, { ...defaults, columnCount: 6 })!;
    const scrollTop = mediaWallScrollTopAfterLayoutChange(previous.rowHeight * 3, previous, next);
    expect(Math.floor(scrollTop / next.rowHeight) * next.columnCount).toBe(12);
  });
});
