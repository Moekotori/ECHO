export type LyricsVersionFlags = {
  cover: boolean;
  live: boolean;
  instrumental: boolean;
  karaoke: boolean;
  offVocal: boolean;
  tvSize: boolean;
  shortVersion: boolean;
  longVersion: boolean;
  remix: boolean;
  remaster: boolean;
  acoustic: boolean;
  demo: boolean;
  radioEdit: boolean;
};

export const emptyLyricsVersionFlags = (): LyricsVersionFlags => ({
  cover: false,
  live: false,
  instrumental: false,
  karaoke: false,
  offVocal: false,
  tvSize: false,
  shortVersion: false,
  longVersion: false,
  remix: false,
  remaster: false,
  acoustic: false,
  demo: false,
  radioEdit: false,
});

const normalizeVersionText = (value: string | null | undefined): string =>
  (value ?? '').normalize('NFKC').toLocaleLowerCase();

const hasAny = (text: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(text));

export const extractLyricsVersionFlags = (...texts: Array<string | null | undefined>): LyricsVersionFlags => {
  const text = normalizeVersionText(texts.filter(Boolean).join(' '));

  return {
    cover: hasAny(text, [/\bcover(?:ed by| ver(?:sion)?\.?)?\b/u, /カバー/u, /翻唱/u, /歌ってみた/u, /歌みた/u]),
    live: hasAny(text, [/\blive(?: ver(?:sion)?\.?)?\b/u, /\bconcert\b/u, /现场/u, /ライブ/u]),
    instrumental: hasAny(text, [/\binstrumental\b/u, /\binst(?:\.|\b)/u, /纯音乐/u]),
    karaoke: hasAny(text, [/\bkaraoke\b/u, /伴奏/u, /カラオケ/u]),
    offVocal: hasAny(text, [/\boff[\s-]?vocal\b/u, /伴奏/u]),
    tvSize: hasAny(text, [/\btv[\s-]?size\b/u, /\banime[\s-]?size\b/u, /TVサイズ/iu]),
    shortVersion: hasAny(text, [/\bshort\s+(?:ver(?:sion)?\.?|version)\b/u, /短版/u]),
    longVersion: hasAny(text, [/\blong\s+ver(?:sion)?\.?\b/u, /\bfull\s+(?:ver(?:sion)?\.?|size)\b/u, /\bextended\b/u, /完整版/u, /加长版/u]),
    remix: hasAny(text, [/\bremix\b/u, /\bmix\b/u, /\bbootleg\b/u, /\bedit\b/u]),
    remaster: hasAny(text, [/\bremaster(?:ed)?\b/u, /重制/u]),
    acoustic: hasAny(text, [/\bacoustic\b/u, /\bunplugged\b/u]),
    demo: hasAny(text, [/\bdemo\b/u]),
    radioEdit: hasAny(text, [/\bradio\s+edit\b/u]),
  };
};

const flagKeys: Array<keyof LyricsVersionFlags> = [
  'cover',
  'live',
  'instrumental',
  'karaoke',
  'offVocal',
  'tvSize',
  'shortVersion',
  'longVersion',
  'remix',
  'remaster',
  'acoustic',
  'demo',
  'radioEdit',
];

export const hasAnyLyricsVersionFlag = (flags: LyricsVersionFlags): boolean => flagKeys.some((key) => flags[key]);

const strictKeys: Array<keyof LyricsVersionFlags> = [
  'instrumental',
  'karaoke',
  'offVocal',
  'live',
  'tvSize',
  'shortVersion',
  'remix',
  'acoustic',
  'demo',
  'radioEdit',
];

export const hasLyricsVersionConflict = (queryFlags: LyricsVersionFlags, candidateFlags: LyricsVersionFlags): boolean => {
  if (queryFlags.cover !== candidateFlags.cover) {
    return true;
  }

  return strictKeys.some((key) => queryFlags[key] !== candidateFlags[key]);
};

export const getVersionRisk = (queryFlags: LyricsVersionFlags, candidateFlags: LyricsVersionFlags): 'low' | 'medium' | 'high' => {
  if (
    (queryFlags.instrumental || queryFlags.karaoke || queryFlags.offVocal) &&
    !(candidateFlags.instrumental || candidateFlags.karaoke || candidateFlags.offVocal)
  ) {
    return 'high';
  }

  if (
    (!queryFlags.instrumental && candidateFlags.instrumental) ||
    (!queryFlags.karaoke && candidateFlags.karaoke) ||
    (!queryFlags.offVocal && candidateFlags.offVocal)
  ) {
    return 'high';
  }

  if (hasLyricsVersionConflict(queryFlags, candidateFlags)) {
    return 'medium';
  }

  return 'low';
};

export const serializeLyricsVersionFlags = (flags: LyricsVersionFlags): string =>
  flagKeys.filter((key) => flags[key]).sort().join(',');
