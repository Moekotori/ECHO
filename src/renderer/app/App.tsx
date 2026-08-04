import { AppLayout } from './AppLayout';
import { AppProviders } from './AppProviders';
import { appRoutes } from './routes';

export const App = (): JSX.Element => {
  return (
    <AppProviders>
      <AppLayout routes={appRoutes} />
    </AppProviders>
  );
};
