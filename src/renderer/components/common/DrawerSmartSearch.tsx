import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { pinyin } from 'pinyin-pro';

type DrawerSearchMatch = {
  element: HTMLElement;
  label: string;
  score: number;
};

type DrawerSmartSearchProps = {
  rootRef: RefObject<HTMLElement>;
  placeholder: string;
  label: string;
  clearLabel: string;
  noResultsLabel: string;
  resultCountLabel: (count: number) => string;
  nextLabel: string;
  previousLabel: string;
  resultLabel: (label: string) => string;
  shortcutHint: string;
  hints?: string[];
};

const candidateSelector = [
  '[data-drawer-search-item]',
  '.audio-engine-meter',
  '.audio-drawer-section',
  '.audio-hidden-devices',
  '.audio-professional-status--drawer',
  '.audio-professional-status-actions',
].join(',');

const hanRunPattern = /\p{Script=Han}+/gu;

const searchAliasGroups = [
  ['exclusive', 'lowlatency', 'driver', 'soundcard', 'interface', '专业声卡', '声卡', '驱动', '低延迟', '原生输出'],
  ['wasapi', 'exclusive', 'shared', '独占', '共享', '系统输出', 'windows输出', 'bitperfect', 'bit perfect', '位完美', '源码输出', '直通'],
  ['dsp', 'eq', 'equalizer', '均衡器', '音效', '调音', '房间校正', 'fir', '削波', '限幅', '保护'],
  ['dsd', 'dop', 'sacd', 'dsf', 'dff', '原生dsd', '位流'],
  ['soxr', 'src', 'resample', 'upsample', '重采样', '升频', '采样率', '高采样', '变速'],
  ['buffer', 'latency', 'frames', '缓冲', '延迟', '卡顿', '爆音', '断音', '爆裂', '稳定'],
  ['lowload', 'lowloadplayback', 'performance', '省电', '性能', '低负载', '低占用', '不卡', '卡顿', '后台任务'],
  ['hqplayer', 'hqp', 'external', 'takeover', '接管', '外部输出', '外部渲染', '数播'],
  ['lyrics', 'lyric', 'lrc', '歌词', '歌词页', '桌面歌词', '字幕'],
  ['provider', 'source', 'netease', 'qqmusic', 'kugou', 'kuwo', 'lrclib', 'amll', 'ttml', 'sourcequality', '歌词源', '来源', '网易', 'qq音乐', '酷狗', '酷我'],
  ['romaji', 'romanization', 'kana', 'furigana', 'utaten', '罗马音', '假名', '注音', '日文'],
  ['translation', 'translate', 'secondary', '翻译', '副歌词', '双语'],
  ['wordhighlight', 'highlight', 'karaoke', '逐字', '高亮', '卡拉ok', '逐词'],
  ['offset', 'sync', 'alignment', 'timeline', 'delay', '偏移', '同步', '不同步', '延迟', '校准', '对齐'],
  ['font', 'fontsize', 'typeface', 'family', '字体', '字号', '系统字体', '导入字体'],
  ['background', 'wallpaper', 'cover', 'blur', 'glass', 'immersive', '背景', '壁纸', '封面', '模糊', '玻璃', '沉浸'],
  ['mv', 'video', 'bilibili', 'youtube', '画面', '视频', '哔哩哔哩'],
];

const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();

const compactSearchText = (value: string): string => normalizeSearchText(value).replace(/\s+/g, '');

const normalizedAliasGroups = searchAliasGroups.map((group) => Array.from(new Set(group.map((alias) => alias.toLocaleLowerCase()))));
const aliasLookup = new Map<string, Set<string>>();
normalizedAliasGroups.forEach((group) => {
  group.forEach((alias) => {
    const key = compactSearchText(alias);
    const aliases = aliasLookup.get(key) ?? new Set<string>();
    group.forEach((groupAlias) => aliases.add(compactSearchText(groupAlias)));
    aliasLookup.set(key, aliases);
  });
});

const getPinyinVariants = (value: string): string[] => {
  const variants: string[] = [];
  for (const match of value.matchAll(hanRunPattern)) {
    const syllables = pinyin(match[0], { toneType: 'none', type: 'array' })
      .map((item) => compactSearchText(item))
      .filter(Boolean);

    if (!syllables.length) {
      continue;
    }

    variants.push(syllables.join(''));
    variants.push(syllables.map((syllable) => syllable[0] ?? '').join(''));
    variants.push(...syllables);
  }

  return variants;
};

const expandSearchText = (value: string): string[] => {
  const normalized = normalizeSearchText(value);
  const compact = compactSearchText(value);
  const terms = normalized.split(/\s+/).filter(Boolean);
  const variants = new Set<string>([normalized, compact, ...terms.map(compactSearchText), ...getPinyinVariants(value)]);

  terms.forEach((term) => {
    aliasLookup.get(compactSearchText(term))?.forEach((alias) => variants.add(alias));
  });
  aliasLookup.get(compact)?.forEach((alias) => variants.add(alias));

  return Array.from(variants).filter(Boolean);
};

const variantMatchesText = (variant: string, normalizedText: string, compactText: string, textVariants: string[]): boolean => {
  if (!variant) {
    return false;
  }

  return (
    normalizedText.includes(variant) ||
    compactText.includes(variant) ||
    textVariants.some((textVariant) => textVariant.includes(variant))
  );
};

const isSubsequenceMatch = (needle: string, haystack: string): boolean => {
  if (needle.length < 4) {
    return false;
  }

  let needleIndex = 0;
  for (const character of haystack) {
    if (character === needle[needleIndex]) {
      needleIndex += 1;
      if (needleIndex >= needle.length) {
        return true;
      }
    }
  }

  return false;
};

const collectSearchText = (element: HTMLElement): string => {
  const extraValues = Array.from(element.querySelectorAll<HTMLElement>('[aria-label], [title], [data-search-keywords]'))
    .flatMap((node) => [
      node.getAttribute('aria-label'),
      node.getAttribute('title'),
      node.dataset.searchKeywords,
    ])
    .filter((value): value is string => Boolean(value));

  return [
    element.textContent ?? '',
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.dataset.searchKeywords,
    ...extraValues,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');
};

const getMatchLabel = (element: HTMLElement): string => {
  const labelElement = element.querySelector<HTMLElement>(
    '.audio-drawer-section-title h3, .audio-engine-meter__top span, summary span, strong',
  );
  const label = labelElement?.textContent?.trim() || element.getAttribute('aria-label') || element.textContent?.trim() || '';
  return label.replace(/\s+/g, ' ').slice(0, 64);
};

const getSearchCandidates = (root: HTMLElement): HTMLElement[] => {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(candidateSelector))
    .filter((element) => !element.closest('.drawer-smart-search'));
  const uniqueNodes = Array.from(new Set(nodes));

  return uniqueNodes.filter((element) => {
    const parentCandidate = uniqueNodes.find((candidate) => candidate !== element && candidate.contains(element));
    return !parentCandidate;
  });
};

const scoreCandidate = (query: string, element: HTMLElement): number => {
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const queryVariants = expandSearchText(query);

  if (!terms.length) {
    return 0;
  }

  const searchText = collectSearchText(element);
  const normalizedText = normalizeSearchText(searchText);
  const compactText = compactSearchText(searchText);
  const textVariants = expandSearchText(searchText);
  let score = queryVariants.some((variant) => variantMatchesText(variant, normalizedText, compactText, textVariants)) ? 16 : 0;

  if (compactText.includes(compactQuery) || textVariants.includes(compactQuery)) {
    score += 12;
  }

  for (const term of terms) {
    const termVariants = expandSearchText(term);
    const bestVariant = termVariants.find((variant) => variantMatchesText(variant, normalizedText, compactText, textVariants));

    if (bestVariant) {
      score += normalizedText.startsWith(term) || compactText.startsWith(bestVariant) || textVariants.some((textVariant) => textVariant.startsWith(bestVariant)) ? 8 : 5;
      continue;
    }

    const fuzzyVariant = termVariants.find((variant) => isSubsequenceMatch(variant, compactText) || textVariants.some((textVariant) => isSubsequenceMatch(variant, textVariant)));
    if (fuzzyVariant) {
      score += 2;
      continue;
    }

    return 0;
  }

  return score;
};

export const DrawerSmartSearch = ({
  rootRef,
  placeholder,
  label,
  clearLabel,
  noResultsLabel,
  resultCountLabel,
  nextLabel,
  previousLabel,
  resultLabel,
  shortcutHint,
  hints = [],
}: DrawerSmartSearchProps): JSX.Element => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<DrawerSearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = useMemo(() => normalizeSearchText(query), [query]);
  const isSearching = normalizedQuery.length > 0;

  const applySearch = useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const candidates = getSearchCandidates(root);

    if (!normalizedQuery) {
      candidates.forEach((element) => {
        delete element.dataset.drawerSearchHidden;
        delete element.dataset.drawerSearchMatch;
        delete element.dataset.drawerSearchActive;
      });
      setMatches([]);
      setActiveIndex(0);
      return;
    }

    const nextMatches = candidates
      .map((element) => ({
        element,
        label: getMatchLabel(element),
        score: scoreCandidate(query, element),
      }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score);

    const matchedElements = new Set(nextMatches.map((match) => match.element));
    candidates.forEach((element) => {
      const isMatch = matchedElements.has(element);
      element.dataset.drawerSearchHidden = isMatch ? 'false' : 'true';
      if (isMatch) {
        element.dataset.drawerSearchMatch = 'true';
      } else {
        delete element.dataset.drawerSearchMatch;
        delete element.dataset.drawerSearchActive;
      }
    });

    setMatches(nextMatches);
    setActiveIndex((current) => Math.min(current, Math.max(0, nextMatches.length - 1)));
  }, [normalizedQuery, query, rootRef]);

  const focusMatch = useCallback((index: number) => {
    const match = matches[index];
    const root = rootRef.current;

    if (!match || !root) {
      return;
    }

    getSearchCandidates(root).forEach((element) => delete element.dataset.drawerSearchActive);
    match.element.dataset.drawerSearchActive = 'true';
    if (typeof match.element.scrollIntoView === 'function') {
      match.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [matches, rootRef]);

  const moveMatch = useCallback((direction: 1 | -1) => {
    if (!matches.length) {
      return;
    }

    setActiveIndex((current) => {
      const nextIndex = (current + direction + matches.length) % matches.length;
      focusMatch(nextIndex);
      return nextIndex;
    });
  }, [focusMatch, matches.length]);

  useEffect(() => {
    applySearch();
  }, [applySearch]);

  useEffect(() => {
    if (matches.length > 0) {
      focusMatch(activeIndex);
    }
  }, [activeIndex, focusMatch, matches.length]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault();
        event.stopImmediatePropagation();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  useEffect(() => () => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    getSearchCandidates(root).forEach((element) => {
      delete element.dataset.drawerSearchHidden;
      delete element.dataset.drawerSearchMatch;
      delete element.dataset.drawerSearchActive;
    });
  }, [rootRef]);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setQuery('');
      return;
    }

    if (event.key === 'Enter' && matches.length > 0) {
      event.preventDefault();
      moveMatch(event.shiftKey ? -1 : 1);
    }
  };

  return (
    <section className="drawer-smart-search" aria-label={label}>
      <label className="drawer-smart-search__field">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onFocus={applySearch}
          onKeyDown={handleInputKeyDown}
        />
        {query ? (
          <button className="drawer-smart-search__clear" type="button" aria-label={clearLabel} title={clearLabel} onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        ) : null}
      </label>

      <div className="drawer-smart-search__meta">
        <span>{isSearching ? (matches.length ? resultCountLabel(matches.length) : noResultsLabel) : shortcutHint}</span>
        {isSearching && matches.length > 0 ? (
          <span className="drawer-smart-search__steppers">
            <button type="button" aria-label={previousLabel} title={previousLabel} onClick={() => moveMatch(-1)}>
              <ChevronUp size={13} />
            </button>
            <button type="button" aria-label={nextLabel} title={nextLabel} onClick={() => moveMatch(1)}>
              <ChevronDown size={13} />
            </button>
          </span>
        ) : null}
      </div>

      {!isSearching && hints.length > 0 ? (
        <div className="drawer-smart-search__hints" aria-hidden="true">
          {hints.map((hint) => (
            <button type="button" key={hint} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => setQuery(hint)}>
              {hint}
            </button>
          ))}
        </div>
      ) : null}

      {isSearching && matches.length > 0 ? (
        <div className="drawer-smart-search__results">
          {matches.slice(0, 4).map((match, index) => (
            <button
              type="button"
              key={`${match.label}-${index}`}
              aria-label={resultLabel(match.label)}
              data-active={index === activeIndex}
              onClick={() => {
                setActiveIndex(index);
                focusMatch(index);
              }}
            >
              {match.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
};
