import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CompositionEvent, Dispatch, SetStateAction } from 'react';

type KeyboardEventLike = {
  isComposing?: boolean;
  key?: string;
  keyCode?: number;
  which?: number;
  nativeEvent?: {
    isComposing?: boolean;
    key?: string;
    keyCode?: number;
    which?: number;
  };
};

type SearchInputElement = HTMLInputElement | HTMLTextAreaElement;

type ImeAwareSearchInputProps<TElement extends SearchInputElement> = {
  value: string;
  onChange: (event: ChangeEvent<TElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (event: CompositionEvent<TElement>) => void;
};

export const isImeComposingKeyEvent = (event: KeyboardEventLike): boolean => {
  const nativeEvent = event.nativeEvent;
  const key = event.key ?? nativeEvent?.key;
  const keyCode = event.keyCode ?? nativeEvent?.keyCode;
  const which = event.which ?? nativeEvent?.which;

  return Boolean(
    event.isComposing ||
    nativeEvent?.isComposing ||
    key === 'Process' ||
    keyCode === 229 ||
    which === 229,
  );
};

export const useImeAwareDebouncedSearch = <TElement extends SearchInputElement = HTMLInputElement>(
  delayMs: number,
  initialValue = '',
): {
  searchInput: string;
  setSearchInput: Dispatch<SetStateAction<string>>;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  searchInputProps: ImeAwareSearchInputProps<TElement>;
} => {
  const [searchInput, setSearchInput] = useState(initialValue);
  const [search, setSearch] = useState(initialValue.trim());
  const isComposingRef = useRef(false);

  useEffect(() => {
    if (isComposingRef.current) {
      return undefined;
    }

    const timer = window.setTimeout(() => setSearch(searchInput.trim()), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, searchInput]);

  const handleChange = useCallback((event: ChangeEvent<TElement>): void => {
    setSearchInput(event.currentTarget.value);
  }, []);

  const handleCompositionStart = useCallback((): void => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback((event: CompositionEvent<TElement>): void => {
    const nextValue = event.currentTarget.value;
    isComposingRef.current = false;
    setSearchInput(nextValue);
    setSearch(nextValue.trim());
  }, []);

  return {
    searchInput,
    setSearchInput,
    search,
    setSearch,
    searchInputProps: {
      value: searchInput,
      onChange: handleChange,
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
    },
  };
};
