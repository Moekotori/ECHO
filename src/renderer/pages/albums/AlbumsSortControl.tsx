import { SortDirectionButtons } from '../../components/ui/SortDirectionButtons';
import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react';
import type { LibrarySort } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import './albums-sort-control.css';

type SortOption = {
  value: LibrarySort;
  labelKey: TranslationKey;
  asc?: LibrarySort;
  desc?: LibrarySort;
  descLabelKey?: TranslationKey;
};

const sortGroups: Array<{ labelKey: TranslationKey; options: SortOption[] }> = [
  {
    labelKey: 'songs.sort.group.browse',
    options: [
      { value: 'default', labelKey: 'library.sort.default' },
      { value: 'titleAsc', labelKey: 'library.albums.sort.titleAsc', asc: 'titleAsc', desc: 'titleDesc' },
      { value: 'artist', labelKey: 'library.albums.sort.artist', asc: 'artist', desc: 'artistDesc' },
      { value: 'yearDesc', labelKey: 'albumTagEditor.field.year', asc: 'yearAsc', desc: 'yearDesc' },
    ],
  },
  {
    labelKey: 'library.albums.sort.group.listening',
    options: [
      { value: 'lastPlayed', labelKey: 'library.albums.sort.lastPlayed' },
      { value: 'playCountDesc', labelKey: 'library.albums.sort.playCountDesc', asc: 'playCountAsc', desc: 'playCountDesc' },
      { value: 'random', labelKey: 'library.sort.random' },
    ],
  },
  {
    labelKey: 'songs.sort.group.audio',
    options: [
      { value: 'durationAsc', labelKey: 'library.sort.durationAsc', asc: 'durationAsc', desc: 'durationDesc' },
    ],
  },
  {
    labelKey: 'library.albums.sort.group.library',
    options: [
      { value: 'recent', labelKey: 'library.albums.sort.recentAdded' },
      { value: 'trackCountDesc', labelKey: 'library.albums.sort.trackCountAsc', descLabelKey: 'library.albums.sort.trackCountDesc', asc: 'trackCountAsc', desc: 'trackCountDesc' },
      { value: 'createdDesc', labelKey: 'library.sort.createdAsc', descLabelKey: 'library.sort.createdDesc', asc: 'createdAsc', desc: 'createdDesc' },
      { value: 'fileModifiedDesc', labelKey: 'library.sort.fileModifiedAsc', descLabelKey: 'library.sort.fileModifiedDesc', asc: 'fileModifiedAsc', desc: 'fileModifiedDesc' },
    ],
  },
];
const sortOptions = sortGroups.flatMap((group) => group.options);
export const validAlbumSortValues = new Set<LibrarySort>(
  sortOptions.flatMap((option) => option.asc && option.desc ? [option.asc, option.desc] : [option.value]),
);

export const AlbumsSortControl = ({ sort, onChange }: {
  sort: LibrarySort;
  onChange: (sort: LibrarySort) => void;
}): JSX.Element => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = sortOptions.find((option) => option.value === sort || option.asc === sort || option.desc === sort) ?? sortOptions[0];
  const labelFor = (option: SortOption): TranslationKey =>
    option.descLabelKey && (option.desc === sort || (option !== selected && option.value === option.desc))
      ? option.descLabelKey : option.labelKey;

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  return (
    <div className="albums-sort-control" ref={rootRef} onKeyDown={(event) => {
      if (event.key === 'Escape' && isOpen) {
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }}>
      <div className="sort-select">
        <button className="sort-button" type="button" ref={triggerRef}
          aria-haspopup="listbox" aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}>
          <ArrowUpDown className="sort-button-icon" size={16} aria-hidden="true" />
          <span className="sort-button-label">{t(labelFor(selected))}</span>
          <ChevronDown className="sort-button-chevron" size={15} aria-hidden="true" />
        </button>
        {isOpen ? (
          <div className="sort-menu" role="listbox" aria-label={t('library.albums.sort.aria')} data-state="open">
            {sortGroups.map((group, groupIndex) => (
              <Fragment key={group.labelKey}>
                {groupIndex > 0 ? <div className="sort-menu-divider" role="presentation" /> : null}
                <div className="sort-menu-section-title" role="presentation">{t(group.labelKey)}</div>
                {group.options.map((option) => (
                  <div key={option.value} className="albums-sort-row" data-selected={selected === option}>
                    <button className="sort-option" type="button" role="option"
                      aria-selected={selected === option}
                      onClick={() => {
                        onChange(selected === option ? sort : option.value);
                        if (!option.asc || !option.desc) {
                          setIsOpen(false);
                          triggerRef.current?.focus();
                        }
                      }}>
                      <span>{t(labelFor(option))}</span>
                      {selected === option ? <Check size={14} aria-hidden="true" /> : null}
                    </button>
                    {selected === option && option.asc && option.desc ? (
                      <SortDirectionButtons
                        value={option.desc === sort ? 'desc' : 'asc'}
                        onChange={(direction) => {
                          const next = option[direction];
                          if (next && next !== sort) onChange(next);
                        }}
                      />
                    ) : null}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
