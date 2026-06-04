export const sidebarRouteIds = [
  'home',
  'songs',
  'downloads',
  'albums',
  'artists',
  'folders',
  'remote',
  'connect',
  'dsp',
  'streaming',
  'queue',
  'history',
  'playlists',
  'inbox',
  'plugins',
  'liked',
  'settings',
  'audio-settings',
  'lyrics-settings',
  'import-folder',
  'import-file',
] as const;

export type SidebarRouteId = typeof sidebarRouteIds[number];

export const defaultSidebarRouteOrder: SidebarRouteId[] = [...sidebarRouteIds];
export const lockedVisibleSidebarRouteIds: SidebarRouteId[] = ['settings'];

const sidebarRouteIdSet = new Set<string>(sidebarRouteIds);
const lockedVisibleSidebarRouteIdSet = new Set<string>(lockedVisibleSidebarRouteIds);

export const isSidebarRouteId = (value: unknown): value is SidebarRouteId =>
  typeof value === 'string' && sidebarRouteIdSet.has(value);

export const normalizeSidebarRouteOrder = (value: unknown): SidebarRouteId[] => {
  const order: SidebarRouteId[] = [];
  const seen = new Set<SidebarRouteId>();

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isSidebarRouteId(item) || seen.has(item)) {
        continue;
      }

      order.push(item);
      seen.add(item);
    }
  }

  for (const routeId of defaultSidebarRouteOrder) {
    if (!seen.has(routeId)) {
      order.push(routeId);
    }
  }

  return order;
};

export const normalizeSidebarHiddenRouteIds = (value: unknown): SidebarRouteId[] => {
  const hiddenRouteIds: SidebarRouteId[] = [];
  const seen = new Set<SidebarRouteId>();

  if (!Array.isArray(value)) {
    return hiddenRouteIds;
  }

  for (const item of value) {
    if (!isSidebarRouteId(item) || lockedVisibleSidebarRouteIdSet.has(item) || seen.has(item)) {
      continue;
    }

    hiddenRouteIds.push(item);
    seen.add(item);
  }

  return hiddenRouteIds;
};
