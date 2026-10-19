import { useState } from 'react';
import { ListMusic } from 'lucide-react';
import type { LibraryPlaylist } from '../../../shared/types/library';
import { DeferredWallImage } from '../../components/ui/DeferredWallImage';

export const PlaylistWallCover = ({ playlist }: { playlist: Pick<LibraryPlaylist, 'coverThumb'> }): JSX.Element => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cover = playlist.coverThumb;
  return (
    <span className="playlist-wall-cover" aria-hidden="true">
      {cover && failedUrl !== cover ? (
        <DeferredWallImage src={cover} alt="" width={320} height={320} loading="lazy" decoding="async" draggable={false} onError={() => setFailedUrl(cover)} />
      ) : <ListMusic size={42} strokeWidth={1.3} />}
    </span>
  );
};
