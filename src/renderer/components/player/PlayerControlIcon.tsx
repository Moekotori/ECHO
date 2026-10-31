import { memo, useMemo, type CSSProperties } from 'react';
import controlsAccentMask from '../../assets/player-controls/masks/controls-accent.svg?inline';
import controlsBaseMask from '../../assets/player-controls/masks/controls-base.svg?inline';
import desktopLyricsAccentMask from '../../assets/player-controls/masks/desktop-lyrics-accent.png?inline';
import desktopLyricsBaseMask from '../../assets/player-controls/masks/desktop-lyrics-base.png?inline';
import likeFilledAccentMask from '../../assets/player-controls/masks/like-filled-accent.png?inline';
import likeFilledBaseMask from '../../assets/player-controls/masks/like-filled-base.png?inline';
import likeAccentMask from '../../assets/player-controls/masks/like-accent.png?inline';
import likeBaseMask from '../../assets/player-controls/masks/like-base.png?inline';
import lyricsAccentMask from '../../assets/player-controls/masks/lyrics-accent.svg?inline';
import lyricsBaseMask from '../../assets/player-controls/masks/lyrics-base.svg?inline';
import miniPlayerAccentMask from '../../assets/player-controls/masks/mini-player-accent.png?inline';
import miniPlayerBaseMask from '../../assets/player-controls/masks/mini-player-base.png?inline';
import moreAccentMask from '../../assets/player-controls/masks/more-accent.svg?inline';
import moreBaseMask from '../../assets/player-controls/masks/more-base.svg?inline';
import nextAccentMask from '../../assets/player-controls/masks/next-accent.png?inline';
import nextBaseMask from '../../assets/player-controls/masks/next-base.png?inline';
import pauseAccentMask from '../../assets/player-controls/masks/pause-accent.png?inline';
import pauseBaseMask from '../../assets/player-controls/masks/pause-base.png?inline';
import playAccentMask from '../../assets/player-controls/masks/play-accent.png?inline';
import playBaseMask from '../../assets/player-controls/masks/play-base.png?inline';
import previousAccentMask from '../../assets/player-controls/masks/previous-accent.png?inline';
import previousBaseMask from '../../assets/player-controls/masks/previous-base.png?inline';
import repeatOneAccentMask from '../../assets/player-controls/masks/repeat-one-accent.png?inline';
import repeatOneBaseMask from '../../assets/player-controls/masks/repeat-one-base.png?inline';
import sequenceAccentMask from '../../assets/player-controls/masks/sequence-accent.png?inline';
import sequenceBaseMask from '../../assets/player-controls/masks/sequence-base.png?inline';
import shuffleAccentMask from '../../assets/player-controls/masks/shuffle-accent.png?inline';
import shuffleBaseMask from '../../assets/player-controls/masks/shuffle-base.png?inline';
import signalPathAccentMask from '../../assets/player-controls/masks/signal-path-accent.png?inline';
import signalPathBaseMask from '../../assets/player-controls/masks/signal-path-base.png?inline';
import speedAccentMask from '../../assets/player-controls/masks/speed-accent.png?inline';
import speedBaseMask from '../../assets/player-controls/masks/speed-base.png?inline';
import volumeAccentMask from '../../assets/player-controls/masks/volume-accent.png?inline';
import volumeBaseMask from '../../assets/player-controls/masks/volume-base.png?inline';

export type PlayerControlIconName =
  | 'controls'
  | 'desktop-lyrics'
  | 'like'
  | 'like-filled'
  | 'lyrics'
  | 'mini-player'
  | 'more'
  | 'next'
  | 'pause'
  | 'play'
  | 'previous'
  | 'repeat-one'
  | 'sequence'
  | 'shuffle'
  | 'signal-path'
  | 'speed'
  | 'volume';

export type PlayerControlIconMotion =
  | 'device-toggle'
  | 'like-on'
  | 'like-off'
  | 'mode-change'
  | 'panel-toggle'
  | 'primary-change'
  | 'speed-feedback'
  | 'volume-feedback';

type PlayerControlIconMasks = {
  base: string;
  accent: string;
};

const iconMasksByName: Record<PlayerControlIconName, PlayerControlIconMasks> = {
  controls: { base: controlsBaseMask, accent: controlsAccentMask },
  'desktop-lyrics': { base: desktopLyricsBaseMask, accent: desktopLyricsAccentMask },
  like: { base: likeBaseMask, accent: likeAccentMask },
  'like-filled': { base: likeFilledBaseMask, accent: likeFilledAccentMask },
  lyrics: { base: lyricsBaseMask, accent: lyricsAccentMask },
  'mini-player': { base: miniPlayerBaseMask, accent: miniPlayerAccentMask },
  more: { base: moreBaseMask, accent: moreAccentMask },
  next: { base: nextBaseMask, accent: nextAccentMask },
  pause: { base: pauseBaseMask, accent: pauseAccentMask },
  play: { base: playBaseMask, accent: playAccentMask },
  previous: { base: previousBaseMask, accent: previousAccentMask },
  'repeat-one': { base: repeatOneBaseMask, accent: repeatOneAccentMask },
  sequence: { base: sequenceBaseMask, accent: sequenceAccentMask },
  shuffle: { base: shuffleBaseMask, accent: shuffleAccentMask },
  'signal-path': { base: signalPathBaseMask, accent: signalPathAccentMask },
  speed: { base: speedBaseMask, accent: speedAccentMask },
  volume: { base: volumeBaseMask, accent: volumeAccentMask },
};

const opticalSizeByName: Record<PlayerControlIconName, number> = {
  controls: 22,
  'desktop-lyrics': 20,
  like: 24,
  'like-filled': 23,
  lyrics: 22,
  'mini-player': 21,
  more: 22,
  next: 22,
  pause: 30,
  play: 35,
  previous: 22,
  'repeat-one': 21,
  sequence: 24,
  shuffle: 25,
  'signal-path': 22,
  speed: 20,
  volume: 21,
};

const createMaskStyle = (source: string): CSSProperties => {
  const maskImage = `url("${source}")`;
  return { maskImage, WebkitMaskImage: maskImage };
};

export const PlayerControlIcon = memo(({
  motion,
  name,
  size = opticalSizeByName[name],
}: {
  motion?: PlayerControlIconMotion;
  name: PlayerControlIconName;
  size?: number | string;
}): JSX.Element => {
  const masks = iconMasksByName[name];
  // Inline PNG masks are large strings. Rebuilding these on every playback
  // tick makes React flatten/compare new data URLs even when the icon is static.
  const baseStyle = useMemo(() => createMaskStyle(masks.base), [masks.base]);
  const accentStyle = useMemo(() => createMaskStyle(masks.accent), [masks.accent]);

  return (
    <span
      className="player-control-icon"
      data-player-control-icon={name}
      data-player-control-motion={motion}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="player-control-icon__layer player-control-icon__layer--base" style={baseStyle} />
      <span className="player-control-icon__layer player-control-icon__layer--accent" style={accentStyle} />
    </span>
  );
});

PlayerControlIcon.displayName = 'PlayerControlIcon';
