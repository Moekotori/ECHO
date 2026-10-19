import { BoundedTextCache } from '../text/BoundedTextCache';

// Retain the existing entry capacity and warm lifetime. Byte caps only prevent
// unusually long metadata from making a count-limited cache arbitrarily large.
export const librarySortTextCache = new BoundedTextCache(8 * 1024 * 1024);
export const libraryJapaneseConversionCache = new BoundedTextCache(4 * 1024 * 1024);
