export type MediaWallVirtualLayout = {
  width: number;
  columnCount: number;
  cardWidth: number;
  coverSize?: number;
  columnGap: number;
  rowGap: number;
  rowHeight: number;
  paddingTop: number;
  paddingLeft: number;
};

export type MediaWallFixedLayout = {
  minColumnWidth: number;
  columnGap: number;
  paddingRight?: number;
  minRowHeight: number;
  copyHeight: number;
  cssVariablePrefix?: 'album-wall';
  columnCount?: number;
  visibleRowCount?: number;
};

// Custom grids keep covers square and leave room for text and the row gap.
export const measureMediaWallFixedLayout = (
  width: number,
  fixedLayout: MediaWallFixedLayout,
  viewportHeight = 0,
): MediaWallVirtualLayout | null => {
  const availableWidth = Math.max(0, width - (fixedLayout.paddingRight ?? 0));
  if (availableWidth <= 0) return null;

  const columnGap = fixedLayout.columnGap;
  const maxReadableColumns = Math.max(1, Math.floor((availableWidth + columnGap) / (96 + columnGap)));
  const columnCount = fixedLayout.columnCount
    ? Math.max(1, Math.min(maxReadableColumns, fixedLayout.columnCount))
    : Math.max(1, Math.floor((availableWidth + columnGap) / (fixedLayout.minColumnWidth + columnGap)));
  const cardWidth = Math.max(1, (availableWidth - columnGap * (columnCount - 1)) / columnCount);
  const hasCustomGrid = Boolean(fixedLayout.columnCount || fixedLayout.visibleRowCount);
  let rowHeight = Math.ceil(Math.max(hasCustomGrid ? 0 : fixedLayout.minRowHeight, cardWidth + fixedLayout.copyHeight));
  let coverSize = cardWidth;
  if (fixedLayout.visibleRowCount && viewportHeight > 0) {
    const minRowHeight = 64 + fixedLayout.copyHeight;
    const rows = Math.max(1, Math.min(fixedLayout.visibleRowCount, Math.floor(viewportHeight / minRowHeight)));
    rowHeight = Math.max(minRowHeight, Math.floor(viewportHeight / rows));
    coverSize = Math.min(cardWidth, rowHeight - fixedLayout.copyHeight);
  }

  return {
    width, columnCount, cardWidth,
    ...(hasCustomGrid ? { coverSize } : {}),
    columnGap, rowGap: columnGap, rowHeight, paddingTop: 0, paddingLeft: 0,
  };
};

export const mediaWallScrollTopAfterLayoutChange = (
  scrollTop: number,
  previous: MediaWallVirtualLayout,
  next: MediaWallVirtualLayout,
): number => {
  const firstIndex = Math.floor(Math.max(0, scrollTop) / previous.rowHeight) * previous.columnCount;
  const rowFraction = (Math.max(0, scrollTop) % previous.rowHeight) / previous.rowHeight;
  return (Math.floor(firstIndex / next.columnCount) + rowFraction) * next.rowHeight;
};
