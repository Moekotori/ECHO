import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ListFilter } from 'lucide-react';
import type { LibrarySort } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { SongsSortOptions } from '../songs/SongsSortOptions';
import { songSortOptionLabel, sortOptions } from '../songs/songSortMenuConfig';

export function FolderSortControl({
  value,
  hiddenValues,
  onChange,
  ariaLabel,
  className,
}: {
  value: LibrarySort;
  hiddenValues?: ReadonlySet<LibrarySort>;
  onChange: (value: LibrarySort) => void;
  ariaLabel: string;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const resolvedHidden = useMemo(() => {
    const next = new Set<LibrarySort>(hiddenValues);
    next.add('default');
    return next;
  }, [hiddenValues]);
  const label = songSortOptionLabel(sortOptions.find((option) => option.value === value), t);

  useEffect(() => {
    if (!isOpen) return undefined;
    const frame = requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>('.sort-option[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, value]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className={`sort-select styled-select${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        className="sort-button"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={label}
        onClick={() => setIsOpen((current) => !current)}
      >
        <ListFilter className="sort-button-icon" size={16} aria-hidden="true" />
        <span className="sort-button-label">{label}</span>
        <ChevronDown className="sort-button-chevron" size={15} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div id={menuId} className="sort-menu sort-menu--songs" role="listbox" aria-label={ariaLabel} data-state="open">
          <SongsSortOptions
            effectiveSorts={[value]}
            isMultiSortEnabled={false}
            hiddenValues={resolvedHidden}
            onSelect={(next, directionOnly) => {
              onChange(next);
              if (!directionOnly) setIsOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
