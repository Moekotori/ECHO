import { useEffect, useRef, useState } from 'react';
import { Grid3X3 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import { StyledSelect } from '../../components/ui/StyledSelect';
import { albumWallMaxColumns, albumWallMaxRows, defaultAlbumWallLayout, type AlbumWallLayoutPreference } from './albumWallLayoutPreference';
import './album-wall-layout-control.css';

export const AlbumWallLayoutControl = ({ value, onChange }: {
  value: AlbumWallLayoutPreference;
  onChange: (value: AlbumWallLayoutPreference) => void;
}): JSX.Element => {
  const { t } = useI18n();
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent): void => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) {
        if (ref.current) ref.current.open = false;
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const options = (max: number) => [{ value: '', label: t('communityLibrary.layout.auto') },
    ...Array.from({ length: max }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))];
  return <details className="album-wall-layout-control" ref={ref} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="sort-button"><Grid3X3 size={16} /><span>{t('communityLibrary.layout.title')}</span></summary>
    {open ? <div className="album-wall-layout-panel">
      <div><span>{t('communityLibrary.layout.columns')}</span><StyledSelect value={value.columns?.toString() ?? ''} options={options(albumWallMaxColumns)}
        ariaLabel={t('communityLibrary.layout.columns')} showFilterIcon={false}
        onChange={(columns) => onChange({ ...value, columns: columns ? Number(columns) : null })} /></div>
      <div><span>{t('communityLibrary.layout.rows')}</span><StyledSelect value={value.rows?.toString() ?? ''} options={options(albumWallMaxRows)}
        ariaLabel={t('communityLibrary.layout.rows')} showFilterIcon={false}
        onChange={(rows) => onChange({ ...value, rows: rows ? Number(rows) : null })} /></div>
      <button type="button" className="songs-filter-reset" disabled={value.columns === null && value.rows === null}
        onClick={() => onChange(defaultAlbumWallLayout)}>{t('communityLibrary.layout.reset')}</button>
    </div> : null}
  </details>;
};
