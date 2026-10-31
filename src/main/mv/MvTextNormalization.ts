import { getOpenCCConverter } from '../text/openccConverters';

const toMainlandChinese = [
  getOpenCCConverter('tw', 'cn'),
  getOpenCCConverter('hk', 'cn'),
  getOpenCCConverter('jp', 'cn'),
] as const;

export const normalizeMvSemanticText = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|quot|apos|lt|gt);/g, ' ')
    .replace(/[[\]【】「」『』〈〉《》〔〕〖〗()（）"'“”‘’]/g, ' ')
    .replace(/[&*+._\-–—~|/\\:：·・,，。!?！？]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Conservative aliases for writing-system variants, without transliteration. */
export const buildMvWritingSystemAliases = (
  value: string | null | undefined,
  normalizer: (input: string | null | undefined) => string = normalizeMvSemanticText,
): string[] => {
  const source = (value ?? '').normalize('NFKC');
  const aliases = [source, ...toMainlandChinese.map((convert) => convert(source))]
    .map((alias) => normalizer(alias))
    .filter(Boolean);

  return [...new Set(aliases)];
};
