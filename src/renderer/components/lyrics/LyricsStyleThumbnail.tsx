import type { LyricsPageStyle } from '../../../shared/types/appSettings';
import './lyricsStyleThumbnail.css';

const defaultPreview = new URL('../../assets/lyrics-style-previews/default.webp', import.meta.url).href;
const afterglowPreview = new URL('../../assets/lyrics-style-previews/afterglowCover.webp', import.meta.url).href;

/** Visible cards show a captured frame of the built-in style. */
export const LyricsStyleThumbnail = ({ mode }: { mode: LyricsPageStyle }): JSX.Element => (
  <img className="lyrics-style-thumbnail" data-style={mode} aria-hidden="true" alt="" draggable={false}
    src={mode === 'afterglowCover' ? afterglowPreview : defaultPreview}
    loading="lazy" decoding="async" width={384} height={216} />
);
