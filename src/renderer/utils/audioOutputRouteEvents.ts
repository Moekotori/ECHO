import type { AudioStatus } from '../../shared/types/audio';

export const audioOutputRouteStatusChangedEvent = 'audio:output-route-status-changed';

export type AudioOutputRouteStatusChangedDetail = {
  status: AudioStatus;
};

export const dispatchAudioOutputRouteStatusChanged = (status: AudioStatus): void => {
  window.dispatchEvent(new CustomEvent<AudioOutputRouteStatusChangedDetail>(audioOutputRouteStatusChangedEvent, {
    detail: { status },
  }));
};
