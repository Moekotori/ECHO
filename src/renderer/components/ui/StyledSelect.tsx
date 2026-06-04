import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, ChevronDown, ListFilter } from 'lucide-react';

export type StyledSelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type StyledSelectProps<T extends string> = {
  value: T;
  options: Array<StyledSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  showFilterIcon?: boolean;
};

export function StyledSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled = false,
  showFilterIcon = true,
}: StyledSelectProps<T>) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const enabledOptions = useMemo(() => options.filter((option) => !option.disabled), [options]);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const selectedIndex = enabledOptions.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [enabledOptions, isOpen, value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  const selectOption = (option: StyledSelectOption<T>) => {
    if (option.disabled) {
      return;
    }

    onChange(option.value);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const moveActive = (direction: 1 | -1) => {
    if (enabledOptions.length === 0) {
      return;
    }

    setActiveIndex((current) => (current + direction + enabledOptions.length) % enabledOptions.length);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsOpen(true);
      moveActive(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      moveActive(-1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex(Math.max(0, enabledOptions.length - 1));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen) {
        const activeOption = enabledOptions[activeIndex];
        if (activeOption) {
          selectOption(activeOption);
        }
      } else {
        setIsOpen(true);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div className={`sort-select styled-select${className ? ` ${className}` : ''}`} ref={rootRef} onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        className="sort-button"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        {showFilterIcon ? <ListFilter className="sort-button-icon" size={16} aria-hidden="true" /> : null}
        <span className="sort-button-label">{selectedOption?.label ?? ''}</span>
        <ChevronDown className="sort-button-chevron" size={15} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div id={menuId} className="sort-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const enabledIndex = enabledOptions.findIndex((enabledOption) => enabledOption.value === option.value);
            const isActive = enabledIndex === activeIndex;
            const isSelected = option.value === value;

            return (
              <button
                key={option.value}
                className="sort-option"
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                data-active={isActive ? 'true' : undefined}
                onMouseEnter={() => {
                  if (enabledIndex >= 0) {
                    setActiveIndex(enabledIndex);
                  }
                }}
                onClick={() => selectOption(option)}
              >
                <span>{option.label}</span>
                {isSelected ? <Check size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
