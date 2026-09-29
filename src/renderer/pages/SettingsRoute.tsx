import { Suspense, lazy } from 'react';
import { useI18n } from '../i18n/I18nProvider';

export const loadSettingsPage = () => import('./SettingsPage');

const LazySettingsPage = lazy(() => loadSettingsPage().then((module) => ({ default: module.SettingsPage })));

const SettingsRouteFallback = (): JSX.Element => {
  const { t } = useI18n();

  return (
    <div className="settings-page settings-route-loading no-drag" role="status" aria-label={t('route.settings.label')}>
      <header className="settings-header">
        <div className="settings-header-copy">
          <h1>{t('route.settings.label')}</h1>
          <div className="settings-route-loading__line settings-route-loading__line--context" aria-hidden="true" />
        </div>
        <div className="settings-route-loading__search" aria-hidden="true" />
      </header>
      <div className="settings-body">
        <div className="settings-route-loading__nav" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
        <div className="settings-route-loading__content" aria-hidden="true">
          <span className="route-loading-spinner" />
          <div className="settings-route-loading__line settings-route-loading__line--title" />
          <div className="settings-route-loading__rows">
            {Array.from({ length: 5 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const SettingsRoute = (): JSX.Element => (
  <Suspense fallback={<SettingsRouteFallback />}>
    <LazySettingsPage />
  </Suspense>
);
