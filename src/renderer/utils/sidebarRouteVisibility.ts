import type { AppSettings } from '../../shared/types/appSettings';
import { normalizeSidebarHiddenRouteIds, normalizeSidebarRouteOrder, type SidebarRouteId } from '../../shared/types/sidebar';

type AppSettingsBridge = {
  getSettings?: () => Promise<AppSettings>;
  setSettings?: (patch: Partial<AppSettings>) => Promise<AppSettings>;
};

export const hideSidebarRouteEntry = async (
  routeId: SidebarRouteId,
  appBridge: AppSettingsBridge | null | undefined = window.echo?.app,
): Promise<void> => {
  if (!appBridge?.setSettings) {
    throw new Error('Desktop settings bridge is unavailable.');
  }

  const currentSettings = await appBridge.getSettings?.().catch(() => ({} as AppSettings)) ?? ({} as AppSettings);
  const patch: Pick<AppSettings, 'sidebarHiddenRouteIds' | 'sidebarRouteOrder'> = {
    sidebarRouteOrder: normalizeSidebarRouteOrder(currentSettings.sidebarRouteOrder),
    sidebarHiddenRouteIds: normalizeSidebarHiddenRouteIds([
      ...normalizeSidebarHiddenRouteIds(currentSettings.sidebarHiddenRouteIds),
      routeId,
    ]),
  };
  const nextSettings = await appBridge.setSettings(patch);
  window.dispatchEvent(new CustomEvent('settings:changed', { detail: nextSettings }));
  window.dispatchEvent(new CustomEvent('app:navigate:route', { detail: 'home' }));
};
