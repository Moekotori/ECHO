import { ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EqPreset } from '../../../shared/types/eq';
import { useI18n } from '../../i18n/I18nProvider';
import { describePreset, type PresetCategory } from './eqPanelUtils';

type EqPresetSelectorProps = {
  presets: EqPreset[];
  value: string;
  onChange: (presetId: string) => void;
};

export const EqPresetSelector = ({ presets, value, onChange }: EqPresetSelectorProps): JSX.Element => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PresetCategory | 'all' | 'built-in'>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filterOptions: Array<{ value: PresetCategory | 'all' | 'built-in'; label: string }> = [
    { value: 'all', label: t('settings.eq.preset.filter.all') },
    { value: 'built-in', label: t('settings.eq.preset.filter.builtIn') },
    { value: 'user', label: t('settings.eq.preset.filter.user') },
    { value: 'target', label: t('settings.eq.preset.filter.target') },
    { value: 'genre', label: t('settings.eq.preset.filter.genre') },
    { value: 'utility', label: t('settings.eq.preset.filter.utility') },
  ];
  const visiblePresets = useMemo(
    () =>
      presets.filter((preset) => {
        const metadata = describePreset(preset.id);
        const matchesQuery = !normalizedQuery || preset.name.toLowerCase().includes(normalizedQuery) || preset.id.includes(normalizedQuery);
        const matchesFilter =
          filter === 'all' ||
          (filter === 'built-in' && preset.readonly) ||
          (filter === 'user' && !preset.readonly) ||
          metadata?.category === filter;
        return matchesQuery && matchesFilter;
      }),
    [filter, normalizedQuery, presets],
  );
  const selectedPreset = presets.find((preset) => preset.id === value);
  const selectedLabel = value === 'custom'
    ? t('settings.eq.preset.modified')
    : selectedPreset?.name ?? t('settings.eq.preset.selectorAria');
  const safeVisiblePresets = selectedPreset && !visiblePresets.some((preset) => preset.id === selectedPreset.id)
    ? [selectedPreset, ...visiblePresets]
    : visiblePresets;
  const builtInPresets = safeVisiblePresets.filter((preset) => preset.readonly);
  const userPresets = safeVisiblePresets.filter((preset) => !preset.readonly);

  useEffect(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (menuOpen) {
      setMenuMounted(true);
      return undefined;
    }

    closeTimerRef.current = window.setTimeout(() => {
      setMenuMounted(false);
      closeTimerRef.current = null;
    }, 150);

    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [menuOpen]);

  const choosePreset = (presetId: string): void => {
    onChange(presetId);
    setMenuOpen(false);
  };

  return (
    <div className="eq-preset-browser">
      <label className="eq-preset-search">
        <Search size={14} aria-hidden="true" />
        <input
          aria-label={t('settings.eq.preset.searchAria')}
          value={query}
          placeholder={t('settings.eq.preset.searchPlaceholder')}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div className="eq-preset-filter" role="group" aria-label={t('settings.eq.preset.filterAria')}>
        {filterOptions.map((option) => (
          <button
            className="eq-preset-filter-chip"
            data-active={filter === option.value}
            type="button"
            key={option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="eq-preset-selector">
        <button
          className="eq-preset-trigger"
          type="button"
          aria-label={t('settings.eq.preset.selectorAria')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
        >
          <span>{selectedLabel}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {menuMounted ? (
        <div className="eq-preset-menu" data-state={menuOpen ? 'open' : 'closing'} role="listbox" aria-label={t('settings.eq.preset.selectorAria')}>
          {builtInPresets.length > 0 ? (
            <section>
              <span className="eq-preset-menu-heading">{t('settings.eq.preset.builtIn')}</span>
              {builtInPresets.map((preset) => (
                <button
                  className="eq-preset-option"
                  data-selected={preset.id === value}
                  type="button"
                  role="option"
                  aria-selected={preset.id === value}
                  key={preset.id}
                  onClick={() => choosePreset(preset.id)}
                >
                  {preset.name}
                </button>
              ))}
            </section>
          ) : null}
          {userPresets.length > 0 ? (
            <section>
              <span className="eq-preset-menu-heading">{t('settings.eq.preset.user')}</span>
              {userPresets.map((preset) => (
                <button
                  className="eq-preset-option"
                  data-selected={preset.id === value}
                  type="button"
                  role="option"
                  aria-selected={preset.id === value}
                  key={preset.id}
                  onClick={() => choosePreset(preset.id)}
                >
                  {preset.name}
                </button>
              ))}
            </section>
          ) : null}
          {value === 'custom' ? (
            <button className="eq-preset-option" data-selected="true" type="button" role="option" aria-selected="true" onClick={() => setMenuOpen(false)}>
              {t('settings.eq.preset.modified')}
            </button>
          ) : null}
        </div>
        ) : null}
      </div>
    </div>
  );
};
