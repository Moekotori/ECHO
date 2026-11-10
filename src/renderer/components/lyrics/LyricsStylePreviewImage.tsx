import type { LyricsPageStyle } from '../../../shared/types/appSettings';
import { LyricsStyleThumbnail } from './LyricsStyleThumbnail';

const previews: Partial<Record<LyricsPageStyle, string>> = {
  default: new URL('../../assets/lyrics-style-previews/large/default.webp', import.meta.url).href,
  afterglowCover: new URL('../../assets/lyrics-style-previews/large/afterglowCover.webp', import.meta.url).href,
};

export const LyricsStylePreviewImage = ({ mode }: { mode: LyricsPageStyle }): JSX.Element => {
  const src = previews[mode];
  return src
    ? <img className="lyrics-style-thumbnail" src={src} alt="" draggable={false} decoding="async" width={960} height={540} />
    : <LyricsStyleThumbnail mode={mode} />;
};
