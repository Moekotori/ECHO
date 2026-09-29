export type RemoteRecentLocation = {
  sourceId: string;
  path: string;
  visitedAt: string;
};

export type RemotePinnedLocation = {
  sourceId: string;
  path: string;
  pinnedAt: string;
};

export type RemoteSourceUxMemory = {
  recentLocations: RemoteRecentLocation[];
  pinnedLocations: RemotePinnedLocation[];
  pinnedSourceIds: string[];
};

const storageKey = 'echo.remote-source-ux-memory.v1';
const maxRecentLocations = 40;

const emptyMemory = (): RemoteSourceUxMemory => ({
  recentLocations: [],
  pinnedLocations: [],
  pinnedSourceIds: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';
const isString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const readLocation = <T extends 'visitedAt' | 'pinnedAt'>(value: unknown, dateKey: T): ({ sourceId: string; path: string } & Record<T, string>) | null => {
  if (!isRecord(value) || !isString(value.sourceId) || !isString(value.path) || !isString(value[dateKey])) {
    return null;
  }
  return {
    sourceId: value.sourceId,
    path: value.path,
    [dateKey]: value[dateKey],
  } as { sourceId: string; path: string } & Record<T, string>;
};

export const loadRemoteSourceUxMemory = (): RemoteSourceUxMemory => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return emptyMemory();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return emptyMemory();
    }
    const recentLocations = Array.isArray(parsed.recentLocations)
      ? parsed.recentLocations.map((item) => readLocation(item, 'visitedAt')).filter((item): item is RemoteRecentLocation => Boolean(item)).slice(0, maxRecentLocations)
      : [];
    const pinnedLocations = Array.isArray(parsed.pinnedLocations)
      ? parsed.pinnedLocations.map((item) => readLocation(item, 'pinnedAt')).filter((item): item is RemotePinnedLocation => Boolean(item))
      : [];
    const pinnedSourceIds = Array.isArray(parsed.pinnedSourceIds)
      ? [...new Set(parsed.pinnedSourceIds.filter(isString))]
      : [];
    return { recentLocations, pinnedLocations, pinnedSourceIds };
  } catch {
    return emptyMemory();
  }
};

export const saveRemoteSourceUxMemory = (memory: RemoteSourceUxMemory): void => {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(memory));
  } catch {
    // Personal shortcuts should never block remote library access.
  }
};

export const rememberRemoteLocation = (
  memory: RemoteSourceUxMemory,
  input: { sourceId: string; path: string; visitedAt?: string },
): RemoteSourceUxMemory => ({
  ...memory,
  recentLocations: [
    { sourceId: input.sourceId, path: input.path, visitedAt: input.visitedAt ?? new Date().toISOString() },
    ...memory.recentLocations.filter((item) => item.sourceId !== input.sourceId || item.path !== input.path),
  ].slice(0, maxRecentLocations),
});

export const toggleRemoteSourcePinned = (memory: RemoteSourceUxMemory, sourceId: string): RemoteSourceUxMemory => ({
  ...memory,
  pinnedSourceIds: memory.pinnedSourceIds.includes(sourceId)
    ? memory.pinnedSourceIds.filter((item) => item !== sourceId)
    : [...memory.pinnedSourceIds, sourceId],
});

export const toggleRemoteLocationPinned = (
  memory: RemoteSourceUxMemory,
  input: { sourceId: string; path: string; pinnedAt?: string },
): RemoteSourceUxMemory => {
  const exists = memory.pinnedLocations.some((item) => item.sourceId === input.sourceId && item.path === input.path);
  return {
    ...memory,
    pinnedLocations: exists
      ? memory.pinnedLocations.filter((item) => item.sourceId !== input.sourceId || item.path !== input.path)
      : [
          ...memory.pinnedLocations,
          { sourceId: input.sourceId, path: input.path, pinnedAt: input.pinnedAt ?? new Date().toISOString() },
        ],
  };
};

export const removeRemoteSourceUxMemory = (memory: RemoteSourceUxMemory, sourceId: string): RemoteSourceUxMemory => ({
  recentLocations: memory.recentLocations.filter((item) => item.sourceId !== sourceId),
  pinnedLocations: memory.pinnedLocations.filter((item) => item.sourceId !== sourceId),
  pinnedSourceIds: memory.pinnedSourceIds.filter((item) => item !== sourceId),
});
