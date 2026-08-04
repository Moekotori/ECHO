import type { PropsWithChildren } from 'react';

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
  return (
    <main
      aria-hidden={isActive ? undefined : true}
      className={className}
      data-motion-route="true"
      data-route-id={routeId}
      hidden={hidden}
    >
      {children}
    </main>
  );
};
