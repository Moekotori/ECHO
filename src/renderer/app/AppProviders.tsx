import type { PropsWithChildren } from 'react';
import { PlaybackCommandController } from '../components/player/PlaybackCommandController';
import { I18nProvider } from '../i18n/I18nProvider';
import { PlaybackQueueProvider } from '../stores/PlaybackQueueProvider';

export const AppProviders = ({ children }: PropsWithChildren): JSX.Element => {
  return (
    <I18nProvider>
      <PlaybackQueueProvider>
        <PlaybackCommandController />
        {children}
      </PlaybackQueueProvider>
    </I18nProvider>
  );
};
