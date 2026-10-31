import { ArrowDown, ArrowUp } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import './directional-sort.css';

export function SortDirectionButtons({ value, onChange, disabled = false, ariaLabel }: {
  value: 'asc' | 'desc' | null;
  onChange: (direction: 'asc' | 'desc') => void;
  disabled?: boolean;
  ariaLabel?: string;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="sort-direction-buttons" role="group" aria-label={ariaLabel ?? t('library.sort.direction.aria')}>
      {(['asc', 'desc'] as const).map((direction) => (
        <button key={direction} type="button"
          aria-label={t(direction === 'asc' ? 'library.sort.direction.asc' : 'library.sort.direction.desc')}
          title={t(direction === 'asc' ? 'library.sort.direction.asc' : 'library.sort.direction.desc')}
          aria-pressed={value === direction} disabled={disabled}
          onClick={() => { if (value !== direction) onChange(direction); }}>
          {direction === 'asc' ? <ArrowUp size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
