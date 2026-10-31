import { Fragment } from 'react';
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import type { LibrarySort } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { directionalSortFamilies } from '../../utils/songSortSelection';
import { songSortOptionLabel, sortGroups, type SongSortOption } from './songSortMenuConfig';
import '../../styles/songs-sort.css';

const groupSortRows = (options: SongSortOption[]): SongSortOption[][] => options.flatMap((option, index) => {
  const family = directionalSortFamilies.find((values) => values.includes(option.value));
  if (family && options.slice(0, index).some((previous) => family.includes(previous.value))) return [];
  return [options.filter((candidate) => family ? family.includes(candidate.value) : candidate === option)];
});

export function SongsSortOptions({ effectiveSorts, isMultiSortEnabled, hiddenValues, onSelect }: {
  effectiveSorts: LibrarySort[];
  isMultiSortEnabled: boolean;
  hiddenValues?: ReadonlySet<LibrarySort>;
  onSelect: (value: LibrarySort, directionOnly?: boolean) => void;
}) {
  const { t } = useI18n();
  const menuGroups = sortGroups.flatMap((group) => {
    const options = hiddenValues ? group.options.filter((option) => !hiddenValues.has(option.value)) : group.options;
    return options.length > 0 ? [{ labelKey: group.labelKey, rows: groupSortRows(options) }] : [];
  });
  return menuGroups.map((group, groupIndex) => (
    <Fragment key={group.labelKey}>
      {groupIndex > 0 ? <div className="sort-menu-divider" role="presentation" /> : null}
      <div className="sort-menu-section-title" role="presentation">{t(group.labelKey)}</div>
      {group.rows.map((options) => {
        const current = options.find((option) => effectiveSorts.includes(option.value)) ?? options[0];
        const opposite = options.find((option) => option !== current);
        const priority = effectiveSorts.indexOf(current.value);
        const DirectionIcon = current.value.endsWith('Desc') ? ArrowDown : ArrowUp;
        return (
          <div className="songs-sort-row" key={options[0].value}>
            <button className="sort-option" type="button" role="option" aria-selected={priority >= 0}
              onClick={() => onSelect(current.value)}>
              <span>{songSortOptionLabel(current, t)}</span>
              {priority >= 0 ? (isMultiSortEnabled
                ? <span className="sort-option-priority" aria-label={String(priority + 1)}>{priority + 1}</span>
                : <Check size={14} />) : null}
            </button>
            {opposite ? (
              <button className="songs-sort-direction" type="button"
                aria-label={songSortOptionLabel(opposite, t)} title={songSortOptionLabel(opposite, t)}
                onClick={() => onSelect(opposite.value, true)}>
                <DirectionIcon size={15} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
      })}
    </Fragment>
  ));
}
