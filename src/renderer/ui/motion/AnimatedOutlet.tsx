import { useRef } from 'react';
import type { PropsWithChildren } from 'react';
import { RouteActivityProvider } from '../../components/ui/RouteActivityContext';
import { useRetainedRouteResources } from '../../performance/useRetainedRouteResources';

type AnimatedOutletProps = PropsWithChildren<{
  className?: string;
  hidden?: boolean;
  isActive: boolean;
  routeId: string;
}>;

export const AnimatedOutlet = ({
  children,
  className,
  hidden,
  isActive,
  routeId,
}: AnimatedOutletProps): JSX.Element => {
  const root = useRef<HTMLElement | null>(null);
  const resourcesActive = useRetainedRouteResources(root, isActive);
  return (
    <main
      ref={root}
      data-route-resources-parked={resourcesActive ? undefined : 'true'}
      aria-hidden={isActive ? undefined : true}
      className={className}
      data-motion-route="true"
      data-route-id={routeId}
      hidden={hidden}
      id={`main-content-${routeId}`}
      tabIndex={-1}
    >
      <RouteActivityProvider isActive={isActive} resourcesActive={resourcesActive}>
        {children}
      </RouteActivityProvider>
    </main>
  );
};
