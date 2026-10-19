import { createContext, useContext } from 'react';
import type { PropsWithChildren } from 'react';

const RouteActivityContext = createContext(true);
const RouteResourcesContext = createContext(true);

export const RouteActivityProvider = ({ children, isActive, resourcesActive = isActive }: PropsWithChildren<{
  isActive: boolean;
  resourcesActive?: boolean;
}>): JSX.Element => (
  <RouteActivityContext.Provider value={isActive}>
    <RouteResourcesContext.Provider value={resourcesActive}>{children}</RouteResourcesContext.Provider>
  </RouteActivityContext.Provider>
);

export const useRouteActivity = (): boolean => useContext(RouteActivityContext);
export const useRouteResourcesActive = (): boolean => useContext(RouteResourcesContext);
