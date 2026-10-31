import { memo, startTransition, useEffect } from 'react';
import type { InputHTMLAttributes } from 'react';
import { useImeAwareDebouncedSearch } from '../../utils/imeInput';

type DebouncedSearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'onCompositionStart' | 'onCompositionEnd'> & {
  onSearchChange: (search: string) => void;
  delayMs?: number;
  initialValue?: string;
};

/** Keep draft keystrokes local so large library pages only render committed searches. */
export const DebouncedSearchInput = memo(function DebouncedSearchInput({
  onSearchChange,
  delayMs = 250,
  initialValue = '',
  ...inputProps
}: DebouncedSearchInputProps): JSX.Element {
  const { search, searchInputProps } = useImeAwareDebouncedSearch(delayMs, initialValue);

  useEffect(() => {
    startTransition(() => onSearchChange(search));
  }, [onSearchChange, search]);

  return <input type="search" {...inputProps} {...searchInputProps} />;
});
