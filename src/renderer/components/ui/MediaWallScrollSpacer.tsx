import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

type MediaWallScrollSpacerInput = {
  itemCount: number;
  totalCount: number;
  minColumnWidth: number;
  columnGap: number;
  rowGap: number;
  estimatedItemHeight: number;
};

type MediaWallScrollSpacerResult<T extends HTMLElement> = {
  wallRef: RefObject<T>;
  spacerHeight: number;
};

const clampNonNegative = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

export const useMediaWallScrollSpacer = <T extends HTMLElement>({
  itemCount,
  totalCount,
  minColumnWidth,
  columnGap,
  rowGap,
  estimatedItemHeight,
}: MediaWallScrollSpacerInput): MediaWallScrollSpacerResult<T> => {
  const wallRef = useRef<T>(null);
  const [spacerHeight, setSpacerHeight] = useState(0);

  useLayoutEffect(() => {
    const wall = wallRef.current;

    if (!wall || totalCount <= itemCount || totalCount <= 0) {
      setSpacerHeight(0);
      return undefined;
    }

    const calculateSpacerHeight = (): void => {
      const measuredWidth = wall.getBoundingClientRect().width || wall.clientWidth;
      const columns = Math.max(1, Math.floor((measuredWidth + columnGap) / (minColumnWidth + columnGap)));
      const loadedRows = Math.ceil(itemCount / columns);
      const totalRows = Math.ceil(totalCount / columns);
      const firstCard = wall.firstElementChild as HTMLElement | null;
      const measuredItemHeight = clampNonNegative(firstCard?.getBoundingClientRect().height ?? 0);
      const itemHeight = measuredItemHeight || estimatedItemHeight;
      const loadedHeight = loadedRows > 0 ? loadedRows * itemHeight + Math.max(0, loadedRows - 1) * rowGap : 0;
      const totalHeight = totalRows > 0 ? totalRows * itemHeight + Math.max(0, totalRows - 1) * rowGap : 0;

      setSpacerHeight(Math.max(0, Math.round(totalHeight - loadedHeight)));
    };

    calculateSpacerHeight();

    if (typeof window.ResizeObserver !== 'function') {
      window.addEventListener('resize', calculateSpacerHeight);
      return () => window.removeEventListener('resize', calculateSpacerHeight);
    }

    const observer = new window.ResizeObserver(calculateSpacerHeight);
    observer.observe(wall);
    return () => observer.disconnect();
  }, [columnGap, estimatedItemHeight, itemCount, minColumnWidth, rowGap, totalCount]);

  return { wallRef, spacerHeight };
};

export const MediaWallScrollSpacer = ({ height }: { height: number }): JSX.Element | null =>
  height > 0 ? <div className="media-wall-scroll-spacer" style={{ height }} aria-hidden="true" /> : null;
