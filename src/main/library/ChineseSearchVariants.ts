import OpenCC from 'opencc-js';

const converters = [
  OpenCC.Converter({ from: 'cn', to: 'tw' }),
  OpenCC.Converter({ from: 'cn', to: 'hk' }),
  OpenCC.Converter({ from: 'cn', to: 't' }),
  OpenCC.Converter({ from: 'tw', to: 'cn' }),
  OpenCC.Converter({ from: 'hk', to: 'cn' }),
  OpenCC.Converter({ from: 't', to: 'cn' }),
  OpenCC.Converter({ from: 'tw', to: 'hk' }),
  OpenCC.Converter({ from: 'hk', to: 'tw' }),
];

export const chineseSearchVariants = (term: string): string[] => {
  const normalized = term.normalize('NFKC').trim();

  if (!normalized) {
    return [];
  }

  return Array.from(new Set([normalized, ...converters.map((converter) => converter(normalized))].filter(Boolean)));
};
