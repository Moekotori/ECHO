import { Disc3 } from 'lucide-react';
import { useLyricsCoverTransition } from '../useLyricsCoverTransition';

type AfterglowCoverArtworkProps = {
  artworkUrl: string | null;
  nextArtworkUrl: string | null;
  isActive: boolean;
  animateTransitions: boolean;
};

/** The rear card previews the next distinct album only when its order is known. */
export const AfterglowCoverArtwork = ({ artworkUrl, nextArtworkUrl, isActive, animateTransitions }: AfterglowCoverArtworkProps): JSX.Element | null => {
  const frame = useLyricsCoverTransition(isActive ? artworkUrl : null, isActive && animateTransitions);
  if (!isActive) return null;

  return (
    <div className="lyrics-afterglow-cover" data-empty={!frame.current} aria-hidden="true">
      {frame.current ? (
        <>
          {nextArtworkUrl && nextArtworkUrl !== artworkUrl ? (
            <img className="lyrics-afterglow-cover__echo" alt="" decoding="async" draggable={false} src={nextArtworkUrl} />
          ) : null}
          <img className="lyrics-afterglow-cover__main" alt="" decoding="async" draggable={false} {...{ fetchpriority: 'high' }} src={frame.current} />
          {frame.previous ? (
            <img key={frame.revision} className="lyrics-afterglow-cover__main lyrics-afterglow-cover__outgoing"
              alt="" decoding="async" draggable={false} src={frame.previous} />
          ) : null}
        </>
      ) : <Disc3 size={88} strokeWidth={1} />}
    </div>
  );
};
