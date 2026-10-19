import { Trie } from 'opencc-js/core';
import type { ConverterFunction, DictGroup, DictLike } from 'opencc-js/core';
import { configs, from as fromDicts, to as toDicts } from 'opencc-js/preset';

export type OpenCCLocale = 'cn' | 'tw' | 'hk' | 'twp' | 'jp' | 't';

const dictIds = new Map<DictLike, number>();
const dictTries = new Map<number, Trie>();
const groupTries = new Map<string, Trie>();
const converters = new Map<string, ConverterFunction>();

const dictId = (dict: DictLike): number => {
  let id = dictIds.get(dict);
  if (id === undefined) {
    id = dictIds.size + 1;
    dictIds.set(dict, id);
  }
  return id;
};

const trieForDict = (dict: DictLike): Trie => {
  const id = dictId(dict);
  let trie = dictTries.get(id);
  if (!trie) {
    trie = new Trie();
    trie.loadDict(dict);
    dictTries.set(id, trie);
  }
  return trie;
};

const trieForGroup = (group: DictGroup): Trie => {
  // Presets allocate new group arrays, but reuse the same member dictionaries.
  // Preserve member order: loadDictGroup uses it to resolve dictionary priority.
  const key = group.map(dictId).join(',');
  let trie = groupTries.get(key);
  if (!trie) {
    trie = new Trie();
    trie.loadDictGroup(group);
    groupTries.set(key, trie);
  }
  return trie;
};

const configName = (from: OpenCCLocale, to: OpenCCLocale): string => {
  if (from === 'cn') return `s2${to}`;
  if (to === 'cn') return from === 'twp' ? 'tw2sp' : `${from}2s`;
  return `${from}2${to}`;
};

const normalizeGroups = (groups: readonly DictGroup[] | DictGroup): readonly DictGroup[] =>
  Array.isArray(groups) && Array.isArray(groups[0]) ? groups as readonly DictGroup[] : [groups as DictGroup];

/**
 * Share immutable dictionary tries as ECHOSteam does. Keep the installed OpenCC
 * algorithm, including phrase segmentation and group order. Build eagerly at the
 * existing call sites so ordinary searches never acquire a new cold-start cost.
 */
export const getOpenCCConverter = (from: OpenCCLocale, to: OpenCCLocale): ConverterFunction => {
  const key = `${from}>${to}`;
  const existing = converters.get(key);
  if (existing) return existing;

  const config = configs[configName(from, to)];
  let converter: ConverterFunction;
  if (config) {
    const segmentation = trieForDict(config.segmentation);
    const chain = config.conversionChain.map(trieForGroup);
    converter = text => chain
      .reduce((segments, trie) => segments.map(segment => trie.convert(segment)), segmentation.segment(text))
      .join('');
  } else {
    const groups: DictGroup[] = [];
    if (from !== 't') groups.push(...normalizeGroups(fromDicts[from]));
    if (to !== 't') groups.push(...normalizeGroups(toDicts[to]));
    const chain = groups.map(trieForGroup);
    converter = text => chain.reduce((result, trie) => trie.convert(result), text);
  }
  converters.set(key, converter);
  return converter;
};

export const getOpenCCTrieCountForTests = (): number => dictTries.size + groupTries.size;
