import type { AudioOutputSettings } from '../../shared/types/audio';
import type { PlayableTrack } from '../../shared/types/remoteSources';

const isLiveM3u8Stream = (item: PlayableTrack): boolean =>
  item.mediaType === 'streaming' &&
  item.provider === 'm3u8' &&
  !(typeof item.duration === 'number' && item.duration > 0);

export const resolvePlaybackOutputForMediaItem = (
  item: PlayableTrack,
  output: AudioOutputSettings | undefined,
): AudioOutputSettings | undefined => {
  if (!isLiveM3u8Stream(item)) {
    return output;
  }

  return {
    ...output,
    // Live radio formats can be opaque until FFmpeg opens the stream. Keep the
    // selected output route, but do not let native-only DSP block PCM fallback.
    sdmMode: 'off',
    echoSrcMode: 'off',
    pcmDitherMode: 'off',
  };
};
