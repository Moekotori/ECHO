import { useLayoutEffect } from 'react';
import { AppLayout } from './AppLayout';
import { AppProviders } from './AppProviders';
import { appRoutes, preloadPendingAppRoute } from './routes';
import { markStartupAppMounted } from '../startupOverlay';

export const prepareAppStartup = async (): Promise<void> => {
  await preloadPendingAppRoute();
};

export const App = (): JSX.Element => {
  useLayoutEffect(() => {
    markStartupAppMounted();
  }, []);

  return (
    <AppProviders>
      <AppLayout routes={appRoutes} />
    </AppProviders>
  );
};
