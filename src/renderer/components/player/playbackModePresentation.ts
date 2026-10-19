import { Repeat1, Repeat2 } from 'lucide-react';
import type { PersistedPlaybackRepeatMode } from '../../../shared/types/playback';
import { EchoSequenceIcon, EchoShuffleIcon } from './QueueControlIcons';

export const playbackModeOptions = [
  {
    id: 'sequential',
    labelKey: 'queue.page.order.sequential',
    titleKey: 'playerTransport.action.playInOrder',
    Icon: EchoSequenceIcon,
    workshopIcon: 'transport-queue',
  },
  {
    id: 'shuffle',
    labelKey: 'queue.page.order.shuffle',
    titleKey: 'playerTransport.action.shuffle',
    Icon: EchoShuffleIcon,
    workshopIcon: 'transport-shuffle',
  },
  {
    id: 'repeat-one',
    labelKey: 'queue.repeat.one',
    titleKey: 'playerTransport.action.repeatOne',
    Icon: Repeat1,
    workshopIcon: 'transport-repeat-one',
  },
  {
    id: 'repeat-all',
    labelKey: 'queue.repeat.all',
    titleKey: 'playerTransport.action.repeat',
    Icon: Repeat2,
    workshopIcon: 'transport-repeat',
  },
] as const;

export type PlaybackMode = (typeof playbackModeOptions)[number]['id'];

type PlaybackModeState = {
  isShuffleEnabled: boolean;
  repeatMode: PersistedPlaybackRepeatMode;
};

export const getPlaybackMode = ({ isShuffleEnabled, repeatMode }: PlaybackModeState): PlaybackMode => {
  if (repeatMode === 'one') return 'repeat-one';
  if (isShuffleEnabled) return 'shuffle';
  return repeatMode === 'all' ? 'repeat-all' : 'sequential';
};

export const getPlaybackModePresentation = (state: PlaybackModeState): (typeof playbackModeOptions)[number] =>
  playbackModeOptions.find((option) => option.id === getPlaybackMode(state))!;

export const nextPlaybackMode = (state: PlaybackModeState): PlaybackMode => {
  const index = playbackModeOptions.findIndex((option) => option.id === getPlaybackMode(state));
  return playbackModeOptions[(index + 1) % playbackModeOptions.length].id;
};

export const selectPlaybackMode = (
  queue: PlaybackModeState & {
    setRepeatMode: (mode: PersistedPlaybackRepeatMode) => void;
    toggleShuffle: () => void;
  },
  mode: PlaybackMode,
): void => {
  // `off` is the existing protocol value for playing once in order or shuffle.
  const repeatMode = mode === 'repeat-one' ? 'one' : mode === 'repeat-all' ? 'all' : 'off';
  if (queue.repeatMode !== repeatMode) queue.setRepeatMode(repeatMode);
  if (queue.isShuffleEnabled !== (mode === 'shuffle')) queue.toggleShuffle();
};
