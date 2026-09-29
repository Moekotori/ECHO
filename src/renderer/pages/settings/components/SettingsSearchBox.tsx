import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { Search, X } from 'lucide-react';
import type { TranslationKey } from '../../../i18n/locales';
import { isImeComposingKeyEvent } from '../../../utils/imeInput';
import type { SettingsSearchResult } from '../settingsSearch';
import '../../../styles/settings-search.css';

type SettingsSearchBoxProps = {
  activeResultIndex: number;
  inputRef: MutableRefObject<HTMLInputElement | null>;
  onActiveResultIndexChange: (index: number) => void;
  onQueryChange: (query: string) => void;
  onResultSelect: (result: SettingsSearchResult) => void;
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  query: string;
  t: (key: TranslationKey) => string;
  visibleSearchResults: SettingsSearchResult[];
};

export const SettingsSearchBox = ({
  activeResultIndex, inputRef, onActiveResultIndexChange, onQueryChange,
  onResultSelect, onSearchKeyDown, query, t, visibleSearchResults,
}: SettingsSearchBoxProps): JSX.Element => {
  const rootRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [availableHeight, setAvailableHeight] = useState(420);
  const visible = open && Boolean(query.trim());
  const activeResult = visibleSearchResults[activeResultIndex];

  useEffect(() => {
    if (!visible) return undefined;
    const dismissOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const updateHeight = (): void => {
      const bottom = rootRef.current?.getBoundingClientRect().bottom ?? 0;
      const panelBottom = rootRef.current?.closest('.settings-page')?.getBoundingClientRect().bottom;
      const lowerEdge = panelBottom && panelBottom > bottom ? Math.min(panelBottom, window.innerHeight) : window.innerHeight;
      setAvailableHeight(Math.max(0, lowerEdge - bottom - 24));
    };
    updateHeight();
    document.addEventListener('pointerdown', dismissOutside, true);
    window.addEventListener('resize', updateHeight);
    window.addEventListener('scroll', updateHeight, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('scroll', updateHeight, true);
    };
  }, [visible]);

  useEffect(() => {
    if (visible) resultsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeResultIndex, activeResult?.id, visible]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (isImeComposingKeyEvent(event)) return;
    if (!visible && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && query.trim()) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === 'Enter' && !visible) return;
    if (event.key === 'Escape' || event.key === 'Enter') setOpen(false);
    onSearchKeyDown(event);
  };

  return (
    <div className="settings-search" ref={rootRef} role="search" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <Search size={16} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setOpen(true); onQueryChange(event.target.value); }}
        onKeyDown={handleKeyDown}
        placeholder={t('settings.header.searchPlaceholder')}
        aria-label={t('settings.header.searchPlaceholder')}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={visible ? 'settings-search-results' : undefined}
        aria-expanded={visible}
        aria-activedescendant={visible && activeResult ? `settings-search-result-${activeResult.id}` : undefined}
      />
      {query ? <button className="settings-search-clear" type="button" aria-label={t('settings.header.searchClear')} onClick={() => {
        onQueryChange('');
        inputRef.current?.focus();
      }}><X size={14} aria-hidden="true" /></button> : null}
      {visible ? (
        <div className="settings-search-results" ref={resultsRef} id="settings-search-results" role="listbox"
          aria-label={t('settings.header.searchPlaceholder')} style={{ maxHeight: Math.min(420, availableHeight) }}>
          {visibleSearchResults.length ? visibleSearchResults.map((result, index) => (
            <button className="settings-search-result" id={`settings-search-result-${result.id}`} key={result.id}
              type="button" role="option" tabIndex={-1} aria-selected={index === activeResultIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => onActiveResultIndexChange(index)}
              onClick={() => { setOpen(false); onResultSelect(result); }}>
              <strong>{result.title}</strong>
              <span>{result.path}</span>
              <small>{result.description}</small>
            </button>
          )) : <p className="settings-search-empty" role="status">{t('settings.header.searchEmpty')}</p>}
        </div>
      ) : null}
    </div>
  );
};
