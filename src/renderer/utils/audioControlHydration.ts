import type { AudioStatus } from '../../shared/types/audio';

/** A newly mounted control observes a resident audio session, including reloads. */
export const hasResidentAudioPlayback = (status: AudioStatus | null | undefined): boolean =>
  status?.state === 'playing'
  || status?.state === 'loading'
  || (status?.state === 'paused' && status.host === 'ready');
