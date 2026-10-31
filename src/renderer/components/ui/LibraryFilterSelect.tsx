import { Check, ChevronDown, Search } from 'lucide-react';
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

export type LibraryFilterSelectOption = {
  value: string;
  label: string;
  title?: string;
};

type LibraryFilterSelectProps = {
  value: string;
  label: string;
  ariaLabel?: string;
  options: readonly LibraryFilterSelectOption[];
  disabled?: boolean;
  loading?: boolean;
  searchable?: boolean;
  emptyLabel: string;
  onOpen?: () => void;
  onChange: (value: string) => void;
};

const normalizeSearchText = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase();

export const LibraryFilterSelect = ({
  value,
  label,
  ariaLabel,
  options,
  disabled = false,
  loading = false,
  searchable = false,
  emptyLabel,
  onOpen,
  onChange,
}: LibraryFilterSelectProps): JSX.Element => {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [popoverPlacement, setPopoverPlacement] = useState<'top' | 'bottom'>('bottom');
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const deferredQuery = useDeferredValue(query);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selectedOption = options[selectedIndex] ?? options[0];
  const searchableOptions = useMemo(() => options.map((option) => ({
    option,
    text: normalizeSearchText(`${option.label}\n${option.title ?? ''}`),
  })), [options]);
  const visibleOptions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(deferredQuery);
    if (!normalizedQuery) {
      return options;
    }
    return searchableOptions.filter(({ text }) => text.includes(normalizedQuery)).map(({ option }) => option);
  }, [deferredQuery, options, searchableOptions]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    onOpenRef.current?.();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const selectedVisibleIndex = visibleOptions.findIndex((option) => option.value === value);
    setActiveIndex(Math.max(0, selectedVisibleIndex));
  }, [open, value, visibleOptions]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverStyle(null);
      return undefined;
    }

    const updatePopoverPosition = (): void => {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 5;
      const desiredHeight = searchable ? 264 : 224;
      const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
      const spaceAbove = rect.top - gap - viewportPadding;
      const placement = spaceBelow < Math.min(desiredHeight, 160) && spaceAbove > spaceBelow ? 'top' : 'bottom';
      const availableHeight = placement === 'top' ? spaceAbove : spaceBelow;
      const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
      );

      setPopoverPlacement(placement);
      setPopoverStyle({
        left,
        width,
        maxHeight: Math.max(96, Math.min(desiredHeight, availableHeight)),
        ...(placement === 'top'
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
      });
    };

    updatePopoverPosition();
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [open, searchable]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const activeOption = popoverRef.current?.querySelector<HTMLElement>('[role="option"][data-active="true"]');
    activeOption?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const openMenu = (): void => {
    if (disabled) {
      return;
    }
    setOpen(true);
    window.requestAnimationFrame(() => {
      if (searchable) {
        searchRef.current?.focus();
      }
    });
  };

  const choose = (option: LibraryFilterSelectOption): void => {
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
    if (option.value !== value) {
      startTransition(() => onChange(option.value));
    }
  };

  const moveActive = (direction: 1 | -1): void => {
    if (visibleOptions.length === 0) {
      return;
    }
    setActiveIndex((current) => (current + direction + visibleOptions.length) % visibleOptions.length);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu();
      } else {
        moveActive(event.key === 'ArrowDown' ? 1 : -1);
      }
      return;
    }
    if (open && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, visibleOptions.length - 1));
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      const activeOption = visibleOptions[activeIndex];
      if (activeOption) {
        choose(activeOption);
      }
      return;
    }
    if (event.key === ' ' && !open && event.target === triggerRef.current) {
      event.preventDefault();
      openMenu();
    }
  };

  return (
    <div
      ref={rootRef}
      className="songs-filter-field"
      data-open={open ? 'true' : undefined}
      onKeyDown={handleKeyDown}
    >
      <span className="songs-filter-field-label">{label}</span>
      <div className="songs-filter-picker">
        <button
          ref={triggerRef}
          className="songs-filter-picker-trigger"
          type="button"
          role="combobox"
          aria-label={ariaLabel ?? label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && visibleOptions[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
          disabled={disabled}
          onClick={() => {
            if (open) {
              setOpen(false);
            } else {
              openMenu();
            }
          }}
        >
          <span className="songs-filter-picker-value" title={selectedOption?.title ?? selectedOption?.label}>
            {selectedOption?.label ?? value}
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>

        {open && popoverStyle ? createPortal(
          <div
            ref={popoverRef}
            className="songs-filter-picker-popover"
            data-songs-filter-floating="true"
            data-placement={popoverPlacement}
            data-searchable={searchable ? 'true' : undefined}
            style={popoverStyle}
          >
            {searchable ? (
              <label className="songs-filter-picker-search">
                <Search size={14} aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  aria-label={ariaLabel ?? label}
                  placeholder={ariaLabel ?? label}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            ) : null}
            <div
              id={listboxId}
              className="songs-filter-picker-options"
              role="listbox"
              aria-label={ariaLabel ?? label}
              aria-busy={loading || undefined}
            >
              {loading && visibleOptions.length <= 1 ? (
                <div className="songs-filter-picker-loading" role="status" aria-label={emptyLabel}>
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                </div>
              ) : visibleOptions.length === 0 ? (
                <div className="songs-filter-picker-empty">{emptyLabel}</div>
              ) : visibleOptions.map((option, index) => {
                const selected = option.value === value;
                return (
                  <button
                    id={`${listboxId}-option-${index}`}
                    className="songs-filter-picker-option"
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-active={index === activeIndex ? 'true' : undefined}
                    title={option.title}
                    tabIndex={-1}
                    key={option.value}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(option)}
                  >
                    <span>{option.label}</span>
                    {selected ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        ) : null}
      </div>
    </div>
  );
};
