import type { AppSettings } from '../../shared/types/appSettings';
import { isSidebarRouteId, normalizeSidebarHiddenRouteIds, normalizeSidebarRouteOrder } from '../../shared/types/sidebar';
import type { AppRoute } from './routes';

export const applySidebarPreferences = (
  routes: AppRoute[],
  settings: Pick<AppSettings, 'sidebarHiddenRouteIds' | 'sidebarRouteOrder'>,
): AppRoute[] => {
  const order = normalizeSidebarRouteOrder(settings.sidebarRouteOrder);
  const hiddenRouteIds = new Set(normalizeSidebarHiddenRouteIds(settings.sidebarHiddenRouteIds));
  const orderIndex = new Map(order.map((routeId, index) => [routeId, index]));

  return routes
    .map((route, originalIndex) => ({ route, originalIndex }))
    .sort((left, right) => {
      const leftOrder = isSidebarRouteId(left.route.id) ? orderIndex.get(left.route.id) : undefined;
      const rightOrder = isSidebarRouteId(right.route.id) ? orderIndex.get(right.route.id) : undefined;
      const leftIndex = leftOrder ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = rightOrder ?? Number.MAX_SAFE_INTEGER;

      return leftIndex === rightIndex ? left.originalIndex - right.originalIndex : leftIndex - rightIndex;
    })
    .map(({ route }) => {
      if (!isSidebarRouteId(route.id) || !hiddenRouteIds.has(route.id)) {
        return route;
      }

      return { ...route, hideFromSidebar: true };
    });
};
