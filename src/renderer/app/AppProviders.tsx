import type { PropsWithChildren } from 'react';
import { LazyMotion, MotionConfig } from 'motion/react';
import { PlaybackCommandController } from '../components/player/PlaybackCommandController';
import { I18nProvider } from '../i18n/I18nProvider';
import { PlaybackQueueProvider } from '../stores/PlaybackQueueProvider';

const loadLayoutMotion = () => import('../ui/motion/layoutFeatures').then((module) => module.default);

export const AppProviders = ({ children }: PropsWithChildren): JSX.Element => {
  return (
    <I18nProvider>
      <MotionConfig reducedMotion="user">
        <LazyMotion features={loadLayoutMotion}>
          <PlaybackQueueProvider>
            <PlaybackCommandController />
            {children}
          </PlaybackQueueProvider>
        </LazyMotion>
      </MotionConfig>
    </I18nProvider>
  );
};
