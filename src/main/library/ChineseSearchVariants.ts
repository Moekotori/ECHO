import { getOpenCCConverter } from '../text/openccConverters';

const converters = [
  getOpenCCConverter('cn', 'tw'),
  getOpenCCConverter('cn', 'hk'),
  getOpenCCConverter('cn', 't'),
  getOpenCCConverter('tw', 'cn'),
  getOpenCCConverter('hk', 'cn'),
  getOpenCCConverter('t', 'cn'),
  getOpenCCConverter('tw', 'hk'),
  getOpenCCConverter('hk', 'tw'),
];

export const chineseSearchVariants = (term: string): string[] => {
  const normalized = term.normalize('NFKC').trim();

  if (!normalized) {
    return [];
  }

  return Array.from(new Set([normalized, ...converters.map((converter) => converter(normalized))].filter(Boolean)));
};
