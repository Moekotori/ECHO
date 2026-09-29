const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export const artistMark = (name: string): string => {
  const trimmed = name.trim();

  if (!trimmed) {
    return '?';
  }

  if (/^[\dA-Za-z]/.test(trimmed)) {
    const compact = trimmed.replace(/^[^\dA-Za-z]+/, '').replace(/\s+/g, '');
    return compact.slice(0, Math.min(2, compact.length)).toLocaleUpperCase();
  }

  const graphemes = segmenter ? Array.from(segmenter.segment(trimmed), (part) => part.segment) : Array.from(trimmed);
  return graphemes.slice(0, 2).join('');
};

export const artistHue = (name: string): number => {
  let hash = 0;

  for (const char of name.trim().toLocaleLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }

  return (hash + 198) % 360;
};
