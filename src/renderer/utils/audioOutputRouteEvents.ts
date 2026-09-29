import type { AudioStatus } from '../../shared/types/audio';

export const audioOutputRouteStatusChangedEvent = 'audio:output-route-status-changed';

let audioOutputRouteMutationSequence = 0;

export const markAudioOutputRouteMutationStarted = (): number => {
  audioOutputRouteMutationSequence += 1;
  return audioOutputRouteMutationSequence;
};

export const getAudioOutputRouteMutationSequence = (): number => audioOutputRouteMutationSequence;

export type AudioOutputRouteStatusChangedDetail = {
  status: AudioStatus;
};

export const dispatchAudioOutputRouteStatusChanged = (status: AudioStatus): void => {
  window.dispatchEvent(new CustomEvent<AudioOutputRouteStatusChangedDetail>(audioOutputRouteStatusChangedEvent, {
    detail: { status },
  }));
};
