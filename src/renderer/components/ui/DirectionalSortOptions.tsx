import { Fragment } from 'react';
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import { groupDirectionalSortOptions, isDescendingSort, type SortDirectionPairs } from '../../utils/sortDirection';
import type { StyledSelectOption } from './StyledSelect';
import '../../styles/songs-sort.css';
import './directional-sort.css';

export function DirectionalSortOptions<T extends string>({ groups, value, pairs, onSelect,
  leadingDivider = false, optionRole = 'option', optionClassName = 'sort-option',
}: {
  groups: Array<{ label?: string; options: Array<StyledSelectOption<T>> }>;
  value: T;
  pairs: SortDirectionPairs;
  onSelect: (value: T, directionOnly: boolean) => void;
  leadingDivider?: boolean;
  optionRole?: 'option' | 'menuitemradio';
  optionClassName?: string;
}): JSX.Element {
  return <>{groups.map((group, index) => (
    <Fragment key={group.label ?? index}>
      {group.label ? <>
        {index > 0 || leadingDivider ? <div className="sort-menu-divider" role="presentation" /> : null}
        <div className="sort-menu-section-title" role="presentation">{group.label}</div>
      </> : null}
      {groupDirectionalSortOptions(group.options, pairs).map((row) => {
        const current = row.find((option) => option.value === value) ?? row[0];
        const opposite = row.find((option) => option !== current);
        const DirectionIcon = isDescendingSort(current.value, pairs) ? ArrowDown : ArrowUp;
        return (
          <div className="songs-sort-row" key={row[0].value}>
            <button className={optionClassName} type="button" role={optionRole}
              aria-selected={optionRole === 'option' ? current.value === value : undefined}
              aria-checked={optionRole === 'menuitemradio' ? current.value === value : undefined}
              disabled={current.disabled} onClick={() => onSelect(current.value, false)}>
              <span>{current.label}</span>
              {current.value === value ? <Check size={14} aria-hidden="true" /> : null}
            </button>
            {opposite ? <button className="songs-sort-direction" type="button"
              aria-label={opposite.label} title={opposite.label} disabled={opposite.disabled}
              onClick={() => onSelect(opposite.value, true)}>
              <DirectionIcon size={15} aria-hidden="true" />
            </button> : null}
          </div>
        );
      })}
    </Fragment>
  ))}</>;
}
