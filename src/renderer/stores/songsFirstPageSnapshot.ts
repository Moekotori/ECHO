import type { LibraryPage, LibraryPageQuery, LibraryTrack } from '../../shared/types/library';

export type SongsFirstPageSnapshot = {
  version: 1;
  queryKey: string;
  savedAt: string;
  items: LibraryTrack[];
  total: number;
};

export type SongsStartupLoadDiagnostics = {
  version: 1;
  source: 'renderer-snapshot' | 'sqlite';
  sqliteQueryMs: number | null;
  itemCount: number;
  total: number;
  recordedAt: string;
};

const snapshotStorageKey = 'echo-next.songs.first-page-snapshot';
const diagnosticsStorageKey = 'echo-next.songs.startup-load';
const snapshotVersion = 1;
const maxSnapshotItems = 100;

type SnapshotQuery = Pick<LibraryPageQuery, 'search' | 'sort' | 'hideDuplicates' | 'showDuplicatesOnly' | 'duplicateMode'> & {
  pageSize: number;
  sourceProvider?: 'local' | 'remote';
  sourceId?: string | null;
};

const nowIso = (): string => new Date().toISOString();

const safeStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const finiteNonNegative = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
};

const isTrackLike = (value: unknown): value is LibraryTrack => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const track = value as Partial<LibraryTrack>;
  return (
    typeof track.id === 'string' &&
    typeof track.path === 'string' &&
    typeof track.title === 'string' &&
    typeof track.artist === 'string' &&
    typeof track.album === 'string'
  );
};

export const createSongsFirstPageSnapshotQueryKey = (query: SnapshotQuery): string =>
  JSON.stringify({
    page: 1,
    pageSize: Math.min(maxSnapshotItems, Math.max(1, Math.floor(query.pageSize))),
    search: query.search?.trim() ?? '',
    sort: query.sort ?? 'default',
    sourceProvider: query.sourceProvider === 'remote' ? 'remote' : 'local',
    sourceId: query.sourceProvider === 'remote' ? query.sourceId ?? null : null,
    hideDuplicates: query.hideDuplicates === true,
    showDuplicatesOnly: query.showDuplicatesOnly === true,
    duplicateMode: query.duplicateMode === 'strict' ? 'strict' : 'strict',
  });

export const canUseSongsFirstPageSnapshot = (query: SnapshotQuery): boolean =>
  Number.isFinite(query.pageSize) && query.pageSize <= maxSnapshotItems && (query.search?.trim() ?? '').length === 0;

export const readSongsFirstPageSnapshot = (queryKey: string): SongsFirstPageSnapshot | null => {
  const storage = safeStorage();
  if (!storage) {
    return null;
  }

  try {
    const parsed = JSON.parse(storage.getItem(snapshotStorageKey) ?? 'null') as Partial<SongsFirstPageSnapshot> | null;
    if (!parsed || parsed.version !== snapshotVersion || parsed.queryKey !== queryKey || typeof parsed.savedAt !== 'string') {
      return null;
    }

    const items = Array.isArray(parsed.items) ? parsed.items.filter(isTrackLike) : [];
    const total = finiteNonNegative(parsed.total);
    if (items.length === 0 || items.length > maxSnapshotItems || total === null || total < items.length) {
      return null;
    }

    return {
      version: snapshotVersion,
      queryKey,
      savedAt: parsed.savedAt,
      items,
      total,
    };
  } catch {
    return null;
  }
};

export const writeSongsFirstPageSnapshot = (queryKey: string, page: LibraryPage<LibraryTrack>): void => {
  const storage = safeStorage();
  if (!storage || page.page !== 1 || page.items.length === 0) {
    return;
  }

  const snapshot: SongsFirstPageSnapshot = {
    version: snapshotVersion,
    queryKey,
    savedAt: nowIso(),
    items: page.items.slice(0, maxSnapshotItems),
    total: Math.max(page.total, page.items.length),
  };

  try {
    storage.setItem(snapshotStorageKey, JSON.stringify(snapshot));
  } catch {
    // A stale or unavailable snapshot must never affect the real SQLite-backed library.
  }
};

export const clearSongsFirstPageSnapshot = (): void => {
  try {
    safeStorage()?.removeItem(snapshotStorageKey);
  } catch {
    // Snapshot cleanup is best-effort.
  }
};

export const beginSongsStartupLoadDiagnostics = (input: {
  source: SongsStartupLoadDiagnostics['source'];
  itemCount: number;
  total: number;
}): void => {
  const storage = safeStorage();
  if (!storage) {
    return;
  }

  const diagnostics: SongsStartupLoadDiagnostics = {
    version: snapshotVersion,
    source: input.source,
    sqliteQueryMs: null,
    itemCount: Math.max(0, Math.floor(input.itemCount)),
    total: Math.max(0, Math.floor(input.total)),
    recordedAt: nowIso(),
  };

  try {
    storage.setItem(diagnosticsStorageKey, JSON.stringify(diagnostics));
  } catch {
    // Diagnostics are informational only.
  }
};

export const finishSongsStartupSqliteLoadDiagnostics = (input: {
  sqliteQueryMs: number;
  itemCount: number;
  total: number;
}): void => {
  const storage = safeStorage();
  if (!storage) {
    return;
  }

  const current = readSongsStartupLoadDiagnostics();
  const sqliteQueryMs = finiteNonNegative(input.sqliteQueryMs) ?? 0;
  const diagnostics: SongsStartupLoadDiagnostics = {
    version: snapshotVersion,
    source: current?.source ?? 'sqlite',
    sqliteQueryMs,
    itemCount: Math.max(0, Math.floor(input.itemCount)),
    total: Math.max(0, Math.floor(input.total)),
    recordedAt: nowIso(),
  };

  try {
    storage.setItem(diagnosticsStorageKey, JSON.stringify(diagnostics));
  } catch {
    // Diagnostics are informational only.
  }
};

export const readSongsStartupLoadDiagnostics = (): SongsStartupLoadDiagnostics | null => {
  const storage = safeStorage();
  if (!storage) {
    return null;
  }

  try {
    const parsed = JSON.parse(storage.getItem(diagnosticsStorageKey) ?? 'null') as Partial<SongsStartupLoadDiagnostics> | null;
    if (
      !parsed ||
      parsed.version !== snapshotVersion ||
      (parsed.source !== 'renderer-snapshot' && parsed.source !== 'sqlite') ||
      typeof parsed.recordedAt !== 'string'
    ) {
      return null;
    }

    const sqliteQueryMs = parsed.sqliteQueryMs === null ? null : finiteNonNegative(parsed.sqliteQueryMs);
    const itemCount = finiteNonNegative(parsed.itemCount);
    const total = finiteNonNegative(parsed.total);
    if ((parsed.sqliteQueryMs !== null && sqliteQueryMs === null) || itemCount === null || total === null) {
      return null;
    }

    return {
      version: snapshotVersion,
      source: parsed.source,
      sqliteQueryMs,
      itemCount: Math.floor(itemCount),
      total: Math.floor(total),
      recordedAt: parsed.recordedAt,
    };
  } catch {
    return null;
  }
};
