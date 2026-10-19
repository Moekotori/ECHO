import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, X } from 'lucide-react';
import type { LibraryTrack } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { localCoverDisplayUrl } from '../../utils/coverDisplayUrl';
import './track-cover-preview.css';

export const TrackCoverPreview = ({ track, onClose }: { track: LibraryTrack; onClose: () => void }): JSX.Element => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const mountedRef = useRef(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const [imageFailed, setImageFailed] = useState(false);
  const isLocal = !track.mediaType || track.mediaType === 'local';
  // The existing cover protocol bounds decoded image size; copying still resolves the original.
  const imageUrl = isLocal
    ? localCoverDisplayUrl(track.coverId, track.coverThumb) ?? track.coverThumb
    : track.coverThumb;
  const canCopy = isLocal && Boolean(track.coverId && window.echo?.library?.copyTrackOriginalCover);

  useEffect(() => {
    mountedRef.current = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey ? document.activeElement === first || document.activeElement === dialogRef.current : document.activeElement === last || document.activeElement === dialogRef.current) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      mountedRef.current = false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const copyCover = async (): Promise<void> => {
    if (!canCopy || copyState === 'copying') return;
    setCopyState('copying');
    try {
      const copied = await window.echo.library.copyTrackOriginalCover(track.id);
      if (mountedRef.current) setCopyState(copied ? 'copied' : 'failed');
    } catch {
      if (mountedRef.current) setCopyState('failed');
    }
  };

  return createPortal(
    <div className="track-cover-preview-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} className="track-cover-preview" role="dialog" aria-modal="true" aria-label={`${t('communityLibrary.cover.preview')}：${track.title}`} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <div className="track-cover-preview-actions">
          {canCopy ? <button className="track-cover-preview-action" type="button" aria-label={t('communityLibrary.cover.copy')} disabled={copyState === 'copying'} onClick={() => void copyCover()}>
            {copyState === 'copied' ? <Check size={20} /> : <Copy size={20} />}
          </button> : null}
          <button className="track-cover-preview-action" type="button" aria-label={t('communityLibrary.cover.close')} onClick={onClose}><X size={20} /></button>
        </div>
        <span className="track-cover-preview-status" role="status">{copyState === 'copied' ? t('communityLibrary.cover.copied') : copyState === 'failed' ? t('communityLibrary.cover.failed') : ''}</span>
        {imageUrl && !imageFailed ? <img src={imageUrl} alt={`${track.title} · ${track.artist}`} decoding="async" draggable={false} onError={() => setImageFailed(true)} /> : <p className="track-cover-preview-empty">{t('communityLibrary.cover.empty')}</p>}
      </section>
    </div>, document.body,
  );
};
